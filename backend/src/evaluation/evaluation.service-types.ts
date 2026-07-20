/**
 * 表单快照 content 的只读形状（cycle-setup.service.ts toFormSnapshotContent 的产物）。
 * 本模块只读取快照，不生成快照，故只声明消费侧需要的字段，不追求与写入侧完全对称。
 */
export type FormSnapshotField = {
  key: string;
  type:
    | 'SHORT_TEXT'
    | 'LONG_TEXT'
    | 'MARKDOWN'
    | 'SINGLE_SELECT'
    | 'MULTI_SELECT'
    | 'ATTACHMENT'
    | 'LINK';
  title: string;
  description?: string | null;
  placeholder?: string | null;
  requiredRule: 'OPTIONAL' | 'ALWAYS' | 'CONDITIONAL';
  requiredLevels?: readonly ('S' | 'A' | 'B' | 'C')[];
  sortOrder?: number;
  config?: unknown;
};

export type FormSnapshotDimension = {
  key: string;
  type?: 'SCORING' | 'NON_SCORING';
  scoringMethod?: 'RATING' | 'SCORE' | null;
  audience: 'EMPLOYEE' | 'REVIEWER' | 'LEADER';
  name?: string;
  description?: string | null;
  weight?: string | null;
  isCore?: boolean;
  sortOrder?: number;
  fields: readonly FormSnapshotField[];
};

export type FormSnapshotSubform = {
  key: string;
  type: 'SELF' | 'PEER' | 'MANAGER';
  title?: string;
  description?: string | null;
  sortOrder?: number;
  dimensions: readonly FormSnapshotDimension[];
};

export type FormSnapshotContent = {
  schemaVersion?: number;
  subforms: readonly FormSnapshotSubform[];
};
