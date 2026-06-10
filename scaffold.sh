#!/bin/bash
# ============================================================
# Novelty Labels — Next.js 14 Project Scaffold
# Run this from your dev machine after cloning the repo.
# Prerequisites: Node 18+, pnpm (preferred) or npm
# ============================================================

set -e

echo "→ Creating Next.js 14 project..."
pnpm create next-app@latest novelty-labels-tracker \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --no-git

cd novelty-labels-tracker

echo "→ Installing core dependencies..."
pnpm add \
  @supabase/supabase-js \
  @supabase/ssr \
  framer-motion \
  resend \
  date-fns \
  clsx \
  tailwind-merge \
  lucide-react \
  react-hot-toast \
  @radix-ui/react-dialog \
  @radix-ui/react-select \
  @radix-ui/react-dropdown-menu \
  @radix-ui/react-tooltip \
  @radix-ui/react-switch \
  @radix-ui/react-popover

echo "→ Installing dev dependencies..."
pnpm add -D \
  @types/node \
  prettier \
  prettier-plugin-tailwindcss

echo "→ Done. Project ready."
echo ""
echo "Next steps:"
echo "  1. Copy .env.local.example → .env.local and fill in your Supabase keys"
echo "  2. pnpm dev"
