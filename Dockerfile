# ==========================================
# Projet IA Hub - Production Dockerfile
# Single-stage : le frontend est pré-compilé sur l'hôte
# (pour éviter les OOM pendant npm run build dans Docker)
# ==========================================

FROM node:20-slim

# Install required system packages (for Prisma and PostgreSQL client)
RUN apt-get update && apt-get install -y \
    openssl \
    postgresql-client \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy backend package files
COPY erp-backend/package*.json ./erp-backend/

# Install backend production dependencies
WORKDIR /app/erp-backend
RUN npm ci --only=production

# Generate Prisma Client
COPY erp-backend/prisma ./prisma
RUN npx prisma generate

# Copy backend source
COPY erp-backend/src ./src
COPY erp-backend/docker-entrypoint.sh ./

# Make entrypoint executable
RUN chmod +x docker-entrypoint.sh

# Copy pre-built frontend dist from host (construit via start.sh ou npm run build)
COPY erp-frontend/dist /app/erp-frontend/dist

# Create uploads directory and set permissions
RUN mkdir -p /app/erp-backend/uploads \
    && chown -R node:node /app

# Switch to non-root user
USER node

# Set working directory back to backend
WORKDIR /app/erp-backend

EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:4000/health || exit 1

# Entrypoint
ENTRYPOINT ["./docker-entrypoint.sh"]
