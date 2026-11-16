import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/** Global hospital/site and assessment-period selection shown in the top bar. Persisted per browser. */
interface Filters {
  siteId: string;
  periodLabel: string;
  setSiteId: (v: string) => void;
  setPeriodLabel: (v: string) => void;
}

const FilterContext = createContext<Filters | null>(null);
const KEY = 'axiarix.filters';

function load(): { siteId: string; periodLabel: string } {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { siteId: '', periodLabel: '', ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { siteId: '', periodLabel: '' };
}

function save(v: { siteId: string; periodLabel: string }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(load);
  const value = useMemo<Filters>(
    () => ({
      ...state,
      setSiteId: (siteId) => setState((s) => (save({ ...s, siteId }), { ...s, siteId })),
      setPeriodLabel: (periodLabel) => setState((s) => (save({ ...s, periodLabel }), { ...s, periodLabel })),
    }),
    [state],
  );
  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters() {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error('useFilters must be used inside FilterProvider');
  return ctx;
}
