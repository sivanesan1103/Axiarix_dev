import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useFilters } from '@/contexts/FilterContext';
import { organisationService } from '@/services/organisation.service';
import type { FilterChip } from '@/components/common';

/**
 * The branch and period chosen in the top bar, ready to merge into a list query,
 * plus chips for the "Filtered by" row. Every list page uses this so the top bar
 * filters apply everywhere.
 */
export function useScope() {
  const { siteId, periodLabel, setSiteId, setPeriodLabel } = useFilters();
  const { can } = useAuth();
  const org = useQuery({ queryKey: ['org'], queryFn: organisationService.current, enabled: can('organisation:read', 'dashboard:read') });
  const siteName = org.data?.sites.find((s) => s.id === siteId)?.name;
  const chips = useMemo<FilterChip[]>(
    () => [
      ...(siteId ? [{ key: 'site', label: 'Branch', value: siteName ?? '…', onClear: () => setSiteId('') }] : []),
      ...(periodLabel ? [{ key: 'period', label: 'Period', value: periodLabel, onClear: () => setPeriodLabel('') }] : []),
    ],
    [siteId, siteName, periodLabel, setSiteId, setPeriodLabel],
  );
  return {
    siteId,
    periodLabel,
    /** Query params for list endpoints (empty values are dropped by the API client). */
    params: { siteId: siteId || undefined, periodLabel: periodLabel || undefined },
    chips,
    clear: () => {
      setSiteId('');
      setPeriodLabel('');
    },
  };
}

/** Builds chips for a page's own filters from its params and a label map. */
export function pageChips(
  params: Record<string, unknown>,
  labels: Record<string, { label: string; format?: (v: string) => string }>,
  set: (patch: Record<string, unknown>) => void,
): FilterChip[] {
  return Object.entries(labels)
    .filter(([k]) => params[k] !== undefined && params[k] !== '')
    .map(([k, { label, format }]) => ({ key: k, label, value: format ? format(String(params[k])) : String(params[k]), onClear: () => set({ [k]: '' }) }));
}
