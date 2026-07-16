import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PerfNotificationStatus, PerfRole } from '../generated/prisma/enums';
import { Roles } from '../rbac/roles.decorator';
import { RolesGuard } from '../rbac/roles.guard';
import { NotificationService } from './notification.service';

class RemindDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  receiverOpenIds!: string[];

  @IsString()
  template!: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

@ApiTags('通知')
@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(PerfRole.HR, PerfRole.ADMIN)
@ApiBearerAuth()
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: '通知发送记录（HR）' })
  @ApiQuery({ name: 'receiver', required: false })
  @ApiQuery({ name: 'status', required: false, enum: PerfNotificationStatus })
  list(
    @Query('receiver') receiver?: string,
    @Query('status') status?: PerfNotificationStatus,
  ) {
    return this.notificationService.list({ receiverOpenId: receiver, status });
  }

  @Post('remind')
  @ApiOperation({ summary: '手动催办：按模板给一批人发送提醒' })
  remind(@Body() dto: RemindDto) {
    return this.notificationService.remind(
      dto.receiverOpenIds,
      dto.template,
      dto.payload ?? {},
    );
  }

  @Post(':id/resend')
  @ApiOperation({ summary: '补发失败通知' })
  resend(@Param('id', ParseIntPipe) id: number) {
    return this.notificationService.resend(id);
  }
}
