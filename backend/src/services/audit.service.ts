import type { Request } from 'express';
import type { AuditOutcome, Prisma } from '@prisma/client';
import { prisma, type Tx } from '../config/prisma.js';
import { sha256 } from '../utils/crypto.js';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | null;
  outcome?: AuditOutcome;
  actorId?: string | null;
  actorEmail?: string | null;
  organisationId?: string | null;
  siteId?: string | null;
  metadata?: Prisma.InputJsonValue;
  req?: Request;
}

/** Arbitrary constant used as the key of the transaction-scoped advisory lock serialising the chain. */
const AUDIT_CHAIN_LOCK = 270012022;

function canonical(e: {
  seqHint: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  outcome: string;
  createdAt: string;
  metadata: unknown;
  prevHash: string | null;
}) {
  return stableStringify(e);
}

/** JSONB does not preserve key order, so hashes are computed over recursively key-sorted JSON. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/**
 * Appends an audit event to the hash chain.
 *
 * Each event stores the hash of its predecessor, so any later modification or
 * removal of a row breaks the chain and is detectable via {@link verifyAuditChain}.
 * The table is additionally protected by an append-only database trigger.
 * A transaction-scoped advisory lock serialises writers so the chain stays linear.
 */
export async function recordAudit(input: AuditInput, tx?: Tx) {
  const run = async (db: Tx) => {
    await db.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${AUDIT_CHAIN_LOCK})`);
    const last = await db.auditEvent.findFirst({ orderBy: { seq: 'desc' }, select: { hash: true } });
    const createdAt = new Date();
    const actor = input.req?.user;
    const actorId = input.actorId ?? actor?.id ?? null;
    const data = {
      actorId,
      actorEmail: input.actorEmail ?? actor?.email ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      outcome: input.outcome ?? 'SUCCESS',
      organisationId: input.organisationId ?? actor?.organisationId ?? null,
      siteId: input.siteId ?? null,
      ip: input.req?.ip ?? null,
      userAgent: input.req?.get('user-agent')?.slice(0, 300) ?? null,
      metadata: input.metadata ?? undefined,
      prevHash: last?.hash ?? null,
      createdAt,
    };
    const hash = sha256(
      canonical({
        seqHint: 'v1',
        actorId: data.actorId,
        action: data.action,
        entityType: data.entityType,
        entityId: data.entityId,
        outcome: data.outcome,
        createdAt: createdAt.toISOString(),
        metadata: data.metadata ?? null,
        prevHash: data.prevHash,
      }),
    );
    return db.auditEvent.create({ data: { ...data, hash } });
  };
  if (tx) return run(tx);
  return prisma.$transaction((t) => run(t));
}

/** Audit failures must never break the business flow; they are logged loudly instead. */
export async function recordAuditSafe(input: AuditInput) {
  try {
    await recordAudit(input);
  } catch (err) {
    console.error('[audit] failed to record event', input.action, err);
  }
}

/** Re-computes every hash in sequence order and reports the first break, if any. */
export async function verifyAuditChain() {
  const events = await prisma.auditEvent.findMany({ orderBy: { seq: 'asc' } });
  let prev: string | null = null;
  for (const e of events) {
    const expected = sha256(
      canonical({
        seqHint: 'v1',
        actorId: e.actorId,
        action: e.action,
        entityType: e.entityType,
        entityId: e.entityId,
        outcome: e.outcome,
        createdAt: e.createdAt.toISOString(),
        metadata: e.metadata ?? null,
        prevHash: e.prevHash,
      }),
    );
    if (e.prevHash !== prev || e.hash !== expected) {
      return { valid: false, checked: events.length, brokenAtSeq: e.seq };
    }
    prev = e.hash;
  }
  return { valid: true, checked: events.length, brokenAtSeq: null };
}
