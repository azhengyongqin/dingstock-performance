import type { Prisma } from '../generated/prisma/client';
import type {
  FormFieldConfig,
  FormFieldRequiredRule,
  FormFieldType,
  FormRatingLevel,
  FormTemplateSubformContract,
} from './form-template.contract';

type PersistedField = {
  id?: number;
  businessKey: string;
  type: string;
  title: string;
  description?: string | null;
  placeholder?: string | null;
  requiredRule: string;
  requiredLevels: readonly string[];
  sortOrder: number;
  config?: unknown;
};

type PersistedDimension = {
  id?: number;
  businessKey: string;
  type: 'SCORING' | 'NON_SCORING' | 'LEGACY_PROMOTION';
  scoringMethod?: string | null;
  audience: 'EMPLOYEE' | 'REVIEWER' | 'LEADER';
  name: string;
  description?: string | null;
  weight?: { toString(): string } | string | number | null;
  isCore: boolean;
  sortOrder: number;
  fields: readonly PersistedField[];
};

type PersistedSubform = {
  type: string;
  title: string;
  description?: string | null;
  sortOrder: number;
  dimensions: readonly PersistedDimension[];
};

/** 把持久化结构映射为唯一新版领域契约；旧晋升子表单在入口处排除。 */
export function toPerformanceSubformContracts(
  subforms: readonly PersistedSubform[],
): FormTemplateSubformContract[] {
  return subforms
    .filter((subform) => ['SELF', 'PEER', 'MANAGER'].includes(subform.type))
    .map((subform) => ({
      type: subform.type as FormTemplateSubformContract['type'],
      title: subform.title,
      description: subform.description,
      sortOrder: subform.sortOrder,
      dimensions: subform.dimensions.map((dimension) => {
        const isScoring = dimension.type === 'SCORING';
        return {
          id: dimension.id,
          key: dimension.businessKey,
          type: isScoring ? ('SCORING' as const) : ('NON_SCORING' as const),
          scoringMethod: isScoring
            ? (dimension.scoringMethod as 'RATING' | 'SCORE' | null)
            : null,
          audience: dimension.audience,
          name: dimension.name,
          description: dimension.description,
          weight:
            isScoring && dimension.weight != null
              ? dimension.weight.toString()
              : null,
          isCore: isScoring && dimension.isCore,
          sortOrder: dimension.sortOrder,
          fields: dimension.fields.map((field) => ({
            id: field.id,
            key: field.businessKey,
            type: field.type as FormFieldType,
            title: field.title,
            description: field.description,
            placeholder: field.placeholder,
            requiredRule: field.requiredRule as FormFieldRequiredRule,
            requiredLevels: field.requiredLevels as FormRatingLevel[],
            sortOrder: field.sortOrder,
            config: field.config as FormFieldConfig | null,
          })),
        };
      }),
    }));
}

/** 新版领域对象直接写入维度与字段两层结构。 */
export function toPerformanceSubformCreateData(
  subforms: readonly FormTemplateSubformContract[],
) {
  return subforms.map((subform) => ({
    type: subform.type,
    title: subform.title,
    description: subform.description,
    sortOrder: subform.sortOrder,
    dimensions: {
      create: subform.dimensions.map((dimension) => ({
        businessKey: dimension.key,
        type: dimension.type,
        scoringMethod:
          dimension.type === 'SCORING' ? dimension.scoringMethod : null,
        audience: dimension.audience,
        name: dimension.name,
        description: dimension.description,
        weight: dimension.type === 'SCORING' ? dimension.weight : null,
        isCore: dimension.type === 'SCORING' && dimension.isCore,
        sortOrder: dimension.sortOrder,
        fields: {
          create: dimension.fields.map((field) => ({
            businessKey: field.key,
            type: field.type,
            title: field.title,
            description: field.description,
            placeholder: field.placeholder,
            requiredRule: field.requiredRule,
            requiredLevels: [...field.requiredLevels],
            sortOrder: field.sortOrder,
            config: field.config
              ? (field.config as Prisma.InputJsonValue)
              : undefined,
          })),
        },
      })),
    },
  }));
}
