import { describe, expect, it } from 'vitest';
import { formatBytes, formatPercent, humanize, initials } from '@/lib/utils';
import { clean } from '@/api/client';
import { passwordSchema } from '@/schemas/common';

describe('formatting helpers', () => {
  it('formats percentages without hiding null values', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(50)).toBe('50%');
    expect(formatPercent(33.333)).toBe('33.3%');
  });
  it('formats bytes and names', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(initials('Lakshmi Iyer')).toBe('LI');
    expect(humanize('PARTIALLY_COMPLIANT')).toBe('Partially compliant');
  });
  it('drops empty filter values before calling the API', () => {
    expect(clean({ siteId: '', periodLabel: 'Q3', page: 1, x: null })).toEqual({ periodLabel: 'Q3', page: 1 });
  });
  it('mirrors the backend password policy', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('alllowercase123').success).toBe(false);
    expect(passwordSchema.safeParse('Strong-Pass-2026').success).toBe(true);
  });
});
