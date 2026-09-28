# Database Setup

**Stack:** NestJS + Prisma 7 + SQLite

```
Controller → Service → PrismaService → dev.db
```

## Files

| File | Purpose |
|---|---|
| `.env` | `DATABASE_URL="file:./dev.db"` |
| `prisma/schema.prisma` | Tables (models) |
| `prisma/migrations/` | SQL history (commit this) |
| `prisma.config.ts` | Config for the Prisma CLI |
| `src/prisma/prisma.service.ts` | DB client used by the app |
| `src/prisma/prisma.module.ts` | Makes `PrismaService` available everywhere |

## Setup (run in `backend/`)

1. Create `pnpm-workspace.yaml` so the SQLite driver can build:
   ```yaml
   allowBuilds:
     '@prisma/engines': true
     better-sqlite3: true
     prisma: true
   ```
2. Install:
   ```bash
   pnpm add @prisma/client@7.10.0 @prisma/adapter-better-sqlite3@7.10.0 dotenv
   pnpm add -D prisma@7.10.0
   ```
3. Create `.env`, `prisma.config.ts` and `prisma/schema.prisma`.
4. Create the tables and the client:
   ```bash
   pnpm exec prisma migrate dev --name init
   pnpm exec prisma generate
   ```
5. Add `import 'dotenv/config';` as the first line of `src/main.ts`.
6. Add `PrismaModule` to `imports` in `src/app.module.ts`.

## Changing the schema

After editing `schema.prisma`, run:

```bash
pnpm exec prisma migrate dev --name <what_changed>
pnpm exec prisma generate
```

## Commands

| Task | Command |
|---|---|
| View data in the browser | `pnpm studio` |
| Reset the DB (deletes all data) | `pnpm exec prisma migrate reset` |

## Common errors

| Error | Fix |
|---|---|
| Studio "not supported for file:./dev.db" | Use `pnpm studio` |
| `Cannot find module '../generated/prisma/client.js'` | `pnpm exec prisma generate` |
| `not under 'rootDir'` | App code goes in `src/prisma/`, not `prisma/` |
| `ERR_MODULE_NOT_FOUND .../src/...js` | Don't use `../src/` in imports |

## Don't commit

`.env`, `dev.db`, `src/generated/`
