import type { Request } from 'express';
import type { ChecklistVersionStatus, Prisma } from '@prisma/client';
import { prisma, type Tx } from '../../config/prisma.js';
import { ANNEX_CODES, ANNEX_THEMES, CLAUSE_CODES } from '../../constants/iso27001.js';
import { recordAudit } from '../../services/audit.service.js';
import { recordTransition } from '../../services/workflow.service.js';
import { badRequest, forbidden, invalidState, notFound, validationError } from '../../utils/errors.js';
import { loadAuthUser } from '../../middleware/auth.js';
import { notify } from '../../services/notification.service.js';
import { sodError } from '../../services/sod.service.js';

export const itemInclude = {
  mappings: { orderBy: [{ type: 'asc' }, { reference: 'asc' }] },
  defaultOwner: { select: { id: true, name: true, email: true } },
} satisfies Prisma.ChecklistItemInclude;

export interface ItemInput {
  question: string;
  description?: string | null;
  guidance?: string | null;
  internalPolicyRef?: string | null;
  riskRef?: string | null;
  evidenceRequirement?: string | null;
  evidenceMandatory?: boolean;
  responseMandatory?: boolean;
  defaultOwnerId?: string | null;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category?: string | null;
  status?: 'ACTIVE' | 'INACTIVE';
  isoClauseRaw?: string | null;
  annexControlRaw?: string | null;
}

export interface MappingInput {
  type: 'ISO_CLAUSE' | 'ANNEX_A' | 'INTERNAL_POLICY' | 'RISK';
  reference: string;
  title?: string | null;
}

async function getVersionForOrg(versionId: string, organisationId: string, db: Tx = prisma) {
  const version = await db.checklistVersion.findFirst({
    where: { id: versionId, template: { organisationId } },
    include: { template: true },
  });
  if (!version) throw notFound('Checklist version');
  return version;
}

/** Only DRAFT versions are editable. Published versions are immutable (FR-007) – also enforced by a DB trigger. */
export async function getEditableVersion(versionId: string, organisationId: string, db: Tx = prisma) {
  const version = await getVersionForOrg(versionId, organisationId, db);
  if (version.status !== 'DRAFT') {
    throw invalidState(`Version ${version.versionNumber} is ${version.status.replace('_', ' ').toLowerCase()} and cannot be edited. Create a new version instead.`);
  }
  return version;
}

async function getEditableItem(itemId: string, organisationId: string, db: Tx = prisma) {
  const item = await db.checklistItem.findFirst({ where: { id: itemId, version: { template: { organisationId } } } });
  if (!item) throw notFound('Checklist item');
  await getEditableVersion(item.versionId, organisationId, db);
  return item;
}

/** Validates ISO references against the catalogue so mappings cannot drift from the standard. */
export function validateMappings(mappings: MappingInput[]) {
  const errors: string[] = [];
  for (const m of mappings) {
    if (m.type === 'ISO_CLAUSE' && !CLAUSE_CODES.has(m.reference)) errors.push(`${m.reference} is not an ISO/IEC 27001:2022 clause (4–10)`);
    if (m.type === 'ANNEX_A' && !ANNEX_CODES.has(m.reference)) errors.push(`${m.reference} is not an Annex A control (5.1–8.34)`);
  }
  if (errors.length) throw validationError('Invalid ISO mapping', { mappings: errors });
}

export function deriveCategory(mappings: { type: string; reference: string }[]): string | null {
  const annex = mappings.find((m) => m.type === 'ANNEX_A');
  if (annex) return ANNEX_THEMES[annex.reference.split('.')[0]] ?? null;
  return mappings.some((m) => m.type === 'ISO_CLAUSE') ? 'ISMS clause requirement' : null;
}

async function nextQuestionCode(versionId: string, db: Tx) {
  const items = await db.checklistItem.findMany({ where: { versionId }, select: { questionCode: true, sequence: true } });
  const maxSeq = items.reduce((m, i) => Math.max(m, i.sequence), 0);
  let n = items.length + 1;
  const codes = new Set(items.map((i) => i.questionCode));
  while (codes.has(`Q-${String(n).padStart(3, '0')}`)) n++;
  return { code: `Q-${String(n).padStart(3, '0')}`, sequence: maxSeq + 1 };
}

export async function createTemplate(req: Request, input: { title: string; description?: string | null; category?: string | null; ownerId?: string | null }) {
  const user = req.user!;
  const template = await prisma.$transaction(async (tx) => {
    const t = await tx.checklistTemplate.create({
      data: { ...input, organisationId: user.organisationId, createdById: user.id },
    });
    const v = await tx.checklistVersion.create({ data: { templateId: t.id, versionNumber: 1, createdById: user.id, changeSummary: 'Initial version' } });
    await recordTransition(tx, 'ChecklistVersion', v.id, null, 'DRAFT', user.id);
    await recordAudit({ req, action: 'CHECKLIST_CREATED', entityType: 'ChecklistTemplate', entityId: t.id, metadata: { title: t.title } }, tx);
    return t;
  });
  return template;
}

export async function addItem(req: Request, versionId: string, input: ItemInput, mappings: MappingInput[] = []) {
  validateMappings(mappings);
  return prisma.$transaction(async (tx) => {
    await getEditableVersion(versionId, req.user!.organisationId, tx);
    const { code, sequence } = await nextQuestionCode(versionId, tx);
    const item = await tx.checklistItem.create({
      data: {
        ...input,
        versionId,
        questionCode: code,
        sequence,
        category: input.category ?? deriveCategory(mappings),
        mappings: { createMany: { data: mappings.map((m) => ({ type: m.type, reference: m.reference, title: m.title ?? null })) } },
      },
      include: itemInclude,
    });
    await recordAudit({ req, action: 'CHECKLIST_ITEM_ADDED', entityType: 'ChecklistItem', entityId: item.id, metadata: { versionId, questionCode: code } }, tx);
    return item;
  });
}

export async function updateItem(req: Request, itemId: string, input: Partial<ItemInput>) {
  return prisma.$transaction(async (tx) => {
    const before = await getEditableItem(itemId, req.user!.organisationId, tx);
    const item = await tx.checklistItem.update({ where: { id: itemId }, data: input, include: itemInclude });
    await recordAudit(
      { req, action: 'CHECKLIST_ITEM_UPDATED', entityType: 'ChecklistItem', entityId: itemId, metadata: { versionId: before.versionId, fields: Object.keys(input) } },
      tx,
    );
    return item;
  });
}

export async function deleteItem(req: Request, itemId: string) {
  await prisma.$transaction(async (tx) => {
    const item = await getEditableItem(itemId, req.user!.organisationId, tx);
    await tx.checklistItem.delete({ where: { id: itemId } });
    await recordAudit({ req, action: 'CHECKLIST_ITEM_DELETED', entityType: 'ChecklistItem', entityId: itemId, metadata: { versionId: item.versionId, questionCode: item.questionCode } }, tx);
  });
}

export async function reorderItems(req: Request, versionId: string, itemIds: string[]) {
  await prisma.$transaction(async (tx) => {
    await getEditableVersion(versionId, req.user!.organisationId, tx);
    const items = await tx.checklistItem.findMany({ where: { versionId }, select: { id: true } });
    const known = new Set(items.map((i) => i.id));
    if (itemIds.length !== items.length || itemIds.some((id) => !known.has(id))) {
      throw badRequest('Reorder list must contain every item of the version exactly once');
    }
    for (const [i, id] of itemIds.entries()) await tx.checklistItem.update({ where: { id }, data: { sequence: i + 1 } });
    await recordAudit({ req, action: 'CHECKLIST_REORDERED', entityType: 'ChecklistVersion', entityId: versionId }, tx);
  });
}

/** Replaces an item's mappings. Saving through this path is the reviewer's confirmation, so `needsReview` is cleared. */
export async function setMappings(req: Request, itemId: string, mappings: MappingInput[]) {
  validateMappings(mappings);
  return prisma.$transaction(async (tx) => {
    const item = await getEditableItem(itemId, req.user!.organisationId, tx);
    const before = await tx.controlMapping.findMany({ where: { itemId } });
    await tx.controlMapping.deleteMany({ where: { itemId } });
    await tx.controlMapping.createMany({ data: mappings.map((m) => ({ itemId, type: m.type, reference: m.reference, title: m.title ?? null })) });
    await recordAudit(
      {
        req,
        action: 'CONTROL_MAPPING_CHANGED',
        entityType: 'ChecklistItem',
        entityId: itemId,
        metadata: {
          versionId: item.versionId,
          before: before.map((m) => `${m.type}:${m.reference}${m.needsReview ? '(review)' : ''}`),
          after: mappings.map((m) => `${m.type}:${m.reference}`),
        },
      },
      tx,
    );
    return tx.checklistItem.findUniqueOrThrow({ where: { id: itemId }, include: itemInclude });
  });
}

const TRANSITIONS: Record<string, { from: ChecklistVersionStatus[]; to: ChecklistVersionStatus; action: string }> = {
  submit: { from: ['DRAFT'], to: 'UNDER_REVIEW', action: 'CHECKLIST_SUBMITTED_FOR_REVIEW' },
  return: { from: ['UNDER_REVIEW'], to: 'DRAFT', action: 'CHECKLIST_RETURNED_TO_DRAFT' },
  publish: { from: ['UNDER_REVIEW'], to: 'PUBLISHED', action: 'CHECKLIST_PUBLISHED' },
  archive: { from: ['PUBLISHED'], to: 'ARCHIVED', action: 'CHECKLIST_ARCHIVED' },
};

/**
 * Moves a checklist version through Draft → Under Review → Published → Archived.
 *
 * Four-eyes rule (ISO/IEC 27001 A.5.3): submitting names a reviewer who holds checklist:approve and
 * is neither the version's author nor the submitter. Only that reviewer may publish or return it.
 * Publishing also requires every import-flagged ISO mapping to be resolved (confirmed or corrected);
 * blanket acknowledgement is no longer accepted.
 */
export async function transitionVersion(
  req: Request,
  versionId: string,
  op: keyof typeof TRANSITIONS,
  opts: { reason?: string; reviewerId?: string; effectiveDate?: Date } = {},
) {
  const t = TRANSITIONS[op];
  const user = req.user!;
  const result = await prisma.$transaction(async (tx) => {
    const version = await getVersionForOrg(versionId, user.organisationId, tx);
    if (!t.from.includes(version.status)) throw invalidState(`Cannot ${op} a ${version.status} version`);
    if (op === 'return' && !opts.reason) throw validationError('A reason is required to return a version to draft');

    let reviewerId: string | null = version.reviewerId;
    if (op === 'submit') {
      const items = await tx.checklistItem.count({ where: { versionId, status: 'ACTIVE' } });
      if (!items) throw validationError('A checklist version needs at least one active question');
      if (!opts.reviewerId) throw validationError('Choose a reviewer for this version', { fieldErrors: { reviewerId: ['Required'] } });
      if (opts.reviewerId === user.id || opts.reviewerId === version.createdById) {
        throw sodError('The reviewer must be someone other than the author or the person submitting.');
      }
      const reviewer = await loadAuthUser(opts.reviewerId);
      if (!reviewer || reviewer.organisationId !== user.organisationId || !reviewer.permissions.has('checklist:approve')) {
        throw validationError('The chosen reviewer cannot approve checklists', { fieldErrors: { reviewerId: ['Pick someone with checklist approval rights'] } });
      }
      reviewerId = reviewer.id;
    }

    if (op === 'publish' || op === 'return') {
      if (version.createdById === user.id || version.submittedById === user.id) {
        throw sodError('You wrote or submitted this version, so the named reviewer must publish or return it.');
      }
      if (version.reviewerId && version.reviewerId !== user.id) {
        throw sodError('Only the named reviewer can publish or return this version.');
      }
    }

    if (op === 'publish') {
      const flagged = await tx.checklistItem.findMany({
        where: { versionId, status: 'ACTIVE', mappings: { some: { needsReview: true } } },
        select: { id: true, questionCode: true, mappings: { where: { needsReview: true }, select: { type: true, reference: true } } },
      });
      if (flagged.length) {
        throw validationError(`${flagged.length} question(s) still have ISO mappings to resolve. Confirm or correct each one before publishing.`, {
          mappingReview: flagged.map((i) => ({ itemId: i.id, questionCode: i.questionCode, references: i.mappings.map((m) => `${m.type === 'ANNEX_A' ? 'A.' : 'Cl. '}${m.reference}`) })),
        });
      }
      const openComments = await tx.checklistReviewComment.count({ where: { versionId, resolvedAt: null } });
      if (openComments) throw validationError(`${openComments} review comment(s) are still open. Return the version to the author or resolve them first.`);
      // Only one published version per template is current; the previous one is archived, never deleted.
      const current = await tx.checklistVersion.findMany({ where: { templateId: version.templateId, status: 'PUBLISHED' } });
      for (const c of current) {
        await tx.checklistVersion.update({ where: { id: c.id }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
        await recordTransition(tx, 'ChecklistVersion', c.id, 'PUBLISHED', 'ARCHIVED', user.id, `Superseded by version ${version.versionNumber}`);
      }
    }

    const updated = await tx.checklistVersion.update({
      where: { id: versionId },
      data: {
        status: t.to,
        ...(op === 'submit' ? { submittedAt: new Date(), submittedById: user.id, reviewerId } : {}),
        ...(op === 'publish' ? { publishedAt: new Date(), publishedById: user.id, effectiveDate: opts.effectiveDate ?? new Date() } : {}),
        ...(op === 'archive' ? { archivedAt: new Date() } : {}),
      },
    });
    await recordTransition(tx, 'ChecklistVersion', versionId, version.status, t.to, user.id, opts.reason);
    await recordAudit(
      {
        req,
        action: t.action,
        entityType: 'ChecklistVersion',
        entityId: versionId,
        metadata: { template: version.template.title, versionNumber: version.versionNumber, reason: opts.reason ?? null, reviewerId: op === 'submit' ? reviewerId : undefined },
      },
      tx,
    );
    return { updated, version, reviewerId };
  });
  if (op === 'submit' && result.reviewerId) {
    await notify({
      userIds: [result.reviewerId],
      type: 'APPROVAL_REQUESTED',
      title: `Checklist review requested: ${result.version.template.title}`,
      body: `${user.name} asked you to review version ${result.version.versionNumber}.`,
      link: `/checklists/${result.version.templateId}/versions/${versionId}`,
    });
  } else if (op === 'return' && result.version.submittedById) {
    await notify({
      userIds: [result.version.submittedById],
      type: 'CLARIFICATION_REQUESTED',
      title: `Checklist returned: ${result.version.template.title}`,
      body: opts.reason ?? 'The reviewer returned the version with comments.',
      link: `/checklists/${result.version.templateId}/versions/${versionId}`,
    });
  }
  return result.updated;
}

// ───────────── Review comments and mapping resolution ─────────────

export async function listReviewComments(req: Request, versionId: string) {
  await getVersionForOrg(versionId, req.user!.organisationId);
  const comments = await prisma.checklistReviewComment.findMany({ where: { versionId }, orderBy: { createdAt: 'asc' }, include: { item: { select: { id: true, questionCode: true } } } });
  const ids = [...new Set(comments.flatMap((c) => [c.authorId, c.resolvedById]).filter((x): x is string => !!x))];
  const people = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const name = (id: string | null) => (id ? (people.find((p) => p.id === id) ?? null) : null);
  return comments.map((c) => ({ ...c, author: name(c.authorId), resolvedBy: name(c.resolvedById) }));
}

export async function addReviewComment(req: Request, versionId: string, input: { itemId?: string | null; body: string }) {
  const version = await getVersionForOrg(versionId, req.user!.organisationId);
  if (!['DRAFT', 'UNDER_REVIEW'].includes(version.status)) throw invalidState('Comments can only be added before the version is published');
  if (input.itemId && !(await prisma.checklistItem.findFirst({ where: { id: input.itemId, versionId } }))) throw notFound('Question');
  const c = await prisma.checklistReviewComment.create({ data: { versionId, itemId: input.itemId ?? null, authorId: req.user!.id, body: input.body } });
  await recordAudit({ req, action: 'CHECKLIST_REVIEW_COMMENT_ADDED', entityType: 'ChecklistVersion', entityId: versionId, metadata: { itemId: input.itemId ?? null } });
  return c;
}

export async function resolveReviewComment(req: Request, commentId: string) {
  const c = await prisma.checklistReviewComment.findUnique({ where: { id: commentId } });
  if (!c) throw notFound('Comment');
  const version = await getVersionForOrg(c.versionId, req.user!.organisationId);
  if (!['DRAFT', 'UNDER_REVIEW'].includes(version.status)) throw invalidState('This version is no longer open for review');
  if (c.resolvedAt) return c;
  const updated = await prisma.checklistReviewComment.update({ where: { id: commentId }, data: { resolvedAt: new Date(), resolvedById: req.user!.id } });
  await recordAudit({ req, action: 'CHECKLIST_REVIEW_COMMENT_RESOLVED', entityType: 'ChecklistVersion', entityId: c.versionId, metadata: { commentId } });
  return updated;
}

/**
 * Confirms an item's import-flagged mappings as correct. Allowed for the author while in draft,
 * or for the named reviewer while under review. Correcting a mapping instead goes through setMappings (draft only).
 */
export async function confirmMappings(req: Request, itemId: string, note?: string | null) {
  const item = await prisma.checklistItem.findFirst({ where: { id: itemId, version: { template: { organisationId: req.user!.organisationId } } }, include: { version: true, mappings: true } });
  if (!item) throw notFound('Question');
  const v = item.version;
  const user = req.user!;
  if (v.status === 'DRAFT') {
    if (!user.permissions.has('checklist:update')) throw forbidden();
  } else if (v.status === 'UNDER_REVIEW') {
    if (v.reviewerId !== user.id) throw sodError('Only the named reviewer can confirm mappings while the version is under review.');
  } else {
    throw invalidState('Mappings can only be confirmed before publishing');
  }
  const flagged = item.mappings.filter((m) => m.needsReview);
  if (!flagged.length) return prisma.checklistItem.findUniqueOrThrow({ where: { id: itemId }, include: itemInclude });
  await prisma.$transaction(async (tx) => {
    await tx.controlMapping.updateMany({ where: { itemId, needsReview: true }, data: { needsReview: false } });
    await recordAudit(
      { req, action: 'CONTROL_MAPPING_CONFIRMED', entityType: 'ChecklistItem', entityId: itemId, metadata: { versionId: v.id, questionCode: item.questionCode, confirmed: flagged.map((m) => `${m.type}:${m.reference}`), note: note ?? null } },
      tx,
    );
  });
  return prisma.checklistItem.findUniqueOrThrow({ where: { id: itemId }, include: itemInclude });
}

/** Creates a new DRAFT version by copying items and mappings from an existing version. */
export async function createNewVersion(req: Request, templateId: string, fromVersionId: string | undefined, changeSummary: string) {
  return prisma.$transaction(async (tx) => {
    const template = await tx.checklistTemplate.findFirst({ where: { id: templateId, organisationId: req.user!.organisationId }, include: { versions: true } });
    if (!template) throw notFound('Checklist');
    if (template.versions.some((v) => v.status === 'DRAFT' || v.status === 'UNDER_REVIEW')) {
      throw invalidState('This checklist already has a draft or under-review version. Finish or archive it first.');
    }
    const source =
      template.versions.find((v) => v.id === fromVersionId) ??
      [...template.versions].sort((a, b) => b.versionNumber - a.versionNumber).find((v) => v.status === 'PUBLISHED') ??
      [...template.versions].sort((a, b) => b.versionNumber - a.versionNumber)[0];
    const versionNumber = Math.max(...template.versions.map((v) => v.versionNumber)) + 1;
    const version = await tx.checklistVersion.create({ data: { templateId, versionNumber, changeSummary, createdById: req.user!.id } });
    if (source) {
      const items = await tx.checklistItem.findMany({ where: { versionId: source.id }, include: { mappings: true }, orderBy: { sequence: 'asc' } });
      for (const i of items) {
        await tx.checklistItem.create({
          data: {
            versionId: version.id,
            questionCode: i.questionCode,
            sequence: i.sequence,
            question: i.question,
            description: i.description,
            guidance: i.guidance,
            isoClauseRaw: i.isoClauseRaw,
            annexControlRaw: i.annexControlRaw,
            internalPolicyRef: i.internalPolicyRef,
            riskRef: i.riskRef,
            evidenceRequirement: i.evidenceRequirement,
            evidenceMandatory: i.evidenceMandatory,
            responseMandatory: i.responseMandatory,
            defaultOwnerId: i.defaultOwnerId,
            priority: i.priority,
            category: i.category,
            status: i.status,
            mappings: { createMany: { data: i.mappings.map((m) => ({ type: m.type, reference: m.reference, title: m.title, needsReview: m.needsReview })) } },
          },
        });
      }
    }
    await recordTransition(tx, 'ChecklistVersion', version.id, null, 'DRAFT', req.user!.id, changeSummary);
    await recordAudit({ req, action: 'CHECKLIST_VERSION_CREATED', entityType: 'ChecklistVersion', entityId: version.id, metadata: { templateId, versionNumber, fromVersion: source?.versionNumber ?? null } }, tx);
    return version;
  });
}
