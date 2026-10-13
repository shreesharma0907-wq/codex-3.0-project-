'use client';

import { useState } from 'react';
import { CalendarDays, MapPin, MonitorPlay, Users } from 'lucide-react';
import { format, isValid, parseISO } from 'date-fns';
import { useDemoSession } from '@/lib/demo-auth';
import { useDashboardStore } from '@/lib/dashboard-state';
import { getEventStatus } from '@/lib/event-utils';
import { RoleWorkspaceFrame } from './RoleWorkspaceFrame';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

import { ParticipantHelpCentre } from '@/components/participant/ParticipantHelpCentre';

const tabs = [
  { id: 'events', label: 'My Events' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'help', label: 'Help Centre' },
  { id: 'venue', label: 'Venue & Details' },
  { id: 'announcements', label: 'Announcements' },
  { id: 'profile', label: 'Profile' },
];
const eventStatusNames = { past: 'Past', active: 'In progress', upcoming: 'Upcoming', unscheduled: 'Dates pending' };

export function ParticipantDashboard() {
  const session = useDemoSession();
  const { events, participantEvents, announcements } = useDashboardStore();
  const links = participantEvents.filter(link => link.accountId === session?.id);
  const myEvents = links.map(link => ({ link, event: events.find(item => item.id === link.eventId) })).filter((item): item is { link: typeof links[number]; event: NonNullable<typeof item.event> } => !!item.event);
  const [requestedEventId, setRequestedEventId] = useState('');
  const [tab, setTab] = useState('events');
  const selected = myEvents.find(item => item.event.id === requestedEventId) ?? myEvents[0];
  const event = selected?.event;
  const registrationStatus = selected?.link.registrationStatus;
  const sessions = [...(event?.sessions ?? [])].filter(item => isValid(parseISO(item.date))).sort((a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`));
  const eventAnnouncements = announcements.filter(item => item.eventId === event?.id);

  return <RoleWorkspaceFrame title="Participant workspace" session={session} tabs={tabs} activeTab={tab} onTabChange={setTab}>
    <div className="mb-6"><p className="text-xs font-semibold uppercase text-[var(--action-primary)]">Participant portal</p><h1 className="runshow-scroll-heading mt-1 text-3xl font-semibold text-[var(--text-primary)]">{tab === 'events' ? 'My Events' : tabs.find(item => item.id === tab)?.label}</h1><p className="mt-1 text-sm text-[var(--text-secondary)]">Schedules and event details shared for your account.</p></div>
    {!myEvents.length ? <Card padding="lg"><h2 className="font-semibold text-[var(--text-primary)]">No events are linked to this account</h2><p className="mt-2 text-sm text-[var(--text-secondary)]">An event organizer must associate an event with your participant account.</p></Card> : !event ? null : <>
      {myEvents.length > 1 && <div className="mb-5 flex flex-wrap gap-2" aria-label="Choose event">{myEvents.map(item => <Button key={item.event.id} type="button" variant={item.event.id === event.id ? 'primary' : 'secondary'} size="sm" onClick={() => setRequestedEventId(item.event.id)}>{item.event.name}</Button>)}</div>}
      {tab === 'events' && <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-3">{myEvents.map(item => <button key={item.event.id} type="button" onClick={() => setRequestedEventId(item.event.id)} className={`w-full rounded-lg border p-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--focus)] ${event.id === item.event.id ? 'border-[var(--action-primary)] bg-[var(--success-surface)]' : 'border-[var(--border)] bg-[var(--surface-card)] hover:bg-[var(--surface-elevated)]'}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold text-[var(--text-primary)]">{item.event.name}</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">{dateRange(item.event.startDate || item.event.date, item.event.endDate)}</p></div><span className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--text-secondary)]">{eventStatusNames[getEventStatus(item.event)]}</span></div><p className="mt-3 flex items-center gap-2 text-sm text-[var(--text-secondary)]"><MapPin className="h-4 w-4" aria-hidden="true" />{item.event.venue || 'Venue details pending'}</p></button>)}</div>
        <Card padding="md"><h2 className="font-semibold text-[var(--text-primary)]">Attendance and capacity</h2><div className="mt-4 space-y-4"><Capacity label="Planned participant capacity" value={event.participantCapacity?.toLocaleString() ?? 'Not specified'} detail="Organizer-entered capacity; not an attendance count." /><Capacity label="Registration target" value={event.targetRegistrations.toLocaleString()} detail="Planning goal; distinct from venue capacity." /><Capacity label="Recorded registrations" value={event.currentRegistrations.toLocaleString()} detail="Count from shared event data; not live check-in." /><Capacity label="Remaining capacity" value={event.participantCapacity === undefined ? 'Not available' : Math.max(0, event.participantCapacity - event.currentRegistrations).toLocaleString()} detail={event.participantCapacity === undefined ? 'No explicit capacity is recorded.' : event.currentRegistrations > event.participantCapacity ? 'Recorded registrations exceed planned capacity.' : 'Based on planned capacity minus recorded registrations.'} /></div><div className="mt-4 rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] p-3"><p className="text-xs text-[var(--text-secondary)]">Your registration</p><p className="mt-1 font-medium text-[var(--text-primary)]">{registrationStatus ? registrationStatusLabel(registrationStatus) : 'No registration record available'}</p></div></Card>
      </div>}

      {tab === 'schedule' && <Card padding="md"><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold text-[var(--text-primary)]">{event.name} schedule</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">Published event schedule</p></div><CalendarDays className="h-5 w-5 text-[var(--action-primary)]" aria-hidden="true" /></div>{sessions.length ? <ol className="mt-5 space-y-0">{sessions.map((item, index) => <li key={item.id} className="relative grid grid-cols-[6.5rem_1fr] gap-3 pb-6 last:pb-0"><div className="text-right"><p className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">{item.startTime}</p><p className="text-xs tabular-nums text-[var(--text-secondary)]">to {item.endTime}</p></div><div className="relative border-l-2 border-[var(--divider)] pl-4"><span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-[var(--action-primary)]"/><p className="text-sm text-[var(--text-secondary)]">{format(parseISO(item.date), 'EEEE, MMM d, yyyy')}</p><h3 className="mt-1 font-semibold text-[var(--text-primary)]">{item.name}</h3><p className="mt-1 text-sm text-[var(--text-secondary)]">{item.description}</p><p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]"><span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />{item.venue}</span>{item.functionName && <span>{item.functionName}</span>}</p></div>{index < sessions.length - 1 && <span className="absolute bottom-1 left-[6.75rem] top-0 -z-0 border-l border-dashed border-[var(--divider)]" aria-hidden="true"/>}</li>)}</ol> : <p className="mt-6 rounded-md border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--text-secondary)]">The event schedule has not been published.</p>}</Card>}
 
      {tab === 'help' && <ParticipantHelpCentre />}

      {tab === 'venue' && <div className="grid gap-4 md:grid-cols-2"><Card padding="md"><div className="flex items-start gap-3"><MapPin className="mt-0.5 h-5 w-5 text-[var(--action-primary)]" aria-hidden="true"/><div><h2 className="font-semibold text-[var(--text-primary)]">{event.format === 'virtual' ? 'Online platform' : 'Venue'}</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">{event.venue || 'Venue or platform has not been provided.'}</p><p className="mt-3"><span className={`rounded border px-2 py-1 text-xs ${event.venueConfirmed ? 'border-[var(--action-primary)]/40 bg-[var(--success-surface)] text-[var(--text-primary)]' : 'border-[var(--accent)]/50 bg-[var(--accent-muted)] text-[var(--text-primary)]'}`}>{event.venueConfirmed ? 'Confirmed' : 'Pending confirmation'}</span></p></div></div></Card><Card padding="md"><div className="flex items-start gap-3"><MonitorPlay className="mt-0.5 h-5 w-5 text-[var(--action-primary)]" aria-hidden="true"/><div><h2 className="font-semibold text-[var(--text-primary)]">Event details</h2><dl className="mt-3 space-y-3 text-sm"><div><dt className="text-[var(--text-secondary)]">Dates</dt><dd className="mt-1 text-[var(--text-primary)]">{dateRange(event.startDate || event.date, event.endDate)}</dd></div><div><dt className="text-[var(--text-secondary)]">Format</dt><dd className="mt-1 capitalize text-[var(--text-primary)]">{event.format || 'Not specified'}</dd></div><div><dt className="text-[var(--text-secondary)]">Participant instructions</dt><dd className="mt-1 text-[var(--text-primary)]">{event.participantInstructions || 'No participant instructions have been published.'}</dd></div></dl></div></div></Card></div>}

      {tab === 'announcements' && <Card padding="md"><h2 className="font-semibold text-[var(--text-primary)]">Announcements</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">Updates are displayed only when associated with your event.</p><div className="mt-4 space-y-3">{eventAnnouncements.length ? eventAnnouncements.map(item => <article key={item.id} className="rounded-md border border-[var(--border)] p-4"><h3 className="font-medium text-[var(--text-primary)]">{item.title}</h3><p className="mt-2 text-sm text-[var(--text-secondary)]">{item.message}</p><p className="mt-2 text-xs text-[var(--text-muted)]">{publishedLabel(item.publishedAt)}</p></article>) : <p className="py-8 text-center text-sm text-[var(--text-secondary)]">No announcements have been published for this event.</p>}</div></Card>}

      {tab === 'profile' && <Card padding="md"><h2 className="font-semibold text-[var(--text-primary)]">Participant profile</h2><dl className="mt-4 grid gap-4 sm:grid-cols-2"><div><dt className="text-xs text-[var(--text-secondary)]">Name</dt><dd className="mt-1 text-sm text-[var(--text-primary)]">{session?.name}</dd></div><div><dt className="text-xs text-[var(--text-secondary)]">Email</dt><dd className="mt-1 break-all text-sm text-[var(--text-primary)]">{session?.email}</dd></div><div><dt className="text-xs text-[var(--text-secondary)]">Account role</dt><dd className="mt-1 text-sm text-[var(--text-primary)]">Participant</dd></div></dl></Card>}
    </>}
  </RoleWorkspaceFrame>;
}

function dateRange(startValue: string, endValue?: string) {
  const start = parseISO(startValue);
  if (!Number.isFinite(start.getTime())) return 'Dates pending';
  const end = parseISO(endValue || startValue);
  if (!isValid(end)) return format(start, 'MMM d, yyyy');
  return format(start, 'MMM d, yyyy') === format(end, 'MMM d, yyyy') ? format(start, 'MMM d, yyyy') : `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
}

function publishedLabel(value: string) {
  const date = parseISO(value);
  return isValid(date) ? format(date, 'MMM d, yyyy · h:mm a') : 'Date unavailable';
}

function registrationStatusLabel(status: 'invited' | 'registered' | 'cancelled') {
  return status === 'registered' ? 'Registered' : status === 'invited' ? 'Invitation only' : 'Cancelled';
}

function Capacity({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="flex items-start gap-3"><Users className="mt-0.5 h-4 w-4 text-[var(--text-secondary)]" aria-hidden="true"/><div><p className="text-xs text-[var(--text-secondary)]">{label}</p><p className="mt-0.5 font-semibold tabular-nums text-[var(--text-primary)]">{value}</p><p className="text-xs text-[var(--text-muted)]">{detail}</p></div></div>;
}
