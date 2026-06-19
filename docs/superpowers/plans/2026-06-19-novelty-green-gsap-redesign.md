# Novelty Green Re-skin + GSAP Animation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the Job Tracker to the Novelty Labels brand (logo + green `#10553F` + shades) and add a cohesive GSAP animation layer — crisp on `/admin`, immersive on `/track` — without harming readability, performance, or accessibility.

**Architecture:** Re-theme by redefining the existing semantic `brand-*` tokens (one place), so the whole app re-skins. `brand-accent` is redefined to a dark green **ink** (keeps all text/border/ring usages readable); brand fills (`bg-brand-accent`, 18 usages) move to a new green `brand-primary`. GSAP becomes the single animation system via `@gsap/react`'s `useGSAP`, with `gsap.matchMedia()` driving both responsive behavior and `prefers-reduced-motion`. framer-motion (one file) is migrated and removed. Reusable motion units live in `src/components/motion/`.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Tailwind 3, `gsap` + `@gsap/react` (+ ScrollTrigger, Flip), `next/image`.

---

## Verification Model (read first)

This is a **visual + motion** change. The repo has **no test harness** and adding one for CSS/animation is out of scope (YAGNI). Each task therefore verifies with:

- `npm run lint` — no new lint errors.
- `npm run build` — compiles (catches type/import errors, e.g. a leftover framer-motion import).
- A **specific manual check** in `npm run dev` (stated per task). Where a real DB row is needed (track result), use any seeded PO; if none exists, verify the page renders its empty/loading state without error.
- **Reduced-motion check** (Task 10): toggle OS "reduce motion" and confirm content is fully visible with motion suppressed.

Commit after every task. Branch: `feature/novelty-green-gsap-redesign` (already created).

---

## File Structure

**New files**
- `public/novelty-labels-logo.png` — brand logo asset (copied from `~/Downloads`).
- `src/components/brand/Logo.tsx` — static logo (`onDark` variant renders white).
- `src/lib/gsap/register.ts` — registers GSAP plugins once (client only).
- `src/components/motion/LogoReveal.tsx` — logo mask-wipe reveal.
- `src/components/motion/AuroraBackground.tsx` — slow animated green gradient.
- `src/components/motion/Reveal.tsx` — fade/slide-in on mount or on scroll.
- `src/components/motion/CountUp.tsx` — animated number count-up.
- `src/components/motion/Stagger.tsx` — stagger direct children in.

**Modified files**
- `tailwind.config.ts`, `src/app/globals.css` — tokens.
- `src/app/layout.tsx` — Toaster color (+ no GSAP provider needed; `useGSAP` self-registers via `register.ts` import).
- `src/app/(auth)/login/page.tsx` — logo + login motion.
- `src/app/track/layout.tsx`, `src/app/track/page.tsx`, `src/app/track/[po]/page.tsx` — immersive theme + motion.
- `src/components/track/TrackJobAccordion.tsx` — migrate off framer-motion.
- `src/components/track/StagePipeline.tsx`, `ProgressBar.tsx`, `DeliveryCountdown.tsx`, `DispatchSummaryCard.tsx`, `ScheduledReleaseCard.tsx`, `StatusBanners.tsx` — track motion.
- `src/components/admin/AdminHeader.tsx`, `DashboardSummaryCard.tsx`, `JobsTable.tsx`, `JobRow.tsx`, `StatusBadge.tsx`, `components/admin/modals/index.tsx` — admin motion.
- `package.json` — add gsap + @gsap/react, remove framer-motion.

---

# Phase 1 — Brand Foundation (no GSAP yet)

## Task 1: Color tokens

**Files:**
- Modify: `tailwind.config.ts`
- Modify: `src/app/globals.css`

- [ ] **Step 1: Replace the `colors` block in `tailwind.config.ts`**

Replace the existing `colors: { brand: {...} }` with:

```ts
colors: {
  brand: {
    bg:              '#F5F7F4', // warm near-white page bg
    surface:         '#FFFFFF', // cards
    border:          '#E4EAE6', // dividers (greenish)
    ink:             '#0C2A20', // primary text (dark green-black)
    accent:          '#0C2A20', // = ink. Kept so existing text-/border-/ring-brand-accent stay readable.
    primary:         '#10553F', // brand fills / actions (green-700, the seed)
    'primary-hover': '#0C4232', // button/link hover
    header:          '#10553F', // header/nav bg (was near-black)
    muted:           '#6A7A72', // secondary text (green-gray)
    success:         '#1B7A4E',
    warning:         '#C2740C',
    danger:          '#C0392B',
    hold:            '#5B6B63',
    pending:         '#94A39B',
    // legacy semantic names still referenced in code:
    green:           '#1B7A4E',
    amber:           '#C2740C',
    red:             '#C0392B',
  },
  green: {
    50:  '#F0F6F3', 100: '#DCEDE5', 200: '#B9DBCB', 300: '#8AC2A9',
    400: '#4FA582', 500: '#2C8763', 600: '#1A6B4B', 700: '#10553F',
    800: '#0C4232', 900: '#082F24', 950: '#05201A',
  },
},
```

> **Note (refines spec §3.3):** We keep `brand-accent` permanently as an alias of `brand-ink` rather than auditing/removing all 147 `*-brand-accent` usages. Only the 18 brand-fill usages (`bg-brand-accent`) move to `brand-primary` (Task 3). This is lower-risk and achieves the same visual result.

- [ ] **Step 2: Update the CSS custom properties in `src/app/globals.css`**

Replace the `:root { ... }` block (lines ~7-19) with:

```css
:root {
  --color-bg:            #F5F7F4;
  --color-surface:       #FFFFFF;
  --color-border:        #E4EAE6;
  --color-ink:           #0C2A20;
  --color-accent:        #0C2A20; /* = ink */
  --color-primary:       #10553F;
  --color-primary-hover: #0C4232;
  --color-header:        #10553F;
  --color-muted:         #6A7A72;
  --color-success:       #1B7A4E;
  --color-warning:       #C2740C;
  --color-danger:        #C0392B;

  --font-sans: var(--font-dm-sans), system-ui, sans-serif;
  --font-mono: var(--font-dm-mono), ui-monospace, monospace;
}
```

(The `body { color: var(--color-accent) }` rule below stays — it now resolves to ink.)

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: builds successfully.
Run: `npm run dev`, open `/login` and `/track`. Expected: page bg is warm near-white, text is dark green-black, header is green. (Buttons may still look dark until Task 3 — that's expected.)

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.ts src/app/globals.css
git commit -m "feat(theme): Novelty green color tokens (ink + primary + green scale)"
```

---

## Task 2: Logo asset + `<Logo>` component + replace placeholder "N"

**Files:**
- Create: `public/novelty-labels-logo.png`
- Create: `src/components/brand/Logo.tsx`
- Modify: `src/app/track/layout.tsx`, `src/components/admin/AdminHeader.tsx`, `src/app/(auth)/login/page.tsx`

- [ ] **Step 1: Copy the logo asset**

Run (Git Bash):
```bash
cp "C:/Users/Anshu/Downloads/NOVELTY LABELS LOGO.png" "C:/Users/Anshu/ANSHU/Novelty Job Tracker/novelty-job-Tracker/public/novelty-labels-logo.png"
```
Expected: file exists at `public/novelty-labels-logo.png`.

- [ ] **Step 2: Create `src/components/brand/Logo.tsx`**

The logo is dark-green artwork on transparent. On green headers it must render **white** — `onDark` applies a brightness/invert filter (works because the mark is single-color).

```tsx
// src/components/brand/Logo.tsx
import Image from 'next/image';
import { cn } from '@/lib/utils';

type LogoProps = {
  /** Render white (for dark/green backgrounds). */
  onDark?: boolean;
  width?: number;
  height?: number;
  priority?: boolean;
  className?: string;
};

export function Logo({ onDark = false, width = 150, height = 47, priority = false, className }: LogoProps) {
  return (
    <Image
      src="/novelty-labels-logo.png"
      alt="Novelty Labels"
      width={width}
      height={height}
      priority={priority}
      className={cn('h-auto w-auto object-contain', onDark && '[filter:brightness(0)_invert(1)]', className)}
    />
  );
}
```

- [ ] **Step 3: Use the logo in the track header**

In `src/app/track/layout.tsx`, replace the placeholder block (the `<div className="flex items-center gap-2">…"N"…Novelty Labels</div>`, lines ~17-22) with:

```tsx
<Link href="/track" className="flex items-center gap-2">
  <Logo onDark width={132} height={34} priority />
</Link>
```

Add imports at top: `import Link from 'next/link';` and `import { Logo } from '@/components/brand/Logo';`.

- [ ] **Step 4: Use the logo in `AdminHeader`**

Read `src/components/admin/AdminHeader.tsx` first. It renders the admin top bar (green after Task 1). Replace its brand/"N" element with `<Logo onDark width={120} height={30} priority />` (import `Logo`). Keep the department name / nav untouched. If the header background is light rather than green, omit `onDark`.

- [ ] **Step 5: Replace the login "N" box**

In `src/app/(auth)/login/page.tsx`, replace the placeholder logo `<div className="w-10 h-10 bg-brand-accent …">…"N"…</div>` (lines ~54-56) with:

```tsx
<div className="mb-6">
  <Logo width={172} height={54} priority />
</div>
```

Add import: `import { Logo } from '@/components/brand/Logo';`. (Login card is white → use the green logo, no `onDark`.)

- [ ] **Step 6: Verify**

Run: `npm run lint && npm run build`. Expected: pass.
Run: `npm run dev`. Check `/login` (green logo on white card), `/track` (white logo on green header), `/admin` (white logo on green header — log in if needed). Logo is crisp and visible on each.

- [ ] **Step 7: Commit**

```bash
git add public/novelty-labels-logo.png src/components/brand/Logo.tsx src/app/track/layout.tsx src/components/admin/AdminHeader.tsx "src/app/(auth)/login/page.tsx"
git commit -m "feat(brand): add Novelty logo + Logo component, replace placeholders"
```

---

## Task 3: Move brand fills to green + restyle Toaster

**Files:**
- Modify (global replace): all files containing `bg-brand-accent` (8 files: `app/track/page.tsx`, `components/track/StagePipeline.tsx`, `components/track/ProgressBar.tsx`, `components/admin/HistoryPanel.tsx`, `components/admin/StageComments.tsx`, `components/admin/AddJobForm.tsx`, `components/admin/JobsTable.tsx`, `components/admin/modals/index.tsx`; plus the login button)
- Modify: `src/app/layout.tsx`

- [ ] **Step 1: Replace `bg-brand-accent` → `bg-brand-primary` everywhere**

Run (Git Bash, from `novelty-job-Tracker/`):
```bash
grep -rl "bg-brand-accent" src | while read f; do
  sed -i 's/bg-brand-accent/bg-brand-primary/g' "$f"
done
grep -rn "bg-brand-accent" src || echo "OK: none remain"
```
Expected: `OK: none remain`. This converts buttons, the pulsing stage dot, and progress fills to brand green; `hover:bg-brand-accent/90` → `hover:bg-brand-primary/90` and `bg-brand-accent/20` → `bg-brand-primary/20` are handled by the substring replace.

- [ ] **Step 2: Restyle the Toaster in `src/app/layout.tsx`**

Change the Toaster `style.background` from `'#1a1a18'` to `'#0C2A20'` (ink). Leave the rest.

```tsx
style: {
  fontFamily: 'var(--font-dm-sans)',
  fontSize: '0.875rem',
  background: '#0C2A20',
  color: '#ffffff',
  borderRadius: '8px',
},
```

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build`. Expected: pass.
Run: `npm run dev`. Buttons (login "Sign in", track "Track Order", admin add/save buttons), the current-stage pulse dot, and progress bars are now Novelty green. Trigger any toast (e.g. a save) → dark green-ink background.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(theme): brand fills + toaster use Novelty green"
```

---

# Phase 2 — GSAP Foundation

## Task 4: Install GSAP, remove framer-motion, migrate the accordion

**Files:**
- Modify: `package.json` (via npm)
- Create: `src/lib/gsap/register.ts`
- Modify: `src/components/track/TrackJobAccordion.tsx`

- [ ] **Step 1: Install / uninstall packages**

Run:
```bash
npm install gsap @gsap/react
npm uninstall framer-motion
```
Expected: `gsap` + `@gsap/react` in dependencies; `framer-motion` gone.

- [ ] **Step 2: Create `src/lib/gsap/register.ts`**

```ts
'use client';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Flip } from 'gsap/Flip';

let done = false;
export function registerGsap() {
  if (done || typeof window === 'undefined') return;
  gsap.registerPlugin(useGSAP, ScrollTrigger, Flip);
  done = true;
}
```

Every motion unit (Task 5) calls `registerGsap()` at module load.

- [ ] **Step 3: Migrate `TrackJobAccordion.tsx` off framer-motion**

Read the file first (it currently imports `{ AnimatePresence, motion } from 'framer-motion'` and uses `motion.div`/`motion.article` with `layout` + an `AnimatePresence` expand/collapse). Replace with a GSAP height auto-animation. Concretely:

1. Remove the `framer-motion` import. Add:
```tsx
import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
registerGsap();
```
2. Replace `<motion.div layout …>` (single-job wrapper, ~line 73) and `<motion.article layout …>` (~line 130) with plain `<div>` / `<article>` (keep the same `className`s; drop `layout`/`transition`).
3. Replace the `<AnimatePresence>` + `<motion.div initial/animate/exit height>` expand/collapse (~lines 169-178) with a controlled height tween. Extract the expandable body into a small child that animates on open/close:

```tsx
function ExpandPanel({ open, children }: { open: boolean; children: React.ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const el = wrap.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.to(el, {
        height: open ? 'auto' : 0,
        opacity: open ? 1 : 0,
        duration: 0.4,
        ease: 'power2.inOut',
      });
    });
    mm.add('(prefers-reduced-motion: reduce)', () => {
      gsap.set(el, { height: open ? 'auto' : 0, opacity: open ? 1 : 0 });
    });
  }, { dependencies: [open], scope: wrap });
  return <div ref={wrap} style={{ height: 0, opacity: 0, overflow: 'hidden' }}>{children}</div>;
}
```

Render `<ExpandPanel open={isOpen}>…existing details JSX…</ExpandPanel>` in place of the `AnimatePresence` block. The `handleExitComplete`/`pendingJobId` choreography (close-then-open) can be simplified: on select, just set `openJobId` directly (GSAP handles the smooth height). Remove `pendingJobId`, `handleExitComplete`, and the `onExitComplete` wiring.

- [ ] **Step 4: Verify**

Run: `grep -rn "framer-motion" src || echo "OK: framer-motion gone"` → expect `OK`.
Run: `npm run lint && npm run build`. Expected: pass.
Run: `npm run dev`, open a `/track/<PO>` with multiple jobs (or single) → rows expand/collapse smoothly; with one job the card shows directly.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(gsap): adopt GSAP, remove framer-motion, migrate TrackJobAccordion"
```

---

## Task 5: Reusable motion units

**Files:**
- Create: `src/components/motion/LogoReveal.tsx`, `AuroraBackground.tsx`, `Reveal.tsx`, `CountUp.tsx`, `Stagger.tsx`

All are `'use client'`, call `registerGsap()` at module load, and use `useGSAP` + `gsap.matchMedia()` so the reduced-motion branch renders final state.

- [ ] **Step 1: `src/components/motion/Reveal.tsx`**

```tsx
'use client';
import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
registerGsap();

type RevealProps = {
  children: React.ReactNode;
  /** animate when scrolled into view instead of on mount */
  onScroll?: boolean;
  y?: number;
  delay?: number;
  duration?: number;
  className?: string;
};

export function Reveal({ children, onScroll = false, y = 20, delay = 0, duration = 0.5, className }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const el = ref.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(el, { opacity: 0, y },
        {
          opacity: 1, y: 0, duration, delay, ease: 'power2.out',
          scrollTrigger: onScroll ? { trigger: el, start: 'top 85%', once: true } : undefined,
        });
    });
    mm.add('(prefers-reduced-motion: reduce)', () => gsap.set(el, { opacity: 1, y: 0 }));
  }, { scope: ref });
  return <div ref={ref} className={className} style={{ opacity: 0 }}>{children}</div>;
}
```

- [ ] **Step 2: `src/components/motion/Stagger.tsx`**

```tsx
'use client';
import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
registerGsap();

export function Stagger({ children, y = 16, each = 0.07, className }: { children: React.ReactNode; y?: number; each?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const el = ref.current;
    if (!el) return;
    const items = el.children;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(items, { opacity: 0, y }, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out', stagger: each });
    });
    mm.add('(prefers-reduced-motion: reduce)', () => gsap.set(items, { opacity: 1, y: 0 }));
  }, { scope: ref });
  return <div ref={ref} className={className}>{children}</div>;
}
```

- [ ] **Step 3: `src/components/motion/CountUp.tsx`**

```tsx
'use client';
import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
registerGsap();

export function CountUp({ value, duration = 0.9, className }: { value: number; duration?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useGSAP(() => {
    const el = ref.current;
    if (!el) return;
    const obj = { n: 0 };
    const render = () => { el.textContent = String(Math.round(obj.n)); };
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.to(obj, { n: value, duration, ease: 'power1.out', onUpdate: render });
    });
    mm.add('(prefers-reduced-motion: reduce)', () => { obj.n = value; render(); });
  }, { dependencies: [value], scope: ref });
  return <span ref={ref} className={className}>0</span>;
}
```

- [ ] **Step 4: `src/components/motion/LogoReveal.tsx`**

```tsx
'use client';
import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
import { Logo } from '@/components/brand/Logo';
registerGsap();

export function LogoReveal({ onDark = false, width = 172, height = 54, className }: { onDark?: boolean; width?: number; height?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const el = ref.current;
    if (!el) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo(el, { clipPath: 'inset(0 100% 0 0)', opacity: 0 },
        { clipPath: 'inset(0 0% 0 0)', opacity: 1, duration: 0.9, ease: 'power3.out' });
    });
    mm.add('(prefers-reduced-motion: reduce)', () => gsap.set(el, { clipPath: 'inset(0 0% 0 0)', opacity: 1 }));
  }, { scope: ref });
  return (
    <div ref={ref} className={className} style={{ opacity: 0, display: 'inline-block' }}>
      <Logo onDark={onDark} width={width} height={height} priority />
    </div>
  );
}
```

- [ ] **Step 5: `src/components/motion/AuroraBackground.tsx`**

Decorative, `aria-hidden`, sits behind content (`absolute inset-0 -z-10`). Two soft radial green blobs drift slowly; suppressed under reduced motion.

```tsx
'use client';
import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
registerGsap();

export function AuroraBackground({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const blobs = ref.current?.querySelectorAll('[data-blob]');
    if (!blobs?.length) return;
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      blobs.forEach((b, i) => {
        gsap.to(b, { xPercent: i ? -12 : 12, yPercent: i ? 10 : -10, scale: 1.15,
          duration: 9 + i * 3, repeat: -1, yoyo: true, ease: 'sine.inOut' });
      });
    });
  }, { scope: ref });
  return (
    <div ref={ref} aria-hidden className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden ${className ?? ''}`}>
      <div data-blob className="absolute -top-24 -left-16 h-80 w-80 rounded-full blur-3xl"
           style={{ background: 'radial-gradient(circle, rgba(79,165,130,.45), transparent 70%)' }} />
      <div data-blob className="absolute -bottom-24 -right-10 h-96 w-96 rounded-full blur-3xl"
           style={{ background: 'radial-gradient(circle, rgba(16,85,63,.55), transparent 70%)' }} />
    </div>
  );
}
```

- [ ] **Step 6: Verify**

Run: `npm run lint && npm run build`. Expected: pass (components compile even if not yet used).

- [ ] **Step 7: Commit**

```bash
git add src/components/motion
git commit -m "feat(motion): reusable GSAP units (Reveal, Stagger, CountUp, LogoReveal, Aurora)"
```

---

# Phase 3 — Track Panel (immersive)

## Task 6: Track layout + landing motion

**Files:**
- Modify: `src/app/track/layout.tsx`, `src/app/track/page.tsx`

- [ ] **Step 1: Immersive layout shell**

In `track/layout.tsx`: change the page wrapper from `bg-brand-bg` to an immersive green gradient and light text. Set the `<main>` to `relative` and place an `<AuroraBackground />` inside it. Header stays green (`bg-brand-header`) with the white `<Logo onDark>` from Task 2.

```tsx
<div className="min-h-screen bg-gradient-to-b from-brand-header via-[#0C4232] to-[#082F24] text-green-100">
  {/* header (unchanged structure; logo already swapped in Task 2) */}
  <main className="relative max-w-2xl mx-auto px-4 py-8">
    <AuroraBackground />
    {children}
  </main>
  <footer className="mt-16 pb-8 text-center">
    <p className="text-xs text-green-300/70">Novelty Labels &amp; Supplies · Ankleshwar GIDC, Gujarat</p>
  </footer>
</div>
```
Add `import { AuroraBackground } from '@/components/motion/AuroraBackground';`.

- [ ] **Step 2: Landing page motion + on-green colors**

In `track/page.tsx`: the heading/subtitle currently use `text-brand-accent`/`text-brand-muted` (dark) — on the dark green bg they must become light. Change heading to `text-white`, subtitle to `text-green-200`. Wrap the heading block in `<Reveal>` and the form in `<Reveal delay={0.1}>`. Keep the input white. Keep the `bg-brand-primary` button (from Task 3) but ensure it reads on the form.

Example top of returned JSX:
```tsx
<div className="flex flex-col items-center pt-8">
  <Reveal className="text-center">
    <h1 className="text-3xl font-semibold text-white tracking-tight mb-2">Track Your Order</h1>
    <p className="text-green-200 text-sm mb-8">Enter your Purchase Order number or Job Name to see the current status.</p>
  </Reveal>
  <Reveal delay={0.1} className="w-full max-w-md">
    {/* existing <form> … inputs white; button bg-brand-primary */}
  </Reveal>
  {/* footer note: text-green-300/70 */}
</div>
```
Add `import { Reveal } from '@/components/motion/Reveal';`.

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build`. Expected: pass.
Run: `npm run dev`, open `/track`: immersive green hero with drifting aurora, white logo header, heading + form fade/slide in, text legible (contrast) on green.

- [ ] **Step 4: Commit**

```bash
git add src/app/track/layout.tsx src/app/track/page.tsx
git commit -m "feat(track): immersive green landing with aurora + reveal motion"
```

---

## Task 6b: Login page motion

**Files:**
- Modify: `src/app/(auth)/login/page.tsx`

- [ ] **Step 1: Aurora + logo reveal + card lift + field stagger**

Read the file (it's a `LoginForm` inside a `Suspense`). Apply:

1. Make the outer wrapper `relative` and add `<AuroraBackground />` behind the card; give the card a subtle green gradient panel feel if desired (keep the white form card).
2. Replace the static `<Logo …/>` (added in Task 2) with `<LogoReveal width={172} height={54} />`.
3. Wrap the form card in a `ref`'d element and, on mount, lift it in; `Stagger` the form fields.

Add imports:
```tsx
import { useRef } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from 'gsap';
import { registerGsap } from '@/lib/gsap/register';
import { AuroraBackground } from '@/components/motion/AuroraBackground';
import { LogoReveal } from '@/components/motion/LogoReveal';
import { Stagger } from '@/components/motion/Stagger';
registerGsap();
```

Card lift (inside `LoginForm`, with `cardRef` on the `w-full max-w-sm` wrapper):
```tsx
const cardRef = useRef<HTMLDivElement>(null);
useGSAP(() => {
  const el = cardRef.current; if (!el) return;
  const mm = gsap.matchMedia();
  mm.add('(prefers-reduced-motion: no-preference)', () =>
    gsap.fromTo(el, { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 0.6, ease: 'power3.out' }));
  mm.add('(prefers-reduced-motion: reduce)', () => gsap.set(el, { opacity: 1, y: 0 }));
}, { scope: cardRef });
```
Wrap the `<form>`'s field `<div>`s in `<Stagger className="space-y-4">…</Stagger>`.

- [ ] **Step 2: Error shake**

Add a `useGSAP` keyed on `error` that shakes the card when an error appears:
```tsx
useGSAP(() => {
  if (!error) return;
  const mm = gsap.matchMedia();
  mm.add('(prefers-reduced-motion: no-preference)', () =>
    gsap.fromTo(cardRef.current, { x: -6 }, { x: 0, ease: 'elastic.out(1,0.4)', duration: 0.5 }));
}, { dependencies: [error], scope: cardRef });
```

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run build`. Expected: pass.
Run: `npm run dev`, open `/login`: aurora drifts, logo wipes in, card lifts, fields stagger; submit wrong credentials → card shakes, error shows.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(auth)/login/page.tsx"
git commit -m "feat(login): logo reveal, aurora, card lift, field stagger, error shake"
```

---

## Task 7: Track result motion (pipeline, progress, countdown, reveals)

**Files:**
- Modify: `src/components/track/StagePipeline.tsx`, `ProgressBar.tsx`, `DeliveryCountdown.tsx`, `TrackJobAccordion.tsx` (wrap cards), `DispatchSummaryCard.tsx`, `ScheduledReleaseCard.tsx`
- Reference: `src/app/track/[po]/page.tsx`

> Read each component before editing. Apply these patterns; keep all existing data/props/logic.

- [ ] **Step 1: StagePipeline — sequence in + draw connectors + pulse**

Read `StagePipeline.tsx`. It maps stages to nodes with connector lines; the current stage already uses `.dot-pulse`. Add a `useGSAP` scoped to the pipeline root that, on mount, staggers the stage nodes in and scales the connector lines from 0→1 width:

```tsx
// inside the component, root ref on the outer wrapper
const root = useRef<HTMLDivElement>(null);
useGSAP(() => {
  const el = root.current; if (!el) return;
  const nodes = el.querySelectorAll('[data-stage-node]');
  const lines = el.querySelectorAll('[data-stage-line]');
  const mm = gsap.matchMedia();
  mm.add('(prefers-reduced-motion: no-preference)', () => {
    const tl = gsap.timeline();
    tl.fromTo(nodes, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, stagger: 0.08, ease: 'back.out(1.7)' });
    tl.fromTo(lines, { scaleX: 0, transformOrigin: 'left center' }, { scaleX: 1, duration: 0.25, stagger: 0.08 }, '<0.1');
  });
  mm.add('(prefers-reduced-motion: reduce)', () => { gsap.set([nodes, lines], { clearProps: 'all' }); });
}, { scope: root });
```
Add `data-stage-node` to each stage node element and `data-stage-line` to each connector line element. Add the GSAP imports + `registerGsap()`.

- [ ] **Step 2: ProgressBar — fill from 0**

Read `ProgressBar.tsx` (it renders a fill `div` whose width = `percent`). Give the fill element a ref and animate its width:

```tsx
const fill = useRef<HTMLDivElement>(null);
useGSAP(() => {
  const el = fill.current; if (!el) return;
  const mm = gsap.matchMedia();
  mm.add('(prefers-reduced-motion: no-preference)', () =>
    gsap.fromTo(el, { width: '0%' }, { width: `${percent}%`, duration: 1, ease: 'power2.out' }));
  mm.add('(prefers-reduced-motion: reduce)', () => gsap.set(el, { width: `${percent}%` }));
}, { dependencies: [percent], scope: fill });
```
Set the fill's static style width to `0%` (GSAP drives it) and attach `ref={fill}`.

- [ ] **Step 3: DeliveryCountdown — count the number up**

Read `DeliveryCountdown.tsx`. It computes a number of days. Render that number via the `CountUp` component (`<CountUp value={days} />`) instead of the raw value. If the value can be negative (overdue), guard: only `CountUp` the absolute value and keep the sign/label as text.

- [ ] **Step 4: Reveal the result cards on scroll**

In `TrackJobAccordion.tsx` (the expanded details column) and the cards `DispatchSummaryCard` / `ScheduledReleaseCard`, wrap each major card block in `<Reveal onScroll>`. Keep `StatusBanners` immediate (no reveal) so urgent info isn't delayed.

- [ ] **Step 5: "Dispatched/Completed" flourish (light touch)**

In the single-job/expanded header where `bundle.job.status` is shown, when status is `Dispatched` or `PO Closed`, add a one-shot scale-pop on the status pill via `useGSAP` (`gsap.fromTo(pill, {scale:0.8},{scale:1, ease:'back.out(2)', duration:0.5})`). Keep it subtle; no confetti library (YAGNI).

- [ ] **Step 6: Verify**

Run: `npm run lint && npm run build`. Expected: pass.
Run: `npm run dev`, open a real `/track/<PO>`: stage nodes pop in sequence, connectors draw, current stage pulses, progress bar fills, countdown number counts up, cards reveal on scroll. If no seeded PO exists, confirm the not-found state renders cleanly.

- [ ] **Step 7: Commit**

```bash
git add src/components/track src/app/track
git commit -m "feat(track): GSAP pipeline/progress/countdown reveals + status flourish"
```

---

# Phase 4 — Admin Panel (crisp)

## Task 8: Admin header polish + dashboard count-up

**Files:**
- Modify: `src/components/admin/DashboardSummaryCard.tsx`
- Reference: `src/components/admin/AdminHeader.tsx` (logo already added in Task 2)

- [ ] **Step 1: Summary cards — count-up + stagger**

Read `DashboardSummaryCard.tsx`. It renders summary stat cards (total_active, on_hold_count, due_this_week, dispatched_this_month, on_time_delivery_rate). Wrap the row of cards in `<Stagger>` and render each numeric value with `<CountUp value={n} />`. For the on-time rate (a percentage that may be `null`), only `CountUp` when it's a number; otherwise render the placeholder text.

```tsx
import { Stagger } from '@/components/motion/Stagger';
import { CountUp } from '@/components/motion/CountUp';
// …
<Stagger className="grid grid-cols-2 md:grid-cols-4 gap-3"> {/* match existing layout classes */}
  {/* each card: replace the raw number with <CountUp value={summary.total_active} /> etc. */}
</Stagger>
```
Keep existing card styling/labels; only wrap the container and swap the number nodes.

- [ ] **Step 2: Verify**

Run: `npm run lint && npm run build`. Expected: pass.
Run: `npm run dev`, open `/admin`: summary cards stagger in and numbers count up from 0 (~0.4–0.9s), header shows white logo on green.

- [ ] **Step 3: Commit**

```bash
git add src/components/admin/DashboardSummaryCard.tsx
git commit -m "feat(admin): summary cards count-up + stagger entrance"
```

---

## Task 9: Table row reveals, status crossfade, modal entrance

**Files:**
- Modify: `src/components/admin/JobsTable.tsx`, `JobRow.tsx`, `StatusBadge.tsx`, `components/admin/modals/index.tsx`

- [ ] **Step 1: Table rows — subtle entrance**

Read `JobsTable.tsx` / `JobRow.tsx`. On initial load, fade/slide the visible rows in with a small stagger. Add a `useGSAP` in `JobsTable` scoped to the `<tbody>` (or list container) that staggers `[data-job-row]` elements: `gsap.fromTo(rows, {opacity:0, y:8}, {opacity:1, y:0, duration:0.3, stagger:0.03, ease:'power1.out'})` with the reduced-motion `gsap.set` branch. Add `data-job-row` to the row root in `JobRow.tsx`. Keep durations short — this is the crisp panel.

- [ ] **Step 2: StatusBadge — crossfade on change**

Read `StatusBadge.tsx`. When the status value changes, briefly crossfade: `useGSAP` with `dependencies: [status]` doing `gsap.fromTo(el, {opacity:0.3}, {opacity:1, duration:0.3})`. Reduced-motion → no-op.

- [ ] **Step 3: Modal entrance**

Read `components/admin/modals/index.tsx`. Modals render a panel (`.modal-panel`) over a backdrop (`.modal-backdrop`). Add a small entrance on the panel when it mounts: `gsap.fromTo(panel, {opacity:0, y:12, scale:0.98}, {opacity:1, y:0, scale:1, duration:0.25, ease:'power2.out'})`, backdrop `fromTo opacity 0→1`. Reduced-motion → `gsap.set` final. Use refs + `useGSAP`. Don't change the close behavior.

- [ ] **Step 4: Verify**

Run: `npm run lint && npm run build`. Expected: pass.
Run: `npm run dev`, `/admin`: table rows ease in on load; change a job's status → badge crossfades; open a modal (e.g. add job / on-hold) → panel scales/fades in. All snappy (≤0.3s), no input lag.

- [ ] **Step 5: Commit**

```bash
git add src/components/admin
git commit -m "feat(admin): row reveals, status crossfade, modal entrance"
```

---

# Phase 5 — Polish & Final Verification

## Task 10: Accessibility, performance & sign-off

**Files:** none new — verification + small fixes only.

- [ ] **Step 1: Reduced-motion audit**

Enable OS "Reduce motion" (Windows: Settings → Accessibility → Visual effects → Animation effects OFF). Run `npm run dev` and visit `/login`, `/track`, a `/track/<PO>`, `/admin`. Expected: all content fully visible and usable, with motion suppressed (no fades-from-invisible left stuck, no count-up). If any element is stuck hidden, ensure its motion unit has the `(prefers-reduced-motion: reduce)` `gsap.set` final-state branch.

- [ ] **Step 2: Contrast & focus check**

Verify: body ink `#0C2A20` on bg `#F5F7F4`, muted `#6A7A72` on bg, white + `green-200`/`green-100` on green surfaces all read clearly (≥ 4.5:1 for normal text). Confirm focus-visible rings are present on inputs/buttons (retune any `ring-brand-accent/*` that looks off to `ring-brand-primary/40`). Confirm 44px tap targets still hold (base CSS rule unchanged).

- [ ] **Step 3: Performance sanity**

Confirm animations use transform/opacity/clip/width only (no animating `top/left/margin`). Confirm `AuroraBackground` is `aria-hidden` and `-z-10`. No layout shift on reveals (elements reserve space; `Reveal` only changes opacity/translate).

- [ ] **Step 4: Final full verification**

Run:
```bash
grep -rn "framer-motion" src package.json || echo "OK: framer-motion fully removed"
npm run lint
npm run build
```
Expected: `OK`, lint clean, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: a11y + reduced-motion + perf polish for green/GSAP redesign"
```

---

## Done

All spec sections are covered:
- §3 tokens → Task 1; §3.3 split → Tasks 1 & 3 (refined: accent=ink permanently, only fills move to primary).
- §4 logo (incl. onDark white variant, mask-wipe via LogoReveal) → Tasks 2, 5, 6.
- §5 GSAP system + drop framer-motion + motion units → Tasks 4, 5.
- §6.1 login → Task 6b.
- §6.2/6.3 track → Tasks 6, 7.
- §6.4 admin → Tasks 8, 9.
- §7 a11y/perf → every task's reduced-motion branch + Task 10.

**Optional (not required by spec):** §3.2's status palette is available as `brand-success/warning/danger/hold/pending` tokens but is **not** force-applied to `lib/constants/statusColors.ts` — the existing per-stage Tailwind colors are intentional and varied. Re-map them to the brand palette later only if desired.
