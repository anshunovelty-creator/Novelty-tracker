# Novelty Labels Tracker — Setup Checklist
Complete this in order. Each step is a hard dependency on the previous.

---

## Step 1: Supabase Project

1. Go to https://supabase.com → New Project
   - Name: `novelty-labels-tracker`
   - Region: `ap-south-1` (Mumbai — closest to Ankleshwar)
   - Database password: generate a strong one, save it

2. Once project is ready → **SQL Editor → New Query**
   Paste and run the entire contents of:
   `supabase/migrations/001_initial_schema.sql`

3. Verify tables were created:
   - Go to Table Editor — you should see:
     `jobs`, `job_stage_timestamps`, `job_status_logs`, `stage_comments`,
     `dispatch_schedules`, `on_time_dispatch_log`
   - Go to Database → Views — you should see:
     `client_job_view`, `client_status_log_view`

4. Copy your keys from **Settings → API**:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role secret` key → `SUPABASE_SERVICE_ROLE_KEY`

---

## Step 2: Create Department Users

Go to **Authentication → Users → Invite user** (or Add user):

| Email                            | Password      | User Metadata (raw JSON)                                     |
|----------------------------------|---------------|--------------------------------------------------------------|
| prepress@noveltylabels.com       | [strong pwd]  | `{"department":"Prepress","display_name":"Prepress Team"}`   |
| qc@noveltylabels.com             | [strong pwd]  | `{"department":"QC","display_name":"QC Team"}`               |
| production@noveltylabels.com     | [strong pwd]  | `{"department":"Production","display_name":"Production Team"}`|
| dispatch@noveltylabels.com       | [strong pwd]  | `{"department":"Dispatch","display_name":"Dispatch Team"}`   |
| admin@noveltylabels.com          | [strong pwd]  | `{"department":"Admin","display_name":"Admin"}`              |

To set metadata after creating a user:
- Click the user → Edit → Raw User Meta Data → paste the JSON above

---

## Step 3: Local Development Setup

```bash
# 1. Install pnpm if you don't have it
npm install -g pnpm

# 2. Scaffold the Next.js project
# (if starting fresh — skip if you're using this codebase directly)
pnpm create next-app@14.2.29 novelty-labels-tracker \
  --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"

cd novelty-labels-tracker

# 3. Install dependencies
pnpm install

# 4. Copy env file
cp .env.local.example .env.local
# Then edit .env.local and fill in your Supabase keys

# 5. Run dev server
pnpm dev
# → http://localhost:3000
```

---

## Step 4: Test Locally

1. Visit http://localhost:3000/login
   - Login with admin@noveltylabels.com
   - Should redirect to /admin

2. Add a test job via the Add Job form

3. Change its status via the dropdown — modal should fire for On Hold / QC / Dispatch stages

4. Visit http://localhost:3000/track
   - Enter the PO number you just created
   - Should show the stage pipeline

5. Test each department login — verify 🔒 lock appears on stages they can't touch

---

## Step 5: Deploy to Vercel

```bash
# Install Vercel CLI
pnpm add -g vercel

# Deploy
vercel

# Follow prompts — link to your Vercel account + project
# When asked for framework: Next.js (auto-detected)
```

Then in **Vercel Dashboard → Project → Settings → Environment Variables**, add all vars from `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL` = `https://your-vercel-url.vercel.app` (update after first deploy)
- `RESEND_API_KEY` (when ready)
- `WATI_API_ENDPOINT` + `WATI_API_TOKEN` (when ready)
- `CRON_SECRET` (generate with `openssl rand -hex 32`)
- `ADMIN_WHATSAPP_NUMBER`

Redeploy after adding env vars:
```bash
vercel --prod
```

---

## Step 6: Custom Domain

1. Buy `noveltylabels.com` (or use existing) from a registrar
2. In Vercel → Project → Settings → Domains:
   - Add `track.noveltylabels.com`
   - Follow DNS instructions (add CNAME record at your registrar)
3. Update `NEXT_PUBLIC_APP_URL=https://track.noveltylabels.com` in Vercel env vars

---

## Step 7: Resend Email Setup (when ready)

1. Create account at https://resend.com
2. Verify your sending domain (add DNS records at registrar)
3. Create API key → add to Vercel env vars
4. Add a `party_contacts` table (or manually map party names → emails in `src/app/api/notifications/email/route.ts`)

---

## Step 8: WATI WhatsApp Setup (when ready)

1. Sign up at https://www.wati.io
2. Connect your WhatsApp Business number
3. Get API endpoint + token → add to Vercel env vars
4. Add phone numbers to `party_contacts` table

---

## What's Built vs What Needs Manual Config

| Feature                          | Status             | What to do                              |
|----------------------------------|--------------------|-----------------------------------------|
| Database schema                  | ✅ Complete        | Run migration SQL in Supabase           |
| Auth (5 dept logins)             | ✅ Complete        | Create users in Supabase Auth           |
| Admin panel UI                   | ✅ Complete        | Deploy and use                          |
| All 6 modals                     | ✅ Complete        | Built and wired                         |
| Client tracking portal           | ✅ Complete        | Works on /track/[PO]                    |
| Status change + audit log        | ✅ Complete        | All API routes built                    |
| Prerequisite enforcement         | ✅ Complete        | Both client-side and server-side        |
| Stage comments (internal)        | ✅ Complete        | Expandable in history panel             |
| Scheduled release orders         | ✅ Complete        | Toggle in Add Job form                  |
| Dashboard summary card           | ✅ Complete        | Live counts from DB                     |
| Delivery date inline edit        | ✅ Complete        | Pencil icon, Dispatch + Admin only      |
| On-time delivery analytics       | ✅ Complete        | Auto-recorded on Dispatch               |
| Daily overdue cron (9am IST)     | ✅ Complete        | Vercel Cron in vercel.json              |
| Email notifications (Resend)     | ✅ Route built     | Needs party_contacts table + API key    |
| WhatsApp notifications (WATI)    | ✅ Route built     | Needs party_contacts table + WATI creds |
| Job duplication button           | ⬜ Not yet built   | Next step (Step 4 in build order)       |
| party_contacts table             | ⬜ Not yet built   | Add when setting up notifications       |

---

## Known Remaining Tasks (Next Build Steps)

1. **Job Duplication** — `JobDuplicateButton.tsx` — one-click copy into Add Job form with fresh PO/dates
2. **party_contacts table** — `party_name TEXT, email TEXT, whatsapp TEXT` — wire to notification routes
3. **Framer Motion animations** — entrance animations on job rows, modal open/close
4. **`/admin/jobs/[id]/page.tsx`** — standalone job detail page (currently using expandable row)
5. **Scheduled release "Dispatch This Release" button** — in HistoryPanel, calls `/api/dispatch-schedules/[id]`
6. **Closed jobs view** — `/admin?view=closed` — filterable archived jobs table

---

## File Count Summary
- SQL migration:         1 file (001_initial_schema.sql)
- API routes:           10 files
- Page components:       6 files
- Admin UI components:  11 files (+ 6 modals in 1 barrel file)
- Track UI components:   6 files
- Lib (utils/types/constants/supabase): 9 files
- Config files:          5 files (next.config, tailwind, vercel.json, package.json, .env.example)

Total: ~48 files. Full working system.
