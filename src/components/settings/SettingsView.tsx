'use client';

import { useState } from 'react';
import { MonitorCog, RotateCcw, Sun, Moon, UserRound } from 'lucide-react';
import { useTheme } from '@/lib/theme';
import { useDemoSession } from '@/lib/demo-auth';
import { useDashboardStore } from '@/lib/dashboard-state';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

export function SettingsView() {
  const { theme, setTheme } = useTheme();
  const session = useDemoSession();
  const { resetToDefaults, setSelectedView, isUsingApi } = useDashboardStore();
  const [resetMessage, setResetMessage] = useState('');

  function resetWorkspaceData() {
    if (!window.confirm('Clear locally stored organizer events, tasks, risks and recommendations? Your login and theme preference will be kept.')) return;
    resetToDefaults();
    setSelectedView('settings');
    setResetMessage('Local workspace data has been cleared.');
  }

  return <div className="max-w-3xl space-y-5">
    <Card padding="md">
      <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--success-surface)] text-[var(--action-primary)]"><MonitorCog className="h-5 w-5" aria-hidden="true" /></span><div><h2 className="font-semibold text-[var(--text-primary)]">Appearance</h2><p className="text-sm text-[var(--text-secondary)]">Uses your RUNSHOW theme preference across the application.</p></div></div>
      <div className="mt-5 flex flex-wrap gap-2" role="group" aria-label="Appearance theme">
        <button type="button" aria-pressed={theme === 'light'} onClick={() => setTheme('light')} className={`inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--focus)] ${theme === 'light' ? 'border-[var(--action-primary)] bg-[var(--success-surface)] text-[var(--text-primary)]' : 'border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-secondary)]'}`}><Sun className="h-4 w-4" aria-hidden="true" />Light</button>
        <button type="button" aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')} className={`inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--focus)] ${theme === 'dark' ? 'border-[var(--action-primary)] bg-[var(--success-surface)] text-[var(--text-primary)]' : 'border-[var(--border)] bg-[var(--surface-card)] text-[var(--text-secondary)]'}`}><Moon className="h-4 w-4" aria-hidden="true" />Dark</button>
      </div>
      <p className="mt-3 text-xs text-[var(--text-secondary)]">Current preference: {theme}. The system theme is used before a preference is saved.</p>
    </Card>

    <Card padding="md">
      <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--surface-elevated)] text-[var(--text-secondary)]"><UserRound className="h-5 w-5" aria-hidden="true" /></span><div><h2 className="font-semibold text-[var(--text-primary)]">Account</h2><p className="text-sm text-[var(--text-secondary)]">Signed-in profile</p></div></div>
      <dl className="mt-5 grid gap-4 border-t border-[var(--divider)] pt-4 sm:grid-cols-2"><div><dt className="text-xs text-[var(--text-secondary)]">Name</dt><dd className="mt-1 text-sm font-medium text-[var(--text-primary)]">{session?.name ?? 'Organizer'}</dd></div><div><dt className="text-xs text-[var(--text-secondary)]">Email</dt><dd className="mt-1 break-all text-sm font-medium text-[var(--text-primary)]">{session?.email ?? 'Not available'}</dd></div><div><dt className="text-xs text-[var(--text-secondary)]">Role</dt><dd className="mt-1 text-sm font-medium capitalize text-[var(--text-primary)]">{session?.role ?? 'Organizer'}</dd></div><div><dt className="text-xs text-[var(--text-secondary)]">Environment</dt><dd className="mt-1 text-sm font-medium text-[var(--text-primary)]">Local prototype</dd></div></dl>
    </Card>

    {!isUsingApi && <Card padding="md">
      <h2 className="font-semibold text-[var(--text-primary)]">Local workspace data</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">Clear locally stored events, tasks, risks and recommendations. Your account session and appearance preference are kept.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3"><Button variant="secondary" onClick={resetWorkspaceData}><RotateCcw className="h-4 w-4" aria-hidden="true" />Clear workspace data</Button>{resetMessage && <p role="status" className="text-sm text-[var(--action-primary)]">{resetMessage}</p>}</div>
    </Card>}
  </div>;
}
