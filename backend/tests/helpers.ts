import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { prisma } from '../src/config/prisma.js';
import { seedIsoReferences, seedOrganisation, seedPlatform, seedPolicies, seedRbac, seedUsers } from '../src/seed/seed-lib.js';

export const PASSWORD = 'Test-Password-2026';
export const app: Express = createApp();

/** Empties every table (TRUNCATE bypasses the row-level append-only triggers) and seeds baseline data. */
export async function resetDatabase() {
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await seedIsoReferences(prisma);
  await seedRbac(prisma);
  const ctx = await seedOrganisation(prisma, { withSecondarySite: true });
  const users = await seedUsers(prisma, ctx, PASSWORD);
  await seedPolicies(prisma, ctx.org.id, users['admin@axiarix.local']);
  const platform = await seedPlatform(prisma, PASSWORD);
  return { ctx, users, platformUserId: platform.user.id };
}

export async function login(email: string, password = PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  const token = res.body.data.accessToken as string;
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  return {
    agent,
    token,
    del: (url: string) => auth(agent.delete(url)),
    get: (url: string) => auth(agent.get(url)),
    post: (url: string, body?: object) => auth(agent.post(url)).send(body ?? {}),
    put: (url: string, body?: object) => auth(agent.put(url)).send(body ?? {}),
    patch: (url: string, body?: object) => auth(agent.patch(url)).send(body ?? {}),
    upload: (url: string, file: Buffer, filename: string, fields: Record<string, string> = {}) => {
      let r = auth(agent.post(url));
      for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
      return r.attach('file', file, filename);
    },
  };
}

export const pdfBuffer = (label = 'evidence') => Buffer.from(`%PDF-1.4\n1 0 obj<<>>endobj\n% ${label} ${Date.now()}\ntrailer<<>>\n%%EOF`);
