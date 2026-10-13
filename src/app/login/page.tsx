'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, RadioTower, ShieldCheck, ClipboardList, TicketCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { authenticateDemo, authenticateServer, createDemoParticipant, createServerParticipant, DEMO_ACCOUNTS, destinationForRole, isUsingServerAuth, saveDemoSession, useDemoSession } from '@/lib/demo-auth';
import { useDashboardStore } from '@/lib/dashboard-state';

type AuthView = 'signin' | 'signup';

export default function LoginPage() {
  const router = useRouter();
  const redirect = new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('redirect');
  const session = useDemoSession();
  const [view, setView] = useState<AuthView>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [selectedWorkspace, setSelectedWorkspace] = useState(DEMO_ACCOUNTS[0].role);
  const [fullName, setFullName] = useState('');
  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const focusAfterViewChange = useRef(false);
  const loginEmailRef = useRef<HTMLInputElement>(null);
  const signupNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (session) {
      if (session.role === 'organizer') useDashboardStore.getState().setSelectedView('home');
      router.replace(destinationForRole(session.role));
    }
  }, [router, session]);

  useEffect(() => {
    if (!focusAfterViewChange.current) return;
    focusAfterViewChange.current = false;
    (view === 'signup' ? signupNameRef : loginEmailRef).current?.focus();
  }, [view]);

  const switchView = (next: AuthView) => {
    if (view === 'signup' && next === 'signin') {
      setSignupPassword('');
      setConfirmPassword('');
    }
    focusAfterViewChange.current = true;
    setView(next);
    setError('');
    setShowPassword(false);
  };

  const onSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const authenticatedSession = isUsingServerAuth() ? await authenticateServer(email, password) : await authenticateDemo(email, password);
      if (!authenticatedSession) {
        setError('That email and password do not match an active account. Check the credentials and try again.');
        return;
      }
      if (authenticatedSession.role === 'organizer') useDashboardStore.getState().setSelectedView('home');
      saveDemoSession(authenticatedSession);
      router.replace(authenticatedSession.role === 'participant' && redirect?.startsWith('/') ? redirect : destinationForRole(authenticatedSession.role));
    } catch {
      setError('Sign-in could not be completed. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const onSignUp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (signupPassword.length < 8) {
      setError('Choose a password with at least 8 characters.');
      return;
    }
    if (signupPassword !== confirmPassword) {
      setError('The passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const createdSession = isUsingServerAuth() ? await createServerParticipant(fullName, signupEmail, signupPassword) : await createDemoParticipant(fullName, signupEmail, signupPassword);
      saveDemoSession(createdSession);
      setPassword('');
      setSignupPassword('');
      setConfirmPassword('');
      setFullName('');
      focusAfterViewChange.current = true;
      router.replace(createdSession.role === 'participant' && redirect?.startsWith('/') ? redirect : destinationForRole(createdSession.role));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create your participant account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (session) return null;

  return (
    <main className="relative grid min-h-screen place-items-center bg-[var(--page-bg)] px-4 py-16 text-[var(--text-primary)] sm:py-20">
      <div className="absolute right-5 top-5"><ThemeToggle /></div>
      <div className="w-full max-w-md">
        <header className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-[var(--text-primary)]">
            <button type="button" onClick={() => switchView('signin')} aria-label="RUN-SHOW sign in" className="group inline-flex flex-col items-center rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--action-primary-fill)] text-[var(--action-primary-foreground)] transition-transform group-hover:scale-[1.03]"><RadioTower className="h-6 w-6" aria-hidden="true" /></span>
              RUN-SHOW
            </button>
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">Intelligent Event Command Centre</p>
        </header>

        <Card variant="glass" padding="md">
          <CardContent>
            <div className="mb-5 grid grid-cols-2 gap-1 rounded-full bg-[var(--surface-elevated)] p-1" role="group" aria-label="Account access">
              <button type="button" aria-pressed={view === 'signin'} onClick={() => switchView('signin')} className={`min-h-10 rounded-full px-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] ${view === 'signin' ? 'bg-[var(--action-primary-fill)] text-[var(--action-primary-foreground)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>Login</button>
              <button type="button" aria-pressed={view === 'signup'} onClick={() => switchView('signup')} className={`min-h-10 rounded-full px-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] ${view === 'signup' ? 'bg-[var(--action-primary-fill)] text-[var(--action-primary-foreground)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>Sign Up</button>
            </div>

            {error && <p className="mb-4 rounded-md border border-[var(--danger)]/40 bg-[var(--danger-surface)] px-3 py-2 text-sm text-[var(--danger)]" role="alert">{error}</p>}

            {view === 'signin' ? (
              <section aria-label="Sign in to your account">
                <fieldset className="mb-5 min-w-0">
                  <legend className="mb-2 text-sm font-medium text-[var(--text-primary)]">Choose your workspace</legend>
                  <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Workspace type">
                    {[
                      { role: 'organizer' as const, label: 'Main Organizer', description: 'Plan and oversee events', Icon: ShieldCheck },
                      { role: 'sub_organizer' as const, label: 'Sub-organizer', description: 'Manage assigned work', Icon: ClipboardList },
                      { role: 'participant' as const, label: 'Participant', description: 'View event information', Icon: TicketCheck },
                    ].map(option => {
                      const account = DEMO_ACCOUNTS.find(item => item.role === option.role);
                      const checked = selectedWorkspace === option.role;
                      return <label key={option.role} className={`box-border grid h-full min-h-32 min-w-0 cursor-pointer grid-rows-[auto_auto_1fr] gap-1.5 rounded-lg border p-3 transition-colors focus-within:ring-2 focus-within:ring-[var(--focus)] ${checked ? 'border-[var(--action-primary)] bg-[var(--success-surface)]' : 'border-[var(--border)] bg-[var(--surface-card)] hover:bg-[var(--surface-elevated)]'}`}>
                        <span className="grid min-w-0 grid-cols-[1rem_1rem] items-center gap-1.5">
                          <input
                            type="radio"
                            name="workspace"
                            value={option.role}
                            checked={checked}
                            onChange={() => {
                              setSelectedWorkspace(option.role);
                              if (account && !isUsingServerAuth()) {
                                setEmail(account.email);
                                setPassword('');
                              }
                              setError('');
                            }}
                            className="h-4 w-4 shrink-0 accent-[var(--action-primary)]"
                          />
                          <option.Icon className="h-4 w-4 shrink-0 text-[var(--action-primary)]" aria-hidden="true" />
                        </span>
                        <span className="min-w-0 break-words text-sm font-semibold leading-5 text-[var(--text-primary)]">{option.label}</span>
                        <span className="min-w-0 break-words text-xs leading-4 text-[var(--text-secondary)]">
                          {option.description}
                        </span>
                      </label>;
                    })}
                  </div>
                </fieldset>
                <form className="space-y-4" onSubmit={onSignIn}>
                  <Input ref={loginEmailRef} id="login-email" label="Email" type="email" autoComplete="username" required value={email} onChange={event => { setEmail(event.target.value); setError(''); }} />
                  <div className="relative">
                    <Input id="login-password" label="Password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required className="pr-12" value={password} onChange={event => { setPassword(event.target.value); setError(''); }} />
                    <button type="button" className="absolute right-2 top-[2.1rem] inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] hover:text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>
                      {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                    </button>
                  </div>
                  <Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Login'}</Button>
                </form>
                <p className="mt-4 text-center text-sm text-[var(--text-secondary)]">New to RUN-SHOW? <button type="button" onClick={() => switchView('signup')} className="font-semibold text-[var(--action-primary)] underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">Create a participant account</button></p>
              </section>
            ) : (
              <section aria-label="Create participant account">
                <p className="mb-4 text-sm text-[var(--text-secondary)]">Create a participant account. Organizer and sub-organizer access is managed by the organizer.</p>
                <form className="space-y-4" onSubmit={onSignUp}>
                  <Input ref={signupNameRef} id="signup-name" label="Full name" autoComplete="name" required minLength={2} value={fullName} onChange={event => { setFullName(event.target.value); setError(''); }} />
                  <Input id="signup-email" label="Email" type="email" autoComplete="email" required value={signupEmail} onChange={event => { setSignupEmail(event.target.value); setError(''); }} />
                  <div className="relative">
                    <Input id="signup-password" label="Password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={8} className="pr-12" value={signupPassword} onChange={event => { setSignupPassword(event.target.value); setError(''); }} />
                    <button type="button" className="absolute right-2 top-[2.1rem] inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] focus:outline-none focus:ring-2 focus:ring-[var(--focus)]" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword}>{showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}</button>
                  </div>
                  <Input id="signup-confirm-password" label="Confirm password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" required minLength={8} value={confirmPassword} onChange={event => { setConfirmPassword(event.target.value); setError(''); }} />
                  <Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting ? 'Creating account…' : 'Create Participant Account'}</Button>
                </form>
                <p className="mt-4 text-center text-sm text-[var(--text-secondary)]">Already have an account? <button type="button" onClick={() => switchView('signin')} className="font-semibold text-[var(--action-primary)] underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">Login</button></p>
              </section>
            )}

            <p className="mt-5 border-t border-[var(--divider)] pt-4 text-xs leading-relaxed text-[var(--text-muted)]">{isUsingServerAuth() ? 'Your account is protected by the configured server session.' : 'Local prototype mode stores the demo session in this browser and is not production-secure.'}</p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
