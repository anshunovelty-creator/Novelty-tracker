# Premium Glass-Mesh Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-theme the entire Novelty Labels tracker with a premium glass + gradient-mesh look — animated deep-green mesh background, frosted-glass panels, floating-label/glow/lift fields, cycling-text action loaders, and content skeletons — while keeping all text WCAG-AA readable and changing zero business logic.

**Architecture:** Build reusable primitives first (theme tokens, `<GradientMesh>`, `<Field>`, `<LoadingButton>`/`<CyclingText>`, `<Skeleton>`), then apply them surface-by-surface (login → track → admin). The mesh is the page background per layout; all content sits in `.glass` frosted panels with light text and brightened status chips.

**Tech Stack:** Next.js 14 (App Router), React 18, Tailwind CSS 3, GSAP (existing reveals kept), TypeScript.

**Verification note:** This repo has no test runner and the work is visual/CSS. Each task verifies with `npx tsc --noEmit` + `npm run lint` (fast, per task) and `npm run build` + manual browser check at phase boundaries. No unit tests are added.

**Branch:** `feat/premium-glass-redesign` (already created). All paths are relative to the project root `novelty-job-Tracker/`.

---

## Phase A — Foundation (tokens)

### Task 1: Glass + mesh theme tokens

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add dark-glass text colors to Tailwind brand palette**

In `tailwind.config.ts`, inside `colors.brand`, add three keys (after `pending`):

```ts
          pending:         '#94A39B',
          // dark-glass theme (light text on the mesh):
          'glass-ink':     '#EAFFF5', // primary text on glass (AA on mesh)
          'glass-muted':   '#9FBCB0', // secondary text on glass (AA on mesh)
          'glass-line':    'rgba(255,255,255,0.14)',
```

- [ ] **Step 2: Add glass + mesh utilities and keyframes to globals.css**

Append to `src/app/globals.css`:

```css
/* ── Premium glass-mesh theme ───────────────────────────────── */
:root {
  --glass-bg:         rgba(255, 255, 255, 0.07);
  --glass-bg-strong:  rgba(255, 255, 255, 0.12);
  --glass-border:     rgba(255, 255, 255, 0.14);
  --glass-ink:        #EAFFF5;
  --glass-muted:      #9FBCB0;
}

/* Frosted panel surface */
.glass {
  background: var(--glass-bg);
  border: 1px solid var(--glass-border);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}
.glass-strong { background: var(--glass-bg-strong); }

/* Deep-green gradient-mesh page background */
.mesh-bg {
  background:
    radial-gradient(55% 55% at 10% 12%,  rgba(46,200,140,.55), transparent 60%),
    radial-gradient(50% 50% at 92% 18%,  rgba(20,120,90,.60),  transparent 60%),
    radial-gradient(70% 70% at 78% 105%, rgba(12,66,50,.90),   transparent 60%),
    linear-gradient(135deg, #0F4A37, #0A1F18);
}

/* Drifting mesh blobs (layered over .mesh-bg) */
@keyframes mesh-drift {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50%      { transform: translate(20px, -16px) scale(1.12); }
}
.mesh-blob { animation: mesh-drift 13s ease-in-out infinite; }

/* Shimmer for skeleton loaders */
@keyframes shimmer {
  0%   { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}
.skeleton {
  background: linear-gradient(90deg,
    rgba(255,255,255,.07) 25%, rgba(255,255,255,.20) 37%, rgba(255,255,255,.07) 63%);
  background-size: 400% 100%;
  animation: shimmer 1.4s ease infinite;
  border-radius: 8px;
}

/* Cycling-status fade */
@keyframes cyc-fade {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
.cyc-fade { animation: cyc-fade .3s ease; }

@media (prefers-reduced-motion: reduce) {
  .skeleton  { animation: none; background: rgba(255,255,255,.12); }
  .mesh-blob { animation: none; }
  .cyc-fade  { animation: none; }
}
```

- [ ] **Step 3: Verify + commit**

```bash
cd "novelty-job-Tracker" && npx tsc --noEmit && npm run lint
git add tailwind.config.ts src/app/globals.css
git commit -m "feat(theme): glass-mesh tokens, utilities, keyframes"
```
Expected: tsc + lint pass.

---

### Task 2: Brightened status-chip + badge tokens for dark glass

**Files:**
- Modify: `src/lib/constants/statusColors.ts`

The current chips (`bg-*-100 text-*-700`) are light-on-light and vanish on the dark mesh. Replace with translucent bright-on-dark variants and add reusable job-type / urgent badge maps so components stop hand-rolling color ternaries.

- [ ] **Step 1: Replace `STATUS_COLORS` values with dark-glass variants**

In `src/lib/constants/statusColors.ts`, replace the `STATUS_COLORS` map body with:

```ts
export const STATUS_COLORS: Record<Stage, ColorConfig> = {
  'PO Received':             { bg: 'bg-white/10',     text: 'text-white/80' },
  'Artwork Received':        { bg: 'bg-purple-400/15', text: 'text-purple-200' },
  'Prepress / Design Check': { bg: 'bg-sky-400/15',    text: 'text-sky-200' },
  'Sample Printing':         { bg: 'bg-amber-400/15',  text: 'text-amber-200' },
  'Shade Card Sent':         { bg: 'bg-orange-400/15', text: 'text-orange-200' },
  'Shade Card Approved':     { bg: 'bg-emerald-400/15', text: 'text-emerald-200' },
  'In Printing':             { bg: 'bg-emerald-400/15', text: 'text-emerald-200' },
  'Slitting':                { bg: 'bg-sky-400/15',    text: 'text-sky-200' },
  'Quality Check':           { bg: 'bg-sky-400/18',    text: 'text-sky-200' },
  'Packing':                 { bg: 'bg-purple-400/15', text: 'text-purple-200' },
  'Ready to Dispatch':       { bg: 'bg-yellow-400/15', text: 'text-yellow-100' },
  'Partial Dispatch':        { bg: 'bg-amber-400/15',  text: 'text-amber-200' },
  'Dispatched':              { bg: 'bg-emerald-400/18', text: 'text-emerald-200' },
  'On Hold':                 { bg: 'bg-amber-400/18',  text: 'text-amber-100' },
  'PO Closed':               { bg: 'bg-emerald-400/18', text: 'text-emerald-200' },
};
```

- [ ] **Step 2: Replace `ROW_URGENCY_STYLES` with dark-glass left-border tints**

```ts
export const ROW_URGENCY_STYLES = {
  onHold:   'border-l-4 border-l-amber-400/80  bg-amber-400/[0.07]',
  urgent1:  'border-l-4 border-l-red-400/90    bg-red-400/[0.08]',
  urgent2:  'border-l-4 border-l-orange-400/80 bg-orange-400/[0.07]',
  urgent3:  'border-l-4 border-l-yellow-400/70 bg-yellow-400/[0.05]',
  qc:       'border-l-4 border-l-sky-400/80    bg-sky-400/[0.06]',
  normal:   '',
} as const;
```

- [ ] **Step 3: Add job-type + urgent badge maps (append to file)**

```ts
// Job-type badge (dark glass)
export const JOB_TYPE_BADGE: Record<'New' | 'Repeat' | 'Artwork Changed', string> = {
  'New':             'bg-sky-400/15 text-sky-200',
  'Repeat':          'bg-white/10 text-white/70',
  'Artwork Changed': 'bg-purple-400/15 text-purple-200',
};

// Urgent priority badge (dark glass) — keyed by urgent_priority (1,2,else)
export function urgentBadgeClass(priority: number | null): string {
  if (priority === 1) return 'bg-red-400/15 text-red-200';
  if (priority === 2) return 'bg-orange-400/15 text-orange-200';
  return 'bg-yellow-400/15 text-yellow-100';
}
```

- [ ] **Step 4: Verify + commit**

```bash
cd "novelty-job-Tracker" && npx tsc --noEmit && npm run lint
git add src/lib/constants/statusColors.ts
git commit -m "feat(theme): dark-glass status chip, row, and badge tokens"
```

---

## Phase B — Primitives

### Task 3: `<GradientMesh>` background component

**Files:**
- Create: `src/components/motion/GradientMesh.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client';
// src/components/motion/GradientMesh.tsx
// Deep-green gradient-mesh page background with drifting blobs.
// CSS-animated; respects prefers-reduced-motion via the .mesh-blob rule.
import { cn } from '@/lib/utils';

export function GradientMesh({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('pointer-events-none fixed inset-0 -z-10 overflow-hidden mesh-bg', className)}>
      <div
        className="mesh-blob absolute -top-32 -left-24 h-96 w-96 rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(79,165,130,.40), transparent 70%)' }}
      />
      <div
        className="mesh-blob absolute -bottom-40 -right-20 h-[28rem] w-[28rem] rounded-full blur-3xl"
        style={{ background: 'radial-gradient(circle, rgba(16,85,63,.55), transparent 70%)', animationDelay: '-6s' }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify + commit**

```bash
cd "novelty-job-Tracker" && npx tsc --noEmit && npm run lint
git add src/components/motion/GradientMesh.tsx
git commit -m "feat(ui): GradientMesh background component"
```

---

### Task 4: `<Field>` and `<SelectField>` glass inputs

**Files:**
- Create: `src/components/ui/Field.tsx`

Floating-label input (works for text/email/password/number/date), a multiline variant, and a select with an always-raised label. Lift + glow + brighten on focus; lift disabled under `motion-reduce`.

- [ ] **Step 1: Create the component file**

```tsx
'use client';
// src/components/ui/Field.tsx
import React, { useId } from 'react';
import { cn } from '@/lib/utils';

const INPUT_BASE =
  'peer w-full rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] ' +
  'px-3.5 pt-5 pb-2 text-sm text-[var(--glass-ink)] backdrop-blur-md outline-none ' +
  'placeholder:text-transparent transition-all duration-200 ' +
  'focus:-translate-y-0.5 motion-reduce:focus:translate-y-0 ' +
  'focus:border-emerald-300/70 focus:bg-white/[0.14] ' +
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22),0_10px_26px_rgba(0,0,0,0.25)]';

const LABEL_BASE =
  'pointer-events-none absolute left-3.5 top-3.5 text-sm text-white/60 transition-all duration-200 ' +
  'peer-focus:top-1.5 peer-focus:text-[10px] peer-focus:uppercase peer-focus:tracking-wide peer-focus:text-emerald-200 ' +
  'peer-[:not(:placeholder-shown)]:top-1.5 peer-[:not(:placeholder-shown)]:text-[10px] ' +
  'peer-[:not(:placeholder-shown)]:uppercase peer-[:not(:placeholder-shown)]:tracking-wide ' +
  'peer-[:not(:placeholder-shown)]:text-emerald-200';

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  multiline?: boolean;
  rows?: number;
};

export function Field({ label, multiline, rows = 3, className, id, ...rest }: FieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className="relative">
      {multiline ? (
        <textarea
          id={fieldId}
          rows={rows}
          placeholder=" "
          className={cn(INPUT_BASE, 'resize-none', className)}
          {...(rest as unknown as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
        />
      ) : (
        <input id={fieldId} placeholder=" " className={cn(INPUT_BASE, className)} {...rest} />
      )}
      <label htmlFor={fieldId} className={LABEL_BASE}>{label}</label>
    </div>
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { label: string };

export function SelectField({ label, className, id, children, ...rest }: SelectProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className="relative">
      <select
        id={fieldId}
        className={cn(
          'w-full rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] px-3.5 pt-5 pb-2 text-sm',
          'text-[var(--glass-ink)] backdrop-blur-md outline-none transition-all duration-200',
          'focus:border-emerald-300/70 focus:bg-white/[0.14] focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)]',
          '[&>option]:bg-[#0A1F18] [&>option]:text-[var(--glass-ink)]',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <label
        htmlFor={fieldId}
        className="pointer-events-none absolute left-3.5 top-1.5 text-[10px] uppercase tracking-wide text-emerald-200"
      >
        {label}
      </label>
    </div>
  );
}
```

- [ ] **Step 2: Verify + commit**

```bash
cd "novelty-job-Tracker" && npx tsc --noEmit && npm run lint
git add src/components/ui/Field.tsx
git commit -m "feat(ui): glass Field + SelectField with floating label/glow/lift"
```

---

### Task 5: `<Spinner>`, `<CyclingText>`, `<LoadingButton>`

**Files:**
- Create: `src/components/ui/Loading.tsx`

- [ ] **Step 1: Create the component file**

```tsx
'use client';
// src/components/ui/Loading.tsx
import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block h-4 w-4 flex-none rounded-full border-2 border-white/35 border-t-emerald-200 animate-spin',
        className,
      )}
    />
  );
}

/** Fades through stages every `interval` ms. Static (first stage) under reduced motion. */
export function CyclingText({
  stages,
  interval = 1800,
  className,
}: {
  stages: string[];
  interval?: number;
  className?: string;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (stages.length <= 1) return;
    if (typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const t = setInterval(() => setI((p) => (p + 1) % stages.length), interval);
    return () => clearInterval(t);
  }, [stages.length, interval]);
  return (
    <span key={i} className={cn('cyc-fade', className)}>
      {stages[i] ?? stages[0]}
    </span>
  );
}

type LoadingButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  loadingStages?: string[];
};

export function LoadingButton({
  loading = false,
  loadingStages = ['Working…'],
  children,
  className,
  disabled,
  ...rest
}: LoadingButtonProps) {
  return (
    <button
      disabled={disabled || loading}
      className={cn('inline-flex items-center justify-center gap-2', className)}
      {...rest}
    >
      {loading ? (
        <>
          <Spinner />
          <CyclingText stages={loadingStages} />
        </>
      ) : (
        children
      )}
    </button>
  );
}
```

- [ ] **Step 2: Verify + commit**

```bash
cd "novelty-job-Tracker" && npx tsc --noEmit && npm run lint
git add src/components/ui/Loading.tsx
git commit -m "feat(ui): Spinner, CyclingText, LoadingButton"
```

---

### Task 6: `<Skeleton>` components

**Files:**
- Create: `src/components/ui/Skeleton.tsx`

- [ ] **Step 1: Create the component file**

```tsx
// src/components/ui/Skeleton.tsx
import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton', className)} />;
}

/** A few shimmer lines for text blocks. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  const widths = ['w-3/5', 'w-11/12', 'w-3/4', 'w-5/6', 'w-2/3'];
  return (
    <div className={cn('space-y-2.5', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn('h-3', widths[i % widths.length])} />
      ))}
    </div>
  );
}

/** Skeleton rows for tables — render inside a tbody with the given column count. */
export function SkeletonRows({ rows = 4, cols = 8 }: { rows?: number; cols?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r}>
          {Array.from({ length: cols }).map((__, c) => (
            <td key={c} className="px-4 py-3"><Skeleton className="h-3 w-full" /></td>
          ))}
        </tr>
      ))}
    </>
  );
}
```

- [ ] **Step 2: Verify + commit**

```bash
cd "novelty-job-Tracker" && npx tsc --noEmit && npm run lint
git add src/components/ui/Skeleton.tsx
git commit -m "feat(ui): Skeleton, SkeletonText, SkeletonRows"
```

- [ ] **Step 3: Phase B build check**

```bash
cd "novelty-job-Tracker" && npm run build
```
Expected: build succeeds (primitives compile, unused-for-now is fine).

---

## Phase C — Public surfaces

### Task 7: Login page

**Files:**
- Modify: `src/app/(auth)/login/page.tsx`

- [ ] **Step 1: Swap background + fields + button**

In `LoginForm`'s returned JSX:
1. Replace `<AuroraBackground />` (line ~79) with `<GradientMesh />`. Update import: replace the `AuroraBackground` import with `import { GradientMesh } from '@/components/motion/GradientMesh';`.
2. Change the outer wrapper class from `bg-brand-bg` to `mesh-bg` is not needed (GradientMesh is fixed) — keep the centering wrapper but drop `bg-brand-bg`.
3. Wrap the card content in `.glass` styling: change the card `div` (the `ref={cardRef}` one, line ~80) class to:
   `"w-full max-w-sm relative glass rounded-2xl p-8 shadow-2xl"` (keep `style={{ opacity: 0 }}` — see Task 18 for the no-hidden-content guard).
4. Replace both `<input>` blocks (email + password) and their `<label>`s with:

```tsx
<Field label="Email" id="email" type="email" autoComplete="email" required
       value={email} onChange={(e) => setEmail(e.target.value)} />
```
```tsx
<Field label="Password" id="password" type="password" autoComplete="current-password" required
       value={password} onChange={(e) => setPassword(e.target.value)} />
```
   Add `import { Field } from '@/components/ui/Field';`. The `<Stagger>` wrapper around the two fields stays.
5. Update heading/subtext colors for dark bg: `text-brand-accent` → `text-[var(--glass-ink)]`, `text-brand-muted` → `text-[var(--glass-muted)]`.
6. Replace the submit `<button>` with `LoadingButton`:

```tsx
<LoadingButton
  type="submit"
  loading={loading}
  loadingStages={['Connecting…', 'Verifying credentials…', 'Almost there…']}
  className="w-full bg-brand-primary text-white rounded-lg py-2.5 text-sm font-medium hover:bg-brand-primary/90 transition-colors disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-300/40"
>
  Sign in
</LoadingButton>
```
   Add `import { LoadingButton } from '@/components/ui/Loading';`. Remove the now-unused `{loading ? 'Signing in…' : 'Sign in'}` text.
7. Error box: keep, but switch to glass-friendly colors: `text-red-200 bg-red-400/10 border border-red-300/30`.

- [ ] **Step 2: Verify + commit**

```bash
cd "novelty-job-Tracker" && npx tsc --noEmit && npm run lint
git add "src/app/(auth)/login/page.tsx"
git commit -m "feat(login): glass card, Field inputs, cycling sign-in button"
```

---

### Task 8: Track layout background

**Files:**
- Modify: `src/app/track/layout.tsx`

- [ ] **Step 1: Replace gradient + aurora with mesh**

1. Change the root wrapper `div` class from the `bg-gradient-to-b from-brand-header via-[#0C4232] to-[#082F24] text-green-100` to `min-h-screen text-[var(--glass-ink)]`.
2. Replace `<AuroraBackground />` (inside `<main>`) with nothing here; instead add `<GradientMesh />` as the first child of the root wrapper. Update imports accordingly (`GradientMesh` in, `AuroraBackground` out).
3. Footer text `text-green-300/70` → `text-[var(--glass-muted)]` (verify AA in Task 18).

- [ ] **Step 2: Verify + commit**

```bash
cd "novelty-job-Tracker" && npx tsc --noEmit && npm run lint
git add src/app/track/layout.tsx
git commit -m "feat(track): mesh background in track layout"
```

---

### Task 9: Track search page

**Files:**
- Modify: `src/app/track/page.tsx`

- [ ] **Step 1: Use Field for the PO input**

Replace the `<input>` (lines ~36-48) with:

```tsx
<Field label="PO Number or Job Name" value={po} onChange={(e) => setPo(e.target.value)}
       className="font-mono tracking-wide" />
```
Add `import { Field } from '@/components/ui/Field';`. Keep the `<Reveal>` wrappers, heading, and submit button (button already uses `bg-brand-primary`; leave as-is). Heading/subtext already white/green — change `text-green-200` → `text-[var(--glass-muted)]`.

- [ ] **Step 2: Verify + commit**

```bash
cd "novelty-job-Tracker" && npx tsc --noEmit && npm run lint
git add src/app/track/page.tsx
git commit -m "feat(track): glass Field on search page"
```

---

### Task 10: Track cards → glass

**Files:**
- Modify: `src/components/track/TrackJobAccordion.tsx`
- Modify: `src/components/track/StagePipeline.tsx`
- Modify: `src/components/track/StatusBanners.tsx`
- Modify: `src/components/track/DispatchSummaryCard.tsx`
- Modify: `src/components/track/ScheduledReleaseCard.tsx`
- Modify: `src/components/track/ProgressBar.tsx`

The track components currently use `bg-white border-brand-border` cards with `text-brand-accent`/`text-brand-muted`. On the mesh these must become glass with light text.

- [ ] **Step 1: Card surfaces → glass (find/replace per file)**

Apply these substitutions in each listed file (Tailwind class swaps; do not change structure/logic):
- `bg-white border border-brand-border` → `glass`
- standalone `bg-white` panels → `glass`
- `text-brand-accent` → `text-[var(--glass-ink)]`
- `text-brand-muted` → `text-[var(--glass-muted)]`
- `border-brand-border` (dividers) → `border-white/10`
- `bg-brand-bg` chips/rows → `bg-white/10`
- emerald/amber/sky `*-700` text used on former white cards → corresponding `*-200`/`*-100` (e.g. `text-emerald-700` → `text-emerald-200`, `text-amber-700` → `text-amber-200`, `text-sky-700` → `text-sky-200`)
- inline-styled white card shadows `shadow-[0_1px_0_rgba(0,0,0,0.02)]` → `shadow-[0_8px_30px_rgba(0,0,0,0.18)]`

In `TrackJobAccordion.tsx` specifically: the accordion `<article>` `bg-white` → `glass`; the open/closed border classes use `border-brand-accent/30` → `border-emerald-300/30` and `border-brand-border` → `border-white/12`; the header hover `hover:bg-brand-bg/20` → `hover:bg-white/[0.06]`; the `StatusPill` `bg-brand-bg border-brand-border text-brand-accent` → `bg-white/10 border-white/15 text-[var(--glass-ink)]`. The `<a href="/track">` "Search again" links `text-green-200` → `text-[var(--glass-muted)] hover:text-white`.

In `StatusBanners.tsx`: the `Banner` `styles` map — keep semantic hues but shift to glass: e.g. `green: 'bg-emerald-400/12 border-emerald-300/25 text-emerald-100'`, `amber: 'bg-amber-400/12 border-amber-300/25 text-amber-100'`, `blue: 'bg-sky-400/12 border-sky-300/25 text-sky-100'`, `red: 'bg-red-400/12 border-red-300/25 text-red-100'`.

In `ProgressBar.tsx`: the `trackColor` map values (`bg-brand-bg`, `bg-amber-100`, `bg-sky-100`) → `bg-white/10`, `bg-amber-400/15`, `bg-sky-400/15`; fill colors stay vivid (`bg-brand-primary` → `bg-emerald-400`, keep amber/sky 500). Label text `text-brand-muted` → `text-[var(--glass-muted)]`.

- [ ] **Step 2: Verify + commit**

```bash
cd "novelty-job-Tracker" && npx tsc --noEmit && npm run lint
git add src/components/track/
git commit -m "feat(track): glass surfaces + light text across track components"
```

- [ ] **Step 3: Phase C build + manual check**

```bash
cd "novelty-job-Tracker" && npm run build
```
Then `npm run dev`, visit `/login` and `/track` (+ a real PO) and confirm mesh + glass + readable text. (Manual.)

---

## Phase D — Admin surfaces

### Task 11: Admin layout + header

**Files:**
- Modify: `src/app/admin/layout.tsx`
- Modify: `src/components/admin/AdminHeader.tsx`

- [ ] **Step 1: Mesh page background**

In `admin/layout.tsx`: change the root `div` `min-h-screen bg-brand-bg` → `min-h-screen text-[var(--glass-ink)]`, and add `<GradientMesh />` as its first child (import it). In `AdminHeader.tsx`: the header bar already uses `bg-brand-header` — keep it (it reads as a solid deep-green bar over the mesh). Change `text-white/60`→`text-white/75` and `text-white/50`→`text-white/70` for the dept label + sign-out to ensure AA.

- [ ] **Step 2: Verify + commit**

```bash
cd "novelty-job-Tracker" && npx tsc --noEmit && npm run lint
git add src/app/admin/layout.tsx src/components/admin/AdminHeader.tsx
git commit -m "feat(admin): mesh background + header contrast"
```

---

### Task 12: Dashboard summary cards → glass

**Files:**
- Modify: `src/components/admin/DashboardSummaryCard.tsx`

- [ ] **Step 1: Glass stat cards**

Card `div` class `bg-white rounded-xl border border-brand-border px-4 py-4` → `glass rounded-xl px-4 py-4`. Label `text-brand-muted` → `text-[var(--glass-muted)]`. Value colors: `text-brand-accent` → `text-[var(--glass-ink)]`; `text-amber-600` → `text-amber-200`; `text-blue-600` → `text-sky-200`; `text-green-600` → `text-emerald-200`. Sub text `text-brand-muted` → `text-[var(--glass-muted)]`.

- [ ] **Step 2: Verify + commit**

```bash
cd "novelty-job-Tracker" && npx tsc --noEmit && npm run lint
git add src/components/admin/DashboardSummaryCard.tsx
git commit -m "feat(admin): glass dashboard summary cards"
```

---

### Task 13: FilterBar + AddJobForm

**Files:**
- Modify: `src/components/admin/FilterBar.tsx`
- Modify: `src/components/admin/AddJobForm.tsx`

- [ ] **Step 1: FilterBar → glass Field/SelectField**

Replace the search `<input>` with `<Field label="Search" type="search" value={search} onChange={(e) => onSearchChange(e.target.value)} />` and the status `<select>` with `<SelectField label="Status" value={statusFilter} onChange={(e) => onStatusFilterChange(e.target.value)}>` keeping its `<option>`s. The urgent toggle button: active `bg-red-50 border-red-200 text-red-700` → `bg-red-400/15 border-red-300/30 text-red-200`; inactive `bg-white border-brand-border text-brand-muted` → `glass text-[var(--glass-muted)] hover:text-[var(--glass-ink)]`. Imports: `Field`, `SelectField` from `@/components/ui/Field`.

- [ ] **Step 2: AddJobForm → glass panel, Fields, cycling submit**

1. The form container `bg-white border border-brand-border rounded-xl p-6 mb-4` → `glass rounded-xl p-6 mb-4`.
2. Replace the shared `inputCls` constant value with the glass input style (so the existing `Field` helper rows that use raw inputs match). Simplest: swap each raw `<input>/<select>/<textarea>` that uses `inputCls` for the new `<Field>`/`<SelectField>` and drop the local `Field` helper + `inputCls`. Where keeping `inputCls` is easier (PM typeahead input needs the relative wrapper), set:
```ts
const inputCls = cn(
  'w-full px-3.5 py-2.5 rounded-xl text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)] backdrop-blur-md',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);
```
   Update the local `Field` helper label `text-brand-muted` → `text-[var(--glass-muted)]`.
3. Headings `text-brand-accent` → `text-[var(--glass-ink)]`; "Cancel" links `text-brand-muted hover:text-brand-accent` → `text-[var(--glass-muted)] hover:text-[var(--glass-ink)]`.
4. PM suggestions dropdown: `bg-white border-brand-border` → `glass-strong glass`; items `hover:bg-brand-bg` → `hover:bg-white/[0.08]`; text colors to glass-ink/glass-muted.
5. Replace the submit `<button>` (`{loading ? 'Adding…' : 'Add Job'}`) with:
```tsx
<LoadingButton type="submit" loading={loading}
  loadingStages={['Saving job…', 'Creating timeline…', 'Almost done…']}
  className="px-5 py-2 rounded-lg text-sm font-medium bg-brand-primary text-white hover:bg-brand-primary/90 transition-colors disabled:opacity-50">
  Add Job
</LoadingButton>
```
   Import `LoadingButton`.

- [ ] **Step 3: Verify + commit**

```bash
cd "novelty-job-Tracker" && npx tsc --noEmit && npm run lint
git add src/components/admin/FilterBar.tsx src/components/admin/AddJobForm.tsx
git commit -m "feat(admin): glass FilterBar + AddJobForm with Fields and cycling submit"
```

---

### Task 14: JobsTable + JobRow → glass + chips + skeleton

**Files:**
- Modify: `src/components/admin/JobsTable.tsx`
- Modify: `src/components/admin/JobRow.tsx`

- [ ] **Step 1: JobsTable shell → glass + skeleton first-paint**

1. Table wrapper `bg-white` → `glass` (keep `table-scroll-wrapper rounded-xl ... overflow-hidden`).
2. Header row `border-b border-brand-border` → `border-b border-white/12`; `th` text `text-brand-muted` → `text-[var(--glass-muted)]`.
3. Heading "Active Jobs" `text-brand-accent` → `text-[var(--glass-ink)]`, count `text-brand-muted` → `text-[var(--glass-muted)]`.
4. Empty-state cell `text-brand-muted` → `text-[var(--glass-muted)]`.
5. Loading: when `loading && jobs.length === 0`, render `<SkeletonRows rows={5} cols={8} />` in the tbody instead of the empty row. Import `SkeletonRows` from `@/components/ui/Skeleton`. Keep the existing thin top progress bar.

- [ ] **Step 2: JobRow → glass row text, chips, badges**

1. `rowClass`: base `border-b border-brand-border` → `border-b border-white/8`.
2. PO/PM text `text-brand-accent`→`text-[var(--glass-ink)]`, `text-brand-muted`→`text-[var(--glass-muted)]`.
3. Urgent pill: replace the inline color ternary with `urgentBadgeClass(job.urgent_priority)` from `@/lib/constants/statusColors`.
4. Party/job/notes text → glass-ink/glass-muted; `has_partial_runs` badge `bg-purple-100 text-purple-700` → `bg-purple-400/15 text-purple-200`; halt remark `text-amber-700 bg-amber-50` → `text-amber-200 bg-amber-400/10`.
5. Dispatch progress track `bg-brand-bg` → `bg-white/10` (fill `bg-green-500` → `bg-emerald-400`).
6. Job-type badge: replace ternary with `JOB_TYPE_BADGE[job.job_type]`.
7. Status `<select>`: the trigger keeps `STATUS_COLORS[...]` (now dark-glass). Add `[&>option]:bg-[#0A1F18] [&>option]:text-[var(--glass-ink)]` to its className so the native dropdown options are readable.
8. Action buttons: `text-brand-muted hover:text-brand-accent border-brand-border` → `text-[var(--glass-muted)] hover:text-[var(--glass-ink)] border-white/15`. Expanded panel `<td>` `bg-brand-bg` → `bg-black/15`.

- [ ] **Step 3: Verify + commit**

```bash
cd "novelty-job-Tracker" && npx tsc --noEmit && npm run lint
git add src/components/admin/JobsTable.tsx src/components/admin/JobRow.tsx
git commit -m "feat(admin): glass jobs table + skeleton rows + token chips/badges"
```

---

### Task 15: JobDetailClient → glass

**Files:**
- Modify: `src/components/admin/JobDetailClient.tsx`

- [ ] **Step 1: Glass detail surfaces**

Cards `rounded-xl border border-brand-border bg-white` → `glass rounded-xl`. Back link + all `text-brand-accent`/`text-brand-muted` → glass-ink/glass-muted. Job-type badge → `JOB_TYPE_BADGE[job.job_type]`; urgent pill → `urgentBadgeClass(job.urgent_priority)`. Dispatch track `bg-brand-bg`→`bg-white/10`, fill `bg-green-500`→`bg-emerald-400`. Status `<select>` gets the same `[&>option]:bg-[#0A1F18] [&>option]:text-[var(--glass-ink)]` addition. Notes divider `border-brand-border`→`border-white/10`. Halt/QC remark boxes → glass-friendly (`text-amber-200 bg-amber-400/10 border-amber-300/25`, `text-sky-200 bg-sky-400/10 border-sky-300/25`). `InfoField` label `text-brand-muted` → `text-[var(--glass-muted)]`.

- [ ] **Step 2: Verify + commit**

```bash
cd "novelty-job-Tracker" && npx tsc --noEmit && npm run lint
git add src/components/admin/JobDetailClient.tsx
git commit -m "feat(admin): glass job detail view"
```

---

### Task 16: HistoryPanel + StageComments → glass + skeleton

**Files:**
- Modify: `src/components/admin/HistoryPanel.tsx`
- Modify: `src/components/admin/StageComments.tsx`

- [ ] **Step 1: Glass + skeleton**

1. Loading state (lines ~47-53): replace the "Loading history…" block with `<SkeletonText lines={6} className="py-6" />` (import `SkeletonText`).
2. Section headings `text-brand-muted` → `text-[var(--glass-muted)]`; stage names `text-brand-accent`→`text-[var(--glass-ink)]`; dividers `border-brand-border/50`→`border-white/8`.
3. Status dots: `bg-green-500` stays; `bg-brand-border` → `bg-white/20`.
4. Comment chips `bg-brand-bg` → `bg-white/[0.06]`; remark texts to `*-200` variants.
5. Print-run cards `border-brand-border bg-white` → `glass`; `border-green-200 bg-green-50/50` → `border-emerald-300/25 bg-emerald-400/10`; totals box `bg-brand-bg border-brand-border` → `bg-white/[0.06] border-white/10`. Buttons → glass-friendly hovers. The release table `<table>` header `bg-brand-bg`→`bg-white/[0.06]`, borders → `border-white/10`, status chips → `*-400/15`/`*-200`.
6. `StageComments.tsx`: textarea → glass input style (reuse the `inputCls` pattern from Task 13 or wrap with `Field multiline`); buttons keep `bg-brand-primary`; "Add note" trigger `text-brand-muted` → `text-[var(--glass-muted)]`.

Note: `window.prompt`/`alert` in the release dispatch flow stay as-is (out of scope — flagged separately in the earlier review).

- [ ] **Step 2: Verify + commit**

```bash
cd "novelty-job-Tracker" && npx tsc --noEmit && npm run lint
git add src/components/admin/HistoryPanel.tsx src/components/admin/StageComments.tsx
git commit -m "feat(admin): glass history panel + skeleton + glass comments"
```

---

### Task 17: Modals → glass + Fields + cycling

**Files:**
- Modify: `src/components/admin/modals/index.tsx`

- [ ] **Step 1: Glass modal panel + dark inputs**

1. `ModalBackdrop`: panel `<div>` `bg-white shadow-2xl` → `glass-strong glass shadow-2xl` and add `text-[var(--glass-ink)]`. (The `.modal-panel` CSS in globals.css handles position/size — unchanged.)
2. In every modal: headings `text-brand-accent` → `text-[var(--glass-ink)]`; body `text-brand-muted` → `text-[var(--glass-muted)]`; info boxes (`bg-amber-50 border-amber-200 text-amber-700` etc.) → glass variants (`bg-amber-400/10 border-amber-300/25 text-amber-100`, sky → `sky-*`).
3. All `<textarea>`/`<input>` in modals: replace their inline class with the glass input class (reuse the Task 13 `inputCls` string, or use `<Field multiline .../>`). Keep validation logic untouched.
4. Cancel buttons `text-brand-muted hover:text-brand-accent` → `text-[var(--glass-muted)] hover:text-[var(--glass-ink)]`. Primary action buttons keep their vivid fills (amber-500/green-600/sky-600/brand-primary) — they read fine on glass.
5. `ClosePOModal` job-summary box `bg-brand-bg` → `bg-white/[0.06]`, divider `border-brand-border` → `border-white/10`, value colors to glass-ink/`*-200`.

- [ ] **Step 2: Verify + commit**

```bash
cd "novelty-job-Tracker" && npx tsc --noEmit && npm run lint
git add src/components/admin/modals/index.tsx
git commit -m "feat(admin): glass modals with dark inputs"
```

- [ ] **Step 3: Phase D build + manual check**

```bash
cd "novelty-job-Tracker" && npm run build
```
Then `npm run dev`, log into `/admin`, and confirm dashboard, table, a job detail, history expand, and each modal read clearly on the mesh.

---

## Phase E — Polish & verification

### Task 18: Readability, reduced-motion, and no-hidden-content guards

**Files:**
- Modify: `src/app/(auth)/login/page.tsx`
- Modify: `src/components/motion/Reveal.tsx`
- Modify: any surface flagged below

- [ ] **Step 1: No content stuck at opacity:0**

`Reveal.tsx` and the login card ship `style={{ opacity: 0 }}` and rely on GSAP. Add a CSS safety net so content is visible if JS/animation doesn't run. In `globals.css` append:
```css
@media (prefers-reduced-motion: reduce) {
  [data-reveal] { opacity: 1 !important; transform: none !important; }
}
```
In `Reveal.tsx`, add `data-reveal` to the wrapper div. In the `reduce` matchMedia branch (already present) it sets opacity:1 — keep. As a JS-disabled fallback, also ensure the reduce media rule above forces visibility.

- [ ] **Step 2: Contrast audit (readability hard requirement)**

Manually verify with browser devtools (or an axe/contrast extension) that on the glass surfaces:
- `--glass-ink` (#EAFFF5) on `.glass` over mesh ≥ 4.5:1 (it is — light on dark).
- `--glass-muted` (#9FBCB0) used only for secondary text ≥ 4.5:1; if any instance is on a brighter mesh hotspot and dips below, bump that text to `text-white/80`.
- Status chips: each `*-200`/`*-100` text on its `*-400/15` chip ≥ 4.5:1.
Record any class bumps and include them in this task's commit.

- [ ] **Step 3: Reduced-motion pass**

With OS "reduce motion" on, confirm: mesh blobs static, skeletons static (solid), field lift disabled, cycling text shows a single stage, GSAP reveals show final state. Fix any that animate (add `motion-reduce:` variants or matchMedia guards).

- [ ] **Step 4: Verify + commit**

```bash
cd "novelty-job-Tracker" && npx tsc --noEmit && npm run lint
git add -A
git commit -m "fix(theme): readability + reduced-motion + no-hidden-content guards"
```

---

### Task 19: Final verification

- [ ] **Step 1: Full build + lint + typecheck**

```bash
cd "novelty-job-Tracker" && npx tsc --noEmit && npm run lint && npm run build
```
Expected: all pass, no errors/warnings introduced by this work.

- [ ] **Step 2: Manual end-to-end visual run**

`npm run dev`, then walk: `/login` (sign in → cycling button) → `/track` (search a PO → glass cards, skeletons on load) → `/admin` (dashboard, table, filter, add job, expand history, open each modal). Confirm premium glass-mesh look and that **all text is clearly readable** on every surface.

- [ ] **Step 3: Stop here for review**

Do not merge. Hand back for the finishing-a-development-branch decision (PR vs merge).

---

## Self-review

- **Spec coverage:** background (Tasks 1,3,7,8,11) ✓; fields (Task 4 + applied 7,9,13,16,17) ✓; action loaders (Task 5 + applied 7,13) ✓; content skeletons (Task 6 + applied 14,16) ✓; whole-app scope incl. admin (Phase D) ✓; readability hard requirement (Task 2 chips + Task 18 audit) ✓; reduced-motion + no-hidden-content (Task 18) ✓; build/lint/tsc acceptance (Task 19) ✓.
- **Placeholders:** none — each task lists exact files, class strings, and full code for new components.
- **Type consistency:** `Field`/`SelectField` (Task 4), `Spinner`/`CyclingText`/`LoadingButton` (Task 5), `Skeleton`/`SkeletonText`/`SkeletonRows` (Task 6), `JOB_TYPE_BADGE`/`urgentBadgeClass` (Task 2) — names used consistently in application tasks.
