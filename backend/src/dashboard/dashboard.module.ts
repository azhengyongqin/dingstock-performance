import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/** 看板统计 + 个人档案 + 工作台待办（研发文档 §8.1 Dashboard 域） */
@Module({
  imports: [SharedModule, AuthModule, RbacModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
