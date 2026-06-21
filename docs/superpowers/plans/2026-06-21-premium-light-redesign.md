# Premium Light Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app's inconsistent dark green-mesh theme with one cohesive, premium **light** theme (warm off-white canvas, white cards floating on soft green-tinted shadows, emerald used only as an accent) across admin, login, and customer tracking pages, while keeping all existing animations.

**Architecture:** Token-first migration. Most components already read CSS variables (`--glass-ink`, `--glass-bg`, `--glass-muted`, `--glass-border`) and the `.glass` / `.mesh-bg` utility classes, so redefining those to light values flips the bulk of the UI automatically. The remaining work is mechanical recoloring of components that hardcode dark utilities (`bg-white/10`, `text-emerald-200`, `border-white/10`, etc.), driven by a single canonical class-migration map (below). No data, API, auth, or business-logic changes.

**Tech Stack:** Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS 3, GSAP, DM Sans / DM Mono.

---

## Conventions

- **Working directory:** `C:/Users/Anshu/ANSHU/Novelty Job Tracker/novelty-job-Tracker` (the nested project repo, branch `main`). All paths below are relative to this directory.
- **No test runner exists.** Verification per task = `npm run lint` (fast) and TypeScript compile; a final task runs `npm run build` and a dev-server visual check.
- **Commit after every task** with the message shown.
- Work directly on `main` (matches existing project history) unless the executor prefers a feature branch.

### Canonical class-migration map (the authoritative recolor rules)

Apply these replacements everywhere they appear. Tasks reference this map by name ("apply the canonical map") and also list the specific lines per file.

**Text — neutrals**
| Dark (old) | Light (new) |
|---|---|
| `text-white` (heading) | `text-brand-ink` |
| `text-white/75`, `text-white/70`, `text-white/60` | `text-brand-muted` |
| `text-white/40` | `text-brand-subtle` |
| `hover:text-white` | `hover:text-brand-ink` |

**Text — semantic colors (too light on white → darken)**
| Dark (old) | Light (new) |
|---|---|
| `text-emerald-200`, `text-green-200` | `text-[#0B6B43]` |
| `text-sky-200` | `text-[#1E6FB8]` |
| `text-amber-200`, `text-amber-100` | `text-[#9A6510]` |
| `text-purple-200` | `text-[#6B46C1]` |
| `text-orange-200` | `text-[#B5651A]` |
| `text-yellow-100` | `text-[#8A6D0B]` |
| `text-red-200` | `text-[#B23B2E]` |
| `hover:text-red-300` | `hover:text-[#B23B2E]` |

**Surfaces / fills (white-on-dark overlays → light surfaces)**
| Dark (old) | Light (new) |
|---|---|
| `bg-white/10`, `bg-white/[0.06]`, `bg-white/5` | `bg-brand-surface-2` |
| `hover:bg-white/[0.08]`, `hover:bg-white/[0.06]`, `hover:bg-white/10` | `hover:bg-brand-surface-2` |
| `bg-white/[0.08]` (active) | `bg-brand-surface-2` |
| `bg-black/15` | `bg-brand-surface-2` |
| `bg-white/20` (filled dot) | `bg-brand-primary` |
| `bg-white/5` (empty dot) | `bg-brand-surface-2` |

**Borders**
| Dark (old) | Light (new) |
|---|---|
| `border-white/8`, `border-white/10`, `border-white/12`, `border-white/15` | `border-brand-border` |
| `border-white/25`, `border-white/30` (dashed nodes) | `border-brand-subtle` |
| `border-t border-white/10` | `border-t border-brand-border` |

**Tint backgrounds (colored `/10–/18` on dark → soft light tints)**
| Dark (old) | Light (new) |
|---|---|
| `bg-emerald-400/15`, `bg-emerald-400/18`, `bg-emerald-400/12` | `bg-[#E7F5EE]` |
| `bg-sky-400/15`, `bg-sky-400/18`, `bg-sky-400/12`, `bg-sky-400/10` | `bg-[#E8F1FB]` |
| `bg-amber-400/15`, `bg-amber-400/18`, `bg-amber-400/12`, `bg-amber-400/10` | `bg-[#FBF1E0]` |
| `bg-purple-400/15` | `bg-[#F1ECFB]` |
| `bg-orange-400/15` | `bg-[#FBEFE2]` |
| `bg-yellow-400/15` | `bg-[#FBF6DF]` |
| `bg-red-400/15`, `bg-red-400/12`, `bg-red-400/10` | `bg-red-50` |

**Tint borders**
| Dark (old) | Light (new) |
|---|---|
| `border-emerald-300/30`, `border-emerald-300/25`, `border-emerald-300/20` | `border-[#BFE3D0]` |
| `border-sky-300/25`, `border-sky-300/30` | `border-[#C7DDF3]` |
| `border-amber-300/25` | `border-[#EBD9AE]` |
| `border-red-300/25`, `border-red-300/30` | `border-[#EBC4BE]` |

**Inputs (focus)**
| Dark (old) | Light (new) |
|---|---|
| `focus:bg-white/[0.14]` | `focus:bg-white` |
| `focus:border-emerald-300/70` | `focus:border-[#16A06A]` |
| `focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22),...]` | `focus:shadow-[var(--ring-focus)]` |

**Accent ring / active**
| Dark (old) | Light (new) |
|---|---|
| `ring-emerald-300/20` | `ring-[#16A06A]/20` |
| `border-emerald-300/30` (active card) | `border-[#16A06A]/40` |

**Auto-flipping (no change needed — driven by tokens):** `text-[var(--glass-ink)]`, `text-[var(--glass-muted)]`, `bg-[var(--glass-bg)]`, `border-[var(--glass-border)]`, `.glass`, `.glass-strong`, `.mesh-bg`, `.skeleton`, `text-brand-accent`, `text-brand-muted`, `bg-brand-bg`, `border-brand-border`, and all modal classes already using `*-50`/`*-700`.

---

## Task 1: Foundation tokens & utilities (globals.css)

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Replace the `:root` light-token block (lines 7–29)**

Replace the existing first `:root { ... }` block with:

```css
:root {
  --color-bg:            #F6F8F6;
  --color-surface:       #FFFFFF;
  --color-surface-2:     #F1F4F1;
  --color-border:        #E6EBE7;
  --color-ink:           #0D241C;
  --color-accent:        #0D241C; /* = ink (keeps text-brand-accent readable) */
  --color-primary:       #10553F;
  --color-primary-hover: #0C4232;
  --color-header:        #FFFFFF;
  --color-muted:         #5C6E65;
  --color-subtle:        #8A9991;
  --color-success:       #0B6B43;
  --color-warning:       #9A6510;
  --color-danger:        #B23B2E;
  --color-hold:          #9A6510;
  --color-pending:       #8A9991;
  /* legacy aliases */
  --color-green:         #0B6B43;
  --color-amber:         #9A6510;
  --color-red:           #B23B2E;

  --font-sans: var(--font-dm-sans), system-ui, sans-serif;
  --font-mono: var(--font-dm-mono), ui-monospace, monospace;
}
```

- [ ] **Step 2: Replace the "Premium glass-mesh theme" `:root` block (lines 122–128) with light token values + depth tokens**

```css
/* ── Premium light theme tokens ──────────────────────────────── */
:root {
  --glass-bg:         #FFFFFF;
  --glass-bg-strong:  #FFFFFF;
  --glass-border:     #E6EBE7;
  --glass-ink:        #0D241C;
  --glass-muted:      #5C6E65;
  --ink-subtle:       #8A9991;
  --accent:           #16A06A;

  --shadow-sm: 0 1px 2px rgba(13,36,28,.06);
  --shadow-md: 0 1px 3px rgba(13,36,28,.06), 0 10px 30px -12px rgba(13,36,28,.14);
  --shadow-lg: 0 20px 50px -16px rgba(13,36,28,.22);
  --ring-focus: 0 0 0 4px rgba(22,160,106,.18), 0 8px 22px -10px rgba(13,36,28,.20);
}
```

- [ ] **Step 3: Replace the `.glass` / `.glass-strong` rules (lines 130–137) — light cards that float**

```css
/* Elevated light card surface */
.glass {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-md);
}
.glass-strong {
  background: var(--color-surface);
  box-shadow: var(--shadow-lg);
}
```

- [ ] **Step 4: Replace the `.mesh-bg` rule (lines 139–146) — light aurora base**

```css
/* Warm off-white base with faint emerald/mint aurora glows */
.mesh-bg {
  background:
    radial-gradient(55% 55% at 8% 10%,   rgba(120,225,180,.16), transparent 60%),
    radial-gradient(48% 48% at 96% 14%,   rgba(90,200,160,.13),  transparent 60%),
    radial-gradient(60% 60% at 80% 102%,  rgba(150,222,190,.15), transparent 60%),
    var(--color-bg);
}
```

- [ ] **Step 5: Replace the `.skeleton` background (lines 160–166) — light shimmer**

Replace the `background:` and `background-size:` lines inside `.skeleton` with:

```css
.skeleton {
  background: linear-gradient(90deg, #ECEFEC 25%, #F5F7F5 37%, #ECEFEC 63%);
  background-size: 400% 100%;
  animation: shimmer 1.4s ease infinite;
  border-radius: 8px;
}
```

And update the reduced-motion override (line ~176) from `background: rgba(255,255,255,.12)` to `background: #ECEFEC`.

- [ ] **Step 6: Update `.modal-backdrop` (lines 88–91) for a lighter scrim**

```css
.modal-backdrop {
  background: rgba(13, 36, 28, 0.35);
  backdrop-filter: blur(3px);
}
```

- [ ] **Step 7: Add a row-flash keyframe + class at the end of the file (before the final `@media (prefers-reduced-motion)` block, then add the class to that block)**

```css
/* Satisfying confirmation flash on a status update */
@keyframes row-flash {
  0%   { background-color: rgba(22, 160, 106, 0.16); }
  100% { background-color: transparent; }
}
.row-flash { animation: row-flash 0.6s ease-out; }
```

Add `.row-flash { animation: none; }` inside the existing `@media (prefers-reduced-motion: reduce)` block.

- [ ] **Step 8: Verify**

Run: `npm run lint`
Expected: no errors. (CSS isn't linted, but this confirms nothing else broke.)

- [ ] **Step 9: Commit**

```bash
git add src/app/globals.css
git commit -m "feat(theme): light premium tokens, card shadows, aurora, row-flash"
```

---

## Task 2: Tailwind config tokens (tailwind.config.ts)

**Files:**
- Modify: `tailwind.config.ts`

- [ ] **Step 1: Replace the `brand` color object (lines 14–37) with light values + new accent/surface-2/subtle**

```ts
        brand: {
          bg:              '#F6F8F6',
          surface:         '#FFFFFF',
          'surface-2':     '#F1F4F1',
          border:          '#E6EBE7',
          ink:             '#0D241C',
          accent:          '#0D241C', // = ink
          primary:         '#10553F',
          'primary-hover': '#0C4232',
          header:          '#FFFFFF',
          muted:           '#5C6E65',
          subtle:          '#8A9991',
          live:            '#16A06A', // emerald accent (focus, progress, active)
          success:         '#0B6B43',
          warning:         '#9A6510',
          danger:          '#B23B2E',
          hold:            '#9A6510',
          pending:         '#8A9991',
          'glass-ink':     '#0D241C',
          'glass-muted':   '#5C6E65',
          'glass-line':    '#E6EBE7',
          green:           '#0B6B43',
          amber:           '#9A6510',
          red:             '#B23B2E',
        },
```

- [ ] **Step 2: Add a `boxShadow` scale inside `theme.extend` (after the `animation` block)**

```ts
      boxShadow: {
        card:        '0 1px 3px rgba(13,36,28,.06), 0 10px 30px -12px rgba(13,36,28,.14)',
        'card-hover':'0 2px 6px rgba(13,36,28,.08), 0 18px 40px -14px rgba(13,36,28,.18)',
        lift:        '0 20px 50px -16px rgba(13,36,28,.22)',
      },
```

- [ ] **Step 3: Verify**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add tailwind.config.ts
git commit -m "feat(theme): light brand tokens + surface-2/subtle/live + shadow scale"
```

---

## Task 3: Status / badge color maps (statusColors.ts)

**Files:**
- Modify: `src/lib/constants/statusColors.ts`

- [ ] **Step 1: Replace `STATUS_COLORS` (lines 15–31)**

```ts
export const STATUS_COLORS: Record<Stage, ColorConfig> = {
  'PO Received':             { bg: 'bg-[#F0F3F0]',  text: 'text-[#5C6E65]' },
  'Artwork Received':        { bg: 'bg-[#F1ECFB]',  text: 'text-[#6B46C1]' },
  'Prepress / Design Check': { bg: 'bg-[#E8F1FB]',  text: 'text-[#1E6FB8]' },
  'Sample Printing':         { bg: 'bg-[#FBF1E0]',  text: 'text-[#9A6510]' },
  'Shade Card Sent':         { bg: 'bg-[#FBEFE2]',  text: 'text-[#B5651A]' },
  'Shade Card Approved':     { bg: 'bg-[#E7F5EE]',  text: 'text-[#0B6B43]' },
  'In Printing':             { bg: 'bg-[#E7F5EE]',  text: 'text-[#0B6B43]' },
  'Slitting':                { bg: 'bg-[#E8F1FB]',  text: 'text-[#1E6FB8]' },
  'Quality Check':           { bg: 'bg-[#E8F1FB]',  text: 'text-[#1E6FB8]' },
  'Packing':                 { bg: 'bg-[#F1ECFB]',  text: 'text-[#6B46C1]' },
  'Ready to Dispatch':       { bg: 'bg-[#FBF6DF]',  text: 'text-[#8A6D0B]' },
  'Partial Dispatch':        { bg: 'bg-[#FBF1E0]',  text: 'text-[#9A6510]' },
  'Dispatched':              { bg: 'bg-[#E7F5EE]',  text: 'text-[#0B6B43]' },
  'On Hold':                 { bg: 'bg-[#FBF1E0]',  text: 'text-[#9A6510]' },
  'PO Closed':               { bg: 'bg-[#E7F5EE]',  text: 'text-[#0B6B43]' },
};
```

- [ ] **Step 2: Replace `ROW_URGENCY_STYLES` (lines 35–42)**

```ts
export const ROW_URGENCY_STYLES = {
  onHold:   'border-l-4 border-l-amber-500/70  bg-amber-50/70',
  urgent1:  'border-l-4 border-l-red-500/70    bg-red-50/70',
  urgent2:  'border-l-4 border-l-orange-500/70 bg-orange-50/60',
  urgent3:  'border-l-4 border-l-yellow-500/60 bg-yellow-50/60',
  qc:       'border-l-4 border-l-sky-500/60    bg-sky-50/60',
  normal:   '',
} as const;
```

- [ ] **Step 3: Replace `JOB_TYPE_BADGE` (lines 45–49)**

```ts
export const JOB_TYPE_BADGE: Record<'New' | 'Repeat' | 'Artwork Changed', string> = {
  'New':             'bg-[#E8F1FB] text-[#1E6FB8]',
  'Repeat':          'bg-[#F0F3F0] text-[#5C6E65]',
  'Artwork Changed': 'bg-[#F1ECFB] text-[#6B46C1]',
};
```

- [ ] **Step 4: Replace `urgentBadgeClass` body (lines 52–56)**

```ts
export function urgentBadgeClass(priority: number | null): string {
  if (priority === 1) return 'bg-red-100 text-red-700';
  if (priority === 2) return 'bg-orange-100 text-orange-700';
  return 'bg-yellow-100 text-yellow-700';
}
```

- [ ] **Step 5: Verify + commit**

```bash
npm run lint
git add src/lib/constants/statusColors.ts
git commit -m "feat(theme): light status pills, urgency rows, badges"
```

---

## Task 4: Background motion components (light aurora blobs)

**Files:**
- Modify: `src/components/motion/GradientMesh.tsx`
- Modify: `src/components/motion/AuroraBackground.tsx`

- [ ] **Step 1: Recolor `GradientMesh.tsx` blob gradients (lines 12 and 16)**

Change the two `style={{ background: ... }}` radial gradients to light mint:
- Line 12 → `style={{ background: 'radial-gradient(circle, rgba(120,225,180,.22), transparent 70%)' }}`
- Line 16 → `style={{ background: 'radial-gradient(circle, rgba(90,200,160,.20), transparent 70%)', animationDelay: '-6s' }}`

- [ ] **Step 2: Recolor `AuroraBackground.tsx` blob gradients (lines 25 and 27)**

- Line 25 → `style={{ background: 'radial-gradient(circle, rgba(120,225,180,.22), transparent 70%)' }}`
- Line 27 → `style={{ background: 'radial-gradient(circle, rgba(90,200,160,.20), transparent 70%)' }}`

- [ ] **Step 3: Verify + commit**

```bash
npm run lint
git add src/components/motion/GradientMesh.tsx src/components/motion/AuroraBackground.tsx
git commit -m "feat(theme): light mint aurora blobs"
```

---

## Task 5: Admin header (white frosted, dark logo, dept chip)

**Files:**
- Modify: `src/components/admin/AdminHeader.tsx`

- [ ] **Step 1: Replace the `<header>` opening tag (line 25)**

```tsx
    <header className="bg-white/80 backdrop-blur-md sticky top-0 z-40 border-b border-brand-border shadow-[0_1px_0_rgba(22,160,106,0.25)]">
```

- [ ] **Step 2: Switch the logo to dark (line 30)** — remove `onDark`:

```tsx
          <Logo width={120} height={30} priority />
```

- [ ] **Step 3: Replace the department chip + sign-out (lines 34–44)**

```tsx
        <div className="flex items-center gap-3">
          <span className="text-brand-muted text-xs font-mono bg-brand-surface-2 px-2.5 py-1 rounded-full border border-brand-border">
            {displayName}
          </span>
          <button
            onClick={handleLogout}
            className="text-brand-muted hover:text-brand-ink text-xs transition-colors px-2 py-1"
          >
            Sign out
          </button>
        </div>
```

- [ ] **Step 4: Verify + commit**

```bash
npm run lint
git add src/components/admin/AdminHeader.tsx
git commit -m "feat(theme): white frosted admin header with dark logo + dept chip"
```

---

## Task 6: Dashboard summary cards (light colors, hover lift)

**Files:**
- Modify: `src/components/admin/DashboardSummaryCard.tsx`

- [ ] **Step 1: Update the three colored metric `color` values (lines 21, 26, 31)**

- Line 21 (On Hold): `color: 'text-[#9A6510]',`
- Line 26 (Due This Week): `color: 'text-[#1E6FB8]',`
- Line 31 (Dispatched): `color: 'text-[#0B6B43]',`

- [ ] **Step 2: Add hover lift + larger radius to the card (line 48)**

```tsx
          className="glass rounded-2xl px-5 py-4 transition-shadow duration-200 hover:shadow-card-hover"
```

- [ ] **Step 3: Make the metric label uppercase/tracked subtle (line 50)**

```tsx
          <p className="text-[10px] uppercase tracking-wide text-brand-subtle font-medium mb-1.5">{stat.label}</p>
```

- [ ] **Step 4: Verify + commit**

```bash
npm run lint
git add src/components/admin/DashboardSummaryCard.tsx
git commit -m "feat(theme): light summary cards with hover lift + tracked labels"
```

---

## Task 7: Jobs table chrome (hairlines, header row)

**Files:**
- Modify: `src/components/admin/JobsTable.tsx`

- [ ] **Step 1: Recolor the thead row (line 117)** — add a light header fill + hairline:

```tsx
            <tr className="border-b border-brand-border bg-brand-surface-2">
```

- [ ] **Step 2: Verify + commit**

```bash
npm run lint
git add src/components/admin/JobsTable.tsx
git commit -m "feat(theme): light jobs-table header row"
```

---

## Task 8: Job row recolor + status-pill polish + confirmation flash (hero interaction)

**Files:**
- Modify: `src/components/admin/JobRow.tsx`

- [ ] **Step 1: Add flash state.** After the existing `useState` hooks (around line 54), add:

```tsx
  const [flash, setFlash] = useState(false);
```

- [ ] **Step 2: Trigger the flash on a successful update.** In `submitStatusChange`, inside the success branch (right after `toast.success(...)`, around line 136), add:

```tsx
      setFlash(true);
      setTimeout(() => setFlash(false), 650);
```

- [ ] **Step 3: Recolor `rowClass` base + add flash class (line 57–58).** Replace `'border-b border-white/8 transition-colors',` with:

```tsx
    'border-b border-brand-border transition-colors',
    flash && 'row-flash',
```

- [ ] **Step 4: Apply the canonical map to the remaining hardcoded classes:**
  - Line 200 partial-runs badge: `bg-purple-400/15 text-purple-200` → `bg-[#F1ECFB] text-[#6B46C1]`
  - Line 205 halt remark: `text-amber-200 bg-amber-400/10` → `text-[#9A6510] bg-[#FBF1E0]`
  - Line 224 progress track: `bg-white/10` → `bg-brand-surface-2`
  - Line 226 progress fill: `bg-emerald-400` → `bg-brand-live`
  - Line 231 scheduled: `text-sky-200` → `text-[#1E6FB8]`
  - Line 301 More/Less button: `text-[var(--glass-muted)] hover:text-[var(--glass-ink)] ... border border-white/15` → `text-brand-muted hover:text-brand-ink ... border border-brand-border`
  - Line 316 Del button: `text-red-400 hover:text-red-600` → `text-[#B23B2E] hover:text-[#8E2C22]`
  - Line 328 expanded panel: `bg-black/15` → `bg-brand-surface-2`

- [ ] **Step 5: Polish the status `<select>` into a pill (lines 261–288).** Replace the `className` on the `<select>` with:

```tsx
            className={cn(
              'w-full px-2.5 py-1.5 rounded-full border text-xs font-semibold appearance-none cursor-pointer',
              'shadow-sm hover:shadow-card-hover hover:-translate-y-px transition-all',
              'focus:outline-none focus:ring-2 focus:ring-brand-live/30',
              STATUS_COLORS[job.status]?.bg ?? 'bg-gray-100',
              STATUS_COLORS[job.status]?.text ?? 'text-gray-700',
              'border-transparent',
            )}
```

(Remove the old `[&>option]:bg-[#0A1F18] [&>option]:text-[var(--glass-ink)]` line — native light option styling is correct now.)

- [ ] **Step 6: Verify (typecheck via build of this file path is covered by lint + tsc)**

Run: `npm run lint`
Expected: no errors. Confirm `flash` is read in `rowClass` (no unused-var warning).

- [ ] **Step 7: Commit**

```bash
git add src/components/admin/JobRow.tsx
git commit -m "feat(theme): light job rows, pill status select, success flash"
```

---

## Task 9: Inputs + spinner (Field.tsx, Loading.tsx)

**Files:**
- Modify: `src/components/ui/Field.tsx`
- Modify: `src/components/ui/Loading.tsx`

- [ ] **Step 1: Update `INPUT_BASE` (lines 6–12)** — light field, emerald focus ring:

```ts
const INPUT_BASE =
  'peer w-full rounded-xl bg-white border border-brand-border ' +
  'px-3.5 pt-5 pb-2 text-sm text-brand-ink outline-none ' +
  'placeholder:text-transparent transition-all duration-200 ' +
  'focus:-translate-y-0.5 motion-reduce:focus:translate-y-0 ' +
  'focus:border-[#16A06A] focus:bg-white ' +
  'focus:shadow-[var(--ring-focus)]';
```

- [ ] **Step 2: Update `LABEL_BASE` (lines 14–19)** — muted label → emerald on focus:

Replace `text-white/60` with `text-brand-muted`, and both `text-emerald-200` occurrences with `text-[#0B7A4F]`.

- [ ] **Step 3: Update `SelectField` classes (lines 56–63)**

- `bg-[var(--glass-bg)]` stays (now white via token) — OK; replace `backdrop-blur-md` (remove), `focus:bg-white/[0.14]` → `focus:bg-white`, `focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)]` → `focus:shadow-[var(--ring-focus)]`, and remove the `[&>option]:bg-[#0A1F18] [&>option]:text-[var(--glass-ink)]` line.
- Line 70 label: `text-emerald-200` → `text-[#0B7A4F]`.

- [ ] **Step 4: Update the spinner (Loading.tsx line 10)**

```tsx
        'inline-block h-4 w-4 flex-none rounded-full border-2 border-brand-border border-t-brand-live animate-spin',
```

- [ ] **Step 5: Verify + commit**

```bash
npm run lint
git add src/components/ui/Field.tsx src/components/ui/Loading.tsx
git commit -m "feat(theme): light inputs + emerald focus ring + spinner"
```

---

## Task 10: Add Job form (AddJobForm.tsx)

**Files:**
- Modify: `src/components/admin/AddJobForm.tsx`

- [ ] **Step 1: Apply the canonical map to these lines:**
  - Line 224: `text-[var(--glass-muted)] bg-white/[0.06] border-b border-white/10` → `text-brand-muted bg-brand-surface-2 border-b border-brand-border`
  - Line 233: `hover:bg-white/[0.08] ... border-b border-white/10` → `hover:bg-brand-surface-2 ... border-b border-brand-border`
  - Line 350: `bg-white/[0.06] border border-white/10 text-[var(--glass-muted)] hover:text-[var(--glass-ink)]` → `bg-brand-surface-2 border border-brand-border text-brand-muted hover:text-brand-ink`
  - Line 372: `border border-white/10` → `border border-brand-border`
  - Line 418: `hover:text-red-300` → `hover:text-[#B23B2E]`
  - Line 466: `focus:border-emerald-300/70 focus:bg-white/[0.14]` → `focus:border-[#16A06A] focus:bg-white`
  - Lines 178, 349, 451 (`bg-brand-primary text-white ...`): leave as-is (primary buttons are correct on light).

- [ ] **Step 2: Verify + commit**

```bash
npm run lint
git add src/components/admin/AddJobForm.tsx
git commit -m "feat(theme): light Add Job form surfaces"
```

---

## Task 11: History panel (HistoryPanel.tsx)

**Files:**
- Modify: `src/components/admin/HistoryPanel.tsx`

- [ ] **Step 1: Apply the canonical map to these lines:**
  - 101: `border-b border-white/8` → `border-b border-brand-border`
  - 108: `border-dashed border-white/30` → `border-dashed border-brand-subtle`
  - 112: `bg-white/20` → `bg-brand-primary`
  - 141: `text-amber-200` → `text-[#9A6510]`
  - 148: `text-sky-200` → `text-[#1E6FB8]`
  - 157: `text-[var(--glass-muted)] bg-white/[0.06]` → `text-brand-muted bg-brand-surface-2`
  - 360: `text-emerald-200` → `text-[#0B6B43]`
  - 380: `bg-emerald-400/15 border-emerald-300/30 text-emerald-200 hover:bg-emerald-400/25` → `bg-[#E7F5EE] border-[#BFE3D0] text-[#0B6B43] hover:bg-[#D8EFE3]`
  - 381: `bg-white/[0.06] border-white/10 text-[var(--glass-ink)] hover:bg-white/10` → `bg-brand-surface-2 border-brand-border text-brand-ink hover:bg-[#E9EDE9]`
  - 399: `bg-white/[0.06] border border-white/10` → `bg-brand-surface-2 border border-brand-border`
  - 401: `text-emerald-200` → `text-[#0B6B43]`
  - 402: `text-amber-200` → `text-[#9A6510]`
  - 408: `text-amber-200` → `text-[#9A6510]`
  - 486: `border border-white/10` → `border border-brand-border`
  - 489: `bg-white/[0.06] border-b border-white/10` → `bg-brand-surface-2 border-b border-brand-border`
  - 500: `border-b border-white/8` → `border-b border-brand-border`
  - 507: `bg-emerald-400/15 text-emerald-200` → `bg-[#E7F5EE] text-[#0B6B43]`
  - 508: `bg-sky-400/15 text-sky-200` → `bg-[#E8F1FB] text-[#1E6FB8]`
  - 509: `bg-white/10 text-white/70` → `bg-brand-surface-2 text-brand-muted`
  - 526: `bg-emerald-400/15 border-emerald-300/30 text-emerald-200 hover:bg-emerald-400/25` → `bg-[#E7F5EE] border-[#BFE3D0] text-[#0B6B43] hover:bg-[#D8EFE3]`
  - 543: `bg-white/[0.06] border-t border-white/10` → `bg-brand-surface-2 border-t border-brand-border`
  - 545: `text-emerald-200` → `text-[#0B6B43]`
  - 546: `text-amber-200` → `text-[#9A6510]`
  - 414: `bg-brand-primary text-white` → leave as-is (primary button).

- [ ] **Step 2: Verify + commit**

```bash
npm run lint
git add src/components/admin/HistoryPanel.tsx
git commit -m "feat(theme): light history panel"
```

---

## Task 12: Job detail view + admin job detail page + stage comments + filter bar

**Files:**
- Modify: `src/components/admin/JobDetailClient.tsx`
- Modify: `src/app/admin/jobs/[id]/page.tsx`
- Modify: `src/components/admin/StageComments.tsx`
- Modify: `src/components/admin/FilterBar.tsx`

- [ ] **Step 1: `JobDetailClient.tsx` — apply the canonical map:**
  - 173: `bg-purple-400/15 text-purple-200` → `bg-[#F1ECFB] text-[#6B46C1]`
  - 220: `bg-white/10` → `bg-brand-surface-2`
  - 278: `bg-sky-400/15 text-sky-200` → `bg-[#E8F1FB] text-[#1E6FB8]`
  - 287: `border-t border-white/10` → `border-t border-brand-border`
  - 296: `text-amber-200 bg-amber-400/10 border border-amber-300/25` → `text-[#9A6510] bg-[#FBF1E0] border border-[#EBD9AE]`
  - 305: `text-sky-200 bg-sky-400/10 border border-sky-300/25` → `text-[#1E6FB8] bg-[#E8F1FB] border border-[#C7DDF3]`

- [ ] **Step 2: Open `src/app/admin/jobs/[id]/page.tsx` and apply the canonical map** to any `text-white`, `text-*-200`, `bg-white/*`, `border-white/*`, `bg-black/*` it contains (use the map's exact substitutions). If the file already only uses `--glass-*`/`brand-*` tokens, no change is needed.

- [ ] **Step 3: `StageComments.tsx` line 70** — `focus:border-emerald-300/70 focus:bg-white/[0.14]` → `focus:border-[#16A06A] focus:bg-white`. (Line 78 primary button stays.)

- [ ] **Step 4: `FilterBar.tsx` line 51** — `bg-red-400/15 border-red-300/30 text-red-200` → `bg-red-50 border-[#EBC4BE] text-[#B23B2E]`. Then scan the rest of the file for any other dark classes (search `white/`, `-200`, `black/`) and apply the map.

- [ ] **Step 5: Verify + commit**

```bash
npm run lint
git add src/components/admin/JobDetailClient.tsx "src/app/admin/jobs/[id]/page.tsx" src/components/admin/StageComments.tsx src/components/admin/FilterBar.tsx
git commit -m "feat(theme): light job-detail, stage comments, filter bar"
```

---

## Task 13: Login page (login/page.tsx)

**Files:**
- Modify: `src/app/(auth)/login/page.tsx`

- [ ] **Step 1: Recolor the error alert (line 106)**

```tsx
            <p className="text-sm text-[#B23B2E] bg-red-50 border border-[#EBC4BE] rounded-lg px-3 py-2">
```

- [ ] **Step 2: Update the submit button focus ring (line 115)** — change `focus:ring-emerald-300/40` to `focus:ring-brand-live/40`. The `bg-brand-primary text-white` stays (correct primary button).

- [ ] **Step 3: Verify the card.** The card uses `glass` (now a white floating card) over `GradientMesh` (now light aurora). `LogoReveal` defaults to `onDark={false}` (dark logo) — correct on the white card. No further change.

- [ ] **Step 4: Verify + commit**

```bash
npm run lint
git add "src/app/(auth)/login/page.tsx"
git commit -m "feat(theme): light login page alert + focus ring"
```

---

## Task 14: Track shell — layout, search page, not-found, logos

**Files:**
- Modify: `src/app/track/layout.tsx`
- Modify: `src/app/track/page.tsx`
- Modify: `src/app/track/[po]/page.tsx`

- [ ] **Step 1: `track/layout.tsx` — white frosted header + dark logo + light text**
  - Line 19 header: `bg-brand-header border-b border-white/10` → `bg-white/80 backdrop-blur-md border-b border-brand-border shadow-[0_1px_0_rgba(22,160,106,0.25)]`
  - Line 22 logo: remove `onDark` → `<Logo width={132} height={34} priority />`
  - Line 24: `text-white/40` → `text-brand-subtle`

- [ ] **Step 2: `track/page.tsx` — heading + button**
  - Line 24: `text-white` → `text-brand-ink`
  - Line 43: `bg-brand-primary text-white` stays (primary). No other change (subtext uses `--glass-muted`, auto-flips).

- [ ] **Step 3: `track/[po]/page.tsx` — not-found block**
  - Line 44: `text-white` → `text-brand-ink`
  - Line 45: `text-green-200` → `text-brand-muted`
  - Line 51: `text-green-200 ... hover:text-white` → `text-[#0B6B43] ... hover:text-brand-ink`

- [ ] **Step 4: Verify + commit**

```bash
npm run lint
git add src/app/track/layout.tsx src/app/track/page.tsx "src/app/track/[po]/page.tsx"
git commit -m "feat(theme): light track shell (header, search, not-found)"
```

---

## Task 15: Track content components

**Files:**
- Modify: `src/components/track/TrackJobAccordion.tsx`
- Modify: `src/components/track/StagePipeline.tsx`
- Modify: `src/components/track/StatusBanners.tsx`
- Modify: `src/components/track/ProgressBar.tsx`
- Modify: `src/components/track/DispatchSummaryCard.tsx`
- Modify: `src/components/track/DeliveryCountdown.tsx`
- Modify: `src/components/track/ScheduledReleaseCard.tsx`

- [ ] **Step 1: `TrackJobAccordion.tsx` — apply the canonical map:**
  - 69, 101: `text-white` → `text-brand-ink`
  - 72, 104: `text-[var(--glass-muted)] hover:text-white` → `text-brand-muted hover:text-brand-ink`
  - 117: `border-emerald-300/30 ring-1 ring-emerald-300/20` → `border-[#16A06A]/40 ring-1 ring-[#16A06A]/20`; `border-white/12` → `border-brand-border`
  - 125: `bg-white/[0.08]` → `bg-brand-surface-2`; `hover:bg-white/[0.06] hover:shadow-[0_8px_30px_rgba(0,0,0,0.18)]` → `hover:bg-brand-surface-2 hover:shadow-card-hover`
  - 140, 366: `bg-white/10 border border-white/15` → `bg-brand-surface-2 border border-brand-border`
  - 184, 288: `border-t border-white/10` → `border-t border-brand-border`

- [ ] **Step 2: `StagePipeline.tsx` — apply the canonical map:**
  - 125, 151, 229, 240: `border-white/10` / `bg-white/10` → `border-brand-border` / `bg-brand-surface-2`
  - 133, 147: dashed/empty nodes `border-white/30`, `border-white/25 bg-white/5` → `border-brand-subtle`, `border-brand-subtle bg-brand-surface-2`
  - 140, 247: `text-white` (the `✓`) → keep white **only if** the node fill behind it is a solid accent; the check sits on a filled node — change to `text-white` staying on `bg-brand-primary` node. Verify the node fill at those lines is `bg-brand-primary`/accent; if it is `bg-white/*`, change the fill to `bg-brand-primary` so the white ✓ stays legible.
  - 161, 187, 258, 264: `text-emerald-200` → `text-[#0B6B43]`
  - 170: `bg-brand-primary text-white` stays
  - 202: `text-amber-200 bg-amber-400/10` → `text-[#9A6510] bg-[#FBF1E0]`
  - 209: `text-sky-200 bg-sky-400/10` → `text-[#1E6FB8] bg-[#E8F1FB]`
  - 276: `text-[var(--glass-ink)] bg-white/10` → `text-brand-ink bg-brand-surface-2`
  - 279: `text-amber-200` → `text-[#9A6510]`

- [ ] **Step 3: `StatusBanners.tsx` (lines 81–84)** — light banner variants:

```ts
    green: 'bg-[#E7F5EE] border-[#BFE3D0] text-[#0B6B43]',
    amber: 'bg-[#FBF1E0] border-[#EBD9AE] text-[#9A6510]',
    blue:  'bg-[#E8F1FB] border-[#C7DDF3] text-[#1E6FB8]',
    red:   'bg-red-50     border-[#EBC4BE] text-[#B23B2E]',
```

- [ ] **Step 4: `ProgressBar.tsx` (line 23)** — `black: 'bg-white/10'` → `black: 'bg-brand-surface-2'`. Scan the rest of the file's color map for any `*-400`/`*-200` fills that need darkening for contrast on white; keep saturated fill colors (e.g. `bg-emerald-500`) as-is.

- [ ] **Step 5: `DispatchSummaryCard.tsx`:**
  - 21: `text-emerald-200` → `text-[#0B6B43]`
  - 22: `text-amber-200` → `text-[#9A6510]`
  - 26: `bg-white/10` → `bg-brand-surface-2`
  - 43: `bg-white/10` → `bg-brand-surface-2`

- [ ] **Step 6: `DeliveryCountdown.tsx` (lines 18–20):**

```ts
    green: 'text-[#0B6B43]',
    amber: 'text-[#9A6510] font-semibold',
    red:   'text-[#B23B2E] font-semibold',
```

- [ ] **Step 7: `ScheduledReleaseCard.tsx`:**
  - 25: `border-b border-white/10` → `border-b border-brand-border`
  - 48: `bg-emerald-400/15 text-emerald-200` → `bg-[#E7F5EE] text-[#0B6B43]`
  - 49: `bg-white/10 text-white/70` → `bg-brand-surface-2 text-brand-muted`
  - 50: `bg-sky-400/15 text-sky-200` → `bg-[#E8F1FB] text-[#1E6FB8]`

- [ ] **Step 8: Verify + commit**

```bash
npm run lint
git add src/components/track/
git commit -m "feat(theme): light track content components"
```

---

## Task 16: Final sweep, build, and visual verification

**Files:** none (verification + cleanup)

- [ ] **Step 1: Grep for any residual dark-theme classes.**

Run (Grep tool or):
```bash
git grep -nE "text-white|border-white/|bg-white/|bg-black/|text-(emerald|sky|amber|purple|green|orange|yellow|red)-(100|200|300)|onDark" -- src/ | grep -v "text-white\b.*bg-brand-primary"
```
Expected: only intentional matches remain — `text-white` paired with a colored/primary button or filled accent node (e.g. `bg-brand-primary text-white`, the StagePipeline `✓` on a filled node). Any other match is a miss → fix it using the canonical map and amend the relevant task's commit (or a new `fix(theme):` commit).

- [ ] **Step 2: Confirm `Logo onDark` is gone from light surfaces.**

Run: `git grep -n "onDark" -- src/`
Expected: only the prop *definitions* in `Logo.tsx` and `LogoReveal.tsx` remain; no usage passes `onDark` (all logos now render dark on light). If a usage remains, remove it.

- [ ] **Step 3: Lint.**

Run: `npm run lint`
Expected: passes with no errors.

- [ ] **Step 4: Production build (typecheck + compile).**

Run: `npm run build`
Expected: build completes with no type errors.

- [ ] **Step 5: Visual check.**

Run: `npm run dev`, then open and eyeball each surface against the spec's success criteria:
  - `/login` — white floating card on light aurora, dark logo, emerald focus ring on fields.
  - `/admin` — white frosted header, floating summary cards with hover lift, light table with hairline rows, **status pills colored per state**, and a **green flash** when you change a status (and a toast).
  - `/admin/jobs/[id]` — light detail view, history panel readable.
  - `/track` and `/track/<PO>` — white header, light pipeline/banners/cards, readable status colors.
  - Toggle OS "reduce motion" → aurora drift and the row-flash stop; layout intact.

- [ ] **Step 6: Final commit (if Step 1/2 required fixes; otherwise skip).**

```bash
git add -A
git commit -m "fix(theme): clean up residual dark-theme classes after light migration"
```

---

## Self-review notes (author)

- **Spec coverage:** §1 palette → Tasks 1–2; §2 depth/shadows → Tasks 1–2, 6; §3 typography → Tasks 6, 9; §4 components → Tasks 5–13, 15; §5 hero status interaction → Task 8 (pill + flash); §6 aurora → Tasks 1, 4. Login/track/everything-together scope → Tasks 13–15. Out-of-scope items (no data/API/logic, no new deps, no dual theme) are respected — only CSS/className edits.
- **Long-tail components** not named in the spec but found via grep (`HistoryPanel`, `JobDetailClient`, `AddJobForm`, `StageComments`, `FilterBar`, all 7 track components) are explicitly covered (Tasks 10–12, 15) so no dark-glass remnants survive — the final sweep (Task 16) guards this.
- **Type/name consistency:** new tokens used consistently — Tailwind `brand.surface-2`/`brand.subtle`/`brand.live` + `shadow-card/card-hover/lift`; CSS vars `--ink-subtle`, `--accent`, `--shadow-*`, `--ring-focus`, `.row-flash`. `STATUS_COLORS` keeps the `{bg,text}` shape consumed by `StatusBadge.tsx` and `JobRow.tsx`.
- **Intentional `text-white` survivors:** white text on `bg-brand-primary` buttons and on filled accent pipeline nodes is correct and called out in Task 16 Step 1.
