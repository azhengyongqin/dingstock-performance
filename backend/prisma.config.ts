import { defineConfig } from 'prisma/config';
import { loadAppConfig } from './src/config/configuration';

const appConfig = loadAppConfig();

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Prisma CLI 与 Nest 应用共用同一套 YAML + 环境变量配置解析逻辑。
    url: appConfig.database.url,
  },
});
