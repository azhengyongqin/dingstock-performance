import type { Prisma } from '../generated/prisma/client';
import type {
  FormFieldConfig,
  FormFieldRequiredRule,
  FormFieldType,
  FormRatingLevel,
  FormTemplateSubformContract,
} from './form-template.contract';

const SCORING_ITEM_TYPES = new Set(['RATING', 'SCORE']);

type PersistedField = {
  id?: number;
  businessKey: string;
  type: string;
  title: string;
  description?: string | null;
  placeholder?: string | null;
  required: boolean;
  requiredRule?: string;
  requiredLevels?: readonly string[];
  sortOrder: number;
  config?: unknown;
};

type PersistedDimension = {
  id?: number;
  businessKey?: string;
  key?: string;
  kind?: string;
  type?: 'SCORING' | 'NON_SCORING';
  scoringMethod?: string | null;
  audience: 'EMPLOYEE' | 'REVIEWER' | 'LEADER';
  name: string;
  description?: string | null;
  weight?: { toString(): string } | string | number | null;
  isCore: boolean;
  sortOrder: number;
  items?: readonly PersistedField[];
  fields?: readonly {
    key: string;
    type: FormFieldType;
    title: string;
    description?: string | null;
    placeholder?: string | null;
    requiredRule: FormFieldRequiredRule;
    requiredLevels: readonly FormRatingLevel[];
    sortOrder: number;
    config?: FormFieldConfig | null;
  }[];
};

type PersistedSubform = {
  type: string;
  title: string;
  description?: string | null;
  sortOrder: number;
  dimensions: readonly PersistedDimension[];
};

/** 把 expand 阶段的旧表映射为唯一新版领域契约。 */
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
        if (dimension.type && dimension.fields) {
          return {
            id: dimension.id,
            key: dimension.key!,
            type: dimension.type,
            scoringMethod: dimension.scoringMethod as 'RATING' | 'SCORE' | null,
            audience: dimension.audience,
            name: dimension.name,
            description: dimension.description,
            weight:
              dimension.type === 'SCORING' && dimension.weight != null
                ? dimension.weight.toString()
                : null,
            isCore: dimension.type === 'SCORING' && dimension.isCore,
            sortOrder: dimension.sortOrder,
            fields: dimension.fields.map((field) => ({ ...field })),
          };
        }

        const items = dimension.items ?? [];
        const scoringItem = items.find((item) =>
          SCORING_ITEM_TYPES.has(item.type),
        );
        const isScoring = dimension.kind === 'REGULAR';
        const inferredScoringMethod =
          scoringItem?.type === 'RATING' || scoringItem?.type === 'SCORE'
            ? scoringItem.type
            : null;
        return {
          id: dimension.id,
          key: dimension.businessKey!,
          type: isScoring ? ('SCORING' as const) : ('NON_SCORING' as const),
          scoringMethod: isScoring
            ? ((dimension.scoringMethod ?? inferredScoringMethod) as
                'RATING' | 'SCORE' | null)
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
          fields: items
            .filter((item) => !SCORING_ITEM_TYPES.has(item.type))
            .map((item) => ({
              id: item.id,
              key: item.businessKey,
              type: item.type as FormFieldType,
              title: item.title,
              description: item.description,
              placeholder: item.placeholder,
              requiredRule: (item.requiredRule ??
                (item.required
                  ? 'ALWAYS'
                  : 'OPTIONAL')) as FormFieldRequiredRule,
              requiredLevels: (item.requiredLevels ?? []) as FormRatingLevel[],
              sortOrder: item.sortOrder - (isScoring && scoringItem ? 1 : 0),
              config: item.config as FormFieldConfig | null,
            })),
        };
      }),
    }));
}

/** 新版领域对象写入旧表时生成隐藏计分项，供尚未迁移的周期链路读取。 */
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
        kind:
          dimension.type === 'SCORING'
            ? ('REGULAR' as const)
            : ('TEXT' as const),
        scoringMethod:
          dimension.type === 'SCORING' ? dimension.scoringMethod : null,
        audience: dimension.audience,
        name: dimension.name,
        description: dimension.description,
        weight: dimension.type === 'SCORING' ? dimension.weight : null,
        isCore: dimension.type === 'SCORING' && dimension.isCore,
        sortOrder: dimension.sortOrder,
        items: {
          create: [
            ...(dimension.type === 'SCORING' && dimension.scoringMethod
              ? [
                  {
                    businessKey: `compat-scoring:${dimension.key}`,
                    type: dimension.scoringMethod,
                    title: `${dimension.name}${dimension.scoringMethod === 'RATING' ? '评级' : '分数'}`,
                    required: true,
                    requiredRule: 'ALWAYS' as const,
                    requiredLevels: [],
                    sortOrder: 0,
                  },
                ]
              : []),
            ...dimension.fields.map((field) => ({
              businessKey: field.key,
              type: field.type,
              title: field.title,
              description: field.description,
              placeholder: field.placeholder,
              required: field.requiredRule === 'ALWAYS',
              requiredRule: field.requiredRule,
              requiredLevels: [...field.requiredLevels],
              sortOrder:
                field.sortOrder +
                (dimension.type === 'SCORING' && dimension.scoringMethod
                  ? 1
                  : 0),
              config: field.config
                ? (field.config as Prisma.InputJsonValue)
                : undefined,
            })),
          ],
        },
      })),
    },
  }));
}
