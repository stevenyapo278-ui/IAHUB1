-- CreateIndex
CREATE INDEX "IncomingEmail_receivedAt_idx" ON "IncomingEmail"("receivedAt");

-- CreateIndex
CREATE INDEX "IncomingEmail_fromEmail_idx" ON "IncomingEmail"("fromEmail");

-- CreateIndex
CREATE INDEX "IncomingEmail_status_idx" ON "IncomingEmail"("status");

-- CreateIndex
CREATE INDEX "IncomingEmail_isRead_idx" ON "IncomingEmail"("isRead");

-- CreateIndex
CREATE INDEX "IncomingEmail_status_receivedAt_idx" ON "IncomingEmail"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "IncomingEmail_folderId_receivedAt_idx" ON "IncomingEmail"("folderId", "receivedAt");
