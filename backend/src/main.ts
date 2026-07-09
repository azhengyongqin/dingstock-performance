import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { setupSwagger } from './shared/swagger/setup-swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 全局 DTO 校验：剔除未声明字段并自动转换类型（研发文档 §11 技术债 #3）。
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // 开启关闭钩子，确保 Redis 等外部连接在进程退出时释放。
  app.enableShutdownHooks();
  // 前端（Next.js，端口 3001）跨域访问后端接口。
  app.enableCors({ origin: true, credentials: true });
  setupSwagger(app);

  // 监听端口统一走 ConfigService，确保 YAML 与环境变量覆盖规则一致。
  const configService = app.get(ConfigService);
  await app.listen(configService.getOrThrow<number>('app.port'));
}
void bootstrap();
