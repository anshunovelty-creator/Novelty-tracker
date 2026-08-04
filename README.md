# Novelty Labels — Production Job Tracker

Production tracking for a label printing business. One system covers the whole
journey of an order: from the purchase order landing on a desk, through
prepress, the presses, slitting, QC and packing, to the labels leaving the
building — plus a public portal where the customer can follow their own order
without phoning anyone.

Built for the floor, not for a boardroom. Every screen answers "what is the
status of this job, and who is holding it up".

**Stack:** Next.js 14 (App Router) · TypeScript · Supabase (Postgres + Auth + RLS)
· Tailwind CSS v3 · GSAP · deployed on Vercel

---

## Table of contents

- [The two audiences](#the-two-audiences)
- [Features](#features)
- [The pipeline](#the-pipeline)
- [Departments and permissions](#departments-and-permissions)
- [Architecture](#architecture)
- [Data model](#data-model)
- [API reference](#api-reference)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [Deployment](#deployment)
- [Design system](#design-system)
- [Security notes](#security-notes)
- [Known limitations](#known-limitations)

---

## The two audiences

The same job data is presented twice, in two different vocabularies.

**Staff — `/admin`** (authenticated)
The control room. Every job, every stage, every internal note, machine queues,
shelf stock, analytics and CSV export. Department login decides what can be
changed.

**Customers — `/track`** (public, no login)
A customer types their PO number and sees a clean pipeline of where their order
is. Internal notes, machine assignments, other customers' work and anything
commercially sensitive never cross into this view — it reads from dedicated
Postgres views (`client_job_view`, `client_status_log_view`), not from the
`jobs` table directly.

**Shop floor — `/display`** (authenticated)
Wall-mounted screens for the production rooms, showing the live queue per
machine. Auto-refreshing and designed to be readable across a room.

---

## Features

### Job tracking

- **16-stage pipeline** with server-enforced prerequisites — a job cannot jump
  to Packing without passing QC. Enforced in the API, not just in the dropdown.
- **Job types** — `New`, `Repeat` and `Artwork Changed`. Repeat orders
  automatically skip the sample and shade-card stages, which a repeat has
  already been through.
- **Automatic job card numbers** — sequential per month (`AUG26-1`, `AUG26-2`),
  allocated by a Postgres counter table so two people adding jobs at the same
  moment cannot collide.
- **Urgent flag with 1–5 priority**, surfaced in sorting and on the displays.
- **Full audit trail** — every stage completion timestamped, every status change
  logged with the department that made it. Nothing is silently overwritten.
- **Inline delivery date editing**, restricted to Dispatch and Admin.
- **Job duplication** — one click copies an existing job into the Add Job form
  with fresh dates and a blank PO.

### Printing and machines

- **Printing units** — Unit-1 runs Offset, Unit-2 runs Flexo. The unit is the
  only thing asked for; the printing method is derived from it server-side, so
  the two can never disagree.
- **Machine registry** with per-machine run speed, used to estimate how long a
  queued job will take.
- **Machine queues** — jobs assigned to a specific press, reorderable.
- **Utilisation reporting** across machines.

### Quality and dispatch

- **QC stage with remarks**, captured on the job.
- **Partial dispatch via print runs** — an order can be printed and shipped in
  several cycles, each run tracked separately through Printing → QC → Packing →
  Dispatched with its own quantity.
- **Scheduled release orders** — a PO broken into planned releases with target
  quantities and dates, tracked against actuals.
- **On-time delivery analytics**, recorded automatically at dispatch and
  reported by month.
- **CSV export** of jobs, scheduled releases and print runs.

### Label stock

Printed labels that physically exist on a shelf, in three kinds:

| Kind | Meaning |
|---|---|
| `Remaining` | Unshipped balance of a partially dispatched order — already promised to that job |
| `Extra` | Surplus beyond the order: press over-run, or spares from a reprint |
| `Manual` | Stock someone found that the system never knew about |

Stock rows outlive the jobs they came from (`ON DELETE SET NULL`, with job
identity snapshotted onto the row) — closing a PO a year later must not erase
the record of 40,000 labels sitting on a rack.

- **Repeat-order stock match** — while a job is being entered, the app checks
  the shelf for that PM code and shows what is already there, before the
  quantity is decided. `Remaining` stock is reported separately and excluded
  from the usable figure, since it belongs to an open order.

### Communication

- **Global internal-note feed** — notes written on any job, from any stage,
  surface in a floating panel across the whole admin area with author,
  department and job. Previously a note was only visible to whoever opened that
  job. Polls every 25 seconds; opt-in desktop notifications.
- **Daily overdue alert** — a Vercel cron job at 9:00 AM IST finds active jobs
  past their delivery date and alerts Admin by email and WhatsApp.
- **Customer notifications** via Resend (email) and WATI (WhatsApp) —
  see [Security notes](#security-notes) before enabling.

---

## The pipeline

Sixteen stages. Fourteen are sequential; `On Hold` and `PO Closed` sit outside
the sequence.

| # | Stage | Owner |
|---|---|---|
| 1 | PO Received | Prepress |
| 2 | Artwork Pending | Prepress |
| 3 | Plate Status | Prepress |
| 4 | Job Card Done | Prepress |
| 5 | Sample Printing | QC |
| 6 | Shade Card Sent | QC |
| 7 | Shade Card Approved | QC |
| 8 | In Printing | Production |
| 9 | Slitting | Postpress |
| 10 | Quality Check | QC |
| 11 | Packing | Dispatch |
| 12 | Ready to Dispatch | Dispatch |
| 13 | Partial Dispatch | Dispatch |
| 14 | Dispatched | Dispatch |
| — | On Hold | Production / Postpress |
| — | PO Closed | Admin only |

Stages 5–7 are skipped for `Repeat` jobs, whose prerequisite for `In Printing`
becomes `Job Card Done`.

The stage list lives in `src/lib/constants/stages.ts` and is the single source
of truth — stage names are never hardcoded anywhere else.

---

## Departments and permissions

Five operational departments plus Admin. A user's department comes from their
Supabase `user_metadata.department` claim.

| Department | Can set stages | Other permissions |
|---|---|---|
| **Prepress** | PO Received, Artwork Pending, Plate Status, Job Card Done | Edit job details; set printing unit |
| **QC** | Sample Printing, Shade Card Sent, Shade Card Approved, Quality Check | — |
| **Production** | In Printing, On Hold | Set printing unit — **and nothing else** |
| **Postpress** | Slitting, On Hold | — |
| **Dispatch** | Packing, Ready to Dispatch, Partial Dispatch, Dispatched | Edit delivery date; manage label stock |
| **Admin** | All | Delete jobs; close POs; manage machines and units |

Permissions are enforced **in the API route handlers**, not only in the UI. The
UI control is a hint; the endpoint is the boundary. Every restriction in the
table above is re-checked server-side against the caller's department claim.

---

## Architecture

```
src/
├── app/
│   ├── (auth)/login/          Sign-in
│   ├── admin/                 Authenticated staff area
│   │   ├── page.tsx             Dashboard — jobs table, summary, machine board
│   │   ├── jobs/[id]/           Job detail: timeline, notes, print runs
│   │   ├── machines/            Machine registry + utilisation
│   │   ├── printing-units/      Unit management
│   │   └── stock/               Label stock on the shelf
│   ├── track/                 Public customer portal
│   │   ├── page.tsx             PO lookup
│   │   └── [po]/                Read-only pipeline for one order
│   ├── display/               Production-room wall displays
│   │   ├── [id]/                One machine
│   │   └── rotate/              Cycles through machines
│   └── api/                   Route handlers (see API reference)
├── middleware.ts              Auth guard
├── components/
│   ├── admin/                 Staff UI
│   ├── track/                 Customer UI
│   └── ui/                    Shared primitives
├── lib/
│   ├── constants/             stages.ts, departments.ts — access-control truth
│   ├── supabase/              server.ts (RLS) + admin.ts (service role)
│   ├── types.ts               Shared TypeScript types
│   └── utils.ts               Formatting helpers
└── supabase/migrations/       16 numbered SQL migrations, applied in order
```

### Two Supabase clients, used deliberately

- **`createServerSupabaseClient()`** — respects Row Level Security. Used for all
  reads on behalf of a user. This is the default.
- **`createAdminClient()`** — service role, bypasses RLS. Used only for writes
  *after* the route handler has already verified the caller's identity and
  department.

Picking the wrong one is the easiest way to introduce a security hole here, so
the choice is stated explicitly at each call site.

### Routing and auth

`src/middleware.ts` guards `/admin/*` and `/display/*` behind a Supabase
session, leaves `/track/*` public, and validates `/api/cron/*` against a
`CRON_SECRET` header. All other `/api/*` routes skip middleware and authenticate
themselves inside the handler.

---

## Data model

| Table | Purpose |
|---|---|
| `jobs` | The order. PO, party, PM code, quantities, dates, status, printing unit |
| `job_stage_timestamps` | When each stage was completed, per job |
| `job_status_logs` | Every status change, with the department that made it |
| `stage_comments` | Internal notes, attributed to author email + department |
| `dispatch_schedules` | Planned releases for scheduled-release orders |
| `on_time_dispatch_log` | Feeds the on-time delivery rate |
| `print_runs` | Partial-dispatch cycles, each with its own quantity and stage |
| `print_run_stage_logs` | Stage history per run |
| `printing_units` | Unit-1 (Offset), Unit-2 (Flexo) |
| `machines` | Presses and finishing machines, with run speed |
| `machine_queue_items` | Jobs queued against a machine |
| `job_card_counters` | Per-month sequence for job card numbers |
| `label_stock` | Printed labels physically on the shelf |
| `party_contacts` | Customer email / WhatsApp for notifications |
| `note_reads` | Per-user, per-note read state for the internal notes feed |

Plus two views used exclusively by the public portal: `client_job_view` and
`client_status_log_view`.

Migrations are numbered `001`–`017` and **must be applied in order**.

---

## API reference

All routes require an authenticated Supabase session unless noted.

### Jobs

| Method | Route | Notes |
|---|---|---|
| `GET` | `/api/jobs` | List; filters: `status`, `urgent`, `search`, `closed` |
| `POST` | `/api/jobs` | Create. Derives printing method from the chosen unit |
| `GET` | `/api/jobs/[id]` | Detail with timestamps, logs, notes, schedules |
| `PATCH` | `/api/jobs/[id]` | Update whitelisted fields; department-checked |
| `DELETE` | `/api/jobs/[id]` | Admin only |
| `POST` | `/api/jobs/[id]/status` | Stage change, prerequisite-enforced |
| `GET`·`POST` | `/api/jobs/[id]/comments` | Internal notes |
| `GET`·`POST` | `/api/jobs/[id]/print-runs` | Partial dispatch cycles |
| `PATCH` | `/api/jobs/[id]/print-runs/[runId]/stage` | Advance one run |
| `GET`·`POST` | `/api/jobs/[id]/schedules` | Scheduled releases |
| `GET` | `/api/jobs/pm-lookup?code=` | PM code typeahead for repeat orders |

### Stock, machines, units

| Method | Route | Notes |
|---|---|---|
| `GET`·`POST` | `/api/stock` | Live shelf stock; POST is Dispatch/Admin |
| `PATCH` | `/api/stock/[id]` | Mark dispatched (soft removal — no hard delete) |
| `GET` | `/api/stock/match?pm_code=` | Existing stock for a PM code |
| `GET`·`POST` | `/api/machines` | Machine registry |
| `GET`·`PATCH`·`DELETE` | `/api/machines/[id]` | One machine |
| `GET`·`POST` | `/api/machines/[id]/queue` | Machine queue |
| `PATCH`·`DELETE` | `/api/machines/[id]/queue/[itemId]` | Queue item |
| `GET` | `/api/machines/[id]/display` | Wall display payload |
| `GET` | `/api/machines/display-all` | All machines, for the rotating display |
| `GET` | `/api/machines/analytics` | Utilisation |
| `GET`·`POST` | `/api/printing-units` | Units |
| `GET`·`PATCH`·`DELETE` | `/api/printing-units/[id]` | One unit |

### Reporting and system

| Method | Route | Notes |
|---|---|---|
| `GET` | `/api/analytics?month=YYYY-MM` | On-time rate + dashboard counts |
| `GET` | `/api/notes/feed?since=&limit=` | Global note feed + unread count |
| `GET` | `/api/export` | CSV of jobs, releases and runs |
| `PATCH` | `/api/dispatch-schedules/[id]` | Update a planned release |
| `GET` | `/api/cron/overdue-check` | Cron only — requires `x-cron-secret` |
| `POST` | `/api/notifications/email` | Resend — **currently unauthenticated** |
| `POST` | `/api/notifications/whatsapp` | WATI — **currently unauthenticated** |

---

## Getting started

### Prerequisites

- Node.js 18.17 or later
- pnpm (the repo pins `pnpm@11.7.0`)
- A Supabase project — region `ap-south-1` (Mumbai) is closest to the plant

### 1. Install

```bash
git clone https://github.com/mrpal5a/novelty-job-Tracker.git
cd novelty-job-Tracker
pnpm install
```

### 2. Database

In the Supabase dashboard → **SQL Editor**, run every file in
`supabase/migrations/` **in numerical order**, `001` through `017`. Run them one
at a time and confirm each succeeds before the next.

Verify afterwards that Table Editor shows `jobs`, `label_stock`, `machines`,
`printing_units` and the rest, and that Database → Views shows
`client_job_view` and `client_status_log_view`.

### 3. Create department users

**Authentication → Users → Add user**, then set **Raw User Meta Data** on each:

```json
{ "department": "Prepress", "display_name": "Prepress Team" }
```

Create one per department: `Prepress`, `QC`, `Production`, `Postpress`,
`Dispatch`, `Admin`. The `department` value must match exactly — it is the
access-control claim, and a typo silently locks the account out of every stage.

### 4. Environment

```bash
cp .env.local.example .env.local
```

Fill in the values described in [Environment variables](#environment-variables).

### 5. Run

```bash
pnpm dev        # http://localhost:3000
pnpm build      # production build
pnpm start      # serve the production build
pnpm lint       # ESLint
```

### 6. Verify

1. `/login` with the Admin account → redirects to `/admin`
2. Add a job — confirm a job card number is allocated
3. Change its stage — the modal fires for On Hold, QC and Dispatch stages
4. `/track` → enter the PO → the customer pipeline appears
5. Sign in as each department and confirm stages they don't own are locked

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public anon key (RLS applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | **Server only.** Bypasses RLS — never expose to the browser |
| `NEXT_PUBLIC_APP_URL` | Yes | Public base URL, used in outbound links |
| `CRON_SECRET` | Yes | Shared secret for `/api/cron/*`. Generate with `openssl rand -hex 32` |
| `RESEND_API_KEY` | For email | Resend API key |
| `RESEND_FROM_EMAIL` | For email | Verified sending address |
| `WATI_API_ENDPOINT` | For WhatsApp | WATI instance endpoint |
| `WATI_API_TOKEN` | For WhatsApp | WATI API token |
| `ADMIN_WHATSAPP_NUMBER` | For alerts | Recipient of the daily overdue alert |

`.env.local` is gitignored and must never be committed.

---

## Deployment

Deployed on **Vercel**. Pushing to `main` triggers a production deploy.

1. Import the repository into Vercel — Next.js is auto-detected
2. Add every variable from the table above under
   **Settings → Environment Variables**
3. Set `NEXT_PUBLIC_APP_URL` to the deployed URL after the first deploy, then
   redeploy
4. Confirm the cron is registered — `vercel.json` declares:

```json
{ "crons": [ { "path": "/api/cron/overdue-check", "schedule": "30 3 * * *" } ] }
```

`30 3 * * *` is UTC — 9:00 AM IST.

**Database migrations are not automatic.** A deploy ships code only. Any new
migration must be run against the production Supabase project *before* the code
that depends on it goes live, or the affected routes will fail.

---

## Design system

Two documents at the repo root are normative for any UI work:

- **`PRODUCT.md`** — who this is for and the five design principles: status is
  the product; premium means precision; one vocabulary, two audiences; fast on
  the floor; states are designed.
- **`DESIGN.md`** — the visual system. North Star "The Control Room": dark glass
  panels over a Press Green mesh, DM Sans / DM Mono, translucent status chips,
  translucency-first elevation. The frontmatter tokens are normative.

Non-negotiables: WCAG AA contrast, 44px minimum tap targets, and a
`prefers-reduced-motion` alternative for every animation. No generic
admin-template patterns, no consumer-app flashiness.

---

## Security notes

- **Route handlers are the security boundary.** UI affordances are hints;
  every permission is re-checked server-side against the caller's department.
- **The service-role key bypasses RLS.** It is used only after identity and
  department have been verified in the handler, and must never reach the client.
- **The public portal reads from views**, not from `jobs`, so internal notes,
  machine assignments and other customers' data cannot leak into `/track`.
- **`/api/notifications/email` and `/api/notifications/whatsapp` currently have
  no authentication.** Any caller who can reach them can trigger a real email or
  WhatsApp message. They work for internal use, but need a department check or a
  shared secret before this deployment is treated as internet-facing. Known gap,
  not yet fixed.
- **Supabase Realtime is not used.** Live views poll instead (2s on the room
  displays, 25s on the notes feed) because enabling Realtime would require an
  RLS change that has not been reviewed.

---

## Known limitations

- **No hard delete for label stock.** `/api/stock/[id]` supports only marking a
  row dispatched; rows remain visible under the history view. Removing one
  entirely requires a direct database operation.
- **The notes feed's "last seen" marker is per-browser** (localStorage), so the
  unread badge does not follow a user across devices.
- **Printing method on legacy jobs.** Jobs created before the method became
  unit-derived may carry a method that contradicts their unit. The job detail
  page flags these; reassigning the unit corrects the record.
- **`SETUP.md` is historical** and describes an earlier state of the project.
  This README supersedes it.
- **No automated test suite.** Verification is manual, backed by TypeScript and
  ESLint through the production build.

---

## License

Private and proprietary. © Novelty Labels.
