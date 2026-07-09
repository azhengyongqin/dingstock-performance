import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const setupSwagger = (app: INestApplication) => {
  const documentConfig = new DocumentBuilder()
    .setTitle('Dingstock Performance API')
    .setDescription('Dingstock Performance 后端接口文档')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, documentConfig);

  // Swagger UI 地址固定为 /api-docs，JSON 文档地址为 /api-docs-json。
  SwaggerModule.setup('api-docs', app, document, {
    jsonDocumentUrl: 'api-docs-json',
  });
};
