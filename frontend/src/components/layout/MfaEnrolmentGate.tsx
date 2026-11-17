import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { LogOut, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { authService } from '@/services/auth.service';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/display';
import { Input } from '@/components/ui/form-controls';

/**
 * Shown instead of every page while the organisation's security policy requires two-step verification
 * for this (privileged) account and it has not been set up yet (NFR-SEC-04). The server refuses all
 * other requests until enrolment, so this is the only thing the person can do apart from signing out.
 */
export function MfaEnrolmentGate() {
  const { reload, logout } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const start = useMutation({ mutationFn: authService.mfaSetup, onSuccess: setSetup });
  const enable = useMutation({
    mutationFn: () => authService.mfaEnable(code),
    onSuccess: async () => {
      toast.success('Two-step verification is on. Welcome in.');
      await reload();
    },
  });
  return (
    <div className="mx-auto max-w-xl py-10">
      <Card>
        <CardHeader title="Set up two-step verification" description="Your organisation requires it for your role. It takes a minute: you need an authenticator app such as Google Authenticator or Microsoft Authenticator." />
        <CardBody className="space-y-4">
          {setup ? (
            <>
              <p className="text-sm">1. Add this key to your authenticator app.</p>
              <code className="block break-all rounded-md bg-subtle px-3 py-2 text-sm font-semibold tracking-wider">{setup.secret}</code>
              <p className="break-all text-xs text-muted">{setup.otpauthUrl}</p>
              <p className="text-sm">2. Enter the 6-digit code the app shows.</p>
              <div className="flex flex-wrap gap-2">
                <Input aria-label="Verification code" inputMode="numeric" maxLength={6} className="w-40 text-center tracking-[0.3em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
                <Button variant="primary" disabled={code.length !== 6} loading={enable.isPending} onClick={() => enable.mutate()}>
                  <ShieldCheck /> Verify & continue
                </Button>
              </div>
            </>
          ) : (
            <Button variant="primary" loading={start.isPending} onClick={() => start.mutate()}>
              <ShieldCheck /> Start set-up
            </Button>
          )}
          <div className="border-t border-line pt-4">
            <Button variant="ghost" onClick={() => void logout()}>
              <LogOut /> Sign out
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
