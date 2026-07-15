import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AiReportModule } from '../ai-report/ai-report.module';
import { AuthModule } from '../auth/auth.module';
import { CycleModule } from '../cycle/cycle.module';
import { ParticipantModule } from '../participant/participant.module';
import { RbacModule } from '../rbac/rbac.module';
import { SharedModule } from '../shared/shared.module';
import { EvaluationController } from './evaluation.controller';
import { EvaluationSubmissionService } from './evaluation-submission.service';
import { ManagerEvaluationSubmissionService } from './manager-evaluation-submission.service';
import { ManagerStageResultService } from './manager-stage-result.service';
import { LeaderTransferService } from './leader-transfer.service';
import { PeerEvaluationSubmissionService } from './peer-evaluation-submission.service';
import { PeerStageResultService } from './peer-stage-result.service';
import { ActiveCycleConfigChangeController } from './active-cycle-config-change.controller';
import { ActiveCycleConfigChangeService } from './active-cycle-config-change.service';

/**
 * 统一评估提交域（ADR-0009）：SELF/PEER/MANAGER 人工答卷统一落
 * PerfEvaluationSubmission。当前开放员工自评、360°评估与上级评估；写入门槛复用
 * CycleModule 的 EvaluationTaskAccessService，上级评估提交同步生成权威阶段结果。
 */
@Module({
  imports: [
    SharedModule,
    AuthModule,
    RbacModule,
    AuditModule,
    ParticipantModule,
    CycleModule,
    AiReportModule,
  ],
  controllers: [EvaluationController, ActiveCycleConfigChangeController],
  providers: [
    EvaluationSubmissionService,
    PeerEvaluationSubmissionService,
    PeerStageResultService,
    ManagerEvaluationSubmissionService,
    ManagerStageResultService,
    LeaderTransferService,
    ActiveCycleConfigChangeService,
  ],
  exports: [
    EvaluationSubmissionService,
    PeerEvaluationSubmissionService,
    PeerStageResultService,
    ManagerEvaluationSubmissionService,
    ManagerStageResultService,
  ],
})
export class EvaluationModule {}
