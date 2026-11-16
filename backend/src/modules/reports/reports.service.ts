import type { Request } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { recordAudit } from '../../services/audit.service.js';
import { assessmentMetrics, type AssessmentMetrics } from '../../services/compliance.service.js';
import { getSetting, nextCode } from '../../services/settings.service.js';
import { storage } from '../../services/storage/index.js';
import { invalidState } from '../../utils/errors.js';
import { sha256 } from '../../utils/crypto.js';
import { COLORS, ReportPdf } from './pdf.js';

const STATUS_LABEL: Record<string, string> = {
  COMPLIANT: 'Compliant',
  PARTIALLY_COMPLIANT: 'Partially compliant',
  NON_COMPLIANT: 'Non-compliant',
  NOT_APPLICABLE: 'Not applicable',
  NOT_ASSESSED: 'Not assessed',
};
const fmtDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : '-');
const pct = (v: number | null) => (v == null ? 'n/a' : `${v}%`);

/** Plain-language summary derived only from recorded data – no invented conclusions. */
function executiveSummary(m: AssessmentMetrics, openFindings: number, criticalHigh: number) {
  const c = m.counts;
  const parts = [
    `${m.totalItems} checklist questions were assessed: ${c.COMPLIANT} compliant, ${c.PARTIALLY_COMPLIANT} partially compliant, ${c.NON_COMPLIANT} non-compliant, ${c.NOT_APPLICABLE} not applicable and ${c.NOT_ASSESSED} not assessed.`,
    `Under scoring policy v${m.scoring.policyVersion} (${m.scoring.policyName}) the compliance score is ${pct(m.compliancePercent)} (${m.scoring.earned} of ${m.scoring.denominator} scorable points).`,
    `Evidence was attached for ${m.evidenceCoverage.attached} of ${m.evidenceCoverage.required} questions requiring evidence (${pct(m.evidenceCoverage.percent)}); ${m.evidenceCoverage.verified} were verified by the auditor (${pct(m.evidenceCoverage.verifiedPercent)}).`,
    `${openFindings} finding(s) remain open at the time of this report, of which ${criticalHigh} are rated Critical or High.`,
  ];
  return parts.join(' ');
}

/**
 * Generates the final PDF for an approved assessment and stores it as a new immutable
 * report version (FR-022/023). Metrics are frozen into `summary` so later data or scoring
 * changes never alter an issued report.
 */
export async function generateFinalReport(req: Request, assessmentId: string) {
  const a = await prisma.assessment.findUniqueOrThrow({
    where: { id: assessmentId },
    include: {
      organisation: true,
      site: true,
      department: true,
      owner: { select: { name: true, email: true } },
      checklistVersion: { include: { template: true } },
      approvals: { include: { approver: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
      findings: { include: { owner: { select: { name: true } }, item: { select: { questionCode: true } }, actions: { include: { owner: { select: { name: true } } } } }, orderBy: { code: 'asc' } },
      reviews: { where: { decision: 'REVIEW_SUBMITTED' }, include: { auditor: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
    },
  });
  if (a.status !== 'APPROVED') throw invalidState('The final report can only be generated after review and approval are complete');

  const [metrics, config, retention, evidenceList] = await Promise.all([
    assessmentMetrics(a.id),
    getSetting('report.config', a.organisationId),
    prisma.retentionPolicy.findUnique({ where: { organisationId_entityType: { organisationId: a.organisationId, entityType: 'REPORT' } } }),
    prisma.evidence.findMany({ where: { assessmentId: a.id, deletedAt: null, itemId: { not: null } }, include: { item: { select: { questionCode: true } } }, orderBy: { code: 'asc' } }),
  ]);
  const previous = await prisma.report.findFirst({ where: { assessmentId: a.id }, orderBy: { version: 'desc' } });
  const version = (previous?.version ?? 0) + 1;
  const baseCode = previous?.code.replace(/-v\d+$/, '') ?? (await nextCode('RPT'));
  const code = `${baseCode}-v${version}`;
  const generatedAt = new Date();
  const stamp = generatedAt.toISOString().replace('T', ' ').slice(0, 19);
  const approval = a.approvals.find((x) => x.decision === 'APPROVED');
  const review = a.reviews[0];
  const openFindings = a.findings.filter((f) => f.status !== 'CLOSED');
  const criticalHigh = openFindings.filter((f) => f.severity === 'CRITICAL' || f.severity === 'HIGH').length;

  const pdf = new ReportPdf(config.footerText);
  const doc = pdf.doc;
  // Cover band
  doc.rect(0, 0, doc.page.width, 120).fillColor(COLORS.brand).fill();
  doc.font('Helvetica').fontSize(9).fillColor('#E9E3FF').text('AXIARIX  |  ISMS COMPLIANCE', 48, 34);
  doc.font('Helvetica-Bold').fontSize(18).fillColor('#FFFFFF').text(config.headerTitle, 48, 50, { width: doc.page.width - 96 });
  doc.font('Helvetica').fontSize(10).fillColor('#E9E3FF').text(`${a.organisation.name}  |  ${a.site.name}  |  ${a.department.name}`, 48, 92);
  doc.y = 140;

  pdf.keyValues([
    ['Hospital', a.organisation.name],
    ['Branch / site', a.site.name],
    ['Department', a.department.name],
    ['Assessment period', `${a.periodLabel} (${fmtDate(a.periodStart)} to ${fmtDate(a.periodEnd)})`],
    ['Assessment ID', a.code],
    ['Checklist version', `${a.checklistVersion.template.title} - v${a.checklistVersion.versionNumber}`],
    ['Report ID / version', `${baseCode} / v${version}`],
    ['Report timestamp', `${stamp} UTC`],
    ['Department owner', a.owner.name],
    ['Approval status', approval ? `Approved by ${approval.approver.name} on ${fmtDate(approval.createdAt)}` : a.approvalRequired ? 'Approved' : 'Finalised after audit review (no separate approval configured)'],
  ]);

  pdf.heading('Scope');
  pdf.paragraph(a.scope || `ISO/IEC 27001:2022 internal assessment of ${a.department.name}, ${a.site.name}, against checklist "${a.checklistVersion.template.title}" version ${a.checklistVersion.versionNumber}.`);

  pdf.heading('Executive summary');
  pdf.paragraph(executiveSummary(metrics, openFindings.length, criticalHigh));
  pdf.stats([
    { label: 'Compliance score', value: pct(metrics.compliancePercent) },
    { label: 'Questions', value: String(metrics.totalItems) },
    { label: 'Evidence coverage', value: pct(metrics.evidenceCoverage.percent) },
    { label: 'Verified evidence', value: pct(metrics.evidenceCoverage.verifiedPercent) },
    { label: 'Open findings', value: String(openFindings.length) },
  ]);
  pdf.table(
    [
      { header: 'Status', width: 0.5 },
      { header: 'Questions', width: 0.25, align: 'right' },
      { header: 'Share', width: 0.25, align: 'right' },
    ],
    (Object.keys(STATUS_LABEL) as (keyof typeof metrics.counts)[]).map((k) => [STATUS_LABEL[k], String(metrics.counts[k]), metrics.totalItems ? `${Math.round((metrics.counts[k] / metrics.totalItems) * 1000) / 10}%` : '0%']),
  );
  pdf.paragraph(
    `Scoring rule (policy v${metrics.scoring.policyVersion}): Compliant = ${metrics.scoring.weights.compliant}, Partially compliant = ${metrics.scoring.weights.partial}, Non-compliant = ${metrics.scoring.weights.nonCompliant}. Not applicable ${metrics.scoring.excludeNotApplicable ? 'excluded from' : 'included in'} the denominator; Not assessed ${metrics.scoring.excludeNotAssessed ? 'excluded from' : 'included in (scored 0)'} the denominator.`,
    { color: COLORS.muted, size: 8 },
  );

  const groupRows = (g: AssessmentMetrics['byClause']) =>
    g.map((r) => [r.label, String(r.items), String(r.counts.COMPLIANT), String(r.counts.PARTIALLY_COMPLIANT), String(r.counts.NON_COMPLIANT), String(r.counts.NOT_APPLICABLE + r.counts.NOT_ASSESSED), pct(r.percent)]);
  const groupCols = [
    { header: 'Group', width: 0.4 },
    { header: 'Items', width: 0.08, align: 'right' as const },
    { header: 'C', width: 0.08, align: 'right' as const },
    { header: 'PC', width: 0.08, align: 'right' as const },
    { header: 'NC', width: 0.08, align: 'right' as const },
    { header: 'NA/NAs', width: 0.12, align: 'right' as const },
    { header: 'Score', width: 0.16, align: 'right' as const },
  ];
  pdf.heading('Clause-wise results (ISO/IEC 27001:2022 clauses 4-10)');
  pdf.table(groupCols, groupRows(metrics.byClause));
  pdf.heading('Annex A summary');
  pdf.table(groupCols, groupRows(metrics.byAnnexTheme));
  pdf.paragraph('Applicability of Annex A controls is determined by the hospital risk assessment and Statement of Applicability, not by this checklist.', { color: COLORS.muted, size: 8 });

  pdf.heading('Evidence coverage');
  pdf.paragraph(`Questions requiring evidence (excluding Not applicable): ${metrics.evidenceCoverage.required}. With usable evidence attached: ${metrics.evidenceCoverage.attached} (${pct(metrics.evidenceCoverage.percent)}). Verified by auditor: ${metrics.evidenceCoverage.verified} (${pct(metrics.evidenceCoverage.verifiedPercent)}). Rejected evidence is not counted.`);
  if (config.includeEvidenceList) {
    pdf.table(
      [
        { header: 'Evidence', width: 0.16 },
        { header: 'Question', width: 0.12 },
        { header: 'Title', width: 0.5 },
        { header: 'Verification', width: 0.22 },
      ],
      evidenceList.map((e) => [e.code, e.item?.questionCode ?? '-', e.title, e.verificationStatus]),
      { fontSize: 7.5 },
    );
  }

  pdf.heading('Findings');
  pdf.table(
    [
      { header: 'ID', width: 0.13 },
      { header: 'Severity', width: 0.11 },
      { header: 'Finding', width: 0.42 },
      { header: 'Owner', width: 0.14 },
      { header: 'Due', width: 0.1 },
      { header: 'Status', width: 0.1 },
    ],
    a.findings.map((f) => [f.code, f.severity, `${f.item ? `[${f.item.questionCode}] ` : ''}${f.title}: ${f.description}`, f.owner?.name ?? '-', fmtDate(f.dueDate), f.status.replaceAll('_', ' ')]),
    { fontSize: 7.5 },
  );

  pdf.heading('Corrective action status');
  const actions = a.findings.flatMap((f) => f.actions.map((ca) => ({ ...ca, findingCode: f.code })));
  pdf.table(
    [
      { header: 'Action', width: 0.12 },
      { header: 'Finding', width: 0.13 },
      { header: 'Corrective action', width: 0.4 },
      { header: 'Owner', width: 0.13 },
      { header: 'Target', width: 0.1 },
      { header: 'Status', width: 0.12 },
    ],
    actions.map((ca) => [ca.code, ca.findingCode, ca.correctiveAction, ca.owner.name, fmtDate(ca.targetDate), `${ca.status.replaceAll('_', ' ')} (${ca.progressPercent}%)`]),
    { fontSize: 7.5 },
  );

  pdf.heading('Auditor review');
  pdf.paragraph(review ? `${review.auditor.name}, ${fmtDate(review.createdAt)}: ${review.comments ?? ''}` : 'No overall auditor opinion recorded.');

  pdf.heading('Approval');
  pdf.paragraph(
    approval
      ? `Approved by ${approval.approver.name} on ${fmtDate(approval.createdAt)}.${approval.comments ? ` Comments: ${approval.comments}` : ''}`
      : 'No separate approval step was configured for this assessment; it was finalised after the audit review.',
  );
  pdf.ensureSpace(90);
  doc.moveDown(1);
  const signY = doc.y;
  const roles = config.signOffRoles.length ? config.signOffRoles : ['Approver'];
  const w = pdf.width / roles.length;
  roles.forEach((r, i) => {
    const x = 48 + i * w;
    doc.moveTo(x, signY + 36).lineTo(x + w - 20, signY + 36).lineWidth(0.5).strokeColor(COLORS.muted).stroke();
    doc.font('Helvetica').fontSize(7.5).fillColor(COLORS.muted).text(r, x, signY + 40, { width: w - 20 });
    doc.text('Name / signature / date', x, signY + 50, { width: w - 20 });
  });
  doc.y = signY + 70;
  pdf.paragraph(config.footerText, { color: COLORS.muted, size: 7.5 });

  pdf.finalise(baseCode, version, stamp);
  const buffer = await pdf.toBuffer();
  const storageKey = `reports/${a.organisationId}/${a.siteId}/${a.id}/${code}.pdf`;
  await storage.put(storageKey, buffer, 'application/pdf');

  const summary = {
    metrics,
    findings: { total: a.findings.length, open: openFindings.length, criticalHigh },
    approval: approval ? { by: approval.approver.name, at: approval.createdAt.toISOString() } : null,
    checklistVersion: a.checklistVersion.versionNumber,
    period: a.periodLabel,
  };
  const report = await prisma.report.create({
    data: {
      code,
      organisationId: a.organisationId,
      siteId: a.siteId,
      departmentId: a.departmentId,
      assessmentId: a.id,
      version,
      title: `${a.code} – ${a.title}`,
      storageKey,
      checksum: sha256(buffer),
      size: buffer.length,
      summary: summary as unknown as Prisma.InputJsonValue,
      generatedById: req.user!.id,
      generatedAt,
      retentionUntil: retention?.isActive ? new Date(generatedAt.getTime() + retention.retentionDays * 86_400_000) : null,
    },
  });
  await recordAudit({ req, action: 'REPORT_GENERATED', entityType: 'Report', entityId: report.id, siteId: a.siteId, metadata: { code, version, assessmentId: a.id, checksum: report.checksum } });
  return report;
}
