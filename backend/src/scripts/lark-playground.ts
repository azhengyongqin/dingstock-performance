/**
 * Lark SDK 快速试验场（playground）
 * ------------------------------------------------------------------
 * 目的：不启动 HTTP 服务、不依赖数据库/Redis，就能快速调用飞书 SDK 方法调试。
 *
 * 运行方式（在 backend/ 下）：
 *   CI=true pnpm lark:play
 *
 * 使用步骤：
 *   1. 在下方 `run()` 函数里写你想测试的 SDK 调用（client 已注入好鉴权）。
 *   2. 保存后执行上面的命令，结果会打印到控制台。
 *   3. 只想跑某段临时代码时，直接改 `run()` 即可，改完就删，不必提交。
 *
 * 成功标志：控制台先打印 “✅ Lark client 就绪”，随后打印你的调用结果 JSON。
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import * as lark from '@larksuiteoapi/node-sdk';
import configuration from '../config/configuration';
import { validationSchema } from '../config/validation.schema';
import { LarkModule } from '../shared/lark/lark.module';
import { LarkService } from '../shared/lark/lark.service';

// 最小上下文：只加载配置 + Lark 模块，避免连接 DB/Redis。
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema,
    }),
    LarkModule,
  ],
})
class LarkPlaygroundModule {}

/**
 * 在这里编写要测试的 SDK 调用。
 * client 即官方 `lark.Client`，已按 config 完成 appId/appSecret 鉴权配置。
 * ctx.appId / ctx.appSecret 为当前配置解析出的凭据（env > YAML > 默认）。
 * `lark` 命名空间（枚举/工具）也已导入，可直接使用。
 */
async function run(
  client: lark.Client,
  ctx: { appId: string; appSecret: string },
): Promise<unknown> {
  // ---- 示例：获取 tenant_access_token，验证鉴权是否打通（默认启用）----
  const token = await client.auth.v3.tenantAccessToken.internal({
    data: { app_id: ctx.appId, app_secret: ctx.appSecret },
  });
  return token;

  // ---- 更多示例（按需解除注释替换上面的 return）----

  // 拉取部门下的子部门（分页迭代器）：
  // const iterator = await client.contact.v3.user.findByDepartmentWithIterator({
  //   params: {
  //     department_id_type: 'open_department_id',
  //     department_id: 'od-a67dddfb89b4a640b2572ecae46f6cf6',
  //     page_size: 50,
  //   },
  // });

  // const departments: unknown[] = [];
  // for await (const page of iterator) {
  //   departments.push(...(page?.items ?? []));
  // }

  // console.log(JSON.stringify(departments, null, 2));

  // return departments;

  // 发消息到某个群/用户：
  // return client.im.v1.message.create({
  //   params: { receive_id_type: 'open_id' },
  //   data: {
  //     receive_id: 'ou_xxx',
  //     msg_type: 'text',
  //     content: JSON.stringify({ text: 'hello from playground' }),
  //   },
  // });
}

async function bootstrap() {
  // 关闭 Nest 启动日志噪音，只保留我们自己的输出。
  const app = await NestFactory.createApplicationContext(LarkPlaygroundModule, {
    logger: ['error', 'warn'],
  });

  try {
    const client = app.get(LarkService).getClient();
    const config = app.get(ConfigService);
    const ctx = {
      appId: config.getOrThrow<string>('lark.appId'),
      appSecret: config.getOrThrow<string>('lark.appSecret'),
    };
    console.log('✅ Lark client 就绪，开始执行 run()...\n');

    const result = await run(client, ctx);
    console.log('📦 结果：');
    console.dir(result, { depth: null });
  } catch (err) {
    console.error('❌ 调用失败：');
    console.error(err);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void bootstrap();
