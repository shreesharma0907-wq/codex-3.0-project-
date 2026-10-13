# Team Integration Document — EventPilot AI Dashboard

**Project:** EventPilot AI Dashboard (Member 1)
**Hackathon:** CodeX 3.0
**Last Updated:** 2026-10-11
**Status:** Integration seams added — frontend ready for teammate integration

---

## 1. Current TypeScript Interfaces (Confirmed — In Use by Frontend)

These interfaces are defined in `src/lib/types.ts` and used throughout the dashboard. **Do not change field names without coordinating with Member 1.**

### Event
```typescript
interface Event {
  id: string;
  name: string;
  date: string;                 // ISO date string (YYYY-MM-DD)
  targetRegistrations: number;
  currentRegistrations: number;
  partnerConfirmations: number;
  totalPartners: number;
  venueConfirmed: boolean;
  daysRemaining: number;        // Computed client-side from date
}
```

### Metrics (KPIData)
```typescript
interface KPIData {
  registrations: {
    current: number;
    target: number;
    gap: number;                // target - current
    percentage: number;         // current / target * 100
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
  eventReadiness: number;       // Weighted score 0-100
}
```

### Risk
```typescript
type RiskSeverity = 'critical' | 'high' | 'medium' | 'low';
type RiskStatus = 'open' | 'in-progress' | 'mitigated' | 'closed';

interface Risk {
  id: string;
  title: string;
  severity: RiskSeverity;
  reason: string;
  owner: Role;                  // 'marketing' | 'partnerships' | 'operations' | 'programme' | 'leadership'
  deadline?: string;            // ISO date string
  status: RiskStatus;
  relatedRecommendationId?: string;
  relatedTaskId?: string;
}
```

### Recommendation
```typescript
type RecommendationPriority = 'urgent' | 'high' | 'medium' | 'low';

interface Recommendation {
  id: string;
  action: string;
  reason: string;
  priority: RecommendationPriority;
  owner: Role;
  deadline: string;             // ISO date string
  expectedImpact: string;       // Human-readable (e.g., "+40-60 registrations")
  relatedRiskId?: string;
  relatedTaskId?: string;
}
```

### Task
```typescript
type TaskStatus = 'pending' | 'in-progress' | 'completed' | 'blocked';

interface Task {
  id: string;
  title: string;
  description: string;
  priority: RecommendationPriority;
  assignee: Role;
  deadline: string;             // ISO date string
  status: TaskStatus;
  relatedRiskId?: string;
  relatedRecommendationId?: string;
}
```

### Partner (Now in Shared Types)
```typescript
interface Partner {
  id: string;
  name: string;
  type: 'Platinum' | 'Gold' | 'Silver' | 'Bronze';
  status: 'confirmed' | 'pending';
  contact: string;
  deadline: string;             // ISO date string
}
```

### Role (Shared Enum)
```typescript
type Role = 'marketing' | 'partnerships' | 'operations' | 'programme' | 'leadership';
```

---

## 2. Integration Seams Added

### `src/lib/api.ts` — API Adapter Layer
A typed adapter that can run in **demo mode** (default) or **API mode** via environment variables.

**Environment Variables:**
```bash
NEXT_PUBLIC_USE_API=true        # Enable API mode (default: true; set false for demo fixtures)
NEXT_PUBLIC_API_BASE=/api       # API base path (default: /api)
```

**Behavior:**
- **Demo mode (default):** Returns simulated data from `demo-data.ts`, runs local recommendation engine
- **API mode:** Calls real endpoints, falls back to demo on error

**Exported `api` object with methods:**
| Method | Demo Fallback | API Call |
|--------|---------------|----------|
| `getEvent(id)` | `DEMO_EVENT` | `GET /api/events/:id` |
| `createEvent(event)` | local mock | `POST /api/events` |
| `getMetrics(id)` | `calculateKPIs()` | `GET /api/events/:id/metrics` |
| `getRisks(id, filters)` | `DEMO_RISKS` | `GET /api/events/:id/risks` |
| `updateRiskStatus(id, status)` | local update | `PATCH /api/risks/:id` |
| `getRecommendations(id, filters)` | `generateRecommendations()` | `GET /api/events/:id/recommendations` |
| `regenerateRecommendations(id)` | `generateRecommendations()` | `POST /api/events/:id/recommendations/regenerate` |
| `getTasks(id, filters)` | `DEMO_TASKS` | `GET /api/events/:id/tasks` |
| `updateTaskStatus(id, status)` | local update | `PATCH /api/tasks/:id` |
| `completeTask(id, outcome)` | local simulation + engine | `POST /api/tasks/:id/complete` |
| `getPartners(id)` | inline partner data | `GET /api/events/:id/partners` |
| `updatePartnerStatus(id, status)` | local update | `PATCH /api/partners/:id` |
| `recordRegistrationOutcome(id, payload)` | local simulation | `POST /api/events/:id/registration-outcome` |
| `isUsingApi()` | `false` | `true` |

### `src/lib/dashboard-state.ts` — Zustand Store with API Integration
- Added `isUsingApi` flag (from `api.isUsingApi()`)
- Added async versions of actions: `completeTask`, `updateTaskStatus`, `regenerateRecommendations`, `initializeFromApi`
- Kept sync versions for demo mode: `completeTaskSync`, `updateTaskStatusSync`, `regenerateRecommendationsSync`
- Auto-falls back to sync logic on API errors
- New `initializeFromApi(eventId)` for Member 4 to call on app init

### `src/components/dashboard/PartnerOverview.tsx` — Live Partner Data
- Loads partners via `api.getPartners(event.id)` on mount
- Shows "Live Data" badge when `isUsingApi=true`, "Demo Data" otherwise
- Status changes use `api.updatePartnerStatus` (API) or local state (demo)

### `src/components/dashboard/KPICards.tsx` — Simulated Outcome Indicators
- Registrations card shows "Sim" badge + tooltip when `currentRegistrations > 280` in demo mode
- Banner appears at bottom of KPI row explaining simulated outcomes
- Shows exact simulation map: "task-1: +50, task-6: +25"

### `src/lib/types.ts` — Partner Interface Added
`Partner` interface moved to shared types for all members.

---

## 3. Current Frontend State & Simulated Data

| Data Layer | Source | Simulation Notes |
|------------|--------|------------------|
| Event | `DEMO_EVENT` in `demo-data.ts` | Hardcoded TechSprint Delhi event |
| Risks | `DEMO_RISKS` (5 risks) | Static array with cross-links to recs/tasks |
| Recommendations | `DEMO_RECOMMENDATIONS` (7) + `recommendation-rules.ts` engine | Initial load = static; post-task = engine |
| Tasks | `DEMO_TASKS` (10 tasks) | Static with cross-links |
| Partners | `PARTNER_DATA` in `PartnerOverview.tsx` | 5 partners (3 confirmed, 2 pending) |
| Chart Data | `DEMO_CHART_DATA` + `DEMO_OUTREACH_DATA` | 9 days of simulated registration trend |
| Notifications | Local Zustand only | No real-time/socket |

### Explicit Demo Labels in UI
- Charts: "Demo Data" badge on Registration Trend & Outreach Conversion
- Risk Centre: "Demo Data" badge in header
- Recommendations: "Demo Data" badge in header
- Tasks: "Demo Data" badge in header
- Partner Overview: "Live Data" / "Demo Data" badge based on `isUsingApi`
- KPI Cards: "Sim" badge on Registrations when simulated outcomes present; banner explaining simulation

---

## 3. Expected API Operations

### Confirmed Frontend Interfaces
The frontend **already uses** the interfaces in Section 1. The backend must eventually return data matching these shapes.

### Proposed API Endpoints (Not Yet Implemented — For Discussion)

| Operation | Proposed Endpoint | Request | Response |
|-----------|-------------------|---------|----------|
| **Event** | | | |
| Get event | `GET /api/events/:id` | — | `Event` |
| Create event | `POST /api/events` | `Omit<Event, 'id' \| 'daysRemaining'>` | `Event` |
| **Metrics** | | | |
| Get dashboard metrics | `GET /api/events/:id/metrics` | — | `KPIData` |
| **Risks** | | | |
| List risks | `GET /api/events/:id/risks` | `?role=&severity=&status=` | `Risk[]` |
| Update risk status | `PATCH /api/risks/:id` | `{ status: RiskStatus }` | `Risk` |
| **Recommendations** | | | |
| Get recommendations | `GET /api/events/:id/recommendations` | `?role=&priority=` | `Recommendation[]` |
| Regenerate (Member 3) | `POST /api/events/:id/recommendations/regenerate` | — | `Recommendation[]` |
| **Tasks** | | | |
| List tasks | `GET /api/events/:id/tasks` | `?role=&status=` | `Task[]` |
| Update task | `PATCH /api/tasks/:id` | `{ status: TaskStatus }` | `Task` |
| Complete task | `POST /api/tasks/:id/complete` | `{ outcome?: { registrationsAdded: number; source: 'simulated' \| 'actual' } }` | `{ task: Task; event: Event; risks: Risk[]; recommendations: Recommendation[] }` |
| **Partners** | | | |
| List partners | `GET /api/events/:id/partners` | — | `Partner[]` |
| Update partner | `PATCH /api/partners/:id` | `{ status: 'confirmed' \| 'pending' }` | `Partner` |
| **Outcomes** | | | |
| Record registration outcome | `POST /api/events/:id/registration-outcome` | `{ taskId: string; registrationsAdded: number; source: 'simulated' \| 'actual' }` | `Event` |

### Outcome Recording (Critical for Member 3/4)
The frontend currently **simulates** registration increases when specific tasks complete:
- `task-1` (waitlist campaign) → +50 registrations
- `task-6` (referral program) → +25 registrations

**Required:** Backend must accept an explicit outcome payload so simulated vs. actual registrations are distinguishable. The frontend sends `source: 'simulated'` for demo purposes.

---

## 4. Recommendation Initialization — Smallest Safe Change

### Current Behavior
- **Initial load:** Uses static `DEMO_RECOMMENDATIONS` from `demo-data.ts` (7 items)
- **After task completion:** Calls `generateRecommendations()` from `recommendation-rules.ts`, merges with existing to preserve IDs

### Smallest Safe Change for Member 3 Integration
**Option A (Implemented):** `initializeFromApi(eventId)` in store — Member 3 replaces with API call.

**Option B (Available):** Member 3 provides a `RecommendationEngine` class with same `generateRecommendations(event, risks, tasks)` signature. Frontend imports and uses it — zero API coupling.

**Decision needed from Member 3:** Which approach? The engine is pure TS with no external deps.

---

## 5. Task Completion & Registration Updates — Simulated Data Labelling

### Current Flow
```typescript
// In api.completeTask (demo fallback) and store.completeTask
if (taskId === 'task-1' || taskId === 'task-6') {
  updatedEvent.currentRegistrations = simulateRegistrationOutcome(updatedEvent.currentRegistrations, taskId);
}
```

### Simulation Map (Hardcoded in `calculations.ts:112-118`)
```typescript
const outcomes: Record<string, number> = {
  'task-1': 50,   // waitlist campaign
  'task-6': 25,   // referral program
};
```

### Implementation
- Frontend sends outcome explicitly via `api.completeTask(taskId, { registrationsAdded, source: 'simulated' })`
- KPI Cards show "Sim" badge + tooltip when simulated outcomes detected
- Banner at bottom of KPI row explains simulation map and how to enable live data

### Member 4 Must Define
- Whether backend stores simulated outcomes separately or merges with a flag
- Table design for `RegistrationOutcome` records

---

## 6. Files Changed for Integration

| File | Change |
|------|--------|
| `src/lib/types.ts` | Added `Partner` interface |
| `src/lib/api.ts` | **New** — API adapter layer with demo fallback |
| `src/lib/dashboard-state.ts` | Added API integration, async actions, `isUsingApi`, `initializeFromApi` |
| `src/components/dashboard/PartnerOverview.tsx` | Uses `api.getPartners`, live/demo badge, status updates |
| `src/components/dashboard/KPICards.tsx` | "Sim" badge, tooltip, simulation banner |
| `TEAM_INTEGRATION.md` | Updated with integration seams, checklist |

---

## 7. Integration Checklist

### Member 2 (Partners) — Owns Partner Data & CRM
**Files to implement/replace:**
- Backend: `GET /api/events/:id/partners`, `PATCH /api/partners/:id`
- Shared: Confirm `Partner` interface in `src/lib/types.ts` matches needs

**Test:**
1. Set `NEXT_PUBLIC_USE_API=true`, `NEXT_PUBLIC_API_BASE=/api`
2. Navigate to Partners view — should show "Live Data" badge
3. Click status badge on pending partner — should call `PATCH /api/partners/:id`
4. Verify UI updates without reload

**Questions to resolve:**
1. Partner CRUD in same API or separate service?
2. Any filtering/pagination on partner list?

---

### Member 3 (Intelligence / Recommendations) — Owns Recommendation Engine
**Files to implement/replace:**
- Option A: Implement `POST /api/events/:id/recommendations/regenerate` returning `Recommendation[]`
- Option B: Provide `RecommendationEngine` class with `generateRecommendations(event, risks, tasks)` method (zero API coupling)

**Test:**
1. Set `NEXT_PUBLIC_USE_API=true`
2. Complete a task — verify recommendations update via API/engine
3. Click "Regenerate" in Recommendations view (if added) — verify call

**Questions to resolve:**
1. Callable TS engine or API endpoint?
2. If API: what auth/context? (eventId, role, userId?)
3. Stale recommendation handling — full regenerate or delta?

---

### Member 4 (Backend / API) — Owns Persistence & API
**Files to implement:**
- All endpoints in Section 3 table
- Auth middleware (JWT/session/header-based)
- Database schema for Event, Risk, Recommendation, Task, Partner, RegistrationOutcome
- CORS config for `http://localhost:3000`

**Test:**
1. Start backend, set `NEXT_PUBLIC_USE_API=true`, `NEXT_PUBLIC_API_BASE=http://localhost:PORT/api`
2. Load dashboard — verify all 6 views populate from API
3. Complete task — verify event, risks, recommendations update
4. Check registration outcome recorded with `source: 'simulated'`

**Questions to resolve:**
1. Auth strategy — JWT? Session? Header-based?
2. Base URL / API prefix — `/api` or `/v1`?
3. Error response format — `{ error: { code, message } }`?
4. Outcome recording — store simulated vs actual separately?
5. CORS / credentials for dev (`:3000`)?
6. Event creation flow — self-serve or admin?

---

## 8. Quick Start for Teammates

```bash
# Clone / navigate
cd eventpilot-dashboard

# Install
npm install

# Demo mode (no backend needed)
npm run dev

# API mode (requires backend)
NEXT_PUBLIC_USE_API=true NEXT_PUBLIC_API_BASE=http://localhost:PORT/api npm run dev

# Type check
npx tsc --noEmit

# Lint
npm run lint

# Production build
npm run build
```

---

## 9. Verification Results

```bash
npm run lint        → ✓ 0 errors, 0 warnings
npx tsc --noEmit    → ✓ No errors
npm run build       → ✓ Compiled successfully, static generation 4/4
```

All checks pass. Dashboard builds as static page (demo mode) with no server dependencies.

---

## 10. Unresolved Blockers (Require Teammate Decisions)

| Blocker | Owner | Status |
|---------|-------|--------|
| Partner CRUD location (same API vs separate) | Member 2 | ⏳ Pending |
| Recommendation engine delivery (TS class vs API) | Member 3 | ⏳ Pending |
| Auth strategy (JWT/session/header) | Member 4 | ⏳ Pending |
| API base path (`/api` vs `/v1`) | Member 4 | ⏳ Pending |
| Outcome storage (simulated vs actual separation) | Member 4 | ⏳ Pending |
| CORS config for localhost:3000 | Member 4 | ⏳ Pending |
| Event creation flow ownership | Member 4 | ⏳ Pending |

---

## 11. Changelog

| Date | Change | Files |
|------|--------|-------|
| 2026-10-11 | Added `Partner` type, API adapter, store integration, PartnerOverview live data, KPI simulated indicators | `types.ts`, `api.ts`, `dashboard-state.ts`, `PartnerOverview.tsx`, `KPICards.tsx`, `TEAM_INTEGRATION.md` |

---

**End of Document** — Integration seams ready. Run `npm run dev` in demo mode; set env vars for API mode.
