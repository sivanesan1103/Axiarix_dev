import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { refreshAccessToken, tokenStore } from '@/api/client';

/**
 * Real-time updates. Keeps one Server-Sent Events stream open (`/api/v1/events`). The server only says
 * *which area* changed; this hook then re-reads the affected screens through the normal API, so every
 * user still sees only what their role and scope allow.
 *
 * Uses fetch streaming (not EventSource) so the access token goes in the Authorization header rather
 * than the URL. Reconnects with back-off and renews the access token when it has expired.
 */
type Event = { type: 'change'; resource: string; actorId?: string | null } | { type: 'notification' } | { type: 'profile' };

// Query keys (first element) to refresh when an area changes.
const COMMON = ['dashboard', 'notifications'];
const KEYS: Record<string, string[]> = {
  assessments: ['assessments', 'assessment', 'assessment-items', 'assessment-item', 'assessment-history', 'validation', 'my-assignments', 'periods', 'reports', 'evidence', 'findings'],
  findings: ['findings', 'finding', 'actions', 'action', 'assessment', 'assessment-item', 'assessment-items'],
  'corrective-actions': ['actions', 'action', 'findings', 'finding', 'evidence'],
  evidence: ['evidence', 'assessment-items', 'assessment-item', 'assessment', 'action', 'finding'],
  checklists: ['checklists', 'checklist', 'version', 'version-comments', 'published-versions', 'eligible-reviewers'],
  imports: ['imports', 'import', 'import-rows', 'checklists'],
  users: ['users', 'directory', 'org', 'setup-status', 'eligible-reviewers'],
  roles: ['roles', 'permissions', 'users'],
  organisations: ['org', 'setup-status', 'users'],
  admin: ['settings', 'scoring', 'retention', 'deletion-requests', 'schedules', 'setup-status', 'assessments'],
  reports: ['reports', 'assessment'],
  platform: ['platform-orgs'],
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function useRealtime(enabled: boolean, onProfileChanged: () => void, userId?: string) {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    let stopped = false;
    let everConnected = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<string>();
    let refreshAll = false;

    // Several changes in quick succession become one refresh. A tab in the background only marks the
    // data as out of date; it reloads when the person comes back to it (refetch on focus).
    const flush = () => {
      const refetchType = document.visibilityState === 'visible' ? 'active' : 'none';
      if (refreshAll) qc.invalidateQueries({ refetchType });
      else {
        const keys = new Set(pending);
        qc.invalidateQueries({ predicate: (q) => keys.has(String(q.queryKey[0])), refetchType });
      }
      pending.clear();
      refreshAll = false;
    };
    const queue = (keys: string[] | 'all') => {
      if (keys === 'all') refreshAll = true;
      else keys.forEach((k) => pending.add(k));
      clearTimeout(timer);
      timer = setTimeout(flush, 1000);
    };

    const handle = (e: Event) => {
      if (e.type === 'notification') return queue(COMMON);
      if (e.type === 'profile') return onProfileChanged();
      if (e.resource === 'connected') {
        // After a reconnect, catch up on anything missed while the stream was down.
        if (everConnected) queue('all');
        everConnected = true;
        return;
      }
      // The tab where the change was made has already refreshed what it needs.
      if (e.actorId && e.actorId === userId && document.hasFocus()) return;
      queue(KEYS[e.resource] ? [...KEYS[e.resource], ...COMMON] : 'all');
    };

    (async () => {
      let delay = 1000;
      while (!stopped) {
        try {
          const token = tokenStore.get() ?? (await refreshAccessToken());
          if (!token) return; // session ended: the app signs the user out and this hook stops
          const res = await fetch('/api/v1/events', { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal: ctrl.signal });
          if (res.status === 401) {
            await refreshAccessToken();
            throw new Error('token renewed');
          }
          if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);
          setConnected(true);
          delay = 1000;
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          let buf = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += value;
            let i: number;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const data = buf
                .slice(0, i)
                .split('\n')
                .filter((l) => l.startsWith('data:'))
                .map((l) => l.slice(5).trim())
                .join('');
              buf = buf.slice(i + 2);
              if (data) {
                try {
                  handle(JSON.parse(data) as Event);
                } catch {
                  /* ignore malformed message */
                }
              }
            }
          }
        } catch {
          if (stopped) return;
        }
        setConnected(false);
        await sleep(delay);
        delay = Math.min(delay * 2, 30_000);
      }
    })();

    return () => {
      stopped = true;
      ctrl.abort();
      clearTimeout(timer);
      setConnected(false);
    };
  }, [enabled, qc, onProfileChanged, userId]);

  return connected;
}
