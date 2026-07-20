import { toCycleConfigSnapshotData } from './cycle-config-snapshot-data';

describe('周期配置快照统一持久化映射', () => {
  it('基线初始化与活动周期追加版本共享全部计算、计划和通知字段', () => {
    const data = toCycleConfigSnapshotData({
      ratings: [{ symbol: 'A', mappingScore: '85' }],
      orgOwnerWeight: { toString: () => '30' },
      projectOwnerWeight: '30',
      peerWeight: 25,
      crossDeptWeight: '15',
      schedulePreset: { stages: [] },
      notificationRules: { stages: [] },
    });

    expect(data).toEqual({
      ratings: [{ symbol: 'A', mappingScore: '85' }],
      orgOwnerWeight: '30',
      projectOwnerWeight: '30',
      peerWeight: '25',
      crossDeptWeight: '15',
      schedulePreset: { stages: [] },
      notificationRules: { stages: [] },
    });
  });
});
