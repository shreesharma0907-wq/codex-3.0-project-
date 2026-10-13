'use client';

import { useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, Clock3, MapPin, Users } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useDemoSession } from '@/lib/demo-auth';
import { useDashboardStore } from '@/lib/dashboard-state';
import { Event, Task, TaskStatus } from '@/lib/types';
import { isTaskOverdue } from '@/lib/event-utils';
import { RoleWorkspaceFrame } from './RoleWorkspaceFrame';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Input';
import { IncidentDesk } from '@/components/incidents/IncidentDesk';

const tabs = [
  { id: 'work', label: 'My Work' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'incidents', label: 'Incident Desk' },
  { id: 'updates', label: 'Event Updates' },
];
const statusNames: Record<TaskStatus, string> = { pending: 'Pending', 'in-progress': 'In progress', completed: 'Completed', blocked: 'Blocked' };

export function SubOrganizerDashboard() {
  const session = useDemoSession();
  const { events, teamAssignments, tasks, risks, announcements, completeTask, updateTaskStatus } = useDashboardStore();
  const assignments = teamAssignments.filter(item => item.accountId === session?.id && item.active);
  const assignedEventIds = [...new Set(assignments.map(item => item.eventId))];
  const eventOptions = assignedEventIds.map(id => events.find(event => event.id === id)).filter((item): item is Event => !!item);
  const [requestedEventId, setRequestedEventId] = useState('');
  const [tab, setTab] = useState('work');
  const [requestedAssignmentId, setRequestedAssignmentId] = useState('all');
  const eventId = eventOptions.some(item => item.id === requestedEventId) ? requestedEventId : eventOptions[0]?.id ?? '';

  const event = events.find(item => item.id === eventId);
  const eventAssignments = assignments.filter(item => item.eventId === eventId);
  const assignmentFilter = eventAssignments.some(item => item.id === requestedAssignmentId) ? requestedAssignmentId : 'all';
  const visibleAssignments = eventAssignments.filter(item => assignmentFilter === 'all' || item.id === assignmentFilter);
  const visibleRoles = new Set(visibleAssignments.flatMap(item => item.responsibilities));
  const eventTasks = tasks.filter(task => task.eventId === eventId && visibleAssignments.some(item => task.functionName ? task.functionName === item.functionName : visibleRoles.has(task.assignee)));
  const eventRisks = risks.filter(risk => risk.eventId === eventId && visibleAssignments.length > 0 && (visibleRoles.has(risk.owner) || eventTasks.some(task => task.id === risk.relatedTaskId)) && (risk.status === 'open' || risk.status === 'in-progress'));
  const eventAnnouncements = announcements.filter(item => item.eventId === eventId);
  const completedCount = eventTasks.filter(task => task.status === 'completed').length;
  const overdueCount = eventTasks.filter(task => isTaskOverdue(task.deadline, task.status)).length;
  const registrationPercent = event && event.targetRegistrations > 0 ? Math.min(100, Math.round(event.currentRegistrations / event.targetRegistrations * 100)) : 0;
  const assignmentOptions = eventAssignments.map(item => ({ value: item.id, label: `${item.functionName} · ${item.responsibilities.join(', ')}` }));

  async function changeStatus(task: Task, status: TaskStatus) {
    if (status === 'completed') await completeTask(task.id);
    else await updateTaskStatus(task.id, status);
  }

  return <RoleWorkspaceFrame title="Sub-organizer workspace" session={session} tabs={tabs} activeTab={tab} onTabChange={setTab}>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase text-[var(--action-primary)]">Assigned workspace</p><h1 className="runshow-scroll-heading mt-1 text-3xl font-semibold text-[var(--text-primary)]">My event responsibilities</h1><p className="mt-1 text-sm text-[var(--text-secondary)]">Your view is limited to assigned events, functions, tasks, and relevant blockers.</p></div>{eventOptions.length > 1 && <Select label="Assigned event" value={eventId} onChange={event => setRequestedEventId(event.target.value)} options={eventOptions.map(item => ({ value: item.id, label: item.name }))} className="min-w-56" />}</div>

    {!assignments.length ? <Card padding="lg"><h2 className="font-semibold text-[var(--text-primary)]">No active assignments</h2><p className="mt-2 text-sm text-[var(--text-secondary)]">Ask the main organizer to assign you to an event and function.</p></Card> : !event ? <Card padding="lg"><p className="text-sm text-[var(--text-secondary)]">Your assigned event is not available in this workspace.</p></Card> : <>
      <div className="mb-5 flex flex-wrap gap-2">{eventAssignments.length > 1 && <Select aria-label="Filter by function" value={assignmentFilter} onChange={change => setRequestedAssignmentId(change.target.value)} options={[{ value: 'all', label: 'All assigned functions' }, ...assignmentOptions]} className="min-w-56" />}{eventAssignments.map(item => <span key={item.id} className="rounded-md border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-xs text-[var(--text-primary)]">{item.functionName}</span>)}</div>
      {tab === 'work' && <div className="space-y-5">
        <Card padding="md"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-semibold text-[var(--text-primary)]">{event.name}</h2></div><p className="mt-1 text-sm text-[var(--text-secondary)]">{event.startDate || event.date}{event.endDate && event.endDate !== (event.startDate || event.date) ? ` – ${event.endDate}` : ''}</p></div><p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"><MapPin className="h-4 w-4" aria-hidden="true" />{event.venue || 'Venue pending'}</p></div>
          <div className="mt-5 grid gap-4 border-t border-[var(--divider)] pt-4 sm:grid-cols-3"><Metric icon={Users} label="Registrations" value={`${event.currentRegistrations} / ${event.targetRegistrations}`} detail={`${Math.max(0, event.targetRegistrations - event.currentRegistrations)} to target`} /><Metric icon={CheckCircle2} label="Assigned tasks" value={`${completedCount} / ${eventTasks.length}`} detail="completed" /><Metric icon={Clock3} label="Deadlines" value={String(overdueCount)} detail="overdue tasks" /></div>
          <div className="mt-4"><div className="mb-1 flex justify-between text-xs text-[var(--text-secondary)]"><span>Registration progress</span><span>{registrationPercent}%</span></div><div className="h-2 overflow-hidden rounded bg-[var(--neutral-surface)]"><div className="h-full rounded bg-[var(--action-primary)]" style={{ width: `${registrationPercent}%` }} /></div></div>
        </Card>
        <div className="grid gap-5 lg:grid-cols-2"><Card padding="md"><h3 className="font-semibold text-[var(--text-primary)]">Function responsibilities</h3><div className="mt-3 space-y-2">{eventAssignments.map(item => <div key={item.id} className="rounded-md border border-[var(--border)] px-3 py-3"><p className="font-medium text-[var(--text-primary)]">{item.functionName}</p><p className="mt-1 text-sm capitalize text-[var(--text-secondary)]">{item.responsibilities.join(' · ')}</p></div>)}</div></Card>
          <Card padding="md"><h3 className="flex items-center gap-2 font-semibold text-[var(--text-primary)]"><AlertTriangle className="h-4 w-4 text-[var(--accent)]" aria-hidden="true" />Relevant blockers</h3><div className="mt-3 space-y-2">{eventRisks.length ? eventRisks.map(risk => <div key={risk.id} className="rounded-md border border-[var(--border)] p-3"><div className="flex justify-between gap-2"><p className="text-sm font-medium text-[var(--text-primary)]">{risk.title}</p><span className="shrink-0 text-xs capitalize text-[var(--text-secondary)]">{risk.severity}</span></div><p className="mt-1 text-sm text-[var(--text-secondary)]">{risk.reason}</p></div>) : <p className="text-sm text-[var(--text-secondary)]">No open blockers are linked to your assignment.</p>}</div></Card></div>
      </div>}

      {tab === 'tasks' && <Card padding="md"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-[var(--text-primary)]">Assigned tasks</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">Status changes update the shared organizer task list.</p></div><CalendarDays className="h-5 w-5 text-[var(--action-primary)]" aria-hidden="true" /></div><div className="mt-4 space-y-3">{eventTasks.length ? eventTasks.map(task => <article key={task.id} className="rounded-md border border-[var(--border)] p-4"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div className="min-w-0"><h3 className="font-medium text-[var(--text-primary)]">{task.title}</h3><p className="mt-1 text-sm text-[var(--text-secondary)]">{task.description}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--text-secondary)]"><span>{task.priority} priority</span><span>{task.assignee}</span><span>Due {task.deadline}</span>{isTaskOverdue(task.deadline, task.status) && <span className="font-semibold text-[var(--text-primary)]">Overdue</span>}</div></div><Select aria-label={`Change status for ${task.title}`} value={task.status} onChange={change => void changeStatus(task, change.target.value as TaskStatus)} options={Object.entries(statusNames).map(([value, label]) => ({ value, label }))} className="min-w-36" /></div></article>) : <p className="py-8 text-center text-sm text-[var(--text-secondary)]">No tasks match the selected event function.</p>}</div></Card>}

      {tab === 'incidents' && <IncidentDesk />}

      {tab === 'updates' && <Card padding="md"><h2 className="font-semibold text-[var(--text-primary)]">Event Updates</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">Only updates associated with this assigned event appear here.</p><div className="mt-4 space-y-3">{eventAnnouncements.length ? eventAnnouncements.map(item => <article key={item.id} className="rounded-md border border-[var(--border)] p-4"><h3 className="font-medium text-[var(--text-primary)]">{item.title}</h3><p className="mt-2 text-sm text-[var(--text-secondary)]">{item.message}</p><p className="mt-2 text-xs text-[var(--text-muted)]">{format(parseISO(item.publishedAt), 'MMM d, yyyy · h:mm a')}</p></article>) : <p className="py-8 text-center text-sm text-[var(--text-secondary)]">No event updates have been published.</p>}</div></Card>}
    </>}
  </RoleWorkspaceFrame>;
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Users; label: string; value: string; detail: string }) {
  return <div><div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]"><Icon className="h-4 w-4" aria-hidden="true" />{label}</div><p className="mt-1 text-lg font-semibold tabular-nums text-[var(--text-primary)]">{value}</p><p className="text-xs text-[var(--text-secondary)]">{detail}</p></div>;
}
