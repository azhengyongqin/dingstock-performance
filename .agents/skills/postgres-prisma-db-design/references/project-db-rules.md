# Project Database Rules

## Current Stack

- Backend: NestJS 11 under `backend/`.
- ORM: Prisma 7 with `@prisma/adapter-pg`.
- Database: PostgreSQL.
- Prisma schema: `backend/prisma/schema.prisma`.
- Generated client: `backend/src/generated/prisma`.
- Database schema namespace: `performance`.
- Table documentation: `docs/数据库表结构.md`.

## Existing Models

- `LarkUser` maps to `lark_users`; primary key is Feishu `open_id`.
- `LarkDepartment` maps to `lark_departments`; primary key is Feishu `open_department_id`.
- `LarkCorehrEmployee` maps to `lark_corehr_employees`; primary key is `open_id`, with a 1:1 cascade relation to `LarkUser`.

These three tables mirror Feishu SDK payloads. Keep SDK-origin enum-like fields and nested objects close to source shape with `Int`, arrays, and `Json`.

## Business-Domain Direction

Performance-domain tables should follow the design in `docs/盯潮-绩效系统-研发说明文档.md` section 7:

- Keep employee master data in Feishu sync tables.
- Store employee references as Feishu `open_id`.
- Store historical organization/job/leader values as snapshot fields on cycle participants.
- Use JSONB for dynamic form schemas, scoring details, AI outputs, notification payloads, and flexible rules.
- Use Prisma enums for project-owned states such as cycle status, participant status, review status, notification status, appeal status, and roles.
- Use standard base fields for new project-owned business tables: `id` autoincrement primary key, `createdAt`, `updatedAt`, and optional `deletedAt` for soft deletion.
- Map new camelCase Prisma fields to snake_case database columns with `@map`, for example `createdAt @map("created_at")`.
- Keep existing Feishu sync table field names as-is unless a dedicated migration explicitly changes them.
- In `docs/数据库表结构.md`, every table's field description table must list all fields from `schema.prisma`, including base fields and foreign-key scalar fields.
- Treat `perf_participants` as the aggregate root for a participant's evaluation process.
- Make calibration and audit records append-only.

## Commands

Run from `backend/`:

```bash
pnpm prisma:generate
pnpm build
pnpm prisma:migrate
```

Use `pnpm prisma:migrate` only when the user wants an actual migration and a PostgreSQL database is available.
