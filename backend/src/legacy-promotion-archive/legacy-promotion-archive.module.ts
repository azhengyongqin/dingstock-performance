import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { LegacyPromotionArchiveController } from './legacy-promotion-archive.controller';
import { LegacyPromotionArchiveService } from './legacy-promotion-archive.service';

/** 旧晋升内容的独立只读边界，不向新绩效提交与计算链导出能力。 */
@Module({
  imports: [SharedModule, AuthModule, RbacModule],
  controllers: [LegacyPromotionArchiveController],
  providers: [LegacyPromotionArchiveService],
})
export class LegacyPromotionArchiveModule {}
