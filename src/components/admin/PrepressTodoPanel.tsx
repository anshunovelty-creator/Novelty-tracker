'use client';
// src/components/admin/PrepressTodoPanel.tsx
// A shared reminder checklist for the Prepress team, always visible at
// the top of the Job Separation worksheet rather than tucked behind a
// modal — the whole point is a running list nobody has to go looking
// for. Anyone in Prepress (or Admin) can add a task; checking one off
// deletes it immediately, no confirmation step, since completing a
// task is a routine low-stakes action, not a destructive one. Delete
// is the same underlying action but reserved for "added by mistake" —
// it gets a confirm step, and Edit exists so a typo doesn't have to be
// deleted and retyped from scratch.

import React, { useState, useEffect, useCallback } from 'react';
import { ListChecks, Plus, Check, Pencil, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import type { PrepressTodo } from '@/lib/types';

const inputCls = cn(
  'w-full min-h-11 px-3 py-2 rounded-lg text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

export default function PrepressTodoPanel() {
  const [open,    setOpen]    = useState(true);
  const [todos,   setTodos]   = useState<PrepressTodo[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTask, setNewTask] = useState('');
  const [adding,  setAdding]  = useState(false);
  const [busyId,  setBusyId]  = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);

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

  useEffect(() => { load(); }, [load]);

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

  async function complete(todo: PrepressTodo) {
    setBusyId(todo.id);
    // Optimistic — checking a task off should feel instant, and a failed
    // delete is rare enough to just toast and reload rather than hold the
    // row hostage waiting on the network.
    setTodos((prev) => prev.filter((t) => t.id !== todo.id));
    try {
      const res = await fetch(`/api/prepress-todos/${todo.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error ?? 'Failed to complete task');
        load();
      }
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

  return (
    <div className="glass rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          'w-full flex items-center justify-between gap-3 px-4 min-h-11 py-2.5',
          'text-left hover:bg-black/[0.03] transition-colors',
        )}
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-[var(--glass-ink)]">
          <ListChecks className="w-4 h-4" aria-hidden="true" />
          Prepress To-Do
          {!loading && (
            <span className="font-mono tabular-nums text-[11px] font-medium px-1.5 py-0.5 rounded bg-black/[0.06] text-[var(--glass-muted)]">
              {todos.length}
            </span>
          )}
        </span>
        {open
          ? <ChevronUp className="w-4 h-4 text-[var(--glass-muted)]" aria-hidden="true" />
          : <ChevronDown className="w-4 h-4 text-[var(--glass-muted)]" aria-hidden="true" />}
      </button>

      {open && (
        <div className="border-t border-white/12">
          <form onSubmit={addTask} className="flex items-center gap-2 px-4 py-3 border-b border-white/12">
            <input
              value={newTask}
              onChange={(e) => setNewTask(e.target.value)}
              placeholder="Add a task…"
              aria-label="Add a checklist task"
              className={inputCls}
            />
            <button
              type="submit"
              disabled={adding || !newTask.trim()}
              className={cn(
                'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-lg shrink-0',
                'text-sm font-medium bg-brand-primary text-white hover:bg-brand-primary/90',
                'disabled:opacity-40 transition-colors',
              )}
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Add
            </button>
          </form>

          <div className="px-4 py-2">
            {loading ? (
              <div className="space-y-2 py-2" aria-hidden="true">
                {Array.from({ length: 2 }).map((_, i) => (
                  <div key={i} className="h-9 rounded-lg bg-black/[0.04]" />
                ))}
              </div>
            ) : todos.length === 0 ? (
              <p className="text-sm text-[var(--glass-muted)] text-center py-4">
                No pending tasks — add one above.
              </p>
            ) : (
              <ul className="divide-y divide-white/10">
                {todos.map((t) => {
                  const isEditing = editingId === t.id;
                  return (
                    <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                      {isEditing ? (
                        <input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(t);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          onBlur={() => saveEdit(t)}
                          autoFocus
                          aria-label={`Edit task "${t.task}"`}
                          className={cn(inputCls, 'py-1.5')}
                        />
                      ) : (
                        <span className="text-sm text-[var(--glass-ink)] break-words">{t.task}</span>
                      )}

                      {!isEditing && (
                        <div className="inline-flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => startEdit(t)}
                            disabled={busyId === t.id}
                            aria-label={`Edit "${t.task}"`}
                            title="Edit"
                            className={cn(
                              'inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg',
                              'border border-[var(--glass-border)] text-[var(--glass-muted)]',
                              'hover:bg-black/[0.04] hover:text-[var(--glass-ink)] transition-colors disabled:opacity-50',
                            )}
                          >
                            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>

                          {confirming === t.id ? (
                            <button
                              type="button"
                              onClick={() => remove(t)}
                              onBlur={() => setConfirming((id) => (id === t.id ? null : id))}
                              disabled={busyId === t.id}
                              aria-label={`Confirm deleting "${t.task}"`}
                              className="inline-flex items-center justify-center gap-1.5 min-h-11 px-2.5 rounded-lg text-xs font-medium border border-red-300 bg-red-100 text-red-800 hover:bg-red-200 disabled:opacity-50 transition-colors whitespace-nowrap"
                            >
                              {busyId === t.id ? '…' : 'Confirm'}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirming(t.id)}
                              disabled={busyId === t.id}
                              aria-label={`Delete "${t.task}"`}
                              title="Delete"
                              className={cn(
                                'inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg',
                                'border border-[var(--glass-border)] text-[var(--glass-muted)]',
                                'hover:bg-red-50 hover:border-red-200 hover:text-red-800 transition-colors disabled:opacity-50',
                              )}
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => complete(t)}
                            disabled={busyId === t.id}
                            aria-label={`Mark "${t.task}" complete`}
                            title="Mark complete"
                            className={cn(
                              'inline-flex items-center justify-center gap-1.5 min-h-11 px-2.5 rounded-lg',
                              'text-xs font-medium border transition-colors disabled:opacity-50',
                              'bg-emerald-400/15 border-emerald-300/30 text-emerald-700 hover:bg-emerald-400/25',
                            )}
                          >
                            <Check className="w-3.5 h-3.5" aria-hidden="true" />
                            Done
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
