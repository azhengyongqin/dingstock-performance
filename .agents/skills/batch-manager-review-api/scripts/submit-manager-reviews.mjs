#!/usr/bin/env node
/**
 * 批量完成上级评估：查参与人 Leader → devLogin → manager draft/submit。
 * 用法见 ../SKILL.md
 */

import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultBackendPackage = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../backend/package.json',
)
// 线上可设 PERF_BACKEND_PACKAGE=/root/.../current/backend/package.json
const require = createRequire(process.env.PERF_BACKEND_PACKAGE || defaultBackendPackage)
const { Client } = require('pg')

const DEFAULT_BASE = 'http://localhost:3000'
const DEFAULT_DB = 'postgres://dingstock:dingstock@localhost:5432/dingstock'

/** 等级 → SCORE 代表分；random-ab 时在档内随机 */
const LEVEL_SCORE = { S: 95, A: 85, B: 72, C: 50 }

function parseArgs(argv) {
  const out = {
    reviewees: [],
    scores: 'random-ab',
    mode: 'submit',
    base: process.env.PERF_API_BASE || DEFAULT_BASE,
    databaseUrl: process.env.DATABASE_URL || DEFAULT_DB,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]
    if (arg === '--reviewees' && next) {
      out.reviewees = next.split(',').map((s) => s.trim()).filter(Boolean)
      i += 1
    } else if (arg === '--scores' && next) {
      out.scores = next.trim()
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

function pickScore(scoresMode) {
  if (scoresMode === 'random-ab') {
    // A 档 80–89，B 档 70–79，与「随机 A/B」口径对齐
    if (Math.random() < 0.5) return 80 + Math.floor(Math.random() * 10)
    return 70 + Math.floor(Math.random() * 10)
  }
  if (LEVEL_SCORE[scoresMode] != null) return LEVEL_SCORE[scoresMode]
  const n = Number(scoresMode)
  if (Number.isFinite(n) && n >= 0 && n <= 100) return n
  throw new Error(
    `不支持的 --scores: ${scoresMode}（可用 random-ab / A / B / C / S / 0-100 数字）`,
  )
}

function levelFromScore(score) {
  if (score >= 90) return 'S'
  if (score >= 80) return 'A'
  if (score >= 60) return 'B'
  return 'C'
}

function commentsFor(employee, dimName, score) {
  const level = levelFromScore(score)
  const tone =
    level === 'S' || level === 'A' ? '表现优秀' : level === 'B' ? '整体良好，仍有提升空间' : '需持续改进'
  const isDesign = employee.includes('史千航') || employee.includes('设计')
  const jobHint = isDesign ? 'UI/交互设计交付' : '研发与协作交付'
  const map = {
    核心业绩: `本周期${employee}在${jobHint}方面${tone}。关键节点可控，问题闭环及时，产出能支撑业务推进；复杂事项能主动对齐方案并落实，达到对应档位要求。`,
    价值观: `${employee}协作态度正向，沟通坦诚守约，跨角色配合时能基于事实对齐分歧，不推诿甩锅；团队讨论中尊重不同意见，价值观表现与团队要求一致，${tone}。`,
    职业素养与潜力: `${employee}职业素养扎实，交付规范清晰，学习成长曲线稳定，能吸收新业务约束并沉淀经验。后续可承担更复杂模块职责，潜力${tone}。`,
  }
  return map[dimName] || `${employee}在「${dimName}」维度${tone}。`
}

function buildDimensions(form, employee, scoresMode) {
  const manager = (form.subforms || []).find((s) => s.type === 'MANAGER')
  if (!manager) throw new Error('MANAGER subform missing')

  const scoreByName = {}
  const dimensions = []

  for (const d of manager.dimensions || []) {
    if (d.type === 'SCORING') {
      const score = pickScore(scoresMode)
      const fields = (d.fields || []).map((f) => ({
        fieldKey: f.key,
        value: commentsFor(employee, d.name, score),
      }))
      const dim = {
        subformKey: manager.key,
        dimensionKey: d.key,
        fields,
      }
      if (d.scoringMethod === 'SCORE') {
        dim.rawScore = score
        scoreByName[d.name] = score
      } else if (d.scoringMethod === 'RATING') {
        const level =
          scoresMode === 'random-ab'
            ? levelFromScore(score)
            : ['S', 'A', 'B', 'C'].includes(scoresMode)
              ? scoresMode
              : levelFromScore(score)
        dim.rawLevel = level
        scoreByName[d.name] = level
      } else {
        scoreByName[d.name] = score
      }
      dimensions.push(dim)
    } else if (d.type === 'NON_SCORING') {
      const fields = (d.fields || []).map((f) => {
        if (f.type === 'SINGLE_SELECT' || f.type === 'MULTI_SELECT') {
          const opts = f.options || []
          const first = opts[0]
          const val =
            typeof first === 'string' ? first : first?.value ?? first?.key ?? first?.label
          return {
            fieldKey: f.key,
            value: f.type === 'MULTI_SELECT' ? [val].filter(Boolean) : val,
          }
        }
        return {
          fieldKey: f.key,
          value: `综合来看，${employee}本周期表现稳定，建议继续在当前岗位深化贡献，并逐步承担更复杂事项。`,
        }
      })
      dimensions.push({
        subformKey: manager.key,
        dimensionKey: d.key,
        fields,
      })
    }
  }

  return { dimensions, scoreByName }
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

async function loadParticipants(databaseUrl, reviewees) {
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const { rows } = await client.query(
      `
      SELECT pe.name AS employee,
             p.id AS participant_id,
             p.leader_open_id_snapshot AS leader_open_id,
             lu.name AS leader_name
      FROM performance.perf_participants p
      JOIN performance.lark_users pe ON pe.open_id = p.employee_open_id
      LEFT JOIN performance.lark_users lu ON lu.open_id = p.leader_open_id_snapshot
      WHERE pe.name = ANY($1::text[])
        AND p.status::text = 'ACTIVE'
      ORDER BY pe.name
      `,
      [reviewees],
    )
    return rows
  } finally {
    await client.end()
  }
}

function printHelp() {
  console.log(`Usage:
  node submit-manager-reviews.mjs \\
    --reviewees 史千航,冯文博 \\
    [--scores random-ab|A|B|C|S|<0-100>] \\
    [--mode submit|draft] \\
    [--base http://localhost:3000] \\
    [--database-url postgres://...]
`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help || args.reviewees.length === 0) {
    printHelp()
    if (!args.help && args.reviewees.length === 0) process.exit(1)
    return
  }
  if (!['submit', 'draft'].includes(args.mode)) {
    throw new Error(`不支持的 --mode: ${args.mode}`)
  }

  const participants = await loadParticipants(args.databaseUrl, args.reviewees)
  const found = new Set(participants.map((r) => r.employee))
  const missing = args.reviewees.filter((n) => !found.has(n))
  if (missing.length) console.warn('缺少 ACTIVE 参与人（将跳过）:', missing.join(', '))
  if (participants.length === 0) throw new Error('未找到任何有效参与人')

  const tokenByLeader = new Map()
  const summary = []

  for (const row of participants) {
    if (!row.leader_open_id) {
      console.warn(`跳过 ${row.employee}: 无 leader_open_id_snapshot`)
      continue
    }

    let token = tokenByLeader.get(row.leader_open_id)
    if (!token) {
      const login = await api(args.base, '/auth/dev/login', {
        method: 'POST',
        body: { open_id: row.leader_open_id },
      })
      token = login.token
      tokenByLeader.set(row.leader_open_id, token)
      console.log(`登录 Leader: ${row.leader_name}`)
    }

    const ctx = await api(args.base, `/evaluations/manager?participantId=${row.participant_id}`, {
      token,
    })
    if (!ctx.form) throw new Error(`${row.employee}: 无上级评估表单`)

    const { dimensions, scoreByName } = buildDimensions(ctx.form, row.employee, args.scores)
    const payload = { participantId: row.participant_id, dimensions }

    if (args.mode === 'draft' || ctx.state === 'EFFECTIVE') {
      await api(args.base, '/evaluations/manager/draft', { method: 'PUT', token, body: payload })
    }
    let result = null
    if (args.mode === 'submit') {
      result = await api(args.base, '/evaluations/manager/submit', {
        method: 'POST',
        token,
        body: payload,
      })
    }

    const item = {
      leader: row.leader_name,
      employee: row.employee,
      participantId: row.participant_id,
      mode: args.mode,
      scores: scoreByName,
      stageLevel: result?.result?.stageLevel ?? null,
      compositeScore: result?.result?.compositeScore ?? null,
    }
    summary.push(item)
    console.log(
      `${args.mode === 'submit' ? '已提交' : '已存草稿'}: ${row.leader_name} -> ${row.employee}`,
      scoreByName,
      args.mode === 'submit'
        ? { stageLevel: item.stageLevel, compositeScore: item.compositeScore }
        : '',
    )
  }

  console.log('\n结果汇总:')
  console.log('| Leader → 员工 | 核心业绩 | 价值观 | 职业素养与潜力 | 阶段等级 |')
  console.log('|--------------|----------|--------|----------------|----------|')
  for (const item of summary) {
    const a = item.scores['核心业绩'] ?? '-'
    const b = item.scores['价值观'] ?? '-'
    const c = item.scores['职业素养与潜力'] ?? '-'
    console.log(
      `| ${item.leader} → ${item.employee} | ${a} | ${b} | ${c} | ${item.stageLevel ?? '-'} |`,
    )
  }
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
