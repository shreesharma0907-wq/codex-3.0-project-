# Member 2 Implementation Plan

## Existing App

- Framework: Next.js 16 App Router with React 19 and TypeScript.
- Styling and components: Tailwind CSS v4, dark SaaS command-centre theme, local `Button`, `Input`, `Select`, `Textarea`, `Card`, and `Badge` components.
- State/data: Zustand persisted store in `src/lib/dashboard-state.ts`.
- Dashboard data entry point: `event`, `tasks`, `risks`, `recommendations`, and `kpis` in the shared dashboard store.
- Current backend seam: `src/lib/api.ts` supports live API mode by default and demo mode with `NEXT_PUBLIC_USE_API=false`.
- Existing dashboard functionality: KPI cards, registration charts, risk centre, recommendations, tasks, partner overview, notifications, and role filtering.

## Integration Approach

- Add an Event Setup view inside Member 1's dashboard shell instead of replacing the dashboard.
- Reuse the shared store as the data handoff. When an event is confirmed, update the existing `event`, `tasks`, `risks`, `recommendations`, and `kpis` state with the actual generated event ID.
- Use deterministic plan generation unless a real AI/backend service is configured. No fake AI labels.
- Keep role switching as a prototype view because the app currently has no authentication or permission layer.
- Preserve API-mode compatibility by attempting `api.createEvent` first when API mode is enabled, then falling back to local demo persistence if needed.

## Feature Plan

- Add shared setup and plan types to `src/lib/types.ts`.
- Add deterministic plan generation in `src/lib/event-plan-generator.ts`.
- Extend the dashboard store with `confirmEventPlan`, `generatedPlan`, submission state, and error handling.
- Add `setup` to dashboard navigation and make it the default starting view for Member 2's workflow.
- Build a responsive multi-step wizard in `src/components/event-setup/EventSetupWizard.tsx`.
- Generate editable milestones/tasks/risks/metrics in the preview step before confirmation.
- On confirmation, save through the store/API layer, open the existing dashboard overview, and show success/error state while preventing duplicate submissions.
- Update docs and worklog as implementation progresses.

## Shared Contract Notes

- No new backend endpoint is required in demo mode.
- If backend/API mode is enabled, `api.createEvent` is used for the event. Generated tasks and risks remain client-side until the team adds task/milestone create endpoints.
- Event plan tasks map onto the existing shared `Task` interface and role enum, so Member 1 dashboard views can consume them without a duplicate model.
