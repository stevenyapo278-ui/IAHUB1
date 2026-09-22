-- CreateTable
CREATE TABLE "FormDefinition" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "iconColor" TEXT,
    "bgColor" TEXT,
    "category" TEXT,
    "glpiUuid" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sections" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FormDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FormSubmission" (
    "id" SERIAL NOT NULL,
    "formId" INTEGER NOT NULL,
    "ticketId" INTEGER,
    "submittedById" INTEGER,
    "answers" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FormSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FormDefinition_glpiUuid_key" ON "FormDefinition"("glpiUuid");
CREATE UNIQUE INDEX "FormSubmission_ticketId_key" ON "FormSubmission"("ticketId");
CREATE INDEX "FormSubmission_formId_idx" ON "FormSubmission"("formId");
CREATE INDEX "FormSubmission_ticketId_idx" ON "FormSubmission"("ticketId");
CREATE INDEX "FormSubmission_submittedById_idx" ON "FormSubmission"("submittedById");

-- AddForeignKey
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_formId_fkey" FOREIGN KEY ("formId") REFERENCES "FormDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FormSubmission" ADD CONSTRAINT "FormSubmission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
