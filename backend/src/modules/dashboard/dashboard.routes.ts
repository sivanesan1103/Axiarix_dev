import { Router } from 'express';
import { assessmentParticipants, sodBlockReason } from '../../services/sod.service.js';
import { z } from 'zod';
import type { AssessmentStatus, Prisma, ResponseStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { ANNEX_THEMES, CLAUSE_GROUPS } from '../../constants/iso27001.js';
import { requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { countStatuses, emptyCounts, evidenceCoverage, scoreCounts, type StatusCounts } from '../../services/compliance.service.js';
import { unitWhere } from '../../services/scope.service.js';
import { startOfToday } from '../../services/workflow.service.js';
import { ok } from '../../utils/http.js';

const filterSchema = z.object({
  siteId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  periodLabel: z.string().max(60).optional(),
  assessmentId: z.string().uuid().optional(),
});

/**
 * Management dashboard. Every figure is computed from live database records within the
 * caller's access scope (FR-020/021, AT-12); nothing is cached or hard-coded.
 * Each assessment is scored with its own pinned scoring policy, then aggregated.
 */
export const dashboardRouter = Router();

dashboardRouter.get('/summary', requirePermission('dashboard:read'), validate(filterSchema, 'query'), async (req, res) => {
  const f = req.query as unknown as z.infer<typeof filterSchema>;
  const user = req.user!;
  const scope = unitWhere(user);
  const assessmentWhere: Prisma.AssessmentWhereInput = { ...scope, siteId: f.siteId, departmentId: f.departmentId, periodLabel: f.periodLabel, id: f.assessmentId };
  const unitFilter = { ...scope, siteId: f.siteId, departmentId: f.departmentId };

  const assessments = await prisma.assessment.findMany({
    where: assessmentWhere,
    include: {
      scoringPolicy: true,
      site: { select: { id: true, name: true } },
      department: { select: { id: true, name: true } },
      checklistVersion: { include: { items: { where: { status: 'ACTIVE' }, include: { mappings: true } } } },
      responses: { select: { itemId: true, status: true } },
      evidence: { where: { deletedAt: null, itemId: { not: null } }, select: { itemId: true, verificationStatus: true, deletedAt: true, versions: { orderBy: { version: 'desc' }, take: 1, select: { scanStatus: true } } } },
    },
    orderBy: { periodStart: 'asc' },
  });
  const ids = assessments.map((a) => a.id);
  const today = startOfToday();

  let totals = emptyCounts();
  let earned = 0;
  let denominator = 0;
  let evRequired = 0;
  let evAttached = 0;
  let evVerified = 0;
  let totalItems = 0;
  const clauseAgg = new Map<string, StatusCounts>();
  const themeAgg = new Map<string, StatusCounts>();
  const controlAgg = new Map<string, StatusCounts>();
  const siteAgg = new Map<string, { name: string; earned: number; denominator: number; assessments: number; counts: StatusCounts }>();
  const deptAgg = new Map<string, { name: string; site: string; siteId: string; earned: number; denominator: number; assessments: number }>();
  const periodAgg = new Map<string, { start: Date; earned: number; denominator: number; assessments: number }>();
  const add = (m: Map<string, StatusCounts>, k: string, s: ResponseStatus) => {
    const c = m.get(k) ?? emptyCounts();
    c[s]++;
    m.set(k, c);
  };

  for (const a of assessments) {
    const items = a.checklistVersion.items;
    const statusOf = (id: string): ResponseStatus => a.responses.find((r) => r.itemId === id)?.status ?? 'NOT_ASSESSED';
    const counts = countStatuses(items.map((i) => statusOf(i.id)));
    const s = scoreCounts(counts, a.scoringPolicy);
    const applicable = new Set(items.filter((i) => statusOf(i.id) !== 'NOT_APPLICABLE').map((i) => i.id));
    const cov = evidenceCoverage(items, a.evidence, applicable);
    totalItems += items.length;
    (Object.keys(totals) as ResponseStatus[]).forEach((k) => (totals[k] += counts[k]));
    earned += s.earned;
    denominator += s.denominator;
    evRequired += cov.required;
    evAttached += cov.attached;
    evVerified += cov.verified;
    for (const item of items) {
      const st = statusOf(item.id);
      new Set(item.mappings.filter((m) => m.type === 'ISO_CLAUSE').map((m) => m.reference.split('.')[0])).forEach((c) => add(clauseAgg, c, st));
      const controls = new Set(item.mappings.filter((m) => m.type === 'ANNEX_A').map((m) => m.reference));
      controls.forEach((c) => add(controlAgg, c, st));
      new Set([...controls].map((c) => c.split('.')[0])).forEach((t) => add(themeAgg, t, st));
    }
    const site = siteAgg.get(a.siteId) ?? { name: a.site.name, earned: 0, denominator: 0, assessments: 0, counts: emptyCounts() };
    site.earned += s.earned;
    site.denominator += s.denominator;
    site.assessments++;
    (Object.keys(counts) as ResponseStatus[]).forEach((k) => (site.counts[k] += counts[k]));
    siteAgg.set(a.siteId, site);
    const dept = deptAgg.get(a.departmentId) ?? { name: a.department.name, site: a.site.name, siteId: a.siteId, earned: 0, denominator: 0, assessments: 0 };
    dept.earned += s.earned;
    dept.denominator += s.denominator;
    dept.assessments++;
    deptAgg.set(a.departmentId, dept);
    const p = periodAgg.get(a.periodLabel) ?? { start: a.periodStart, earned: 0, denominator: 0, assessments: 0 };
    p.earned += s.earned;
    p.denominator += s.denominator;
    p.assessments++;
    periodAgg.set(a.periodLabel, p);
  }
  if (!assessments.length) totals = emptyCounts();
  const policyFor = assessments[0]?.scoringPolicy;
  const pctOf = (e: number, d: number) => (d > 0 ? Math.round((e / d) * 1000) / 10 : null);
  const groupOut = (m: Map<string, StatusCounts>, label: (k: string) => string) =>
    [...m.entries()]
      .sort(([x], [y]) => x.localeCompare(y, undefined, { numeric: true }))
      .map(([key, counts]) => ({ key, label: label(key), counts, percent: policyFor ? scoreCounts(counts, policyFor).percent : null }));

  const findingWhere: Prisma.FindingWhereInput = { ...unitFilter, ...(f.periodLabel || f.assessmentId ? { assessmentId: { in: ids } } : {}) };
  const [findingsBySeverity, findingsByStatus, overdueFindings, actionStatus, overdueActions, pendingApprovals, recentActivity, statusBreakdown] = await Promise.all([
    prisma.finding.groupBy({ by: ['severity'], where: { ...findingWhere, status: { not: 'CLOSED' } }, _count: true }),
    prisma.finding.groupBy({ by: ['status'], where: findingWhere, _count: true }),
    prisma.finding.count({ where: { ...findingWhere, status: { not: 'CLOSED' }, dueDate: { lt: today } } }),
    prisma.correctiveAction.groupBy({ by: ['status'], where: { finding: findingWhere }, _count: true }),
    prisma.correctiveAction.count({ where: { finding: findingWhere, status: { not: 'VERIFIED' }, targetDate: { lt: today } } }),
    prisma.assessment.count({ where: { ...assessmentWhere, status: 'PENDING_APPROVAL' } }),
    prisma.auditEvent.findMany({
      where: {
        organisationId: user.organisationId,
        outcome: 'SUCCESS',
        action: { in: ['ASSESSMENT_CREATED', 'ASSESSMENT_SUBMITTED', 'EVIDENCE_UPLOADED', 'FINDING_CREATED', 'ASSESSMENT_APPROVED', 'REPORT_GENERATED', 'CHECKLIST_PUBLISHED', 'AUDIT_REVIEW_SUBMITTED', 'CORRECTIVE_ACTION_VERIFIED', 'EVIDENCE_REJECTED', 'CLARIFICATION_REQUESTED'] },
        ...(scope.OR ? { OR: [{ siteId: null }, { siteId: { in: scope.OR.map((o) => o.siteId) } }] } : {}),
        ...(f.siteId ? { siteId: f.siteId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: { id: true, action: true, entityType: true, entityId: true, actorEmail: true, createdAt: true, metadata: true, actor: { select: { name: true } } },
    }),
    prisma.assessment.groupBy({ by: ['status'], where: assessmentWhere, _count: true }),
  ]);

  const statusCount = (s: AssessmentStatus) => statusBreakdown.find((x) => x.status === s)?._count ?? 0;
  const answered = totalItems - totals.NOT_ASSESSED;
  ok(res, {
    filters: f,
    assessmentsCount: assessments.length,
    kpis: {
      compliancePercent: pctOf(earned, denominator),
      totalQuestions: totalItems,
      counts: totals,
      evidenceCoveragePercent: pctOf(evAttached, evRequired),
      verifiedEvidencePercent: pctOf(evVerified, evRequired),
      evidence: { required: evRequired, attached: evAttached, verified: evVerified },
      completionPercent: totalItems ? Math.round((answered / totalItems) * 1000) / 10 : null,
      openFindings: findingsBySeverity.reduce((n, x) => n + x._count, 0),
      overdueFindings,
      overdueActions,
      pendingApprovals,
      approvedAssessments: statusCount('APPROVED'),
    },
    scoringNote: policyFor ? `Scored per assessment with its pinned policy (current: v${policyFor.version} ${policyFor.name}).` : null,
    assessmentStatus: statusBreakdown.map((s) => ({ status: s.status, count: s._count })),
    byClause: groupOut(clauseAgg, (k) => `${k}. ${CLAUSE_GROUPS[k] ?? ''}`),
    byAnnexTheme: groupOut(themeAgg, (k) => `A.${k} ${ANNEX_THEMES[k] ?? ''}`),
    byControl: groupOut(controlAgg, (k) => `A.${k}`),
    findingsBySeverity: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'OBSERVATION'].map((s) => ({ severity: s, count: findingsBySeverity.find((x) => x.severity === s)?._count ?? 0 })),
    findingsByStatus: findingsByStatus.map((x) => ({ status: x.status, count: x._count })),
    actionProgress: ['PLANNED', 'IN_PROGRESS', 'RETURNED', 'SUBMITTED_FOR_VERIFICATION', 'VERIFIED'].map((s) => ({ status: s, count: actionStatus.find((x) => x.status === s)?._count ?? 0 })),
    departmentComparison: [...deptAgg.entries()].map(([id, d]) => ({ departmentId: id, department: d.name, siteId: d.siteId, site: d.site, assessments: d.assessments, compliancePercent: pctOf(d.earned, d.denominator) })),
    branchComparison: [...siteAgg.entries()].map(([id, s]) => ({ siteId: id, site: s.name, assessments: s.assessments, compliancePercent: pctOf(s.earned, s.denominator), counts: s.counts })),
    trend: [...periodAgg.entries()].sort((a, b) => a[1].start.getTime() - b[1].start.getTime()).map(([period, p]) => ({ period, assessments: p.assessments, compliancePercent: pctOf(p.earned, p.denominator) })),
    recentActivity,
  });
});

/** Personal task list shown on the dashboard for every role. */
dashboardRouter.get('/tasks', async (req, res) => {
  const user = req.user!;
  const scope = unitWhere(user);
  const today = startOfToday();
  const p = (k: string) => user.permissions.has(k as never);
  const pick = { id: true, code: true, title: true, status: true, dueDate: true } as const;
  const [assignments, myQuestions, toRelease, toSubmit, toReview, toApprove, myFindings, myActions, toVerify, checklistReviews] = await Promise.all([
    prisma.assessmentAssignment.count({ where: { assigneeId: user.id, assessment: { status: { in: ['ASSIGNED', 'IN_PROGRESS', 'CLARIFICATION_REQUIRED'] } } } }),
    // Assessments where this person has questions to answer, with how many are still unanswered.
    prisma.assessment.findMany({
      where: { status: { in: ['ASSIGNED', 'IN_PROGRESS', 'CLARIFICATION_REQUIRED'] }, assignments: { some: { assigneeId: user.id } } },
      select: { ...pick, _count: { select: { assignments: { where: { assigneeId: user.id } } } } },
      take: 5,
      orderBy: { dueDate: 'asc' },
    }),
    p('assessment:update') ? prisma.assessment.findMany({ where: { ...scope, status: 'DRAFT' }, select: pick, take: 5, orderBy: { createdAt: 'desc' } }) : [],
    p('assessment:submit')
      ? prisma.assessment.findMany({ where: { ...scope, status: { in: ['IN_PROGRESS', 'CLARIFICATION_REQUIRED', 'ASSIGNED'] }, ...(user.roles.some((r) => r === 'IT_OWNER' || r === 'SYSTEM_ADMIN') ? {} : { ownerId: user.id }) }, select: pick, take: 5, orderBy: { dueDate: 'asc' } })
      : [],
    p('assessment:review') ? prisma.assessment.findMany({ where: { ...scope, status: { in: ['SUBMITTED_FOR_AUDIT', 'UNDER_REVIEW'] } }, select: { ...pick, ownerId: true }, take: 10 }) : [],
    p('assessment:approve') ? prisma.assessment.findMany({ where: { ...scope, status: 'PENDING_APPROVAL' }, select: { ...pick, ownerId: true }, take: 10 }) : [],
    prisma.finding.findMany({ where: { ownerId: user.id, status: { in: ['OPEN', 'ASSIGNED', 'ACTION_IN_PROGRESS'] } }, select: { id: true, code: true, title: true, status: true, severity: true, dueDate: true }, take: 5, orderBy: { dueDate: 'asc' } }),
    prisma.correctiveAction.findMany({ where: { ownerId: user.id, status: { in: ['PLANNED', 'IN_PROGRESS', 'RETURNED'] } }, select: { id: true, code: true, correctiveAction: true, targetDate: true, status: true }, take: 5, orderBy: { targetDate: 'asc' } }),
    p('corrective_action:review')
      ? prisma.correctiveAction.findMany({ where: { finding: scope, status: 'SUBMITTED_FOR_VERIFICATION', ownerId: { not: user.id } }, select: { id: true, code: true, correctiveAction: true, targetDate: true, status: true }, take: 5 })
      : [],
    prisma.checklistVersion.findMany({
      where: { reviewerId: user.id, status: 'UNDER_REVIEW', template: { organisationId: user.organisationId } },
      select: { id: true, versionNumber: true, submittedAt: true, template: { select: { id: true, title: true } } },
      take: 5,
    }),
  ]);
  // Separation of duties: leave out reviews and approvals this person is not allowed to do.
  const allowed = async (rows: Array<{ id: string; ownerId: string }>, stage: 'audit' | 'approve') => {
    const out = [];
    for (const r of rows) if (!sodBlockReason(user.id, await assessmentParticipants(r), stage)) out.push(r);
    return out.slice(0, 5);
  };
  ok(res, {
    openAssignments: assignments,
    myQuestions: myQuestions.map((a) => ({ ...a, assignedToMe: a._count.assignments, overdue: a.dueDate < today })),
    toRelease,
    toSubmit,
    toReview: await allowed(toReview, 'audit'),
    toApprove: await allowed(toApprove, 'approve'),
    myFindings: myFindings.map((f) => ({ ...f, overdue: f.dueDate < today })),
    myActions: myActions.map((a) => ({ ...a, overdue: a.targetDate < today })),
    toVerify,
    checklistReviews,
  });
});
