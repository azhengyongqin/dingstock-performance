import { createHash } from 'node:crypto';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PerfRole } from '../generated/prisma/enums';
import { PrismaService } from '../shared/database/prisma.service';
import { LarkService } from '../shared/lark/lark.service';
import { REDIS_CLIENT } from '../shared/redis/redis.constants';
import { AuthService } from './auth.service';

// 生成的 Prisma client 为 ESM 产物，单测中统一 mock，避免加载真实数据库客户端（与 cycle 等 spec 一致）。
jest.mock(
  '../generated/prisma/client',
  () => ({
    PrismaClient: class {
      $connect = jest.fn();
      $disconnect = jest.fn();
    },
  }),
  { virtual: true },
);
jest.mock(
  '../generated/prisma/enums',
  () => ({
    PerfRole: { HR: 'HR', ADMIN: 'ADMIN', EMPLOYEE: 'EMPLOYEE' },
  }),
  { virtual: true },
);

describe('AuthService', () => {
  const configValues: Record<string, string> = {
    'lark.appId': 'cli_test_app',
    'lark.oauth.authorizeUrl':
      'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
    'lark.oauth.redirectUri': 'http://localhost:3000/auth/lark/callback',
    'lark.oauth.scope': '',
    'lark.oauth.webRedirectUrl': 'http://localhost:3001/auth/callback',
  };

  // 开发登录开关（布尔）：默认开启，测试内可切换以模拟生产关闭。
  let devLoginEnabled = true;

  const prismaMock = {
    larkUser: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    roleGrant: {
      findMany: jest.fn(),
    },
    perfParticipant: {
      findMany: jest.fn(),
    },
  };

  const redisMock = {
    set: jest.fn().mockResolvedValue('OK'),
    get: jest.fn(),
    getdel: jest.fn(),
  };
  const accessTokenCreateMock = jest.fn();
  const refreshAccessTokenCreateMock = jest.fn();
  const getJsapiTicketMock = jest.fn();
  const larkServiceMock = {
    getClient: () => ({
      authen: {
        v1: {
          accessToken: { create: accessTokenCreateMock },
          refreshAccessToken: { create: refreshAccessTokenCreateMock },
        },
      },
    }),
    getJsapiTicket: getJsapiTicketMock,
  };
  const jwtServiceMock = {
    signAsync: jest.fn().mockResolvedValue('signed-jwt'),
    verifyAsync: jest.fn(),
  };

  let service: AuthService;

  beforeEach(async () => {
    jest.clearAllMocks();
    redisMock.set.mockResolvedValue('OK');
    devLoginEnabled = true;

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: ConfigService,
          useValue: {
            getOrThrow: (key: string) => {
              const value = configValues[key];
              if (value === undefined) {
                throw new Error(`missing config ${key}`);
              }
              return value;
            },
            get: (key: string) =>
              key === 'auth.devLogin.enabled'
                ? devLoginEnabled
                : configValues[key],
          },
        },
        { provide: LarkService, useValue: larkServiceMock },
        { provide: JwtService, useValue: jwtServiceMock },
        { provide: PrismaService, useValue: prismaMock },
        { provide: REDIS_CLIENT, useValue: redisMock },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
  });

  it('生成的授权地址携带 client_id/redirect_uri/state，并把 state 存入 Redis', async () => {
    const { url, state } = await service.buildAuthorizeUrl();

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
    );
    expect(parsed.searchParams.get('client_id')).toBe('cli_test_app');
    expect(parsed.searchParams.get('redirect_uri')).toBe(
      'http://localhost:3000/auth/lark/callback',
    );
    expect(parsed.searchParams.get('state')).toBe(state);
    expect(redisMock.set).toHaveBeenCalledWith(
      `auth:lark:state:${state}`,
      '1',
      'EX',
      600,
    );
  });

  it('回调时校验 state 并用授权码换取用户身份、签发 JWT、留存用户令牌', async () => {
    redisMock.getdel.mockResolvedValue('1');
    accessTokenCreateMock.mockResolvedValue({
      code: 0,
      data: {
        open_id: 'ou_1',
        name: '张三',
        avatar_url: 'http://a/x.png',
        access_token: 'u-token',
        expires_in: 7200,
        refresh_token: 'r-token',
        refresh_expires_in: 2592000,
      },
    });

    const result = await service.loginWithAuthorizationCode('code-1', 'st-1');

    expect(accessTokenCreateMock).toHaveBeenCalledWith({
      data: { grant_type: 'authorization_code', code: 'code-1' },
    });
    expect(result.token).toBe('signed-jwt');
    expect(result.user.open_id).toBe('ou_1');
    expect(result.user.name).toBe('张三');

    // user_access_token 存入 Redis（网页组件鉴权换 jsapi_ticket 用），TTL 取 refresh 可用期
    expect(redisMock.set).toHaveBeenCalledWith(
      'auth:lark:user-token:ou_1',
      expect.stringContaining('u-token'),
      'EX',
      2592000,
    );
  });

  it('state 无效时拒绝登录', async () => {
    redisMock.getdel.mockResolvedValue(null);

    await expect(
      service.loginWithAuthorizationCode('code-1', 'bad-state'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(accessTokenCreateMock).not.toHaveBeenCalled();
  });

  it('飞书返回错误码时拒绝登录', async () => {
    redisMock.getdel.mockResolvedValue('1');
    accessTokenCreateMock.mockResolvedValue({ code: 20001, msg: 'bad code' });

    await expect(
      service.loginWithAuthorizationCode('code-1', 'st-1'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('前端回跳地址携带 token 与用户名', () => {
    const url = service.buildWebRedirectUrl('jwt-1', {
      open_id: 'ou_1',
      name: '张三',
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      'http://localhost:3001/auth/callback',
    );
    expect(parsed.searchParams.get('token')).toBe('jwt-1');
    expect(parsed.searchParams.get('name')).toBe('张三');
    expect(parsed.searchParams.get('open_id')).toBe('ou_1');
  });

  describe('buildJsapiSignature（飞书网页组件鉴权）', () => {
    const user = { open_id: 'ou_1', name: '张三' };
    const pageUrl = 'http://localhost:3001/settings/organization';

    it('优先使用缓存的用户 ticket，并按固定拼接串计算 SHA-1 签名', async () => {
      redisMock.get.mockImplementation((key: string) =>
        Promise.resolve(
          key === 'auth:lark:jsapi-ticket:ou_1' ? 'cached-ticket' : null,
        ),
      );

      const result = await service.buildJsapiSignature(pageUrl, user);

      expect(result.appId).toBe('cli_test_app');
      expect(result.openId).toBe('ou_1');
      expect(getJsapiTicketMock).not.toHaveBeenCalled();

      const expected = createHash('sha1')
        .update(
          `jsapi_ticket=cached-ticket&noncestr=${result.nonceStr}&timestamp=${result.timestamp}&url=${pageUrl}`,
        )
        .digest('hex');
      expect(result.signature).toBe(expected);
    });

    it('无缓存时以 user_access_token 换取 ticket 并按用户缓存', async () => {
      redisMock.get.mockImplementation((key: string) => {
        if (key === 'auth:lark:user-token:ou_1') {
          return Promise.resolve(
            JSON.stringify({
              accessToken: 'u-token',
              accessTokenExpiresAt: Date.now() + 3600_000,
            }),
          );
        }
        return Promise.resolve(null);
      });
      getJsapiTicketMock.mockResolvedValue({
        ticket: 'fresh-ticket',
        expireIn: 7200,
      });

      await service.buildJsapiSignature(pageUrl, user);

      expect(getJsapiTicketMock).toHaveBeenCalledWith('u-token');
      // ticket 缓存 TTL = expire_in - 300s 缓冲
      expect(redisMock.set).toHaveBeenCalledWith(
        'auth:lark:jsapi-ticket:ou_1',
        'fresh-ticket',
        'EX',
        6900,
      );
    });

    it('access_token 过期时自动用 refresh_token 刷新并回写', async () => {
      redisMock.get.mockImplementation((key: string) => {
        if (key === 'auth:lark:user-token:ou_1') {
          return Promise.resolve(
            JSON.stringify({
              accessToken: 'u-expired',
              accessTokenExpiresAt: Date.now() - 1000,
              refreshToken: 'r-token',
            }),
          );
        }
        return Promise.resolve(null);
      });
      refreshAccessTokenCreateMock.mockResolvedValue({
        code: 0,
        data: {
          access_token: 'u-new',
          expires_in: 7200,
          refresh_token: 'r-new',
          refresh_expires_in: 2592000,
        },
      });
      getJsapiTicketMock.mockResolvedValue({ ticket: 't-2', expireIn: 7200 });

      await service.buildJsapiSignature(pageUrl, user);

      expect(refreshAccessTokenCreateMock).toHaveBeenCalledWith({
        data: { grant_type: 'refresh_token', refresh_token: 'r-token' },
      });
      expect(getJsapiTicketMock).toHaveBeenCalledWith('u-new');
      expect(redisMock.set).toHaveBeenCalledWith(
        'auth:lark:user-token:ou_1',
        expect.stringContaining('u-new'),
        'EX',
        2592000,
      );
    });

    it('用户令牌缺失（老会话未存 token）时抛 401 要求重新登录', async () => {
      redisMock.get.mockResolvedValue(null);

      await expect(
        service.buildJsapiSignature(pageUrl, user),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(getJsapiTicketMock).not.toHaveBeenCalled();
    });
  });

  describe('开发环境快速登录', () => {
    it('listDevUsers 聚合角色标记：授权/超管→roles，下属/快照→is_leader', async () => {
      prismaMock.larkUser.findMany.mockResolvedValue([
        {
          open_id: 'ou_hr',
          name: 'HR 小美',
          en_name: null,
          avatar: { avatar_240: 'http://a/hr.png' },
          job_title: 'HRBP',
          department_path: [{ department_name: '总部' }, { department_name: '人力资源部' }],
          leader_user_id: null,
          is_tenant_manager: false,
        },
        {
          open_id: 'ou_admin',
          name: '超管阿强',
          en_name: 'Qiang',
          avatar: null,
          job_title: null,
          department_path: null,
          leader_user_id: null,
          is_tenant_manager: true,
        },
        {
          open_id: 'ou_leader',
          name: '组长老王',
          en_name: null,
          avatar: null,
          job_title: null,
          department_path: null,
          leader_user_id: null,
          is_tenant_manager: false,
        },
        {
          open_id: 'ou_staff',
          name: '员工小李',
          en_name: null,
          avatar: null,
          job_title: null,
          department_path: null,
          // 小李的上级是老王 → 老王有下属，判为 Leader
          leader_user_id: 'ou_leader',
          is_tenant_manager: false,
        },
      ]);
      prismaMock.roleGrant.findMany.mockResolvedValue([
        { userOpenId: 'ou_hr', role: PerfRole.HR },
      ]);
      // 快照 Leader 命中另一人（此处复用 ou_leader，不新增）
      prismaMock.perfParticipant.findMany.mockResolvedValue([
        { leaderOpenIdSnapshot: 'ou_leader' },
      ]);

      const { items, total } = await service.listDevUsers();

      expect(total).toBe(4);
      const byId = Object.fromEntries(items.map((i) => [i.open_id, i]));

      expect(byId.ou_hr.roles).toEqual([PerfRole.HR]);
      expect(byId.ou_hr.avatar_url).toBe('http://a/hr.png');
      expect(byId.ou_hr.department).toBe('人力资源部');
      expect(byId.ou_hr.is_leader).toBe(false);

      // 超管兜底为 ADMIN
      expect(byId.ou_admin.roles).toEqual([PerfRole.ADMIN]);
      expect(byId.ou_admin.is_tenant_manager).toBe(true);

      // 有下属 → Leader
      expect(byId.ou_leader.is_leader).toBe(true);
      expect(byId.ou_leader.roles).toEqual([]);

      // 普通员工无角色、非 Leader
      expect(byId.ou_staff.roles).toEqual([]);
      expect(byId.ou_staff.is_leader).toBe(false);
    });

    it('devLogin 对存在的员工签发可被 verifySession 解开的会话 JWT', async () => {
      prismaMock.larkUser.findUnique.mockResolvedValue({
        open_id: 'ou_1',
        union_id: 'on_1',
        user_id: 'u_1',
        name: '张三',
        en_name: null,
        avatar: { avatar_640: 'http://a/big.png' },
        email: 'z@san.com',
        enterprise_email: null,
      });

      const result = await service.devLogin('ou_1');

      expect(result.token).toBe('signed-jwt');
      expect(result.user.open_id).toBe('ou_1');
      expect(result.user.name).toBe('张三');
      expect(result.user.avatar_url).toBe('http://a/big.png');
      // 与 OAuth 登录共用签发逻辑：sub = open_id
      expect(jwtServiceMock.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ open_id: 'ou_1', sub: 'ou_1' }),
      );
    });

    it('devLogin 对不存在的 open_id 抛 400', async () => {
      prismaMock.larkUser.findUnique.mockResolvedValue(null);

      await expect(service.devLogin('ou_missing')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('dev 开关关闭（模拟生产）时两接口一律抛 404', async () => {
      devLoginEnabled = false;

      await expect(service.listDevUsers()).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.devLogin('ou_1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      // 关闭时不应触碰数据库
      expect(prismaMock.larkUser.findMany).not.toHaveBeenCalled();
      expect(prismaMock.larkUser.findUnique).not.toHaveBeenCalled();
    });
  });
});
