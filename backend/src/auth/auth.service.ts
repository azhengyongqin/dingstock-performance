import { createHash, randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type Redis from 'ioredis';
import { LarkService } from '../shared/lark/lark.service';
import { REDIS_CLIENT } from '../shared/redis/redis.constants';

/** 登录成功后签入 JWT 的用户身份信息（来自飞书 authen v1 access_token 响应） */
export type LarkSessionUser = {
  open_id: string;
  union_id?: string;
  user_id?: string;
  name?: string;
  en_name?: string;
  avatar_url?: string;
  email?: string;
  enterprise_email?: string;
  tenant_key?: string;
};

const STATE_KEY_PREFIX = 'auth:lark:state:';
// state 有效期 10 分钟：飞书授权页停留过久则要求重新发起登录。
const STATE_TTL_SECONDS = 600;

const USER_TOKEN_KEY_PREFIX = 'auth:lark:user-token:';
const JSAPI_TICKET_KEY_PREFIX = 'auth:lark:jsapi-ticket:';
// access_token 提前 60s 视为过期，避免使用临界失效的令牌。
const TOKEN_EXPIRY_BUFFER_MS = 60_000;
// jsapi_ticket 官方有效期约 2 小时，缓存提前 5 分钟过期。
const JSAPI_TICKET_EXPIRY_BUFFER_SECONDS = 300;

/**
 * Redis 中缓存的飞书用户令牌。
 * 网页组件（成员名片/搜索）仅支持用户身份换取 jsapi_ticket，
 * 因此登录后必须保留 user_access_token（应用会话 JWT 与其解耦，不落库）。
 */
type StoredLarkUserToken = {
  accessToken: string;
  /** access_token 过期时间（毫秒时间戳） */
  accessTokenExpiresAt: number;
  refreshToken?: string;
};

/** 飞书 authen 换取/刷新令牌响应中与令牌存储相关的字段 */
type LarkUserTokenPayload = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly configService: ConfigService,
    private readonly larkService: LarkService,
    private readonly jwtService: JwtService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * 生成飞书 OAuth2 授权页地址。
   * state 为一次性随机值，存入 Redis 供回调时校验，防 CSRF。
   */
  async buildAuthorizeUrl() {
    const appId = this.configService.getOrThrow<string>('lark.appId');
    const authorizeUrl = this.configService.getOrThrow<string>(
      'lark.oauth.authorizeUrl',
    );
    const redirectUri = this.configService.getOrThrow<string>(
      'lark.oauth.redirectUri',
    );
    const scope = this.configService.get<string>('lark.oauth.scope') ?? '';

    const state = randomBytes(16).toString('hex');
    await this.redis.set(
      `${STATE_KEY_PREFIX}${state}`,
      '1',
      'EX',
      STATE_TTL_SECONDS,
    );

    const url = new URL(authorizeUrl);
    // 飞书 authen v1 授权参数：client_id 即自建应用 app_id。
    url.searchParams.set('client_id', appId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    if (scope) {
      url.searchParams.set('scope', scope);
    }

    return { url: url.toString(), state };
  }

  /**
   * 回调阶段：校验 state → 用授权码换 user_access_token（SDK authen v1）→ 签发应用会话 JWT。
   * 返回给前端跳转所需的 token 与用户基本信息。
   */
  async loginWithAuthorizationCode(code: string, state: string) {
    const stateKey = `${STATE_KEY_PREFIX}${state}`;
    // GETDEL 保证 state 一次性使用。
    const stateValue = await this.redis.getdel(stateKey);
    if (!stateValue) {
      throw new UnauthorizedException('state 无效或已过期，请重新发起登录');
    }

    const response = await this.larkService
      .getClient()
      .authen.v1.accessToken.create({
        data: {
          grant_type: 'authorization_code',
          code,
        },
      });

    if (response.code !== 0 || !response.data?.open_id) {
      throw new UnauthorizedException(
        `飞书授权码换取用户令牌失败：${response.msg ?? 'unknown error'}`,
      );
    }

    const user: LarkSessionUser = {
      open_id: response.data.open_id,
      union_id: response.data.union_id,
      user_id: response.data.user_id,
      name: response.data.name,
      en_name: response.data.en_name,
      avatar_url: response.data.avatar_url,
      email: response.data.email,
      enterprise_email: response.data.enterprise_email,
      tenant_key: response.data.tenant_key,
    };

    // 网页组件鉴权需以用户身份换 jsapi_ticket，保留 user_access_token 于 Redis。
    if (response.data.access_token) {
      await this.storeUserToken(user.open_id, {
        access_token: response.data.access_token,
        expires_in: response.data.expires_in,
        refresh_token: response.data.refresh_token,
        refresh_expires_in: response.data.refresh_expires_in,
      });
    }

    // sub 使用 open_id；应用侧会话与飞书 user_access_token 解耦，后者不落库。
    const token = await this.jwtService.signAsync({
      ...user,
      sub: user.open_id,
    });

    return { token, user };
  }

  /** 校验应用会话 JWT，返回其中的用户身份。 */
  async verifySession(token: string): Promise<LarkSessionUser> {
    try {
      return await this.jwtService.verifyAsync<LarkSessionUser>(token);
    } catch {
      throw new UnauthorizedException('会话已过期或无效，请重新登录');
    }
  }

  /** 登录成功后跳回前端的地址（带 token 与用户名）。 */
  buildWebRedirectUrl(token: string, user: LarkSessionUser) {
    const webRedirectUrl = this.configService.getOrThrow<string>(
      'lark.oauth.webRedirectUrl',
    );
    const url = new URL(webRedirectUrl);
    url.searchParams.set('token', token);
    // open_id 供前端飞书网页组件（成员名片等）定位当前用户。
    url.searchParams.set('open_id', user.open_id);
    if (user.name) {
      url.searchParams.set('name', user.name);
    }
    if (user.avatar_url) {
      url.searchParams.set('avatar', user.avatar_url);
    }
    return url.toString();
  }

  /** 登录/刷新后持久化飞书用户令牌；Redis 键有效期取 refresh 可用期，失效后要求重新登录。 */
  private async storeUserToken(openId: string, payload: LarkUserTokenPayload) {
    const expiresInSeconds = payload.expires_in ?? 7200;
    const stored: StoredLarkUserToken = {
      accessToken: payload.access_token,
      accessTokenExpiresAt: Date.now() + expiresInSeconds * 1000,
      refreshToken: payload.refresh_token,
    };

    await this.redis.set(
      `${USER_TOKEN_KEY_PREFIX}${openId}`,
      JSON.stringify(stored),
      'EX',
      payload.refresh_expires_in ?? expiresInSeconds,
    );
  }

  /** 取有效的 user_access_token：未过期直接用，过期用 refresh_token 刷新（SDK 自动带 app_access_token）。 */
  private async getUserAccessToken(openId: string): Promise<string> {
    const raw = await this.redis.get(`${USER_TOKEN_KEY_PREFIX}${openId}`);
    if (!raw) {
      throw new UnauthorizedException('飞书用户令牌不存在或已过期，请重新登录');
    }

    const stored = JSON.parse(raw) as StoredLarkUserToken;
    if (Date.now() < stored.accessTokenExpiresAt - TOKEN_EXPIRY_BUFFER_MS) {
      return stored.accessToken;
    }

    if (!stored.refreshToken) {
      throw new UnauthorizedException('飞书用户令牌已过期，请重新登录');
    }

    const response = await this.larkService
      .getClient()
      .authen.v1.refreshAccessToken.create({
        data: {
          grant_type: 'refresh_token',
          refresh_token: stored.refreshToken,
        },
      });

    if (response.code !== 0 || !response.data?.access_token) {
      throw new UnauthorizedException(
        `飞书用户令牌刷新失败，请重新登录：${response.msg ?? 'unknown error'}`,
      );
    }

    await this.storeUserToken(openId, {
      access_token: response.data.access_token,
      expires_in: response.data.expires_in,
      refresh_token: response.data.refresh_token,
      refresh_expires_in: response.data.refresh_expires_in,
    });

    return response.data.access_token;
  }

  /** 以用户身份获取 jsapi_ticket（按用户缓存，有效期内可复用）。 */
  private async getUserJsapiTicket(openId: string): Promise<string> {
    const cacheKey = `${JSAPI_TICKET_KEY_PREFIX}${openId}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      return cached;
    }

    const userAccessToken = await this.getUserAccessToken(openId);
    const { ticket, expireIn } =
      await this.larkService.getJsapiTicket(userAccessToken);

    const ttl = Math.max(expireIn - JSAPI_TICKET_EXPIRY_BUFFER_SECONDS, 60);
    await this.redis.set(cacheKey, ticket, 'EX', ttl);

    return ticket;
  }

  /**
   * 飞书网页组件（成员名片/搜索）JSAPI 鉴权签名。
   * 验证串固定为 jsapi_ticket=...&noncestr=...&timestamp=...&url=... 后取 SHA-1；
   * timestamp 为毫秒，需与前端 webComponent.config 传入值完全一致；
   * url 需为剔除 ? 与 # 之后内容的页面地址（由前端保证）。
   * 注意：签名有效期 10 分钟且只能鉴权一次，前端每次 config 前都要重新获取。
   */
  async buildJsapiSignature(url: string, user: LarkSessionUser) {
    if (!url) {
      throw new BadRequestException('url 参数不能为空（当前页面完整地址）');
    }

    const appId = this.configService.getOrThrow<string>('lark.appId');
    const ticket = await this.getUserJsapiTicket(user.open_id);
    const nonceStr = randomBytes(16).toString('hex');
    const timestamp = Date.now();
    const verification = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
    const signature = createHash('sha1').update(verification).digest('hex');

    return {
      appId,
      signature,
      nonceStr,
      timestamp,
      openId: user.open_id,
    };
  }
}
