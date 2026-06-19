# Premium Glass-Mesh Redesign — Design Spec

**Date:** 2026-06-19
**Branch:** `feat/premium-glass-redesign`
**Status:** Approved (visual direction confirmed via brainstorming companion)

## Goal

Make the Novelty Labels tracker feel premium. Three user-requested levers, applied across the **entire app** (public + admin):

1. **Premium background** — Glass + Gradient Mesh (deep-green animated mesh with frosted-glass panels on top).
2. **Creative field interactions** — floating label + green glow ring + glass "lift" on focus.
3. **Loading feedback** — text-forward for actions, skeletons for content.

All built on the existing Novelty green brand. The app already works correctly; **this is a visual/interaction layer only — no business logic, data, or API behavior changes.**

## Hard requirement: readability

Text must stay **high-contrast, readable, and clearly visible** on the dark glass at all times. This is a blocking acceptance criterion, not a nice-to-have:

- Body/label text and status chips meet **WCAG AA** contrast against the frosted-glass surfaces they sit on.
- Frosted panels use enough opacity/blur that text never washes out over bright mesh hotspots.
- No reliance on color alone for status meaning (chips keep their text labels).

## Confirmed decisions

| Decision | Choice |
|---|---|
| Background | **Glass + Gradient Mesh** — deep-green radial-gradient mesh, frosted (`backdrop-blur`) panels for content |
| Field focus | **Floating label + glow ring + lift** — label rises into the field, soft green glow ring (`box-shadow`), field lifts (`translateY`) and brightens |
| Button/action loading | **Cycling status text** — brand spinner + text fading through real stages ("Connecting… → Verifying… → Almost there…") |
| Content loading | **Skeleton shimmer** — shimmering placeholders replacing "Loading…" text |
| Scope | **Whole app** — Login, public Track, and Admin (dashboard, table, detail, modals) |

## Components to build (reusable primitives)

1. **Theme tokens** — extend `tailwind.config.ts` + `src/app/globals.css`:
   - Mesh background tokens; glass-surface tokens (`--glass-bg: rgba(255,255,255,.07)`, `--glass-border: rgba(255,255,255,.13)`, blur radius).
   - Dark-glass text tokens: ink `#EAFFF5`, muted `#9FBCB0` (verified AA).
   - **Brightened status-chip variants** — translucent bright-on-dark replacements for the current `bg-*-100/text-*-700` chips (`STATUS_COLORS` + `ROW_URGENCY_STYLES` in `src/lib/constants/statusColors.ts` gain dark-glass variants).

2. **`<GradientMesh>`** (`src/components/motion/`) — evolves `AuroraBackground`. Animated green radial-gradient mesh, mounted once per layout. CSS-driven. `prefers-reduced-motion` → static.

3. **`<Field>`** (`src/components/ui/`) — glass input with floating label + glow ring + lift. Wraps `<input>` / `<textarea>` / `<select>`. Replaces raw fields in: login, track search, `AddJobForm`, `FilterBar`, `DeliveryDateEdit`, and the modals.

4. **`<CyclingStatus>` / button loading** (`src/components/ui/`) — spinner + cycling status text. Used by login, Add Job, Save (delivery date, comments), status-change submits.

5. **`<Skeleton>`** (`src/components/ui/`) — shimmer placeholders. Used by `HistoryPanel`, track data first-paint, `JobsTable` first-paint, dashboard cards.

## Per-surface application

- **Login (`(auth)/login`)** — full mesh + glass card + `<Field>` + cycling-status sign-in button.
- **Track layout + pages** — mesh background (replaces current gradient + aurora); all cards become glass; search uses `<Field>`; data fetch shows skeletons via `<Skeleton>`. Keep existing GSAP reveals.
- **Admin layout + dashboard + table + detail + modals** — mesh page background; `DashboardSummaryCard`, `JobsTable`, `JobRow`, `JobDetailClient`, `HistoryPanel`, and all 6 modals (`ModalBackdrop`) become frosted-glass panels with light text + bright chips. Header bar stays deep-green with the logo. Fields/loaders upgraded.

## Accessibility & performance guardrails

- **Contrast:** AA verified for text + chips on glass (see hard requirement).
- **Reduced motion:** `prefers-reduced-motion` disables mesh drift, skeleton shimmer, and field lift (keeps a static, visible end state — never leaves content hidden).
- **No hidden content:** any focus/reveal animation must have a safe visible fallback; do not ship elements stuck at `opacity:0` if JS/animation doesn't run.
- **backdrop-filter cost:** apply `backdrop-filter` only to panel containers, never per-row, to avoid GPU jank. Mesh + shimmer are CSS, not GSAP.
- **Mobile:** preserve existing 44px tap targets and the mobile bottom-sheet modal behavior.

## Out of scope

- The code-quality refactors from the earlier review (shared status-change hook, `<Modal>` primitive a11y, dedup) are **not** part of this work. Where a primitive here (e.g. `<Field>`) naturally reduces duplication, that's a welcome side effect, but no behavior refactors.
- No data model, API, or auth changes.

## Acceptance criteria

- [ ] Glass-mesh background visible on login, track, and admin.
- [ ] All text and status chips pass WCAG AA contrast on their glass surfaces (readability hard requirement).
- [ ] Every text input/select/textarea uses the floating-label + glow + lift `<Field>`.
- [ ] Action buttons show cycling status text while loading; content areas show skeletons.
- [ ] `prefers-reduced-motion` yields a static, fully-visible UI (no hidden/blank content).
- [ ] `next build`, `tsc`, and `next lint` all pass.
- [ ] App behavior unchanged (no logic/data regressions) — verified by manual run of login → track → admin flows.
