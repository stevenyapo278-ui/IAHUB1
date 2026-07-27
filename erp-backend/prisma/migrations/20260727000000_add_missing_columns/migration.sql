-- Migration: add_missing_columns
-- Rattrapage : crée les tables et colonnes déclarées dans schema.prisma
-- mais jamais créées par les migrations existantes (ni CREATE TABLE ni ALTER TABLE).

-- =============================================================================
-- Tables manquantes
-- =============================================================================

-- TicketFieldCorrection
CREATE TABLE IF NOT EXISTS "TicketFieldCorrection" (
    "id"              SERIAL,
    "ticketId"        INTEGER NOT NULL,
    "fieldName"       TEXT NOT NULL,
    "oldValue"        TEXT,
    "newValue"        TEXT,
    "aiPrediction"    TEXT,
    "correctedById"   INTEGER,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TicketFieldCorrection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TicketFieldCorrection_ticketId_idx" ON "TicketFieldCorrection"("ticketId");
CREATE INDEX IF NOT EXISTS "TicketFieldCorrection_fieldName_idx" ON "TicketFieldCorrection"("fieldName");
CREATE INDEX IF NOT EXISTS "TicketFieldCorrection_correctedById_idx" ON "TicketFieldCorrection"("correctedById");
CREATE INDEX IF NOT EXISTS "TicketFieldCorrection_createdAt_idx" ON "TicketFieldCorrection"("createdAt");
ALTER TABLE "TicketFieldCorrection" ADD CONSTRAINT IF NOT EXISTS "TicketFieldCorrection_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TicketFieldCorrection" ADD CONSTRAINT IF NOT EXISTS "TicketFieldCorrection_correctedById_fkey"
    FOREIGN KEY ("correctedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AiWeeklyPatternReport
CREATE TABLE IF NOT EXISTS "AiWeeklyPatternReport" (
    "id"               SERIAL,
    "startDate"        TIMESTAMP(3) NOT NULL,
    "endDate"          TIMESTAMP(3) NOT NULL,
    "totalCorrections" INTEGER NOT NULL DEFAULT 0,
    "totalRejections"  INTEGER NOT NULL DEFAULT 0,
    "proposedRules"    JSONB NOT NULL,
    "status"           "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById"     INTEGER,
    "reviewedAt"       TIMESTAMP(3),
    "reviewNote"       TEXT,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"        TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiWeeklyPatternReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AiWeeklyPatternReport_startDate_endDate_idx" ON "AiWeeklyPatternReport"("startDate", "endDate");
CREATE INDEX IF NOT EXISTS "AiWeeklyPatternReport_reviewedById_idx" ON "AiWeeklyPatternReport"("reviewedById");
ALTER TABLE "AiWeeklyPatternReport" ADD CONSTRAINT IF NOT EXISTS "AiWeeklyPatternReport_reviewedById_fkey"
    FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RequesterLocation
CREATE TABLE IF NOT EXISTS "RequesterLocation" (
    "id"              SERIAL,
    "email"           TEXT NOT NULL,
    "glpiLocationId"  INTEGER NOT NULL,
    "assignedById"    INTEGER,
    "assignmentCount" INTEGER NOT NULL DEFAULT 1,
    "lastUsedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RequesterLocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "RequesterLocation_email_glpiLocationId_key" UNIQUE ("email", "glpiLocationId")
);
CREATE INDEX IF NOT EXISTS "RequesterLocation_email_idx" ON "RequesterLocation"("email");
ALTER TABLE "RequesterLocation" ADD CONSTRAINT IF NOT EXISTS "RequesterLocation_glpiLocationId_fkey"
    FOREIGN KEY ("glpiLocationId") REFERENCES "GlpiLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequesterLocation" ADD CONSTRAINT IF NOT EXISTS "RequesterLocation_assignedById_fkey"
    FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AuditLog
CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id"          SERIAL,
    "action"      TEXT NOT NULL,
    "actorId"     INTEGER,
    "actorEmail"  TEXT,
    "targetType"  TEXT NOT NULL,
    "targetId"    INTEGER,
    "targetLabel" TEXT,
    "metadata"    JSONB,
    "ipAddress"   TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX IF NOT EXISTS "AuditLog_actorId_idx" ON "AuditLog"("actorId");
CREATE INDEX IF NOT EXISTS "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");
CREATE INDEX IF NOT EXISTS "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
ALTER TABLE "AuditLog" ADD CONSTRAINT IF NOT EXISTS "AuditLog_actorId_fkey"
    FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- =============================================================================
-- Colonnes manquantes sur SystemSettings
-- =============================================================================
ALTER TABLE "SystemSettings"
  ADD COLUMN IF NOT EXISTS "glpiLocationsSyncIntervalMinutes" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "approvalReminderMinutes" INTEGER NOT NULL DEFAULT 30;

-- =============================================================================
-- Colonnes manquantes sur Ticket
-- =============================================================================
ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "lastGlpiSyncAt" TIMESTAMP(3);

-- =============================================================================
-- Colonnes manquantes sur AiEmailDraft
-- =============================================================================
ALTER TABLE "AiEmailDraft"
  ADD COLUMN IF NOT EXISTS "recipientName" TEXT;

-- =============================================================================
-- Colonnes manquantes sur GlpiLocation
-- =============================================================================
ALTER TABLE "GlpiLocation"
  ADD COLUMN IF NOT EXISTS "isCustom"  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isActive"  BOOLEAN NOT NULL DEFAULT true;

-- =============================================================================
-- Colonnes manquantes sur TicketAttachment
-- =============================================================================
ALTER TABLE "TicketAttachment"
  ADD COLUMN IF NOT EXISTS "localFilepath" TEXT;

-- =============================================================================
-- Colonnes manquantes sur IncomingEmail
-- =============================================================================
ALTER TABLE "IncomingEmail"
  ADD COLUMN IF NOT EXISTS "retryCount"  INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastError"   TEXT;

-- =============================================================================
-- Colonnes manquantes sur TriageRule
-- =============================================================================
ALTER TABLE "TriageRule"
  ADD COLUMN IF NOT EXISTS "sentiment"            TEXT,
  ADD COLUMN IF NOT EXISTS "timeWindow"           TEXT,
  ADD COLUMN IF NOT EXISTS "minTicketsLast24h"    INTEGER,
  ADD COLUMN IF NOT EXISTS "autoApproveGlpi"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "assignMode"           TEXT NOT NULL DEFAULT 'SPECIFIC',
  ADD COLUMN IF NOT EXISTS "tags"                 TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "autoEscalateMinutes"  INTEGER,
  ADD COLUMN IF NOT EXISTS "notificationWebhook"  TEXT;

-- =============================================================================
-- Table de jointure implicite M2M : _TeamDefaultObservers (Team <-> User)
-- Relation "TeamDefaultObservers" : Team.defaultObservers / User.observedTeams
-- =============================================================================
CREATE TABLE IF NOT EXISTS "_TeamDefaultObservers" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "_TeamDefaultObservers_AB_unique" ON "_TeamDefaultObservers"("A", "B");
CREATE INDEX IF NOT EXISTS "_TeamDefaultObservers_B_index" ON "_TeamDefaultObservers"("B");
ALTER TABLE "_TeamDefaultObservers" ADD CONSTRAINT IF NOT EXISTS "_TeamDefaultObservers_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "_TeamDefaultObservers" ADD CONSTRAINT IF NOT EXISTS "_TeamDefaultObservers_B_fkey"
    FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
