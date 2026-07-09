import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as lark from '@larksuiteoapi/node-sdk';
import { LARK_CLIENT } from './lark.constants';
import { LarkService } from './lark.service';

@Module({
  providers: [
    {
      provide: LARK_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const appId = configService.getOrThrow<string>('lark.appId');
        const appSecret = configService.getOrThrow<string>('lark.appSecret');

        // 飞书企业自建应用使用 SelfBuild；domain 固定为飞书开放平台。
        return new lark.Client({
          appId,
          appSecret,
          appType: lark.AppType.SelfBuild,
          domain: lark.Domain.Feishu,
        });
      },
    },
    LarkService,
  ],
  exports: [LARK_CLIENT, LarkService],
})
export class LarkModule {}
