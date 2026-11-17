import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/modules/auth/auth.service.js';
import { ensureOrgRoles } from '../src/services/org-provisioning.service.js';
import { app, login, PASSWORD, resetDatabase } from './helpers.js';

/**
 * Real-time updates: a signed-in browser keeps `/api/v1/events` open; saved changes are announced to
 * everyone in the same organisation (area only, no data) and notifications go to their recipient.
 */
let base: Awaited<ReturnType<typeof resetDatabase>>;
let server: Server;
let url = '';

async function tokenFor(email: string) {
  const r = await fetch(`${url}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  return ((await r.json()) as { data: { accessToken: string } }).data.accessToken;
}

/** Opens a stream and collects parsed events until closed. */
async function openStream(token: string) {
  const ctrl = new AbortController();
  const events: Record<string, unknown>[] = [];
  const res = await fetch(`${url}/api/v1/events`, { headers: { authorization: `Bearer ${token}` }, signal: ctrl.signal });
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  void (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += value;
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const line = buf.slice(0, i).split('\n').find((l) => l.startsWith('data:'));
          buf = buf.slice(i + 2);
          if (line) events.push(JSON.parse(line.slice(5)));
        }
      }
    } catch {
      /* aborted */
    }
  })();
  return { status: res.status, type: res.headers.get('content-type'), events, close: () => ctrl.abort() };
}

const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));

beforeAll(async () => {
  base = await resetDatabase();
  server = app.listen(0);
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  // A second organisation, to prove events never cross organisations.
  const other = await prisma.organisation.create({ data: { name: 'Other Hospital (realtime test)' } });
  await ensureOrgRoles(prisma, other.id);
  const role = await prisma.role.findFirstOrThrow({ where: { organisationId: other.id, key: 'SYSTEM_ADMIN' } });
  const u = await prisma.user.create({ data: { email: 'admin@other-realtime.test', name: 'Other Admin', organisationId: other.id, passwordHash: await hashPassword(PASSWORD), status: 'ACTIVE' } });
  await prisma.userRole.create({ data: { userId: u.id, roleId: role.id, organisationId: other.id } });
});

afterAll(() => {
  server.closeAllConnections();
  return new Promise<void>((r) => server.close(() => r()));
});

describe.sequential('real-time updates', () => {
  it('needs a signed-in user', async () => {
    expect((await fetch(`${url}/api/v1/events`)).status).toBe(401);
  });

  it('announces saved changes to the organisation only, and notifications to their recipient', async () => {
    const [itTok, otherTok] = await Promise.all([tokenFor('itowner@axiarix.local'), tokenFor('admin@other-realtime.test')]);
    const mine = await openStream(itTok);
    const theirs = await openStream(otherTok);
    expect(mine.status).toBe(200);
    expect(mine.type).toMatch(/text\/event-stream/);
    await settle();
    expect(mine.events[0]).toEqual({ type: 'change', resource: 'connected' });

    // The ISMS owner creates and releases an assessment for the IT owner's department.
    const isms = await login('isms@axiarix.local');
    const t = await prisma.checklistTemplate.create({ data: { organisationId: base.ctx.org.id, title: 'Realtime list' } });
    const v = await prisma.checklistVersion.create({ data: { templateId: t.id, versionNumber: 1 } });
    await prisma.checklistItem.create({ data: { versionId: v.id, questionCode: 'RT-001', sequence: 1, question: 'Live update question' } });
    await prisma.checklistVersion.update({ where: { id: v.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
    const a = await isms.post('/api/v1/assessments', {
      title: 'Realtime check', siteId: base.ctx.primary.id, departmentId: base.ctx.primaryDept.id, checklistVersionId: v.id,
      periodLabel: 'Q4 FY2026-27', startDate: '2027-01-02', dueDate: '2027-03-15', ownerId: base.users['itowner@axiarix.local'],
    });
    await isms.post(`/api/v1/assessments/${a.body.data.id}/release`);
    await settle();

    const changes = mine.events.filter((e) => e.type === 'change' && e.resource === 'assessments');
    expect(changes.length).toBeGreaterThanOrEqual(2);
    expect(changes[0]).toMatchObject({ resource: 'assessments', actorId: base.users['isms@axiarix.local'] });
    // Only the area and ids travel; no record content.
    expect(Object.keys(changes[0]).sort()).toEqual(['actorId', 'id', 'resource', 'type']);
    // The IT owner was notified about the release, so their notification list refreshes.
    expect(mine.events.some((e) => e.type === 'notification')).toBe(true);
    // The other organisation hears nothing about it.
    expect(theirs.events.filter((e) => e.type !== 'change' || e.resource !== 'connected')).toEqual([]);
    mine.close();
    theirs.close();
  });

  it("tells a user's browser to re-read their profile when an administrator changes their access", async () => {
    const contribTok = await tokenFor('contributor@axiarix.local');
    const stream = await openStream(contribTok);
    await settle();
    const admin = await login('admin@axiarix.local');
    const res = await admin.put(`/api/v1/users/${base.users['contributor@axiarix.local']}/restrictions`, { restrictions: [{ permission: 'evidence:create' }], reason: 'Realtime test' });
    expect(res.status).toBe(200);
    await settle();
    expect(stream.events.some((e) => e.type === 'profile')).toBe(true);
    stream.close();
  });
});
