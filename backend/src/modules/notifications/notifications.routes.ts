import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { validate } from '../../middleware/common.js';
import { ok, pageArgs, pageMeta, paginationSchema, param } from '../../utils/http.js';

export const notificationsRouter = Router();

notificationsRouter.get('/', validate(paginationSchema.extend({ unread: z.enum(['true', 'false']).optional() }), 'query'), async (req, res) => {
  const q = req.query as unknown as z.infer<typeof paginationSchema> & { unread?: string };
  const where = { userId: req.user!.id, ...(q.unread === 'true' ? { readAt: null } : {}) };
  const [rows, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(q) }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId: req.user!.id, readAt: null } }),
  ]);
  ok(res, rows, { ...pageMeta(q, total), unread });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  await prisma.notification.updateMany({ where: { id: param(req, 'id'), userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  ok(res, { read: true });
});

notificationsRouter.post('/read-all', async (req, res) => {
  const r = await prisma.notification.updateMany({ where: { userId: req.user!.id, readAt: null }, data: { readAt: new Date() } });
  ok(res, { read: r.count });
});
