import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SharedModule } from '../shared/shared.module';
import { CutoverMonitoringController } from './cutover-monitoring.controller';
import { CutoverMonitoringService } from './cutover-monitoring.service';
import { PerformanceCutoverGuard } from './performance-cutover.guard';

@Module({
  imports: [SharedModule],
  controllers: [CutoverMonitoringController],
  providers: [
    CutoverMonitoringService,
    { provide: APP_GUARD, useClass: PerformanceCutoverGuard },
  ],
  exports: [CutoverMonitoringService],
})
export class CutoverModule {}
