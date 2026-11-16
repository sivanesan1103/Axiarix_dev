import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseClauseCell, parseControlCell } from '../src/utils/iso-mapping.js';
import { countStatuses, evidenceCoverage, scoreCounts } from '../src/services/compliance.service.js';
import { checkFile, sanitizeFilename } from '../src/modules/evidence/file-validation.js';
import { base32Encode, decryptSecret, encryptSecret, totpCode, verifyTotp } from '../src/utils/crypto.js';
import { parseWorkbook } from '../src/modules/imports/excel-parser.js';
import { ANNEX_A, CLAUSES } from '../src/constants/iso27001.js';

const policy = { weightCompliant: 1, weightPartial: 0.5, weightNonCompliant: 0, excludeNotApplicable: true, excludeNotAssessed: false };

describe('ISO reference catalogue', () => {
  it('contains all 93 Annex A controls and clauses 4–10', () => {
    expect(ANNEX_A).toHaveLength(93);
    expect(new Set(CLAUSES.map((c) => c.code.split('.')[0]))).toEqual(new Set(['4', '5', '6', '7', '8', '9', '10']));
  });
});

describe('ISO mapping parser', () => {
  it('parses top-level and sub-clauses from the Clauses column', () => {
    const r = parseClauseCell('9.1, 10');
    expect(r.mappings).toEqual([
      { type: 'ISO_CLAUSE', reference: '9.1', needsReview: false },
      { type: 'ISO_CLAUSE', reference: '10', needsReview: false },
    ]);
  });
  it('flags Annex A numbers found in the Clauses column instead of silently re-mapping them', () => {
    const r = parseClauseCell('5.18, 5.19-5.22');
    expect(r.mappings.map((m) => m.reference)).toEqual(['5.18', '5.19', '5.20', '5.21', '5.22']);
    expect(r.mappings.every((m) => m.type === 'ANNEX_A' && m.needsReview)).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/requires review/);
  });
  it('parses slash-separated controls from the Controls column', () => {
    const r = parseControlCell('8.2/8.3 Access Control, 8.5 Auth, 8.9 Config Mgmt');
    expect(r.mappings.map((m) => m.reference)).toEqual(['8.2', '8.3', '8.5', '8.9']);
    expect(r.mappings.every((m) => !m.needsReview)).toBe(true);
  });
  it('warns on unknown references', () => {
    expect(parseControlCell('9.99 Something').warnings.length).toBeGreaterThan(0);
  });
});

describe('compliance scoring (SRS §9)', () => {
  it('scores C=1, PC=0.5, NC=0 and excludes N/A per policy', () => {
    const c = countStatuses(['COMPLIANT', 'PARTIALLY_COMPLIANT', 'NON_COMPLIANT', 'NOT_APPLICABLE']);
    expect(scoreCounts(c, policy)).toEqual({ earned: 1.5, denominator: 3, percent: 50 });
  });
  it('keeps Not Assessed in the denominator unless the policy excludes it', () => {
    const c = countStatuses(['COMPLIANT', 'NOT_ASSESSED']);
    expect(scoreCounts(c, policy).percent).toBe(50);
    expect(scoreCounts(c, { ...policy, excludeNotAssessed: true }).percent).toBe(100);
  });
  it('returns null rather than a misleading figure when nothing is scorable', () => {
    expect(scoreCounts(countStatuses(['NOT_APPLICABLE']), policy).percent).toBeNull();
  });
  it('does not count rejected or unscanned evidence towards coverage', () => {
    const items = [
      { id: 'a', evidenceMandatory: true, mappings: [] },
      { id: 'b', evidenceMandatory: true, mappings: [] },
      { id: 'c', evidenceMandatory: true, mappings: [] },
      { id: 'd', evidenceMandatory: false, mappings: [] },
    ];
    const ev = [
      { itemId: 'a', verificationStatus: 'ACCEPTED', deletedAt: null, versions: [{ scanStatus: 'CLEAN' }] },
      { itemId: 'b', verificationStatus: 'REJECTED', deletedAt: null, versions: [{ scanStatus: 'CLEAN' }] },
      { itemId: 'c', verificationStatus: 'PENDING', deletedAt: null, versions: [{ scanStatus: 'PENDING' }] },
    ];
    expect(evidenceCoverage(items, ev)).toEqual({ required: 3, attached: 1, verified: 1, percent: 33.3, verifiedPercent: 33.3 });
  });
});

describe('evidence file validation', () => {
  const allowed = ['pdf', 'docx', 'xlsx', 'csv', 'png', 'jpg'];
  it('accepts a real PDF signature', () => {
    expect(checkFile('report.pdf', Buffer.from('%PDF-1.7 test'), allowed, 1e6).ok).toBe(true);
  });
  it('rejects double extensions and executables', () => {
    expect(checkFile('report.pdf.exe', Buffer.from('MZ'), allowed, 1e6).ok).toBe(false);
  });
  it('rejects content that does not match its extension', () => {
    expect(checkFile('fake.pdf', Buffer.from('<html>'), allowed, 1e6).error).toMatch(/does not match/);
  });
  it('enforces the size limit and allow-list', () => {
    expect(checkFile('big.pdf', Buffer.alloc(2000, 1), allowed, 1000).ok).toBe(false);
    expect(checkFile('notes.txt', Buffer.from('hi'), allowed, 1e6).ok).toBe(false);
  });
  it('sanitises path traversal in file names', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('..\\..\\evil.pdf')).toBe('evil.pdf');
  });
});

describe('security utilities', () => {
  it('round-trips AES-GCM secret encryption', () => {
    expect(decryptSecret(encryptSecret('JBSWY3DPEHPK3PXP'))).toBe('JBSWY3DPEHPK3PXP');
  });
  it('matches the RFC 6238 SHA-1 test vector', () => {
    const secret = base32Encode(Buffer.from('12345678901234567890'));
    expect(totpCode(secret, 59_000)).toBe('287082');
    expect(verifyTotp(secret, totpCode(secret))).toBe(true);
    expect(verifyTotp(secret, '000000')).toBe(totpCode(secret) === '000000');
  });
});

describe('Kauvery workbook parser', () => {
  it('reads both worksheets with their different layouts and preserves every column', async () => {
    const sheets = await parseWorkbook(fs.readFileSync('source-data/kauvery-vadapalani-it-ia-checklist.xlsx'));
    expect(sheets.map((s) => s.sheetName)).toEqual(['Last Year - IA -Checklist', 'Internal Audit -Checklist (2)']);
    const [last, current] = sheets;
    expect(last.columns).toHaveLength(13);
    expect(current.columns).toHaveLength(15);
    expect(current.columnMap.remarksObserved).toMatch(/Remarks observed on 05112026/);
    expect(current.columnMap.evidencesAvailability).toBeDefined();
    for (const s of sheets) {
      expect(s.rows).toHaveLength(75);
      expect(s.rows.every((r) => r.errors.length === 0)).toBe(true);
      expect(s.titleRows[0]).toBe('Kauvery Hospitals Group');
    }
    const row7 = current.rows[0];
    expect(row7.rowNumber).toBe(7);
    expect(row7.mapped.question).toBe('Threat Intelligence Related Reports');
    expect(row7.rawData['Available Evidences ( As mentioned by Auditee ) Name :']).toBe('AV,Zscaler Report');
  });
});
