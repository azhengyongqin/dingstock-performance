import { BadRequestException } from '@nestjs/common';
import { buildCycleFormChangePlan } from './cycle-form-change';
import { EvaluationSubmissionService } from './evaluation-submission.service';
import type {
  FormSnapshotContent,
  FormSnapshotField,
} from './evaluation.service-types';

jest.mock('../generated/prisma/client', () => ({
  PrismaClient: class {},
  Prisma: {},
}));
jest.mock('../generated/prisma/enums', () => ({
  PerfEvaluationTaskType: { SELF: 'SELF', PEER: 'PEER', MANAGER: 'MANAGER' },
  PerfReviewStatus: { DRAFT: 'DRAFT', SUBMITTED: 'SUBMITTED' },
  PerfRatingSymbol: { S: 'S', A: 'A', B: 'B', C: 'C' },
  PerfAiReportStatus: {
    PENDING: 'PENDING',
    GENERATING: 'GENERATING',
    SUCCESS: 'SUCCESS',
    FAILED: 'FAILED',
  },
}));
jest.mock('../shared/database/prisma.service', () => ({
  PrismaService: class {},
}));

const service = new EvaluationSubmissionService(
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
);

function contentWith(field: FormSnapshotField): FormSnapshotContent {
  return {
    schemaVersion: 2,
    subforms: [
      {
        key: 'subform:PEER',
        type: 'PEER',
        dimensions: [
          {
            key: 'dimension:peer',
            type: 'NON_SCORING',
            audience: 'REVIEWER',
            fields: [field],
          },
        ],
      },
    ],
  };
}

function isAcceptedAtBothSeams(field: FormSnapshotField, value: unknown) {
  const content = contentWith(field);
  const existing = [
    {
      subformKey: 'subform:PEER',
      dimensionKey: 'dimension:peer',
      scoringMethod: null,
      rawLevel: null,
      rawScore: null,
      fields: [{ fieldKey: field.key, fieldType: field.type, value }],
    },
  ] as const;
  const plan = buildCycleFormChangePlan(content, 'PEER', existing);
  let submissionAccepted = true;
  try {
    service.validatePeerDimensionAnswers(content, [
      {
        subformKey: 'subform:PEER',
        dimensionKey: 'dimension:peer',
        fields: [{ fieldKey: field.key, value }],
      },
    ]);
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    submissionAccepted = false;
  }
  return {
    migrationAccepted: plan.compatibleFieldAnswers.length === 1,
    submissionAccepted,
  };
}

describe('实时提交与结构迁移共用字段值规则', () => {
  it.each([
    {
      label: '文本长度越界',
      field: {
        key: 'field:text',
        type: 'LONG_TEXT',
        title: '说明',
        requiredRule: 'OPTIONAL',
        config: { minLength: 2, maxLength: 4 },
      },
      valid: '刚好四字',
      invalid: '超过四个字符',
    },
    {
      label: '单选值不在受控选项',
      field: {
        key: 'field:single',
        type: 'SINGLE_SELECT',
        title: '单选',
        requiredRule: 'OPTIONAL',
        config: { options: [{ value: 'KEEP', label: '保留' }] },
      },
      valid: 'KEEP',
      invalid: 'REMOVED',
    },
    {
      label: '多选数量或选项越界',
      field: {
        key: 'field:multi',
        type: 'MULTI_SELECT',
        title: '多选',
        requiredRule: 'OPTIONAL',
        config: {
          options: [
            { value: 'A', label: 'A' },
            { value: 'B', label: 'B' },
          ],
          minSelections: 1,
          maxSelections: 1,
        },
      },
      valid: ['A'],
      invalid: ['A', 'B'],
    },
    {
      label: '附件扩展名不在白名单',
      field: {
        key: 'field:file',
        type: 'ATTACHMENT',
        title: '附件',
        requiredRule: 'OPTIONAL',
        config: { maxFiles: 1, allowedExtensions: ['pdf'] },
      },
      valid: [{ name: '证据.PDF', url: 'https://files.example/evidence' }],
      invalid: [{ name: '证据.exe', url: 'https://files.example/evidence' }],
    },
    {
      label: '链接协议不在白名单',
      field: {
        key: 'field:link',
        type: 'LINK',
        title: '链接',
        requiredRule: 'OPTIONAL',
        config: { maxLength: 100, allowedProtocols: ['https'] },
      },
      valid: 'https://example.com/evidence',
      invalid: 'http://example.com/evidence',
    },
  ] as const)('$label 在两处得到同一兼容结论', ({ field, valid, invalid }) => {
    expect(isAcceptedAtBothSeams(field as FormSnapshotField, valid)).toEqual({
      migrationAccepted: true,
      submissionAccepted: true,
    });
    expect(isAcceptedAtBothSeams(field as FormSnapshotField, invalid)).toEqual({
      migrationAccepted: false,
      submissionAccepted: false,
    });
  });
});
