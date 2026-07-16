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
    notification?: {
      enabled?: boolean;
    };
  };
  auth?: {
    defaultAdminOpenId?: string;
    jwt?: Record<string, unknown>;
    devLogin?: {
      enabled?: boolean;
    };
  };
  aiReport?: {
    enabled?: boolean;
    endpoint?: string;
    apiKey?: string;
    model?: string;
    timeoutMs?: number;
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
    /** 飞书通知发送开关：关闭时通知只落库不外发 */
    notification: {
      enabled: boolean;
    };
  };
  auth: {
    /** 配置指定的默认管理员飞书 open_id；命中用户始终拥有 ADMIN。 */
    defaultAdminOpenId: string;
    jwt: {
      secret: string;
      expiresIn: string;
    };
    /** 开发环境快速登录（免飞书 OAuth 直接选人登录）：生产必须关闭 */
    devLogin: {
      enabled: boolean;
    };
  };
  /** AI 报告网关；关闭时任务保留等待态但绝不阻塞人工流程 */
  aiReport: {
    enabled: boolean;
    endpoint: string;
    apiKey: string;
    model: string;
    timeoutMs: number;
  };
};

// 解析布尔型环境变量：'1'/'true'/'yes'/'on'（大小写不敏感）视为 true，其余为 false。
const parseBoolEnv = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return undefined;

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
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

  // 飞书通知发送开关优先级：环境变量 > YAML > 默认（生产默认发送，非生产默认不发送）。
  const larkNotificationEnabled =
    parseBoolEnv(process.env.LARK_NOTIFICATION_ENABLED) ??
    yamlConfig.lark?.notification?.enabled ??
    process.env.NODE_ENV === 'production';

  // 开发登录开关优先级：环境变量 > YAML > 默认（非生产环境默认开启）。
  const devLoginEnabled =
    parseBoolEnv(process.env.AUTH_DEV_LOGIN_ENABLED) ??
    yamlConfig.auth?.devLogin?.enabled ??
    process.env.NODE_ENV !== 'production';

  const aiReportEnabled =
    parseBoolEnv(process.env.AI_REPORT_ENABLED) ??
    yamlConfig.aiReport?.enabled ??
    false;

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
      notification: {
        enabled: larkNotificationEnabled,
      },
    },
    auth: {
      defaultAdminOpenId:
        process.env.AUTH_DEFAULT_ADMIN_OPEN_ID ??
        yamlConfig.auth?.defaultAdminOpenId ??
        '',
      jwt: {
        // 生产环境务必通过 AUTH_JWT_SECRET 覆盖默认密钥。
        secret:
          process.env.AUTH_JWT_SECRET ??
          yamlJwt.secret ??
          'dingstock-performance-dev-secret',
        expiresIn: process.env.AUTH_JWT_EXPIRES_IN ?? yamlJwt.expiresIn ?? '7d',
      },
      devLogin: {
        enabled: devLoginEnabled,
      },
    },
    aiReport: {
      enabled: aiReportEnabled,
      endpoint:
        process.env.AI_REPORT_ENDPOINT ?? yamlConfig.aiReport?.endpoint ?? '',
      apiKey:
        process.env.AI_REPORT_API_KEY ?? yamlConfig.aiReport?.apiKey ?? '',
      model: process.env.AI_REPORT_MODEL ?? yamlConfig.aiReport?.model ?? '',
      timeoutMs: Number(
        process.env.AI_REPORT_TIMEOUT_MS ??
          yamlConfig.aiReport?.timeoutMs ??
          30_000,
      ),
    },
  };
};

export default loadAppConfig;
