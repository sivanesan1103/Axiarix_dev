/** Shapes returned by the Axiarix API (subset of fields the UI uses). */
export type RoleKey = 'SYSTEM_ADMIN' | 'ISMS_OWNER' | 'IT_OWNER' | 'CONTRIBUTOR' | 'AUDITOR' | 'MANAGEMENT';
export type ResponseStatus = 'COMPLIANT' | 'PARTIALLY_COMPLIANT' | 'NON_COMPLIANT' | 'NOT_APPLICABLE' | 'NOT_ASSESSED';
export type StatusCounts = Record<ResponseStatus, number>;

export interface Ref {
  id: string;
  name: string;
}

export interface Scope {
  role: RoleKey;
  organisationId: string;
  siteId: string | null;
  departmentId: string | null;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  organisationId: string;
  roles: RoleKey[];
  permissions: string[];
  scopes: Scope[];
  mfaEnabled: boolean;
  isPlatformOwner: boolean;
  /** Permissions an administrator removed from this user (their role still includes them). */
  restrictions: { permission: string; reason: string; expiresAt: string | null }[];
}

export interface Department {
  id: string;
  name: string;
  siteId: string;
  status: 'ACTIVE' | 'INACTIVE';
  ownerId: string | null;
  owner?: { id: string; name: string; email: string } | null;
}

export interface Site {
  id: string;
  name: string;
  code: string;
  address: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  departments: Department[];
  _count?: { assessments: number };
}

export interface Organisation {
  id: string;
  name: string;
  legalEntity: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  sites: Site[];
}

export interface UserRow {
  id: string;
  name: string;
  email: string;
  designation: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: { id: string; siteId: string | null; departmentId: string | null; role: { key: RoleKey; name: string }; site: Ref | null; department: Ref | null }[];
  restrictions: { id: string; permission: string; reason: string; expiresAt: string | null; createdAt: string }[];
  /** False when this user is outside the current administrator's scope (or is the administrator). */
  canManage: boolean;
}

export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
  designation: string | null;
  roles: { role: { key: RoleKey }; siteId: string | null; departmentId: string | null }[];
}

export interface RoleRow {
  id: string;
  key: RoleKey;
  name: string;
  description: string | null;
  permissions: string[];
  _count: { userRoles: number };
}

export interface ControlMapping {
  id: string;
  type: 'ISO_CLAUSE' | 'ANNEX_A' | 'INTERNAL_POLICY' | 'RISK';
  reference: string;
  title: string | null;
  needsReview: boolean;
}

export interface ChecklistItem {
  id: string;
  versionId: string;
  questionCode: string;
  sequence: number;
  question: string;
  description: string | null;
  guidance: string | null;
  isoClauseRaw: string | null;
  annexControlRaw: string | null;
  internalPolicyRef: string | null;
  riskRef: string | null;
  evidenceRequirement: string | null;
  evidenceMandatory: boolean;
  responseMandatory: boolean;
  defaultOwnerId: string | null;
  defaultOwner?: { id: string; name: string } | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  sourceRowId: string | null;
  mappings: ControlMapping[];
}

export interface ChecklistVersion {
  id: string;
  templateId: string;
  versionNumber: number;
  status: 'DRAFT' | 'UNDER_REVIEW' | 'PUBLISHED' | 'ARCHIVED';
  changeSummary: string | null;
  effectiveDate: string | null;
  publishedAt: string | null;
  createdAt: string;
  sourceImport?: { id: string; fileName: string } | null;
  _count?: { items: number; assessments: number };
}

export interface ChecklistTemplate {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  updatedAt: string;
  createdAt: string;
  versions: ChecklistVersion[];
}

export interface IsoReference {
  id: string;
  code: string;
  type: 'CLAUSE' | 'ANNEX_A';
  title: string;
  theme: string;
}

export interface HistoryEntry {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  reason: string | null;
  createdAt: string;
  actor: Ref | null;
  entityId?: string;
}

export interface Metrics {
  totalItems: number;
  counts: StatusCounts;
  compliancePercent: number | null;
  completionPercent: number;
  scoring: { policyVersion: number; policyName: string; earned: number; denominator: number; excludeNotApplicable: boolean; excludeNotAssessed: boolean };
  evidenceCoverage: { required: number; attached: number; verified: number; percent: number | null; verifiedPercent: number | null };
  byClause: { key: string; label: string; items: number; counts: StatusCounts; percent: number | null }[];
  byAnnexTheme: { key: string; label: string; items: number; counts: StatusCounts; percent: number | null }[];
}

export interface AssessmentRow {
  id: string;
  code: string;
  title: string;
  status: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  startDate: string;
  dueDate: string;
  round: number;
  approvalRequired: boolean;
  scope: string | null;
  ownerId: string;
  site: { id: string; name: string; code: string };
  department: Ref;
  owner: { id: string; name: string; email: string };
  checklistVersion: { id: string; versionNumber: number; template: { id: string; title: string } };
  _count: { assignments: number; findings: number; evidence: number };
  answered?: number;
  totalItems?: number;
  overdue?: boolean;
}

export interface AssessmentDetail extends AssessmentRow {
  metrics: Metrics;
  actions: Record<'edit' | 'release' | 'assign' | 'respond' | 'submit' | 'startReview' | 'review' | 'approve' | 'finalise' | 'reopen' | 'export', boolean> & {
    /** Separation-of-duties reasons why this user cannot review or approve (shown instead of the button). */
    blocked: Partial<Record<'review' | 'approve', string>>;
  };
  openClarificationCount: number;
  overallReview: { comments: string; createdAt: string; auditor: Ref } | null;
  approvals: { id: string; decision: string; comments: string | null; createdAt: string; approver: Ref }[];
  reports: { id: string; code: string; version: number; generatedAt: string }[];
  submissions: { id: string; round: number; createdAt: string }[];
  assignmentSummary: { assignee?: Ref; count: number }[];
  scoringPolicy: { version: number; name: string };
  createdBy: Ref;
}

export interface EvidenceVersion {
  id: string;
  version: number;
  originalFilename: string;
  mimeType: string;
  size: number;
  checksum: string;
  scanStatus: 'PENDING' | 'CLEAN' | 'INFECTED' | 'FAILED';
  scanDetail?: string | null;
  uploadedAt: string;
  uploader?: Ref;
}

export interface EvidenceRow {
  id: string;
  code: string;
  title: string;
  description: string | null;
  classification: string;
  currentVersion: number;
  verificationStatus: 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CLARIFICATION_REQUESTED';
  verificationNote?: string | null;
  createdAt: string;
  uploaderId?: string;
  versions: EvidenceVersion[];
  uploader?: Ref;
  site?: Ref;
  item?: { id: string; questionCode: string; question: string } | null;
  assessment?: { id: string; code: string; title?: string; status?: string } | null;
  finding?: { id: string; code: string; title?: string } | null;
  correctiveAction?: { id: string; code: string } | null;
}

export interface Review {
  id: string;
  decision: 'ACCEPTED' | 'REJECTED' | 'CLARIFICATION_REQUESTED' | 'COMMENT' | 'REVIEW_SUBMITTED';
  reason: string | null;
  comments: string | null;
  evidenceId: string | null;
  round: number;
  resolvedAt: string | null;
  createdAt: string;
  auditor: Ref;
}

export interface Comment {
  id: string;
  body: string;
  createdAt: string;
  author: Ref;
}

export interface WorkspaceItem extends ChecklistItem {
  response: { id: string; status: ResponseStatus; comment: string | null; justification: string | null; updatedAt: string; responder: Ref | null } | null;
  assignment: { id: string; assigneeId: string; dueDate: string | null; assignee: Ref } | null;
  evidence: { id: string; code: string; title: string; verificationStatus: string; currentVersion: number; versions: { originalFilename: string; scanStatus: string; size: number; mimeType: string }[] }[];
  latestReview: Review | null;
  commentCount: number;
  clarificationOpen: boolean;
}

export interface ItemDetail extends ChecklistItem {
  sourceRow: { id: string; sheetName: string; rowNumber: number; serialNo: string | null; rawData: Record<string, string | null> } | null;
  response: WorkspaceItem['response'];
  assignment: WorkspaceItem['assignment'];
  evidence: (EvidenceRow & { versions: EvidenceVersion[] })[];
  reviews: Review[];
  comments: Comment[];
  findings: { id: string; code: string; title: string; severity: string; status: string }[];
  responseHistory: { id: string; actorEmail: string | null; createdAt: string; metadata: { from: string | null; to: string } }[];
  clarificationOpen: boolean;
}

export interface FindingRow {
  id: string;
  code: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  auditorComments: string | null;
  status: string;
  dueDate: string;
  createdAt: string;
  closureRecommendation: string | null;
  ownerId: string | null;
  raisedById: string;
  overdue?: boolean;
  site: Ref;
  owner: Ref | null;
  raisedBy: Ref;
  assessment: { id: string; code: string; title: string; periodLabel: string };
  item: { id: string; questionCode: string; question: string } | null;
  _count: { actions: number };
}

export interface ActionRow {
  id: string;
  code: string;
  rootCause: string | null;
  immediateCorrection: string | null;
  correctiveAction: string;
  ownerId: string;
  targetDate: string;
  status: string;
  progressPercent: number;
  closureNotes: string | null;
  verificationComment: string | null;
  verifiedAt: string | null;
  overdue?: boolean;
  owner: Ref;
  finding: { id: string; code: string; title: string; severity: string; status: string; site?: Ref };
  _count?: { evidence: number; updates: number };
}

export interface ReportRow {
  id: string;
  code: string;
  version: number;
  title: string;
  size: number;
  checksum: string;
  approvalStatus: string;
  generatedAt: string;
  archivedAt: string | null;
  summary: { metrics: Metrics; findings: { total: number; open: number; criticalHigh: number }; period: string; checklistVersion: number };
  site: Ref;
  department: Ref;
  assessment: { id: string; code: string; periodLabel: string; status: string };
  generatedBy: Ref;
}

export interface AuditEventRow {
  id: string;
  seq: number;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  outcome: 'SUCCESS' | 'FAILURE' | 'DENIED';
  ip: string | null;
  metadata: Record<string, unknown> | null;
  hash: string;
  createdAt: string;
  actor: Ref | null;
}

export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  emailStatus: string;
  createdAt: string;
}

export interface DashboardSummary {
  assessmentsCount: number;
  kpis: {
    compliancePercent: number | null;
    totalQuestions: number;
    counts: StatusCounts;
    evidenceCoveragePercent: number | null;
    verifiedEvidencePercent: number | null;
    evidence: { required: number; attached: number; verified: number };
    completionPercent: number | null;
    openFindings: number;
    overdueFindings: number;
    overdueActions: number;
    pendingApprovals: number;
    approvedAssessments: number;
  };
  scoringNote: string | null;
  assessmentStatus: { status: string; count: number }[];
  byClause: { key: string; label: string; counts: StatusCounts; percent: number | null }[];
  byAnnexTheme: { key: string; label: string; counts: StatusCounts; percent: number | null }[];
  byControl: { key: string; label: string; counts: StatusCounts; percent: number | null }[];
  findingsBySeverity: { severity: string; count: number }[];
  findingsByStatus: { status: string; count: number }[];
  actionProgress: { status: string; count: number }[];
  branchComparison: { siteId: string; site: string; assessments: number; compliancePercent: number | null; counts: StatusCounts }[];
  trend: { period: string; assessments: number; compliancePercent: number | null }[];
  recentActivity: { id: string; action: string; entityType: string; entityId: string | null; actorEmail: string | null; createdAt: string; metadata: Record<string, unknown> | null; actor: { name: string } | null }[];
}

export interface ImportSheetSummary {
  sheetName: string;
  headerRow: number | null;
  titleRows: string[];
  columns: { letter: string; index: number; header: string; key: string; field: string | null }[];
  columnMap: Record<string, string>;
  detected: boolean;
  issues: string[];
  counts: { rows: number; errors: number; warnings: number; duplicates: number; mappingReview: number };
}

export interface ImportRecord {
  id: string;
  fileName: string;
  checksum: string;
  fileSize: number;
  status: 'PREVIEW' | 'CONFIRMED' | 'DISCARDED' | 'FAILED';
  sheetSummary: ImportSheetSummary[];
  errorSummary: { duplicateFile?: { importId: string; confirmedAt: string | null } } | null;
  createdAt: string;
  confirmedAt: string | null;
  uploadedBy?: Ref | null;
  versions: { id: string; versionNumber: number; status: string; template: { id: string; title: string } }[];
}

export interface ImportRow {
  id: string;
  sheetName: string;
  rowNumber: number;
  serialNo: string | null;
  rawData: Record<string, string | null>;
  mapped: { question: string | null; isoClauseRaw: string | null; annexControlRaw: string | null; description: string | null; priority: string | null; mappings: { type: string; reference: string; needsReview: boolean }[] };
  validationErrors: string[];
  warnings: string[];
  isDuplicate: boolean;
  included: boolean;
}
