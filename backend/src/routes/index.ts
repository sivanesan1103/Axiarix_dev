import { announceChanges, subscribe } from '../services/realtime.service.js';
import { Router } from 'express';
import { prisma } from '../config/prisma.js';
import { authenticate } from '../middleware/auth.js';
import { storage } from '../services/storage/index.js';
import { adminRouter } from '../modules/admin/admin.routes.js';
import { assessmentsRouter } from '../modules/assessments/assessments.routes.js';
import { auditLogsRouter } from '../modules/audit-logs/audit-logs.routes.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { checklistsRouter } from '../modules/checklists/checklists.routes.js';
import { dashboardRouter } from '../modules/dashboard/dashboard.routes.js';
import { evidenceDownloadRouter, evidenceRouter } from '../modules/evidence/evidence.routes.js';
import { actionsRouter, findingsRouter } from '../modules/findings/findings.routes.js';
import { importsRouter } from '../modules/imports/imports.routes.js';
import { notificationsRouter } from '../modules/notifications/notifications.routes.js';
import { organisationsRouter } from '../modules/organisations/organisations.routes.js';
import { reportsDownloadRouter, reportsRouter } from '../modules/reports/reports.routes.js';
import { rolesRouter, usersRouter } from '../modules/users/users.routes.js';
import { searchRouter } from '../modules/search/search.routes.js';
import { platformRouter } from '../modules/platform/platform.routes.js';

/** API v1. Everything except health, auth entry points and signed downloads requires a bearer token. */
export const apiRouter = Router();

apiRouter.get('/health', async (_req, res) => {
  const started = Date.now();
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  const store = await storage.healthy();
  res.status(db && store ? 200 : 503).json({
    status: db && store ? 'ok' : 'degraded',
    service: 'axiarix-api',
    version: '1.0.0',
    checks: { database: db ? 'up' : 'down', storage: store ? `up (${storage.driver})` : `down (${storage.driver})` },
    latencyMs: Date.now() - started,
    time: new Date().toISOString(),
  });
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/evidence', evidenceDownloadRouter);
apiRouter.use('/evidence', evidenceRouter);
apiRouter.use('/reports', reportsDownloadRouter);
apiRouter.use('/reports', reportsRouter);

const protectedRouter = Router();
protectedRouter.use(authenticate);
protectedRouter.use(announceChanges);
// Real-time updates (Server-Sent Events): one long-lived stream per open browser.
protectedRouter.get('/events', subscribe);
protectedRouter.use('/organisations', organisationsRouter);
protectedRouter.use('/users', usersRouter);
protectedRouter.use('/roles', rolesRouter);
protectedRouter.use('/checklists', checklistsRouter);
protectedRouter.use('/imports', importsRouter);
protectedRouter.use('/assessments', assessmentsRouter);
protectedRouter.use('/findings', findingsRouter);
protectedRouter.use('/corrective-actions', actionsRouter);
protectedRouter.use('/dashboard', dashboardRouter);
protectedRouter.use('/audit-logs', auditLogsRouter);
protectedRouter.use('/notifications', notificationsRouter);
protectedRouter.use('/admin', adminRouter);
protectedRouter.use('/search', searchRouter);
protectedRouter.use('/platform', platformRouter);
apiRouter.use(protectedRouter);
