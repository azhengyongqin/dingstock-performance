import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { ContactController } from './contact.controller';
import { ContactService } from './contact.service';
import { ContactSyncService } from './contact-sync.service';

@Module({
  imports: [SharedModule, AuthModule, RbacModule],
  controllers: [ContactController],
  providers: [ContactService, ContactSyncService],
  exports: [ContactService],
})
export class ContactModule {}
