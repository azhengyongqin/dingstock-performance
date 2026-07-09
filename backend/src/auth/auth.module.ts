import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, type JwtSignOptions } from '@nestjs/jwt';
import { SharedModule } from '../shared/shared.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

@Module({
  imports: [
    SharedModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        // JWT 密钥与有效期统一走配置（app.yaml auth.jwt，可被环境变量覆盖）。
        secret: configService.getOrThrow<string>('auth.jwt.secret'),
        signOptions: {
          // 配置值形如 '7d'/'12h'，符合 jsonwebtoken 的 StringValue 约定。
          expiresIn: configService.getOrThrow<string>(
            'auth.jwt.expiresIn',
          ) as JwtSignOptions['expiresIn'],
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard],
  exports: [AuthService, JwtAuthGuard],
})
export class AuthModule {}
