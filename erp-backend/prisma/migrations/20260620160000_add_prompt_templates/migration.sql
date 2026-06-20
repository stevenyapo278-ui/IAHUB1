CREATE TABLE IF NOT EXISTS "PromptTemplate" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    CREATE UNIQUE INDEX "PromptTemplate_key_key" ON "PromptTemplate"("key");
EXCEPTION WHEN duplicate_table THEN NULL;
END $$;
