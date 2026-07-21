import {
  mkdtempSync,
  realpathSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAppConfig, resolveConfigPath } from './configuration';

describe('configuration loader', () => {
  const originalCwd = process.cwd();
  const originalEnv = { ...process.env };
  let tempDir: string;

  beforeEach(() => {
    tempDir = realpathSync(mkdtempSync(join(tmpdir(), 'dingstock-config-')));
    mkdirSync(join(tempDir, 'config'));
    process.chdir(tempDir);
    process.env = { ...originalEnv };
    delete process.env.NODE_ENV;
    delete process.env.APP_CONFIG_FILE;
    delete process.env.CONFIG_FILE;
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URI;
    delete process.env.LARK_NOTIFICATION_ENABLED;
    delete process.env.AUTH_DEFAULT_ADMIN_OPEN_ID;
    delete process.env.AUTH_DEV_LOGIN_ENABLED;
    delete process.env.AUTH_DEV_LOGIN_PASSWORD;
    delete process.env.AI_REPORT_ENABLED;
    delete process.env.AI_REPORT_ENDPOINT;
    delete process.env.AI_REPORT_API_KEY;
    delete process.env.AI_REPORT_MODEL;
    delete process.env.AI_REPORT_TIMEOUT_MS;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env = { ...originalEnv };
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads dev.yaml by default', () => {
    writeFileSync(
      join(tempDir, 'config', 'dev.yaml'),
      'database:\n  url: postgres://dev:dev@localhost:5432/dev\n',
    );

    expect(resolveConfigPath()).toBe(join(tempDir, 'config', 'dev.yaml'));
    expect(loadAppConfig().database.url).toBe(
      'postgres://dev:dev@localhost:5432/dev',
    );
  });

  it('loads prod.yaml when NODE_ENV is production', () => {
    process.env.NODE_ENV = 'production';
    writeFileSync(
      join(tempDir, 'config', 'prod.yaml'),
      'database:\n  url: postgres://prod:prod@localhost:5432/prod\n',
    );

    expect(resolveConfigPath()).toBe(join(tempDir, 'config', 'prod.yaml'));
    expect(loadAppConfig().database.url).toBe(
      'postgres://prod:prod@localhost:5432/prod',
    );
  });

  it('merges app.yaml base layer with environment yaml overrides', () => {
    // app.yaml 提供公共基础层（含 lark.oauth）；dev.yaml 只覆盖 appId。
    writeFileSync(
      join(tempDir, 'config', 'app.yaml'),
      [
        'lark:',
        '  appId: base-app-id',
        '  oauth:',
        '    redirectUri: http://localhost:3000/auth/lark/callback',
        '    webRedirectUrl: http://localhost:3001/auth/callback',
        'auth:',
        '  jwt:',
        '    secret: base-secret',
      ].join('\n'),
    );
    writeFileSync(
      join(tempDir, 'config', 'dev.yaml'),
      'lark:\n  appId: dev-app-id\n',
    );

    const config = loadAppConfig();
    // 环境层覆盖基础层的同名叶子值
    expect(config.lark.appId).toBe('dev-app-id');
    // 环境层未声明的嵌套段沿用基础层
    expect(config.lark.oauth.redirectUri).toBe(
      'http://localhost:3000/auth/lark/callback',
    );
    expect(config.lark.oauth.webRedirectUrl).toBe(
      'http://localhost:3001/auth/callback',
    );
    expect(config.auth.jwt.secret).toBe('base-secret');
  });

  describe('lark notification send switch', () => {
    it('defaults to disabled outside production', () => {
      // 非生产（dev/test）缺省不外发飞书通知
      expect(loadAppConfig().lark.notification.enabled).toBe(false);
    });

    it('defaults to enabled in production', () => {
      process.env.NODE_ENV = 'production';
      expect(loadAppConfig().lark.notification.enabled).toBe(true);
    });

    it('yaml overrides the environment default', () => {
      writeFileSync(
        join(tempDir, 'config', 'dev.yaml'),
        'lark:\n  notification:\n    enabled: true\n',
      );
      expect(loadAppConfig().lark.notification.enabled).toBe(true);
    });

    it('environment variable overrides yaml', () => {
      process.env.LARK_NOTIFICATION_ENABLED = 'false';
      writeFileSync(
        join(tempDir, 'config', 'dev.yaml'),
        'lark:\n  notification:\n    enabled: true\n',
      );
      expect(loadAppConfig().lark.notification.enabled).toBe(false);
    });
  });

  describe('production dev login password', () => {
    const password = '0123456789abcdef0123456789abcdef';

    it('rejects production devLogin when the 32-character password is missing', () => {
      process.env.NODE_ENV = 'production';
      writeFileSync(
        join(tempDir, 'config', 'prod.yaml'),
        'auth:\n  devLogin:\n    enabled: true\n',
      );

      expect(() => loadAppConfig()).toThrow('必须配置恰好 32 位密码');
    });

    it('rejects a production devLogin password that is not exactly 32 characters', () => {
      process.env.NODE_ENV = 'production';
      writeFileSync(
        join(tempDir, 'config', 'prod.yaml'),
        "auth:\n  devLogin:\n    enabled: true\n    password: 'short-password'\n",
      );

      expect(() => loadAppConfig()).toThrow('必须配置恰好 32 位密码');
    });

    it('loads a 32-character password from yaml', () => {
      process.env.NODE_ENV = 'production';
      writeFileSync(
        join(tempDir, 'config', 'prod.yaml'),
        `auth:\n  devLogin:\n    enabled: true\n    password: '${password}'\n`,
      );

      expect(loadAppConfig().auth.devLogin).toEqual({
        enabled: true,
        password,
      });
    });

    it('allows the environment password to override yaml', () => {
      process.env.NODE_ENV = 'production';
      process.env.AUTH_DEV_LOGIN_PASSWORD = password;
      writeFileSync(
        join(tempDir, 'config', 'prod.yaml'),
        "auth:\n  devLogin:\n    enabled: true\n    password: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'\n",
      );

      expect(loadAppConfig().auth.devLogin.password).toBe(password);
    });
  });

  describe('default administrator', () => {
    it('loads the default administrator open_id from yaml', () => {
      writeFileSync(
        join(tempDir, 'config', 'app.yaml'),
        'auth:\n  defaultAdminOpenId: ou_yaml_admin\n',
      );

      expect(loadAppConfig().auth.defaultAdminOpenId).toBe('ou_yaml_admin');
    });

    it('allows environment variable to override yaml', () => {
      process.env.AUTH_DEFAULT_ADMIN_OPEN_ID = 'ou_env_admin';
      writeFileSync(
        join(tempDir, 'config', 'app.yaml'),
        'auth:\n  defaultAdminOpenId: ou_yaml_admin\n',
      );

      expect(loadAppConfig().auth.defaultAdminOpenId).toBe('ou_env_admin');
    });
  });

  describe('AI report gateway', () => {
    it('defaults to disabled so missing AI service never blocks the workflow', () => {
      expect(loadAppConfig().aiReport).toMatchObject({
        enabled: false,
        endpoint: '',
        timeoutMs: 30_000,
      });
    });

    it('environment variables enable and configure the production worker', () => {
      process.env.AI_REPORT_ENABLED = 'true';
      process.env.AI_REPORT_ENDPOINT = 'https://ai.internal.example/report';
      process.env.AI_REPORT_API_KEY = 'secret';
      process.env.AI_REPORT_MODEL = 'performance-review';
      process.env.AI_REPORT_TIMEOUT_MS = '45000';

      expect(loadAppConfig().aiReport).toEqual({
        enabled: true,
        endpoint: 'https://ai.internal.example/report',
        apiKey: 'secret',
        model: 'performance-review',
        timeoutMs: 45_000,
      });
    });
  });

  it('prefers explicit config file and environment database url', () => {
    process.env.NODE_ENV = 'production';
    process.env.APP_CONFIG_FILE = 'custom.yaml';
    process.env.DATABASE_URL = 'postgres://env:env@localhost:5432/env_database';
    writeFileSync(
      join(tempDir, 'config', 'custom.yaml'),
      'database:\n  url: postgres://custom:custom@localhost:5432/custom\n',
    );

    expect(resolveConfigPath()).toBe(join(tempDir, 'config', 'custom.yaml'));
    expect(loadAppConfig().database.url).toBe(
      'postgres://env:env@localhost:5432/env_database',
    );
  });
});
