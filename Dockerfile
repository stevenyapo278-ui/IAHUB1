# ==========================================
# Projet IA Hub — Multi-stage Dockerfile
# Stage 1 : Build du frontend React (Vite)
# Stage 2 : Image de production (backend + frontend dist)
# ==========================================

# ── Stage 1 : Build du frontend ────────────────────────────────────────────
#FROM node:20-slim AS build-frontend

#WORKDIR /app/erp-frontend



FROM node:20-slim AS build-frontend
ARG VITE_API_URL=/api
ENV VITE_API_URL=${VITE_API_URL}

WORKDIR /app/erp-frontend


COPY erp-frontend/package*.json ./
RUN npm ci

COPY erp-frontend/ ./
RUN npm run build


# ── Stage 2 : Image de production ──────────────────────────────────────────
FROM node:20-slim

RUN apt-get update && apt-get install -y \
    openssl \
    postgresql-client \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production

# Backend deps
COPY erp-backend/package*.json ./erp-backend/
WORKDIR /app/erp-backend
RUN npm ci --only=production

# Prisma
COPY erp-backend/prisma ./prisma
RUN npx prisma generate

# Backend source
COPY erp-backend/src ./src
COPY erp-backend/docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Frontend dist depuis le stage 1
COPY --from=build-frontend /app/erp-frontend/dist /app/erp-frontend/dist

# Uploads directory
RUN mkdir -p /app/erp-backend/uploads \
    && chown -R node:node /app

USER node

WORKDIR /app/erp-backend

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:4000/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
