-- DropIndex
DROP INDEX "Role_key_key";

-- AlterTable
ALTER TABLE "ChecklistVersion" ADD COLUMN     "reviewerId" TEXT,
ADD COLUMN     "submittedById" TEXT;

-- AlterTable
ALTER TABLE "Organisation" ADD COLUMN     "isPlatform" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: roles become per-organisation. Existing (single-tenant) roles belong to the
-- oldest organisation; on an empty database this is a no-op.
ALTER TABLE "Role" ADD COLUMN     "organisationId" TEXT;
UPDATE "Role" SET "organisationId" = (SELECT id FROM "Organisation" ORDER BY "createdAt" ASC LIMIT 1) WHERE "organisationId" IS NULL;
DELETE FROM "RolePermission" WHERE "roleId" IN (SELECT id FROM "Role" WHERE "organisationId" IS NULL);
DELETE FROM "Role" WHERE "organisationId" IS NULL;
ALTER TABLE "Role" ALTER COLUMN "organisationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isPlatformOwner" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "UserPermissionRestriction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPermissionRestriction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistReviewComment" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "itemId" TEXT,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChecklistReviewComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserPermissionRestriction_userId_permissionId_key" ON "UserPermissionRestriction"("userId", "permissionId");

-- CreateIndex
CREATE INDEX "ChecklistReviewComment_versionId_idx" ON "ChecklistReviewComment"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_organisationId_key_key" ON "Role"("organisationId", "key");

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionRestriction" ADD CONSTRAINT "UserPermissionRestriction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPermissionRestriction" ADD CONSTRAINT "UserPermissionRestriction_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistReviewComment" ADD CONSTRAINT "ChecklistReviewComment_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ChecklistVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistReviewComment" ADD CONSTRAINT "ChecklistReviewComment_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ChecklistItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

