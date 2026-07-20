import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import type {
  FormSnapshotContent,
  FormSnapshotField,
} from '../evaluation/evaluation.service-types';
import type { Prisma } from '../generated/prisma/client';
import {
  PerfCycleStatus,
  PerfEvaluationTaskType,
  PerfParticipantStatus,
  PerfRatingSymbol,
  PerfRedLineAction,
  PerfReviewStatus,
} from '../generated/prisma/enums';
import { NotificationEventService } from '../notification/notification-event.service';
import { PrismaService } from '../shared/database/prisma.service';

type SnapshotSubmission = {
  stage: PerfEvaluationTaskType;
  dimensionAnswers: Array<{
    subformKey: string;
    dimensionKey: string;
    fields: Array<{
      fieldKey: string;
      fieldType: string;
      value: Prisma.JsonValue;
    }>;
  }>;
};

type VisibleFieldAnswer = {
  subformKey: string;
  dimensionKey: string;
  fieldKey: string;
  title: string;
  type: string;
  value: Prisma.JsonValue;
};

type ResultSnapshot = {
  cycle: { id: number; name: string };
  manager: {
    compositeScore: string | null;
    level: PerfRatingSymbol | null;
    dimensions: Array<{
      dimensionKey: string;
      name: string;
      score: string;
      level: PerfRatingSymbol;
    }>;
    fields: VisibleFieldAnswer[];
  };
  self: { level: PerfRatingSymbol | null; fields: VisibleFieldAnswer[] };
  /** 新发布固定为空；旧结果版本中的员工可见晋升投影按原值只读返回。 */
  promotion: Prisma.JsonValue | null;
};

/**
 * Ticket 14 结果版本边界：发布时冻结员工可见快照，查询只读取该快照，
 * 确认必须精确绑定员工当前看到的版本。
 */
@Injectable()
export class ResultService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationEventService: NotificationEventService,
  ) {}

  private static readonly VISIBLE_STATUSES: PerfParticipantStatus[] = [
    PerfParticipantStatus.RESULT_PUBLISHED,
    PerfParticipantStatus.CONFIRMED,
    PerfParticipantStatus.APPEALING,
    PerfParticipantStatus.RE_CONFIRMING,
  ];

  /**
   * 发布一个周期内已显式校准的员工结果。参与者行锁串行化版本号；
   * 同等级后续决定只保留校准审计，不生成新版本或重开确认。
   */
  async publishCycle(
    operatorOpenId: string,
    cycleId: number,
    participantIds?: number[],
  ) {
    const candidates = await this.prisma.perfParticipant.findMany({
      where: {
        cycleId,
        status: {
          in: [
            PerfParticipantStatus.CALIBRATED,
            PerfParticipantStatus.RESULT_PUBLISHED,
            PerfParticipantStatus.CONFIRMED,
          ],
        },
        calibrations: { some: { invalidatedAt: null } },
        ...(participantIds?.length ? { id: { in: participantIds } } : {}),
      },
      select: { id: true },
    });
    if (candidates.length === 0) {
      throw new BadRequestException('没有可发布的参与者（需存在显式校准决定）');
    }

    let published = 0;
    let unchanged = 0;
    for (const candidate of candidates) {
      const outcome = await this.prisma.$transaction(async (tx) => {
        await this.lockResultAggregate(tx, candidate.id);
        const participant = await this.loadPublicationState(tx, candidate.id);
        if (!participant || participant.cycleId !== cycleId) return 'skipped';
        if (participant.cycle.status !== PerfCycleStatus.ACTIVE) {
          throw new ConflictException('只有进行中的周期可以发布结果');
        }
        const calibration = participant.calibrations[0];
        if (!calibration) {
          throw new ConflictException('缺少显式校准决定，不能发布结果');
        }
        const finalLevel = participant.redLineFindings.length
          ? PerfRatingSymbol.C
          : this.requireRatingSymbol(calibration.afterLevel);
        const currentVersion = await tx.perfResultVersion.findFirst({
          where: {
            participantId: participant.id,
            supersededAt: null,
            invalidatedAt: null,
          },
          orderBy: { version: 'desc' },
        });
        if (currentVersion?.finalLevel === finalLevel) return 'unchanged';
        const latestHistoricalVersion =
          currentVersion ??
          (await tx.perfResultVersion.findFirst({
            where: { participantId: participant.id },
            orderBy: { version: 'desc' },
          }));

        const publishedAt = new Date();
        if (currentVersion) {
          const superseded = await tx.perfResultVersion.updateMany({
            where: {
              id: currentVersion.id,
              supersededAt: null,
              invalidatedAt: null,
            },
            data: { supersededAt: publishedAt },
          });
          if (superseded.count !== 1) {
            throw new ConflictException('结果版本已变化，请刷新后重试');
          }
        }
        // 周期退回后当前有效版本为空，但版本号必须继续沿历史链递增，不能与失效版本冲突。
        const version = (latestHistoricalVersion?.version ?? 0) + 1;
        const snapshot = this.buildResultSnapshot(participant);
        const resultVersion = await tx.perfResultVersion.create({
          data: {
            participantId: participant.id,
            version,
            finalLevel,
            employeeExplanation: this.employeeExplanation(
              participant.cycle.currentConfigVersion?.ratings,
              finalLevel,
            ),
            sourceCalibrationId: calibration.id,
            resultSnapshot: snapshot,
            publishedByOpenId: operatorOpenId,
            publishedAt,
          },
        });

        await tx.perfParticipant.update({
          where: { id: participant.id },
          data: { status: PerfParticipantStatus.RESULT_PUBLISHED },
        });
        await this.notificationEventService.enqueueResultPublishedEvent(
          {
            cycleId,
            cycleName: participant.cycle.name,
            participantId: participant.id,
            resultVersionId: resultVersion.id,
            version,
            receiverOpenId: participant.employeeOpenId,
          },
          tx,
        );
        return 'published';
      });
      if (outcome === 'published') published += 1;
      if (outcome === 'unchanged') unchanged += 1;
    }

    await this.auditService.record({
      operatorOpenId,
      action: 'result.publish',
      targetType: 'perf_cycle',
      targetId: String(cycleId),
      after: { published, unchanged },
    });
    return { published, unchanged };
  }

  /** 我的当前结果：结果发布前不返回参与人或评分，避免侧信道泄露。 */
  async getCurrent(employeeOpenId: string, cycleId?: number) {
    const participant = await this.prisma.perfParticipant.findFirst({
      where: {
        employeeOpenId,
        cycle: { deletedAt: null },
        ...(cycleId ? { cycleId } : {}),
        status: { in: ResultService.VISIBLE_STATUSES },
      },
      orderBy: { id: 'desc' },
      include: {
        cycle: { select: { id: true, name: true, status: true } },
        resultVersions: {
          where: { invalidatedAt: null },
          orderBy: { version: 'desc' },
          take: 2,
          select: {
            id: true,
            version: true,
            finalLevel: true,
            employeeExplanation: true,
            resultSnapshot: true,
            supersededAt: true,
            publishedAt: true,
            confirmedAt: true,
          },
        },
      },
    });
    const current = participant?.resultVersions[0] ?? null;
    if (!participant || !current || current.supersededAt) {
      return { participant: null, result: null };
    }
    const previous = participant.resultVersions[1] ?? null;
    // 即使历史数据快照异常，也只允许白名单字段穿过员工 API 安全边界。
    const result = {
      id: current.id,
      version: current.version,
      finalLevel: current.finalLevel,
      previousFinalLevel: previous?.finalLevel ?? null,
      employeeExplanation: current.employeeExplanation,
      resultSnapshot: this.sanitizeResultSnapshot(current.resultSnapshot),
      publishedAt: current.publishedAt,
      confirmedAt: current.confirmedAt,
    };
    return {
      participant: {
        id: participant.id,
        status: participant.status,
        cycle: participant.cycle,
      },
      result,
    };
  }

  /**
   * 在申诉聚合事务内比较被申诉版本与最新校准决定：同级只恢复原版本确认链，
   * 可见等级变化才追加新版本、替代旧版本并发送再次确认通知。
   */
  async resolveAppeal(
    input: {
      appealId: number;
      participantId: number;
      appealedResultVersionId: number;
      expectedCalibrationRevision: number;
      operatorOpenId: string;
    },
    tx: Prisma.TransactionClient,
  ) {
    const participant = await this.loadPublicationState(
      tx,
      input.participantId,
    );
    if (!participant) throw new NotFoundException('参与者不存在');
    if (participant.cycle.status !== PerfCycleStatus.ACTIVE) {
      throw new ConflictException('只有进行中的周期可以处理申诉');
    }
    if (participant.status !== PerfParticipantStatus.APPEALING) {
      throw new ConflictException('参与者当前不在申诉处理中');
    }
    const calibration = participant.calibrations[0];
    if (!calibration) {
      throw new ConflictException('缺少显式校准决定，不能处理申诉');
    }
    if (calibration.id !== input.expectedCalibrationRevision) {
      throw new ConflictException({
        code: 'CALIBRATION_REVISION_STALE',
        message: '校准决定已变化，请刷新申诉处理页后重试',
      });
    }
    const currentVersion = await tx.perfResultVersion.findFirst({
      where: {
        participantId: input.participantId,
        supersededAt: null,
        invalidatedAt: null,
      },
      orderBy: { version: 'desc' },
    });
    if (
      !currentVersion ||
      currentVersion.id !== input.appealedResultVersionId
    ) {
      throw new ConflictException({
        code: 'APPEAL_RESULT_VERSION_STALE',
        message: '申诉绑定的结果版本已变化，请刷新后重试',
      });
    }

    const finalLevel = participant.redLineFindings.length
      ? PerfRatingSymbol.C
      : this.requireRatingSymbol(calibration.afterLevel);
    if (currentVersion.finalLevel === finalLevel) {
      // 原版本从未被确认，维持结论后继续沿用原确认入口，不新建任务或通知。
      await tx.perfParticipant.update({
        where: { id: input.participantId },
        data: { status: PerfParticipantStatus.RESULT_PUBLISHED },
      });
      return {
        changed: false,
        resultVersionId: currentVersion.id,
        resolutionCalibrationId: calibration.id,
      };
    }
    if (calibration.id === currentVersion.sourceCalibrationId) {
      throw new ConflictException({
        code: 'APPEAL_ADJUSTMENT_REQUIRES_NEW_CALIBRATION',
        message: '员工可见等级变化必须先基于申诉追加新的显式校准决定',
      });
    }

    const publishedAt = new Date();
    const superseded = await tx.perfResultVersion.updateMany({
      where: { id: currentVersion.id, supersededAt: null },
      data: { supersededAt: publishedAt },
    });
    if (superseded.count !== 1) {
      throw new ConflictException('结果版本已变化，请刷新后重试');
    }
    const snapshot = this.buildResultSnapshot(participant);
    const version = currentVersion.version + 1;
    const resultVersion = await tx.perfResultVersion.create({
      data: {
        participantId: input.participantId,
        version,
        finalLevel,
        employeeExplanation: this.employeeExplanation(
          participant.cycle.currentConfigVersion?.ratings,
          finalLevel,
        ),
        sourceCalibrationId: calibration.id,
        resultSnapshot: snapshot,
        publishedByOpenId: input.operatorOpenId,
        publishedAt,
      },
    });
    await tx.perfParticipant.update({
      where: { id: input.participantId },
      data: { status: PerfParticipantStatus.RE_CONFIRMING },
    });
    await this.notificationEventService.enqueueResultPublishedEvent(
      {
        cycleId: participant.cycleId,
        cycleName: participant.cycle.name,
        participantId: input.participantId,
        resultVersionId: resultVersion.id,
        version,
        receiverOpenId: participant.employeeOpenId,
        previousFinalLevel: currentVersion.finalLevel,
        isReconfirmation: true,
        appealId: input.appealId,
      },
      tx,
    );
    return {
      changed: true,
      resultVersionId: resultVersion.id,
      resolutionCalibrationId: calibration.id,
    };
  }

  /** 员工确认结果；participantId 与 resultVersionId 共同防止确认过期页面。 */
  async confirm(
    employeeOpenId: string,
    participantId: number,
    resultVersionId: number,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockResultAggregate(tx, participantId);
      const participant = await tx.perfParticipant.findUnique({
        where: { id: participantId },
        include: {
          cycle: { select: { status: true } },
          resultVersions: {
            where: { supersededAt: null, invalidatedAt: null },
            orderBy: { version: 'desc' },
            take: 1,
            select: { id: true, version: true },
          },
        },
      });
      if (!participant || participant.employeeOpenId !== employeeOpenId) {
        throw new NotFoundException('结果尚未发布');
      }
      if (participant.cycle.status !== PerfCycleStatus.ACTIVE) {
        throw new ConflictException('周期已归档或暂停，不能确认结果');
      }
      if (
        participant.status !== PerfParticipantStatus.RESULT_PUBLISHED &&
        participant.status !== PerfParticipantStatus.RE_CONFIRMING
      ) {
        throw new ConflictException('当前状态不允许确认结果');
      }
      if (participant.resultVersions[0]?.id !== resultVersionId) {
        throw new ConflictException({
          code: 'RESULT_VERSION_STALE',
          message: '结果版本已更新，请刷新后确认最新结果',
        });
      }
      const confirmedAt = new Date();
      const updated = await tx.perfResultVersion.updateMany({
        where: {
          id: resultVersionId,
          participantId,
          supersededAt: null,
          invalidatedAt: null,
          confirmedAt: null,
        },
        data: { confirmedAt, confirmedByOpenId: employeeOpenId },
      });
      if (updated.count !== 1) {
        throw new ConflictException('该结果版本已确认或已失效');
      }
      await tx.perfParticipant.update({
        where: { id: participantId },
        data: { status: PerfParticipantStatus.CONFIRMED },
      });
    });
    await this.auditService.record({
      operatorOpenId: employeeOpenId,
      action: 'result.confirm',
      targetType: 'perf_result_version',
      targetId: String(resultVersionId),
      after: { participantId },
    });
    return { ok: true, resultVersionId };
  }

  private async lockResultAggregate(
    tx: Prisma.TransactionClient,
    participantId: number,
  ) {
    const cycles = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT cycle."id"
      FROM "performance"."perf_cycles" AS cycle
      JOIN "performance"."perf_participants" AS participant
        ON participant."cycle_id" = cycle."id"
      WHERE participant."id" = ${participantId}
      FOR UPDATE OF cycle
    `;
    if (cycles.length !== 1) throw new NotFoundException('参与者不存在');
    const participants = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "performance"."perf_participants"
      WHERE "id" = ${participantId}
      FOR UPDATE
    `;
    if (participants.length !== 1) throw new NotFoundException('参与者不存在');
    await tx.$queryRaw<Array<{ id: number }>>`
      SELECT "id" FROM "performance"."perf_result_versions"
      WHERE "participant_id" = ${participantId}
      ORDER BY "version" DESC
      FOR UPDATE
    `;
  }

  private loadPublicationState(
    tx: Prisma.TransactionClient,
    participantId: number,
  ) {
    return tx.perfParticipant.findUnique({
      where: { id: participantId },
      include: {
        cycle: {
          include: {
            currentConfigVersion: { select: { ratings: true } },
          },
        },
        calibrations: {
          where: { invalidatedAt: null },
          orderBy: { id: 'desc' },
          take: 1,
        },
        redLineFindings: {
          where: {
            action: PerfRedLineAction.CONFIRM,
            revokedBy: { none: {} },
          },
          select: { id: true },
          take: 1,
        },
        stageResults: {
          where: {
            stage: {
              in: [PerfEvaluationTaskType.SELF, PerfEvaluationTaskType.MANAGER],
            },
            status: 'READY',
          },
          include: { dimensions: { orderBy: { id: 'asc' } } },
        },
        evaluationSubmissions: {
          where: {
            stage: {
              in: [PerfEvaluationTaskType.SELF, PerfEvaluationTaskType.MANAGER],
            },
            status: PerfReviewStatus.SUBMITTED,
          },
          include: {
            dimensionAnswers: {
              orderBy: { id: 'asc' },
              include: { fields: { orderBy: { id: 'asc' } } },
            },
          },
        },
        formSnapshot: { select: { content: true } },
      },
    });
  }

  private buildResultSnapshot(
    participant: NonNullable<
      Awaited<ReturnType<ResultService['loadPublicationState']>>
    >,
  ): ResultSnapshot {
    const managerStage = participant.stageResults.find(
      (item) =>
        item.stage === PerfEvaluationTaskType.MANAGER &&
        (!participant.cycle.currentConfigVersionId ||
          item.cycleConfigVersionId ===
            participant.cycle.currentConfigVersionId),
    );
    const selfStage = participant.stageResults.find(
      (item) =>
        item.stage === PerfEvaluationTaskType.SELF &&
        (!participant.cycle.currentConfigVersionId ||
          item.cycleConfigVersionId ===
            participant.cycle.currentConfigVersionId),
    );
    const managerSubmission = participant.evaluationSubmissions.find(
      (item) => item.stage === PerfEvaluationTaskType.MANAGER,
    ) as SnapshotSubmission | undefined;
    const selfSubmission = participant.evaluationSubmissions.find(
      (item) => item.stage === PerfEvaluationTaskType.SELF,
    ) as SnapshotSubmission | undefined;
    const content = participant.formSnapshot
      ?.content as unknown as FormSnapshotContent | null;
    return {
      cycle: { id: participant.cycle.id, name: participant.cycle.name },
      manager: {
        compositeScore: managerStage?.compositeScore?.toString() ?? null,
        level: managerStage?.stageLevel ?? null,
        dimensions: (managerStage?.dimensions ?? []).map((dimension) => ({
          dimensionKey: dimension.dimensionKey,
          name: dimension.name,
          score: dimension.score.toString(),
          level: dimension.level,
        })),
        fields: this.visibleFieldAnswers(
          managerSubmission?.dimensionAnswers ?? [],
          content,
        ),
      },
      self: {
        level: selfStage?.stageLevel ?? null,
        fields: this.visibleFieldAnswers(
          selfSubmission?.dimensionAnswers ?? [],
          content,
        ),
      },
      // 晋升已退出新绩效结果发布链，旧内容由独立的只读边界承载。
      promotion: null,
    };
  }

  /** 发布快照只投影新版字段作答，字段身份与所属维度均可追溯。 */
  private visibleFieldAnswers(
    dimensions: SnapshotSubmission['dimensionAnswers'],
    content: FormSnapshotContent | null,
  ): VisibleFieldAnswer[] {
    return dimensions.flatMap((dimension) =>
      dimension.fields.map((answer) => {
        const metadata = this.findField(content, answer.fieldKey);
        return {
          subformKey: dimension.subformKey,
          dimensionKey: dimension.dimensionKey,
          fieldKey: answer.fieldKey,
          title: metadata?.title ?? answer.fieldKey,
          type: answer.fieldType,
          value: answer.value,
        };
      }),
    );
  }

  private sanitizeResultSnapshot(value: Prisma.JsonValue): ResultSnapshot {
    const root = this.jsonObject(value);
    const cycle = this.jsonObject(root.cycle);
    const manager = this.jsonObject(root.manager);
    const self = this.jsonObject(root.self);
    return {
      cycle: {
        id: typeof cycle.id === 'number' ? cycle.id : 0,
        name: typeof cycle.name === 'string' ? cycle.name : '',
      },
      manager: {
        compositeScore: this.stringOrNull(manager.compositeScore),
        level: this.ratingOrNull(manager.level),
        dimensions: Array.isArray(manager.dimensions)
          ? manager.dimensions.flatMap((item) => {
              const dimension = this.jsonObject(item);
              const level = this.ratingOrNull(dimension.level);
              if (!level) return [];
              return [
                {
                  dimensionKey: this.stringOrEmpty(dimension.dimensionKey),
                  name: this.stringOrEmpty(dimension.name),
                  score: this.stringOrEmpty(dimension.score),
                  level,
                },
              ];
            })
          : [],
        fields: this.sanitizeVisibleFields(manager.fields),
      },
      self: {
        level: this.ratingOrNull(self.level),
        fields: this.sanitizeVisibleFields(self.fields),
      },
      // 旧结果版本一经发布不可变；历史晋升投影属于当时员工可见内容，不能在查询时抹除。
      promotion: root.promotion ?? null,
    };
  }

  private sanitizeVisibleFields(value: Prisma.JsonValue | undefined) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
      const answer = this.jsonObject(item);
      return {
        subformKey: this.stringOrEmpty(answer.subformKey),
        dimensionKey: this.stringOrEmpty(answer.dimensionKey),
        fieldKey: this.stringOrEmpty(answer.fieldKey),
        title: this.stringOrEmpty(answer.title),
        type: this.stringOrEmpty(answer.type),
        value: answer.value ?? '',
      };
    });
  }

  private jsonObject(value: Prisma.JsonValue | undefined) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : {};
  }

  private stringOrEmpty(value: Prisma.JsonValue | undefined) {
    return typeof value === 'string' ? value : '';
  }

  private stringOrNull(value: Prisma.JsonValue | undefined) {
    return typeof value === 'string' ? value : null;
  }

  private ratingOrNull(value: Prisma.JsonValue | undefined) {
    return value === PerfRatingSymbol.S ||
      value === PerfRatingSymbol.A ||
      value === PerfRatingSymbol.B ||
      value === PerfRatingSymbol.C
      ? value
      : null;
  }

  private findField(
    content: FormSnapshotContent | null,
    fieldKey: string,
  ): FormSnapshotField | undefined {
    return content?.subforms
      .flatMap((subform) => subform.dimensions)
      .flatMap((dimension) => dimension.fields ?? [])
      .find((field) => field.key === fieldKey);
  }

  private employeeExplanation(
    value: Prisma.JsonValue | undefined,
    level: PerfRatingSymbol,
  ) {
    if (!Array.isArray(value)) return `绩效等级 ${level}`;
    const rating = value.find(
      (item) =>
        item !== null &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        item.symbol === level,
    ) as Record<string, Prisma.JsonValue> | undefined;
    const explanation = rating?.description ?? rating?.remark ?? rating?.name;
    return typeof explanation === 'string' && explanation.trim()
      ? explanation.trim()
      : `绩效等级 ${level}`;
  }

  private requireRatingSymbol(value: string) {
    if (
      value !== PerfRatingSymbol.S &&
      value !== PerfRatingSymbol.A &&
      value !== PerfRatingSymbol.B &&
      value !== PerfRatingSymbol.C
    ) {
      throw new ConflictException('校准决定包含无效等级，不能发布结果');
    }
    return value;
  }
}
