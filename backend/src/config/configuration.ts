import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

export type RawConfig = {
  app?: {
    port?: number;
  };
  database?: {
    url?: string;
  };
  postgres?: {
    uri?: string;
  };
  redis?: {
    uri?: string;
  };
  lark?: Record<string, unknown> & {
    oauth?: Record<string, unknown>;
  };
  auth?: {
    jwt?: Record<string, unknown>;
  };
};

export type LarkOauthConfig = {
  /** 飞书授权页地址（authen v1 authorize） */
  authorizeUrl: string;
  /** 飞书回调到后端的地址，需与开放平台安全设置一致 */
  redirectUri: string;
  /** 用户授权 scope，空格分隔，可为空 */
  scope: string;
  /** 登录成功后跳回前端的地址 */
  webRedirectUrl: string;
};

export type AppConfig = {
  app: {
    port: number;
  };
  database: {
    url: string;
  };
  redis: {
    uri: string;
  };
  lark: Record<string, unknown> & {
    appId?: unknown;
    appSecret?: unknown;
    oauth: LarkOauthConfig;
  };
  auth: {
    jwt: {
      secret: string;
      expiresIn: string;
    };
  };
};

const getDefaultConfigFileName = () =>
  process.env.NODE_ENV === 'production' ? 'prod.yaml' : 'dev.yaml';

export const resolveConfigPath = () => {
  const configFileName =
    process.env.APP_CONFIG_FILE ??
    process.env.CONFIG_FILE ??
    getDefaultConfigFileName();

  return join(process.cwd(), 'config', configFileName);
};

const readYamlFile = (path: string): RawConfig => {
  if (!existsSync(path)) {
    return {};
  }

  return (parse(readFileSync(path, 'utf8')) ?? {}) as RawConfig;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// 递归合并配置对象：override 中的叶子值覆盖 base，同为对象时逐层合并。
const deepMerge = (
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    const baseValue = merged[key];
    merged[key] =
      isPlainObject(baseValue) && isPlainObject(value)
        ? deepMerge(baseValue, value)
        : value;
  }

  return merged;
};

export const loadYamlConfig = (): RawConfig => {
  // app.yaml 是跨环境公共基础层；dev.yaml/prod.yaml（或 APP_CONFIG_FILE 指定文件）按环境覆盖。
  const baseConfig = readYamlFile(join(process.cwd(), 'config', 'app.yaml'));
  const envConfig = readYamlFile(resolveConfigPath());

  // 敏感配置仍优先通过环境变量覆盖（见 loadAppConfig）。
  return deepMerge(baseConfig, envConfig);
};

export const loadAppConfig = (): AppConfig => {
  const yamlConfig = loadYamlConfig();
  const yamlOauth = (yamlConfig.lark?.oauth ?? {}) as Partial<
    Record<keyof LarkOauthConfig, string>
  >;
  const yamlJwt = (yamlConfig.auth?.jwt ?? {}) as Partial<
    Record<'secret' | 'expiresIn', string>
  >;

  return {
    app: {
      port: Number(process.env.PORT ?? yamlConfig.app?.port ?? 3000),
    },
    database: {
      url:
        process.env.DATABASE_URL ??
        process.env.POSTGRES_URI ??
        yamlConfig.database?.url ??
        yamlConfig.postgres?.uri ??
        'postgres://postgres:postgres@localhost:5432/postgres',
    },
    redis: {
      uri:
        process.env.REDIS_URI ??
        yamlConfig.redis?.uri ??
        'redis://localhost:6379/0',
    },
    lark: {
      ...yamlConfig.lark,
      appId: process.env.LARK_APP_ID ?? yamlConfig.lark?.appId,
      appSecret: process.env.LARK_APP_SECRET ?? yamlConfig.lark?.appSecret,
      oauth: {
        authorizeUrl:
          process.env.LARK_OAUTH_AUTHORIZE_URL ??
          yamlOauth.authorizeUrl ??
          'https://accounts.feishu.cn/open-apis/authen/v1/authorize',
        redirectUri:
          process.env.LARK_OAUTH_REDIRECT_URI ??
          yamlOauth.redirectUri ??
          'http://localhost:3000/auth/lark/callback',
        scope: process.env.LARK_OAUTH_SCOPE ?? yamlOauth.scope ?? '',
        webRedirectUrl:
          process.env.LARK_OAUTH_WEB_REDIRECT_URL ??
          yamlOauth.webRedirectUrl ??
          'http://localhost:3001/auth/callback',
      },
    },
    auth: {
      jwt: {
        // 生产环境务必通过 AUTH_JWT_SECRET 覆盖默认密钥。
        secret:
          process.env.AUTH_JWT_SECRET ??
          yamlJwt.secret ??
          'dingstock-performance-dev-secret',
        expiresIn: process.env.AUTH_JWT_EXPIRES_IN ?? yamlJwt.expiresIn ?? '7d',
      },
    },
  };
};

export default loadAppConfig;
