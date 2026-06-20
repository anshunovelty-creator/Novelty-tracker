// tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // ── Brand colors from spec ──────────────────────────────
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
          // dark-glass theme (light text on the mesh):
          'glass-ink':     '#EAFFF5', // primary text on glass (AA on mesh)
          'glass-muted':   '#9FBCB0', // secondary text on glass (AA on mesh)
          'glass-line':    'rgba(255,255,255,0.14)',
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

      // ── Typography ──────────────────────────────────────────
      fontFamily: {
        sans:  ['DM Sans', 'system-ui', 'sans-serif'],
        mono:  ['DM Mono', 'ui-monospace', 'monospace'],
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
