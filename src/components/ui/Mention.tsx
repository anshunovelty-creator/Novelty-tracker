'use client';
// src/components/ui/Mention.tsx
// ============================================================
// @mentions in the app's note and message boxes.
//
//   MentionTextarea — a textarea that opens a people-then-departments list
//   when an @ is typed (or, with trigger="#", a list of jobs the caller finds). ↑/↓ move, Enter or Tab picks, Esc closes; otherwise
//   keys pass through to the composer's own onKeyDown (Ctrl+Enter to post).
//
//   MentionText — renders saved text with each @tag picked out.
//
// The rules (what counts as an @word, ranking, insertion) live in
// src/lib/mentionInput.ts; the names come from useTeamDirectory.
// ============================================================

import { useId, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { applyMention, mentionQuery, rankOptions, splitMentions, type MentionOption, type Trigger } from '@/lib/mentionInput';
import { useTeamDirectory } from '@/hooks/useReferenceData';
import { initials } from '@/lib/team';

type TextareaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'>;

export function MentionTextarea({
  value,
  onValueChange,
  onKeyDown,
  className,
  wrapperClassName,
  inputRef,
  trigger = '@',
  options: givenOptions,
  onQueryChange,
  ...rest
}: TextareaProps & {
  value: string;
  onValueChange: (v: string) => void;
  wrapperClassName?: string;
  /** The composer's own handle on the textarea, e.g. to focus it on Reply. */
  inputRef?: React.MutableRefObject<HTMLTextAreaElement | null>;
  /** '@' tags people and departments (the default); '#' links a job. */
  trigger?: Trigger;
  /**
   * Options already matched to the query by the caller (e.g. a server
   * search); shown as given. Without it, @ ranks the team directory here.
   */
  options?: MentionOption[];
  /** The word being typed after the trigger, or null when there is none. */
  onQueryChange?: (query: string | null) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const listId = useId();
  const { options: people } = useTeamDirectory();
  const [q, setQ] = useState<{ start: number; query: string } | null>(null);
  const [active, setActive] = useState(0);

  const list = !q ? [] : givenOptions ? givenOptions.slice(0, 6) : rankOptions(people, q.query);
  const open = list.length > 0;

  function sync(el: HTMLTextAreaElement) {
    const next = mentionQuery(el.value, el.selectionStart ?? el.value.length, trigger);
    setQ(next);
    if (next?.query !== q?.query) { setActive(0); onQueryChange?.(next ? next.query : null); }
  }

  function pick(i: number) {
    const el = ref.current;
    const o = list[i];
    if (!el || !q || !o) return;
    const r = applyMention(value, q.start, el.selectionStart ?? value.length, o.handle, trigger);
    onValueChange(r.text);
    setQ(null);
    onQueryChange?.(null);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(r.caret, r.caret); });
  }

  function keyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % list.length); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setActive((a) => (a - 1 + list.length) % list.length); return; }
      if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault(); pick(active); return;
      }
      // Close the list, not the drawer or dialog around it.
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQ(null); return; }
    }
    onKeyDown?.(e);
  }

  return (
    <div className={cn('relative', wrapperClassName)}>
      <textarea
        {...rest}
        ref={(el) => { ref.current = el; if (inputRef) inputRef.current = el; }}
        value={value}
        onChange={(e) => { onValueChange(e.target.value); sync(e.target); }}
        onKeyDown={keyDown}
        onKeyUp={(e) => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') sync(e.currentTarget); }}
        onClick={(e) => sync(e.currentTarget)}
        onBlur={(e) => { setQ(null); onQueryChange?.(null); rest.onBlur?.(e); }}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        className={cn('w-full', className)}
      />
      {open && (
        // Above the box: every composer sits at the bottom of its card or drawer.
        <ul
          id={listId}
          role="listbox"
          aria-label={trigger === '#' ? 'Jobs to link' : 'People and departments to tag'}
          className="absolute bottom-full left-0 z-50 mb-1 w-full max-w-[320px] overflow-hidden rounded-xl border border-brand-border bg-white py-1 shadow-[0_12px_32px_rgba(12,42,32,0.16)]"
        >
          {list.map((o, i) => (
            <li
              key={`${o.kind}-${o.handle}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              // mousedown, not click: a click would blur the textarea first and close the list.
              onMouseDown={(e) => { e.preventDefault(); pick(i); }}
              onMouseEnter={() => setActive(i)}
              className={cn(
                'flex min-h-11 cursor-pointer items-center gap-2.5 px-3 py-1.5',
                i === active ? 'bg-brand-surface-alt' : 'bg-white',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                  o.kind === 'person' ? 'bg-[#E2EFE8] text-brand-primary' : 'bg-brand-sunken text-brand-muted',
                )}
              >
                {o.kind === 'job' ? '#' : initials(o.handle)}
              </span>
              <span className="min-w-0">
                <span className={cn('block truncate text-sm font-semibold text-brand-ink', o.kind === 'job' && 'font-mono')}>{trigger}{o.handle}</span>
                <span className="block truncate text-xs text-brand-muted">{o.hint}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Saved text with each @tag in the brand colour. Line breaks are left to the caller's CSS. */
export function MentionText({ text, tagClassName }: { text: string; tagClassName?: string }) {
  return (
    <>
      {splitMentions(text).map((part, i) =>
        part.tag
          ? <span key={i} className={tagClassName ?? 'font-semibold text-brand-primary'}>{part.text}</span>
          : <span key={i}>{part.text}</span>,
      )}
    </>
  );
}
