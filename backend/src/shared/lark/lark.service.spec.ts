import { ServiceUnavailableException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as lark from '@larksuiteoapi/node-sdk';
import { LARK_CLIENT } from './lark.constants';
import { LarkService } from './lark.service';

describe('LarkService', () => {
  let service: LarkService;

  const request = jest.fn();
  const client = {
    im: {
      message: {
        create: jest.fn(),
      },
    },
    request,
  } as unknown as lark.Client;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LarkService,
        {
          provide: LARK_CLIENT,
          useValue: client,
        },
      ],
    }).compile();

    service = module.get<LarkService>(LarkService);
  });

  it('should expose configured lark sdk client', () => {
    expect(service.getClient()).toBe(client);
  });

  it('should report integration status', () => {
    expect(service.getIntegrationStatus()).toEqual({
      provider: 'lark',
      ready: true,
    });
  });

  describe('getJsapiTicket', () => {
    it('should fetch ticket with user access token', async () => {
      request.mockResolvedValue({
        code: 0,
        msg: 'ok',
        data: { ticket: 'user-ticket', expire_in: 7200 },
      });

      await expect(service.getJsapiTicket('u-token')).resolves.toEqual({
        ticket: 'user-ticket',
        expireIn: 7200,
      });

      // 网页组件 ticket 必须以用户身份换取（withUserAccessToken 传入 options）
      expect(request).toHaveBeenCalledWith(
        {
          method: 'POST',
          url: '/open-apis/jssdk/ticket/get',
          data: {},
        },
        expect.anything(),
      );
    });

    it('should throw when lark api returns error', async () => {
      request.mockResolvedValue({ code: 99991668, msg: 'token invalid' });

      await expect(service.getJsapiTicket('u-token')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    });
  });
});
