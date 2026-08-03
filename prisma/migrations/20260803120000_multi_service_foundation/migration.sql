-- Clear deploy-bookkeeping service rows; config services are recreated from Project below.
DELETE FROM "Service";

-- Service becomes first-class config
ALTER TABLE "Service" ADD COLUMN "name" TEXT;
ALTER TABLE "Service" ADD COLUMN "gitRepositoryUrl" TEXT;
ALTER TABLE "Service" ADD COLUMN "branch" TEXT;
ALTER TABLE "Service" ADD COLUMN "port" INTEGER;
ALTER TABLE "Service" ADD COLUMN "domain" TEXT;
ALTER TABLE "Service" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill primary app service from Project columns
INSERT INTO "Service" (
  "id",
  "projectId",
  "name",
  "type",
  "gitRepositoryUrl",
  "branch",
  "port",
  "domain",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  p."id",
  'web',
  'app'::"ServiceType",
  p."gitRepositoryUrl",
  p."branch",
  p."appPort",
  p."domain",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Project" p;

-- Backfill optional postgres service
INSERT INTO "Service" (
  "id",
  "projectId",
  "name",
  "type",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid()::text,
  p."id",
  'postgres',
  'postgres'::"ServiceType",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Project" p
WHERE p."enablePostgres" = true;

-- Move environment variables onto the web app service
ALTER TABLE "EnvironmentVariable" ADD COLUMN "serviceId" TEXT;

UPDATE "EnvironmentVariable" ev
SET "serviceId" = s."id"
FROM "Service" s
WHERE s."projectId" = ev."projectId"
  AND s."name" = 'web'
  AND s."type" = 'app';

DELETE FROM "EnvironmentVariable" WHERE "serviceId" IS NULL;

ALTER TABLE "EnvironmentVariable" ALTER COLUMN "serviceId" SET NOT NULL;

ALTER TABLE "EnvironmentVariable" DROP CONSTRAINT "EnvironmentVariable_projectId_fkey";
ALTER TABLE "EnvironmentVariable" DROP COLUMN "projectId";

ALTER TABLE "EnvironmentVariable"
  ADD CONSTRAINT "EnvironmentVariable_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "Service"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Finalize Service constraints
ALTER TABLE "Service" ALTER COLUMN "name" SET NOT NULL;

CREATE UNIQUE INDEX "Service_projectId_name_key" ON "Service"("projectId", "name");

-- Drop app-specific columns from Project (namespace only)
ALTER TABLE "Project" DROP COLUMN "gitRepositoryUrl";
ALTER TABLE "Project" DROP COLUMN "branch";
ALTER TABLE "Project" DROP COLUMN "appPort";
ALTER TABLE "Project" DROP COLUMN "domain";
ALTER TABLE "Project" DROP COLUMN "enablePostgres";
