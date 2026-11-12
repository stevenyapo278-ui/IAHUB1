# ==========================================
# MCP GLPI Server v2.0 — Dockerfile
# Build TypeScript + run en mode HTTP
# ==========================================

FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

ENV MCP_TRANSPORT=http
ENV MCP_PORT=3333
ENV NODE_ENV=production

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3333/mcp 2>/dev/null || exit 1

CMD ["node", "dist/index.js"]
