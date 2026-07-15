/**
 * 表单快照 content 的只读形状（cycle-setup.service.ts toFormSnapshotContent 的产物）。
 * 本模块只读取快照，不生成快照，故只声明消费侧需要的字段，不追求与写入侧完全对称。
 */
export type FormSnapshotItem = {
  key: string;
  type: string;
  title: string;
  required: boolean;
};

export type FormSnapshotDimension = {
  key: string;
  audience: 'EMPLOYEE' | 'REVIEWER' | 'LEADER';
  items: readonly FormSnapshotItem[];
};

export type FormSnapshotSubform = {
  key: string;
  type: 'SELF' | 'PEER' | 'MANAGER' | 'PROMOTION';
  dimensions: readonly FormSnapshotDimension[];
};

export type FormSnapshotContent = {
  subforms: readonly FormSnapshotSubform[];
};
