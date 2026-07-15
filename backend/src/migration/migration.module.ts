import { Module } from '@nestjs/common';
import { SharedModule } from '../shared/shared.module';
import { LegacyMigrationService } from './legacy-migration.service';
import { LegacyMigrationLedgerService } from './legacy-migration-ledger.service';
import { LegacyMigrationReadinessService } from './legacy-migration-readiness.service';
import { LegacyStageRebuilder } from './legacy-stage-rebuilder';

@Module({
  imports: [SharedModule],
  providers: [
    LegacyMigrationService,
    LegacyMigrationLedgerService,
    LegacyMigrationReadinessService,
    LegacyStageRebuilder,
  ],
  exports: [LegacyMigrationService],
})
export class MigrationModule {}
