import path from 'node:path';

/** Canonical MIME type per allowed extension. Client-supplied MIME types are never trusted. */
export const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

const BLOCKED = /\.(exe|dll|bat|cmd|com|msi|scr|ps1|vbs|js|jar|sh|bin|app|apk|dmg|iso|html?|svg|php|py)$/i;

/** Reduces a client filename to a safe display name (no paths, control characters or reserved chars). */
export function sanitizeFilename(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/'));
  // eslint-disable-next-line no-control-regex
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_').replace(/^\.+/, '').trim();
  return cleaned.slice(0, 200) || 'file';
}

function sniff(ext: string, buf: Buffer): boolean {
  const starts = (...bytes: number[]) => bytes.every((b, i) => buf[i] === b);
  switch (ext) {
    case 'pdf':
      return buf.subarray(0, 5).toString('latin1') === '%PDF-';
    case 'png':
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'jpg':
    case 'jpeg':
      return starts(0xff, 0xd8, 0xff);
    case 'docx':
    case 'xlsx':
      return starts(0x50, 0x4b, 0x03, 0x04);
    case 'csv':
      return !buf.subarray(0, 8192).includes(0);
    default:
      return false;
  }
}

export interface FileCheck {
  ok: boolean;
  ext: string;
  mimeType: string;
  error?: string;
}

/**
 * Validates an upload against the configured allow-list, size limit and file signature.
 * Double extensions such as "report.pdf.exe" are rejected because the final extension is checked.
 */
export function checkFile(originalName: string, buf: Buffer, allowed: string[], maxBytes: number): FileCheck {
  const name = sanitizeFilename(originalName);
  const ext = path.extname(name).slice(1).toLowerCase();
  if (BLOCKED.test(name) || /\.(exe|bat|cmd|scr|js|vbs|ps1)\./i.test(name)) return { ok: false, ext, mimeType: '', error: 'Executable or script files are not permitted' };
  if (!allowed.includes(ext) || !MIME_BY_EXT[ext]) return { ok: false, ext, mimeType: '', error: `File type .${ext || '?'} is not permitted. Allowed: ${allowed.join(', ')}` };
  if (buf.length === 0) return { ok: false, ext, mimeType: '', error: 'File is empty' };
  if (buf.length > maxBytes) return { ok: false, ext, mimeType: '', error: `File exceeds the ${Math.round(maxBytes / 1048576)} MB limit` };
  if (!sniff(ext, buf)) return { ok: false, ext, mimeType: '', error: `File content does not match the .${ext} format` };
  return { ok: true, ext, mimeType: MIME_BY_EXT[ext] };
}
