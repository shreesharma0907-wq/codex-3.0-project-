'use client';

import { Suspense } from 'react';
import { JoinInvitationView } from '@/components/layout/participant/JoinInvitationView';

export default function JoinInvitationPage() {
  // Invitation previews are public. The join action itself enforces participant
  // authentication and the view preserves the invitation through login.
  return <Suspense fallback={<main className="min-h-screen grid place-items-center">Loading invitation…</main>}><JoinInvitationView /></Suspense>;
}
