'use client';
// src/components/ui/Button.tsx
//
// The one button vocabulary for the admin panel.
//
// Before this, 249 buttons were styled by hand: five corner radii in play
// (rounded-lg/xl/full/2xl/md), four different spellings of the same Press
// Green fill (bg-brand-primary, bg-[#10553F], bg-emerald-600,
// bg-[var(--brand-accent)]), and `btnPrimary` defined twice with different
// padding and radius. Buttons read as unconsidered because no two agreed,
// not because they lacked colour.
//
// ── On colour ────────────────────────────────────────────────────────
// DESIGN.md §2's State-Only Spectrum Rule: sky, amber, purple, orange, red
// and emerald encode job state and nothing else. So the intents below are
// not a palette to pick from for variety — each one means something:
//
//   primary  Press Green. The one action this region exists for.
//            DESIGN.md §5: one primary per view region.
//   ghost    No fill of its own. Everything secondary; most buttons.
//   danger   Red, because the action destroys or cannot be undone.
//   tinted   Emerald, for verbs that advance a job's state (approve,
//            dispatch) — the colour matches the state being moved to.
//   caution  Amber, and only where the action puts the job into an
//            amber-coded state: Mark On Hold, Save Partial Dispatch,
//            Skip & Continue. Same rule as tinted — the button wears the
//            colour of the state it produces.
//
// If a button wants colour for any reason other than those, it is a ghost.

import React from 'react';
import { Loader2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ButtonIntent = 'primary' | 'ghost' | 'danger' | 'tinted' | 'caution';
export type ButtonSize   = 'sm' | 'md';

// Surfaces come from the field tokens, which are defined for both the light
// admin shell and the dark mesh — so a Button dropped into /track or /login
// still resolves rather than painting white-on-white.
const INTENT: Record<ButtonIntent, string> = {
  // Solid brand fill; hover deepens to Deep Press (DESIGN.md §2).
  primary:
    'bg-brand-primary text-white border border-transparent ' +
    'hover:bg-[#0C4232] active:bg-[#093528]',
  ghost:
    'bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)] ' +
    'hover:bg-black/[0.04] hover:border-[var(--field-border-hover)] active:bg-black/[0.07]',
  danger:
    'bg-transparent border border-transparent text-[#B91C1C] ' +
    'hover:bg-red-50 hover:border-red-200 active:bg-red-100',
  tinted:
    'bg-emerald-50 border border-emerald-200 text-emerald-800 ' +
    'hover:bg-emerald-100 active:bg-emerald-200',
  caution:
    'bg-amber-50 border border-amber-200 text-amber-800 ' +
    'hover:bg-amber-100 active:bg-amber-200',
};

// Two densities only. `sm` is the in-row action (JobRow's More/Edit/Del),
// `md` is everything standalone and every control on JobCard, which
// PRODUCT.md holds to a 44px tap target.
const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-8 gap-1.5 px-2.5 py-1.5 text-xs rounded-lg',
  md: 'min-h-11 gap-1.5 px-4 text-sm rounded-lg',
};

const BASE =
  'inline-flex items-center justify-center font-medium whitespace-nowrap ' +
  'transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none';

/**
 * The class string a <Button intent size> would carry.
 *
 * For markup that cannot become a <Button> yet — existing dialogs whose
 * footers are being migrated in place. Prefer the component in new code;
 * this exists so a call site keeps its behaviour while its styling moves
 * into one place.
 */
export function buttonClass(
  intent: ButtonIntent = 'ghost',
  size:   ButtonSize   = 'md',
  extra?: string,
) {
  return cn(BASE, SIZE[size], INTENT[intent], extra);
}

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  intent?: ButtonIntent;
  size?:   ButtonSize;
  /** Leading icon. Sized and hidden from assistive tech automatically. */
  icon?:   LucideIcon;
  /** Shows a spinner and disables the button. Use for in-flight requests. */
  busy?:   boolean;
  /** Stretch to the container's width. */
  block?:  boolean;
};

export const Button = React.forwardRef<HTMLButtonElement, Props>(function Button(
  { intent = 'ghost', size = 'md', icon: Icon, busy = false, block = false,
    className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const IconEl = busy ? Loader2 : Icon;

  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(
        // globals.css already supplies the pointer cursor and focus bloom;
        // disabled lives in BASE so every intent fades identically.
        buttonClass(intent, size),
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {IconEl && (
        <IconEl
          className={cn(
            size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4',
            'shrink-0',
            busy && 'animate-spin',
          )}
          aria-hidden="true"
        />
      )}
      {children}
    </button>
  );
});
