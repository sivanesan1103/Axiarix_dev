import nodemailer from 'nodemailer';
import { env, isTest } from '../../config/env.js';

/** Password reset e-mail is sent directly (not as an in-app notification, since the user cannot sign in). */
export async function notifyPasswordReset(email: string, name: string, token: string) {
  const link = `${env.FRONTEND_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`;
  if (isTest) return;
  if (!env.SMTP_HOST) {
    if (env.NODE_ENV === 'development') console.info(`[dev] password reset link for ${email}: ${link}`);
    return;
  }
  try {
    const t = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
    await t.sendMail({
      from: env.SMTP_FROM,
      to: email,
      subject: '[Axiarix] Reset your password',
      text: `Hello ${name},\n\nUse this link within 30 minutes to reset your password:\n${link}\n\nIf you did not request this, ignore this e-mail.`,
    });
  } catch (err) {
    console.error('[auth] failed to send reset e-mail', (err as Error).message);
  }
}
