import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';
import { sendDeadlineReminders } from './modules/admin/admin.service.js';

const app = createApp();
const server = app.listen(env.PORT, () => {
  console.log(`[axiarix] API listening on http://localhost:${env.PORT}/api/v1 (${env.NODE_ENV})`);
});

// Deadline reminders every 6 hours; failures are logged and never crash the process.
const reminderTimer = setInterval(
  () => {
    sendDeadlineReminders().catch((e) => console.error('[reminders] failed', e));
  },
  6 * 60 * 60 * 1000,
);
reminderTimer.unref();

async function shutdown(signal: string) {
  console.log(`[axiarix] ${signal} received, shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
