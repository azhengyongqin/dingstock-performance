import Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port(),
  DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }),
  POSTGRES_URI: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }),
  REDIS_URI: Joi.string().uri({ scheme: ['redis', 'rediss'] }),
  APP_CONFIG_FILE: Joi.string(),
  CONFIG_FILE: Joi.string(),
  LARK_APP_ID: Joi.string(),
  LARK_APP_SECRET: Joi.string(),
  LARK_BASE_TOKEN: Joi.string(),
  // 飞书 OAuth2 登录相关环境变量（均可选，默认走 config/app.yaml）
  LARK_OAUTH_AUTHORIZE_URL: Joi.string().uri({ scheme: ['https'] }),
  LARK_OAUTH_REDIRECT_URI: Joi.string().uri({ scheme: ['http', 'https'] }),
  LARK_OAUTH_SCOPE: Joi.string().allow(''),
  LARK_OAUTH_WEB_REDIRECT_URL: Joi.string().uri({
    scheme: ['http', 'https'],
  }),
  // 飞书通知发送开关（可选）：'1'/'true'/'yes'/'on' 开启，其余关闭；缺省时生产默认开启、非生产默认关闭。
  LARK_NOTIFICATION_ENABLED: Joi.string(),
  AUTH_JWT_SECRET: Joi.string(),
  AUTH_JWT_EXPIRES_IN: Joi.string(),
  // 默认管理员飞书 open_id；可在部署环境覆盖 YAML。
  AUTH_DEFAULT_ADMIN_OPEN_ID: Joi.string().pattern(/^ou_[A-Za-z0-9]+$/),
  // 开发环境快速登录开关（可选）：'1'/'true'/'yes'/'on' 开启，其余关闭；缺省时非生产默认开启。
  AUTH_DEV_LOGIN_ENABLED: Joi.string(),
  // AI 报告通过可配置的内部 HTTP 网关生成；密钥只允许环境变量注入。
  AI_REPORT_ENABLED: Joi.string(),
  AI_REPORT_ENDPOINT: Joi.string().uri({ scheme: ['http', 'https'] }),
  AI_REPORT_API_KEY: Joi.string(),
  AI_REPORT_MODEL: Joi.string(),
  AI_REPORT_TIMEOUT_MS: Joi.number().integer().min(1000).max(300000),
});
