import { useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form-controls';
import { useAuth } from '@/contexts/AuthContext';
import { authService } from '@/services/auth.service';
import { errorMessage } from '@/api/client';
import { passwordSchema } from '@/schemas/common';

function AuthShell({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_520px]">
      <section className="relative hidden overflow-hidden bg-subtle lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 32 32" className="size-9 text-ink" aria-hidden>
            <circle cx="16" cy="7" r="5" fill="currentColor" />
            <circle cx="8" cy="20" r="5" fill="currentColor" />
            <circle cx="24" cy="20" r="5" fill="currentColor" />
            <circle cx="16" cy="26" r="3" fill="#4B10F0" />
          </svg>
          <span className="text-lg font-semibold">Axiarix</span>
        </div>
        <div className="max-w-xl">
          <p className="text-sm font-medium text-brand">ISO/IEC 27001:2022 compliance management</p>
          <h2 className="mt-3 text-[38px] font-semibold leading-[1.12] tracking-[-0.03em] text-ink">One controlled place for checklists, evidence, audit findings and final reports.</h2>
          <div className="mt-10 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-line bg-line">
            {[
              ['Checklist', 'Versioned & mapped to clauses 4–10 and Annex A'],
              ['Evidence', 'Private storage, checksums, malware-scanned'],
              ['Audit', 'Reviewed, approved and reported as PDF'],
            ].map(([k, v]) => (
              <div key={k} className="bg-surface p-5">
                <p className="text-[15px] font-semibold">{k}</p>
                <p className="mt-1 text-[13px] text-muted">{v}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted">Supports the hospital ISMS process; it does not by itself certify ISO/IEC 27001 conformity.</p>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-[380px]">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{title}</h1>
          <p className="mt-1.5 text-sm text-muted">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </section>
    </div>
  );
}

const loginSchema = z.object({
  email: z.string().email('Enter a valid e-mail address'),
  password: z.string().min(1, 'Password is required'),
  mfaCode: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code').optional().or(z.literal('')),
});

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mfa, setMfa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `?email=` pre-fills the address (handy for bookmarks per account); the password is never accepted from the URL.
  const presetEmail = new URLSearchParams(location.search).get('email') ?? (location.state as { email?: string } | null)?.email ?? '';
  const form = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema), defaultValues: { email: presetEmail, password: '', mfaCode: '' } });
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const onSubmit = form.handleSubmit(async (v) => {
    setError(null);
    try {
      const r = await login(v.email, v.password, mfa ? v.mfaCode || undefined : undefined);
      if (r.mfaRequired) {
        setMfa(true);
        return;
      }
      if (r.mfaEnrolmentRequired) toast.warning('Your role requires two-step verification. Set it up to continue.');
      navigate(from, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  return (
    <AuthShell title={mfa ? 'Two-step verification' : 'Sign in'} subtitle={mfa ? 'Enter the 6-digit code from your authenticator app.' : 'Use your Axiarix account to continue.'}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {!mfa ? (
          <>
            <Field label="E-mail" htmlFor="email" error={form.formState.errors.email?.message}>
              <Input id="email" type="email" autoComplete="username" autoFocus={!presetEmail} {...form.register('email')} aria-invalid={!!form.formState.errors.email} />
            </Field>
            <Field label="Password" htmlFor="password" error={form.formState.errors.password?.message}>
              <Input id="password" type="password" autoComplete="current-password" autoFocus={!!presetEmail} {...form.register('password')} aria-invalid={!!form.formState.errors.password} />
            </Field>
          </>
        ) : (
          <Field label="Authentication code" htmlFor="mfaCode" error={form.formState.errors.mfaCode?.message}>
            <Input id="mfaCode" inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus className="tracking-[0.4em] text-center text-lg" {...form.register('mfaCode')} />
          </Field>
        )}
        {error && (
          <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={form.formState.isSubmitting}>
          {mfa ? <ShieldCheck /> : <Lock />} {mfa ? 'Verify' : 'Sign in'}
        </Button>
        <div className="flex items-center justify-between text-sm">
          {mfa ? (
            <button type="button" className="text-muted hover:text-ink" onClick={() => setMfa(false)}>
              Back
            </button>
          ) : (
            <span />
          )}
          <Link to="/forgot-password" className="text-brand hover:underline">
            Forgot password?
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const form = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email: z.string().email('Enter a valid e-mail address') })), defaultValues: { email: '' } });
  return (
    <AuthShell title="Reset your password" subtitle="We'll e-mail a reset link valid for 30 minutes.">
      {sent ? (
        <div className="rounded-lg border border-line bg-subtle p-5 text-sm">
          <CheckCircle2 className="mb-2 size-5 text-ok" />
          If an active account exists for that address, a reset link has been sent.
          <Link to="/login" className="mt-4 block text-brand hover:underline">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              await authService.forgotPassword(v.email);
              setSent(true);
            } catch (e) {
              toast.error(errorMessage(e));
            }
          })}
        >
          <Field label="E-mail" htmlFor="email" error={form.formState.errors.email?.message}>
            <Input id="email" type="email" autoFocus {...form.register('email')} />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={form.formState.isSubmitting}>
            Send reset link
          </Button>
          <Link to="/login" className="block text-center text-sm text-muted hover:text-ink">
            Back to sign in
          </Link>
        </form>
      )}
    </AuthShell>
  );
}

const resetSchema = z.object({ password: passwordSchema, confirm: z.string() }).refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  // Invitation links (new accounts) set a first password; other links reset a forgotten one.
  const invite = params.get('invite') === '1';
  const form = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema), defaultValues: { password: '', confirm: '' } });
  return (
    <AuthShell
      title={invite ? 'Welcome – set your password' : 'Choose a new password'}
      subtitle="At least 12 characters with upper-case, lower-case and a digit."
    >
      {!token ? (
        <p className="rounded-md bg-bad-soft px-3 py-2 text-sm text-bad">
          This link is missing its token. {invite ? 'Ask your administrator to send a new invitation.' : 'Request a new link.'}
        </p>
      ) : (
        <form
          className="space-y-4"
          onSubmit={form.handleSubmit(async (v) => {
            try {
              const r = await authService.resetPassword(token, v.password);
              toast.success(invite ? 'Password set. Please sign in.' : 'Password updated. Please sign in.');
              // Pre-fill the e-mail via router state (kept out of the address bar and history).
              navigate('/login', { state: { email: r.email } });
            } catch (e) {
              toast.error(errorMessage(e));
            }
          })}
        >
          <Field label="New password" htmlFor="password" error={form.formState.errors.password?.message}>
            <Input id="password" type="password" autoComplete="new-password" {...form.register('password')} />
          </Field>
          <Field label="Confirm password" htmlFor="confirm" error={form.formState.errors.confirm?.message}>
            <Input id="confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
          </Field>
          <Button type="submit" variant="primary" size="lg" className="w-full" loading={form.formState.isSubmitting}>
            <KeyRound /> {invite ? 'Set password' : 'Update password'}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
