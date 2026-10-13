export type Role = 'marketing' | 'partnerships' | 'operations' | 'programme' | 'leadership';

export type RiskSeverity = 'critical' | 'high' | 'medium' | 'low';

export type RiskStatus = 'open' | 'in-progress' | 'mitigated' | 'closed';

export type TaskStatus = 'pending' | 'in-progress' | 'completed' | 'blocked';

export type RecommendationPriority = 'urgent' | 'high' | 'medium' | 'low';

export type AccountRole = 'organizer' | 'sub_organizer' | 'participant';

export interface EventSession {
  id: string;
  name: string;
  date: string;
  startTime: string;
  endTime: string;
  venue: string;
  description: string;
  functionName?: string;
}

export interface TeamAssignment {
  id: string;
  accountId: string;
  eventId: string;
  functionName: string;
  responsibilities: Role[];
  active: boolean;
}

export interface ParticipantEventLink {
  accountId: string;
  eventId: string;
  registrationStatus?: 'invited' | 'registered' | 'cancelled';
  createdAt?: string;
}

export interface Announcement {
  id: string;
  eventId: string;
  title: string;
  message: string;
  publishedAt: string;
  isDemo: boolean;
  category?: 'General' | 'Schedule Change' | 'Venue Update' | 'Important' | 'Emergency';
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}

export type EventVisibility = 'public' | 'private';
export type TicketType = 'free' | 'paid';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'not_applicable';
export type SupportTicketStatus = 'open' | 'acknowledged' | 'in_progress' | 'waiting_for_participant' | 'resolved' | 'closed';
export type SupportTicketPriority = 'low' | 'normal' | 'high' | 'critical';
export type SupportTicketCategory = 'registration' | 'payment' | 'schedule' | 'checkin' | 'technical' | 'communication' | 'other';
export type InvitationStatus = 'active' | 'expired' | 'revoked' | 'exhausted';

export interface Event {
  id: string;
  name: string;
  type?: string;
  date: string;
  startDate?: string;
  endDate?: string;
  targetRegistrations: number;
  currentRegistrations: number;
  participantCapacity?: number;
  partnerConfirmations: number;
  totalPartners: number;
  venueConfirmed: boolean;
  daysRemaining: number;
  audience?: string;
  format?: 'in-person' | 'virtual' | 'hybrid';
  venue?: string;
  startTime?: string;
  endTime?: string;
  timezone?: string;
  meetingUrl?: string;
  joiningInstructions?: string;
  expectedAttendance?: number;
  lifecycle?: 'draft' | 'upcoming' | 'in-progress' | 'completed' | 'cancelled';
  objectives?: string[];
  successMetrics?: string[];
  budget?: number;
  operationalRequirements?: string;
  isDemo?: boolean;
  sessions?: EventSession[];
  participantInstructions?: string;
  visibility?: EventVisibility;
  ticketType?: TicketType;
  ticketPrice?: number;
  ticketCurrency?: string;
  registrationDeadline?: string;
  cancellationPolicy?: string;
  eligibilityRequirements?: string;
  bannerImageUrl?: string;
  organizerInstitution?: string;
  tags?: string[];
}

export interface TicketOption {
  id: string;
  eventId: string;
  name: string;
  description?: string;
  type: TicketType;
  price: number;
  currency: string;
  capacity?: number;
  soldCount: number;
  salesStart?: string;
  salesEnd?: string;
  isActive: boolean;
}

export interface Invitation {
  id: string;
  eventId: string;
  code: string;
  token: string;
  createdBy: string;
  createdAt: string;
  expiresAt?: string;
  maxUses?: number;
  usedCount: number;
  status: InvitationStatus;
  revokedAt?: string;
  revokedBy?: string;
}

export interface Registration {
  id: string;
  eventId: string;
  participantId: string;
  ticketOptionId?: string;
  invitationCode?: string;
  status: 'confirmed' | 'cancelled' | 'waitlisted';
  paymentStatus: PaymentStatus;
  registeredAt: string;
  cancelledAt?: string;
  checkedInAt?: string;
  referenceNumber: string;
}

export interface SupportTicket {
  id: string;
  eventId: string;
  participantId: string;
  title: string;
  description: string;
  category: SupportTicketCategory;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  assigneeId?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  referenceNumber: string;
}

export interface SupportMessage {
  id: string;
  ticketId: string;
  senderId: string;
  senderRole: 'participant' | 'organizer' | 'sub_organizer' | 'system';
  content: string;
  isInternal: boolean;
  createdAt: string;
  attachments?: string[];
}

export interface Risk {
  id: string;
  title: string;
  severity: RiskSeverity;
  reason: string;
  owner: Role;
  deadline?: string;
  status: RiskStatus;
  relatedRecommendationId?: string;
  relatedTaskId?: string;
  eventId?: string;
}

export interface Recommendation {
  id: string;
  action: string;
  reason: string;
  priority: RecommendationPriority;
  owner: Role;
  deadline: string;
  expectedImpact: string;
  relatedRiskId?: string;
  relatedTaskId?: string;
  eventId?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: RecommendationPriority;
  assignee: Role;
  deadline: string;
  status: TaskStatus;
  relatedRiskId?: string;
  relatedRecommendationId?: string;
  eventId?: string;
  functionName?: string;
}

export interface KPIData {
  registrations: {
    current: number;
    target: number;
    gap: number;
    percentage: number;
  };
  partnerConfirmations: {
    current: number;
    total: number;
    percentage: number;
  };
  taskCompletion: {
    completed: number;
    total: number;
    percentage: number;
  };
  eventReadiness: number;
}

export interface ChartDataPoint {
  date: string;
  registrations: number;
  target?: number;
}

export interface OutreachDataPoint {
  channel: string;
  sent: number;
  converted: number;
  conversionRate: number;
}

export interface DashboardState {
  selectedRole: Role;
  selectedView: 'home' | 'setup' | 'overview' | 'calendar' | 'event-health' | 'settings' | 'recommendations' | 'tasks' | 'partners' | 'operations' | 'incidents' | 'help-centre' | 'team';
  risks: Risk[];
  recommendations: Recommendation[];
  tasks: Task[];
  notifications: Notification[];
}

export interface Notification {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: string;
  read: boolean;
}

export interface DrawerState {
  isOpen: boolean;
  task: Task | null;
  type: 'task' | 'recommendation' | 'risk';
}

export interface Partner {
  id: string;
  name: string;
  type: 'Platinum' | 'Gold' | 'Silver' | 'Bronze';
  status: 'confirmed' | 'pending';
  contact: string;
  deadline: string;
}

export interface EventSetupFormData {
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  timezone: string;
  registrationDeadline: string;
  partnerDeadline: string;
  contentDeadline: string;
  audience: string;
  targetRegistrations: number;
  currentRegistrations: number;
  venue: string;
  format: 'in-person' | 'virtual' | 'hybrid';
  meetingUrl: string;
  joiningInstructions: string;
  objectives: string;
  successMetrics: string;
  budget?: number;
  operationalRequirements: string;
  expectedPartners: number;
  participantCapacity?: number;
  expectedAttendance: number;
  sessions?: EventSession[];
}

export interface EventMilestone {
  id: string;
  title: string;
  description: string;
  owner: Role;
  deadline: string;
  priority: RecommendationPriority;
}

export interface EventPlan {
  id: string;
  eventDraft: EventSetupFormData;
  milestones: EventMilestone[];
  tasks: Task[];
  risks: Risk[];
  successMetrics: string[];
  outreachTargets: {
    channel: string;
    target: number;
    owner: Role;
  }[];
  generatedAt: string;
  generator: 'deterministic';
}

export type IncidentCategory =
  | 'transport'
  | 'venue'
  | 'registration'
  | 'accommodation'
  | 'food'
  | 'safety'
  | 'technical issue'
  | 'accessibility'
  | 'programme'
  | 'other';

export type IncidentUrgency = 'critical' | 'high' | 'medium' | 'low';

export type IncidentStatus =
  | 'new'
  | 'acknowledged'
  | 'assigned'
  | 'in_progress'
  | 'waiting_external'
  | 'resolved'
  | 'reopened'
  | 'closed';

export interface IncidentMessage {
  id: string;
  incidentId: string;
  senderId: string;
  senderName: string;
  senderRole: AccountRole;
  message: string;
  isInternal: boolean;
  createdAt: string;
}

export interface IncidentActivity {
  id: string;
  incidentId: string;
  actorId: string;
  actorName: string;
  action: string;
  details: string;
  createdAt: string;
}

export interface IncidentAssignment {
  id: string;
  incidentId: string;
  responderId: string;
  responderName: string;
  assignedBy: string;
  assignedByName: string;
  reason: string;
  status: 'assigned' | 'acknowledged' | 'reassigned' | 'released';
  assignedAt: string;
  acknowledgedAt?: string;
}

export interface Incident {
  id: string;
  referenceNumber: string;
  eventId: string;
  reporterId: string;
  reporterName: string;
  category: IncidentCategory;
  title: string;
  description: string;
  zone?: string;
  affectedSessionId?: string;
  urgency: IncidentUrgency;
  contactPreference?: string;
  priorityScore: number;
  priorityReason: string;
  status: IncidentStatus;
  assignedResponderId?: string;
  assignedResponderName?: string;
  assignedAt?: string;
  acknowledgedAt?: string;
  resolutionNotes?: string;
  resolvedAt?: string;
  closedAt?: string;
  relatedRiskId?: string;
  relatedTaskId?: string;
  createdAt: string;
  updatedAt: string;
  messages?: IncidentMessage[];
  activities?: IncidentActivity[];
  assignments?: IncidentAssignment[];
}

export interface ResponderRecommendation {
  responderId: string;
  name: string;
  email: string;
  skills: string[];
  zones: string[];
  availability: string;
  activeIncidentsCount: number;
  score: number;
  reason: string;
}

export interface InAppNotification {
  id: string;
  userId: string;
  eventId?: string;
  incidentId?: string;
  taskId?: string;
  riskId?: string;
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
}

export interface TaskComment {
  id: string;
  taskId: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: string;
}

