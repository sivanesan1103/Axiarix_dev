import { Router } from 'express';
import { prisma } from '../../config/prisma.js';
import { unitWhere } from '../../services/scope.service.js';
import { ok } from '../../utils/http.js';

/** Global search (FR-027) across records the user can access. Each category is permission-gated and scope-filtered. */
export const searchRouter = Router();

searchRouter.get('/', async (req, res) => {
  const q = String(req.query.q ?? '').trim().slice(0, 100);
  if (q.length < 2) return ok(res, []);
  const u = req.user!;
  const scope = unitWhere(u);
  const has = (k: string) => u.permissions.has(k as never);
  const ci = { contains: q, mode: 'insensitive' as const };
  const [assessments, findings, checklists, questions, reports, evidence] = await Promise.all([
    has('assessment:read') ? prisma.assessment.findMany({ where: { ...scope, AND: [{ OR: [{ code: ci }, { title: ci }] }] }, take: 5, select: { id: true, code: true, title: true, status: true } }) : [],
    has('finding:read') ? prisma.finding.findMany({ where: { ...scope, AND: [{ OR: [{ code: ci }, { title: ci }] }] }, take: 5, select: { id: true, code: true, title: true, severity: true } }) : [],
    has('checklist:read') ? prisma.checklistTemplate.findMany({ where: { organisationId: u.organisationId, title: ci }, take: 5, select: { id: true, title: true } }) : [],
    // Checklist questions (FR-027 "checklist items"), from the newest version of each checklist.
    has('checklist:read')
      ? prisma.checklistItem.findMany({
          where: { status: 'ACTIVE', version: { template: { organisationId: u.organisationId } }, OR: [{ question: ci }, { questionCode: ci }] },
          orderBy: { version: { versionNumber: 'desc' } },
          take: 5,
          select: { id: true, questionCode: true, question: true, versionId: true, version: { select: { versionNumber: true, templateId: true, template: { select: { title: true } } } } },
        })
      : [],
    has('report:read') ? prisma.report.findMany({ where: { ...scope, archivedAt: null, AND: [{ OR: [{ code: ci }, { title: ci }] }] }, take: 5, select: { id: true, code: true, title: true } }) : [],
    has('evidence:read') ? prisma.evidence.findMany({ where: { ...scope, deletedAt: null, AND: [{ OR: [{ code: ci }, { title: ci }] }] }, take: 5, select: { id: true, code: true, title: true } }) : [],
  ]);
  ok(res, [
    ...assessments.map((a) => ({ type: 'assessment', id: a.id, title: `${a.code} · ${a.title}`, subtitle: a.status.replaceAll('_', ' ').toLowerCase(), link: `/assessments/${a.id}` })),
    ...findings.map((f) => ({ type: 'finding', id: f.id, title: `${f.code} · ${f.title}`, subtitle: `${f.severity.toLowerCase()} finding`, link: `/findings/${f.id}` })),
    ...checklists.map((c) => ({ type: 'checklist', id: c.id, title: c.title, subtitle: 'Checklist', link: `/checklists/${c.id}` })),
    ...questions.map((i) => ({ type: 'question', id: i.id, title: `${i.questionCode} · ${i.question.slice(0, 120)}`, subtitle: `${i.version.template.title} v${i.version.versionNumber}`, link: `/checklists/${i.version.templateId}/versions/${i.versionId}?search=${encodeURIComponent(i.questionCode)}` })),
    ...reports.map((r) => ({ type: 'report', id: r.id, title: r.code, subtitle: r.title, link: `/reports?search=${encodeURIComponent(r.code)}` })),
    ...evidence.map((e) => ({ type: 'evidence', id: e.id, title: `${e.code} · ${e.title}`, subtitle: 'Evidence', link: `/evidence?open=${e.id}` })),
  ]);
});
