import {
  Controller,
  Get,
  NotFoundException,
  Param,
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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PerfRole } from '../generated/prisma/enums';
import { Roles } from '../rbac/roles.decorator';
import { RolesGuard } from '../rbac/roles.guard';
import { ContactService } from './contact.service';
import { ContactSyncService } from './contact-sync.service';

// 登录后才能访问组织数据；同步类操作进一步限制 HR/ADMIN（研发文档 §11 技术债 #2）。
@ApiTags('通讯录')
@Controller('contact')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class ContactController {
  constructor(
    private readonly contactService: ContactService,
    private readonly contactSyncService: ContactSyncService,
  ) {}

  @Post('sync')
  @Roles(PerfRole.HR, PerfRole.ADMIN)
  @ApiOperation({ summary: '触发飞书组织架构全量同步（异步执行；HR/ADMIN）' })
  async triggerSync() {
    const status = await this.contactSyncService.triggerSync();
    return { ok: true, ...status };
  }

  @Get('sync/status')
  @ApiOperation({ summary: '查询同步任务状态' })
  getSyncStatus() {
    return this.contactSyncService.getStatus();
  }

  @Get('departments')
  @ApiOperation({ summary: '查询已同步的部门列表' })
  listDepartments() {
    return this.contactService.listDepartments();
  }

  @Get('users')
  @ApiOperation({ summary: '查询已同步的员工列表（可按部门过滤）' })
  @ApiQuery({
    name: 'department_id',
    required: false,
    description: '按所属部门（open_department_id）过滤',
  })
  listUsers(@Query('department_id') departmentId?: string) {
    return this.contactService.listUsers(departmentId);
  }

  @Get('users/:openId')
  @ApiOperation({ summary: '查询单个已同步员工的展示资料' })
  async getUserBrief(@Param('openId') openId: string) {
    const user = await this.contactService.findUserBrief(openId);
    if (!user) throw new NotFoundException('员工不存在或尚未同步');

    return user;
  }
}
