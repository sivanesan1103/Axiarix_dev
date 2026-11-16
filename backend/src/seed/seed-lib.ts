import type { Request } from 'express';
import type { PrismaClient } from '@prisma/client';
import { ANNEX_A, ANNEX_THEMES, CLAUSES, CLAUSE_GROUPS, refSortKey } from '../constants/iso27001.js';
import type { RoleKey } from '../constants/permissions.js';
import { ensureOrgPolicies, ensureOrgRoles, ensurePermissions } from '../services/org-provisioning.service.js';
import { loadAuthUser } from '../middleware/auth.js';
import { hashPassword } from '../modules/auth/auth.service.js';

/** ISO/IEC 27001:2022 reference catalogue (idempotent). */
export async function seedIsoReferences(prisma: PrismaClient) {
  for (const c of CLAUSES) {
    const top = c.code.split('.')[0];
    await prisma.isoReference.upsert({
      where: { id: `CL-${c.code}` },
      create: { id: `CL-${c.code}`, code: c.code, type: 'CLAUSE', title: c.title, theme: CLAUSE_GROUPS[top], parent: top, sortKey: refSortKey(c.code) },
      update: { title: c.title, theme: CLAUSE_GROUPS[top] },
    });
  }
  for (const a of ANNEX_A) {
    const top = a.code.split('.')[0];
    await prisma.isoReference.upsert({
      where: { id: `A-${a.code}` },
      create: { id: `A-${a.code}`, code: a.code, type: 'ANNEX_A', title: a.title, theme: ANNEX_THEMES[top], parent: top, sortKey: refSortKey(a.code) },
      update: { title: a.title, theme: ANNEX_THEMES[top] },
    });
  }
}

/** Global permission catalogue. Roles are per organisation and are created with the organisation. */
export async function seedRbac(prisma: PrismaClient) {
  await ensurePermissions(prisma);
}

/** Internal organisation holding platform-owner accounts (no roles, no audit data). */
export async function seedPlatform(prisma: PrismaClient, password: string, email = 'platform@axiarix.local') {
  const org = await prisma.organisation.upsert({
    where: { name: 'Axiarix Platform' },
    create: { name: 'Axiarix Platform', legalEntity: 'Platform administration', isPlatform: true },
    update: { isPlatform: true },
  });
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: 'Platform Owner', designation: 'Axiarix platform owner', organisationId: org.id, passwordHash: await hashPassword(password), isPlatformOwner: true },
    update: { isPlatformOwner: true },
  });
  return { org, user };
}

export interface DemoUserSpec {
  email: string;
  name: string;
  designation: string;
  role: RoleKey;
  site?: 'primary' | 'secondary';
  departmentScoped?: boolean;
}

/** Development-only accounts. These are fictitious people; never use real hospital credentials. */
export const DEMO_USERS: DemoUserSpec[] = [
  { email: 'admin@axiarix.local', name: 'Arjun Mehta', designation: 'System Administrator', role: 'SYSTEM_ADMIN' },
  { email: 'isms@axiarix.local', name: 'Lakshmi Iyer', designation: 'ISMS / Compliance Owner', role: 'ISMS_OWNER' },
  { email: 'itowner@axiarix.local', name: 'Karthik Raman', designation: 'IT Department Head', role: 'IT_OWNER', site: 'primary', departmentScoped: true },
  { email: 'contributor@axiarix.local', name: 'Divya Sundar', designation: 'IT Infrastructure Engineer', role: 'CONTRIBUTOR', site: 'primary', departmentScoped: true },
  { email: 'auditor@axiarix.local', name: 'Rahul Varma', designation: 'Internal Auditor', role: 'AUDITOR' },
  { email: 'management@axiarix.local', name: 'Meera Krishnan', designation: 'Hospital Management', role: 'MANAGEMENT' },
  { email: 'itowner.alwarpet@axiarix.local', name: 'Suresh Babu', designation: 'IT Head – Alwarpet (demo branch)', role: 'IT_OWNER', site: 'secondary', departmentScoped: true },
];

export async function seedOrganisation(prisma: PrismaClient, opts: { withSecondarySite: boolean }) {
  const org = await prisma.organisation.upsert({
    where: { name: 'Kauvery Hospitals Group' },
    create: { name: 'Kauvery Hospitals Group', legalEntity: 'Kauvery Hospitals Group' },
    update: {},
  });
  await ensureOrgRoles(prisma, org.id);
  const primary = await prisma.site.upsert({
    where: { organisationId_code: { organisationId: org.id, code: 'KVP' } },
    create: { organisationId: org.id, name: 'Vadapalani', code: 'KVP', address: 'Vadapalani, Chennai' },
    update: {},
  });
  const primaryDept = await prisma.department.upsert({
    where: { siteId_name: { siteId: primary.id, name: 'IT & IT Data Centre' } },
    create: { organisationId: org.id, siteId: primary.id, name: 'IT & IT Data Centre' },
    update: {},
  });
  let secondary = null;
  let secondaryDept = null;
  if (opts.withSecondarySite) {
    // Demonstration branch used to exercise multi-site reporting and cross-branch access controls.
    secondary = await prisma.site.upsert({
      where: { organisationId_code: { organisationId: org.id, code: 'KAL-DEMO' } },
      create: { organisationId: org.id, name: 'Alwarpet (demo branch)', code: 'KAL-DEMO', address: 'Demo data – not a pilot site' },
      update: {},
    });
    secondaryDept = await prisma.department.upsert({
      where: { siteId_name: { siteId: secondary.id, name: 'IT & IT Data Centre' } },
      create: { organisationId: org.id, siteId: secondary.id, name: 'IT & IT Data Centre' },
      update: {},
    });
  }
  return { org, primary, primaryDept, secondary, secondaryDept };
}

export async function seedUsers(prisma: PrismaClient, ctx: Awaited<ReturnType<typeof seedOrganisation>>, password: string, specs = DEMO_USERS) {
  const hash = await hashPassword(password);
  const out: Record<string, string> = {};
  for (const u of specs) {
    if (u.site === 'secondary' && !ctx.secondary) continue;
    const site = u.site === 'secondary' ? ctx.secondary! : u.site === 'primary' ? ctx.primary : null;
    const dept = u.departmentScoped ? (u.site === 'secondary' ? ctx.secondaryDept! : ctx.primaryDept) : null;
    const role = await prisma.role.findUniqueOrThrow({ where: { organisationId_key: { organisationId: ctx.org.id, key: u.role } } });
    const user = await prisma.user.upsert({
      where: { email: u.email },
      create: { email: u.email, name: u.name, designation: u.designation, organisationId: ctx.org.id, passwordHash: hash },
      update: {},
    });
    const exists = await prisma.userRole.findFirst({ where: { userId: user.id, roleId: role.id } });
    if (!exists) await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, organisationId: ctx.org.id, siteId: site?.id ?? null, departmentId: dept?.id ?? null } });
    out[u.email] = user.id;
  }
  const itOwner = out['itowner@axiarix.local'];
  if (itOwner) await prisma.department.update({ where: { id: ctx.primaryDept.id }, data: { ownerId: itOwner } });
  if (ctx.secondaryDept && out['itowner.alwarpet@axiarix.local']) await prisma.department.update({ where: { id: ctx.secondaryDept.id }, data: { ownerId: out['itowner.alwarpet@axiarix.local'] } });
  return out;
}

export async function seedPolicies(prisma: PrismaClient, organisationId: string, approvedById: string) {
  await ensureOrgPolicies(prisma, organisationId, approvedById);
}

/** Minimal request-shaped object so seeding reuses the real services (and their audit events). */
export async function systemRequest(userId: string): Promise<Request> {
  const user = await loadAuthUser(userId);
  if (!user) throw new Error('Seed user missing');
  return { user, ip: '127.0.0.1', get: (h: string) => (h.toLowerCase() === 'user-agent' ? 'axiarix-seed' : undefined) } as unknown as Request;
}
