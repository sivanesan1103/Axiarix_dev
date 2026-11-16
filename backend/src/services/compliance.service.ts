import type { ResponseStatus, ScoringPolicy } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma.js';
import { ANNEX_THEMES, CLAUSE_GROUPS } from '../constants/iso27001.js';

export type StatusCounts = Record<ResponseStatus, number>;

export const emptyCounts = (): StatusCounts => ({
  COMPLIANT: 0,
  PARTIALLY_COMPLIANT: 0,
  NON_COMPLIANT: 0,
  NOT_APPLICABLE: 0,
  NOT_ASSESSED: 0,
});

export type PolicyWeights = Pick<
  ScoringPolicy,
  'weightCompliant' | 'weightPartial' | 'weightNonCompliant' | 'excludeNotApplicable' | 'excludeNotAssessed'
>;

/**
 * Compliance percentage under a versioned scoring policy (SRS §9).
 *
 * Default proposal: Compliant = 1, Partially = 0.5, Non-compliant = 0.
 * Not Applicable / Not Assessed leave the denominator only when the policy says so;
 * when Not Assessed stays in the denominator it scores 0, so incomplete work is never hidden.
 * Returns null when nothing is scorable (avoids a misleading 0% or 100%).
 */
export function scoreCounts(counts: StatusCounts, p: PolicyWeights) {
  const earned =
    counts.COMPLIANT * p.weightCompliant +
    counts.PARTIALLY_COMPLIANT * p.weightPartial +
    counts.NON_COMPLIANT * p.weightNonCompliant;
  const denominator =
    counts.COMPLIANT +
    counts.PARTIALLY_COMPLIANT +
    counts.NON_COMPLIANT +
    (p.excludeNotApplicable ? 0 : counts.NOT_APPLICABLE) +
    (p.excludeNotAssessed ? 0 : counts.NOT_ASSESSED);
  const percent = denominator > 0 ? Math.round((earned / denominator) * 1000) / 10 : null;
  return { earned, denominator, percent };
}

export function countStatuses(statuses: ResponseStatus[]): StatusCounts {
  const c = emptyCounts();
  for (const s of statuses) c[s]++;
  return c;
}

interface ItemLike {
  id: string;
  evidenceMandatory: boolean;
  mappings: { type: string; reference: string }[];
}

interface EvidenceLike {
  itemId: string | null;
  verificationStatus: string;
  deletedAt: Date | null;
  versions: { scanStatus: string }[];
}

/**
 * Evidence coverage = items requiring evidence that have usable evidence attached ÷ items requiring evidence.
 * Usable means: not deleted, not rejected, and the current file passed malware scanning.
 * `verified` additionally requires auditor acceptance; rejected evidence never counts as verified.
 */
export function evidenceCoverage(items: ItemLike[], evidence: EvidenceLike[], applicableItemIds?: Set<string>) {
  const required = items.filter((i) => i.evidenceMandatory && (!applicableItemIds || applicableItemIds.has(i.id)));
  const usable = (e: EvidenceLike) => !e.deletedAt && e.verificationStatus !== 'REJECTED' && e.versions[0]?.scanStatus === 'CLEAN';
  let attached = 0;
  let verified = 0;
  for (const item of required) {
    const ev = evidence.filter((e) => e.itemId === item.id);
    if (ev.some(usable)) attached++;
    if (ev.some((e) => usable(e) && e.verificationStatus === 'ACCEPTED')) verified++;
  }
  const pct = (n: number) => (required.length ? Math.round((n / required.length) * 1000) / 10 : null);
  return { required: required.length, attached, verified, percent: pct(attached), verifiedPercent: pct(verified) };
}

/** Full metric set for one assessment, computed from live records. */
export async function assessmentMetrics(assessmentId: string, db: Tx = prisma) {
  const a = await db.assessment.findUniqueOrThrow({
    where: { id: assessmentId },
    include: {
      scoringPolicy: true,
      checklistVersion: { include: { items: { where: { status: 'ACTIVE' }, include: { mappings: true } } } },
      responses: true,
      evidence: { where: { deletedAt: null }, include: { versions: { orderBy: { version: 'desc' }, take: 1 } } },
      _count: { select: { assignments: true } },
    },
  });
  const items = a.checklistVersion.items;
  const responseByItem = new Map(a.responses.map((r) => [r.itemId, r]));
  const statusOf = (itemId: string): ResponseStatus => responseByItem.get(itemId)?.status ?? 'NOT_ASSESSED';
  const counts = countStatuses(items.map((i) => statusOf(i.id)));
  const score = scoreCounts(counts, a.scoringPolicy);
  const applicable = new Set(items.filter((i) => statusOf(i.id) !== 'NOT_APPLICABLE').map((i) => i.id));
  const coverage = evidenceCoverage(items, a.evidence, applicable);

  const byClause = new Map<string, ResponseStatus[]>();
  const byTheme = new Map<string, ResponseStatus[]>();
  const byControl = new Map<string, ResponseStatus[]>();
  for (const item of items) {
    const s = statusOf(item.id);
    const clauses = new Set(item.mappings.filter((m) => m.type === 'ISO_CLAUSE').map((m) => m.reference.split('.')[0]));
    const controls = new Set(item.mappings.filter((m) => m.type === 'ANNEX_A').map((m) => m.reference));
    const themes = new Set([...controls].map((c) => c.split('.')[0]));
    for (const c of clauses) byClause.set(c, [...(byClause.get(c) ?? []), s]);
    for (const t of themes) byTheme.set(t, [...(byTheme.get(t) ?? []), s]);
    for (const c of controls) byControl.set(c, [...(byControl.get(c) ?? []), s]);
  }
  const group = (m: Map<string, ResponseStatus[]>, label: (k: string) => string) =>
    [...m.entries()]
      .sort(([x], [y]) => x.localeCompare(y, undefined, { numeric: true }))
      .map(([key, statuses]) => {
        const c = countStatuses(statuses);
        return { key, label: label(key), items: statuses.length, counts: c, percent: scoreCounts(c, a.scoringPolicy).percent };
      });

  const answered = items.length - counts.NOT_ASSESSED;
  return {
    totalItems: items.length,
    counts,
    compliancePercent: score.percent,
    scoring: {
      policyId: a.scoringPolicy.id,
      policyVersion: a.scoringPolicy.version,
      policyName: a.scoringPolicy.name,
      weights: { compliant: a.scoringPolicy.weightCompliant, partial: a.scoringPolicy.weightPartial, nonCompliant: a.scoringPolicy.weightNonCompliant },
      earned: score.earned,
      denominator: score.denominator,
      excludeNotApplicable: a.scoringPolicy.excludeNotApplicable,
      excludeNotAssessed: a.scoringPolicy.excludeNotAssessed,
    },
    completionPercent: items.length ? Math.round((answered / items.length) * 1000) / 10 : 0,
    evidenceCoverage: coverage,
    byClause: group(byClause, (k) => `Clause ${k} – ${CLAUSE_GROUPS[k] ?? ''}`),
    byAnnexTheme: group(byTheme, (k) => `A.${k} ${ANNEX_THEMES[k] ?? ''}`),
    byControl: group(byControl, (k) => `A.${k}`),
  };
}

export type AssessmentMetrics = Awaited<ReturnType<typeof assessmentMetrics>>;
