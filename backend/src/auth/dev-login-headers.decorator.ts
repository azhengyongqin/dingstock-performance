import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * 提取请求 Header，并允许为 Header DTO 单独挂载 ValidationPipe。
 * Nest 内置 @Headers 不接受 Pipe 参数，因此这里使用自定义参数装饰器。
 */
export const DevLoginHeaders = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<Request>().headers,
);
