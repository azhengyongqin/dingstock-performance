import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import * as lark from '@larksuiteoapi/node-sdk';
import { LARK_CLIENT } from './lark.constants';

/** /open-apis/jssdk/ticket/get 的响应体（SDK request 原样返回） */
type JsapiTicketResponse = {
  code?: number;
  msg?: string;
  data?: {
    ticket?: string;
    expire_in?: number;
  };
};

@Injectable()
export class LarkService {
  constructor(@Inject(LARK_CLIENT) private readonly client: lark.Client) {}

  getClient() {
    // 暴露 SDK client，后续业务模块可以复用官方完整 API 能力。
    return this.client;
  }

  getIntegrationStatus() {
    return {
      provider: 'lark',
      ready: true,
    };
  }

  /**
   * 以用户身份获取 jsapi_ticket，供飞书网页组件（成员名片/搜索）鉴权签名使用。
   * 注意：成员名片、搜索组件仅支持 user_access_token 换取的 ticket，
   * 用 tenant_access_token 换的 ticket 鉴权会报 20442 jsapi-ticket not exist。
   * ticket 有效期内可重复使用，按用户缓存由调用方（AuthService）负责。
   */
  async getJsapiTicket(
    userAccessToken: string,
  ): Promise<{ ticket: string; expireIn: number }> {
    const response = await this.client.request<JsapiTicketResponse>(
      {
        method: 'POST',
        url: '/open-apis/jssdk/ticket/get',
        data: {},
      },
      lark.withUserAccessToken(userAccessToken),
    );

    const ticket = response?.data?.ticket;
    if (response?.code !== 0 || !ticket) {
      throw new ServiceUnavailableException(
        `获取飞书 jsapi_ticket 失败：${response?.msg ?? 'unknown error'}`,
      );
    }

    return { ticket, expireIn: response.data?.expire_in ?? 7200 };
  }
}
