import { Router, type CookieOptions, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env, isTest } from '../../config/env.js';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/common.js';
import { ok } from '../../utils/http.js';
import { forbidden } from '../../utils/errors.js';
import * as auth from './auth.service.js';

export const REFRESH_COOKIE = 'axr_rt';

const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'strict',
  path: '/api/v1/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
};

/** Strong password rule: ≥12 chars with upper, lower and digit. */
export const passwordSchema = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(128)
  .regex(/[A-Z]/, 'Password needs an uppercase letter')
  .regex(/[a-z]/, 'Password needs a lowercase letter')
  .regex(/[0-9]/, 'Password needs a digit');

/**
 * CSRF defence for the cookie-authenticated endpoints: browsers cannot attach a
 * custom header cross-site without a CORS pre-flight, which our CORS policy refuses.
 */
function requireCsrfHeader(req: Request, _res: Response, next: NextFunction) {
  if (req.get('x-requested-with') !== 'axiarix') return next(forbidden('Missing CSRF header'));
  next();
}

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: isTest ? 10_000 : env.AUTH_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please wait and try again.' } },
});

export const authRouter = Router();

authRouter.post(
  '/login',
  authLimiter,
  validate(z.object({ email: z.string().email(), password: z.string().min(1).max(200), mfaCode: z.string().regex(/^\d{6}$/).optional() })),
  async (req, res) => {
    const result = await auth.login(req, req.body.email, req.body.password, req.body.mfaCode);
    if (result.mfaRequired) return ok(res, { mfaRequired: true });
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
    ok(res, { mfaRequired: false, accessToken: result.accessToken, user: result.user, mfaEnrolmentRequired: result.mfaEnrolmentRequired });
  },
);

authRouter.post('/refresh', requireCsrfHeader, async (req, res) => {
  try {
    const result = await auth.refresh(req, req.cookies?.[REFRESH_COOKIE]);
    res.cookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);
    ok(res, { accessToken: result.accessToken, user: result.user });
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, maxAge: undefined });
    throw err;
  }
});

authRouter.post('/logout', requireCsrfHeader, async (req, res) => {
  await auth.logout(req, req.cookies?.[REFRESH_COOKIE]);
  res.clearCookie(REFRESH_COOKIE, { ...cookieOptions, maxAge: undefined });
  ok(res, { loggedOut: true });
});

authRouter.post('/forgot-password', authLimiter, validate(z.object({ email: z.string().email() })), async (req, res) => {
  const token = await auth.forgotPassword(req, req.body.email);
  // The token is only echoed in automated tests; real users receive it by e-mail.
  ok(res, { message: 'If the account exists, a reset link has been sent.', ...(isTest && token ? { testToken: token } : {}) });
});

authRouter.post('/reset-password', authLimiter, validate(z.object({ token: z.string().min(10), password: passwordSchema })), async (req, res) => {
  const { email } = await auth.resetPassword(req, req.body.token, req.body.password);
  ok(res, { message: 'Password updated. Please sign in.', email });
});

authRouter.get('/me', authenticate, (req, res) => ok(res, auth.publicUser(req.user!)));

authRouter.post(
  '/change-password',
  authenticate,
  validate(z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema })),
  async (req, res) => {
    await auth.changePassword(req, req.body.currentPassword, req.body.newPassword);
    ok(res, { message: 'Password changed' });
  },
);

authRouter.post('/mfa/setup', authenticate, async (req, res) => ok(res, await auth.mfaSetup(req)));
authRouter.post('/mfa/enable', authenticate, validate(z.object({ code: z.string().regex(/^\d{6}$/) })), async (req, res) => {
  await auth.mfaEnable(req, req.body.code);
  ok(res, { mfaEnabled: true });
});
authRouter.post(
  '/mfa/disable',
  authenticate,
  validate(z.object({ password: z.string().min(1), code: z.string().regex(/^\d{6}$/) })),
  async (req, res) => {
    await auth.mfaDisable(req, req.body.password, req.body.code);
    ok(res, { mfaEnabled: false });
  },
);
