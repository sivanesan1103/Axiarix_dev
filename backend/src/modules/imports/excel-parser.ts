import ExcelJS from 'exceljs';
import { ANNEX_CODES } from '../../constants/iso27001.js';
import { parseClauseCell, parseControlCell, type ParsedMapping } from '../../utils/iso-mapping.js';

/** Canonical fields the importer understands, with the header patterns that identify them. */
export const IMPORT_FIELDS = {
  serialNo: { label: 'Serial number', pattern: /^sl\.?\s*no\.?$|^s\.?\s*no\.?$|^serial/i },
  description: { label: 'Reports / Evidence Description', pattern: /evidence description|^description$|^question$/i },
  clauses: { label: 'Clauses', pattern: /^clauses?$/i },
  controls: { label: 'Controls (2022)', pattern: /^controls?\b/i },
  explanation: { label: 'Explanation', pattern: /^explanation/i },
  evidenceAvailableStatus: { label: 'Evidence Available Status', pattern: /evidence available status/i },
  availableEvidences: { label: 'Available Evidences', pattern: /^available evidences?/i },
  remarksObserved: { label: 'Remarks observed on …', pattern: /^remarks observed/i },
  evidenceShownStatus: { label: 'Evidence Shown Status', pattern: /evidence shown status/i },
  evidencesAvailability: { label: 'Evidences Availability', pattern: /^evidences? availability/i },
  strengths: { label: 'Strengths', pattern: /^strengths?$/i },
  opportunitiesForImprovement: { label: 'Opportunities For Improvement', pattern: /opportunit/i },
  observations: { label: 'Observations', pattern: /^observations?$/i },
  observationClosure: { label: 'Observation Closure', pattern: /observation closure/i },
  remarks: { label: 'Remarks', pattern: /^remarks$/i },
} as const;

export type ImportField = keyof typeof IMPORT_FIELDS;
export const REQUIRED_FIELDS: ImportField[] = ['description'];

export interface ColumnInfo {
  letter: string;
  index: number;
  header: string;
  key: string; // unique key used in rawData (header, suffixed with column letter if duplicated)
  field: ImportField | null;
}

export interface ParsedRow {
  rowNumber: number;
  serialNo: string | null;
  rawData: Record<string, string | null>;
  mapped: MappedRow;
  errors: string[];
  warnings: string[];
  isDuplicate: boolean;
}

export interface MappedRow {
  question: string | null;
  isoClauseRaw: string | null;
  annexControlRaw: string | null;
  description: string | null;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  mappings: ParsedMapping[];
}

export interface ParsedSheet {
  sheetName: string;
  headerRow: number | null;
  titleRows: string[];
  columns: ColumnInfo[];
  columnMap: Partial<Record<ImportField, string>>; // field -> column key
  rows: ParsedRow[];
  detected: boolean;
  issues: string[];
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Converts any ExcelJS cell value into its displayed text without losing content. */
export function cellText(value: ExcelJS.CellValue): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.trim() === '' ? null : value.replace(/\r\n/g, '\n').trimEnd();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('richText' in value) return cellText(value.richText.map((r) => r.text).join(''));
    if ('result' in value) return cellText((value as ExcelJS.CellFormulaValue).result as ExcelJS.CellValue);
    if ('text' in value) return cellText((value as ExcelJS.CellHyperlinkValue).text);
    if ('error' in value) return String((value as ExcelJS.CellErrorValue).error);
  }
  return String(value);
}

function columnLetter(index: number) {
  let s = '';
  let n = index;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function detectField(header: string): ImportField | null {
  const h = norm(header);
  for (const [field, def] of Object.entries(IMPORT_FIELDS) as [ImportField, (typeof IMPORT_FIELDS)[ImportField]][]) {
    if (def.pattern.test(h)) return field;
  }
  return null;
}

function parsePriority(text: string | null): MappedRow['priority'] {
  const m = text?.match(/priority\s*:\s*(critical|high|medium|low)/i);
  return m ? (m[1].toUpperCase() as MappedRow['priority']) : null;
}

/** Builds normalised checklist fields from a row's raw data using the sheet's column map. */
export function mapRow(rawData: Record<string, string | null>, columnMap: Partial<Record<ImportField, string>>) {
  const get = (f: ImportField) => (columnMap[f] ? (rawData[columnMap[f]!] ?? null) : null);
  const errors: string[] = [];
  const warnings: string[] = [];
  const question = get('description');
  if (!question) errors.push('Missing "Reports / Evidence Description" – row cannot become a checklist question');
  const clause = parseClauseCell(get('clauses'));
  const control = parseControlCell(get('controls'));
  warnings.push(...clause.warnings, ...control.warnings);
  const mappings = [...control.mappings];
  for (const m of clause.mappings) {
    const existing = mappings.find((x) => x.type === m.type && x.reference === m.reference);
    if (existing) existing.needsReview = existing.needsReview && m.needsReview;
    else mappings.push(m);
  }
  // With no Controls value, a dotted code such as "7.3" in the Clauses column is ambiguous:
  // it is both a clause (Awareness) and an Annex A control (Securing offices). Flag, never guess.
  if (!get('controls')) {
    const ambiguous = mappings.filter((m) => m.type === 'ISO_CLAUSE' && m.reference.includes('.') && ANNEX_CODES.has(m.reference));
    for (const m of ambiguous) m.needsReview = true;
    if (ambiguous.length) {
      warnings.push(
        `Ambiguous reference(s) ${ambiguous.map((m) => m.reference).join(', ')}: valid as both a clause and an Annex A control, and the Controls column is empty`,
      );
    }
  }
  if (!mappings.length && question) warnings.push('No ISO clause or Annex A control could be identified');
  if (!get('serialNo')) warnings.push('Missing serial number');
  const explanation = get('explanation');
  const mapped: MappedRow = {
    question,
    isoClauseRaw: get('clauses'),
    annexControlRaw: get('controls'),
    description: explanation,
    priority: parsePriority(explanation),
    mappings,
  };
  return { mapped, errors, warnings };
}

/** Flags rows whose description repeats an earlier row in the same sheet (case/space-insensitive). */
export function markDuplicates(rows: ParsedRow[]) {
  const seen = new Map<string, number>();
  for (const r of rows) {
    if (!r.mapped.question) continue;
    const k = norm(r.mapped.question).toLowerCase();
    const first = seen.get(k);
    if (first !== undefined) {
      r.isDuplicate = true;
      r.warnings.push(`Duplicate of row ${first} in this worksheet`);
    } else seen.set(k, r.rowNumber);
  }
}

/**
 * Parses every worksheet of a checklist workbook.
 *
 * The header row is detected as the first row (within the first 20) where at least
 * three cells match known column headers, so the different layouts of the two
 * Kauvery worksheets (14 vs 16 columns) are handled without hard-coded positions.
 * Every non-empty cell is preserved verbatim under its original header text.
 */
export async function parseWorkbook(buffer: Buffer): Promise<ParsedSheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheets: ParsedSheet[] = [];

  wb.eachSheet((ws) => {
    const sheet: ParsedSheet = { sheetName: ws.name, headerRow: null, titleRows: [], columns: [], columnMap: {}, rows: [], detected: false, issues: [] };
    const maxScan = Math.min(ws.rowCount, 20);
    for (let r = 1; r <= maxScan; r++) {
      const row = ws.getRow(r);
      let matches = 0;
      row.eachCell((cell) => {
        const t = cellText(cell.value);
        if (t && detectField(t)) matches++;
      });
      if (matches >= 3) {
        sheet.headerRow = r;
        break;
      }
    }
    if (!sheet.headerRow) {
      sheet.issues.push('No header row detected (expected columns such as SL.NO, Reports / Evidence Description, Clauses)');
      sheets.push(sheet);
      return;
    }

    // Title / banner rows above the header (organisation, checklist name, unit) are kept as metadata.
    for (let r = 1; r < sheet.headerRow; r++) {
      const texts = new Set<string>();
      ws.getRow(r).eachCell((c) => {
        const t = cellText(c.value);
        if (t) texts.add(norm(t));
      });
      if (texts.size) sheet.titleRows.push([...texts].join(' | '));
    }

    const usedKeys = new Set<string>();
    ws.getRow(sheet.headerRow).eachCell({ includeEmpty: false }, (cell, col) => {
      const header = cellText(cell.value);
      if (!header) return;
      const clean = norm(header);
      const letter = columnLetter(col);
      const key = usedKeys.has(clean) ? `${clean} [${letter}]` : clean;
      usedKeys.add(key);
      const field = detectField(clean);
      sheet.columns.push({ letter, index: col, header: clean, key, field });
      if (field && !sheet.columnMap[field]) sheet.columnMap[field] = key;
    });

    for (const f of REQUIRED_FIELDS) if (!sheet.columnMap[f]) sheet.issues.push(`Required column "${IMPORT_FIELDS[f].label}" not found`);

    for (let r = sheet.headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const rawData: Record<string, string | null> = {};
      let hasContent = false;
      for (const c of sheet.columns) {
        const t = cellText(row.getCell(c.index).value);
        rawData[c.key] = t;
        if (t) hasContent = true;
      }
      // Cells outside the header columns are preserved too, so no source content is discarded.
      row.eachCell({ includeEmpty: false }, (cell, col) => {
        if (sheet.columns.some((c) => c.index === col)) return;
        const t = cellText(cell.value);
        if (t) {
          rawData[`(unlabelled column ${columnLetter(col)})`] = t;
          hasContent = true;
        }
      });
      if (!hasContent) continue;
      const { mapped, errors, warnings } = mapRow(rawData, sheet.columnMap);
      sheet.rows.push({
        rowNumber: r,
        serialNo: sheet.columnMap.serialNo ? rawData[sheet.columnMap.serialNo] : null,
        rawData,
        mapped,
        errors,
        warnings,
        isDuplicate: false,
      });
    }
    markDuplicates(sheet.rows);
    sheet.detected = sheet.issues.length === 0;
    sheets.push(sheet);
  });
  return sheets;
}
