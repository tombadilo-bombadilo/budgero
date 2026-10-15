import { Trans, useLingui } from '@lingui/react/macro';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SignIn, SignUp } from '@clerk/clerk-react';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { PasswordInput } from '@shared/ui/password-input';
import { Label } from '@shared/ui/label';
import { Check, Loader2, LockKeyhole } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, useApiClient } from '@shared/hooks/useApiClient';
import { useSelfHostAuth } from '@shared/model/useSelfHostAuth';
import { Helmet } from 'react-helmet-async';
import type { User } from '@shared/model/auth';
import { sendSignupViewedToUmami } from '@shared/lib/analytics/umami';
import { trackSignupViewed } from '@shared/lib/analytics/analytics';

const IS_SELF_HOSTABLE =
  typeof import.meta !== 'undefined' &&
  (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_SELF_HOSTABLE === 'true';

type LocalAuthStatus = 'idle' | 'loading' | 'error';

// Shared Clerk appearance config for both the SignIn and SignUp components.
const CLERK_APPEARANCE = {
  elements: {
    rootBox: 'w-full',
    cardBox: 'w-full',
    card: 'w-full shadow-lg border-0',
    headerTitle: 'text-2xl font-bold',
    headerSubtitle: 'text-sm text-muted-foreground',
    socialButtonsBlockButton: 'border border-input hover:bg-accent',
    formButtonPrimary: 'bg-primary hover:bg-primary/90',
    footerActionLink:
      'text-primary hover:text-primary/80 font-medium underline-offset-4 hover:underline',
    footerActionText: 'text-sm text-muted-foreground',
  },
} as const;

export default function AuthPage() {
  // All hooks must be called before any early returns
  const [searchParams] = useSearchParams();

  // Early return for self-hostable build after all hooks
  if (IS_SELF_HOSTABLE) {
    return <SelfHostAuthPage />;
  }

  return <CloudAuthPage isSignup={searchParams.get('mode') === 'signup'} />;
}

function CloudAuthPage({ isSignup }: { isSignup: boolean }) {
  const { t } = useLingui();

  const signupViewed = useRef(false);
  const [searchParams] = useSearchParams();
  const monthly = import.meta.env.VITE_BUDGERO_PRICE_MONTHLY ?? '$4';
  const yearly = import.meta.env.VITE_BUDGERO_PRICE_YEARLY ?? '$35';
  const metaTitle = isSignup
    ? t`Start Your 35-Day Free Trial | Budgero`
    : t`Sign in to Budgero Cloud`;
  const metaDescription = isSignup
    ? t`Try private budgeting with Budgero Cloud free for 35 days. No credit card required. Then ${monthly}/month or ${yearly}/year, tax included.`
    : t`Sign in to your Budgero Cloud account and unlock your private budget.`;
  const alternateQuery = new URLSearchParams(searchParams);
  alternateQuery.set('mode', isSignup ? 'signin' : 'signup');

  useEffect(() => {
    if (!isSignup || signupViewed.current) return;
    signupViewed.current = true;
    trackSignupViewed();
    sendSignupViewedToUmami(window.location.search);
  }, [isSignup]);

  return (
    <>
      <Helmet>
        <title>{metaTitle}</title>
        <meta name="description" content={metaDescription} />
        <meta property="og:title" content={metaTitle} />
        <meta property="og:description" content={metaDescription} />
        <meta name="twitter:title" content={metaTitle} />
        <meta name="twitter:description" content={metaDescription} />
      </Helmet>
      <div className="min-h-svh bg-background px-4 py-5 sm:px-8 sm:py-8">
        <a
          href="https://budgero.app/"
          className="mx-auto flex max-w-5xl items-center gap-2 text-lg font-bold"
        >
          <Trans>
            <img src="/logo_64.png" alt="" className="h-9 w-9 rounded-lg" />
            Budgero
          </Trans>
        </a>
        <main
          className={`mx-auto flex min-h-[calc(100svh-9rem)] max-w-5xl flex-col justify-center gap-6 py-6 sm:gap-8 sm:py-8 ${isSignup ? 'lg:flex-row lg:items-center lg:gap-20' : 'items-center'}`}
        >
          <div
            className={
              isSignup ? 'text-center lg:max-w-md lg:flex-1 lg:text-left' : 'max-w-md text-center'
            }
          >
            <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              <Trans>Budgero Cloud</Trans>
            </p>
            <h1 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">
              {isSignup ? t`Start your 35-day free trial.` : t`Welcome back to your budget.`}
            </h1>
            <p className="mt-4 text-base leading-7 text-muted-foreground">
              {isSignup
                ? t`Know what you can spend. Keep your budget private. Create your account to start your free trial.`
                : t`Sign in, then unlock your budget with your master password.`}
            </p>
            {isSignup && (
              <>
                <p className="mt-4 text-sm font-medium">
                  <Trans>No credit card required.</Trans>
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  <Trans>
                    Then {monthly}/month or {yearly}/year, tax included.
                  </Trans>
                </p>
                <ul className="mt-7 hidden space-y-4 text-sm lg:block">
                  {[
                    t`Start fresh or bring your YNAB budget`,
                    t`Budget together with up to five people`,
                    t`Use your phone, tablet, or computer`,
                  ].map((benefit) => (
                    <li key={benefit} className="flex items-center gap-3">
                      <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
                      {benefit}
                    </li>
                  ))}
                </ul>
                <p className="mt-7 hidden items-start gap-3 text-sm leading-6 text-muted-foreground lg:flex">
                  <Trans>
                    <LockKeyhole className="mt-1 size-4 shrink-0" aria-hidden="true" />
                    Your budget is encrypted on your device before it syncs. Budgero cannot read its
                    contents.
                  </Trans>
                </p>
              </>
            )}
          </div>
          <div className="mx-auto w-full max-w-sm shrink-0 space-y-5 lg:mx-0">
            {isSignup ? (
              <SignUp
                signInUrl={`/auth?${alternateQuery}`}
                routing="hash"
                oauthFlow="redirect"
                fallback={<AuthLoading />}
                appearance={CLERK_APPEARANCE}
              />
            ) : (
              <SignIn
                signUpUrl={`/auth?${alternateQuery}`}
                routing="hash"
                withSignUp={false}
                oauthFlow="redirect"
                fallback={<AuthLoading />}
                appearance={CLERK_APPEARANCE}
              />
            )}
            {isSignup && (
              <p className="text-center text-xs leading-5 text-muted-foreground">
                <Trans>
                  No automatic charge when your trial ends. Choose a plan only if Budgero works for
                  you.
                </Trans>
              </p>
            )}
          </div>
        </main>
      </div>
    </>
  );
}

function AuthLoading() {
  const { t } = useLingui();

  return (
    <div
      className="flex h-[360px] items-center justify-center"
      role="status"
      aria-label={t`Loading secure sign-in`}
    >
      <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
    </div>
  );
}

export function SelfHostAuthPage() {
  const { t } = useLingui();
  const [searchParams, setSearchParams] = useSearchParams();
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState<LocalAuthStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const apiClient = useApiClient();
  const setSession = useSelfHostAuth((s) => s.setSession);
  const navigate = useNavigate();
  const next = searchParams.get('next');
  const isLoading = status === 'loading';
  const { data: authConfig, isPending: configPending } = useQuery({
    queryKey: ['self-host-auth-config'],
    queryFn: () => apiClient.get<{ registration_enabled: boolean }>('/auth/local/config'),
    staleTime: 0,
    refetchOnWindowFocus: true,
    retry: false,
  });
  const registrationEnabled = authConfig?.registration_enabled === true;
  const mode = searchParams.get('mode') === 'signup' && registrationEnabled ? 'signup' : 'signin';
  const setMode = (value: 'signin' | 'signup') => {
    const params = new URLSearchParams(searchParams);
    params.set('mode', value);
    setSearchParams(params);
  };

  useEffect(() => {
    if (authConfig?.registration_enabled === false && searchParams.get('mode') === 'signup') {
      const params = new URLSearchParams(searchParams);
      params.set('mode', 'signin');
      setSearchParams(params, { replace: true });
    }
  }, [authConfig, searchParams, setSearchParams]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isLoading) return;
    setStatus('loading');
    setError(null);
    try {
      const payload = mode === 'signup' ? { name, username, password } : { username, password };
      const endpoint = mode === 'signup' ? '/auth/local/register' : '/auth/local/login';
      const response = await apiClient.post<{ token: string; user: User }>(endpoint, payload);
      setSession(response);
      void navigate(next || '/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(typeof err.response === 'string' ? err.response : err.message);
      } else {
        setError(t`Something went wrong, please try again.`);
      }
      return;
    } finally {
      setStatus('idle');
    }
  };

  if (configPending) return <AuthLoading />;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <img src="/logo_64.png" alt={t`Budgero`} className="w-16 h-16 object-contain" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">
            <Trans>Budgero</Trans>
          </h1>
        </div>

        <form className="space-y-4" onSubmit={submit}>
          {mode === 'signup' && (
            <div className="space-y-1.5">
              <Label htmlFor="name">
                <Trans>Name</Trans>
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t`Your name`}
                required
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="username">
              <Trans>Username</Trans>
            </Label>
            <Input
              id="username"
              type="text"
              value={username}
              autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
              placeholder="admin"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">
              <Trans>Password</Trans>
            </Label>
            <PasswordInput
              id="password"
              value={password}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              placeholder="••••••••"
              required
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {mode === 'signin' ? t`Signing in…` : t`Creating account…`}
              </>
            ) : mode === 'signin' ? (
              t`Sign in`
            ) : (
              t`Create account`
            )}
          </Button>
        </form>

        {registrationEnabled && (
          <div className="text-center">
            {mode === 'signin' ? (
              <button
                type="button"
                onClick={() => setMode('signup')}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                <Trans>
                  Need an account?{' '}
                  <span className="text-primary">
                    <Trans>Sign up</Trans>
                  </span>
                </Trans>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setMode('signin')}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                <Trans>
                  Already have an account?{' '}
                  <span className="text-primary">
                    <Trans>Sign in</Trans>
                  </span>
                </Trans>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
