# EVENTPILOT AI / RUNSHOW
## Intelligent Event Command Centre & Operational Control Layer

EventPilot AI (Runshow) transforms fragmented event briefs, registrations, partner updates, operational checklists, and participant messages into a synchronized, live operational command center.

The core differentiator is **incident response and risk coordination**: from participant issue reporting at a gate to intelligent responder recommendation, assignment dispatch, real-time communication, resolution verification, and audit trail closure.

---

## 1. Architecture & Technology Stack

- **Framework:** Next.js 16 App Router (Turbopack, TypeScript, React 19)
- **Database:** Node.js native `node:sqlite` (SQLite database stored locally in `.data/runshow.sqlite`)
- **State Management:** Zustand with client-side session hydration and API data synchronization
- **Styling & UI:** Tailwind CSS v4, Lucide React icons, Accessible custom UI components
- **Animations & Performance:** Motion (Framer Motion) with strict `useReducedMotion()` optimization and on-demand portal rendering
- **Analytics:** Recharts for registration trajectory and outreach conversion metrics

---

## 2. Key Modules & Features Implemented

### A. Intelligent Incident Command Desk (`/incidents`)
- **Triage & Priority Scoring:** Transparent algorithm computing priority (0–100) based on severity, category sensitivity (safety/transport), time-to-session proximity, and SLA thresholds.
- **Smart Responder Dispatch:** Recommendation engine ranking sub-organizers and team members by skill match, venue zone assignment, availability, and active incident workload. Explains the exact justification to the dispatcher.
- **Incident Lifecycle:** State machine enforcing legal transitions: `new` ➔ `acknowledged` ➔ `assigned` ➔ `in_progress` ➔ `waiting_external` ➔ `resolved` ➔ `closed`.
- **Integrated Comms & Internal Notes:** Allows operational staff to message the reporter while keeping sensitive notes strictly hidden from participants.
- **Immutable Audit Trail:** Logs every status transition, assignment, message, and resolution with timestamp and actor attribution.

### B. Participant Help Centre (`/help-centre`)
- **Participant-Facing Support Portal:** Direct access for attendees to report transit delays, venue location requests, technical glitches, or badging problems.
- **Quick Assistance Buttons:** One-click presets for frequent issues (e.g. Delayed Bus at Gate 2, Missing Wi-Fi, Registration desk).
- **Persistent Reference Tracking:** Generates unique tracking IDs (`INC-2026-XXXX`). Shows live status updates, staff resolution messages, and allows participant replies.

### C. Unified Operational Task Engine
- **Event-Aware Tasks:** To-do items linked directly to event sessions, risks, and incidents.
- **Operational Urgency Sorting:** Tasks dynamically prioritized by:
  1. Critical incident blocker tasks
  2. Overdue tasks
  3. Imminent milestone deadlines (< 48 hours)
  4. Routine operational tasks
- **Quick-Add Task Bar:** Persistent task creation directly from the list with Enter key support.

### D. Persistent In-App Notifications
- Notification service storing alerts in SQLite for assignments, status changes, escalations, and critical incidents.
- Polling synchronization in header with unread badge counter and "Mark all read" controls.

### E. Calendar Performance Optimization
- Replaced eager mounting of 35+ full date previews with on-demand portal rendering in `AnchoredPreview.tsx`.
- Restrained transforms and respect for reduced-motion preferences.

---

## 3. Seeded Accounts & Demonstration Credentials

Run `npm run db:seed` to reset the database to a deterministic, realistic state.

| Role | Email | Password | Responsibilities |
|------|-------|----------|------------------|
| **Lead Organizer** | `organizer@runshow.ai` | `RunshowDemo2026!` | Overall command, incident dispatch, event setup |
| **Sub-Organizer (Transport)** | `transport@runshow.ai` | `RunshowDemo2026!` | Gate 2, shuttle logistics, operations |
| **Sub-Organizer (Venue)** | `venue@runshow.ai` | `RunshowDemo2026!` | Auditorium, main hall, safety |
| **Participant** | `alex@participant.com` | `RunshowDemo2026!` | Attendee portal, Help Centre |

---

## 4. How to Run, Seed, Test, and Build

### Prerequisites
- Node.js v20+ (tested on Node v24.20.0)
- npm v10+

### Database Seeding
```bash
npm run db:seed
```

### Running Tests
```bash
npm test
```
Runs the automated test suite verifying database schema integrity, foreign key constraints, cascade deletions, and the incident priority scoring engine.

### Building for Production
```bash
npm run build
```

### Starting the Development Server
```bash
# Live SQLite/API mode (default; explicit for clarity)
NEXT_PUBLIC_USE_API=true npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

The invitation and registration workflow uses the server API and `.data/runshow.sqlite`. API mode is the default when `NEXT_PUBLIC_USE_API` is unset; set `NEXT_PUBLIC_USE_API=false` only to use browser-only demo fixtures. If an existing database predates invitations or tickets, restarting the server applies the idempotent schema additions without resetting `.data/runshow.sqlite`.

---

## 5. Step-by-Step Judge Demonstration Script: The "Delayed-Bus" Incident

Follow these exact steps to demonstrate the end-to-end incident lifecycle to hackathon judges:

1. **Step 1: Open the Command Dashboard**
   - Log in as the Lead Organizer (`organizer@runshow.ai` / `RunshowDemo2026!`).
   - Show the **Dashboard Overview**: 50 current registrations against the 500 target (90% gap), 3 of 5 confirmed partners, and the critical risk cards.
   - Explain the deterministic recommendations advising marketing outreach and partner follow-up.

2. **Step 2: Inspect the Seeded Delayed Bus Incident**
   - Click on **Incident Desk** in the sidebar.
   - View incident **`INC-2026-BUS-DEMO`**: *"Delegate Shuttle Bus #4 Delayed at Gate 2 Checkpoint"*.
   - Point out the **Priority Score (95/100)** and the AI/Rule engine reasoning:
     * *Critical urgency*
     * *Transport disruption affecting arrival*
     * *Directly impacts Opening Ceremony starting in under 30 minutes*

3. **Step 3: Dispatch Recommended Responder**
   - Click **"Find Best Responders"**.
   - Show that **Marcus Chen (Transport & Logistics)** is ranked #1 with the highest match score.
   - Explain why: Marcus handles Gate 2 operations, specializes in transport logistics, and has 0 active incidents.
   - Click **"Dispatch Assignment"**. Marcus is assigned and a persistent in-app notification is logged.

4. **Step 4: Sub-Organizer / Responder Response**
   - Switch to Marcus Chen or observe status update.
   - Update the status: click **"Mark In Progress"**.
   - In Incident Comms, add an update: *"Contacted venue security; Gate 2 express lane opened for Bus #4."*
   - Add a private internal note: *"Driver confirmed arrival at Gate 2 within 4 minutes."* (Check the "Internal-only" box).

5. **Step 5: Resolve and Close the Incident**
   - Click **"Resolve Incident"**.
   - Enter resolution notes: *"All 35 delegates cleared security and seated in Auditorium Hall A for Keynote kickoff."*
   - Click **"Confirm Resolution"**.
   - Notice the status updates to **RESOLVED**, the linked operational task marks complete, and the audit log records the timestamp.
   - As Lead Organizer, click **"Close Incident"**.

6. **Step 6: Participant Verification**
   - Log in as Alex Rivera (`alex@participant.com` / `RunshowDemo2026!`) or switch to the Participant Workspace.
   - Open the **Help Centre**.
   - View `INC-2026-BUS-DEMO`: the participant sees the resolution summary and public messages, while the internal team note remained protected.
   - Refresh the page to demonstrate that all changes are 100% persisted in the SQLite database.
