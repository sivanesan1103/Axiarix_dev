/** Display labels and badge tones for every workflow status in the system. */
export type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'bad' | 'info';

export const ASSESSMENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  ASSIGNED: { label: 'Assigned', tone: 'info' },
  IN_PROGRESS: { label: 'In progress', tone: 'brand' },
  SUBMITTED_FOR_AUDIT: { label: 'Submitted for audit', tone: 'info' },
  UNDER_REVIEW: { label: 'Under review', tone: 'brand' },
  CLARIFICATION_REQUIRED: { label: 'Clarification required', tone: 'warn' },
  REVIEWED: { label: 'Reviewed', tone: 'ok' },
  PENDING_APPROVAL: { label: 'Pending approval', tone: 'warn' },
  APPROVED: { label: 'Approved / closed', tone: 'ok' },
};

export const ASSESSMENT_FLOW = ['DRAFT', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED_FOR_AUDIT', 'UNDER_REVIEW', 'CLARIFICATION_REQUIRED', 'REVIEWED', 'PENDING_APPROVAL', 'APPROVED'];

export const RESPONSE_STATUS: Record<string, { label: string; short: string; tone: Tone; color: string }> = {
  COMPLIANT: { label: 'Compliant', short: 'C', tone: 'ok', color: '#55C185' },
  PARTIALLY_COMPLIANT: { label: 'Partially compliant', short: 'PC', tone: 'warn', color: '#F0A33E' },
  NON_COMPLIANT: { label: 'Non-compliant', short: 'NC', tone: 'bad', color: '#E5484D' },
  NOT_APPLICABLE: { label: 'Not applicable', short: 'N/A', tone: 'neutral', color: '#B9B9C3' },
  NOT_ASSESSED: { label: 'Not assessed', short: '—', tone: 'neutral', color: 'var(--color-chart-track)' },
};

export const CHECKLIST_STATUS: Record<string, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  UNDER_REVIEW: { label: 'Under review', tone: 'warn' },
  PUBLISHED: { label: 'Published', tone: 'ok' },
  ARCHIVED: { label: 'Archived', tone: 'neutral' },
};

export const EVIDENCE_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'Pending review', tone: 'neutral' },
  ACCEPTED: { label: 'Accepted', tone: 'ok' },
  REJECTED: { label: 'Rejected', tone: 'bad' },
  CLARIFICATION_REQUESTED: { label: 'Clarification', tone: 'warn' },
};

export const SCAN_STATUS: Record<string, { label: string; tone: Tone }> = {
  PENDING: { label: 'Scanning', tone: 'neutral' },
  CLEAN: { label: 'Clean', tone: 'ok' },
  INFECTED: { label: 'Infected', tone: 'bad' },
  FAILED: { label: 'Scan failed', tone: 'warn' },
};

export const SEVERITY: Record<string, { label: string; tone: Tone; color: string }> = {
  CRITICAL: { label: 'Critical', tone: 'bad', color: '#B4232A' },
  HIGH: { label: 'High', tone: 'bad', color: '#E5484D' },
  MEDIUM: { label: 'Medium', tone: 'warn', color: '#F0A33E' },
  LOW: { label: 'Low', tone: 'info', color: '#7C5CFA' },
  OBSERVATION: { label: 'Observation', tone: 'neutral', color: '#B9B9C3' },
};

export const FINDING_STATUS: Record<string, { label: string; tone: Tone }> = {
  OPEN: { label: 'Open', tone: 'bad' },
  ASSIGNED: { label: 'Assigned', tone: 'info' },
  ACTION_IN_PROGRESS: { label: 'Action in progress', tone: 'brand' },
  READY_FOR_VERIFICATION: { label: 'Ready for verification', tone: 'warn' },
  CLOSED: { label: 'Verified / closed', tone: 'ok' },
};

export const FINDING_CATEGORY: Record<string, string> = {
  MAJOR_NONCONFORMITY: 'Major nonconformity',
  MINOR_NONCONFORMITY: 'Minor nonconformity',
  OBSERVATION: 'Observation',
  OPPORTUNITY_FOR_IMPROVEMENT: 'Opportunity for improvement',
};

export const ACTION_STATUS: Record<string, { label: string; tone: Tone; color: string }> = {
  PLANNED: { label: 'Planned', tone: 'neutral', color: 'var(--color-brand-tint)' },
  IN_PROGRESS: { label: 'In progress', tone: 'brand', color: 'var(--color-brand)' },
  RETURNED: { label: 'Returned', tone: 'bad', color: '#E5484D' },
  SUBMITTED_FOR_VERIFICATION: { label: 'Awaiting verification', tone: 'warn', color: '#F0A33E' },
  VERIFIED: { label: 'Verified', tone: 'ok', color: '#55C185' },
};

export const PRIORITY: Record<string, { label: string; tone: Tone }> = {
  CRITICAL: { label: 'Critical', tone: 'bad' },
  HIGH: { label: 'High', tone: 'warn' },
  MEDIUM: { label: 'Medium', tone: 'neutral' },
  LOW: { label: 'Low', tone: 'neutral' },
};

export const ROLE_LABEL: Record<string, string> = {
  SYSTEM_ADMIN: 'System Administrator',
  ISMS_OWNER: 'ISMS / Compliance Owner',
  IT_OWNER: 'IT Department Owner',
  CONTRIBUTOR: 'IT Control Owner',
  AUDITOR: 'Auditor',
  MANAGEMENT: 'Management Viewer',
};

export const CLASSIFICATION: Record<string, string> = {
  PUBLIC: 'Public',
  INTERNAL: 'Internal',
  CONFIDENTIAL: 'Confidential',
  RESTRICTED: 'Restricted',
};
