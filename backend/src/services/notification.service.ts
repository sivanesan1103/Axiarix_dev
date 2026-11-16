import nodemailer, { type Transporter } from 'nodemailer';
import { env, isTest } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { getSetting, type NOTIFICATION_EVENTS } from './settings.service.js';

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

let transporter: Transporter | null = null;
function getTransport(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export interface NotifyInput {
  userIds: string[];
  type: NotificationEvent;
  title: string;
  body: string;
  link?: string;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Creates in-app notifications and attempts SMTP delivery.
 *
 * Notification failure must never break the business workflow (Phase 7.4), so this
 * function never throws: delivery problems are recorded on the Notification row.
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const userIds = [...new Set(input.userIds.filter(Boolean))];
    if (!userIds.length) return;
    const users = await prisma.user.findMany({ where: { id: { in: userIds }, status: 'ACTIVE' } });
    if (!users.length) return;
    const policy = await getSetting('notification.policy', users[0].organisationId);
    const emailOn = policy.emailEnabled && policy.events[input.type] !== false;
    for (const user of users) {
      const n = await prisma.notification.create({
        data: {
          userId: user.id,
          type: input.type,
          title: input.title,
          body: input.body,
          link: input.link,
          emailStatus: emailOn ? 'PENDING' : 'SKIPPED',
        },
      });
      if (!emailOn) continue;
      void deliver(n.id, user.email, input);
    }
  } catch (err) {
    console.error('[notify] failed to create notifications', err);
  }
}

async function deliver(notificationId: string, to: string, input: NotifyInput) {
  const transport = getTransport();
  if (!transport || isTest) {
    await prisma.notification
      .update({ where: { id: notificationId }, data: { emailStatus: 'SKIPPED', emailError: transport ? 'test-mode' : 'SMTP not configured' } })
      .catch(() => undefined);
    return;
  }
  try {
    const url = input.link ? `${env.FRONTEND_ORIGIN}${input.link}` : env.FRONTEND_ORIGIN;
    await transport.sendMail({
      from: env.SMTP_FROM,
      to,
      subject: `[Axiarix] ${input.title}`,
      text: `${input.body}\n\nOpen: ${url}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
        <p style="font-size:16px;font-weight:600">${escapeHtml(input.title)}</p>
        <p>${escapeHtml(input.body)}</p>
        <p><a href="${escapeHtml(url)}" style="color:#4B10F0">Open in Axiarix</a></p>
        <p style="color:#666;font-size:12px">Automated message from the Axiarix ISO/IEC 27001 compliance system.</p></div>`,
    });
    await prisma.notification.update({ where: { id: notificationId }, data: { emailStatus: 'SENT' } });
  } catch (err) {
    await prisma.notification
      .update({ where: { id: notificationId }, data: { emailStatus: 'FAILED', emailError: (err as Error).message.slice(0, 500) } })
      .catch(() => undefined);
  }
}

/** Sends a test e-mail synchronously so administrators can verify SMTP configuration. */
export async function sendTestEmail(to: string) {
  const transport = getTransport();
  if (!transport) throw new Error('SMTP is not configured (SMTP_HOST is empty)');
  await transport.sendMail({
    from: env.SMTP_FROM,
    to,
    subject: '[Axiarix] SMTP test message',
    text: 'SMTP configuration for Axiarix notifications is working.',
  });
}
