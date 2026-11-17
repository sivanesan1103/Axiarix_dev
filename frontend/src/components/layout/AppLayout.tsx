import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck, ChevronDown, ChevronRight, Crosshair, LogOut, Menu, Moon, PanelLeft, Search, Settings as SettingsIcon, Sun, X } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { useAuth } from '@/contexts/AuthContext';
import { useFilters } from '@/contexts/FilterContext';
import { organisationService } from '@/services/organisation.service';
import { assessmentsService } from '@/services/assessments.service';
import { notificationsService, searchService } from '@/services/admin.service';
import { Avatar } from '@/components/ui/display';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, Popover, PopoverContent, PopoverTrigger, Tooltip, TooltipProvider } from '@/components/ui/overlays';
import { cn, relativeTime } from '@/lib/utils';
import { ROLE_LABEL } from '@/constants/status';
import { MfaEnrolmentGate } from './MfaEnrolmentGate';
import { GROUP_LABEL, NAV, SEGMENT_LABEL, type NavItem } from './nav';

const SIDEBAR_KEY = 'axiarix.sidebar.expanded';

function Logo({ expanded }: { expanded: boolean }) {
  return (
    <Link to="/" className="flex h-[72px] items-center gap-2.5 px-6" aria-label="Axiarix home">
      <svg viewBox="0 0 32 32" className="size-8 shrink-0 text-ink" aria-hidden>
        <circle cx="16" cy="7" r="5" fill="currentColor" />
        <circle cx="8" cy="20" r="5" fill="currentColor" />
        <circle cx="24" cy="20" r="5" fill="currentColor" />
        <path d="M16 12v7M12 18l4 1 4-1" stroke="currentColor" strokeWidth="3" />
        <circle cx="16" cy="26" r="3" fill="#4B10F0" />
      </svg>
      {expanded && (
        <span className="leading-tight">
          <span className="block text-[15px] font-semibold tracking-[-0.01em]">Axiarix</span>
          <span className="block text-[11px] text-muted">ISO/IEC 27001:2022</span>
        </span>
      )}
    </Link>
  );
}

function Sidebar({ expanded, mobileOpen, onClose }: { expanded: boolean; mobileOpen: boolean; onClose: () => void }) {
  const { can } = useAuth();
  const wide = expanded || mobileOpen;
  const items = NAV.filter((n) => n.any.length === 0 || can(...n.any));
  const groups = (['platform', 'programme', 'audit', 'admin'] as const).map((g) => ({ g, items: items.filter((i) => i.group === g) })).filter((x) => x.items.length);
  const bottom = items.filter((i) => i.group === 'account');
  const renderItem = (n: NavItem) => {
    const link = (
      <NavLink
        key={n.to}
        to={n.to}
        end={n.to === '/'}
        onClick={onClose}
        aria-label={n.label}
        className={({ isActive }) =>
          cn(
            'group relative flex h-10 items-center gap-3 rounded-md text-[14px] transition-colors',
            wide ? 'mx-3 px-3' : 'mx-auto w-11 justify-center',
            isActive ? 'bg-brand-soft/60 font-medium text-brand' : 'text-ink-2 hover:bg-muted-bg hover:text-ink',
          )
        }
      >
        {({ isActive }) => (
          <>
            {isActive && <span className={cn('absolute top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r-full bg-brand', wide ? '-left-3' : '-left-[22px]')} />}
            <n.icon className={cn('size-[20px] shrink-0', isActive ? 'text-brand' : 'text-ink-2')} strokeWidth={1.6} />
            {wide && <span className="truncate">{n.label}</span>}
          </>
        )}
      </NavLink>
    );
    // Radix Slot cannot merge NavLink's function className, so the tooltip wraps a plain element.
    return wide ? (
      link
    ) : (
      <Tooltip key={n.to} content={n.label} side="right">
        <div>{link}</div>
      </Tooltip>
    );
  };
  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-40 bg-overlay md:hidden" onClick={onClose} />}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col border-r border-line bg-surface transition-[width,transform] duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0',
          expanded ? 'w-[248px]' : 'w-[88px]',
          mobileOpen ? 'w-[248px] translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex items-center justify-between">
          <Logo expanded={wide} />
          {mobileOpen && (
            <button className="mr-3 rounded p-1.5 md:hidden" onClick={onClose} aria-label="Close menu">
              <X className="size-4" />
            </button>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto pb-3 scrollbar-thin" aria-label="Main">
          {groups.map(({ g, items: list }, i) => (
            <div key={g} className={cn('space-y-0.5', i > 0 && 'mt-3')}>
              {wide ? (
                <p className="px-6 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-faint">{GROUP_LABEL[g]}</p>
              ) : (
                i > 0 && <div className="mx-auto mb-2 h-px w-8 bg-line" aria-hidden />
              )}
              {list.map(renderItem)}
            </div>
          ))}
        </nav>
        <div className="space-y-1 border-t border-line py-3">{bottom.map(renderItem)}</div>
      </aside>
    </>
  );
}

/** Compact breadcrumb trail. The page title itself lives in each page's header, so it is not repeated here. */
function Breadcrumbs() {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean);
  // Record ids (UUIDs) are not useful as crumbs; skip them except as the final "Details" crumb.
  const isId = (seg: string) => seg.length > 20;
  const crumbs = segments
    .map((seg, i) => ({ seg, i, label: SEGMENT_LABEL[seg] ?? (isId(seg) ? 'Details' : seg), to: '/' + segments.slice(0, i + 1).join('/') }))
    .filter((c) => !isId(c.seg) || (c.i === segments.length - 1 && !SEGMENT_LABEL[segments[c.i - 1]]?.startsWith('Version')));
  const all = crumbs.length ? crumbs : [{ label: 'Dashboard', to: '/' }];
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 text-[13px] text-muted sm:flex">
      {all.map((c, i) => (
        <span key={c.to} className="flex min-w-0 items-center gap-1">
          {i > 0 && <ChevronRight className="size-3.5 shrink-0" />}
          {i < all.length - 1 ? (
            <Link to={c.to} className="truncate hover:text-ink">
              {c.label}
            </Link>
          ) : (
            <span className="truncate font-medium text-ink">{c.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

function SearchResults({ q, onPick }: { q: string; onPick: (link: string) => void }) {
  const results = useQuery({ queryKey: ['search', q], queryFn: () => searchService.search(q), enabled: q.length >= 2 });
  if (q.length < 2) return <p className="px-3 py-4 text-sm text-muted">Type at least 2 characters.</p>;
  if (results.isLoading) return <p className="px-3 py-4 text-sm text-muted">Searching…</p>;
  if (!results.data?.length) return <p className="px-3 py-4 text-sm text-muted">No matches for “{q}”.</p>;
  return (
    <>
      {results.data.map((r) => (
        <button key={`${r.type}-${r.id}`} className="flex w-full flex-col items-start rounded-md px-3 py-2 text-left hover:bg-muted-bg" onClick={() => onPick(r.link)}>
          <span className="text-sm font-medium text-ink">{r.title}</span>
          <span className="text-xs capitalize text-muted">
            {r.type} · {r.subtitle}
          </span>
        </button>
      ))}
    </>
  );
}

/** Search box from 768px up; below that a search button that opens a full-width box. ⌘K / Ctrl+K focuses it. */
function GlobalSearch() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const pick = (link: string) => {
    setOpen(false);
    setQ('');
    navigate(link);
  };
  const input = (
    <div className="relative w-full">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[17px] -translate-y-1/2 text-faint" />
      <input
        ref={inputRef}
        aria-label="Global search"
        value={q}
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        placeholder="Search assessments, findings, evidence…"
        className="h-10 w-full rounded-lg bg-muted-bg pl-10 pr-14 text-sm placeholder:text-faint focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand/20"
      />
      <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-line px-1.5 text-[11px] text-faint lg:block">⌘K</kbd>
    </div>
  );
  return (
    <>
      <Popover open={open && debounced.length >= 2} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className="hidden min-w-[220px] max-w-[460px] flex-1 md:block">{input}</div>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(460px,90vw)] p-1" onOpenAutoFocus={(e) => e.preventDefault()}>
          <SearchResults q={debounced} onPick={pick} />
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <button className="rounded-lg p-2 text-ink hover:bg-muted-bg md:hidden" aria-label="Search">
            <Search className="size-[20px]" strokeWidth={1.6} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[calc(100vw-2rem)] p-2">
          <input
            aria-label="Search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search assessments, findings, evidence…"
            className="mb-1 h-10 w-full rounded-lg bg-muted-bg px-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          <SearchResults q={debounced} onPick={pick} />
        </PopoverContent>
      </Popover>
    </>
  );
}

/** Keeps the top-bar branch/period in the page link (`?site=…&period=…`) so a shared link shows the same view. */
function ScopeUrlSync() {
  const { siteId, setSiteId, periodLabel, setPeriodLabel } = useFilters();
  const [sp, setSp] = useSearchParams();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      const s = sp.get('site');
      const p = sp.get('period');
      if (s !== null && s !== siteId) setSiteId(s);
      if (p !== null && p !== periodLabel) setPeriodLabel(p);
      if (s !== null || p !== null) return;
    }
    if ((sp.get('site') ?? '') === siteId && (sp.get('period') ?? '') === periodLabel) return;
    setSp(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (siteId) next.set('site', siteId);
        else next.delete('site');
        if (periodLabel) next.set('period', periodLabel);
        else next.delete('period');
        return next;
      },
      { replace: true },
    );
  }, [siteId, periodLabel, sp, setSp, setSiteId, setPeriodLabel]);
  return null;
}

/** One "Scope" button (branch · period) that stays visible at every width. */
function ScopeButton() {
  const { siteId, setSiteId, periodLabel, setPeriodLabel } = useFilters();
  const { can } = useAuth();
  const org = useQuery({ queryKey: ['org'], queryFn: organisationService.current, enabled: can('organisation:read', 'dashboard:read') });
  const periods = useQuery({ queryKey: ['periods'], queryFn: assessmentsService.periods, enabled: can('assessment:read', 'dashboard:read') });
  if (!can('organisation:read', 'dashboard:read')) return null;
  const site = org.data?.sites.find((s) => s.id === siteId);
  const active = !!siteId || !!periodLabel;
  const sel = 'h-10 w-full rounded-lg border border-line bg-surface px-3 text-[13px] text-ink';
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className={cn('flex h-10 max-w-[260px] items-center gap-2 rounded-lg border px-3 text-[13px] font-medium', active ? 'border-brand/40 bg-brand-soft/50 text-brand-ink' : 'border-line text-ink hover:bg-subtle')}
          aria-label="Choose branch and period"
        >
          <Crosshair className="size-4 shrink-0" />
          <span className="hidden truncate sm:inline">
            {site?.name ?? 'All branches'} · {periodLabel || 'All periods'}
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] space-y-3 p-4">
        <p className="text-sm font-semibold">Scope</p>
        <p className="text-xs text-muted">Applies to the dashboard and every list: assessments, findings, actions, evidence, auditor work and reports.</p>
        <label className="block space-y-1 text-xs text-muted" htmlFor="scope-site">
          Hospital / branch
          <select id="scope-site" className={sel} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">{org.data ? `${org.data.name} · all branches` : 'All branches'}</option>
            {org.data?.sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-xs text-muted" htmlFor="scope-period">
          Assessment period
          <select id="scope-period" className={sel} value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)}>
            <option value="">All periods</option>
            {periods.data?.map((p) => (
              <option key={p.periodLabel} value={p.periodLabel}>
                {p.periodLabel}
              </option>
            ))}
          </select>
        </label>
        {active && (
          <button className="text-xs font-medium text-brand hover:underline" onClick={() => (setSiteId(''), setPeriodLabel(''))}>
            Clear scope
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Notifications() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['notifications'], queryFn: () => notificationsService.list({ pageSize: 8 }), refetchInterval: 60_000 });
  const unread = (q.data?.meta.unread as number | undefined) ?? 0;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="relative rounded-lg p-2 text-ink hover:bg-muted-bg" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
          <Bell className="size-[20px]" strokeWidth={1.6} />
          {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-white">{unread > 9 ? '9+' : unread}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(380px,92vw)]">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <p className="text-sm font-semibold">Notifications</p>
          <button
            className="flex items-center gap-1 text-xs text-brand hover:underline disabled:opacity-40"
            disabled={!unread}
            onClick={async () => {
              await notificationsService.readAll();
              qc.invalidateQueries({ queryKey: ['notifications'] });
            }}
          >
            <CheckCheck className="size-3.5" /> Mark all read
          </button>
        </div>
        <div className="max-h-[420px] overflow-y-auto scrollbar-thin">
          {!q.data?.data.length ? (
            <p className="px-4 py-8 text-center text-sm text-muted">You're all caught up.</p>
          ) : (
            q.data.data.map((n) => (
              <button
                key={n.id}
                className={cn('flex w-full gap-3 border-b border-line px-4 py-3 text-left last:border-0 hover:bg-subtle', !n.readAt && 'bg-brand-soft/40')}
                onClick={async () => {
                  if (!n.readAt) await notificationsService.read(n.id);
                  qc.invalidateQueries({ queryKey: ['notifications'] });
                  if (n.link) navigate(n.link);
                }}
              >
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand')} />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink">{n.title}</span>
                  <span className="line-clamp-2 block text-xs text-muted">{n.body}</span>
                  <span className="mt-0.5 block text-[11px] text-faint">{relativeTime(n.createdAt)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const dark = resolved === 'dark';
  return (
    <Tooltip content={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
      <button onClick={toggle} className="rounded-lg p-2 text-ink hover:bg-muted-bg" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} aria-pressed={dark}>
        {dark ? <Sun className="size-[20px]" strokeWidth={1.6} /> : <Moon className="size-[20px]" strokeWidth={1.6} />}
      </button>
    </Tooltip>
  );
}

function ProfileMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;
  const roleText = user.isPlatformOwner ? 'Platform owner' : user.roles.map((r) => ROLE_LABEL[r]).join(', ');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 text-left hover:bg-muted-bg" aria-label="Account menu">
          <Avatar name={user.name} size={36} />
          <span className="hidden max-w-[180px] leading-tight xl:block">
            <span className="block truncate text-[14px] font-semibold text-ink">{user.name}</span>
            <span className="block truncate text-[12px] text-muted">{roleText}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          <span className="block truncate">{user.email}</span>
          <span className="block text-xs font-normal text-muted">{roleText}</span>
          {user.restrictions.length > 0 && <span className="block text-xs font-normal text-warn">{user.restrictions.length} permission(s) restricted by an administrator</span>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate('/settings')}>
          <SettingsIcon /> Profile & security
        </DropdownMenuItem>
        <DropdownMenuItem
          destructive
          onSelect={async () => {
            await logout();
            navigate('/login');
          }}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppLayout() {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const toggle = useMemo(
    () => () =>
      setExpanded((e) => {
        try {
          localStorage.setItem(SIDEBAR_KEY, e ? '0' : '1');
        } catch {
          /* ignore */
        }
        return !e;
      }),
    [],
  );
  // While MFA enrolment is required the server refuses everything else, so only the gate is shown.
  const gated = !!user?.mfaEnrolmentRequired;
  const inOrg = !user?.isPlatformOwner && !gated;
  return (
    <TooltipProvider>
      {inOrg && <ScopeUrlSync />}
      <div className="flex min-h-screen bg-surface">
        {!gated && <Sidebar expanded={expanded} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-[68px] items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur sm:px-6 lg:px-8">
            <button className="rounded-lg p-2 hover:bg-muted-bg md:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
              <Menu className="size-5" />
            </button>
            <Tooltip content={expanded ? 'Collapse sidebar' : 'Expand sidebar'}>
              <button onClick={toggle} className="hidden rounded-lg p-2 text-ink hover:bg-muted-bg md:block" aria-label="Toggle sidebar">
                <PanelLeft className="size-[20px]" strokeWidth={1.6} />
              </button>
            </Tooltip>
            <div className="min-w-0 shrink lg:max-w-[280px]">
              <Breadcrumbs />
            </div>
            {inOrg && <GlobalSearch />}
            <div className="ml-auto flex items-center gap-1.5">
              {inOrg && <ScopeButton />}
              {!gated && <Notifications />}
              <ThemeToggle />
              <div className="mx-1.5 hidden h-7 w-px bg-line sm:block" />
              <ProfileMenu />
            </div>
          </header>
          <main className="flex-1 px-4 py-7 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-[1600px]">
              {gated ? <MfaEnrolmentGate /> : <Outlet />}
            </div>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
