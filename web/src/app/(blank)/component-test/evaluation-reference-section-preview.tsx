import {
  EvaluationContentSection,
  EvaluationLevelRow
} from '@/components/shared/EvaluationReferenceSection'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const EvaluationReferenceSectionPreview = () => (
  <Card className='max-w-xl'>
    <CardHeader>
      <CardTitle>评估参考板块</CardTitle>
      <CardDescription>EvaluationLevelRow / EvaluationContentSection · 自评与 360° 明细共用</CardDescription>
    </CardHeader>
    <CardContent className='space-y-6'>
      <EvaluationLevelRow title='自评等级' level='A' />
      <EvaluationLevelRow title='工作贡献与责任担当' level='B' />
      <EvaluationContentSection title='自评总结'>
        <p className='text-sm leading-relaxed'>本周期聚焦核心项目交付与跨团队协作，整体达成预期目标。</p>
      </EvaluationContentSection>
    </CardContent>
  </Card>
)

export default EvaluationReferenceSectionPreview
