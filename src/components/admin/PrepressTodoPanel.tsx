'use client';
// src/components/admin/PrepressTodoPanel.tsx
// A shared reminder checklist for the Prepress team — a floating
// launcher + panel, same interaction shape as NotesFeed's chat widget
// (src/components/admin/NotesFeed.tsx), stacked directly above it so
// the two don't collide. Compact sticky-note cards, chat-style add bar
// pinned at the bottom.
//
// Three actions per task: Edit fixes a typo without deleting and
// retyping; Mark as read flags a task as actioned (card turns green)
// without removing it, so the rest of the team can see and verify it;
// Delete removes it for good, whether that's "added by mistake" or
// "read, verified, done" — both end the same way, so Delete keeps its
// confirm step either way.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ListChecks, X, Plus, Check, Pencil, Trash2, History, RotateCcw, Search, Download, AlertTriangle, ChevronLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatAdminDate } from '@/lib/utils';
import { requestOpen, subscribeActiveWidget } from '@/lib/floatingWidgetCoordinator';
import { useResizablePanel } from '@/hooks/useResizablePanel';
import PanelResizeHandles from './PanelResizeHandles';
import { createClient } from '@/lib/supabase/client';
import type { PrepressTodo, PrepressTodoLog } from '@/lib/types';
import Link from 'next/link';
import { format } from 'date-fns';
import { groupTodos, jobTags, splitTags, tagLink } from '@/lib/prepressTodoView';
import { useJobSepTagRows, useJobSepTagSearch } from '@/hooks/useJobSepTags';
import { MentionTextarea } from '@/components/ui/Mention';
import { SearchClearButton } from '@/components/ui/SearchClearButton';

// prepress_todo_logs is auto-trimmed to its 1000 most recent rows
// (029_prepress_todo_logs_trim.sql) — this is where the panel starts
// nudging the team to export & clear before older rows silently roll off.
const LOG_WARN_THRESHOLD = 900;

const LOG_META: Record<PrepressTodoLog['action'], { label: string; icon: typeof Plus; cls: string }> = {
  created:   { label: 'Added',     icon: Plus,      cls: 'border-sky-200 bg-sky-50 text-sky-800' },
  completed: { label: 'Completed', icon: Check,     cls: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  reopened:  { label: 'Reopened',  icon: RotateCcw, cls: 'border-amber-200 bg-amber-50 text-amber-800' },
  edited:    { label: 'Edited',    icon: Pencil,    cls: 'border-slate-200 bg-slate-50 text-slate-800' },
  deleted:   { label: 'Deleted',   icon: Trash2,    cls: 'border-red-200 bg-red-50 text-red-800' },
};

const iconBtnCls = cn(
  'inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg',
  'border border-brand-border text-brand-muted',
  'hover:bg-brand-bg hover:text-brand-ink transition-colors disabled:opacity-50',
);

export default function PrepressTodoPanel() {
  const [open,    setOpen]    = useState(false);
  const { resizable, style: resizeStyle, startResize } = useResizablePanel({
    id: 'prepress-todo',
    defaultWidth: 320,
    defaultHeight: 460,
    minWidth: 280,
    minHeight: 320,
    anchorRight: 20,
    anchorBottom: 20,
    open,
  });
  const [todos,   setTodos]   = useState<PrepressTodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTask, setNewTask] = useState('');
  const [adding,  setAdding]  = useState(false);
  const [busyId,  setBusyId]  = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'history'>('list');
  // Checklist tab: what's still to do, or what's been ticked.
  const [pane, setPane] = useState<'open' | 'done'>('open');
  const [logs, setLogs] = useState<PrepressTodoLog[]>([]);
  const [logTotal, setLogTotal] = useState<number | null>(null);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logQuery, setLogQuery] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const newTaskRef = useRef<HTMLTextAreaElement | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);

  // #tags: what's being typed after a # (either box), the Job Separation rows
  // that match it, and the rows every saved tag names so chips can link.
  const [tagQuery, setTagQuery] = useState<string | null>(null);
  const tagOptions = useJobSepTagSearch(tagQuery);
  const tagRows = useJobSepTagRows(todos.flatMap((t) => jobTags(t.task)));
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read inside the realtime debounce callback below, which only depends on
  // `load` — refs keep it seeing the current view/search without resubscribing
  // the channel on every keystroke or tab switch.
  const viewRef = useRef(view);
  const logQueryRef = useRef(logQuery);
  const exportMenuOpenRef = useRef(exportMenuOpen);
  useEffect(() => { viewRef.current = view; }, [view]);
  useEffect(() => { logQueryRef.current = logQuery; }, [logQuery]);
  useEffect(() => { exportMenuOpenRef.current = exportMenuOpen; }, [exportMenuOpen]);

  // Grow the compose/edit boxes with their content (capped by max-h-28 in
  // the className, which takes over with its own scroll past that) — same
  // shape as a chat app's message box, so Shift+Enter for a new line reads
  // as "make more room" rather than jumping a scrollbar into a single line.
  useEffect(() => {
    const el = newTaskRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [newTask]);
  useEffect(() => {
    const el = editRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [editValue, editingId]);

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/prepress-todos');
      const data = await res.json();
      if (res.ok) setTodos(data.todos ?? []);
      else toast.error(data.error ?? 'Failed to load checklist');
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load in the background even while closed, so the launcher's pending
  // count is right the moment someone opens it — same as NotesFeed's unread badge.
  useEffect(() => { load(); }, [load]);

  // `total` is the unfiltered table count (not the search-filtered result
  // size) — what drives the live counter and the near-1000-cap warning.
  // Declared above the realtime effect below so that effect's dependency
  // array can reference it without a temporal-dead-zone error.
  const loadLogs = useCallback(async (q: string) => {
    setLogsLoading(true);
    try {
      const url = q ? `/api/prepress-todos/logs?q=${encodeURIComponent(q)}` : '/api/prepress-todos/logs';
      const res  = await fetch(url);
      const data = await res.json();
      if (res.ok) {
        setLogs(data.logs ?? []);
        setLogTotal(typeof data.total === 'number' ? data.total : null);
      } else {
        toast.error(data.error ?? 'Failed to load history');
      }
    } catch {
      toast.error('Network error');
    } finally {
      setLogsLoading(false);
    }
  }, []);

  // Realtime is used purely as a "something changed" poke, not as the data
  // source itself — one Postgres change event schedules a single refetch
  // 2s later, and a burst of edits (someone adding several tasks in a row)
  // resets that same timer instead of stacking up refetches. This is the
  // opposite trade-off from the machine room displays (see
  // room-display-refresh-is-polled-not-realtime memory): no periodic
  // polling at all here, just an on-change nudge, since prepress_todos
  // already has an open SELECT policy for every authenticated user.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('prepress_todos_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'prepress_todos' },
        () => {
          if (refreshTimer.current) clearTimeout(refreshTimer.current);
          refreshTimer.current = setTimeout(() => {
            refreshTimer.current = null;
            load();
            // Every log row is a side effect of a prepress_todos mutation, so
            // this same "something changed" signal doubles as the trigger to
            // refresh the History view's log list and live counter — no
            // separate channel needed on prepress_todo_logs itself.
            if (viewRef.current === 'history') loadLogs(logQueryRef.current.trim());
          }, 2000);
        }
      )
      .subscribe();

    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      supabase.removeChannel(channel);
    };
  }, [load, loadLogs]);

  // Close on Escape — a transient overlay, not a route. The export menu is
  // itself a smaller transient overlay nested inside, so Escape closes that
  // first and only closes the whole panel on a second press.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (exportMenuOpenRef.current) { setExportMenuOpen(false); return; }
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // Close the export menu on an outside click — scoped to its own ref so it
  // doesn't fight with the panel's own outside-click-closes-panel handler
  // below (a click on the menu is still "inside" panelRef, so the panel
  // itself stays open).
  useEffect(() => {
    if (!exportMenuOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [exportMenuOpen]);

  // Close on a click/tap anywhere outside the panel — same transient-overlay
  // logic as Escape, just for the pointer. Registered only while open, so
  // the click that opens the panel (via the launcher button) can never
  // immediately close it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Close this widget whenever another floating widget (chat, Meter
  // Calculator) opens — see floatingWidgetCoordinator.ts.
  useEffect(() => {
    if (!open) return;
    return subscribeActiveWidget((activeId) => {
      if (activeId !== 'prepress-todo') setOpen(false);
    });
  }, [open]);

  function handleOpen() {
    requestOpen('prepress-todo');
    setOpen(true);
    load();
  }

  // Debounced search — same 250ms shape as the party typeahead
  // (AddJobSeparationModal). Also fires the initial load when the view
  // switches to 'history', so there's one fetch path, not two.
  useEffect(() => {
    if (view !== 'history') return;
    const timer = setTimeout(() => loadLogs(logQuery.trim()), 250);
    return () => clearTimeout(timer);
  }, [view, logQuery, loadLogs]);

  // Exports the full 1000-row retention pool (wider than the 150 shown on
  // screen — see 029_prepress_todo_logs_trim.sql), respecting the active
  // search so a filtered view exports just that slice. `clear` deletes
  // exactly the exported rows server-side afterward, so the team can
  // archive monthly without ending up with duplicate rows across exports.
  async function exportLogs(clear: boolean) {
    if (exporting) return;
    setExporting(true);
    setExportMenuOpen(false);
    try {
      const q   = logQuery.trim();
      const res = await fetch('/api/prepress-todos/logs/export', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ q: q || undefined, clear }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? 'Export failed');
        return;
      }
      const blob = await res.blob();
      const name = res.headers.get('X-Export-Filename') ?? 'prepress-todo-history.csv';
      const objUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objUrl;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objUrl);
      toast.success(clear ? 'History exported and cleared' : 'History exported');
      if (clear) loadLogs(logQuery.trim());
    } catch {
      toast.error('Network error');
    } finally {
      setExporting(false);
    }
  }

  function toggleView() {
    setConfirming(null);
    setEditingId(null);
    setView((v) => (v === 'list' ? 'history' : 'list'));
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const task = newTask.trim();
    if (!task) return;

    setAdding(true);
    try {
      const res  = await fetch('/api/prepress-todos', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ task }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to add task');
        return;
      }
      setTodos((prev) => [...prev, data.todo]);
      setNewTask('');
    } catch {
      toast.error('Network error');
    } finally {
      setAdding(false);
    }
  }

  async function toggleRead(todo: PrepressTodo) {
    const nextRead = !todo.marked_read_at;
    setBusyId(todo.id);
    // Optimistic — flagging a task should feel instant; a failure just
    // reloads to fall back to the server's actual state.
    setTodos((prev) =>
      prev.map((t) =>
        t.id === todo.id
          ? { ...t, marked_read_at: nextRead ? new Date().toISOString() : null }
          : t
      )
    );
    try {
      const res  = await fetch(`/api/prepress-todos/${todo.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ read: nextRead }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to update task');
        load();
        return;
      }
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? data.todo : t)));
    } catch {
      toast.error('Network error');
      load();
    } finally {
      setBusyId(null);
    }
  }

  function startEdit(todo: PrepressTodo) {
    setConfirming(null);
    setEditingId(todo.id);
    setEditValue(todo.task);
  }

  async function saveEdit(todo: PrepressTodo) {
    const task = editValue.trim();
    if (!task || task === todo.task) {
      setEditingId(null);
      return;
    }

    setBusyId(todo.id);
    try {
      const res  = await fetch(`/api/prepress-todos/${todo.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ task }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to update task');
        return;
      }
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? data.todo : t)));
      setEditingId(null);
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(todo: PrepressTodo) {
    setBusyId(todo.id);
    try {
      const res  = await fetch(`/api/prepress-todos/${todo.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to remove task');
        return;
      }
      setTodos((prev) => prev.filter((t) => t.id !== todo.id));
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
      setConfirming(null);
    }
  }

  const groups    = groupTodos(todos);
  const openCount = groups.blocking.length + groups.general.length;
  const doneCount = groups.doneToday.length + groups.doneEarlier.length;

  /** One checklist row: tick box, the task with any #job tags as links, and Edit / Delete. */
  function renderTask(t: PrepressTodo) {
    const done = Boolean(t.marked_read_at);
    if (editingId === t.id) {
      return (
        <li key={t.id} className="border-t border-brand-line-soft px-4 py-2.5">
          <MentionTextarea
            trigger="#"
            options={tagOptions}
            onQueryChange={setTagQuery}
            inputRef={editRef}
            value={editValue}
            onValueChange={setEditValue}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(t); }
              if (e.key === 'Escape') setEditingId(null);
            }}
            onBlur={() => saveEdit(t)}
            autoFocus
            rows={2}
            aria-label={`Edit task "${t.task}"`}
            className="w-full resize-none rounded-lg border border-brand-primary bg-white px-2.5 py-1.5 text-sm leading-snug text-brand-ink focus:outline-none"
          />
        </li>
      );
    }
    return (
      <li key={t.id} className="group flex items-start gap-3 border-t border-brand-line-soft px-4 py-3 hover:bg-brand-surface-alt">
        <input
          type="checkbox"
          checked={done}
          onChange={() => toggleRead(t)}
          disabled={busyId === t.id}
          aria-label={done ? `Reopen "${t.task}"` : `Done: "${t.task}"`}
          className="mt-0.5 h-[22px] w-[22px] shrink-0 cursor-pointer rounded-[7px] accent-brand-primary"
        />
        <div className="min-w-0 flex-1">
          <p className={cn('whitespace-pre-wrap break-words text-sm leading-snug', done ? 'text-brand-muted line-through' : 'text-brand-ink')}>
            {splitTags(t.task).map((part, i) => {
              if (!part.tag) return <span key={i}>{part.text}</span>;
              const link = tagLink(part.tag, tagRows);
              return (
                <Link
                  key={i}
                  href={link.href}
                  title={link.title}
                  className={cn(
                    'mx-0.5 inline-flex rounded-[7px] border px-1.5 font-mono text-[11px] font-semibold no-underline hover:border-brand-primary',
                    link.known
                      ? 'border-brand-border bg-[#F1F5F2] text-brand-ink'
                      : 'border-dashed border-brand-border bg-white text-brand-muted',
                  )}
                >
                  #{part.tag}
                </Link>
              );
            })}
          </p>
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-brand-muted">
            {done
              ? <span className="font-mono">{format(new Date(t.marked_read_at!), 'dd MMM, HH:mm')}</span>
              : <span>added{t.created_by ? ` by ${t.created_by}` : ''} · {formatAdminDate(t.created_at)}</span>}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => startEdit(t)}
            disabled={busyId === t.id}
            aria-label={`Edit "${t.task}"`}
            title="Edit"
            className={cn(iconBtnCls, '!min-h-9 !min-w-9 bg-white')}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          {confirming === t.id ? (
            <button
              type="button"
              onClick={() => remove(t)}
              onBlur={() => setConfirming((id) => (id === t.id ? null : id))}
              disabled={busyId === t.id}
              aria-label={`Confirm deleting "${t.task}"`}
              title="Click again to permanently delete"
              className="inline-flex min-h-9 items-center justify-center whitespace-nowrap rounded-lg border border-red-300 bg-red-100 px-2.5 text-[11px] font-semibold text-red-800 transition-colors hover:bg-red-200 disabled:opacity-50"
            >
              Confirm
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(t.id)}
              disabled={busyId === t.id}
              aria-label={`Delete "${t.task}"`}
              title="Delete"
              className={cn(iconBtnCls, '!min-h-9 !min-w-9 bg-white hover:border-red-200 hover:bg-red-50 hover:text-red-800')}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </li>
    );
  }

  // ── Launcher — stacked above MessagesWidget (bottom-5) so none of the
  // floating widgets overlap. ─────────────────────────────────────────
  if (!open) {
    return (
      <button
        onClick={handleOpen}
        aria-label={openCount > 0 ? `Prepress To-Do, ${openCount} open` : 'Prepress To-Do'}
        className={cn(
          'admin-fab fixed bottom-24 right-5 z-40 h-14 w-14 rounded-full',
          'bg-brand-primary hover:bg-brand-primary-hover text-white',
          'shadow-lg shadow-black/20 flex items-center justify-center',
          'transition-colors focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/40',
        )}
      >
        <ListChecks className="h-6 w-6" aria-hidden="true" />
        {!loading && openCount > 0 && (
          <span
            className={cn(
              'absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full',
              'bg-amber-400 text-brand-header text-[11px] font-semibold leading-[22px]',
              'ring-2 ring-white',
            )}
          >
            {openCount > 99 ? '99+' : openCount}
          </span>
        )}
      </button>
    );
  }

  // ── Panel ───────────────────────────────────────────────────────
  return (
    <section
      ref={panelRef}
      aria-label="Prepress To-Do"
      style={resizeStyle}
      className={cn(
        'fixed z-50 grid grid-rows-[auto_minmax(0,1fr)_auto]',
        !resizable && 'admin-fab bottom-24 right-5 w-[min(90vw,320px)] max-h-[min(70vh,460px)]',
        'bg-brand-surface border border-brand-border rounded-2xl',
        'shadow-2xl shadow-black/20 overflow-hidden',
      )}
    >
      {resizable && <PanelResizeHandles onResizeStart={startResize} />}
      <header className="flex items-center justify-between gap-2 px-4 h-12 bg-brand-header text-white shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {/* Drill-down wayfinding: History replaces the icon with an explicit
              back chevron and the title itself changes — the header always
              names the screen you're on, same pattern as a mobile settings
              drill-down, rather than one icon silently toggling meaning. */}
          {view === 'history' ? (
            <button
              type="button"
              onClick={toggleView}
              aria-label="Back to checklist"
              title="Back to checklist"
              className="flex items-center justify-center p-2 -ml-1.5 rounded-lg text-white/75 hover:text-white hover:bg-white/10 transition-colors shrink-0"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : (
            <ListChecks className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <div className="flex items-baseline gap-2 min-w-0">
            <h2 className="text-sm font-semibold">{view === 'history' ? 'History' : 'To-Do'}</h2>
            <span
              className={cn(
                'text-[11px]',
                view === 'history' && logTotal !== null && logTotal >= LOG_WARN_THRESHOLD
                  ? 'text-amber-300 font-medium'
                  : 'text-white/70',
              )}
            >
              {view === 'history'
                ? logTotal !== null ? `${logTotal}/1000 logs` : ''
                : loading ? '' : openCount === 0 ? 'All clear' : `${openCount} open`}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {view === 'list' && (
            <button
              type="button"
              onClick={toggleView}
              aria-label="View history"
              title="View history"
              className="flex items-center gap-1 py-2 pl-2 pr-2.5 rounded-lg text-white/75 hover:text-white hover:bg-white/10 transition-colors text-[11px] font-medium"
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              History
            </button>
          )}
          <button
            onClick={() => setOpen(false)}
            aria-label="Close checklist"
            className="p-2 rounded-lg text-white/75 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Both screens stay mounted side by side in a 200%-wide strip that
          translates by one screen-width — a lightweight "push navigation"
          transition (matches the header's back/History affordances above)
          rather than an abrupt content swap. `inert` on the off-screen pane
          keeps keyboard focus and screen readers from reaching content
          that's translated out of view. motion-reduce drops the animation
          to an instant cut per DESIGN.md's reduced-motion requirement.
          React 18 treats `inert` as a plain attribute: "" turns it on
          (`true` triggers a console warning), hence the cast below. */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        <div
          className={cn(
            'flex h-full w-[200%] transition-transform duration-300 ease-out motion-reduce:transition-none',
            view === 'history' ? '-translate-x-1/2' : 'translate-x-0',
          )}
        >
          <div
            className="w-1/2 h-full shrink-0 overflow-hidden"
            aria-hidden={view === 'history'}
            inert={view === 'history' ? ('' as unknown as boolean) : undefined}
          >
      <div className="flex h-full flex-col">
        {/* Open / Done — a segmented switch, counts in mono. */}
        <div role="radiogroup" aria-label="Show" className="mx-2.5 mt-2.5 flex shrink-0 gap-0.5 rounded-[10px] bg-brand-sunken p-[3px]">
          {([['open', 'Open', openCount], ['done', 'Done', doneCount]] as const).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={pane === id}
              onClick={() => setPane(id)}
              className={cn(
                'h-9 flex-1 rounded-lg text-[13px] transition-colors',
                pane === id ? 'bg-white font-semibold text-brand-ink shadow-[0_1px_3px_rgba(12,42,32,0.12)]' : 'font-medium text-brand-muted hover:text-brand-ink',
              )}
            >
              {label} · <span className="font-mono">{n}</span>
            </button>
          ))}
        </div>
      <ul className="min-h-0 flex-1 overflow-y-auto pb-2">
        {loading ? (
          <li className="space-y-2 px-2.5 pt-2.5" aria-hidden="true">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-12 rounded-xl bg-brand-bg" />
            ))}
          </li>
        ) : (pane === 'open' ? openCount : doneCount) === 0 ? (
          <li className="px-4 py-8 text-center text-xs text-brand-muted">
            {pane === 'open' ? 'Nothing open — add a task below. Type # and a job card to link a job.' : 'Nothing ticked off yet.'}
          </li>
        ) : (
          (pane === 'open'
            ? [['Blocking a job', groups.blocking], ['General', groups.general]] as const
            : [['Done today', groups.doneToday], ['Done earlier', groups.doneEarlier]] as const
          ).filter(([, list]) => list.length > 0).map(([title, list]) => (
            <li key={title}>
              <h3 className="flex justify-between px-4 pb-1.5 pt-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-brand-muted">
                <span>{title}</span><span className="font-mono">{list.length}</span>
              </h3>
              <ul>
                {list.map((t) => renderTask(t))}
              </ul>
            </li>
          ))
        )}
      </ul>
      </div>
          </div>

          <div
            className="w-1/2 h-full shrink-0 flex flex-col overflow-hidden"
            aria-hidden={view === 'list'}
            inert={view === 'list' ? ('' as unknown as boolean) : undefined}
          >
            <div className="flex items-center gap-1.5 px-2.5 pt-2.5 shrink-0">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-brand-muted pointer-events-none" aria-hidden="true" />
                <input
                  value={logQuery}
                  onChange={(e) => setLogQuery(e.target.value)}
                  placeholder="Search history…"
                  aria-label="Search checklist history"
                  className={cn(
                    'w-full min-h-9 pl-8 pr-9 py-1.5 rounded-lg text-xs bg-brand-bg border border-brand-border',
                    'text-brand-ink placeholder:text-brand-muted',
                    'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40',
                  )}
                />
                <SearchClearButton value={logQuery} onClear={() => setLogQuery('')} size="sm" />
              </div>
              <div className="relative shrink-0" ref={exportMenuRef}>
                <button
                  type="button"
                  onClick={() => setExportMenuOpen((v) => !v)}
                  disabled={exporting}
                  aria-label="Export history as CSV"
                  aria-haspopup="true"
                  aria-expanded={exportMenuOpen}
                  title="Export history as CSV (last 1000)"
                  className={cn(iconBtnCls, '!min-h-9 !min-w-9 bg-white')}
                >
                  <Download className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                {exportMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full mt-1 z-10 w-48 rounded-lg border border-brand-border bg-white shadow-lg overflow-hidden"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => exportLogs(false)}
                      disabled={exporting}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-xs text-brand-ink hover:bg-brand-bg disabled:opacity-50 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      Download only
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => exportLogs(true)}
                      disabled={exporting}
                      className="flex w-full items-center gap-2 px-3 py-2.5 text-xs text-red-700 hover:bg-red-50 border-t border-brand-border disabled:opacity-50 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      Download &amp; clear
                    </button>
                  </div>
                )}
              </div>
            </div>
            {logTotal !== null && logTotal >= LOG_WARN_THRESHOLD && (
              <div className="mx-2.5 mt-2 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800 shrink-0">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                <span>Nearing the 1000-log limit ({logTotal}/1000) — export soon before older entries roll off.</span>
              </div>
            )}
            <ul className="flex-1 min-h-0 overflow-y-auto px-2.5 py-2.5 space-y-2">
              {logsLoading ? (
                <li className="space-y-2" aria-hidden="true">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-12 rounded-xl bg-brand-bg" />
                  ))}
                </li>
              ) : logs.length === 0 ? (
                <li className="px-2 py-8 text-center text-xs text-brand-muted">
                  {logQuery.trim() ? 'No matching activity.' : 'No activity yet.'}
                </li>
              ) : (
                logs.map((l) => {
                  const meta = LOG_META[l.action];
                  const Icon = meta.icon;
                  const who = l.actor_email
                    ? l.actor_department ? `${l.actor_email} (${l.actor_department})` : l.actor_email
                    : l.actor_department ?? 'Unknown';
                  return (
                    <li key={l.id} className={cn('rounded-xl border px-3 py-2', meta.cls)}>
                      <div className="flex items-center gap-1.5">
                        <Icon className="w-3 h-3 shrink-0" aria-hidden="true" />
                        <span className="text-[11px] font-semibold">{meta.label}</span>
                      </div>
                      <p className="mt-1 text-xs text-brand-ink break-words leading-snug whitespace-pre-wrap">{l.task}</p>
                      <p className="mt-1 text-[10px] text-brand-muted break-words">
                        {who} · {formatAdminDate(l.created_at)}
                      </p>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </div>
      </div>

      {/* Chat-style compose bar, pinned at the bottom — hidden while viewing history. */}
      {view === 'list' && (
        <form
          onSubmit={addTask}
          className="flex items-end gap-2 px-3 py-2.5 border-t border-brand-border bg-brand-surface shrink-0"
        >
          <MentionTextarea
            trigger="#"
            options={tagOptions}
            onQueryChange={setTagQuery}
            inputRef={newTaskRef}
            wrapperClassName="flex-1"
            value={newTask}
            onValueChange={setNewTask}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            placeholder="Add a task… type # to link a job"
            aria-label="Add a checklist task"
            rows={1}
            className={cn(
              'min-h-11 max-h-28 px-3.5 py-2.5 rounded-2xl text-sm bg-brand-bg border border-brand-border',
              'text-brand-ink placeholder:text-brand-muted resize-none overflow-y-auto leading-snug',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40',
            )}
          />
          <button
            type="submit"
            disabled={adding || !newTask.trim()}
            aria-label="Add task"
            title="Add task"
            className={cn(
              'h-11 w-11 rounded-full shrink-0 flex items-center justify-center',
              'bg-brand-primary text-white hover:bg-brand-primary-hover',
              'disabled:opacity-40 transition-colors',
            )}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
          </button>
        </form>
      )}
    </section>
  );
}
