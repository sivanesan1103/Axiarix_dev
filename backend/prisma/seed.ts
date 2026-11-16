/**
 * Development seed. Creates the reference catalogue, RBAC, the Kauvery organisation,
 * fictitious demo users and imports the REAL hospital checklist workbook through the
 * same import pipeline users use. No evidence, responses or audit observations are invented.
 *
 * Run: npm run db:seed   (refuses to run when NODE_ENV=production)
 */
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  seedIsoReferences,
  seedOrganisation,
  seedPlatform,
  seedPolicies,
  seedRbac,
  seedUsers,
  systemRequest,
} from '../src/seed/seed-lib.js';
import { confirmImport, createImport } from '../src/modules/imports/imports.service.js';
import { confirmMappings, transitionVersion } from '../src/modules/checklists/checklists.service.js';
import { assignItems, createAssessment, releaseAssessment } from '../src/modules/assessments/assessments.service.js';

const prisma = new PrismaClient();
const PASSWORD = process.env.SEED_PASSWORD ?? 'Axiarix@Dev2026';
const WORKBOOK = path.resolve('source-data/kauvery-vadapalani-it-ia-checklist.xlsx');

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  await seedIsoReferences(prisma);
  await seedRbac(prisma);
  await seedPlatform(prisma, PASSWORD);
  const ctx = await seedOrganisation(prisma, { withSecondarySite: true });
  const users = await seedUsers(prisma, ctx, PASSWORD);
  await seedPolicies(prisma, ctx.org.id, users['admin@axiarix.local']);

  if (await prisma.checklistTemplate.count({ where: { organisationId: ctx.org.id } })) {
    console.log('Checklists already present – skipping workbook import and demo assessment.');
    return;
  }
  if (!fs.existsSync(WORKBOOK)) {
    console.warn(`Workbook not found at ${WORKBOOK}; skipping import.`);
    return;
  }

  // 1. Import both worksheets through the real import pipeline.
  const ismsReq = await systemRequest(users['isms@axiarix.local']);
  const buffer = fs.readFileSync(WORKBOOK);
  const imp = await createImport(ismsReq, { originalname: path.basename(WORKBOOK), buffer, size: buffer.length });
  const created = await confirmImport(
    ismsReq,
    imp.id,
    [
      { sheetName: 'Last Year - IA -Checklist', templateTitle: 'Kauvery Vadapalani IT – IA Checklist (Last Year)' },
      { sheetName: 'Internal Audit -Checklist (2)', templateTitle: 'Kauvery Vadapalani IT – Internal Audit Checklist' },
    ],
    false,
  );
  console.log('Imported checklists:', created.map((c) => `${c.sheetName} → ${c.items} items`).join('; '));

  // 2. Publish the current internal-audit checklist so a demo assessment can be created.
  //    Four-eyes: the ISMS owner submits, the administrator (named reviewer) confirms the
  //    import-flagged mappings and publishes. Each confirmation carries a recorded note.
  const current = created.find((c) => c.sheetName === 'Internal Audit -Checklist (2)')!;
  const adminReq = await systemRequest(users['admin@axiarix.local']);
  await transitionVersion(ismsReq, current.versionId, 'submit', { reviewerId: users['admin@axiarix.local'] });
  const flagged = await prisma.checklistItem.findMany({ where: { versionId: current.versionId, mappings: { some: { needsReview: true } } }, select: { id: true } });
  for (const f of flagged) {
    await confirmMappings(adminReq, f.id, 'Development seed: confirmed for demo use only. A competent ISO 27001 practitioner must review before production use.');
  }
  await transitionVersion(adminReq, current.versionId, 'publish', { reason: 'Development seed publication' });

  // 3. One demo assessment for Q3 FY2026-27, released to IT with a few assignments – no answers or evidence.
  const assessment = await createAssessment(ismsReq, {
    title: 'IT & IT Data Centre – Quarterly Internal Assessment',
    siteId: ctx.primary.id,
    departmentId: ctx.primaryDept.id,
    checklistVersionId: current.versionId,
    periodLabel: 'Q3 FY2026-27',
    periodStart: new Date('2026-10-01T00:00:00Z'),
    periodEnd: new Date('2026-12-31T00:00:00Z'),
    startDate: new Date('2026-11-01T00:00:00Z'),
    dueDate: new Date('2026-12-15T00:00:00Z'),
    ownerId: users['itowner@axiarix.local'],
    scope: 'ISO/IEC 27001:2022 internal assessment of the IT & IT Data Centre, Kauvery Hospital Vadapalani (pilot).',
    approvalRequired: true,
  });
  await releaseAssessment(ismsReq, assessment.id);
  const items = await prisma.checklistItem.findMany({ where: { versionId: current.versionId }, orderBy: { sequence: 'asc' }, take: 12 });
  const ownerReq = await systemRequest(users['itowner@axiarix.local']);
  await assignItems(ownerReq, assessment.id, items.map((i) => i.id), users['contributor@axiarix.local'], new Date('2026-12-05T00:00:00Z'));
  console.log(`Demo assessment ${assessment.code} created and assigned.`);
}

main()
  .then(() => console.log(`Seed complete. Demo password for all dev accounts: ${PASSWORD}`))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
