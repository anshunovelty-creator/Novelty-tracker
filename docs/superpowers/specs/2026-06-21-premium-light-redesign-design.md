# Premium Light Redesign — Design Spec

**Date:** 2026-06-21
**Scope:** Visual redesign of the Novelty Labels Job Tracker portal — admin (staff), login, and customer tracking pages.
**Goal:** Replace the current monotone dark green-mesh look (which reads "cheap" and inconsistent) with a calm, premium light theme that staff *enjoy* using to update job status. Animations are kept; only the visual/premium layer changes.

---

## Problem

The app is currently in a half-migrated state that undermines its premium feel:

- The **modals** are built for a light theme (`bg-amber-50`, `text-brand-accent`, white wells).
- The **table, badges, summary cards, header, and backgrounds** were later wrapped in a dark glass-mesh theme (`--glass-ink`, `bg-amber-400/15`, `text-white/80`, `mesh-bg`).

These two themes fight each other. Combined with a single saturated green washing the entire environment, the result lacks depth, hierarchy, and polish.

## Direction (approved)

**Light premium** — warm off-white canvas, pure-white cards floating on soft green-tinted shadows, with emerald used only as an *accent* (status, actions, focus, progress). A subtle animated light aurora retains the existing motion. Resolves the light/dark conflict by committing fully to light.

---

## 1. Design tokens — palette

| Token (semantic) | Hex | Use |
|---|---|---|
| Canvas | `#F6F8F6` | page background |
| Surface | `#FFFFFF` | cards, table, modals |
| Surface-2 | `#F1F4F1` | wells, insets, table header row |
| Hairline | `#E6EBE7` | 1px borders / dividers |
| Ink | `#0D241C` | headings, key numbers |
| Ink-muted | `#5C6E65` | secondary text |
| Ink-subtle | `#8A9991` | labels, captions |
| Primary | `#10553F` → `#0C4232` (hover) | button / brand fills |
| Accent | `#16A06A` | active status, focus ring, progress bar, live dots |

These are applied by **redefining the existing CSS variables** so most components inherit the new look automatically:

- `--glass-ink` → `#0D241C` (now the dark ink, since text sits on light)
- `--glass-muted` → `#5C6E65`
- `--glass-bg` / `--glass-bg-strong` → opaque/near-opaque white surfaces
- `--glass-border` → `#E6EBE7`
- New: `--surface-2`, `--ink-subtle`, `--accent`, and a shadow scale (below).

## 2. Depth language (the premium "sauce")

Depth, not extra color, drives the premium feel:

- **Soft, green-tinted layered shadows** (never flat gray):
  - `--shadow-sm`: `0 1px 2px rgba(13,36,28,.06)`
  - `--shadow-md` (cards): `0 1px 3px rgba(13,36,28,.06), 0 10px 30px -12px rgba(13,36,28,.14)`
  - `--shadow-lg` (modal / hover lift): `0 20px 50px -16px rgba(13,36,28,.22)`
  - `--ring-focus`: `0 0 0 4px rgba(22,160,106,.18)`
- **Hairline 1px borders** (`--hairline`) on cards, table rows, inputs.
- **Larger radii**: `rounded-2xl` on cards/modals, `rounded-xl` on controls.
- **More whitespace**: generous card padding, comfortable table row height.

## 3. Typography

- Headings: DM Sans, `tracking-tight`, ink.
- Numbers (PO, PM code, quantities, dates): DM Mono, `tabular-nums`.
- Labels/captions: small (10–11px), uppercase, letter-spaced, ink-subtle.
- No new fonts; the existing DM Sans / DM Mono pairing is kept.

## 4. Component treatments

- **AdminHeader** — white/frosted sticky bar with `backdrop-blur`, hairline bottom border, thin emerald accent line. **Dark logo** (`onDark={false}` — remove the white-invert filter). Department shown as a soft pill chip.
- **DashboardSummaryCard** — white cards, soft shadow, subtle hover lift, generous padding. Large count-up numbers in ink; each metric keeps a semantic accent color (On Hold amber, Due-this-week sky, Dispatched emerald).
- **JobsTable / JobRow** — white surface, `Surface-2` header row, hairline row dividers, comfortable height. Urgency = clean **left accent bar + faint tint** (existing logic in `ROW_URGENCY_STYLES`, recolored for light).
- **Status pills** (`statusColors.ts`) — calm light tints with saturated text, replacing the muddy `/15`-opacity-on-white set:
  - Dispatched / In Printing / PO Closed: bg `#E7F5EE`, text `#0B6B43`
  - QC / Slitting / Prepress: bg `#E8F1FB`, text `#1E6FB8`
  - On Hold / Partial Dispatch / Sample / Ready: bg `#FBF1E0`, text `#9A6510`
  - Artwork / Packing: bg `#F1ECFB`, text `#6B46C1`
  - PO Received: bg `#F0F3F0`, text `#5C6E65`
  - (Job-type and urgent-priority badges recolored to match.)
- **Modals** — already light; align to new tokens, lift to `--shadow-lg`, soften corners. `--glass-bg`/`--glass-border` inputs flip to light automatically; the dark `[&>option]` overrides are removed where present.
- **Field / SelectField** — light inputs: white/`Surface-2` bg, hairline border, emerald focus ring + lift; floating label in ink-subtle → emerald on focus.

## 5. Hero interaction — status updates that feel good

The daily job is staff updating status, so this gets dedicated polish:

- The status `<select>` is restyled as a **polished color-coded pill** (status tint background, chevron, hover lift + shadow, ≥44px tap target).
- On a successful status change, the row plays a **brief emerald highlight flash that fades out (~600ms)** alongside the existing success toast — a small, satisfying confirmation.
- Completed-stage `✓` markers in the dropdown are cleaned up for the light option list.
- All motion respects `prefers-reduced-motion` (flash disabled, no drift).

## 6. Background — subtle light aurora

- `mesh-bg` recolors from the dark green gradient to a **warm off-white base** with **2–3 very faint mint/emerald radial glows (~10–16% opacity)** in the corners.
- `GradientMesh.tsx` and `AuroraBackground.tsx` keep their drifting GSAP/CSS motion; only the blob colors/opacity change (light mint instead of dark green).
- `prefers-reduced-motion` continues to freeze drift.

---

## Architecture / approach

**Token-first migration** (chosen over a full per-component rewrite or a dual-theme toggle):

1. Redefine CSS variables + `.glass` / `.mesh-bg` utilities to light values in `globals.css`; add shadow/ring tokens and a `row-flash` keyframe.
2. Extend `tailwind.config.ts` brand tokens (light values, accent, shadow scale).
3. Rewrite `statusColors.ts` maps (status pills, row urgency, job-type/urgent badges) for light.
4. Recolor the two background components (`GradientMesh.tsx`, `AuroraBackground.tsx`).
5. Targeted edits to components that hardcode dark utilities: `AdminHeader.tsx`, `DashboardSummaryCard.tsx`, `JobsTable.tsx`, `JobRow.tsx`, `Field.tsx`, `track/page.tsx`, `track/layout.tsx`, and the track components with `text-white` headings.
6. Switch `Logo` usages from `onDark` to dark where the background is now light.

This keeps all animation logic intact and reaches a consistent result with the least churn and risk.

### Files in scope

- `src/app/globals.css`
- `tailwind.config.ts`
- `src/lib/constants/statusColors.ts`
- `src/components/motion/GradientMesh.tsx`, `src/components/motion/AuroraBackground.tsx`
- `src/components/admin/AdminHeader.tsx`, `DashboardSummaryCard.tsx`, `JobsTable.tsx`, `JobRow.tsx`
- `src/components/ui/Field.tsx`
- `src/components/admin/modals/index.tsx` (token alignment only)
- `src/app/track/page.tsx`, `src/app/track/layout.tsx`, and track components using `text-white`
- `src/app/(auth)/login/page.tsx` (verify contrast after token flip)
- `src/components/brand/Logo.tsx` usages (onDark → dark on light surfaces)

## Out of scope

- No changes to data flow, API routes, Supabase queries, auth, or business logic.
- No new fonts or dependencies.
- No new features; visual layer only.
- No dual light/dark theme toggle.

## Success criteria

- One consistent light premium theme across admin, login, and track pages — no leftover dark-glass or light/dark conflicts.
- Cards/table visibly "float" via soft green-tinted shadows; clear typographic hierarchy.
- Status pills are legible and calm; changing a status produces a satisfying confirmation flash.
- All existing animations still run and still respect `prefers-reduced-motion`.
- No regressions in status-update, dispatch, hold, or close-PO flows.
