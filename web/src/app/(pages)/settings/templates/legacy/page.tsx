import LegacyTemplateManager from '@/views/settings/templates'

export const metadata = {
  title: '旧版配置模板 - 盯潮绩效'
}

/** Ticket 04 完成周期快照迁移前，保留旧 `/templates` 生产入口的管理能力。 */
const LegacyTemplatesPage = () => <LegacyTemplateManager />

export default LegacyTemplatesPage
