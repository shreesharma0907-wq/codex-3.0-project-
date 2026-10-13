# RUNSHOW API foundation

The repository now includes a Node 24 `node:sqlite` server foundation. The default database is `.data/runshow.sqlite`; set `RUNSHOW_DB_PATH` to use another location. `.data` is development data and must not be used as a shared production database without backups and operational controls.

## Configuration

Required for a first organizer account:

```text
RUNSHOW_BOOTSTRAP_ORGANIZER_EMAIL=organizer@example.test
RUNSHOW_BOOTSTRAP_ORGANIZER_PASSWORD=<secret outside source control>
RUNSHOW_BOOTSTRAP_ORGANIZER_NAME=Organizer
```

The bootstrap account is created lazily on the first login request and only when the email does not already exist. Public signup always creates a participant. Organizer-controlled sub-organizer provisioning remains a separate workflow. Passwords are stored as salted scrypt verifiers, never plaintext.

## Authentication

- `POST /api/auth/signup` creates a participant and starts a seven-day HttpOnly, SameSite=Lax session.
- `POST /api/auth/login` validates server-side credentials and sets the session cookie.
- `GET /api/auth/session` returns `{ user }` or `{ user: null }`.
- `POST /api/auth/logout` invalidates the current session.

Unsafe requests validate the `Origin` header when present. Production deployments should set `RUNSHOW_ALLOWED_ORIGIN` to the exact frontend origin and serve over HTTPS. Login rate limiting is not yet implemented; place the route behind an edge/WAF rate limiter before production use.

## Event and workspace endpoints

All require the session cookie unless stated otherwise.

| Method | Path | Permission | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/events` | Any authenticated workspace role | List accessible events |
| `POST` | `/api/events` | Organizer | Validate and transactionally create an event, sessions and optional tasks |
| `GET` | `/api/events/:eventId` | Assigned/owner | Fetch event and sessions |
| `PATCH` | `/api/events/:eventId` | Organizer owner | Update lifecycle status |
| `GET` | `/api/events/:eventId/tasks?status=` | Organizer/sub-organizer assignment | List tasks |
| `POST` | `/api/events/:eventId/tasks` | Organizer/sub-organizer assignment | Create a task |
| `PATCH` | `/api/tasks/:taskId` | Organizer/sub-organizer assignment | Update task status |
| `GET` | `/api/events/:eventId/team` | Organizer owner | List assignments |
| `POST` | `/api/events/:eventId/team` | Organizer owner | Assign an existing active sub-organizer |
| `GET` | `/api/events/:eventId/risks` | Organizer/sub-organizer assignment | List risks |
| `PATCH` | `/api/risks/:riskId` | Organizer/sub-organizer assignment | Update risk status |
| `GET` | `/api/events/:eventId/recommendations` | Organizer/sub-organizer assignment | List persisted recommendations |
| `POST` | `/api/events/:eventId/recommendations/regenerate` | Organizer owner | Read current persisted recommendations; generation remains the existing deterministic engine integration point |
| `GET` | `/api/events/:eventId/metrics` | Organizer/sub-organizer assignment | Return persisted-data metrics, with unknown registration counts represented as zero plus a zero target percentage |

Errors use `{ "error": { "code": "...", "message": "..." } }`. Dates are serialized as ISO-compatible timestamps for storage; event responses additionally expose the existing frontend `date`, `startDate`, `endDate`, `startTime`, `endTime` fields.

Example request:

```json
{
  "name": "Leadership Forum",
  "type": "Conference",
  "startDate": "2026-11-12",
  "endDate": "2026-11-13",
  "startTime": "09:00",
  "endTime": "17:00",
  "timezone": "Asia/Kolkata",
  "format": "in-person",
  "venue": "Convention Hall",
  "targetRegistrations": 300,
  "expectedAttendance": 240,
  "participantCapacity": 300,
  "sessions": []
}
```

The current frontend API adapter sends `credentials: include` and includes generated wizard tasks in `POST /api/events` when `NEXT_PUBLIC_USE_API` is enabled. Live API/server authentication mode is the default; set `NEXT_PUBLIC_USE_API=false` to opt into browser-local demo fixtures.

## Development

Node 24+ is required for the built-in `node:sqlite` module. Run `NEXT_PUBLIC_USE_API=true npm run dev` to exercise API-mode event creation. The SQL source is tracked at `database/migrations/001_initial.sql`; the current bootstrap applies idempotent schema additions automatically so a migration runner is not required for local development.
