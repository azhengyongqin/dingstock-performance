import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { PerfPeerStageResult } from '@/lib/perf-api'
import PeerReviewAnalysisPanel from '@/views/review-tasks/fill/peer-review-analysis-panel'

const SAMPLE_RESULT: PerfPeerStageResult = {
  status: 'READY',
  reviewerCount: 5,
  compositeScore: '79.16',
  initialLevel: 'B',
  stageLevel: 'B',
  constraintReasons: [],
  dimensions: [],
  analysis: {
    assignedReviewerCount: 5,
    submittedReviewerCount: 5,
    relationCounts: [
      { relation: 'ORG_OWNER', reviewerCount: 1 },
      { relation: 'PEER', reviewerCount: 1 },
      { relation: 'CROSS_DEPT', reviewerCount: 3 }
    ],
    dimensions: [
      {
        id: 'dimension:contribution',
        name: '工作贡献与责任担当',
        score: '78.57',
        level: 'B',
        distribution: { S: 0, A: 4, B: 1, C: 0 }
      },
      {
        id: 'dimension:collaboration',
        name: '协作沟通与价值观',
        score: '77.50',
        level: 'B',
        distribution: { S: 0, A: 2, B: 2, C: 1 }
      }
    ],
    reviewers: [
      {
        submissionId: 1,
        reviewerOpenId: 'ou_component_liuzixin',
        relation: 'ORG_OWNER',
        reviewer: {
          open_id: 'ou_component_liuzixin',
          name: '刘梓新',
          avatar: null,
          departmentPath: null,
          jobTitle: null
        },
        dimensions: [
          {
            id: 'dimension:contribution',
            name: '工作贡献与责任担当',
            rawLevel: 'B',
            rawScore: null,
            mappedLevel: 'B',
            items: [
              {
                itemKey: 'item:contribution:comment',
                title: '业绩评价',
                type: 'MARKDOWN',
                rawLevel: null,
                rawScore: null,
                value:
                  '整体表现符合预期，能稳定推进重点事项。\n\n1. 完成数据中台需求澄清与验收节奏对齐\n2. 在跨团队走查中及时补位'
              }
            ]
          },
          {
            id: 'dimension:collaboration',
            name: '协作沟通与价值观',
            rawLevel: 'A',
            rawScore: null,
            mappedLevel: 'A',
            items: [
              {
                itemKey: 'item:collaboration:comment',
                title: '协作评价',
                type: 'LONG_TEXT',
                rawLevel: null,
                rawScore: null,
                value: '沟通主动，能在跨团队协作中及时补位并推动问题闭环。'
              }
            ]
          }
        ]
      },
      {
        submissionId: 2,
        reviewerOpenId: 'ou_component_linqiqi',
        relation: 'PEER',
        reviewer: {
          open_id: 'ou_component_linqiqi',
          name: '林奇奇',
          avatar: null,
          departmentPath: null,
          jobTitle: null
        },
        dimensions: [
          {
            id: 'dimension:contribution',
            name: '工作贡献与责任担当',
            rawLevel: 'B',
            rawScore: null,
            mappedLevel: 'B',
            items: []
          },
          {
            id: 'dimension:collaboration',
            name: '协作沟通与价值观',
            rawLevel: 'A',
            rawScore: null,
            mappedLevel: 'A',
            items: []
          }
        ]
      },
      {
        submissionId: 3,
        reviewerOpenId: 'ou_component_chenyahan',
        relation: 'CROSS_DEPT',
        reviewer: {
          open_id: 'ou_component_chenyahan',
          name: '陈雅涵',
          avatar: null,
          departmentPath: null,
          jobTitle: null
        },
        dimensions: [
          {
            id: 'dimension:contribution',
            name: '工作贡献与责任担当',
            rawLevel: 'A',
            rawScore: null,
            mappedLevel: 'A',
            items: []
          },
          {
            id: 'dimension:collaboration',
            name: '协作沟通与价值观',
            rawLevel: 'B',
            rawScore: null,
            mappedLevel: 'B',
            items: []
          }
        ]
      }
    ]
  }
}

const PeerReviewAnalysisPreview = () => (
  <Card className='max-w-xl'>
    <CardHeader>
      <CardTitle>360°评估分析面板</CardTitle>
      <CardDescription>验证概览分布、关系/维度筛选和实名评审下钻。</CardDescription>
    </CardHeader>
    <CardContent>
      <PeerReviewAnalysisPanel result={SAMPLE_RESULT} />
    </CardContent>
  </Card>
)

export default PeerReviewAnalysisPreview
