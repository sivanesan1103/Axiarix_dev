#!/usr/bin/env node
/**
 * Simple load test for NFR-01 ("95 % of normal page requests within 3 seconds").
 *
 * Signs in a few accounts, then runs CONCURRENCY parallel workers for DURATION seconds. Each worker
 * repeatedly loads the API calls behind the main pages (dashboard, lists, tasks, search) and the
 * script reports throughput and response-time percentiles. No dependencies (Node 20+ fetch).
 *
 *   API=http://localhost:5050/api/v1 CONCURRENCY=50 DURATION=30 \
 *   ACCOUNTS=isms@axiarix.local,itowner@axiarix.local,auditor@axiarix.local,management@axiarix.local \
 *   PASSWORD='…' node scripts/load-test.mjs
 *
 * Use test accounts only. Large file transfers and report generation are excluded, as NFR-01 allows.
 */
const API = process.env.API ?? 'http://localhost:5050/api/v1';
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 50);
const DURATION = Number(process.env.DURATION ?? 30);
const ACCOUNTS = (process.env.ACCOUNTS ?? 'isms@axiarix.local,itowner@axiarix.local,auditor@axiarix.local,management@axiarix.local').split(',');
const PASSWORD = process.env.PASSWORD;
if (!PASSWORD) {
  console.error('Set PASSWORD to the test accounts\' password.');
  process.exit(1);
}

const PAGES = [
  '/dashboard/summary',
  '/dashboard/tasks',
  '/assessments?pageSize=20',
  '/findings?pageSize=20',
  '/corrective-actions?pageSize=20',
  '/evidence?pageSize=20',
  '/reports?pageSize=20',
  '/checklists?pageSize=20',
  '/notifications',
  '/search?q=backup',
];

async function signIn(email) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  const body = await r.json();
  if (!r.ok || !body.data?.accessToken) throw new Error(`Sign-in failed for ${email}: ${r.status} ${JSON.stringify(body.error ?? body)}`);
  return body.data.accessToken;
}

// Each account only loads the pages its role can open (as a real user would).
const sessions = [];
for (const a of ACCOUNTS) {
  const token = await signIn(a.trim());
  const pages = [];
  for (const p of PAGES) if ((await fetch(`${API}${p}`, { headers: { authorization: `Bearer ${token}` } })).ok) pages.push(p);
  sessions.push({ email: a.trim(), token, pages });
}

const times = [];
const byPage = new Map(PAGES.map((p) => [p, []]));
let errors = 0;
const statuses = new Map();
const until = Date.now() + DURATION * 1000;

async function worker(n) {
  let i = n;
  while (Date.now() < until) {
    const session = sessions[n % sessions.length];
    const path = session.pages[i % session.pages.length];
    const token = session.token;
    i++;
    const t0 = performance.now();
    try {
      const r = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
      await r.arrayBuffer();
      if (!r.ok) {
        errors++;
        statuses.set(r.status, (statuses.get(r.status) ?? 0) + 1);
      }
    } catch {
      errors++;
      statuses.set('network', (statuses.get('network') ?? 0) + 1);
    }
    const ms = performance.now() - t0;
    times.push(ms);
    byPage.get(path).push(ms);
  }
}

console.log(`Load test: ${CONCURRENCY} concurrent users for ${DURATION}s against ${API}`);
for (const s of sessions) console.log(`  ${s.email}: ${s.pages.length} pages`);
await Promise.all(Array.from({ length: CONCURRENCY }, (_, n) => worker(n)));

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};
const fmt = (ms) => `${ms.toFixed(0)} ms`;
const under3s = times.filter((t) => t < 3000).length / Math.max(1, times.length);
console.log(`Requests: ${times.length} (${(times.length / DURATION).toFixed(1)}/s), errors: ${errors}${errors ? ` ${JSON.stringify(Object.fromEntries(statuses))}` : ''}`);
if (statuses.get(429)) console.log('429 = the API rate limit (API_RATE_LIMIT per client address). One machine simulating many users hits it; raise it for the test or run from several machines.');
console.log(`Median ${fmt(pct(times, 0.5))} · p95 ${fmt(pct(times, 0.95))} · p99 ${fmt(pct(times, 0.99))} · max ${fmt(times.reduce((m, t) => (t > m ? t : m), 0))}`);
console.log(`Under 3 s: ${(under3s * 100).toFixed(2)} %  →  NFR-01 ${under3s >= 0.95 && errors === 0 ? 'MET' : 'NOT MET'}`);
console.log('\nPer page (p95):');
for (const [p, arr] of byPage) console.log(`  ${p.padEnd(32)} ${fmt(pct(arr, 0.95)).padStart(8)}  (${arr.length} requests)`);
process.exit(under3s >= 0.95 && errors === 0 ? 0 : 1);
