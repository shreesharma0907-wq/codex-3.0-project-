'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Role, Task, DashboardState, Notification, DrawerState, KPIData, Recommendation, Risk, Event, EventPlan, TeamAssignment, ParticipantEventLink, Announcement, TicketOption, Invitation, Registration, SupportTicket, SupportMessage, SupportTicketCategory, SupportTicketStatus, SupportTicketPriority, InvitationStatus } from './types';
import { DEMO_EVENT } from './demo-data';
import { calculateKPIs, simulateRegistrationOutcome } from './calculations';
import { generateRecommendations } from './recommendation-rules';
import { api } from './api';
import { recommendationsFromPlan } from './event-plan-generator';

interface StoreState extends DashboardState {
  kpis: KPIData;
  drawer: DrawerState;
  event: Event;
  events: Event[];
  selectedEventId: string;
  teamAssignments: TeamAssignment[];
  participantEvents: ParticipantEventLink[];
  announcements: Announcement[];
  ticketOptions: TicketOption[];
  invitations: Invitation[];
  registrations: Registration[];
  supportTickets: SupportTicket[];
  supportMessages: SupportMessage[];
  isUsingApi: boolean;
  generatedPlan: EventPlan | null;
  isSubmittingEvent: boolean;
  setupError: string | null;
  setSelectedRole: (role: Role) => void;
  setSelectedView: (view: DashboardState['selectedView']) => void;
  selectEvent: (eventId: string) => void;
  saveTeamAssignment: (assignment: TeamAssignment) => void;
  setGeneratedPlan: (plan: EventPlan | null) => void;
  confirmEventPlan: (plan: EventPlan) => Promise<Event>;
  openDrawer: (task: Task, type?: DrawerState['type']) => void;
  closeDrawer: () => void;
  completeTask: (taskId: string) => Promise<void>;
  completeTaskSync: (taskId: string) => void;
  updateTaskStatus: (taskId: string, status: Task['status']) => Promise<void>;
  updateTaskStatusSync: (taskId: string, status: Task['status']) => void;
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  markNotificationRead: (id: string) => void;
  recalculateKPIs: () => void;
  regenerateRecommendations: () => Promise<void>;
  regenerateRecommendationsSync: () => void;
  simulateRegistrationIncrease: (taskId: string) => void;
  resetToDefaults: () => void;
  initializeFromApi: (eventId: string) => Promise<void>;
  loadEventsFromApi: () => Promise<void>;
  // New actions for participant platform
  createTicketOption: (option: Omit<TicketOption, 'id' | 'soldCount'>) => void;
  updateTicketOption: (id: string, updates: Partial<TicketOption>) => void;
  deleteTicketOption: (id: string) => void;
  createInvitation: (invitation: Omit<Invitation, 'id' | 'usedCount' | 'status'>) => void;
  revokeInvitation: (id: string) => void;
  registerForEvent: (registration: Omit<Registration, 'id' | 'referenceNumber' | 'registeredAt'>) => void;
  cancelRegistration: (registrationId: string) => void;
  createSupportTicket: (ticket: Omit<SupportTicket, 'id' | 'referenceNumber' | 'createdAt' | 'updatedAt'>) => void;
  updateSupportTicket: (id: string, updates: Partial<SupportTicket>) => void;
  addSupportMessage: (message: Omit<SupportMessage, 'id' | 'createdAt'>) => void;
  assignSupportTicket: (ticketId: string, assigneeId: string) => void;
}

const EMPTY_EVENT: Event = {
  id: 'no-selected-event', name: '', date: '', targetRegistrations: 0,
  currentRegistrations: 0, partnerConfirmations: 0, totalPartners: 0,
  venueConfirmed: false, daysRemaining: 0,
};
const initialRisks: Risk[] = [];
const initialRecommendations: Recommendation[] = [];
const initialTasks: Task[] = [];
const initialEvents: Event[] = [];
const initialTeamAssignments: TeamAssignment[] = [];
const initialParticipantEvents: ParticipantEventLink[] = [];
const initialAnnouncements: Announcement[] = [];
const initialTicketOptions: TicketOption[] = [];
const initialInvitations: Invitation[] = [];
const initialRegistrations: Registration[] = [];
const initialSupportTickets: SupportTicket[] = [];
const initialSupportMessages: SupportMessage[] = [];
const LEGACY_FIXTURE_EVENT_IDS = new Set([
  DEMO_EVENT.id,
  'runshow-demo-past',
  'runshow-demo-active',
  'runshow-demo-upcoming',
]);

function calculateDaysRemaining(date: string): number {
  const today = new Date();
  const eventDate = new Date(date);
  today.setHours(0, 0, 0, 0);
  eventDate.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
}

function buildRecommendationMap(recommendations: Recommendation[]): Map<string, Recommendation> {
  const map = new Map<string, Recommendation>();
  recommendations.forEach(r => map.set(r.id, r));
  return map;
}

function mergeRecommendations(generated: Omit<Recommendation, 'id'>[], existingMap: Map<string, Recommendation>): Recommendation[] {
  return generated.map((rec, index) => {
    const existingKey = `${rec.owner}-${rec.action.slice(0, 20)}`;
    const existing = existingMap.get(existingKey);
    if (existing) return { ...rec, id: existing.id };
    return { ...rec, id: `rec-gen-${Date.now()}-${index}` };
  });
}

const syncCompleteTask = (set: (partial: StoreState | Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void, get: () => StoreState, taskId: string) => {
  const { tasks, event, events, risks, recommendations } = get();
  const task = tasks.find((t: Task) => t.id === taskId);
  if (!task || task.status === 'completed') return;
  const taskEvent = events.find(item => item.id === task.eventId) ?? event;

  const updatedTasks = tasks.map((t: Task) =>
    t.id === taskId ? { ...t, status: 'completed' as const } : t
  );

  let updatedEvent = { ...taskEvent };
  let updatedRisks = [...risks];
  const updatedRecommendations = [...recommendations];

  if (task.relatedRiskId) {
    updatedRisks = updatedRisks.map((r: Risk) =>
      r.id === task.relatedRiskId && (!r.eventId || r.eventId === taskEvent.id) ? { ...r, status: 'mitigated' as const } : r
    );
  }

  if ((taskId === 'task-1' || taskId === 'task-6') && taskEvent.id === DEMO_EVENT.id) {
    updatedEvent = {
      ...updatedEvent,
      currentRegistrations: simulateRegistrationOutcome(updatedEvent.currentRegistrations, taskId),
    };
  }

  if (taskId === 'task-2' && taskEvent.id === DEMO_EVENT.id) {
    updatedEvent = { ...updatedEvent, venueConfirmed: true };
    updatedRisks = updatedRisks.map((r: Risk) =>
      r.id === 'risk-2' && (!r.eventId || r.eventId === taskEvent.id) ? { ...r, status: 'mitigated' as const } : r
    );
  }

  if (taskId === 'task-3' && taskEvent.id === DEMO_EVENT.id) {
    updatedEvent = { ...updatedEvent, partnerConfirmations: updatedEvent.partnerConfirmations + 1 };
    updatedRisks = updatedRisks.map((r: Risk) =>
      r.id === 'risk-3' && (!r.eventId || r.eventId === taskEvent.id) ? { ...r, status: 'mitigated' as const } : r
    );
  }

  const selectedEvent = updatedEvent.id === event.id ? updatedEvent : event;
  const selectedTasks = updatedTasks.filter(item => item.eventId === selectedEvent.id);
  const newKpis = calculateKPIs(selectedEvent, selectedTasks);

  const existingRecMap = buildRecommendationMap(updatedRecommendations);
  const generatedRecs = updatedEvent.id === event.id
    ? generateRecommendations(updatedEvent, updatedRisks.filter(item => !item.eventId || item.eventId === updatedEvent.id), updatedTasks.filter(item => item.eventId === updatedEvent.id))
    : [];
  const mergedRecommendations = updatedEvent.id === event.id
    ? [
        ...updatedRecommendations.filter(item => item.eventId !== updatedEvent.id),
        ...mergeRecommendations(generatedRecs, existingRecMap).map(item => ({ ...item, eventId: updatedEvent.id })),
      ]
    : updatedRecommendations;

  const newNotification: Notification = {
    id: `notif-${Date.now()}`,
    message: `Task completed: ${task.title}`,
    type: 'success',
    timestamp: new Date().toISOString(),
    read: false,
  };

  set({
    tasks: updatedTasks,
    event: selectedEvent,
    events: events.map(item => item.id === updatedEvent.id ? updatedEvent : item),
    risks: updatedRisks,
    recommendations: mergedRecommendations,
    kpis: newKpis,
    notifications: [newNotification, ...get().notifications].slice(0, 10),
  });
};

const syncRegenerateRecommendations = (set: (partial: StoreState | Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void, get: () => StoreState) => {
  const { event, risks, tasks, recommendations } = get();
  const existingRecMap = buildRecommendationMap(recommendations);
  const generatedRecs = generateRecommendations(event, risks.filter(item => !item.eventId || item.eventId === event.id), tasks.filter(item => item.eventId === event.id));
  const mergedRecommendations = [
    ...recommendations.filter(item => item.eventId !== event.id),
    ...mergeRecommendations(generatedRecs, existingRecMap).map(item => ({ ...item, eventId: event.id })),
  ];
  set({ recommendations: mergedRecommendations });
};

export const useDashboardStore = create<StoreState>()(
  persist(
    (set, get) => ({
      selectedRole: 'leadership',
      selectedView: 'home',
      risks: initialRisks.map(risk => ({ ...risk, eventId: DEMO_EVENT.id })),
      recommendations: initialRecommendations.map(recommendation => ({ ...recommendation, eventId: DEMO_EVENT.id })),
      tasks: initialTasks,
      events: initialEvents,
      selectedEventId: EMPTY_EVENT.id,
      teamAssignments: initialTeamAssignments,
      participantEvents: initialParticipantEvents,
      announcements: initialAnnouncements,
      ticketOptions: initialTicketOptions,
      invitations: initialInvitations,
      registrations: initialRegistrations,
      supportTickets: initialSupportTickets,
      supportMessages: initialSupportMessages,
      notifications: [],
      kpis: calculateKPIs(EMPTY_EVENT, initialTasks),
      drawer: { isOpen: false, task: null, type: 'task' },
      event: EMPTY_EVENT,
      isUsingApi: api.isUsingApi(),
      generatedPlan: null,
      isSubmittingEvent: false,
      setupError: null,

      setSelectedRole: (role) => set({ selectedRole: role }),

      setSelectedView: (view) => set({ selectedView: view }),

      selectEvent: (eventId) => {
        const selected = get().events.find(item => item.id === eventId);
        if (!selected) return;
        const tasks = get().tasks.filter(task => task.eventId === eventId);
        set({ selectedEventId: eventId, event: selected, kpis: calculateKPIs(selected, tasks) });
      },

      saveTeamAssignment: (assignment) => set(state => ({
        teamAssignments: [...state.teamAssignments.filter(item => item.id !== assignment.id), assignment],
      })),

      setGeneratedPlan: (plan) => set({ generatedPlan: plan, setupError: null }),

      confirmEventPlan: async (plan) => {
        if (get().isSubmittingEvent) return get().event;
        set({ isSubmittingEvent: true, setupError: null });

        try {
          const draft = plan.eventDraft;
          const localEvent: Omit<Event, 'id' | 'daysRemaining'> = {
            name: draft.name.trim(),
            type: draft.type.trim(),
            date: draft.startDate,
            startDate: draft.startDate,
            endDate: draft.endDate,
            startTime: draft.startTime,
            endTime: draft.endTime,
            timezone: draft.timezone,
            meetingUrl: draft.meetingUrl.trim() || undefined,
            joiningInstructions: draft.joiningInstructions.trim() || undefined,
            targetRegistrations: draft.targetRegistrations,
            currentRegistrations: draft.currentRegistrations,
            participantCapacity: draft.participantCapacity,
            expectedAttendance: draft.expectedAttendance,
            partnerConfirmations: 0,
            totalPartners: draft.expectedPartners,
            venueConfirmed: Boolean(draft.venue.trim()),
            audience: draft.audience.trim(),
            format: draft.format,
            venue: draft.venue.trim() || undefined,
            objectives: draft.objectives.split(/\n|,/).map(item => item.trim()).filter(Boolean),
            successMetrics: plan.successMetrics,
            budget: draft.budget,
            operationalRequirements: draft.operationalRequirements.trim() || undefined,
            sessions: draft.sessions,
            participantInstructions: draft.sessions?.length ? 'Follow the published participant schedule and check event-day venue details before arrival.' : undefined,
          };

          const createdEvent = get().isUsingApi
            ? await api.createEvent(localEvent, plan.tasks)
            : await api.createEvent(localEvent);

          const event = {
            ...createdEvent,
            daysRemaining: calculateDaysRemaining(createdEvent.date),
            isDemo: false,
            sessions: draft.sessions?.map((session, index) => ({ ...session, id: `${createdEvent.id}-session-${index + 1}` })),
          };
          const persistedTasks = get().isUsingApi && createdEvent.tasks?.length ? createdEvent.tasks : undefined;
          const taskIdMap = new Map(plan.tasks.map((task, index) => [task.id, persistedTasks?.[index]?.id ?? `${event.id}-task-${index + 1}`]));
          const eventTasks = (persistedTasks ?? plan.tasks.map((task, index) => ({ ...task, id: `${event.id}-task-${index + 1}` }))).map(task => ({ ...task, eventId: event.id }));
          const eventRisks = plan.risks.map((risk, index) => ({
            ...risk,
            id: `${event.id}-risk-${index + 1}`,
            eventId: event.id,
            relatedTaskId: risk.relatedTaskId ? taskIdMap.get(risk.relatedTaskId) : undefined,
          }));
          const eventRecommendations = recommendationsFromPlan(plan).map((recommendation, index) => ({
            ...recommendation,
            id: `${event.id}-recommendation-${index + 1}`,
            eventId: event.id,
            relatedTaskId: recommendation.relatedTaskId ? taskIdMap.get(recommendation.relatedTaskId) : undefined,
          }));
          const kpis = calculateKPIs(event, eventTasks);
          const notification: Notification = {
            id: `notif-${Date.now()}`,
            message: `${event.name} created and opened in the command centre`,
            type: 'success',
            timestamp: new Date().toISOString(),
            read: false,
          };

          set({
            event,
            events: [...get().events.filter(item => item.id !== event.id), event],
            participantEvents: get().participantEvents,
            selectedEventId: event.id,
            tasks: [...get().tasks, ...eventTasks],
            risks: [...get().risks, ...eventRisks],
            recommendations: [...get().recommendations, ...eventRecommendations],
            kpis,
            selectedRole: 'leadership',
            selectedView: 'overview',
            generatedPlan: plan,
            isSubmittingEvent: false,
            setupError: null,
            notifications: [notification, ...get().notifications].slice(0, 10),
          });

          return event;
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unable to save event plan';
          set({ isSubmittingEvent: false, setupError: message });
          throw error;
        }
      },

      openDrawer: (task, type = 'task') => set({ drawer: { isOpen: true, task, type } }),

      closeDrawer: () => set(state => ({ drawer: { ...state.drawer, isOpen: false } })),

      completeTask: async (taskId) => {
        if (get().isUsingApi) {
          try {
            const taskEventId = get().tasks.find(task => task.id === taskId)?.eventId ?? get().selectedEventId;
            const result = await api.completeTask(taskId, {
              registrationsAdded: taskId === 'task-1' ? 50 : taskId === 'task-6' ? 25 : 0,
              source: 'simulated',
            });
            const updatedTasks = get().tasks.map((task: Task) => task.id === taskId ? { ...task, status: 'completed' as const } : task);
            const selectedEvent = taskEventId === get().selectedEventId ? result.event : get().event;
            const updatedRisks = [
              ...get().risks.filter(risk => risk.eventId !== taskEventId),
              ...result.risks.map(risk => ({ ...risk, eventId: taskEventId })),
            ];
            const updatedRecommendations = [
              ...get().recommendations.filter(item => item.eventId !== taskEventId),
              ...result.recommendations.map(item => ({ ...item, eventId: taskEventId })),
            ];
            const newKpis = calculateKPIs(selectedEvent, updatedTasks.filter(task => task.eventId === selectedEvent.id));
            const newNotification: Notification = {
              id: `notif-${Date.now()}`,
              message: `Task completed: ${result.task.title}`,
              type: 'success',
              timestamp: new Date().toISOString(),
              read: false,
            };
            set({
              tasks: updatedTasks,
              event: selectedEvent,
              events: get().events.map(item => item.id === result.event.id ? result.event : item),
              risks: updatedRisks,
              recommendations: updatedRecommendations,
              kpis: newKpis,
              notifications: [newNotification, ...get().notifications].slice(0, 10),
            });
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Unable to complete task.';
            console.error('API completeTask failed:', e);
            set({ setupError: message });
            throw e;
          }
        } else {
          syncCompleteTask(set, get, taskId);
        }
      },

      completeTaskSync: (taskId) => syncCompleteTask(set, get, taskId),

      updateTaskStatus: async (taskId, status) => {
        if (status === 'completed') {
          await get().completeTask(taskId);
          return;
        }
        if (get().isUsingApi) {
          try {
            const updatedTask = await api.updateTaskStatus(taskId, status);
            set(state => {
              const tasks = state.tasks.map(t => t.id === taskId ? { ...updatedTask, eventId: updatedTask.eventId ?? t.eventId } : t);
              return { tasks, kpis: calculateKPIs(state.event, tasks.filter(task => task.eventId === state.event.id)), setupError: null };
            });
          } catch (e) {
            const message = e instanceof Error ? e.message : 'Unable to update task status.';
            console.error('API updateTaskStatus failed:', e);
            set({ setupError: message });
            throw e;
          }
        } else {
          get().updateTaskStatusSync(taskId, status);
        }
      },

      updateTaskStatusSync: (taskId, status) => {
        if (status === 'completed') {
          syncCompleteTask(set, get, taskId);
          return;
        }
        set(state => ({
          tasks: state.tasks.map(t => t.id === taskId ? { ...t, status } : t),
          kpis: calculateKPIs(state.event, state.tasks.filter(task => task.eventId === state.event.id)),
        }));
      },

      addNotification: (notification) => {
        const newNotification: Notification = {
          ...notification,
          id: `notif-${Date.now()}`,
          timestamp: new Date().toISOString(),
          read: false,
        };
        set(state => ({
          notifications: [newNotification, ...state.notifications].slice(0, 10),
        }));
      },

      markNotificationRead: (id) => {
        set(state => ({
          notifications: state.notifications.map(n =>
            n.id === id ? { ...n, read: true } : n
          ),
        }));
      },

      recalculateKPIs: () => {
        const { event, tasks } = get();
        set({ kpis: calculateKPIs(event, tasks.filter(task => task.eventId === event.id)) });
      },

      regenerateRecommendations: async () => {
        if (get().isUsingApi) {
          try {
            const eventId = get().event.id;
            const recs = await api.regenerateRecommendations(eventId);
            set({ recommendations: [...get().recommendations.filter(item => item.eventId !== eventId), ...recs.map(item => ({ ...item, eventId }))] });
          } catch (e) {
            console.error('API regenerateRecommendations failed, falling back to sync:', e);
            syncRegenerateRecommendations(set, get);
          }
        } else {
          syncRegenerateRecommendations(set, get);
        }
      },

      regenerateRecommendationsSync: () => syncRegenerateRecommendations(set, get),

      simulateRegistrationIncrease: (taskId) => {
        const { event, tasks, events } = get();
        const newRegistrations = simulateRegistrationOutcome(event.currentRegistrations, taskId);
        const updatedEvent = { ...event, currentRegistrations: newRegistrations };
        const newKpis = calculateKPIs(updatedEvent, tasks.filter(task => task.eventId === event.id));
        set({ event: updatedEvent, events: events.map(item => item.id === event.id ? updatedEvent : item), kpis: newKpis });
      },

      resetToDefaults: () => {
        const newKpis = calculateKPIs(EMPTY_EVENT, initialTasks);
        set({
          selectedRole: 'leadership',
          selectedView: 'home',
          events: initialEvents,
          selectedEventId: EMPTY_EVENT.id,
          teamAssignments: initialTeamAssignments,
          participantEvents: initialParticipantEvents,
          announcements: initialAnnouncements,
          risks: initialRisks.map(risk => ({ ...risk, eventId: DEMO_EVENT.id })),
          recommendations: initialRecommendations.map(recommendation => ({ ...recommendation, eventId: DEMO_EVENT.id })),
          tasks: [...initialTasks],
          notifications: [],
          kpis: newKpis,
          drawer: { isOpen: false, task: null, type: 'task' },
          event: EMPTY_EVENT,
          generatedPlan: null,
          isSubmittingEvent: false,
          setupError: null,
        });
      },

      initializeFromApi: async (eventId: string) => {
        if (!get().isUsingApi) return;
        try {
          const [event, risks, recommendations, tasks] = await Promise.all([
            api.getEvent(eventId),
            api.getRisks(eventId),
            api.getRecommendations(eventId),
            api.getTasks(eventId),
          ]);
          const apiEvent = { ...event, isDemo: false };
          const apiTasks = tasks.map(task => ({ ...task, eventId: apiEvent.id }));
          set({ event: apiEvent, events: [...get().events.filter(item => !item.isDemo && item.id !== apiEvent.id), apiEvent], selectedEventId: apiEvent.id, risks: risks.map(risk => ({ ...risk, eventId: apiEvent.id })), recommendations: recommendations.map(recommendation => ({ ...recommendation, eventId: apiEvent.id })), tasks: apiTasks, kpis: calculateKPIs(apiEvent, apiTasks), isUsingApi: true });
        } catch (e) {
          console.error('Failed to initialize event data from the API:', e);
          set({ setupError: e instanceof Error ? e.message : 'Unable to load event data.' });
        }
      },

      loadEventsFromApi: async () => {
        if (!get().isUsingApi) return;
        try {
          const events = await api.listEvents();
          if (!events.length) {
            set({ events: [], event: EMPTY_EVENT, selectedEventId: EMPTY_EVENT.id, tasks: [], risks: [], recommendations: [], kpis: calculateKPIs(EMPTY_EVENT, []) });
            return;
          }
          const selectedId = events.some(item => item.id === get().selectedEventId) ? get().selectedEventId : events[0].id;
          const selectedEvent = events.find(item => item.id === selectedId) ?? events[0];
          const [risks, recommendations, tasks] = await Promise.all([
            api.getRisks(selectedEvent.id),
            api.getRecommendations(selectedEvent.id),
            api.getTasks(selectedEvent.id),
          ]);
          const apiEvent = { ...selectedEvent, isDemo: false };
          const apiTasks = tasks.map(task => ({ ...task, eventId: apiEvent.id }));
          set({ events: events.map(item => ({ ...item, isDemo: false })), event: apiEvent, selectedEventId: apiEvent.id, risks: risks.map(risk => ({ ...risk, eventId: apiEvent.id })), recommendations: recommendations.map(item => ({ ...item, eventId: apiEvent.id })), tasks: apiTasks, kpis: calculateKPIs(apiEvent, apiTasks), isUsingApi: true, setupError: null });
        } catch (e) {
          console.error('Failed to load events from the API:', e);
          set({ setupError: e instanceof Error ? e.message : 'Unable to load events.' });
        }
      },

      // Ticket options
      createTicketOption: (option: Omit<TicketOption, 'id' | 'soldCount'>) => set(state => ({
        ticketOptions: [...state.ticketOptions, { ...option, id: `opt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, soldCount: 0 }]
      })),
      updateTicketOption: (id: string, updates: Partial<TicketOption>) => set(state => ({
        ticketOptions: state.ticketOptions.map(opt => opt.id === id ? { ...opt, ...updates } : opt)
      })),
      deleteTicketOption: (id: string) => set(state => ({
        ticketOptions: state.ticketOptions.filter(opt => opt.id !== id)
      })),

      // Invitations
      createInvitation: (invitation: Omit<Invitation, 'id' | 'usedCount' | 'status'>) => set(state => ({
        invitations: [...state.invitations, { ...invitation, id: `inv-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, usedCount: 0, status: 'active' as InvitationStatus }]
      })),
      revokeInvitation: (id: string) => set(state => ({
        invitations: state.invitations.map(inv => inv.id === id ? { ...inv, status: 'revoked' as InvitationStatus, revokedAt: new Date().toISOString() } : inv)
      })),

      // Registrations
      registerForEvent: (registration: Omit<Registration, 'id' | 'referenceNumber' | 'registeredAt'>) => set(state => ({
        registrations: [...state.registrations, { ...registration, id: `reg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, referenceNumber: `REG-${Date.now().toString(36).toUpperCase()}`, registeredAt: new Date().toISOString() }]
      })),
      cancelRegistration: (registrationId: string) => set(state => ({
        registrations: state.registrations.map(reg => reg.id === registrationId ? { ...reg, status: 'cancelled' as const, cancelledAt: new Date().toISOString() } : reg)
      })),

      // Support tickets
      createSupportTicket: (ticket: Omit<SupportTicket, 'id' | 'referenceNumber' | 'createdAt' | 'updatedAt'>) => set(state => ({
        supportTickets: [...state.supportTickets, { ...ticket, id: `ticket-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, referenceNumber: `SUP-${Date.now().toString(36).toUpperCase()}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
      })),
      updateSupportTicket: (id: string, updates: Partial<SupportTicket>) => set(state => ({
        supportTickets: state.supportTickets.map(t => t.id === id ? { ...t, ...updates, updatedAt: new Date().toISOString() } : t)
      })),
      addSupportMessage: (message: Omit<SupportMessage, 'id' | 'createdAt'>) => set(state => ({
        supportMessages: [...state.supportMessages, { ...message, id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, createdAt: new Date().toISOString() }]
      })),
      assignSupportTicket: (ticketId: string, assigneeId: string) => set(state => ({
        supportTickets: state.supportTickets.map(t => t.id === ticketId ? { ...t, assigneeId, status: 'acknowledged' as SupportTicketStatus, updatedAt: new Date().toISOString() } : t)
      })),
    }),
    {
      name: 'eventpilot-dashboard-store',
      version: 5,
      migrate: (persisted) => {
        const old = persisted as Partial<StoreState>;
        const restoreEvent = (saved: Event): Event => saved;
        const eventsById = new Map<string, Event>();
        for (const item of (old.events ?? []).filter(item => !LEGACY_FIXTURE_EVENT_IDS.has(item.id)).map(restoreEvent)) eventsById.set(item.id, item);
        const savedEvent = old.event;
        if (savedEvent?.id && !LEGACY_FIXTURE_EVENT_IDS.has(savedEvent.id) && savedEvent.id !== EMPTY_EVENT.id) {
          eventsById.set(savedEvent.id, restoreEvent(savedEvent));
        }
        const events = [...eventsById.values()];
        const eventId = old.selectedEventId && eventsById.has(old.selectedEventId) ? old.selectedEventId : events[0]?.id ?? EMPTY_EVENT.id;
        const selectedEvent = eventsById.get(eventId) ?? EMPTY_EVENT;
        const isLegacyRecord = (record: { eventId?: string }) => !!record.eventId && LEGACY_FIXTURE_EVENT_IDS.has(record.eventId);
        const tasks = (old.tasks ?? initialTasks).filter(task => !isLegacyRecord(task));
        const risks = (old.risks ?? initialRisks).filter(risk => !isLegacyRecord(risk));
        const recommendations = (old.recommendations ?? initialRecommendations).filter(item => !isLegacyRecord(item));
        return {
          selectedRole: old.selectedRole ?? 'leadership',
          selectedView: old.selectedView ?? 'home',
          risks,
          recommendations,
          tasks,
          notifications: old.notifications ?? [],
          event: selectedEvent,
          events,
          selectedEventId: eventId,
          teamAssignments: (old.teamAssignments ?? initialTeamAssignments).filter(item => !LEGACY_FIXTURE_EVENT_IDS.has(item.eventId)),
          participantEvents: (old.participantEvents ?? initialParticipantEvents).filter(item => !LEGACY_FIXTURE_EVENT_IDS.has(item.eventId)),
          announcements: (old.announcements ?? initialAnnouncements).filter(item => !LEGACY_FIXTURE_EVENT_IDS.has(item.eventId)),
          ticketOptions: old.ticketOptions ?? initialTicketOptions,
          invitations: old.invitations ?? initialInvitations,
          registrations: old.registrations ?? initialRegistrations,
          supportTickets: old.supportTickets ?? initialSupportTickets,
          supportMessages: old.supportMessages ?? initialSupportMessages,
          generatedPlan: old.generatedPlan ?? null,
        };
      },
      partialize: (state) => ({
        selectedRole: state.selectedRole,
        selectedView: state.selectedView,
        risks: state.risks,
        recommendations: state.recommendations,
        tasks: state.tasks,
        notifications: state.notifications,
        event: state.event,
        events: state.events,
        selectedEventId: state.selectedEventId,
        teamAssignments: state.teamAssignments,
        participantEvents: state.participantEvents,
        announcements: state.announcements,
        ticketOptions: state.ticketOptions,
        invitations: state.invitations,
        registrations: state.registrations,
        supportTickets: state.supportTickets,
        supportMessages: state.supportMessages,
        generatedPlan: state.generatedPlan,
      }),
    }
  )
);
