import { Event, Risk, Recommendation, Task, Role } from './types';

export interface RecommendationRule {
  id: string;
  condition: (event: Event, risks: Risk[], tasks: Task[]) => boolean;
  generate: (event: Event, risks: Risk[], tasks: Task[]) => Omit<Recommendation, 'id'>;
}

function safeDeadline(event: Event, tasks: Task[], owner: Role): string {
  return tasks.find(task => task.assignee === owner && task.status !== 'completed')?.deadline || event.startDate || event.date || new Date().toISOString().slice(0, 10);
}

function eventDaysRemaining(event: Event): number | null {
  const timestamp = Date.parse(event.startDate || event.date || '');
  return Number.isFinite(timestamp) ? Math.max(0, Math.ceil((timestamp - Date.now()) / 86_400_000)) : null;
}

export const RECOMMENDATION_RULES: RecommendationRule[] = [
  {
    id: 'registration-gap',
    condition: event => event.targetRegistrations > 0 && event.currentRegistrations < event.targetRegistrations,
    generate: (event, risks, tasks) => {
      const gap = Math.max(0, event.targetRegistrations - event.currentRegistrations);
      const days = eventDaysRemaining(event);
      const dailyPace = Math.ceil(gap / Math.max(1, days ?? 1));
      const pace = days === null ? 'the remaining schedule' : `${dailyPace} registration${dailyPace === 1 ? '' : 's'} per day over the next ${days} day${days === 1 ? '' : 's'}`;
      const risk = risks.find(item => /registration/i.test(item.title));
      const task = tasks.find(item => item.assignee === 'marketing' && item.status !== 'completed');
      return {
        action: `Close the ${gap.toLocaleString()}-registration gap with a measured outreach plan`,
        reason: `${event.currentRegistrations.toLocaleString()} of ${event.targetRegistrations.toLocaleString()} registrations are recorded. The required pace is ${pace}.`,
        priority: days !== null && days <= 7 ? 'urgent' : 'high', owner: 'marketing', deadline: safeDeadline(event, tasks, 'marketing'),
        expectedImpact: 'Reduce the measured registration gap; outcome depends on campaign performance.', relatedRiskId: risk?.id, relatedTaskId: task?.id,
      };
    },
  },
  {
    id: 'venue-readiness',
    condition: event => event.format !== 'virtual' && !event.venueConfirmed,
    generate: (event, risks, tasks) => {
      const risk = risks.find(item => /venue|logistic/i.test(item.title));
      const task = tasks.find(item => item.assignee === 'operations' && item.status !== 'completed');
      return {
        action: 'Confirm the venue and record the delivery checklist',
        reason: 'The event requires a physical venue, but the current event record does not confirm one.',
        priority: 'high', owner: 'operations', deadline: safeDeadline(event, tasks, 'operations'),
        expectedImpact: 'Remove an unverified venue dependency from readiness reporting.', relatedRiskId: risk?.id, relatedTaskId: task?.id,
      };
    },
  },
  {
    id: 'overdue-tasks',
    condition: (_event, _risks, tasks) => tasks.some(task => task.status !== 'completed' && Number.isFinite(Date.parse(task.deadline)) && Date.parse(task.deadline) < Date.now()),
    generate: (event, risks, tasks) => {
      const overdue = tasks.filter(task => task.status !== 'completed' && Number.isFinite(Date.parse(task.deadline)) && Date.parse(task.deadline) < Date.now());
      const first = overdue[0];
      const risk = risks.find(item => /overdue|critical path/i.test(item.title));
      return {
        action: `Review ${overdue.length} overdue task${overdue.length === 1 ? '' : 's'} and update ownership`,
        reason: `${first?.title || 'At least one task'} is past its recorded deadline. This is a measured schedule exception, not an inferred outcome.`,
        priority: 'high', owner: first?.assignee || 'operations', deadline: first?.deadline || safeDeadline(event, tasks, 'operations'),
        expectedImpact: 'Restore an accurate operational schedule and expose any blocker requiring escalation.', relatedRiskId: risk?.id, relatedTaskId: first?.id,
      };
    },
  },
  {
    id: 'blocked-work',
    condition: (_event, _risks, tasks) => tasks.some(task => task.status === 'blocked'),
    generate: (_event, risks, tasks) => {
      const blocked = tasks.find(task => task.status === 'blocked');
      const risk = risks.find(item => item.status === 'open' && (item.severity === 'critical' || item.severity === 'high'));
      return {
        action: `Resolve the blocker on ${blocked?.title || 'blocked work'} or escalate it to the event owner`,
        reason: 'A task is explicitly marked blocked in the shared operational data.',
        priority: 'urgent', owner: blocked?.assignee || 'leadership', deadline: blocked?.deadline || new Date().toISOString().slice(0, 10),
        expectedImpact: 'Unblock the recorded dependency; readiness should be re-evaluated after the task changes.', relatedRiskId: risk?.id, relatedTaskId: blocked?.id,
      };
    },
  },
  {
    id: 'unconfirmed-partners',
    condition: event => event.totalPartners > event.partnerConfirmations,
    generate: (event, risks, tasks) => {
      const remaining = event.totalPartners - event.partnerConfirmations;
      const risk = risks.find(item => /partner/i.test(item.title));
      const task = tasks.find(item => item.assignee === 'partnerships' && item.status !== 'completed');
      return {
        action: `Follow up with ${remaining} unconfirmed partner${remaining === 1 ? '' : 's'}`,
        reason: `${event.partnerConfirmations} of ${event.totalPartners} partner confirmations are recorded.`,
        priority: 'high', owner: 'partnerships', deadline: safeDeadline(event, tasks, 'partnerships'),
        expectedImpact: 'Increase confirmed partner coverage; no outcome is assumed until the record changes.', relatedRiskId: risk?.id, relatedTaskId: task?.id,
      };
    },
  },
];

export function generateRecommendations(event: Event, risks: Risk[], tasks: Task[]): Omit<Recommendation, 'id'>[] {
  return RECOMMENDATION_RULES.filter(rule => rule.condition(event, risks, tasks)).map(rule => rule.generate(event, risks, tasks));
}
