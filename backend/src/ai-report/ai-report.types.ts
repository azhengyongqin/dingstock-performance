import type { Prisma } from '../generated/prisma/client';
import type { PerfRatingSymbol } from '../generated/prisma/enums';

export type AiReportDb = Pick<
  Prisma.TransactionClient,
  | '$queryRaw'
  | 'perfParticipant'
  | 'perfEvaluationSubmission'
  | 'perfStageResult'
  | 'perfAiReport'
>;

export type AiReportInput = {
  revision: string;
  snapshot: Prisma.InputJsonValue;
  digest: Prisma.InputJsonValue;
};

export type AiReportOutput = {
  referenceLevel: PerfRatingSymbol;
  summary: string;
  highlights?: Prisma.InputJsonValue | null;
  improvements?: Prisma.InputJsonValue | null;
  riskFlags?: Prisma.InputJsonValue | null;
};

/** 可替换的 AI 网关契约；任务调度不依赖具体模型供应商。 */
export interface AiReportGenerator {
  isEnabled(): boolean;
  generate(input: Prisma.JsonValue): Promise<AiReportOutput>;
}

export const AI_REPORT_GENERATOR = Symbol('AI_REPORT_GENERATOR');
