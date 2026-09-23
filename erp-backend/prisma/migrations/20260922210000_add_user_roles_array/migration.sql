-- Add roles array, backfill from role
ALTER TABLE "User" ADD COLUMN "roles" "Role"[] DEFAULT ARRAY['REQUESTER'::"Role"] NOT NULL;
UPDATE "User" SET "roles" = ARRAY["role"]::"Role"[] WHERE "roles" = ARRAY['REQUESTER'::"Role"];
