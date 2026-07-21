import { IsOptional, IsString, Length, MinLength } from 'class-validator';

/** GET 员工列表使用的 Header DTO，避免密码头绕过全局 ValidationPipe。 */
export class DevLoginHeadersDto {
  @IsOptional()
  @IsString()
  @Length(32, 32)
  'x-dev-login-password'?: string;
}

/** 开发快速登录入参：生产开启时 password 必须与服务端 32 位配置一致。 */
export class DevLoginDto {
  @IsString()
  @MinLength(1)
  open_id!: string;

  @IsOptional()
  @IsString()
  @Length(32, 32)
  password?: string;
}
