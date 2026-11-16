import crypto from 'node:crypto';
import type { Request } from 'express';
import type { EvidenceClassification } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { recordAudit, recordAuditSafe } from '../../services/audit.service.js';
import { scanBuffer } from '../../services/malware.service.js';
import { assertUnitAccess, type UnitRef } from '../../services/scope.service.js';
import { getSetting, nextCode } from '../../services/settings.service.js';
import { storage } from '../../services/storage/index.js';
import { AppError, badRequest, forbidden, invalidState, notFound, validationError } from '../../utils/errors.js';
import { sha256 } from '../../utils/crypto.js';
import { assertCanEditItem, loadAssessment } from '../assessments/assessments.service.js';
import { checkFile, sanitizeFilename } from './file-validation.js';

export interface EvidenceLinkInput {
  assessmentId?: string | null;
  itemId?: string | null;
  findingId?: string | null;
  correctiveActionId?: string | null;
}

interface ResolvedLink extends UnitRef {
  assessmentId: string | null;
  itemId: string | null;
  responseId: string | null;
  findingId: string | null;
  correctiveActionId: string | null;
}

/**
 * Resolves what an evidence file is attached to and checks the uploader may attach to it.
 * Evidence inherits its organisation/site/department from the linked record, so branch
 * evidence can never be filed under another branch (BRD §8).
 */
async function resolveLink(req: Request, link: EvidenceLinkInput): Promise<ResolvedLink> {
  const user = req.user!;
  if (link.correctiveActionId) {
    const ca = await prisma.correctiveAction.findFirst({ where: { id: link.correctiveActionId, finding: { organisationId: user.organisationId } }, include: { finding: true } });
    if (!ca) throw notFound('Corrective action');
    await assertUnitAccess(req, ca.finding, 'CorrectiveAction', ca.id);
    if (!['PLANNED', 'IN_PROGRESS', 'RETURNED'].includes(ca.status)) throw invalidState('Closure evidence can only be added while the action is open');
    if (ca.ownerId !== user.id && !user.permissions.has('corrective_action:update')) throw forbidden('Only the action owner can attach closure evidence');
    const f = ca.finding;
    return { organisationId: f.organisationId, siteId: f.siteId, departmentId: f.departmentId, assessmentId: f.assessmentId, itemId: null, responseId: null, findingId: f.id, correctiveActionId: ca.id };
  }
  if (link.findingId) {
    const f = await prisma.finding.findFirst({ where: { id: link.findingId, organisationId: user.organisationId } });
    if (!f) throw notFound('Finding');
    await assertUnitAccess(req, f, 'Finding', f.id);
    if (f.status === 'CLOSED') throw invalidState('Finding is closed');
    if (f.ownerId !== user.id && !user.permissions.has('finding:update')) throw forbidden('Only the finding owner can attach evidence');
    return { organisationId: f.organisationId, siteId: f.siteId, departmentId: f.departmentId, assessmentId: f.assessmentId, itemId: null, responseId: null, findingId: f.id, correctiveActionId: null };
  }
  if (link.assessmentId && link.itemId) {
    const a = await loadAssessment(req, link.assessmentId);
    const item = await prisma.checklistItem.findFirst({ where: { id: link.itemId, versionId: a.checklistVersionId } });
    if (!item) throw notFound('Question');
    await assertCanEditItem(req, a, item.id);
    const response = await prisma.assessmentResponse.findUnique({ where: { assessmentId_itemId: { assessmentId: a.id, itemId: item.id } } });
    return { organisationId: a.organisationId, siteId: a.siteId, departmentId: a.departmentId, assessmentId: a.id, itemId: item.id, responseId: response?.id ?? null, findingId: null, correctiveActionId: null };
  }
  throw validationError('Evidence must be linked to a checklist question, a finding or a corrective action');
}

async function validateAndScan(req: Request, file: { originalname: string; buffer: Buffer }, context: Record<string, unknown>) {
  const policy = await getSetting('upload.policy', req.user!.organisationId);
  const check = checkFile(file.originalname, file.buffer, policy.allowedExtensions, policy.maxFileSizeMb * 1024 * 1024);
  if (!check.ok) {
    await recordAuditSafe({ req, action: 'EVIDENCE_UPLOAD_REJECTED', entityType: 'Evidence', outcome: 'FAILURE', metadata: { ...context, file: sanitizeFilename(file.originalname), reason: check.error ?? 'invalid' } as never });
    throw new AppError(422, 'FILE_REJECTED', check.error!);
  }
  const scan = await scanBuffer(file.buffer);
  if (scan.status === 'INFECTED') {
    // Infected files are never written to storage.
    await recordAuditSafe({ req, action: 'EVIDENCE_MALWARE_BLOCKED', entityType: 'Evidence', outcome: 'DENIED', metadata: { ...context, file: sanitizeFilename(file.originalname), detail: scan.detail } as never });
    throw new AppError(422, 'MALWARE_DETECTED', `Upload blocked: malware detected (${scan.detail})`);
  }
  return { check, scan };
}

export async function uploadEvidence(
  req: Request,
  file: { originalname: string; buffer: Buffer },
  meta: { title?: string | null; description?: string | null; classification?: EvidenceClassification } & EvidenceLinkInput,
) {
  const link = await resolveLink(req, meta);
  const { check, scan } = await validateAndScan(req, file, { link: meta });
  const evidenceId = crypto.randomUUID();
  const storageKey = `evidence/${link.organisationId}/${link.siteId}/${evidenceId}/v1-${crypto.randomUUID()}.${check.ext}`;
  await storage.put(storageKey, file.buffer, check.mimeType);
  const original = sanitizeFilename(file.originalname);
  try {
    return await prisma.$transaction(async (tx) => {
      const code = await nextCode('EVD', tx);
      const ev = await tx.evidence.create({
        data: {
          id: evidenceId,
          code,
          organisationId: link.organisationId,
          siteId: link.siteId,
          departmentId: link.departmentId,
          assessmentId: link.assessmentId,
          itemId: link.itemId,
          responseId: link.responseId,
          findingId: link.findingId,
          correctiveActionId: link.correctiveActionId,
          title: meta.title?.trim() || original,
          description: meta.description,
          classification: meta.classification ?? 'INTERNAL',
          uploaderId: req.user!.id,
          versions: {
            create: {
              version: 1,
              originalFilename: original,
              storageKey,
              mimeType: check.mimeType,
              size: file.buffer.length,
              checksum: sha256(file.buffer),
              scanStatus: scan.status,
              scanDetail: scan.detail,
              uploaderId: req.user!.id,
            },
          },
        },
        include: { versions: true },
      });
      await recordAudit({ req, action: 'EVIDENCE_UPLOADED', entityType: 'Evidence', entityId: ev.id, siteId: ev.siteId, metadata: { code, file: original, size: file.buffer.length, checksum: ev.versions[0].checksum, scan: scan.status, link: meta } as never }, tx);
      return ev;
    });
  } catch (err) {
    await storage.delete(storageKey).catch(() => undefined);
    throw err;
  }
}

/** Uploads a replacement file as a new version; earlier versions are retained. Verification resets to Pending. */
export async function uploadNewVersion(req: Request, evidenceId: string, file: { originalname: string; buffer: Buffer }, note?: string | null) {
  const ev = await getEvidenceForUser(req, evidenceId);
  await resolveLink(req, { assessmentId: ev.assessmentId, itemId: ev.itemId, findingId: ev.correctiveActionId ? null : ev.findingId, correctiveActionId: ev.correctiveActionId });
  const { check, scan } = await validateAndScan(req, file, { evidenceId });
  const version = ev.currentVersion + 1;
  const storageKey = `evidence/${ev.organisationId}/${ev.siteId}/${ev.id}/v${version}-${crypto.randomUUID()}.${check.ext}`;
  await storage.put(storageKey, file.buffer, check.mimeType);
  const original = sanitizeFilename(file.originalname);
  try {
    return await prisma.$transaction(async (tx) => {
      const updated = await tx.evidence.updateMany({ where: { id: ev.id, currentVersion: ev.currentVersion }, data: { currentVersion: version, verificationStatus: 'PENDING', verificationNote: null, verifiedById: null, verifiedAt: null } });
      if (!updated.count) throw invalidState('Evidence was updated concurrently; reload and try again');
      const v = await tx.evidenceVersion.create({
        data: { evidenceId: ev.id, version, originalFilename: original, storageKey, mimeType: check.mimeType, size: file.buffer.length, checksum: sha256(file.buffer), scanStatus: scan.status, scanDetail: scan.detail, uploaderId: req.user!.id },
      });
      await recordAudit({ req, action: 'EVIDENCE_VERSION_UPLOADED', entityType: 'Evidence', entityId: ev.id, siteId: ev.siteId, metadata: { version, file: original, checksum: v.checksum, note: note ?? null, scan: scan.status } }, tx);
      return v;
    });
  } catch (err) {
    await storage.delete(storageKey).catch(() => undefined);
    throw err;
  }
}

/** Loads evidence with scope enforcement; out-of-scope access is denied and audited (AT-10). */
export async function getEvidenceForUser(req: Request, id: string) {
  const ev = await prisma.evidence.findFirst({ where: { id, organisationId: req.user!.organisationId, deletedAt: null } });
  if (!ev) throw notFound('Evidence');
  await assertUnitAccess(req, ev, 'Evidence', ev.id);
  return ev;
}

export async function softDelete(req: Request, id: string, reason: string) {
  const ev = await getEvidenceForUser(req, id);
  if (ev.verificationStatus === 'ACCEPTED') throw invalidState('Accepted evidence cannot be removed; raise a secure deletion request instead');
  if (ev.uploaderId !== req.user!.id && !req.user!.roles.includes('SYSTEM_ADMIN')) throw forbidden('Only the uploader can remove this evidence');
  await resolveLink(req, { assessmentId: ev.assessmentId, itemId: ev.itemId, findingId: ev.correctiveActionId ? null : ev.findingId, correctiveActionId: ev.correctiveActionId });
  await prisma.evidence.update({ where: { id }, data: { deletedAt: new Date() } });
  await recordAudit({ req, action: 'EVIDENCE_REMOVED', entityType: 'Evidence', entityId: id, siteId: ev.siteId, metadata: { reason } });
}

export async function rescan(req: Request, versionId: string) {
  const v = await prisma.evidenceVersion.findFirst({ where: { id: versionId, evidence: { organisationId: req.user!.organisationId } }, include: { evidence: true } });
  if (!v) throw notFound('Evidence version');
  const buf = await storage.get(v.storageKey);
  const scan = await scanBuffer(buf);
  if (sha256(buf) !== v.checksum) throw badRequest('Stored file checksum mismatch – integrity check failed');
  const updated = await prisma.evidenceVersion.update({ where: { id: v.id }, data: { scanStatus: scan.status, scanDetail: scan.detail } });
  await recordAudit({ req, action: 'EVIDENCE_RESCANNED', entityType: 'Evidence', entityId: v.evidenceId, siteId: v.evidence.siteId, metadata: { version: v.version, scan: scan.status } });
  return updated;
}
