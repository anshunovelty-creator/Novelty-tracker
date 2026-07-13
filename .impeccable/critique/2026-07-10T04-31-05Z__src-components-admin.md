---
target: the admin surface
total_score: 28
p0_count: 0
p1_count: 1
timestamp: 2026-07-10T04-31-05Z
slug: src-components-admin
---
Method: ⚠️ DEGRADED: single-context (harness restricts spawning sub-agents unless the user explicitly asks; A + B run by the primary context)

# Critique — Admin Surface (`src/components/admin`)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Strong (toasts, skeletons, loading bar, live pulse, optimistic updates); MachineBoard falls back to bare "Loading machines…" text instead of the app's skeleton. |
| 2 | Match System / Real World | 3 | Domain language is excellent (PO, PM, releases, shade card, QC, dispatch). Emoji ✓/🔒 packed into `<option>` labels is slightly off. |
| 3 | User Control and Freedom | 3 | Modals have Cancel + Escape + backdrop-close; destructive actions confirm. No undo on a mis-set stage (audit trail logs it, but recovery is manual re-select). |
| 4 | Consistency and Standards | 3 | Vocabulary is very consistent; dinged by the stage `<select>` focus ring diverging from the app's focus bloom, `text-red-500` in history, and MachineBoard's non-skeleton loading. |
| 5 | Error Prevention | 3 | Excellent: server-enforced sequential stages + warning modal, qty caps, required remarks, dept locks, confirm dialogs. Near a 4. |
| 6 | Recognition Rather Than Recall | 3 | Completed ✓ in dropdown, locks show whose turn it is; MachineBoard queue leans on icon-only buttons + title tooltips. |
| 7 | Flexibility and Efficiency | 2 | No keyboard shortcuts, no bulk stage updates, no saved filters — on the tool's highest-frequency action. Weakest axis. |
| 8 | Aesthetic and Minimalist Design | 3 | Clean, restrained glass. MachineBoard is busy but purposeful. |
| 9 | Error Recovery | 3 | Inline validation + toast errors with retry guidance + surfaced server messages. `text-red-500` raw error is off-vocabulary. |
| 10 | Help and Documentation | 2 | Great inline "visible to the client" hints; no contextual help or first-run guidance for a new floor operator. |
| **Total** | | **28/40** | **Good (bottom of band) — solid foundation, real gaps in efficiency + a few consistency/a11y warts** |

## Anti-Patterns Verdict

**Does this look AI-generated? No.** This passes the product slop test: a user fluent in Linear/Stripe would sit down and trust it. The modal infrastructure (focus trap, Escape, focus return, scroll lock, `aria-modal`, `useId`-linked labels, bottom-sheet-on-mobile) is genuinely crafted, not scaffolded. The status vocabulary is a single source of truth (`statusColors.ts`), numbers are mono/tabular everywhere, and department permissions render as inline affordances. The tells that exist are small: emoji-as-data in `<option>` labels, a few off-palette colors.

**Deterministic scan:** `detect.mjs` on the `.tsx` files returned **0 findings** (it scans HTML/CSS). On `globals.css` it flagged **3 advisory color-drift hits** — `rgba(0,0,0,0.45)` (modal backdrop, line 98) and the two mesh radial-gradient colors `rgba(46,200,140,.55)` / `rgba(20,120,90,.60)` (lines 151–152) sitting outside DESIGN.md's palette. These are legitimate atmosphere colors; they should be promoted into DESIGN.md as named mesh stops rather than left as drift.

**Visual overlays:** Not run — dev server is off and I did not start a browser session for this pass. No user-visible overlay is claimed.

## Overall Impression

This is a well-built internal tool that already carries itself like a product. The states are designed (skeletons, empty states that teach, disabled/loading/error), the vocabulary is consistent, and the risky operations are guarded. The single biggest opportunity isn't visual — it's **efficiency on the highest-frequency action**. The whole product thesis is "fast on the floor," yet updating a job's stage is a native `<select>` with no keyboard accelerator, no bulk path, and — most concretely — a **focus indicator you can't see**. Fix the primary control and you close the gap between the product's stated principle and what the surface actually delivers.

## What's Working

1. **The modal system is Linear/Stripe-grade.** `ModalShell` gives every dialog a real focus trap, Escape, focus return to trigger, scroll lock, and `aria-modal` + `aria-labelledby` — then reshapes into a bottom sheet under 500px. Every stage modal reuses it, so behavior is identical everywhere. This is the strongest part of the surface.
2. **States are first-class.** Skeleton rows/text on load, filter-aware empty copy ("No jobs match your filters." vs "No active jobs. Add one above."), an indeterminate refetch bar, optimistic row updates with toasts, and disabled/`busy` states on every async button. The unhappy paths are actually designed.
3. **Department-aware affordances.** `RunAdvanceControl` shows either the action button or a lock naming whose turn it is; the stage dropdown marks locked options and completed stages. Recognition over recall, and permissions are legible instead of hidden.

## Priority Issues

### [P1] The stage `<select>` has a near-invisible focus ring on the app's #1 control
- **Where:** `JobRow.tsx:304` and `JobDetailClient.tsx:261` — `focus:ring-2 focus:ring-brand-accent/20`. `brand-accent` resolves to `#0C2A20` (≈ ink/near-black); at 20% opacity over the dark mesh it's imperceptible.
- **Why it matters:** Changing a job's stage is the highest-frequency action in the whole app, and keyboard users get no visible focus indicator on it — a WCAG 2.4.7 failure. It's also the one input that *doesn't* use the app's own emerald "focus bloom" that every `Field`, `DeliveryDateEdit`, and modal input uses, so it's inconsistent with your own system.
- **Fix:** Replace the accent ring with the established bloom: emerald border (`focus:border-emerald-300/70`) + `focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)]`, matching `inputCls` in `modals/index.tsx` and `DeliveryDateEdit`.
- **Suggested command:** `/impeccable audit` (a11y focus states), then `/impeccable polish`.

### [P2] MachineBoard is the cognitive-load and touch hotspot
- **Where:** `MachineBoard.tsx` — each queue row carries five controls (↑ ↓ edit start ✕), four of them icon-only relying on `title` tooltips; two-column card grid; datetime inputs with 10–11px labels.
- **Why it matters:** `title` tooltips don't appear on touch, and touch is a primary input for this tool. On a phone, a column of unlabeled icon buttons per queued job is ambiguous (Casey/Ravi), and the density pushes past the ~4-item working-memory guideline per decision point. The global `min-width:44px` rule (good for tap targets) also forces every `w-6 h-6` icon button to 44px, so these rows are far wider than the class names imply and will wrap/overflow inside the 2-col grid on smaller widths.
- **Fix:** Reduce per-row actions to the primary one (Start) plus an overflow menu for reorder/edit/remove; give the queue a genuine skeleton on load instead of "Loading machines…"; bump the 10px form labels to 11–12px. Verify the row at 375px width.
- **Suggested command:** `/impeccable audit` (responsive + touch), then `/impeccable layout`.

### [P2] Off-vocabulary colors and one non-designed loading state
- **Where:** `HistoryPanel.tsx:56` uses `text-red-500` (raw Tailwind red, not the panel's `red-200/300` glass vocabulary); `JobRow.tsx:306–307` / `JobDetailClient.tsx:263–264` fall back to `bg-gray-100`/`text-gray-700` for an unknown status (light-on-light, broken on the dark theme if ever hit); `MachineBoard.tsx:124` shows bare "Loading machines…" text instead of a skeleton.
- **Why it matters:** These are small consistency leaks in a system whose whole promise is a single, precise vocabulary. The gray fallback would be unreadable on the mesh if a status ever falls outside the map.
- **Fix:** Swap `text-red-500` → `text-red-300`; change the select fallback to a glass-safe tint (e.g. `bg-white/10 text-white/80`); replace the MachineBoard loading text with the shared skeleton shaped to the board.
- **Suggested command:** `/impeccable polish`.

### [P2] No power-user acceleration on the highest-frequency task
- **Where:** the whole jobs table — stage changes are one native select at a time; no keyboard shortcuts, no multi-select/bulk stage update, no saved/pinned filters.
- **Why it matters:** "Fast on the floor" is design principle #4, and a coordinator moving ten jobs to the next stage clicks through ten selects with ten confirmation paths. There's a real ceiling here for the Alex persona.
- **Fix:** Consider row multi-select with a bulk "advance stage" action for the non-modal stages, and/or keyboard focus + type-to-set on the select. Scope this deliberately — it's a feature, not a polish pass.
- **Suggested command:** `/impeccable shape` (design the bulk/keyboard flow before building).

### [P3] Emoji used as data inside `<option>` labels
- **Where:** `JobRow.tsx:321` / `JobDetailClient.tsx:274` — `{allowed ? '' : '🔒 '}${completed ? '✓ ' : ''}${stage}`.
- **Why it matters:** Emoji-in-option-text is the one mild "match real world" wart; native selects render it inconsistently across OSes and it can't be styled. Minor, but it's the clearest AI-adjacent tell on the surface.
- **Fix:** If the stage picker ever becomes a custom popover (see P2), move lock/complete state to real iconography + disabled styling; until then it's acceptable.
- **Suggested command:** `/impeccable polish`.

## Persona Red Flags

**Alex (Power User):** No keyboard shortcuts anywhere. No bulk stage update — advancing many jobs is one select + one modal each. No saved filters; the search/status/urgent filters reset on reload. Will feel the tool is slower than it should be for a daily-driver.

**Sam (Accessibility):** The stage `<select>` focus ring is effectively invisible (P1) — keyboard users lose their place on the primary control. Urgency is carried partly by near-imperceptible row background tints (`red-400/11%` vs `orange-400/9%` vs `yellow-400/7%`), though the `P1/P2/P3` text badge saves it from being color-only. Icon-only machine controls have `aria-label` (good), but the `title`-only affordances give nothing to touch users.

**Ravi (Floor Operator, project persona — phone, factory floor, glances between machine and screen):** Updates a stage on a phone via the OS-native picker listing all 15 stages including locked (🔒) ones he can't pick. On the MachineBoard, five tiny icon buttons per queued job with tooltips he can't see on touch. State isn't a problem (server is source of truth), but the primary interactions weren't shaped for the thumb the way the principle promises.

## Minor Observations
- The 3 `globals.css` mesh/backdrop colors should be promoted into DESIGN.md as named tokens (close the detector's advisory drift).
- Global `min-height/width:44px` on all buttons is great for touch but silently overrides the intended 24px icon-button sizing — worth being intentional about where dense desktop vs. floor-touch wins.
- `HistoryPanel` refetches the full job on every `refreshKey` (stage change) — fine functionally; watch it if rows get heavy.

## Questions to Consider
- What would updating five jobs' stages in five seconds actually look like? Does the answer change the table's row model?
- Is the native `<select>` the right home for the app's most important action, or is it there because "forms use selects"?
- The MachineBoard does a lot per card — which one thing does a Production operator need to see the instant the board loads, and can everything else recede?
