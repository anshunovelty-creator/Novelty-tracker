# Novelty Green Re-skin + GSAP Animation — Design Spec

**Date:** 2026-06-19
**Status:** Approved (design); pending spec review
**Branch:** `feature/novelty-green-gsap-redesign`

## 1. Goal

Re-skin the Novelty Labels Job Tracker to the brand identity (logo + green
`#10553F` and its shades) and add a cohesive GSAP animation layer that makes
both panels feel polished and premium — without harming readability, data
density, performance, or accessibility.

The app has two surfaces, and they get **different treatments (Two-Tone)**:

- **`/admin`** (internal, protected, data-dense) → **crisp & professional**.
  Fast, restrained motion that never blocks data entry.
- **`/track`** (public client portal) → **immersive & branded**. Richer,
  delightful, more expressive motion.
- **`/login` + `/track` landing** → branded first-impression.

## 2. Non-Goals (YAGNI)

- No dark mode toggle (the green system is built to allow it later, but it is
  out of scope now).
- No new features, routes, data model, or API changes. **Visual + motion only.**
- No font change (keep DM Sans / DM Mono).
- No redesign of business logic (stages, dispatch, notifications untouched).
- No pixel-level redesign of every component — re-theme via tokens, then add
  motion and polish to the high-impact surfaces listed in §6.

## 3. Brand Color System

Seed: **`#10553F`** (deep spruce green, ≈ `hsl(161°, 68%, 20%)`).

### 3.1 Green scale (add to theme)

| Token | Hex | Typical use |
|-------|-----|-------------|
| `green-50`  | `#F0F6F3` | tinted backgrounds, hover wash |
| `green-100` | `#DCEDE5` | subtle fills, secondary-on-green text |
| `green-200` | `#B9DBCB` | borders on green, dividers |
| `green-300` | `#8AC2A9` | muted accents on dark green |
| `green-400` | `#4FA582` | progress/accent on dark green |
| `green-500` | `#2C8763` | accent |
| `green-600` | `#1A6B4B` | hover/active accents |
| `green-700` | `#10553F` | **brand primary (seed)** |
| `green-800` | `#0C4232` | primary hover, immersive bg top |
| `green-900` | `#082F24` | immersive bg bottom |
| `green-950` | `#05201A` | deepest shade |

### 3.2 Status palette (job states)

| Role | Hex |
|------|-----|
| Completed / success / on-time | `#1B7A4E` |
| In progress / active | `#C2740C` (amber) |
| Overdue / urgent | `#C0392B` (red) |
| On hold | `#5B6B63` (slate-green) |
| Pending / queued | `#94A39B` on `#EDF1EE` |

### 3.3 Token architecture — IMPORTANT

The existing `brand-accent` (`#1a1a18`) token is **overloaded**: it is used both
as primary **text** color (`text-brand-accent`) and as primary **action**
background (`bg-brand-accent`). A naïve swap to green would turn all body text
green and hurt readability. We split the concern:

| New token | Hex | Replaces / meaning |
|-----------|-----|--------------------|
| `brand-ink` | `#0C2A20` | **text** (dark green-black, readable). All current `text-brand-accent` → `text-brand-ink`. |
| `brand-primary` | `#10553F` | **actions/brand** (buttons, header). All current `bg-brand-accent` → `bg-brand-primary`. |
| `brand-primary-hover` | `#0C4232` | button/link hover |
| `brand-bg` | `#F5F7F4` | page background (warm near-white) |
| `brand-surface` | `#FFFFFF` | cards (unchanged) |
| `brand-border` | `#E4EAE6` | dividers (greenish) |
| `brand-muted` | `#6A7A72` | secondary text (green-gray) |
| `brand-header` | `#10553F` | header/nav background (was near-black) |
| `brand-success` / `warning` / `danger` / `hold` / `pending` | see §3.2 | status |

**Migration approach:** keep `brand-accent` as a deprecated **alias of
`brand-ink`** during the change so nothing breaks mid-edit, then run an audit of
every `*-brand-accent` usage and classify each as text (→ `brand-ink`) or
action (→ `brand-primary`). Remove the alias once the audit is complete.

Tokens are defined in **both** `tailwind.config.ts` (Tailwind classes) and
`src/app/globals.css` (CSS custom properties), which already mirror each other.
The `react-hot-toast` Toaster style in `src/app/layout.tsx` moves from `#1a1a18`
to `brand-ink` (`#0C2A20`).

## 4. Logo

- Source asset: `NOVELTY LABELS LOGO.png` (full lockup: barcode-N mark +
  "NOVELTY LABELS" wordmark, green on transparent/white).
- Copy into `public/novelty-labels-logo.png`. Replace every placeholder "N"
  box (login header, `track/layout.tsx` header, `AdminHeader`) with a `next/image`
  of the real logo.
- Use the full lockup where horizontal space allows; on tight headers, the lockup
  scales down (it remains legible). A mark-only crop is a nice-to-have, not required.
- **Barcode "draw-in" animation (login):** ideal implementation is an inline SVG
  whose bars animate via stagger. We do **not** have an SVG version. **Decision:**
  ship a PNG **mask-wipe reveal** (left→right clip reveal + fade) which reads as
  "bars drawing in" and needs no SVG. If an SVG is provided later, upgrade to a
  true per-bar stagger. (This keeps the spec unblocked.)

## 5. Animation System — GSAP

**Single animation library.** Introduce GSAP; remove `framer-motion`.

- Packages: `gsap` + `@gsap/react` (the `useGSAP()` hook → React-safe,
  auto-cleanup, StrictMode-safe).
- `framer-motion` is used in exactly one file (`components/track/TrackJobAccordion.tsx`).
  Migrate it to a GSAP height/opacity tween, then remove `framer-motion` from
  `package.json`.
- **Responsive + reduced motion:** wrap context-specific timelines in
  `gsap.matchMedia()` with a `(prefers-reduced-motion: reduce)` branch that
  renders final states with no motion. This is mandatory for every animated unit.
- **Plugins:** `ScrollTrigger` (Track scroll reveals), `Flip` (admin table/layout
  changes). Registered once in a small client setup module.
- **Performance:** animate **transform/opacity only** (no layout-thrashing
  properties); use `will-change` sparingly; respect 60fps.

### 5.1 Reusable motion units (isolation & clarity)

Create small, focused, independently-testable client components/hooks under
`src/components/motion/`:

| Unit | Purpose | Depends on |
|------|---------|------------|
| `GsapProvider` (or `lib/gsap/register.ts`) | register plugins once | gsap, ScrollTrigger, Flip |
| `useReveal(ref, opts)` | fade/slide-in on mount (admin) or on scroll (track) | useGSAP, ScrollTrigger |
| `useCountUp(ref, value)` | number count-up for summary cards | useGSAP |
| `<Stagger>` | stagger children in | useGSAP |
| `<LogoReveal>` | logo mask-wipe reveal | useGSAP |
| `<AuroraBackground>` | slow animated green gradient (login + track hero) | useGSAP |

Each unit must: do one thing, expose a clear prop/ref interface, and degrade to
final state under reduced motion.

## 6. Per-Surface Specification

### 6.1 Login (`app/(auth)/login/page.tsx`)
- Real logo via `<LogoReveal>` (mask-wipe, ~0.6s), then heading/subtitle fade.
- `<AuroraBackground>` (subtle green gradient drift) behind the card.
- Card lifts in (`y:24→0`, opacity), inputs stagger (~0.05s steps).
- Submit: button press scale; on error, a 200ms horizontal shake on the card.
- Theme: card on green gradient panel; primary button = `brand-primary`.

### 6.2 Track landing (`app/track/page.tsx` + `app/track/layout.tsx`)
- Header: real logo on `brand-header` green; immersive gradient body.
- Hero search: `<AuroraBackground>`; input + "Track" button with satisfying
  submit (button → loading state).
- Footer/section reveals on scroll.

### 6.3 Track result (`app/track/[po]` + `components/track/*`)
- `StagePipeline`: nodes **pop in sequence**, connector lines **draw**
  (scaleX 0→1), current stage **pulses** (existing `.dot-pulse` reused/enhanced).
- `ProgressBar`: width **fills** from 0 to target on reveal.
- `DeliveryCountdown`: numbers **tick/count** to value.
- `TrackJobAccordion`: GSAP height/opacity (replacing framer-motion).
- Cards (`DispatchSummaryCard`, `ScheduledReleaseCard`, `StatusBanners`):
  reveal on scroll via `useReveal`.
- On terminal "Dispatched/Completed" state: a brief check-burst flourish.

### 6.4 Admin (`app/admin/*` + `components/admin/*`)
- `AdminHeader`: real logo, green header.
- `DashboardSummaryCard`: `useCountUp` (0→value) + `<Stagger>` entrance (~0.4s total).
- `JobsTable` / `JobRow`: subtle row fade/slide on load; new/updated row
  highlight-then-settle (Flip for reorders if low-effort).
- `StatusBadge` (and the status-change control it lives in, e.g. `JobRow`):
  smooth color/label crossfade on change.
- Admin modals (`components/admin/modals/*`): scale+fade in, backdrop fade.
  No shared base `Modal` exists on disk — each modal handles its own entrance,
  or extract a tiny shared wrapper if it reduces duplication.
- **Restraint:** durations 0.25–0.4s, never queue long sequences that delay
  interaction.

## 7. Accessibility & Performance (cross-cutting, mandatory)

- `prefers-reduced-motion: reduce` → all motion units render final state, no tweens.
- Color contrast ≥ 4.5:1 for text (verify `brand-ink`/`brand-muted` on `brand-bg`,
  and white/`green-100` on `brand-primary`).
- Preserve focus-visible rings (retune to green) and the existing 44px min tap targets.
- Transform/opacity-only animations; no CLS introduced by reveals (reserve space).
- Logo `<Image>` has meaningful `alt`.

## 8. File-Change Map (no logic changes)

| Area | Files |
|------|-------|
| Tokens | `tailwind.config.ts`, `src/app/globals.css` |
| Logo asset | `public/novelty-labels-logo.png` (new) |
| GSAP setup | `package.json` (add gsap, @gsap/react; remove framer-motion), `src/lib/gsap/register.ts` (new), `src/components/motion/*` (new) |
| Root | `src/app/layout.tsx` (Toaster color, possibly GsapProvider) |
| Login | `src/app/(auth)/login/page.tsx` |
| Track | `src/app/track/layout.tsx`, `src/app/track/page.tsx`, `src/app/track/[po]/page.tsx`, `src/components/track/*` |
| Admin | `src/components/admin/AdminHeader.tsx`, `DashboardSummaryCard.tsx`, `JobsTable.tsx`, `JobRow.tsx`, `StatusBadge.tsx`, `components/admin/modals/*` |

## 9. Verification

- `npm run build` + `npm run lint` pass.
- Manual run (`npm run dev`): login, track landing, track result (a real/seeded
  PO), admin dashboard — confirm theme, logo, and each animation beat.
- Toggle OS "reduce motion" → confirm motion is suppressed and content is fully
  visible/usable.
- Quick contrast check on primary text/button combinations.
- Confirm `framer-motion` no longer imported anywhere (`grep`), dependency removed.

## 10. Risks & Mitigations

- **Overloaded `brand-accent` swap** → split into ink/primary with a temporary
  alias + usage audit (§3.3). This is the main correctness risk.
- **GSAP + Next 14 SSR/StrictMode** → use `useGSAP` + `'use client'`; register
  plugins client-side only.
- **Motion overload on admin** → strict duration budget; reduced-motion path.
- **No SVG logo for per-bar draw** → PNG mask-wipe fallback (§4), upgrade later.

## 11. Out-of-scope follow-ups (note, don't build)

- Dark mode using the green scale.
- True per-bar SVG logo animation.
- Mark-only logo variant + favicon refresh.
