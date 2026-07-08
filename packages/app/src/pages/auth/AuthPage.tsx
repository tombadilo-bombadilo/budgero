import { useState } from 'react';
import { SignIn, SignUp } from '@clerk/clerk-react';
import EarlyAccessBanner from '@features/subscription/ui/GlobalEarlyAccessBanner';
import { Alert, AlertDescription } from '@shared/ui/alert';
import { Button } from '@shared/ui/button';
import { Input } from '@shared/ui/input';
import { Label } from '@shared/ui/label';
import { Loader2 } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, useApiClient } from '@shared/hooks/useApiClient';
import { useSelfHostAuth } from '@shared/model/useSelfHostAuth';
import { Helmet } from 'react-helmet-async';
import type { User } from '@shared/model/auth';

const IS_SELF_HOSTABLE =
  typeof import.meta !== 'undefined' &&
  (import.meta as ImportMeta & { env?: Record<string, string> }).env?.VITE_SELF_HOSTABLE === 'true';

type LocalAuthMode = 'signin' | 'signup';
type LocalAuthStatus = 'idle' | 'loading' | 'error';

// Shared Clerk appearance config for both the SignIn and SignUp components.
const CLERK_APPEARANCE = {
  elements: {
    rootBox: 'w-full',
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

  const mode = searchParams.get('mode');
  const isSignup = mode === 'signup';
  const metaTitle = isSignup ? 'Create a Free Account | Budgero' : 'Login to Budgero Cloud';
  const metaDescription = isSignup
    ? 'Start your zero-based budget today. No credit card required for Budgero Core. Private by design.'
    : 'Securely access your encrypted budget. Enter your master password to decrypt your data.';

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
      <div className="min-h-screen flex flex-col">
        {/* Early Access Banner at top */}
        <EarlyAccessBanner variant="top" dismissible={false} />

        <div className="flex-1 flex items-center justify-center bg-background px-4">
          <div className="w-full max-w-sm space-y-6">
            {/* Logo/Title */}
            <div className="text-center">
              <div className="flex justify-center mb-4">
                <img src="/logo_64.png" alt="Budgero Logo" className="w-16 h-16 object-contain" />
              </div>
              <h1 className="text-3xl font-bold text-foreground">Budgero</h1>
            </div>

            {/* Clerk Auth with reserved space to prevent layout jumping */}
            {mode === 'signup' ? (
              <SignUp
                routing="hash"
                oauthFlow="redirect"
                fallback={
                  <div className="h-[360px] flex items-center justify-center">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                  </div>
                }
                appearance={CLERK_APPEARANCE}
              />
            ) : (
              <SignIn
                routing="hash"
                withSignUp={false}
                oauthFlow="redirect"
                fallback={
                  <div className="h-[360px] flex items-center justify-center">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
                  </div>
                }
                appearance={CLERK_APPEARANCE}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function SelfHostAuthPage() {
  const [searchParams] = useSearchParams();
  const initialMode = (searchParams.get('mode') as LocalAuthMode) || 'signin';
  const [mode, setMode] = useState<LocalAuthMode>(initialMode);
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
        setError('Something went wrong, please try again.');
      }
      return;
    } finally {
      setStatus('idle');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <img src="/logo_64.png" alt="Budgero" className="w-16 h-16 object-contain" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Budgero</h1>
        </div>

        <form className="space-y-4" onSubmit={submit}>
          {mode === 'signup' && (
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                required
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="username">Username</Label>
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
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
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
                {mode === 'signin' ? 'Signing in…' : 'Creating account…'}
              </>
            ) : mode === 'signin' ? (
              'Sign in'
            ) : (
              'Create account'
            )}
          </Button>
        </form>

        <div className="text-center">
          {mode === 'signin' ? (
            <button
              type="button"
              onClick={() => setMode('signup')}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Need an account? <span className="text-primary">Sign up</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setMode('signin')}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Already have an account? <span className="text-primary">Sign in</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
