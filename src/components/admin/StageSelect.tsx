'use client';
// src/components/admin/StageSelect.tsx
// The stage control for a job — replaces the native <select> in JobRow (desk)
// and JobCard (phone). Control Room design: the trigger is a white card with
// the stage dot, the stage name, "step n/N" and a tick bar of the whole
// pipeline; opening it shows a menu that says what the job is doing now, what
// comes next, and what is out of reach and why.
//
// Layout only. Every rule — which stages a department may pick, which open a
// modal first, backward moves being Admin-only — still lives in useJobActions
// (or JobDetailClient's copy of it); a pick here just calls
// actions.handleStageSelect, exactly as the select did.
//
// The menu is portalled to <body> with fixed positioning: the jobs table sits
// in a scrolling wrapper that would clip an absolutely positioned menu.

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { ArrowRight, ChevronDown, ChevronRight, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STAGE_DOT } from '@/lib/constants/statusColors';
import { canDeptSetStage } from '@/lib/constants/departments';
import { PIPELINE_STAGES, effectiveStageIndex, stageIndex } from '@/lib/constants/stages';
import type { Job } from '@/lib/types';
import type { DeptPermissions } from '@/lib/constants/departments';
import type { Stage } from '@/lib/constants/stages';
import type { JobActions } from '@/hooks/useJobActions';

type Props = {
  job:       Job;
  dept:      DeptPermissions;
  /** The slice of useJobActions this control needs. Job detail keeps its
   *  own copy of the stage rules and passes the same four things. */
  actions:   Pick<JobActions, 'availableStages' | 'completedSet' | 'submitting' | 'handleStageSelect'>;
  /** How the job is named in labels — job card number, else PO. */
  jobLabel:  string;
  variant?:  'row' | 'card';
};

type Item = {
  kind:   'pick' | 'now' | 'locked';
  stage:  Stage;
  title:  string;
  hint:   string;
  badge?: 'next' | 'back';
};

const MENU_W = 320;
const GAP    = 6;

export default function StageSelect({ job, dept, actions, jobLabel, variant = 'row' }: Props) {
  const [open, setOpen]               = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);
  const [pos, setPos]                 = useState<{ top: number; left: number; maxH: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef    = useRef<HTMLDivElement>(null);
  const menuId     = useId();

  const status    = job.status as Stage;
  const held      = status === 'On Hold';
  const closed    = status === 'PO Closed';
  const completed = Array.from(actions.completedSet) as Stage[];
  const allowed   = (s: Stage) => canDeptSetStage(dept, s, job.printing_method);

  // ── Where the job sits ────────────────────────────────────
  // The visible pipeline for this job (Repeat skips three stages; scheduled
  // releases drop the per-release ones). A held job is measured by the
  // furthest stage it reached — that is what resuming returns it to.
  const pipeline = actions.availableStages.filter((s) => PIPELINE_STAGES.includes(s));
  const eff      = effectiveStageIndex(status, completed);
  let   reached  = -1;
  pipeline.forEach((s, i) => { if (stageIndex(s) <= eff) reached = i; });
  const total    = pipeline.length;
  const step     = closed ? 'closed' : held ? 'held' : `${reached + 1}/${total}`;

  const earlier = pipeline.filter((s) => stageIndex(s) < eff && s !== status);
  const ahead   = pipeline.filter((s) => stageIndex(s) > eff);

  // ── Menu model ────────────────────────────────────────────
  const items: Item[] = [];
  if (!held && !closed && PIPELINE_STAGES.includes(status)) {
    items.push({ kind: 'now', stage: status, title: status, hint: 'Where the job is now' });
  }
  ahead.forEach((s, skips) => {
    if (!allowed(s)) {
      items.push({ kind: 'locked', stage: s, title: s, hint: 'Set by another department' });
    } else if (skips === 0) {
      items.push({
        kind: 'pick', stage: s, badge: 'next',
        title: held ? `Resume at ${s}` : s,
        hint:  held ? 'Picks up where it stopped' : 'The next stage',
      });
    } else {
      items.push({
        kind: 'pick', stage: s, title: s,
        hint: `Skips ${skips} stage${skips === 1 ? '' : 's'} — prerequisites are checked`,
      });
    }
  });

  const earlierItems: Item[] = earlier.map((s) =>
    dept.isSuperAdmin
      ? { kind: 'pick', stage: s, title: s, badge: 'back', hint: 'Moves back — asks for a reason' }
      : { kind: 'locked', stage: s, title: s, hint: 'Stages only move forward' },
  );

  const canHold  = !held && !closed && actions.availableStages.includes('On Hold') && allowed('On Hold');
  const canClose = !closed && actions.availableStages.includes('PO Closed') && allowed('PO Closed');

  // ── Open / close ──────────────────────────────────────────
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setShowEarlier(false);
    setPos(null);
    if (refocus) triggerRef.current?.focus();
  }, []);

  function pick(stage: Stage) {
    close(true);
    actions.handleStageSelect(stage);
  }

  // Place the menu under the trigger, flipping above when the viewport runs
  // out, and clamped inside a 16px gutter on narrow screens.
  const place = useCallback(() => {
    const t = triggerRef.current;
    if (!t) return;
    const r     = t.getBoundingClientRect();
    const vw    = window.innerWidth;
    const vh    = window.innerHeight;
    const width = Math.min(MENU_W, vw - 32);
    const left  = Math.min(Math.max(16, r.left), vw - 16 - width);
    const below = vh - r.bottom - GAP - 16;
    const above = r.top - GAP - 16;
    const menuH = menuRef.current?.scrollHeight ?? 420;
    if (below >= Math.min(menuH, 320) || below >= above) {
      setPos({ top: r.bottom + GAP, left, maxH: below });
    } else {
      setPos({ top: r.top - GAP - Math.min(menuH, above), left, maxH: above });
    }
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, showEarlier, place]);

  useEffect(() => {
    if (!open) return;
    function onPointer(e: PointerEvent) {
      const n = e.target as Node;
      if (menuRef.current?.contains(n) || triggerRef.current?.contains(n)) return;
      close(false);
    }
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, close, place]);

  // Focus the most likely pick when the menu opens: Next, else the first
  // enabled item.
  useEffect(() => {
    if (!open || !pos) return;
    const m = menuRef.current;
    if (!m || m.contains(document.activeElement)) return;
    const first = m.querySelector<HTMLElement>('[data-next]') ?? enabledItems(m)[0];
    first?.focus();
  }, [open, pos]);

  function onMenuKey(e: React.KeyboardEvent) {
    const m = menuRef.current;
    if (!m) return;
    if (e.key === 'Escape') { e.preventDefault(); close(true); return; }
    if (e.key === 'Tab')    { close(false); return; }
    const list = enabledItems(m);
    const i    = list.indexOf(document.activeElement as HTMLElement);
    let to: HTMLElement | undefined;
    if (e.key === 'ArrowDown') to = list[(i + 1) % list.length];
    if (e.key === 'ArrowUp')   to = list[(i - 1 + list.length) % list.length];
    if (e.key === 'Home')      to = list[0];
    if (e.key === 'End')       to = list[list.length - 1];
    if (to) { e.preventDefault(); to.focus(); }
  }

  function onTriggerKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
    }
  }

  // ── Render ────────────────────────────────────────────────
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={actions.submitting}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Stage for job ${jobLabel}: ${status}${held || closed ? '' : `, step ${reached + 1} of ${total}`}. Change stage`}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={onTriggerKey}
        className={cn(
          'flex w-full flex-col justify-center gap-[7px] rounded-xl border bg-white text-left',
          'shadow-[0_1px_2px_rgba(12,42,32,0.05)] transition-[border-color,box-shadow] duration-150',
          'motion-reduce:transition-none disabled:cursor-progress disabled:opacity-70',
          variant === 'card' ? 'min-h-[56px] px-3.5 py-2.5' : 'min-h-[52px] py-2 pl-3 pr-2.5',
          open
            ? 'border-brand-primary shadow-[0_0_0_4px_rgba(16,85,63,0.12)]'
            : 'border-brand-border hover:border-[#C9D6CF] hover:shadow-[0_2px_8px_rgba(12,42,32,0.08)]',
        )}
      >
        <span className="flex items-center gap-2">
          <Dot stage={status} />
          <span className={cn(
            'flex-1 truncate font-semibold text-brand-ink',
            variant === 'card' ? 'text-sm' : 'text-[13px]',
          )}>
            {status}
          </span>
          <span className="font-mono text-[11px] text-brand-muted">
            {actions.submitting ? 'saving…' : step}
          </span>
          <ChevronDown
            aria-hidden="true"
            strokeWidth={2.2}
            className={cn(
              'h-3.5 w-3.5 shrink-0 text-brand-muted transition-transform duration-150 motion-reduce:transition-none',
              open && 'rotate-180 text-brand-primary',
            )}
          />
        </span>
        {total > 0 && (
          <span aria-hidden="true" className="flex gap-[2px]">
            {pipeline.map((s, k) => (
              <span
                key={s}
                className={cn(
                  'h-[3px] flex-1 rounded-[2px]',
                  closed || k <= reached ? (held ? 'bg-[#D97706]' : 'bg-brand-primary') : 'bg-[#E9EEEB]',
                )}
              />
            ))}
          </span>
        )}
      </button>

      {open && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`Change stage for job ${jobLabel}`}
          onKeyDown={onMenuKey}
          style={{
            position:   'fixed',
            top:        pos?.top ?? 0,
            left:       pos?.left ?? 0,
            width:      `min(${MENU_W}px, calc(100vw - 32px))`,
            maxHeight:  pos ? Math.max(200, pos.maxH) : undefined,
            visibility: pos ? 'visible' : 'hidden',
            // The portal sits outside .admin-light, so it carries its focus ring.
            ['--focus-ring' as string]:  '#10553F',
            ['--focus-bloom' as string]: '0 0 0 4px rgba(16, 85, 63, 0.16)',
          }}
          className={cn(
            'stage-menu-in z-[60] flex flex-col gap-0.5 overflow-y-auto rounded-[14px] border border-brand-border bg-white p-1.5',
            'font-sans text-brand-ink shadow-[0_18px_40px_rgba(12,42,32,0.16),0_2px_6px_rgba(12,42,32,0.06)]',
          )}
        >
          <div className="flex items-center justify-between gap-3 px-2.5 pb-2 pt-2.5 text-xs text-brand-muted">
            <span>
              Move <span className="font-mono font-semibold text-brand-ink">{jobLabel}</span> to
            </span>
            <span className="truncate">as {dept.displayName}</span>
          </div>

          {earlierItems.length > 0 && (
            <>
              <button
                type="button"
                role="menuitem"
                aria-expanded={showEarlier}
                onClick={() => setShowEarlier((v) => !v)}
                className="flex min-h-[44px] w-full items-center gap-2 rounded-[10px] px-2.5 text-left text-xs font-semibold text-brand-muted hover:bg-brand-bg"
              >
                <ChevronRight
                  aria-hidden="true"
                  className={cn('h-3.5 w-3.5 transition-transform motion-reduce:transition-none', showEarlier && 'rotate-90')}
                />
                Earlier stages · {earlierItems.length}
              </button>
              {showEarlier && earlierItems.map((it) => <MenuRow key={it.stage} item={it} onPick={pick} />)}
              <div className="mx-1.5 my-1 h-px bg-brand-line-soft" />
            </>
          )}

          {items.map((it) => <MenuRow key={it.stage} item={it} onPick={pick} />)}

          {(canHold || canClose) && <div className="mx-1.5 my-1 h-px bg-brand-line-soft" />}
          {canHold && (
            <MenuRow
              item={{ kind: 'pick', stage: 'On Hold', title: 'Put on hold…', hint: 'Asks for a reason' }}
              onPick={pick}
              hold
            />
          )}
          {canClose && (
            <MenuRow
              item={{ kind: 'pick', stage: 'PO Closed', title: 'Close PO…', hint: 'Takes it off every list but reports' }}
              onPick={pick}
            />
          )}

          <Link
            href={`/admin/jobs/${job.id}`}
            role="menuitem"
            onClick={() => close(false)}
            className="mt-0.5 flex min-h-[44px] items-center justify-between rounded-lg px-2.5 text-xs font-semibold text-brand-primary hover:bg-brand-bg"
          >
            Open full timeline
            <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>,
        document.body,
      )}
    </>
  );
}

function enabledItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])'));
}

function Dot({ stage }: { stage: Stage }) {
  return (
    <span
      aria-hidden="true"
      className="h-2 w-2 shrink-0 rounded-full ring-[3px] ring-[rgba(12,42,32,0.06)]"
      style={{ background: STAGE_DOT[stage] ?? '#94A39B' }}
    />
  );
}

const BADGE = 'rounded-full px-[7px] py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em]';

function MenuRow({ item, onPick, hold }: { item: Item; onPick: (s: Stage) => void; hold?: boolean }) {
  const base = 'flex min-h-[48px] w-full items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-left';
  const text = (
    <span className="flex min-w-0 flex-1 flex-col gap-px">
      <span className={cn('text-[13px] font-semibold', hold ? 'text-brand-warning' : 'text-brand-ink')}>
        {item.title}
      </span>
      <span className="text-[11px] text-brand-muted">{item.hint}</span>
    </span>
  );

  if (item.kind === 'now') {
    return (
      <div role="menuitem" aria-disabled="true" aria-current="step" className={cn(base, 'bg-brand-bg')}>
        <Dot stage={item.stage} />{text}
        <span className={cn(BADGE, 'bg-brand-border text-brand-muted')}>Now</span>
      </div>
    );
  }

  if (item.kind === 'locked') {
    return (
      <div role="menuitem" aria-disabled="true" className={cn(base, 'cursor-not-allowed opacity-60')}>
        <Lock aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-brand-muted" />
        {text}
      </div>
    );
  }

  const isNext = item.badge === 'next';
  return (
    <button
      type="button"
      role="menuitem"
      data-next={isNext ? '' : undefined}
      onClick={() => onPick(item.stage)}
      className={cn(base, isNext ? 'bg-[#ECFDF5] hover:bg-[#D1FAE5]' : 'hover:bg-brand-bg')}
    >
      <Dot stage={item.stage} />{text}
      {isNext && <span className={cn(BADGE, 'bg-brand-primary text-white')}>Next</span>}
      {item.badge === 'back' && <span className={cn(BADGE, 'bg-[#FFFBEB] text-brand-warning')}>Back</span>}
    </button>
  );
}
