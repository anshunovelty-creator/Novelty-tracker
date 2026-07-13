---
target: the admin surface
total_score: 30
p0_count: 0
p1_count: 0
timestamp: 2026-07-10T05-01-41Z
slug: src-components-admin
---
Method: ⚠️ DEGRADED: single-context (harness restricts spawning sub-agents; A + B run by the primary context)

# Critique (re-run) — Admin Surface (`src/components/admin`)

Second pass after the polish + layout fixes, and after confirming one-by-one stage updates are intentional (bulk is a non-goal, not a gap).

## Design Health Score

| # | Heuristic | Score | Δ | Key Issue |
|---|-----------|-------|---|-----------|
| 1 | Visibility of System Status | 3 | – | MachineBoard now uses a shaped skeleton; feedback is strong across the surface. |
| 2 | Match System / Real World | 3 | – | Emoji ✓/🔒 in `<option>` labels remains (P3). |
| 3 | User Control and Freedom | 3 | – | Overflow menu adds Escape/outside-click dismissal; no undo on a mis-set stage. |
| 4 | Consistency and Standards | 4 | ▲ | The three baseline offenders are fixed: select focus bloom, `text-red-300`, skeleton loading. Minor: MachineBoard inputs still lack the focus bloom. |
| 5 | Error Prevention | 3 | – | Server-enforced sequence, qty caps, required remarks, dept locks, confirms. |
| 6 | Recognition Rather Than Recall | 3 | – | Overflow menu keeps labels; locks show whose turn. |
| 7 | Flexibility and Efficiency | 3 | ▲ | Reassessed: one-by-one is by design, so "no bulk" is void. Single-job flow is now keyboard-accessible (focus bloom). No saved filters (minor). |
| 8 | Aesthetic and Minimalist Design | 3 | – | MachineBoard queue row de-cluttered (5 buttons → Start + overflow). |
| 9 | Error Recovery | 3 | – | Inline validation + toast retry guidance; error color now on-vocabulary. |
| 10 | Help and Documentation | 2 | – | Good inline "visible to client" hints; still no first-run guidance for a new operator. |
| **Total** | | **30/40** | **▲ +2** | **Good — consistency and efficiency improved; remaining gaps are minor polish + help.** |

## Anti-Patterns Verdict
**Still not AI-generated.** Deterministic scan is clean on both `globals.css` (`[]`, the 3 color-drift advisories closed by promoting them to documented tokens) and the admin `.tsx` files (`0`). The overflow menu uses a solid `#0A1F18` surface (off the glass-on-glass ladder) and a portal to escape clipping — on-system, not a slop pattern.

## What Changed Since 28/40
- **[was P1] Stage select focus ring** → now the app's emerald focus bloom in `JobRow` + `JobDetailClient`. WCAG 2.4.7 gap closed on the highest-frequency control.
- **[was P2] Off-vocabulary colors** → `text-red-300`, glass-safe select fallback; `globals.css` mesh/scrim colors promoted to CSS tokens + documented in DESIGN.md.
- **[was P2] MachineBoard loading** → shared skeleton shaped to the board.
- **[was P2] MachineBoard density/touch** → text floor 10→11px, 44px min-height on all inputs, and the 5-button queue row collapsed to **Start + `⋯` overflow menu** (portalled, keyboard-navigable, dismiss on Esc/outside/scroll).
- **[was P2] "No bulk actions"** → retired as a finding; one-by-one is the intended model.

## Remaining (minor)
- **[P3]** MachineBoard inputs don't use the emerald focus bloom (browser default outline still shows — theming consistency, not a11y). → `/impeccable polish`
- **[P3]** Emoji as data in `<option>` labels. → acceptable until/unless the picker becomes custom.
- **[P3]** Off-ladder `white/[0.05–0.06]` alphas in MachineBoard; snap to the 7%/12% glass ladder. → `/impeccable polish`
- **[P3]** No `aria-live` on the 60s live board updates; machine name is `<p>` not a heading. → `/impeccable harden`
- **[P2, unverified]** The overflow menu's fixed-position placement and close-on-scroll are unconfirmed in a browser (extension not connected). Needs a visual check at 375px.

## Persona Red Flags (delta)
- **Alex (Power User):** bulk knock retired; the single-job flow is intentional and now keyboard-reachable. Residual: no saved filters.
- **Sam (Accessibility):** the invisible-focus-ring blocker is gone. Overflow menu is keyboard-operable with focus return. Residual: silent live updates (no `aria-live`).
- **Ravi (Floor Operator):** queue row is far less cramped (one primary Start + overflow); inputs now meet 44px. Residual: OS-native stage picker still lists locked stages.

## Questions to Consider
- Is a first-run/empty-department view worth designing (the one axis that didn't move, Help = 2)?
- Should the MachineBoard inputs adopt the focus bloom now, or is the default outline acceptable there?
