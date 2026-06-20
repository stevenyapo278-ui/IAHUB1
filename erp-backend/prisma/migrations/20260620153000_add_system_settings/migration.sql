CREATE TABLE IF NOT EXISTS "SystemSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "autoApproveGlpiSolutions" BOOLEAN NOT NULL DEFAULT false,
    "autoSendAiEmails" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSettings_pkey" PRIMARY KEY ("id")
);

INSERT INTO "SystemSettings" ("id", "autoApproveGlpiSolutions", "autoSendAiEmails", "updatedAt")
VALUES (1, false, false, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
