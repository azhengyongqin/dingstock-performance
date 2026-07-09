---
name: postgres-prisma-db-design
description: PostgreSQL database design workflow for this Dingstock performance project. Use when designing, reviewing, adding, or changing database tables, relationships, primary keys, foreign keys, indexes, Prisma models, Prisma enums, migrations, or docs/database table structure Markdown. Always synchronizes backend/prisma/schema.prisma with docs database table documentation.
---

# Postgres Prisma DB Design

## Overview

Use this skill to design or modify this project's PostgreSQL schema through Prisma while keeping the database documentation in sync.

This project uses Prisma 7 with PostgreSQL. The source of truth is `backend/prisma/schema.prisma`, and the human-readable table documentation is `docs/数据库表结构.md`.

## Required Context

Before changing database design, read:

- `backend/prisma/schema.prisma`
- `docs/数据库表结构.md` if it exists
- `docs/盯潮-绩效系统-研发说明文档.md` sections 5 and 7 when working on performance-domain tables
- `references/project-db-rules.md` in this skill for project-specific constraints

If `docs/数据库表结构.md` does not exist, create it from the current `schema.prisma` before or alongside the schema change.

## Workflow

1. Identify the business object and lifecycle from the docs or request.
2. Design the relational model first: aggregate root, ownership, cardinality, nullable fields, uniqueness, foreign keys, delete behavior, and indexes.
3. Update `backend/prisma/schema.prisma`.
4. Update `docs/数据库表结构.md` in the same change.
5. Run validation from `backend/`:
   - `pnpm prisma:generate`
   - `pnpm build` when backend code or generated client compatibility may be affected
   - `pnpm prisma:migrate` only when a real migration is intended and a database is available
6. Report any command that could not be run and why.

## Design Rules

- Keep all project tables in PostgreSQL schema `performance` using `@@schema("performance")`.
- Use `@@map("snake_case_plural")` for every Prisma model table name.
- Keep existing Feishu sync tables in their current snake_case Prisma field style unless a migration explicitly targets those tables.
- Use camelCase Prisma field names for new project-owned business tables, and map them to snake_case database columns with `@map`.
- Use the standard base fields for new project-owned business tables:
  - `id Int @id @default(autoincrement())` as the internal primary key.
  - `createdAt DateTime @default(now()) @map("created_at")` as the creation timestamp.
  - `updatedAt DateTime @updatedAt @map("updated_at")` as the update timestamp for mutable tables.
  - `deletedAt DateTime? @map("deleted_at")` as the soft-delete timestamp when the table supports logical deletion.
- Do not add `updatedAt` to append-only tables unless there is a real correction workflow.
- Do not add `deletedAt` to immutable history tables such as audit logs, calibration history, and event records; use append-only records instead.
- Use `synced_at DateTime @updatedAt` only for external synchronization tables.
- Keep external Feishu identity fields as `String` and name them explicitly, for example `employee_open_id`, `reviewer_open_id`, or `owner_open_id`.
- Reference `LarkUser.open_id` for employee/user relations when relational integrity is valuable; if historical snapshots must survive deleted sync data, keep the open_id plus snapshot fields and document the reason.
- Define `@relation(fields: [...], references: [...], onDelete: ...)` explicitly for every relation.
- Choose delete behavior deliberately:
  - `Cascade` only for child records that have no meaning without the parent aggregate.
  - `Restrict` for audit, result, calibration, and other historical records.
  - `SetNull` only for optional operator/handler references where history should remain.
- Add `@@unique` for business uniqueness, not only API assumptions.
- Add indexes for common filters, foreign keys used in lists, status queues, and audit lookups.
- Use Prisma `enum` for closed project-owned states and roles.
- Use `Json` for dynamic form schema, external SDK payload fragments, AI outputs, flexible rules, and snapshots.
- Avoid JSON for values that must be filtered, joined, counted, constrained, or sorted frequently.
- Keep append-only tables append-only in naming and docs; do not add ordinary update flows for audit, calibration history, or immutable events.
- Add key code comments in `schema.prisma` using `///` for non-obvious fields, lifecycle constraints, JSON shape, and delete behavior.

## Documentation Rules

Update `docs/数据库表结构.md` whenever `schema.prisma` changes. Keep it practical and reviewable:

- Include the model name, physical table name, purpose, primary key, important foreign keys, unique constraints, indexes, delete behavior, and notes.
- For each table, include a field description table that lists every field from `schema.prisma`; do not document only "main" or "important" fields.
- Include standard base fields in every field description table when they exist: `id`, `createdAt`, `updatedAt`, and `deletedAt`.
- Include relation scalar fields such as `cycleId`, `participantId`, `employee_open_id`, and other foreign-key columns, even when the relation object is documented separately.
- Mark JSON fields with the expected shape or source.
- Mark snapshot fields and explain why they are denormalized.
- Mark append-only or immutable tables.
- Keep existing Chinese documentation style.
- Do not leave docs describing tables or columns that no longer exist.

## Prisma Pattern

Use this pattern for new business tables, adapting names and fields to the domain:

```prisma
/// 绩效周期内的业务对象；说明生命周期、归属和关键约束。
model ExampleBusinessObject {
  id        Int      @id @default(autoincrement()) /// 内部自增主键，不承载业务含义
  cycleId   Int      @map("cycle_id") /// 所属绩效周期
  status    ExampleStatus @default(DRAFT) /// 状态机字段，流转必须由 service 显式控制
  payload   Json?    /// 动态配置 JSONB；结构需同步写入 docs/数据库表结构.md
  createdAt DateTime @default(now()) @map("created_at") /// 创建时间
  updatedAt DateTime @updatedAt @map("updated_at") /// 最近更新时间
  deletedAt DateTime? @map("deleted_at") /// 软删除时间；查询默认过滤 null

  cycle PerfCycle @relation(fields: [cycleId], references: [id], onDelete: Cascade)

  @@index([cycleId, status])
  @@index([deletedAt])
  @@map("example_business_objects")
  @@schema("performance")
}
```

## Review Checklist

Before finishing, verify:

- `schema.prisma` and `docs/数据库表结构.md` describe the same tables and fields.
- Every table's field description table contains all fields from `schema.prisma`, including base fields and relation scalar fields.
- Every relation has a deliberate `onDelete`.
- Every foreign key and frequent query path has an index when PostgreSQL will benefit.
- Every project-owned status field uses a Prisma enum.
- New project-owned business tables include the standard base fields unless documented otherwise.
- Dynamic JSON fields are justified and documented.
- Business uniqueness is represented by `@unique` or `@@unique`.
- Migrations are not created accidentally when the user only asked for a design draft.
