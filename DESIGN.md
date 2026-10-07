---
name: Control Room
description: Design system of the Label Print Tracker — light "Airy Green" admin, Press Green glass for /track and the wall display
source: https://claude.ai/artifact/9Sgz8tFCoZhfxhqU15khuK (Control Room design system — the browsable reference)
updated: 2026-10-03
colors:
  brand: "#10553F"            # Press Green: header, the one primary button, selected states, progress fills
  brand-deep: "#0C4232"       # hover / pressed
  mint: "#7CF0BE"             # accent on dark grounds only (live dots, toast icon, notes badge)
  on-brand: "#FFFFFF"
  bg: "#F4F7F5"               # admin page ground   (dark: #0A1F18 + mesh)
  surface: "#FFFFFF"          # cards, tables, menus (dark: rgba(255,255,255,.07) glass)
  surface-alt: "#F5F9F7"      # zebra rows, search wells, footers
  surface-hover: "#EAF3EE"    # hovered row / menu item
  surface-sunken: "#EEF2EF"   # progress & segmented tracks
  line: "#E4EAE6"             # card, input, button borders
  line-soft: "#EEF2EF"        # row dividers
  ink: "#0C2A20"              # primary text   (dark: #EAFFF5)
  ink-muted: "#5A6B62"        # THE secondary text colour, 5.6:1 on white (dark: #9FBCB0)
  ink-faint: "#94A39B"        # icons, placeholders, disabled ONLY — fails 4.5:1
  danger: "#B91C1C"
  danger-soft: "#FEF2F2"
  warning: "#92400E"
  warning-soft: "#FFFBEB"
  success: "#065F46"
  success-soft: "#ECFDF5"
  unit-1: "#DB2777"
  unit-2: "#047857"
  scrim: "rgba(10,31,24,0.45)"
stage-dots:                   # the ONLY use of these colours: Status dots and progress ticks
  PO Received: "#64748B"
  Artwork Pending: "#9333EA"
  Plate Status: "#4F46E5"
  Job Card Done: "#0284C7"
  Sample Printing: "#D97706"
  Shade Card Sent: "#EA580C"
  Shade Card Approved: "#059669"
  In Printing: "#059669"
  Slitting: "#0284C7"
  Quality Check: "#0891B2"
  Packing: "#9333EA"
  Ready to Dispatch: "#CA8A04"
  Partial Dispatch: "#D97706"
  Dispatched: "#047857"
  PO Closed: "#047857"
  On Hold: "#D97706"
typography:
  sans: "DM Sans, system-ui, sans-serif"      # everything you read
  mono: "Trispace, ui-monospace, monospace"    # everything you count or copy; tabular-nums
  page-title: { size: 30px, line: 36px, weight: 600, tracking: -0.025em }
  title:      { size: 18px, line: 24px, weight: 600 }
  heading:    { size: 16px, line: 22px, weight: 600 }
  body:       { size: 14px, line: 21px, weight: 400 }
  small:      { size: 13px, line: 19px, weight: 400 }   # second line of a row, in ink-muted
  caption:    { size: 12px, line: 16px, weight: 500 }   # table headers, sentence case, ink-muted
  eyebrow:    { size: 11px, line: 14px, weight: 600, tracking: 0.06em, uppercase: true }  # list group labels only
  data:       { family: mono, size: 13px, weight: 500 }
  data-strong:{ family: mono, size: 18px, weight: 600 }
  kpi:        { family: mono, size: 30px, weight: 600 }
spacing: { 1: 4px, 2: 8px, 3: 12px, 4: 16px, 5: 20px, 6: 24px, 8: 32px, 9: 36px, target: 44px, page-max: 1240px, header: 56px }
rounded: { sm: 6px, md: 10px, lg: 14px, xl: 16px, 2xl: 20px, pill: 9999px }
shadow:
  card: "0 1px 2px rgba(12,42,32,0.04)"
  raised: "0 2px 8px rgba(12,42,32,0.08)"
  pop: "0 18px 40px rgba(12,42,32,0.16)"      # menus, toasts, dialogs, drawers only
  focus: "0 0 0 4px rgba(16,85,63,0.18)"
---

# Control Room

**Status is the product.** Every screen first answers: what state is this job in, and what happens next? Stage, lateness and the next action win over chrome.

The browsable version of this file — tokens in both themes, live component previews, usage notes — is the **Control Room** design system artifact linked in the frontmatter. This file is the copy that lives with the code. If the two disagree, change both in the same PR.

## 1. Two themes, one vocabulary

| Theme | Where | Ground |
|---|---|---|
| **Airy Green** (light) | all of `/admin`, phones on the floor | `bg` #F4F7F5, white cards |
| **Press Green glass** (dark) | `/track`, `/display`, the sign-in brand panel | Press Ink #0A1F18 + emerald/teal mesh, 7% glass panels |

Same stage names, same Status dots, same numbers in both. Never mix the two on one screen.

## 2. Colour rules

- `brand` fills only: the 56px header, ONE primary button per region, selected states, progress fills.
- Text uses exactly two colours: `ink` and `ink-muted`. `ink-faint` is never used for words someone must read.
- Colour means state. Stage colours appear only as an 8px dot beside the stage name and as progress ticks. **No filled status pills, no tinted rows, no left-border stripes** — all retired.
- Lateness lives on the date text: `danger` "3 days late", `warning` "in 2 days".
- `*-soft` fills only for banners/callouts: shelf stock (`success-soft`), offline and on hold (`warning-soft`), refusals (`danger-soft`).
- `unit-1` / `unit-2`: the printing-unit circle with a white digit.

## 3. Type

DM Sans for words, Trispace (tabular numerals) for every job card, PO, PM code, quantity, date and time. One `page-title` per page; cards use `heading`; dialogs `title`. Table headers are `caption`, sentence case — no uppercase headers — on the mint `#EDF3EF` row that matches the pinned Sr No column (one rule in globals.css: `.admin-light thead th`). `eyebrow` uppercase only for group labels inside lists and menus (TODAY, JOBS, ACTIONS). Quantities use Indian grouping (1,20,000).

## 4. Layout

- Header 56px · content max 1240px · 24px side gutter · 36px top padding.
- Page anatomy: section nav (if the group has siblings) → page title + one-line purpose + actions right → optional summary strip → the main card.
- `gap`, not margins. Radii: buttons/inputs `md` 10px · stage select/menus/toasts `lg` 14px · cards/tables `xl` 16px · dialogs `2xl` 20px.
- Depth from borders; `shadow.pop` only for things that float.
- Every tap target ≥ 44px. Phones get cards, not tables, and a bottom bar.

## 5. Components (class prefix `cr-` in the design system's `bundle.css`)

| Component | Rule |
|---|---|
| **Button** | primary (one per region) · secondary (white, `line` border) · ghost · hold (warning-soft, for Put on hold). 44px; 56px for the single floor action on a phone. Label says what happens. |
| **Status** | dot + stage name, the only way to show a state. Non-stage states use three generic dots: ok / wait / bad. |
| **Tag** | facts that don't change: Repeat, Extra, v3. Grey `radius-sm`. "P1" in tables is plain red mono text beside the job card. |
| **Stage select** | dot, name, step count ("7/11", only the stages this job type uses), chevron, 14 ticks (skipped = pale green, held = amber). Menu: NOW, the one NEXT stage the API allows (green), the next two locked "After <stage>", then Put on hold…. Optimistic update + Toast with Undo; a refusal snaps back and says who can do it. |
| **Table** | card-wrapped; tabs + search in the card's top bar; zebra `surface-alt`; hover `surface-hover`; mono right-aligned numbers; first column the identifier. |
| **Navigation** | Header groups: Jobs · Production · Stock · Dispatch · BOM · Follow-ups · Reports, plus Ctrl K search, notes, settings. **Section nav** pills switch sibling *pages*. **Tabs** switch *views* of one list. **Segmented** picks one *setting*. Never swap them. |
| **Field** | label above, never inside. Codes/numbers/dates in mono. Focus = brand border + focus ring. Errors say how to fix. |
| **Feedback** | Toast (past tense + Undo), Banner (lasting condition), Progress (with the numbers), Skeleton (no spinners), Empty state (why + next step). |
| **Dialog** | only the facts an action needs: Add/Edit job, hold reason, QC remarks, dispatch details, split dispatch. Title names the job; the action repeats the title's verb. Bottom sheet on phones. |
| **Glass** | `/track` and `/display` only; two layers deep at most; the delivery truck is the one decorative animation. |

## 6. Voice

Short, specific, the floor's own words: job card, PO, PM code, party, rack, plates, slitting, shade card. Buttons: "Save QC and move to Packing", "Make job for 29,000". Toasts: "OCT26-14 moved to Packing". Errors: "Only Dispatch can move a job to Packing." No "Oops", no apologies. Customer copy on `/track` is warmer: "Your labels are in final quality check."

## 7. States are designed

Loading (skeleton shaped like the content), empty (why + next step), offline (changes queued on the device, banner), on hold (amber ticks + reason), refused (server said no → row snaps back, toast names who can). WCAG 2.1 AA everywhere; every animation has a `prefers-reduced-motion` fallback.

## 8. Don'ts

No generic admin template (rows of identical stat cards, default-blue buttons). No gradients, emoji or decorative motion inside the work tool. No new grey, radius, shadow or button style that isn't in this file first.
