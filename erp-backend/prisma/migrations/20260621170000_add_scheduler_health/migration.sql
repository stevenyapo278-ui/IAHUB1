CREATE TABLE IF NOT EXISTS "SchedulerHealth" (
  "id" SERIAL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "lastFailureAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "alertSentAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "SchedulerHealth_name_key" ON "SchedulerHealth"("name");
