import { Router, type Request } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { ROLE_KEYS, type PermissionKey, type RoleKey } from '../../constants/permissions.js';
import { loadAuthUser, requirePlatformOwner } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { recordAudit } from '../../services/audit.service.js';
import { ensureOrgPolicies, ensureOrgRoles } from '../../services/org-provisioning.service.js';
import { badRequest, notFound, validationError } from '../../utils/errors.js';
import { created, ok, param } from '../../utils/http.js';
import { randomToken } from '../../utils/crypto.js';
import { forgotPassword, hashPassword } from '../auth/auth.service.js';
import { confirmImport, createImport } from '../imports/imports.service.js';
import { parseSetupWorkbook } from './setup-workbook.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

const code = z.string().trim().min(2).max(20).regex(/^[A-Z0-9-]+$/, 'Use upper-case letters, digits and dashes');
const roleKey = z.enum(Object.keys(ROLE_KEYS) as [RoleKey, ...RoleKey[]]);

const createOrgSchema = z.object({
  organisation: z.object({ name: z.string().trim().min(2).max(200), legalEntity: z.string().trim().max(200).nullable().optional() }),
  branches: z.array(z.object({ code, name: z.string().trim().min(2).max(120), address: z.string().trim().max(500).nullable().optional() })).min(1, 'Add at least one branch').max(200),
  departments: z
    .array(z.object({ branchCode: code, name: z.string().trim().min(2).max(120), ownerEmail: z.string().trim().toLowerCase().email().nullable().optional() }))
    .max(1000),
  users: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(120),
        email: z.string().trim().toLowerCase().email(),
        designation: z.string().trim().max(120).nullable().optional(),
        roleKey,
        branchCode: code.nullable().optional(),
        department: z.string().trim().max(120).nullable().optional(),
        restricted: z.array(z.string().regex(/^[a-z_]+:[a-z]+$/)).max(150).optional(),
      }),
    )
    .min(1, 'Add at least one user')
    .max(2000),
  sendInvites: z.boolean().default(true),
});
type CreateOrgInput = z.infer<typeof createOrgSchema>;

/** Cross-row checks the schema cannot express. Returns readable problems, empty when valid. */
async function validateSetup(input: CreateOrgInput): Promise<string[]> {
  const problems: string[] = [];
  if (await prisma.organisation.findUnique({ where: { name: input.organisation.name } })) problems.push(`An organisation named "${input.organisation.name}" already exists.`);
  const codes = new Set<string>();
  const names = new Set<string>();
  for (const b of input.branches) {
    if (codes.has(b.code)) problems.push(`Branch code ${b.code} is used twice.`);
    if (names.has(b.name.toLowerCase())) problems.push(`Branch name "${b.name}" is used twice.`);
    codes.add(b.code);
    names.add(b.name.toLowerCase());
  }
  const deptKeys = new Set<string>();
  for (const d of input.departments) {
    if (!codes.has(d.branchCode)) problems.push(`Department "${d.name}" refers to unknown branch ${d.branchCode}.`);
    const k = `${d.branchCode}|${d.name.toLowerCase()}`;
    if (deptKeys.has(k)) problems.push(`Branch ${d.branchCode} has two departments named "${d.name}".`);
    deptKeys.add(k);
  }
  const emails = new Map<string, string>();
  for (const u of input.users) {
    const prev = emails.get(u.email);
    if (prev && prev !== u.name) problems.push(`${u.email} appears with two different names.`);
    emails.set(u.email, u.name);
    if (u.department && !u.branchCode) problems.push(`${u.email}: a department scope also needs a branch code.`);
    if (u.branchCode && !codes.has(u.branchCode)) problems.push(`${u.email}: unknown branch ${u.branchCode}.`);
    if (u.branchCode && u.department && !deptKeys.has(`${u.branchCode}|${u.department.toLowerCase()}`)) problems.push(`${u.email}: branch ${u.branchCode} has no department "${u.department}".`);
  }
  for (const d of input.departments) if (d.ownerEmail && !emails.has(d.ownerEmail)) problems.push(`Owner ${d.ownerEmail} of "${d.name}" is not on the Users list.`);
  if (!input.users.some((u) => u.roleKey === 'SYSTEM_ADMIN' && !u.branchCode)) problems.push('Add at least one organisation-wide System Administrator (Role key SYSTEM_ADMIN, no branch code).');
  const existing = await prisma.user.findMany({ where: { email: { in: [...emails.keys()] } }, select: { email: true } });
  for (const e of existing) problems.push(`${e.email} already has an Axiarix account.`);
  const restricted = [...new Set(input.users.flatMap((u) => u.restricted ?? []))];
  if (restricted.length) {
    const known = new Set((await prisma.permission.findMany({ where: { key: { in: restricted } }, select: { key: true } })).map((p) => p.key));
    for (const k of restricted) if (!known.has(k)) problems.push(`Unknown permission "${k}" in Restricted permissions.`);
  }
  return problems;
}

export const platformRouter = Router();
platformRouter.use(requirePlatformOwner);

/** Every customer organisation with headline counts. The platform organisation itself is hidden. */
platformRouter.get('/organisations', async (_req, res) => {
  const orgs = await prisma.organisation.findMany({
    where: { isPlatform: false },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { sites: true, users: true, checklistTemplates: true, assessments: true } } },
  });
  const admins = await prisma.userRole.findMany({
    where: { organisationId: { in: orgs.map((o) => o.id) }, siteId: null, role: { key: 'SYSTEM_ADMIN' }, user: { status: 'ACTIVE' } },
    select: { organisationId: true, user: { select: { id: true, name: true, email: true, lastLoginAt: true } } },
  });
  ok(res, orgs.map((o) => ({ ...o, admins: admins.filter((a) => a.organisationId === o.id).map((a) => a.user) })));
});

/** Reads a setup workbook into a draft for the wizard. Nothing is saved. */
platformRouter.post('/organisations/parse-setup', upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Attach the setup workbook (.xlsx) in the "file" field');
  if (!/\.xlsx$/i.test(req.file.originalname)) throw badRequest('Only .xlsx workbooks can be read');
  let draft;
  try {
    draft = await parseSetupWorkbook(req.file.buffer);
  } catch {
    throw badRequest('The file could not be read as an Excel workbook');
  }
  const parsed = createOrgSchema.safeParse({ ...draft, sendInvites: true });
  const problems = parsed.success ? await validateSetup(parsed.data) : parsed.error.issues.map((i) => `${i.path.join(' › ')}: ${i.message}`);
  ok(res, { draft, problems });
});

/** Checks a setup without saving, so the wizard can show problems before the last step. */
platformRouter.post('/organisations/validate', validate(createOrgSchema), async (req, res) => {
  ok(res, { problems: await validateSetup(req.body) });
});

/**
 * Creates an organisation in one transaction: its own roles, branches, departments, users with
 * roles, scope and restrictions, department owners, and default scoring/retention policies.
 * Users receive a set-your-password invitation; nobody is given a password.
 */
platformRouter.post('/organisations', validate(createOrgSchema), async (req, res) => {
  const input = req.body as CreateOrgInput;
  const problems = await validateSetup(input);
  if (problems.length) throw validationError(`${problems.length} problem(s) to fix before the organisation can be created`, { problems });

  const result = await prisma.$transaction(
    async (tx) => {
      const org = await tx.organisation.create({ data: { name: input.organisation.name, legalEntity: input.organisation.legalEntity ?? null } });
      const roleIds = await ensureOrgRoles(tx, org.id);
      const siteIds = new Map<string, string>();
      for (const b of input.branches) {
        const s = await tx.site.create({ data: { organisationId: org.id, code: b.code, name: b.name, address: b.address ?? null } });
        siteIds.set(b.code, s.id);
      }
      const deptIds = new Map<string, string>();
      for (const d of input.departments) {
        const dep = await tx.department.create({ data: { organisationId: org.id, siteId: siteIds.get(d.branchCode)!, name: d.name } });
        deptIds.set(`${d.branchCode}|${d.name.toLowerCase()}`, dep.id);
      }
      const perms = await tx.permission.findMany({ select: { id: true, key: true } });
      const permId = new Map(perms.map((p) => [p.key, p.id]));
      const userIds = new Map<string, string>();
      for (const u of input.users) {
        let id = userIds.get(u.email);
        if (!id) {
          const created = await tx.user.create({
            data: { organisationId: org.id, email: u.email, name: u.name, designation: u.designation ?? null, passwordHash: await hashPassword(randomToken(24) + 'Aa1') },
          });
          id = created.id;
          userIds.set(u.email, id);
        }
        const siteId = u.branchCode ? siteIds.get(u.branchCode)! : null;
        const departmentId = u.branchCode && u.department ? deptIds.get(`${u.branchCode}|${u.department.toLowerCase()}`)! : null;
        await tx.userRole.create({ data: { userId: id, roleId: roleIds[u.roleKey], organisationId: org.id, siteId, departmentId } });
        for (const key of u.restricted ?? []) {
          await tx.userPermissionRestriction.upsert({
            where: { userId_permissionId: { userId: id, permissionId: permId.get(key)! } },
            create: { userId: id, permissionId: permId.get(key)!, reason: 'Set at organisation setup', createdById: req.user!.id },
            update: {},
          });
        }
      }
      for (const d of input.departments) {
        if (d.ownerEmail) await tx.department.update({ where: { id: deptIds.get(`${d.branchCode}|${d.name.toLowerCase()}`)! }, data: { ownerId: userIds.get(d.ownerEmail)! } });
      }
      const firstAdmin = input.users.find((u) => u.roleKey === 'SYSTEM_ADMIN' && !u.branchCode)!;
      await ensureOrgPolicies(tx, org.id, userIds.get(firstAdmin.email)!);
      await recordAudit(
        {
          req,
          organisationId: org.id,
          action: 'ORGANISATION_CREATED',
          entityType: 'Organisation',
          entityId: org.id,
          metadata: { name: org.name, branches: input.branches.length, departments: input.departments.length, users: userIds.size, restrictedUsers: input.users.filter((u) => u.restricted?.length).length },
        },
        tx,
      );
      return { org, userEmails: [...userIds.keys()], firstAdmin: firstAdmin.email };
    },
    { timeout: 60_000 },
  );

  let invited = 0;
  if (input.sendInvites) {
    for (const email of result.userEmails) {
      await forgotPassword(req, email, { invite: true });
      invited++;
    }
  }
  created(res, { organisation: result.org, users: result.userEmails.length, invited, firstAdmin: result.firstAdmin });
});

/** Suspend or reactivate an organisation, or correct its name. Suspended organisations cannot sign in. */
platformRouter.patch(
  '/organisations/:id',
  validate(z.object({ name: z.string().trim().min(2).max(200).optional(), legalEntity: z.string().trim().max(200).nullable().optional(), status: z.enum(['ACTIVE', 'INACTIVE']).optional(), reason: z.string().trim().min(3).max(500) })),
  async (req, res) => {
    const id = param(req, 'id');
    const org = await prisma.organisation.findFirst({ where: { id, isPlatform: false } });
    if (!org) throw notFound('Organisation');
    const { reason, ...data } = req.body as { reason: string; name?: string; legalEntity?: string | null; status?: 'ACTIVE' | 'INACTIVE' };
    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.organisation.update({ where: { id }, data });
      if (data.status === 'INACTIVE') await tx.refreshToken.updateMany({ where: { user: { organisationId: id }, revokedAt: null }, data: { revokedAt: new Date() } });
      return u;
    });
    await recordAudit({ req, organisationId: id, action: data.status === 'INACTIVE' ? 'ORGANISATION_SUSPENDED' : data.status === 'ACTIVE' ? 'ORGANISATION_REACTIVATED' : 'ORGANISATION_UPDATED', entityType: 'Organisation', entityId: id, metadata: { reason, fields: Object.keys(data) } });
    ok(res, updated);
  },
);

/**
 * Imports checklist worksheets into a new organisation as DRAFT versions, through the same import
 * pipeline the organisation uses. The organisation's ISMS owner then reviews and publishes them.
 */
platformRouter.post('/organisations/:id/checklists', upload.single('file'), async (req, res) => {
  const id = param(req, 'id');
  if (!req.file) throw badRequest('Attach the checklist workbook (.xlsx) in the "file" field');
  const org = await prisma.organisation.findFirst({ where: { id, isPlatform: false } });
  if (!org) throw notFound('Organisation');
  const actor = (await loadAuthUser(req.user!.id))!;
  // The platform owner acts inside the new organisation only for this import, with checklist:create alone.
  const scoped = {
    ...actor,
    organisationId: id,
    permissions: new Set<PermissionKey>(['checklist:create', 'checklist:read']),
    scopes: [{ role: 'ISMS_OWNER' as RoleKey, organisationId: id, siteId: null, departmentId: null, permissions: ['checklist:create', 'checklist:read'] as PermissionKey[] }],
  };
  const scopedReq = Object.assign(Object.create(Object.getPrototypeOf(req)), req, { user: scoped }) as Request;
  const imp = await createImport(scopedReq, req.file);
  const sheets = ((imp.sheetSummary as unknown as Array<{ sheetName: string; detected: boolean; errorRows?: number }>) ?? []).filter((s) => s.detected);
  if (!sheets.length) throw validationError('No worksheet in this file looks like a checklist (no "Reports / Evidence Description" column found).');
  const createdSheets = await confirmImport(scopedReq, imp.id, sheets.map((s) => ({ sheetName: s.sheetName, templateTitle: s.sheetName })), true);
  ok(res, { importId: imp.id, checklists: createdSheets });
});
