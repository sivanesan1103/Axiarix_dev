import nodemailer from 'nodemailer';
import { env, isTest } from '../../config/env.js';

/** Account e-mails are sent directly (not as in-app notifications, since the user cannot sign in yet). */
async function send(email: string, subject: string, text: string, link: string, kind: string) {
  if (isTest) return;
  if (!env.SMTP_HOST) {
    if (env.NODE_ENV === 'development') console.info(`[dev] ${kind} link for ${email}: ${link}`);
    return;
  }
  try {
    const t = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
    await t.sendMail({ from: env.SMTP_FROM, to: email, subject, text });
  } catch (err) {
    console.error(`[auth] failed to send ${kind} e-mail`, (err as Error).message);
  }
}

export async function notifyPasswordReset(email: string, name: string, token: string) {
  const link = `${env.FRONTEND_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`;
  await send(
    email,
    '[Axiarix] Reset your password',
    `Hello ${name},\n\nUse this link within 30 minutes to reset your password:\n${link}\n\nIf you did not request this, ignore this e-mail.`,
    link,
    'password reset',
  );
}

/** Sent when an administrator adds a new person: welcome them and let them set their first password. */
export async function notifyInvitation(email: string, name: string, token: string, organisation?: string) {
  const link = `${env.FRONTEND_ORIGIN}/reset-password?token=${encodeURIComponent(token)}&invite=1`;
  const where = organisation ? ` for ${organisation}` : '';
  await send(
    email,
    `[Axiarix] You have been invited${where}`,
    `Hello ${name},\n\nAn account has been created for you on Axiarix${where}.\n\nOpen this link within 72 hours to set your password and sign in:\n${link}\n\nYour sign-in e-mail is ${email}. If you were not expecting this, ignore this e-mail or tell your administrator.`,
    link,
    'invitation',
  );
}
