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
          bg:       '#f7f7f5',   // off-white page background
          surface:  '#ffffff',   // cards
          border:   '#e5e5e2',   // dividers
          accent:   '#1a1a18',   // near-black — primary action color
          header:   '#1a1a18',   // nav/header background
          muted:    '#a8a8a0',   // secondary text
          green:    '#16a34a',   // completed, success
          amber:    '#b45309',   // warnings, remaining qty
          red:      '#b91c1c',   // error, urgent priority 1
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
