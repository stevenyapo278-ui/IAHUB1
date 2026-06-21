CREATE TABLE IF NOT EXISTS "EmailApprovalToken" (
  "id" SERIAL PRIMARY KEY,
  "token" TEXT NOT NULL,
  "draftId" INTEGER NOT NULL REFERENCES "AiEmailDraft"("id") ON DELETE CASCADE,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "EmailApprovalToken_token_key" ON "EmailApprovalToken"("token");
CREATE INDEX IF NOT EXISTS "EmailApprovalToken_draftId_idx" ON "EmailApprovalToken"("draftId");
