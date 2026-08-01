# AGENTS.md — Projet_IA_Hub

## Repository

Monorepo with 3 packages under root:

| Package | Language | Module | Test |
|---------|----------|--------|------|
| `erp-backend/` | JS (CommonJS `require`) | Express + Prisma + Jest (v30) | `npm test` |
| `erp-frontend/` | JS/JSX (ESM `import`) | React + Vite + Tailwind CSS | No test framework configured |
| `mcp-glpi/` | TypeScript | MCP server for GLPI | `npm test` (Jest in scripts, not in devDependencies) |

Root `package.json` has `npm run dev` (concurrently runs both backend and frontend).

## Quick Start

```bash
cp .env.example .env      # then edit
./start.sh                 # interactive menu: 1=Docker+GLPI, 2=Docker, 5=local dev (hot reload)
```

Alternative: `docker compose up -d --build` or `docker compose -f docker-compose.yml -f docker-compose.dev.yml up` for dev mode.

## Backend

### Entrypoint
`erp-backend/src/server.js` (port 4000) → loads `dotenv`, creates HTTP server, mounts Express app, starts Socket.IO, schedules 5 periodic syncs.

### Middleware stack (app.js)
- `helmet` with custom CSP, `cors`, `express.json({ limit: '10mb' })`
- Rate limit: 1000/15min on `/api`, 15/15min on `/auth/login`
- `express-async-errors` — async routes never need try/catch
- `requestId` middleware — each request gets a unique ID for logging
- Global 404 handler, global error handler (500)

### Key commands (from `erp-backend/`)
| Command | Action |
|---------|--------|
| `npm run dev` | nodemon hot reload |
| `npm test` | Jest (no config file, uses defaults) |
| `npx prisma generate` | Regenerate Prisma client after schema changes |
| `npx prisma migrate dev` | Apply new migration |
| `npx prisma studio` | DB browser |
| `node prisma/seed.js` | Idempotent seed (upserts teams + superadmin + default permission group + IA providers) |

### Linting
No ESLint config file found in backend. CI runs `npx eslint src/ --ext .js 2>/dev/null || echo "ESLint non configuré"`. No Prettier config anywhere.

### Testing
- Jest v30, no config file
- Requires running PostgreSQL (CI uses `pgvector/pgvector:pg16` service)
- Tests use `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=test` env vars
- 15 test files found under `src/` (routes/, services/, utils/, middleware/)

### Database
- PostgreSQL 16 + pgvector extension
- `DATABASE_URL` in environment (loaded via `dotenv` at server start, NOT from `erp-backend/.env`)
- Prisma singleton: `erp-backend/src/prismaClient.js` — always import from here
- 62 migrations in `prisma/migrations/`, named `YYYYMMDDHHMMSS_description`
- Docker entrypoint (`docker-entrypoint.sh`) handles migration recovery + `prisma migrate deploy` + seed

### Scheduler (custom, no cron)
All syncs defined in `server.js` using `scheduleSync(name, fn, getIntervalSeconds)`:
- GLPI tickets: 20s interval (configurable via UI)
- Email pipeline: 15s interval
- GLPI teams/categories/users: 10min interval
- GLPI locations: 30min interval
- AI models: 24h interval
Every sync is wrapped in `withHealthTracking` — 3 consecutive failures triggers admin alert email with 6h cooldown.

### GLPI Integration
- **Config stored in DB** (`ApiConfig` table, not `.env`). Configured via UI: *Paramètres > Autres intégrations*
- GLPI URL, App Token, User Token — all managed through the interface
- `SystemSettings.activeGlpiInstance` selects the active config (defaults to `'glpi'`)
- `getActiveGlpiConfig()` in `utils/glpiSync.js` has fallback logic
- Circuit breaker: `getBreaker('glpi-api', { maxFailures: 5, resetTimeoutMs: 60000 })`
- GLPI API session: `initSession` → do work → `killSession` (always called in finally block)
- POST /Ticket may return 200 empty body on broken GLPI instances (known issue, no ticket created) — fallback: exponential search + probe by name, then manual "Lier" UI

### Auth & Permissions
- JWT with roles: SUPERADMIN, ADMIN, HOTLINE, TECHNICIAN, REQUESTER
- Fine-grained permission groups (18 keys) managed via UI
- Middleware: `authenticate` + `requirePermission('key', ['ADMIN'])`
- Default login: `superadmin@prosuma.ci` / `12345678` (seeded)

### Real-time
- Socket.IO initialized in `server.js`, used for instant notifications

## Frontend

### Entrypoint
`erp-frontend/src/main.jsx` → React 18 + Vite 6

### Key commands
| Command | Action |
|---------|--------|
| `npm run dev` | Vite dev server |
| `npm run build` | Vite build to `dist/` |
| `npm run lint` | ESLint (no config file found, CI ignores if not configured) |

### Stack
React, React Router, Axios (via `api/` wrapper), SWR for data fetching, Tailwind CSS, Socket.IO client, i18next, Framer Motion, Recharts, Radix UI, Sonner/React Hot Toast.

### Env
`VITE_API_URL=http://localhost:4000/api` in `erp-frontend/.env`

## MCP GLPI
- TypeScript, NodeNext module resolution
- `npm run build` compiles with `tsc` to `dist/`
- CI checks: `npx tsc --noEmit` then `npm run build`
- Config via env vars: `GLPI_URL`, `GLPI_APP_TOKEN`, `GLPI_USER_TOKEN`

## Docker
- `Dockerfile` (root) multi-stage: builds frontend with Vite, then runs backend on node:20-slim
- docker-compose base: postgres + app + glpi-mcp
- Overrides: `.dev.yml` (hot reload), `.production.yml` (minimal), `.dokploy.yml`, `.glpi.yml`
- Network: `ia-hub-network` (bridge)
- Ports: 5433 (PG), 4000 (app), 3333 (MCP)

## CI (`.github/workflows/ci.yml`)
3 parallel jobs on push to `master`/`fofana` and PR to `master`:
1. Backend: `prisma generate` → lint (ignored if not configured) → `npm test` (with postgres service)
2. Frontend: lint (ignored if not configured) → `npm run build`
3. MCP GLPI: `tsc --noEmit` → `npm run build`

## Conventions
- Code: English identifiers, French comments and documentation
- Backend: CommonJS (`require`/`module.exports`)
- Frontend: ESM (`import`/`export`)
- Seed: idempotent (all upserts), never add required migrations to seed
- Never modify existing migration files
- GLPI base URL in API calls: always strip trailing slash (`config.baseUrl.replace(/\/+$/, '')`)
