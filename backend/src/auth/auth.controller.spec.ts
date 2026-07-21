import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController 开发登录密码 Header', () => {
  let app: INestApplication<App>;
  const authService = {
    listDevUsers: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: authService }],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authService.listDevUsers.mockResolvedValue({ items: [], total: 0 });
  });

  afterAll(async () => {
    await app.close();
  });

  it('拒绝非 32 位的密码 Header，且不进入业务服务', async () => {
    await request(app.getHttpServer())
      .get('/auth/dev/users')
      .set('x-dev-login-password', 'short-password')
      .expect(400);

    expect(authService.listDevUsers).not.toHaveBeenCalled();
  });

  it('将合法的 32 位密码 Header 传给业务服务', async () => {
    const password = '0123456789abcdef0123456789abcdef';

    await request(app.getHttpServer())
      .get('/auth/dev/users')
      .set('x-dev-login-password', password)
      .expect(200)
      .expect({ items: [], total: 0 });

    expect(authService.listDevUsers).toHaveBeenCalledWith(password);
  });
});
