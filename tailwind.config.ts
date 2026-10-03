// tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    // Shared style helpers (e.g. src/lib/constants/statusColors.ts) build
    // Tailwind class strings too — without this, a color used only there
    // (never as literal text in a scanned component) never gets generated,
    // and the class silently renders with no background at all.
    './src/lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // ── Wide-monitor breakpoints ─────────────────────────────
      // Tailwind's largest default (2xl) tops out at 1536px, so the admin
      // shell's content column stayed capped there even on 27"-32"
      // monitors with 2560px+ of real viewport. These let the shell widen
      // in steps instead of jumping straight to full width, which would
      // over-stretch the glass cards.
      screens: {
        '3xl': '1920px',
        '4xl': '2560px',
      },

      // ── Brand colors from spec ──────────────────────────────
      colors: {
        brand: {
          bg:              '#F4F7F5', // mint-grey page ground
          surface:         '#FFFFFF', // cards
          border:          '#E4EAE6', // dividers (greenish)
          ink:             '#0C2A20', // primary text (dark green-black)
          accent:          '#0C2A20', // = ink. Kept so existing text-/border-/ring-brand-accent stay readable.
          primary:         '#10553F', // brand fills / actions (green-700, the seed)
          'primary-hover': '#0C4232', // button/link hover
          header:          '#10553F', // header/nav bg (was near-black)
          muted:           '#5A6B62', // THE secondary text colour — 5.6:1 on white
          success:         '#065F46',
          warning:         '#92400E',
          danger:          '#B91C1C',
          hold:            '#5B6B63',
          pending:         '#94A39B',
          // Control Room surfaces (DESIGN.md frontmatter)
          'surface-alt':   '#F5F9F7', // zebra rows, search wells, footers
          'surface-hover': '#EAF3EE', // hovered row / menu item
          sunken:          '#EEF2EF', // progress & segmented tracks
          'line-soft':     '#EEF2EF', // row dividers inside a card
          faint:           '#94A39B', // icons, placeholders, disabled — never body text
          mint:            '#7CF0BE', // accent on dark grounds only
          // dark-glass theme (light text on the mesh):
          'glass-ink':     '#EAFFF5', // primary text on glass (AA on mesh)
          'glass-muted':   '#9FBCB0', // secondary text on glass (AA on mesh)
          'glass-line':    'rgba(255,255,255,0.14)',
          // legacy semantic names still referenced in code:
          green:           '#065F46',
          amber:           '#92400E',
          red:             '#B91C1C',
        },
        green: {
          50:  '#F0F6F3', 100: '#DCEDE5', 200: '#B9DBCB', 300: '#8AC2A9',
          400: '#4FA582', 500: '#2C8763', 600: '#1A6B4B', 700: '#10553F',
          800: '#0C4232', 900: '#082F24', 950: '#05201A',
        },
      },

      // ── Typography ──────────────────────────────────────────
      fontFamily: {
        // next/font registers the faces under hashed family names and exposes
        // them only through these variables (see app/layout.tsx) — a literal
        // 'DM Sans' here never matches and silently falls back to system-ui.
        sans:  ['var(--font-dm-sans)', 'system-ui', 'sans-serif'],
        mono:  ['var(--font-trispace)', 'ui-monospace', 'monospace'],
      },

      // ── Animations ──────────────────────────────────────────
      animation: {
        'pulse-dot': 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};

export default config;
