import ExcelJS from 'exceljs';
import { cellText } from '../imports/excel-parser.js';

/**
 * Reads an organisation setup workbook (see sample-org/01-organisation-setup.xlsx):
 * sheets "Organisation" (Field | Value), "Branches", "Departments" and "Users".
 * Header rows are located by their first header text, so a note row above the table is fine.
 * The result is a draft for the wizard; nothing is saved here.
 */
export interface SetupDraft {
  organisation: { name: string; legalEntity: string | null };
  branches: Array<{ code: string; name: string; address: string | null }>;
  departments: Array<{ branchCode: string; name: string; ownerEmail: string | null }>;
  users: Array<{ name: string; email: string; designation: string | null; roleKey: string; branchCode: string | null; department: string | null; restricted: string[] }>;
  warnings: string[];
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function findSheet(wb: ExcelJS.Workbook, name: string) {
  return wb.worksheets.find((w) => norm(w.name).toLowerCase() === name.toLowerCase());
}

/** Returns rows below the header row whose first cell starts with `firstHeader`, keyed by column index. */
function tableRows(ws: ExcelJS.Worksheet | undefined, firstHeader: RegExp): string[][] {
  if (!ws) return [];
  let header = 0;
  for (let r = 1; r <= Math.min(ws.rowCount, 15); r++) {
    if (firstHeader.test(norm(cellText(ws.getRow(r).getCell(1).value)))) {
      header = r;
      break;
    }
  }
  if (!header) return [];
  const width = ws.getRow(header).cellCount;
  const out: string[][] = [];
  for (let r = header + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const vals = Array.from({ length: width }, (_, i) => norm(cellText(row.getCell(i + 1).value)));
    if (vals.every((v) => !v)) continue;
    out.push(vals);
  }
  return out;
}

export async function parseSetupWorkbook(buffer: Buffer): Promise<SetupDraft> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const warnings: string[] = [];

  const fields = new Map<string, string>();
  for (const [k, v] of tableRows(findSheet(wb, 'Organisation'), /^field$/i)) if (k) fields.set(k.toLowerCase(), v);
  if (!fields.size) warnings.push('No "Organisation" sheet with Field / Value rows was found.');

  const branches = tableRows(findSheet(wb, 'Branches'), /^branch code$/i).map(([code, name, address]) => ({ code: code.toUpperCase(), name, address: address || null }));
  if (!branches.length) warnings.push('No branches found on the "Branches" sheet.');

  const departments = tableRows(findSheet(wb, 'Departments'), /^branch code$/i).map(([branchCode, name, ownerEmail]) => ({
    branchCode: branchCode.toUpperCase(),
    name,
    ownerEmail: ownerEmail ? ownerEmail.toLowerCase() : null,
  }));

  const users = tableRows(findSheet(wb, 'Users'), /^full name$/i).map(([name, email, designation, roleKey, branchCode, department, restricted]) => ({
    name,
    email: (email ?? '').toLowerCase(),
    designation: designation || null,
    roleKey: (roleKey ?? '').toUpperCase(),
    branchCode: branchCode ? branchCode.toUpperCase() : null,
    department: department || null,
    restricted: (restricted ?? '')
      .split(/[,;\n]/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean),
  }));
  if (!users.length) warnings.push('No users found on the "Users" sheet.');

  return {
    organisation: { name: fields.get('organisation name') ?? '', legalEntity: fields.get('legal entity') || null },
    branches,
    departments,
    users,
    warnings,
  };
}
