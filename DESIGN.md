---
name: Novelty Labels Tracker
description: Deep-green glass control room for a label printing production pipeline
colors:
  press-green: "#10553F"
  press-green-deep: "#0C4232"
  mesh-teal: "#0F4A37"
  press-ink: "#0A1F18"
  mesh-glow-emerald: "rgba(46,200,140,0.55)"
  mesh-glow-teal: "rgba(20,120,90,0.60)"
  mesh-core: "rgba(12,66,50,0.90)"
  scrim: "rgba(0,0,0,0.45)"
  glass-ink: "#EAFFF5"
  glass-muted: "#9FBCB0"
  glass-bg: "#FFFFFF12"
  glass-bg-strong: "#FFFFFF1F"
  glass-border: "#FFFFFF24"
  success: "#1B7A4E"
  warning: "#C2740C"
  danger: "#C0392B"
typography:
  headline:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "DM Sans, system-ui, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 500
    letterSpacing: "0.025em"
  data:
    fontFamily: "DM Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
components:
  button-primary:
    backgroundColor: "{colors.press-green}"
    textColor: "#FFFFFF"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-primary-hover:
    backgroundColor: "{colors.press-green-deep}"
    textColor: "#FFFFFF"
  button-ghost:
    backgroundColor: "#FFFFFF00"
    textColor: "{colors.glass-muted}"
    rounded: "{rounded.md}"
    padding: "6px 12px"
  button-ghost-hover:
    backgroundColor: "#FFFFFF1A"
    textColor: "{colors.glass-ink}"
  badge-status:
    backgroundColor: "#34D39926"
    textColor: "#A7F3D0"
    rounded: "{rounded.full}"
    padding: "2px 8px"
  input-field:
    backgroundColor: "{colors.glass-bg}"
    textColor: "{colors.glass-ink}"
    rounded: "{rounded.lg}"
    padding: "20px 14px 8px"
  card-glass:
    backgroundColor: "{colors.glass-bg}"
    rounded: "{rounded.xl}"
    padding: "20px"
---

# Design System: Novelty Labels Tracker

## 1. Overview

**Creative North Star: "The Control Room"**

A calm, glass-walled control room overlooking the factory floor: every job visible, nothing shouting. The entire interface lives on a single deep-green atmosphere, the Press Green mesh, a slowly drifting gradient of emerald and teal over near-black Press Ink (#0A1F18). Content sits on frosted glass panels that let the atmosphere show through. Depth is built by translucency, not shadow; hierarchy is built by contrast and type, not decoration. The system is premium the way precision machinery is premium: tight tolerances, consistent vocabulary, and controls that respond instantly when touched.

The system explicitly rejects the generic admin template (rows of identical stat cards, default-blue buttons, off-the-shelf dashboard grammar) and consumer-app flashiness (gradients for fun, marketing-style motion in a work tool). Every surface, glow, and animation must serve legibility or state; if an effect costs either, the effect loses.

**Key Characteristics:**
- Two themes, split by audience: the **admin panel** runs the **"Airy Green" light theme** (§2.5) — white cards on a pale mint wash, dark ink text — chosen for maximum legibility and speed on the factory floor. The public **/track portal** keeps the dark Press Green mesh + glass as its client-facing brand statement.
- Frosted glass surfaces (7–12% white + 14px blur) as the only container material
- Tactile, confident controls: focus lifts, emerald glows, instant hover feedback
- DM Mono with tabular numerals for every number, timestamp, and code
- Status is always a tinted translucent chip; color means state, never decoration

## 2. Colors: The Press Green Palette

A single deep-green identity carried by atmosphere, with translucent whites doing the structural work and small doses of spectral tint marking state.

### Primary
- **Press Green** (#10553F): the brand action color. Solid fills on primary buttons and key CTAs only. Its darker press, **Deep Press** (#0C4232), is the hover/active shade.
- **Mesh Teal** (#0F4A37) and **Press Ink** (#0A1F18): the two poles of the page-background gradient mesh (`.mesh-bg`). These are atmosphere, never component fills. The mesh's three radial glow stops — **Mesh Glow Emerald** (`rgba(46,200,140,0.55)`), **Mesh Glow Teal** (`rgba(20,120,90,0.60)`), **Mesh Core** (`rgba(12,66,50,0.90)`) — and the modal **Scrim** (`rgba(0,0,0,0.45)`) are defined as CSS tokens in `globals.css`; also atmosphere, never component fills.

### Neutral
- **Glass Ink** (#EAFFF5): primary text on glass and mesh. A faint mint cast keeps it in the green family while passing AA on every surface.
- **Glass Muted** (#9FBCB0): secondary text, ghost-button labels, metadata. AA against Press Ink; never use for body-length prose.
- **Glass surfaces**: white at 7% (#FFFFFF12) for panels, 12% (#FFFFFF1F) for emphasized panels, 14% (#FFFFFF24) for the 1px borders that edge every glass surface.

### Semantic
- **Success** (#1B7A4E), **Warning** (#C2740C), **Danger** (#C0392B): reserved for state. In the dark glass context these appear as translucent chips: `color-400` at 15–18% background with `color-200` text (e.g. `bg-emerald-400/15 text-emerald-200`), giving every production stage a consistent tinted-glass badge.

### Named Rules
**The Atmosphere Rule.** The mesh is the only place saturated green appears at full strength. Components take Press Green solid fills only for primary actions; everything else is translucent white over the atmosphere.

**The State-Only Spectrum Rule.** Sky, amber, purple, orange, red, and emerald tints exist solely to encode job state (stages, urgency, QC). Never use a spectral tint decoratively; a color a user cannot read as a status is prohibited.

### 2.5 Admin "Airy Green" Light Theme

The admin panel renders in a light theme, scoped in CSS under `.admin-light` (the admin shell root) so the `/track` portal's dark glass is untouched. It reuses the same green brand and the same status vocabulary — only the surface flips from translucent-dark to solid-light.

- **Page wash:** a soft mint atmosphere — `#F1F5F2` base with two faint radial tints (`#E2EFE8`, `#E7F1EB`). Calm, not white-clinical.
- **Cards:** solid white (`#FFFFFF`) with a 1px green-tinted border (`#E4EAE6`) and a soft ambient lift (`0 2px 8px rgba(12,42,32,0.05)`). Emphasis/hover surfaces take a faint mint tint (`#F4F8F5`). This replaces the glass ladder: hierarchy climbs white → mint-tint → shadow, not translucency.
- **Text:** Ink `#0C2A20` primary, Muted `#5A6B62` secondary (both AA on white). The `--glass-ink` / `--glass-muted` tokens are re-pointed to these under `.admin-light`.
- **Header & primary actions:** unchanged — solid Press Green (`#10553F`) header and buttons with white text carry the brand into the light theme.
- **Status chips (light):** solid pastel — `color-100` fill + `color-200` border + `color-700/800` text (e.g. In Printing = `emerald-100 / emerald-300 / emerald-800`; Dispatched = solid `emerald-600` on white). Defined in `statusColors.ts`. This is the light counterpart to the dark tinted-glass chip; color still means state, never decoration.
- **Row urgency tints (light):** `color-50` row backgrounds (`amber-50` on-hold, `red-50`/`orange-50`/`yellow-50` urgency, `sky-50` QC). No left-stripe borders.

The State-Only Spectrum Rule and the Mono Number Rule apply identically in both themes.

## 3. Typography

**Body/UI Font:** DM Sans (with system-ui fallback)
**Data Font:** DM Mono (with ui-monospace fallback), always `tabular-nums`

**Character:** One geometric-humanist sans carries the entire UI; the mono is its technical counterpart for anything a user might compare, count, or copy. The pairing reads precise and workmanlike, never showy.

### Hierarchy
- **Headline** (600, 1.25rem, 1.3): page titles and modal titles.
- **Title** (600, 1rem, 1.4): panel and card headings, job names.
- **Body** (400, 0.875rem, 1.5): the workhorse size for table cells, forms, and descriptions. Cap prose at 65–75ch.
- **Label** (500, 10–11px, 0.025em tracking, uppercase): floating field labels and micro-metadata. This is the only uppercase in the system.
- **Data** (DM Mono, 0.75rem): PO numbers, quantities, dates, countdowns, department codes. If it's a number, it's mono.

### Named Rules
**The Mono Number Rule.** Every numeric value renders in DM Mono with tabular numerals, everywhere, with no exceptions. Columns of quantities must align digit-for-digit.

## 4. Elevation

Depth is conveyed by translucency, not shadow. The glass ladder does the structural work: mesh atmosphere at the bottom, 7% white panels above it, 12% white for emphasized or interactive-hover surfaces, and a 1px 14% white border giving every pane its edge. Shadows exist only as ambient support, a soft, distant `0 8px 30px rgba(0,0,0,0.18)` under floating panels and modals, and as the emerald focus bloom (`0 0 0 4px rgba(124,240,190,0.22)`) that answers user input.

### Shadow Vocabulary
- **Ambient float** (`box-shadow: 0 8px 30px rgba(0,0,0,0.18)`): floating cards, modals, and popovers only. Never on in-flow panels.
- **Focus bloom** (`box-shadow: 0 0 0 4px rgba(124,240,190,0.22), 0 10px 26px rgba(0,0,0,0.25)`): focused inputs and controls. This is feedback, not decoration.

### Named Rules
**The Glass Ladder Rule.** Hierarchy climbs the translucency ladder (0% → 7% → 12% white). If a surface needs to feel higher, make it lighter, not shadowed.

## 5. Components

Controls are tactile and confident: they lift, glow, and answer immediately. Minimum tap target is 44px on every interactive element; touch is a primary input.

### Buttons
- **Shape:** softly rounded (8px); compact paddings (`px-3 py-1.5` at text-xs is the standard density).
- **Primary:** solid Press Green (#10553F) with white text; hover deepens to Deep Press (#0C4232) or 90% opacity. One primary action per view region.
- **Ghost:** transparent with 1px 10% white border and Glass Muted text; hover fills 10% white and brightens text to Glass Ink.
- **Tinted action:** for state-adjacent actions (approve, dispatch), a translucent chip-style button (`bg-emerald-400/15 border-emerald-300/30 text-emerald-200`, hover deepens to /25).
- **States:** `disabled:opacity-40`, active press feedback, focus bloom on keyboard focus.

### Chips / Status Badges
- **Style:** full-radius pill, translucent tint background (color-400 at 15–18%) with the matching color-200 text; `text-xs px-2 py-0.5` at standard density.
- **State:** the chip IS the state; one chip per job row, colored strictly by the stage map in `statusColors.ts`.

### Cards / Containers
- **Corner Style:** 12px (`rounded-xl`) for panels, 16px (`rounded-2xl`) for feature cards and modals.
- **Background:** `.glass` (7% white + 14px backdrop blur); `.glass-strong` (12%) for emphasis.
- **Border:** always 1px at 14% white; a glass pane without its edge reads as a smudge.
- **Shadow Strategy:** none in-flow; ambient float only when the card floats (see Elevation).
- **Internal Padding:** 12–20px, denser in tables, looser in feature cards.

### Inputs / Fields
- **Style:** glass surface (7% white, 12px radius) with a floating label that starts as placeholder-position text (white/60) and collapses to a 10px uppercase emerald label on focus or fill.
- **Focus:** border shifts to emerald-300/70, surface lightens to 14% white, focus bloom appears, and the field lifts 2px (`focus:-translate-y-0.5`, suppressed under reduced motion).
- **Error / Disabled:** danger-tinted border + message below the field; disabled at 40% opacity.

### Navigation
- **Style:** slim 56px sticky header on solid Press Green (#10553F) with the logo left and identity/session right; department name in DM Mono at white/75. Mobile keeps the same bar; content scrolls beneath.

### Live Status Dot (signature)
A 1.5px-radius dot pulsing via `pulse-ring` (scale 1 → 1.4, 1.5s), used exclusively to mark genuinely live/in-progress state (active stage, auto-refresh). One pulsing dot per section, maximum; it stops under reduced motion.

### Skeleton (loading)
Shimmering glass bars (7% → 20% white sweep, 1.4s) shaped to match the final layout. Spinners in content areas are prohibited.

## 6. Do's and Don'ts

### Do:
- **Do** render every screen over the Press Green mesh with glass panels; the atmosphere is the brand.
- **Do** give every glass surface its 1px 14% white border and every number DM Mono tabular figures.
- **Do** answer every interaction within 200ms of visual feedback: hover fills, focus blooms, press states, optimistic chip updates.
- **Do** design loading (skeleton), empty, error, on-hold, and overdue states as first-class layouts; unhappy paths are where trust is won.
- **Do** keep 44px minimum tap targets and `prefers-reduced-motion` alternatives on all animation, including the mesh drift, shimmer, and field lift.

### Don't:
- **Don't** build "generic admin template" surfaces: no rows of identical stat cards, no default-blue buttons, no off-the-shelf dashboard grammar (PRODUCT.md anti-reference, verbatim).
- **Don't** be "consumer-app flashy": no gradients for fun, no confetti, no marketing-style motion inside the work tool (PRODUCT.md anti-reference, verbatim).
- **Don't** use spectral color decoratively; if a tint doesn't encode job state, it doesn't ship.
- **Don't** add new thick left-stripe urgency borders (`border-l-4`). The existing row stripes are legacy; new urgency treatments use the row's background tint plus its badge. Phase stripes out on touch.
- **Don't** stack glass on glass on glass. Two translucency levels deep, maximum; a third layer must be solid (e.g. option lists on #0A1F18).
- **Don't** drop text below AA: Glass Muted (#9FBCB0) is the floor for secondary text and never carries body-length prose.
