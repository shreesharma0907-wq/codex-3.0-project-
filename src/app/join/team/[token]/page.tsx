'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

type Preview = { invitation: { eventId: string; eventName: string; organizerName: string; responsibility: string; responsibilities: string[]; zones: string | null; requiresApproval: boolean; expiresAt: string; status: string }; authenticated: boolean; role: string | null };

function TeamInvitationContent() {
  const params = useParams<{ token: string }>(); const token = params.token; const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const returnPath = `/join/team/${encodeURIComponent(token)}`;
  const load = useCallback(async () => {
    try { const response = await fetch(`/api/team-invitations/${encodeURIComponent(token)}`); const body = await response.json(); if (!response.ok) throw new Error(body?.error?.message || 'Invitation could not be loaded.'); setPreview(body); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Invitation could not be loaded.'); }
  }, [token]);
  useEffect(() => {
    let active = true;
    void fetch(`/api/team-invitations/${encodeURIComponent(token)}`)
      .then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body?.error?.message || 'Invitation could not be loaded.'); return body as Preview; })
      .then(body => { if (active) setPreview(body); })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Invitation could not be loaded.'); });
    return () => { active = false; };
  }, [token]);
  useEffect(() => {
    if (preview?.authenticated && preview.role === 'sub_organizer' && preview.invitation.status === 'accepted') {
      router.replace(`/sub-organizer/dashboard?eventId=${encodeURIComponent(preview.invitation.eventId)}`);
    }
  }, [preview, router]);
  async function decide(action: 'accept' | 'decline') {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/team-invitations/${encodeURIComponent(token)}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const body = await response.json(); if (!response.ok) throw new Error(body?.error?.message || 'Invitation action failed.');
      if (action === 'decline') { setMessage('You declined this invitation.'); await load(); }
      else if (body.requiresApproval) { setMessage('Your acceptance was recorded. An organizer must approve the event membership before access is granted.'); await load(); }
      else router.replace(`/sub-organizer/dashboard?eventId=${encodeURIComponent(body.eventId)}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Invitation action failed.'); }
    finally { setBusy(false); }
  }
  async function signOutWrongAccount() {
    setBusy(true); setError('');
    try { const response=await fetch('/api/auth/logout',{method:'POST',credentials:'include'}); if(!response.ok) throw new Error('Could not sign out.'); setPreview(current=>current?{...current,authenticated:false,role:null}:current); }
    catch(cause){setError(cause instanceof Error?cause.message:'Could not sign out.');}
    finally{setBusy(false);}
  }
  const inv = preview?.invitation;
  const available = inv?.status === 'pending';
  return <main className="grid min-h-screen place-items-center bg-[var(--page-bg)] px-4 py-12 text-[var(--text-primary)]"><section className="w-full max-w-lg rounded-2xl border border-[var(--divider)] bg-[var(--surface-card)] p-6 shadow-xl sm:p-8" aria-labelledby="invite-title">
    <p className="text-xs font-semibold uppercase tracking-widest text-[var(--action-primary)]">RUN-SHOW · Team invitation</p><h1 id="invite-title" className="mt-2 text-2xl font-bold">Join an event team</h1>
    {error && <p className="mt-4 rounded-lg border border-[var(--danger)]/40 p-3 text-sm text-[var(--danger)]" role="alert">{error}</p>}
    {!inv && !error && <p className="mt-5 text-sm text-[var(--text-secondary)]">Loading invitation…</p>}
    {inv && <><div className="mt-5 space-y-3 rounded-xl border border-[var(--divider)] p-4"><div><p className="text-xs text-[var(--text-muted)]">Event</p><p className="font-semibold">{inv.eventName}</p></div><p className="text-sm text-[var(--text-secondary)]">Invited by {inv.organizerName} as a sub-organizer · {inv.responsibility}</p>{inv.responsibilities.length>0 && <div><p className="text-xs text-[var(--text-muted)]">Responsibilities</p><ul className="mt-1 list-inside list-disc text-sm">{inv.responsibilities.map(item=><li key={item}>{item}</li>)}</ul></div>}{inv.zones && <p className="text-sm"><span className="text-[var(--text-muted)]">Operational scope: </span>{inv.zones}</p>}<p className="text-xs text-[var(--text-muted)]">Expires {new Date(inv.expiresAt).toLocaleString()}</p></div>
      {!available && <p className="mt-4 text-sm text-[var(--danger)]">This invitation is {inv.status.replaceAll('_',' ')} and cannot grant access.</p>}
      {message && <p className="mt-4 rounded-lg border border-[var(--action-primary)]/30 p-3 text-sm" role="status">{message}</p>}
      {available && !preview?.authenticated && <div className="mt-5 space-y-3"><p className="text-sm text-[var(--text-secondary)]">Sign in or create a sub-organizer account to continue. This link will be preserved; on the next screen, choose the Sign Up tab if you need an account.</p><Link className="block" href={`/login?redirect=${encodeURIComponent(returnPath)}`}><Button className="w-full">Login</Button></Link><Link className="block" href={`/login?role=sub_organizer&redirect=${encodeURIComponent(returnPath)}`}><Button variant="secondary" className="w-full">Continue to Account Access</Button></Link></div>}
      {available && preview?.authenticated && preview.role !== 'sub_organizer' && <div className="mt-5 space-y-3"><p className="text-sm text-[var(--danger)]">This invitation requires a sub-organizer account. Sign out, then create a sub-organizer account using this invitation link.</p><Button variant="secondary" disabled={busy} onClick={()=>void signOutWrongAccount()}>{busy?'Signing out…':'Sign out and continue'}</Button></div>}
      {available && preview?.authenticated && preview.role === 'sub_organizer' && <div className="mt-5 flex gap-3"><Button disabled={busy} onClick={()=>void decide('accept')}>{busy?'Saving…':inv.requiresApproval?'Request to Join':'Accept Invitation'}</Button><Button variant="secondary" disabled={busy} onClick={()=>void decide('decline')}>Decline</Button></div>}
      {inv.status==='accepted' && <p className="mt-4 text-sm text-[var(--success)]">This invitation has been accepted.</p>}{inv.status==='pending_approval' && <p className="mt-4 text-sm text-[var(--text-secondary)]">Acceptance is waiting for organizer approval. Event access remains disabled until approved.</p>}
    </>}
  </section></main>;
}

export default function TeamInvitationPage() {
  return <Suspense fallback={<main className="grid min-h-screen place-items-center bg-[var(--page-bg)] text-[var(--text-secondary)]">Loading invitation…</main>}><TeamInvitationContent /></Suspense>;
}
