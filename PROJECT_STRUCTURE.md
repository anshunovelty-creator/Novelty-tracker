novelty-labels-tracker/
├── .env.local.example
├── .env.local                    ← gitignored; your real keys
├── .gitignore
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── vercel.json                   ← cron job config
├── package.json
│
└── src/
    │
    ├── app/                      ← Next.js App Router root
    │   │
    │   ├── layout.tsx            ← Root layout: fonts, Toaster, global CSS
    │   ├── page.tsx              ← Redirect → /admin or /track depending on auth
    │   ├── globals.css           ← Tailwind directives + CSS variables
    │   │
    │   ├── (auth)/               ← Route group: no shared layout needed
    │   │   └── login/
    │   │       └── page.tsx      ← Department login page
    │   │
    │   ├── admin/                ← Protected: all 5 departments + admin
    │   │   ├── layout.tsx        ← Admin shell: sidebar/header, auth guard
    │   │   ├── page.tsx          ← Dashboard (summary cards + active jobs table)
    │   │   └── jobs/
    │   │       └── [id]/
    │   │           └── page.tsx  ← Individual job detail (history panel, comments)
    │   │
    │   ├── track/                ← Public: client tracking portal
    │   │   ├── layout.tsx        ← Minimal branded layout (no auth required)
    │   │   ├── page.tsx          ← PO number search form
    │   │   └── [po]/
    │   │       └── page.tsx      ← Job detail view for client
    │   │
    │   └── api/                  ← API Route Handlers (server-side only)
    │       ├── jobs/
    │       │   ├── route.ts              ← GET (list) + POST (create job)
    │       │   └── [id]/
    │       │       ├── route.ts          ← GET (single) + PATCH (update) + DELETE
    │       │       ├── status/
    │       │       │   └── route.ts      ← POST: update status + write logs + send notifications
    │       │       ├── comments/
    │       │       │   └── route.ts      ← GET + POST stage comments
    │       │       └── dispatch/
    │       │           └── route.ts      ← POST: partial/full dispatch logic
    │       │
    │       ├── dispatch-schedules/
    │       │   └── [id]/
    │       │       └── route.ts          ← PATCH: mark a scheduled release as dispatched
    │       │
    │       ├── analytics/
    │       │   └── route.ts              ← GET: on-time delivery rate (monthly)
    │       │
    │       ├── notifications/
    │       │   ├── email/
    │       │   │   └── route.ts          ← POST: send email via Resend
    │       │   └── whatsapp/
    │       │       └── route.ts          ← POST: send WhatsApp via WATI/Twilio
    │       │
    │       └── cron/
    │           └── overdue-check/
    │               └── route.ts          ← GET: Vercel Cron daily overdue alert
    │
    ├── components/
    │   │
    │   ├── ui/                   ← Headless + base components
    │   │   ├── Button.tsx
    │   │   ├── Badge.tsx
    │   │   ├── Modal.tsx         ← Base modal wrapper (bottom sheet mobile / dialog desktop)
    │   │   ├── Select.tsx
    │   │   ├── Input.tsx
    │   │   ├── Textarea.tsx
    │   │   ├── Switch.tsx
    │   │   └── Tooltip.tsx
    │   │
    │   ├── admin/                ← Admin panel components
    │   │   ├── DashboardSummaryCard.tsx
    │   │   ├── JobsTable.tsx
    │   │   ├── JobRow.tsx
    │   │   ├── StatusDropdown.tsx
    │   │   ├── AddJobForm.tsx
    │   │   ├── JobDuplicateButton.tsx
    │   │   ├── DeliveryDateEdit.tsx
    │   │   ├── HistoryPanel.tsx
    │   │   ├── StageComments.tsx
    │   │   ├── ScheduledReleaseTable.tsx
    │   │   ├── FilterBar.tsx
    │   │   └── modals/
    │   │       ├── SequentialWarningModal.tsx
    │   │       ├── OnHoldModal.tsx
    │   │       ├── QCModal.tsx
    │   │       ├── PartialDispatchModal.tsx
    │   │       ├── FullDispatchModal.tsx
    │   │       └── ClosePOModal.tsx
    │   │
    │   └── track/                ← Client tracking portal components
    │       ├── POSearchForm.tsx
    │       ├── JobCard.tsx
    │       ├── StagePipeline.tsx
    │       ├── DeliveryCountdown.tsx
    │       ├── DispatchSummaryCard.tsx
    │       ├── ScheduledReleaseCard.tsx
    │       ├── StatusBanners.tsx
    │       └── ProgressBar.tsx
    │
    ├── lib/
    │   ├── supabase/
    │   │   ├── client.ts         ← Browser Supabase client (singleton)
    │   │   ├── server.ts         ← Server Supabase client (cookies-based, for RSC + API routes)
    │   │   └── admin.ts          ← Service role client (server only, bypass RLS)
    │   │
    │   ├── constants/
    │   │   ├── stages.ts         ← All 15 stages, pipeline order, prerequisite map, skip rules
    │   │   ├── departments.ts    ← Dept → allowed stages map, display names
    │   │   └── statusColors.ts   ← Status → badge color map
    │   │
    │   ├── notifications/
    │   │   ├── email.ts          ← Resend send functions per trigger
    │   │   └── whatsapp.ts       ← WATI/Twilio send functions per trigger
    │   │
    │   ├── analytics.ts          ← On-time delivery rate calculation
    │   ├── utils.ts              ← cn(), formatDate(), formatQty(), etc.
    │   └── types.ts              ← All TypeScript interfaces matching DB schema
    │
    └── middleware.ts             ← Auth guard: redirect unauthenticated → /login
                                     Bypass for /track/* (public)
