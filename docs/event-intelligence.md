# Event Intelligence

The organizer command centre reads registrations, task deadlines, incident urgency/status, partner confirmations, invitation source labels, and persistent daily metric snapshots from the configured RUNSHOW SQLite database. Registration history is grouped by `registrations.created_at`; event dates are used only for deadlines.

## Gemini setup

Install dependencies with `npm install`, set `GEMINI_API_KEY` in the root `.env.local`, and restart the server. The value is server-only. The default model is `gemini-3.8-flash`; set `GEMINI_MODEL` to an available compatible model to override it. The organizer must choose Generate/Refresh analysis; dashboard reads only retrieve metrics and the cached analysis. Analyses expire after six hours, are marked stale after expiry, and provider errors never create replacement/fake AI content. Gemini receives aggregated event metrics and no participant contact details, passwords, invitation tokens, or raw incident descriptions.

## Metrics and limitations

Registration counts and daily creation-date series come from registration records. The baseline forecast uses the trailing seven daily counts and only appears after at least five non-cancelled records span three distinct dates. Its interval is a rough variability range, not validated accuracy. There is no delivery or invitation-open telemetry; outreach reports invitation generation and registrations associated with those invitation IDs/codes only. Source and campaign labels can be supplied when generating invitations.

API reads save one metric snapshot per event per UTC day, updating that day's snapshot on later visits. Comparisons therefore become available after a later UTC-day dashboard visit; no worker or scheduled infrastructure is required. For scheduled snapshots, invoke the authenticated event intelligence GET endpoint from an external scheduler using an authorized session; no cron/worker is included. Recommendation status and optional completion outcome are persisted. Creating a task is an explicit organizer action and creates an unassigned task with a one-day suggested deadline.

## Verification

Run `npm test`, `npx tsc --noEmit`, `npm run lint`, and `npm run build` from the repository root. The additive SQLite tables/columns are created by the existing database initializer; no reset or manual data deletion is required. `RUNSHOW_DB_PATH` selects the same DB for API routes, defaulting to `.data/runshow.sqlite`.
