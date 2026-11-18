import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { app, login, PASSWORD, resetDatabase } from './helpers.js';

beforeAll(async () => {
  await resetDatabase();
});

describe('health', () => {
  it('reports database and storage status', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.checks.database).toBe('up');
  });
});

describe('authentication', () => {
  it('rejects unauthenticated API requests', async () => {
    const res = await request(app).get('/api/v1/assessments');
    expect(res.status).toBe(401);
  });

  it('rejects a wrong password with a generic message and audits it', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'auditor@axiarix.local', password: 'wrong-password' });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid e-mail or password');
    expect(await prisma.auditEvent.count({ where: { action: 'LOGIN_FAILED', actorEmail: 'auditor@axiarix.local' } })).toBe(1);
  });

  it('does not reveal whether an e-mail exists', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'nobody@axiarix.local', password: 'x' });
    expect(res.body.error.message).toBe('Invalid e-mail or password');
  });

  it('logs in, returns permissions and sets an HTTP-only, SameSite=Strict refresh cookie', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'admin@axiarix.local', password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.user.roles).toContain('SYSTEM_ADMIN');
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/axr_rt=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it('rotates refresh tokens and revokes the family when an old token is replayed', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'isms@axiarix.local', password: PASSWORD });
    const first = String(res.headers['set-cookie']).split(';')[0];
    const r1 = await request(app).post('/api/v1/auth/refresh').set('Cookie', first).set('X-Requested-With', 'axiarix');
    expect(r1.status).toBe(200);
    const second = String(r1.headers['set-cookie']).split(';')[0];
    expect(second).not.toBe(first);
    // Replay of the first (rotated) token is treated as theft.
    const replay = await request(app).post('/api/v1/auth/refresh').set('Cookie', first).set('X-Requested-With', 'axiarix');
    expect(replay.status).toBe(401);
    // The whole family, including the newest token, is now revoked.
    const after = await request(app).post('/api/v1/auth/refresh').set('Cookie', second).set('X-Requested-With', 'axiarix');
    expect(after.status).toBe(401);
    expect(await prisma.auditEvent.count({ where: { action: 'REFRESH_TOKEN_REUSE' } })).toBe(2); // both replays are audited
  });

  it('requires the CSRF header on cookie-authenticated endpoints', async () => {
    const res = await request(app).post('/api/v1/auth/refresh');
    expect(res.status).toBe(403);
  });

  it('rejects an expired / tampered access token', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.invalid');
    expect(res.status).toBe(401);
  });

  it('locks the account after repeated failures', async () => {
    for (let i = 0; i < 5; i++) await request(app).post('/api/v1/auth/login').send({ email: 'management@axiarix.local', password: 'bad' });
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'management@axiarix.local', password: PASSWORD });
    expect(res.status).toBe(423);
    await prisma.user.update({ where: { email: 'management@axiarix.local' }, data: { lockedUntil: null, failedLoginCount: 0 } });
  });

  it('supports forgot/reset password and revokes existing sessions', async () => {
    const f = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'contributor@axiarix.local' });
    expect(f.status).toBe(200);
    const token = f.body.data.testToken as string;
    const weak = await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'short' });
    expect(weak.status).toBe(422);
    const ok = await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'New-Strong-Pass-2026' });
    expect(ok.status).toBe(200);
    expect((await request(app).post('/api/v1/auth/reset-password').send({ token, password: 'Another-Pass-2026' })).status).toBe(400);
    await login('contributor@axiarix.local', 'New-Strong-Pass-2026');
  });

  it('invites new users with a 72-hour set-password link, while resets stay at 30 minutes', async () => {
    const admin = await login('admin@axiarix.local');
    const res = await admin.post('/api/v1/users', { name: 'Invited Person', email: 'invited@axiarix.local', sendInvite: true, roles: [{ roleKey: 'CONTRIBUTOR' }] });
    expect(res.status).toBe(201);
    const invited = await prisma.user.findUniqueOrThrow({ where: { email: 'invited@axiarix.local' } });
    const hours = (invited.passwordResetExpires!.getTime() - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(71);
    expect(hours).toBeLessThanOrEqual(72);
    expect(await prisma.auditEvent.count({ where: { action: 'USER_INVITED', entityId: invited.id } })).toBe(1);

    await request(app).post('/api/v1/auth/forgot-password').send({ email: 'invited@axiarix.local' });
    const reset = await prisma.user.findUniqueOrThrow({ where: { email: 'invited@axiarix.local' } });
    expect((reset.passwordResetExpires!.getTime() - Date.now()) / 60_000).toBeLessThanOrEqual(30);
  });

  it('logs out and invalidates the refresh token', async () => {
    const s = await login('auditor@axiarix.local');
    const out = await s.agent.post('/api/v1/auth/logout').set('X-Requested-With', 'axiarix');
    expect(out.status).toBe(200);
    const r = await s.agent.post('/api/v1/auth/refresh').set('X-Requested-With', 'axiarix');
    expect(r.status).toBe(401);
  });

  it('blocks deactivated users immediately', async () => {
    const admin = await login('admin@axiarix.local');
    const mgmt = await login('management@axiarix.local');
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'management@axiarix.local' } });
    expect((await admin.post(`/api/v1/users/${user.id}/status`, { status: 'INACTIVE', reason: 'Left the organisation' })).status).toBe(200);
    expect((await mgmt.get('/api/v1/auth/me')).status).toBe(401);
    expect((await admin.post(`/api/v1/users/${user.id}/status`, { status: 'ACTIVE', reason: 'Rejoined' })).status).toBe(200);
  });
});

describe('role-based access control', () => {
  it('denies a management viewer from creating checklists and audits the denial', async () => {
    const mgmt = await login('management@axiarix.local');
    const res = await mgmt.post('/api/v1/checklists', { title: 'Not allowed' });
    expect(res.status).toBe(403);
    expect(await prisma.auditEvent.count({ where: { action: 'PERMISSION_DENIED', actorEmail: 'management@axiarix.local' } })).toBeGreaterThan(0);
  });

  it('denies contributors access to user administration and the audit trail', async () => {
    const c = await login('contributor@axiarix.local', 'New-Strong-Pass-2026');
    expect((await c.get('/api/v1/users')).status).toBe(403);
    expect((await c.get('/api/v1/audit-logs')).status).toBe(403);
  });

  it('prevents reducing System Administrator permissions', async () => {
    const admin = await login('admin@axiarix.local');
    const role = await prisma.role.findFirstOrThrow({ where: { key: 'SYSTEM_ADMIN' } });
    expect((await admin.put(`/api/v1/roles/${role.id}/permissions`, { permissions: [] })).status).toBe(400);
  });
});

describe('audit trail integrity', () => {
  it('blocks UPDATE and DELETE on audit events at the database layer', async () => {
    await expect(prisma.auditEvent.updateMany({ data: { action: 'TAMPERED' } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditEvent.deleteMany({})).rejects.toThrow(/append-only/);
  });

  it('verifies the hash chain', async () => {
    const admin = await login('admin@axiarix.local');
    const res = await admin.get('/api/v1/audit-logs/verify');
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.checked).toBeGreaterThan(5);
  });
});
