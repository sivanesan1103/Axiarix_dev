-- Deletion requests belong to one organisation (multi-organisation isolation).
ALTER TABLE "DeletionRequest" ADD COLUMN "organisationId" TEXT;

UPDATE "DeletionRequest" d SET "organisationId" = e."organisationId"
  FROM "Evidence" e WHERE d."entityType" = 'Evidence' AND d."entityId" = e."id";
UPDATE "DeletionRequest" d SET "organisationId" = r."organisationId"
  FROM "Report" r WHERE d."entityType" = 'Report' AND d."entityId" = r."id";

CREATE INDEX "DeletionRequest_organisationId_status_idx" ON "DeletionRequest"("organisationId", "status");
