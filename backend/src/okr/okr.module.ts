import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { OkrController } from './okr.controller';
import { OkrSyncService } from './okr-sync.service';

@Module({
  imports: [SharedModule, AuthModule, RbacModule],
  controllers: [OkrController],
  providers: [OkrSyncService],
})
export class OkrModule {}
