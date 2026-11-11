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
- Rate limit: `RATE_LIMIT_MAX` (default 10000)/15min per authenticated user (key `user:<sub>`, all tabs/devices share it), 1500/15min anonymous/IP on `/api`; `/auth/login`, `/auth/login-theme`, `/health` exempt. Login extras: 20/15min per account + 100/15min per IP (successful attempts excluded)
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
- Access token TTL: `JWT_EXPIRES_IN` (default `15m`), kept in memory on the frontend (never `localStorage`). Renewal via opaque refresh token in the `HttpOnly` cookie `ia_hub_refresh`, stored as SHA-256 hash in `AuthSession` and rotated on every `POST /auth/refresh`.
- Session limits: `AUTH_IDLE_TIMEOUT_MINUTES` (default `30`, activity-based via `X-User-Activity`), absolute cap `AUTH_SESSION_MAX_HOURS` (default `12`), and `AUTH_MAX_SESSIONS` (default `10` active sessions per user; oldest revoked). Expired/revoked sessions and used reset tokens are purged every 6 h (7-day retention). The access token carries `sid` (session), `tv` and `sst`; middleware checks the session in DB on every request.
- Revocation: `User.tokenVersion` is incremented on password change/reset and embedded in every JWT (`tv`); tokens with an older version are rejected. `revokeAllUserSessions()` also disconnects live Socket.IO sessions. Tokens without `sid`/`tv`/`sst` are rejected (one-time re-login after deploy).
- Refresh-token replay: a rotated refresh token replayed after a 20 s grace window revokes the whole session and logs `AUTH_REFRESH_REUSED`.
- Password reset tokens are stored hashed (SHA-256, `PasswordResetToken.tokenHash`), single-use, 1 h TTL.
- Secrets at rest: `ApiConfig.apiKey`/`extra.appToken`, `AiKey.apiKey`, `EmailAccount.clientSecret`/`refreshToken`/`password` are encrypted with AES-256-GCM (`SECRETS_ENCRYPTION_KEY`, `enc:v1:` prefix) by a transparent Prisma middleware in `src/prismaClient.js`. Migration script: `node scripts/encryptSecrets.js status|encrypt`. Losing the key makes stored secrets unrecoverable.
- Secret rotation runbook: `docs/ROTATION_SECRETS.md` + `erp-backend/scripts/rotateSecrets.js`.
- Fine-grained permission groups (18 keys) managed via UI
- Middleware: `authenticate` + `requirePermission('key', ['ADMIN'])`
- Account lockout: persisted in the `LoginAttempt` table (`AUTH_LOCKOUT_THRESHOLD`, default `10` failures / 15 min → 15 min lock). Atomic SQL upsert, fail-open if the DB is down. Purged after 24 h.
- Password policy: `validatePasswordStrength()` in `src/utils/security.js` (`PASSWORD_MIN_LENGTH`, default `12`, plus lowercase/uppercase/digit/special, blocklist and predictable sequences). Enforced on register, reset, change-password and admin user create/update; mirrored client-side in `erp-frontend/src/utils/passwordPolicy.js`.
- Password-reset rate limits (in `app.js`): `/auth/forgot-password` 10/15 min per IP + 3/15 min per email; `/auth/reset-password` 10/15 min per IP.
- CSRF defence-in-depth: `POST /auth/refresh` and `/auth/logout` reject requests whose `Origin` is neither the API host nor a `CORS_ORIGIN`/`FRONTEND_URL`/`BACKEND_URL` host (`requireTrustedOrigin`).
- No JWT in query strings: `GET /knowledge/documents/:id/file` and the voice WebSocket accept only `Authorization: Bearer`. Browser WebSocket auth uses a single-use 60 s ticket (`POST /api/voice-live/ticket` → `VoiceTicket` table) consumed atomically at handshake.
- Default login: `superadmin@prosuma.ci` / `12345678` when `SEED_ADMIN_PASSWORD` is unset (the seeded account is then flagged `mustChangePassword`). Set `SEED_ADMIN_PASSWORD` (12+ chars) on a fresh production database.

### Real-time
- Socket.IO initialized in `server.js`, used for instant notifications
- Voice WebSocket on port 4001 (`setupVoiceLive`): authenticated with a single-use ticket (`?ticket=`, 60 s) obtained from `POST /api/voice-live/ticket`, or a `Bearer` header for non-browser clients

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
- **Upload paths**: always use `process.cwd()` to resolve upload directories, NEVER `__dirname`. The Docker volume is mounted at `<WORKDIR>/uploads` (= `process.cwd() + '/uploads'`). Using `__dirname` in `src/` files resolves to `<WORKDIR>/src/uploads` which is outside the volume — files are lost on container restart. See `auth.routes.js`, `ticket.routes.js`, `app.js` for examples.
