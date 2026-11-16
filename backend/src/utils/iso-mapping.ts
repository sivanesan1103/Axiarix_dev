import { ANNEX_CODES, CLAUSE_CODES } from '../constants/iso27001.js';

export interface ParsedMapping {
  type: 'ISO_CLAUSE' | 'ANNEX_A';
  reference: string;
  needsReview: boolean;
}

export interface ParseResult {
  mappings: ParsedMapping[];
  warnings: string[];
}

/** Expands "5.19-5.22" / "5.19 - 5.22" into each code in the range. */
function expandRanges(text: string): string {
  return text.replace(/\b(\d{1,2})\.(\d{1,2})\s*[-–]\s*(?:\1\.)?(\d{1,2})\b/g, (_m, major: string, from: string, to: string) => {
    const a = Number(from);
    const b = Number(to);
    if (b < a || b - a > 40) return _m;
    return Array.from({ length: b - a + 1 }, (_, i) => `${major}.${a + i}`).join(', ');
  });
}

function dedupe(list: ParsedMapping[]): ParsedMapping[] {
  const seen = new Map<string, ParsedMapping>();
  for (const m of list) {
    const k = `${m.type}:${m.reference}`;
    const prev = seen.get(k);
    if (!prev) seen.set(k, m);
    else prev.needsReview = prev.needsReview || m.needsReview;
  }
  return [...seen.values()];
}

/**
 * Parses the source "Clauses" column.
 *
 * The Kauvery workbook's later rows place Annex A control numbers (e.g. "5.18",
 * "8.13") in the Clauses column. We never silently re-classify those: a code that is
 * only valid as an Annex A control is mapped as ANNEX_A but flagged `needsReview`,
 * and codes valid as both (e.g. "7.3") stay ISO_CLAUSE but are flagged when the same
 * cell also contains Annex-only codes. A reviewer must confirm before publishing.
 */
export function parseClauseCell(raw: unknown): ParseResult {
  const text = raw == null ? '' : String(raw).trim();
  const warnings: string[] = [];
  if (!text || text === '-') return { mappings: [], warnings };
  const tokens = expandRanges(text).match(/\d{1,2}(?:\.\d{1,2}){0,2}/g) ?? [];
  const annexOnly = tokens.filter((t) => ANNEX_CODES.has(t) && !CLAUSE_CODES.has(t));
  const mappings: ParsedMapping[] = [];
  for (const t of tokens) {
    const isClause = CLAUSE_CODES.has(t);
    const isAnnex = ANNEX_CODES.has(t);
    if (isClause) mappings.push({ type: 'ISO_CLAUSE', reference: t, needsReview: annexOnly.length > 0 });
    else if (isAnnex) mappings.push({ type: 'ANNEX_A', reference: t, needsReview: true });
    else warnings.push(`"${t}" is not a recognised ISO/IEC 27001:2022 clause or Annex A control`);
  }
  if (annexOnly.length) {
    warnings.push(
      `Clauses column contains Annex A control references (${annexOnly.join(', ')}); mapping requires review before publishing`,
    );
  }
  return { mappings: dedupe(mappings), warnings };
}

/** Parses the source "Controls (2022)" column, e.g. "8.2/8.3 Access Control, 8.5 Auth". */
export function parseControlCell(raw: unknown): ParseResult {
  const text = raw == null ? '' : String(raw).trim();
  const warnings: string[] = [];
  if (!text || text === '-') return { mappings: [], warnings };
  const tokens = expandRanges(text).match(/\b\d{1,2}\.\d{1,2}\b/g) ?? [];
  const mappings: ParsedMapping[] = [];
  for (const t of tokens) {
    if (ANNEX_CODES.has(t)) mappings.push({ type: 'ANNEX_A', reference: t, needsReview: false });
    else warnings.push(`"${t}" in Controls column is not a recognised Annex A control`);
  }
  if (!tokens.length) warnings.push('Controls column has text but no Annex A control number');
  return { mappings: dedupe(mappings), warnings };
}
