import { IsString, MinLength } from 'class-validator';

/** 开发环境快速登录入参：仅需选定员工的 open_id。 */
export class DevLoginDto {
  @IsString()
  @MinLength(1)
  open_id!: string;
}
