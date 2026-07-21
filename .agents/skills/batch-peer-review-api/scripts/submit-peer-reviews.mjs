#!/usr/bin/env node
/**
 * 批量完成 360°评估：查指派 → devLogin → peer draft/submit。
 * 用法见 ../SKILL.md
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// 复用 backend 的 pg，避免在 skill 目录单独装依赖；线上可设 PERF_BACKEND_PACKAGE
const defaultBackendPackage = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../backend/package.json',
)
const require = createRequire(process.env.PERF_BACKEND_PACKAGE || defaultBackendPackage)
const { Client } = require('pg')

const DEFAULT_BASE = 'http://localhost:3000'
const DEFAULT_DB = 'postgres://dingstock:dingstock@localhost:5432/dingstock'

function parseArgs(argv) {
  const out = {
    reviewers: [],
    reviewees: [],
    levels: 'random-ab',
    mode: 'submit',
    base: process.env.PERF_API_BASE || DEFAULT_BASE,
    databaseUrl: process.env.DATABASE_URL || DEFAULT_DB,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--reviewers' && next) {
      out.reviewers = next.split(',').map((s) => s.trim()).filter(Boolean)
      i += 1
    } else if (arg === '--reviewees' && next) {
      out.reviewees = next.split(',').map((s) => s.trim()).filter(Boolean)
      i += 1
    } else if (arg === '--levels' && next) {
      out.levels = next.trim()
      i += 1
    } else if (arg === '--mode' && next) {
      out.mode = next.trim()
      i += 1
    } else if (arg === '--base' && next) {
      out.base = next.trim()
      i += 1
    } else if (arg === '--database-url' && next) {
      out.databaseUrl = next.trim()
      i += 1
    } else if (arg === '--help' || arg === '-h') {
      out.help = true
    }
  }

  return out
}

function pickLevel(levels) {
  if (levels === 'random-ab') return Math.random() < 0.5 ? 'A' : 'B'
  if (['A', 'B', 'C', 'S'].includes(levels)) return levels
  throw new Error(`不支持的 --levels: ${levels}（可用 random-ab / A / B / C / S）`)
}

function commentsFor(reviewee, level, dimName) {
  const tone = level === 'A' ? '表现优秀' : level === 'B' ? '整体良好，仍有提升空间' : '需持续改进'
  if (reviewee.includes('史千航') || reviewee.includes('设计')) {
    const map = {
      工作贡献与责任担当: `日常协作中，${reviewee}在设计交付上承诺兑现情况${level === 'A' ? '较好' : '基本稳定'}。关键页面设计稿能按约定节点推进，对研发反馈会跟进修改并闭环，${tone}。`,
      协作沟通与价值观: `跨角色协作时沟通${level === 'A' ? '比较顺畅' : '大体顺畅'}：评审会说明改动点，对稿时能解释交互意图，也愿意根据实现成本调整方案，${tone}。`,
      学习成长与潜力: `学习意愿${level === 'A' ? '较强' : '正常'}，能吸收新业务场景下的设计约束，也会同步经验给协作同学，${tone}。`,
    }
    return map[dimName] || `${reviewee}在「${dimName}」维度${tone}。`
  }
  const map = {
    工作贡献与责任担当: `日常协作中，${reviewee}在需求推进与交付闭环上${level === 'A' ? '表现扎实' : '基本到位'}。关键节点能推进，问题暴露后会跟进到有结论，${tone}。`,
    协作沟通与价值观: `跨部门沟通时表达${level === 'A' ? '清晰' : '尚可'}，能把背景、目标和风险讲明白，协作中愿意基于事实对齐分歧，${tone}。`,
    学习成长与潜力: `学习成长意愿${level === 'A' ? '明显' : '稳定'}，面对新业务或新流程能上手，并沉淀方法给协作方复用，${tone}。`,
  }
  return map[dimName] || `${reviewee}在「${dimName}」维度${tone}。`
}

function buildDimensions(form, reviewee, levelsMode) {
  const peer = (form.subforms || []).find((s) => s.type === 'PEER')
  if (!peer) throw new Error('PEER subform missing')

  const levelByName = {}
  const dimensions = peer.dimensions
    .filter((d) => d.type === 'SCORING')
    .map((d) => {
      const level = pickLevel(levelsMode)
      levelByName[d.name] = level
      const fields = (d.fields || []).map((f) => ({
        fieldKey: f.key,
        value: commentsFor(reviewee, level, d.name),
      }))
      const dim = {
        subformKey: peer.key,
        dimensionKey: d.key,
        fields,
      }
      if (d.scoringMethod === 'RATING') dim.rawLevel = level
      else if (d.scoringMethod === 'SCORE') dim.rawScore = level === 'A' ? 85 : 70
      return dim
    })

  return { dimensions, levelByName }
}

async function api(base, path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) {
    throw new Error(
      `${method} ${path} -> ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`,
    )
  }
  return data
}

async function loadAssignments(databaseUrl, reviewers, reviewees) {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const { rows } = await client.query(
      `
      SELECT e.name AS reviewer, pe.name AS reviewee,
             a.id AS assignment_id, p.id AS participant_id,
             e.open_id AS reviewer_open_id,
             a.status::text AS assignment_status,
             s.status::text AS submission_status
      FROM performance.perf_reviewer_assignments a
      JOIN performance.lark_users e ON e.open_id = a.reviewer_open_id
      JOIN performance.perf_participants p ON p.id = a.participant_id
      JOIN performance.lark_users pe ON pe.open_id = p.employee_open_id
      LEFT JOIN performance.perf_evaluation_submissions s
        ON s.reviewer_assignment_id = a.id AND s.status IN ('DRAFT', 'SUBMITTED')
      WHERE e.name = ANY($1::text[])
        AND pe.name = ANY($2::text[])
        AND a.status::text <> 'REPLACED'
      ORDER BY e.name, pe.name
      `,
      [reviewers, reviewees],
    )
    return rows
  } finally {
    await client.end()
  }
}

function printHelp() {
  console.log(`Usage:
  node submit-peer-reviews.mjs \\
    --reviewers 龙涛,彭天弘 \\
    --reviewees 史千航,冯文博 \\
    [--levels random-ab|A|B|C|S] \\
    [--mode submit|draft] \\
    [--base http://localhost:3000] \\
    [--database-url postgres://...]
`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || args.reviewers.length === 0 || args.reviewees.length === 0) {
    printHelp()
    if (!args.help && (args.reviewers.length === 0 || args.reviewees.length === 0)) {
      process.exit(1)
    }
    return
  }
  if (!['submit', 'draft'].includes(args.mode)) {
    throw new Error(`不支持的 --mode: ${args.mode}`)
  }

  const assignments = await loadAssignments(args.databaseUrl, args.reviewers, args.reviewees)
  const expectedPairs = []
  for (const reviewer of args.reviewers) {
    for (const reviewee of args.reviewees) {
      expectedPairs.push(`${reviewer}|${reviewee}`)
    }
  }
  const found = new Set(assignments.map((r) => `${r.reviewer}|${r.reviewee}`))
  const missing = expectedPairs.filter((p) => !found.has(p))
  if (missing.length) {
    console.warn('缺少指派（将跳过）:', missing.join(', '))
  }
  if (assignments.length === 0) {
    throw new Error('未找到任何有效 360° 指派')
  }

  const tokenByOpenId = new Map()
  const summary = []

  for (const row of assignments) {
    let token = tokenByOpenId.get(row.reviewer_open_id)
    if (!token) {
      const login = await api(args.base, '/auth/dev/login', {
        method: 'POST',
        body: { open_id: row.reviewer_open_id },
      })
      token = login.token
      tokenByOpenId.set(row.reviewer_open_id, token)
      console.log(`登录: ${row.reviewer}`)
    }

    const ctx = await api(args.base, `/evaluations/peer?assignmentId=${row.assignment_id}`, { token })
    if (!ctx.form) throw new Error(`assignment ${row.assignment_id} 无表单`)

    const { dimensions, levelByName } = buildDimensions(ctx.form, row.reviewee, args.levels)
    const payload = { assignmentId: row.assignment_id, dimensions }

    if (args.mode === 'draft' || ctx.state === 'EFFECTIVE') {
      await api(args.base, '/evaluations/peer/draft', { method: 'PUT', token, body: payload })
    }
    if (args.mode === 'submit') {
      await api(args.base, '/evaluations/peer/submit', { method: 'POST', token, body: payload })
    }

    summary.push({
      reviewer: row.reviewer,
      reviewee: row.reviewee,
      assignmentId: row.assignment_id,
      mode: args.mode,
      levels: levelByName,
    })
    console.log(
      `${args.mode === 'submit' ? '已提交' : '已存草稿'}: ${row.reviewer} -> ${row.reviewee}`,
      levelByName,
    )
  }

  console.log('\n结果汇总:')
  console.log('| 评估人 → 被评人 | 工作贡献 | 协作沟通 | 学习成长 |')
  console.log('|----------------|----------|----------|----------|')
  for (const item of summary) {
    const a = item.levels['工作贡献与责任担当'] ?? '-'
    const b = item.levels['协作沟通与价值观'] ?? '-'
    const c = item.levels['学习成长与潜力'] ?? '-'
    console.log(`| ${item.reviewer} → ${item.reviewee} | ${a} | ${b} | ${c} |`)
  }
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
