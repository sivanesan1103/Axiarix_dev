import type { Tx } from '../config/prisma.js';

/** Records a lifecycle transition with actor, timestamp and optional reason (FR-018). */
export function recordTransition(
  db: Tx,
  entityType: 'Assessment' | 'Finding' | 'CorrectiveAction' | 'ChecklistVersion',
  entityId: string,
  fromStatus: string | null,
  toStatus: string,
  actorId: string | null,
  reason?: string | null,
) {
  return db.statusHistory.create({ data: { entityType, entityId, fromStatus, toStatus, actorId, reason: reason ?? null } });
}

export const startOfToday = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};
