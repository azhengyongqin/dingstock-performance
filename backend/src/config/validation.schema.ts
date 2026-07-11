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
  AUTH_JWT_SECRET: Joi.string(),
  AUTH_JWT_EXPIRES_IN: Joi.string(),
  // 开发环境快速登录开关（可选）：'1'/'true'/'yes'/'on' 开启，其余关闭；缺省时非生产默认开启。
  AUTH_DEV_LOGIN_ENABLED: Joi.string(),
});
