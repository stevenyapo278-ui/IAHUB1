-- Migration: add_hotline_role
-- Ajoute la valeur HOTLINE à l'enum Role (déclarée dans schema.prisma mais jamais migrée)

DO $$ BEGIN
  ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'HOTLINE';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
