'use client';
// src/components/admin/PendingDispatchNotifications.tsx
// The dispatch email queue: parties on the left, the chosen party's email on
// the right — vehicle and LR fields above a live preview of exactly what will
// be sent (GET /api/dispatch-notifications/preview, built by the same
// template as the send route).
//
// One email per party: the party gets a single consolidated letter for every
// item in its group, because it only cares about the one truck. Tick the
// parties that are ready and "Send N emails" sends each party its letter;
// a party with no contact on file can't be ticked — there is nowhere to send.
//
// Internal team and party are still notified independently: "Send to Team"
// in the right pane goes first when the team wants to check the dispatch,
// and marks the items notified without clearing them. Only the party send
// clears a party off this list.
//
// Vehicle no and LR ride in each item's remark, which the email prints
// (lib/dispatchRemark.ts) — saved when the field is left.

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Send, Mail, PackageCheck, Plus, Pencil, Trash2, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatAdminDate } from '@/lib/utils';
import { parseDispatchRemark, composeDispatchRemark } from '@/lib/dispatchRemark';
import type { PendingDispatchGroup, PendingDispatchNotification } from '@/lib/types';
import AddCustomDispatchModal from './AddCustomDispatchModal';

type SendTarget = 'internal' | 'party';
type Preview = { to: string[]; subject: string; html: string };

const ghostBtn = 'inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border border-brand-border bg-white px-3.5 text-sm font-medium text-brand-ink transition-colors hover:bg-brand-surface-alt disabled:opacity-40';
const fieldCls = 'h-11 rounded-[10px] border border-brand-border bg-white px-3 font-mono text-sm uppercase text-brand-ink focus:border-brand-primary focus:outline-none focus:shadow-[0_0_0_4px_rgba(16,85,63,0.14)]';

export default function PendingDispatchNotifications() {
  const [groups,  setGroups]  = useState<PendingDispatchGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingKey, setSendingKey] = useState<string | null>(null);
  const [modalItem, setModalItem] = useState<PendingDispatchNotification | 'new' | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [checked,  setChecked]  = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/dispatch-notifications');
      const data = await res.json();
      if (res.ok) setGroups(data.groups ?? []);
      else toast.error(data.error ?? 'Failed to load pending dispatches');
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const ready = useMemo(() => groups.filter((g) => (g.contact_count ?? 0) > 0).map((g) => g.party), [groups]);

  // Keep the selection and ticks pointing at parties that still exist; tick
  // every ready party the first time the list arrives.
  const [ticksSeeded, setTicksSeeded] = useState(false);
  useEffect(() => {
    if (loading) return;
    setSelected((s) => (s && groups.some((g) => g.party === s) ? s : groups[0]?.party ?? null));
    setChecked((prev) => {
      if (!ticksSeeded) return new Set(ready);
      return new Set(Array.from(prev).filter((p) => ready.includes(p)));
    });
    setTicksSeeded(true);
  }, [groups, ready, loading, ticksSeeded]);

  const group = groups.find((g) => g.party === selected) ?? null;

  async function removeItem(item: PendingDispatchNotification) {
    setDeletingId(item.id);
    try {
      const res  = await fetch(`/api/dispatch-notifications/${item.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to remove entry');
        return;
      }
      setGroups((prev) => prev
        .map((g) => (g.party === item.party ? { ...g, items: g.items.filter((i) => i.id !== item.id) } : g))
        .filter((g) => g.items.length > 0));
      toast.success('Entry removed');
    } catch {
      toast.error('Network error');
    } finally {
      setDeletingId(null);
    }
  }

  /** Returns true when the send went through (or was marked sent). */
  async function sendFor(party: string, target: SendTarget, itemIds?: string[], quiet = false): Promise<boolean> {
    const key = itemIds && itemIds.length === 1 ? `item:${itemIds[0]}` : `${party}:${target}`;
    setSendingKey(key);
    try {
      const res  = await fetch('/api/dispatch-notifications/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ party, target, itemIds }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(`${party}: ${data.error ?? 'Failed to send'}`);
        return false;
      }
      if (data.skipped) {
        if (!quiet) toast.error(itemIds ? 'Nothing pending for this item anymore' : 'Nothing left to send for this party');
        return false;
      }

      const audience = target === 'party' ? 'party' : 'internal team';
      const delivered = target === 'party' ? data.sent_to_party : data.sent_to_internal;
      if (!quiet) {
        toast.success(
          delivered
            ? `Sent to ${audience} — ${data.item_count} item${data.item_count === 1 ? '' : 's'}`
            : `Marked sent (no ${audience === 'party' ? 'contact' : 'recipients'} on file to actually deliver to)`,
        );
      }

      if (target === 'party') {
        setGroups((prev) => prev.filter((g) => g.party !== party));
      } else {
        const now = new Date().toISOString();
        setGroups((prev) => prev.map((g) => (
          g.party === party
            ? { ...g, items: g.items.map((i) => (!itemIds || itemIds.includes(i.id) ? { ...i, internal_notified_at: now } : i)) }
            : g
        )));
      }
      return true;
    } catch {
      toast.error('Network error');
      return false;
    } finally {
      setSendingKey(null);
    }
  }

  async function sendChecked() {
    const parties = groups.map((g) => g.party).filter((p) => checked.has(p));
    let sent = 0;
    for (const p of parties) {
      if (await sendFor(p, 'party', undefined, true)) sent++;
    }
    if (sent) toast.success(`${sent} dispatch email${sent === 1 ? '' : 's'} sent`);
  }

  const checkedCount = groups.filter((g) => checked.has(g.party)).length;
  const allReadyChecked = ready.length > 0 && ready.every((p) => checked.has(p));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        {!loading ? (
          <p className="text-sm text-brand-muted">
            <strong className="font-mono text-brand-ink">{groups.length}</strong>
            {' '}{groups.length === 1 ? 'party' : 'parties'} with unsent dispatches
          </p>
        ) : <span />}
        <button onClick={() => setModalItem('new')} className={ghostBtn}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Custom entry
        </button>
      </div>

      {modalItem && (
        <AddCustomDispatchModal
          existing={modalItem === 'new' ? null : modalItem}
          onClose={() => setModalItem(null)}
          onSaved={() => { setModalItem(null); load(); }}
        />
      )}

      {loading ? (
        <div className="space-y-2" aria-hidden="true">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-brand-sunken" />)}
        </div>
      ) : groups.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-brand-border bg-white px-4 py-12 text-center">
          <PackageCheck className="h-6 w-6 text-brand-muted" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-brand-ink">Nothing pending.</p>
          <p className="mt-1 text-xs text-brand-muted">Every dispatched job so far has had its email sent.</p>
        </div>
      ) : (
        <div className="flex flex-wrap overflow-hidden rounded-2xl border border-brand-border bg-white shadow-[0_2px_8px_rgba(12,42,32,0.04)]">
          {/* ── queue ── */}
          <div className="min-w-0 flex-[1_1_380px] border-brand-line-soft lg:max-w-[440px] lg:border-r">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-line-soft px-4 py-3">
              <label className="flex min-h-11 items-center gap-2.5 text-sm text-brand-ink">
                <input
                  type="checkbox"
                  checked={allReadyChecked}
                  disabled={ready.length === 0}
                  onChange={() => setChecked(allReadyChecked ? new Set() : new Set(ready))}
                  className="h-5 w-5 accent-brand-primary"
                />
                <span>Select ready (<span className="font-mono">{ready.length}</span>)</span>
              </label>
              <button
                type="button"
                onClick={sendChecked}
                disabled={checkedCount === 0 || sendingKey !== null}
                className="inline-flex min-h-11 items-center gap-2 rounded-[10px] bg-brand-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-primary-hover disabled:opacity-40"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
                {sendingKey?.endsWith(':party') ? 'Sending…' : `Send ${checkedCount} email${checkedCount === 1 ? '' : 's'}`}
              </button>
            </div>
            <ul>
              {groups.map((g) => {
                const n = g.contact_count ?? 0;
                const qty = g.items.reduce((s, i) => s + (i.qty ?? 0), 0);
                const on = g.party === selected;
                const kinds = g.items.some((i) => i.status === 'Partial Dispatch') ? 'Part dispatch' : 'Full dispatch';
                return (
                  <li key={g.party} className={cn('flex items-start gap-3 border-b border-brand-line-soft px-4 py-3.5 last:border-b-0', on && 'bg-brand-surface-hover')}>
                    <input
                      type="checkbox"
                      checked={checked.has(g.party)}
                      disabled={n === 0}
                      onChange={() => setChecked((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.party)) next.delete(g.party); else next.add(g.party);
                        return next;
                      })}
                      aria-label={`Select ${g.party}`}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-brand-primary disabled:opacity-40"
                    />
                    <button type="button" onClick={() => setSelected(g.party)} aria-current={on ? 'true' : undefined} className="flex min-w-0 flex-1 flex-col gap-0.5 text-left">
                      <span className="flex justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-brand-ink">{g.party}</span>
                        <span className="shrink-0 font-mono text-[11px] text-brand-muted">{formatAdminDate(g.items[g.items.length - 1].created_at)}</span>
                      </span>
                      <span className="truncate text-[13px] text-brand-muted">
                        <span className="font-mono">{g.items.length === 1 ? g.items[0].po_number : `${g.items.length} items`}</span>
                        {qty > 0 && <> · <span className="font-mono">{qty.toLocaleString('en-IN')}</span> labels</>} · {kinds}
                      </span>
                      <span className={cn('text-xs', n > 0 ? 'text-brand-success' : 'font-semibold text-brand-danger')}>
                        {n > 0 ? `${n} contact${n === 1 ? '' : 's'}` : 'No contact saved — add one under Party contacts'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* ── chosen party ── */}
          {group && (
            <PartyPane
              key={group.party}
              group={group}
              sendingKey={sendingKey}
              deletingId={deletingId}
              onSendTeam={(ids) => sendFor(group.party, 'internal', ids)}
              onSendParty={() => sendFor(group.party, 'party')}
              onEdit={(item) => setModalItem(item)}
              onRemove={removeItem}
              onSaved={load}
            />
          )}
        </div>
      )}
    </div>
  );
}

function PartyPane({ group, sendingKey, deletingId, onSendTeam, onSendParty, onEdit, onRemove, onSaved }: {
  group:       PendingDispatchGroup;
  sendingKey:  string | null;
  deletingId:  string | null;
  onSendTeam:  (itemIds?: string[]) => void;
  onSendParty: () => void;
  onEdit:      (item: PendingDispatchNotification) => void;
  onRemove:    (item: PendingDispatchNotification) => void;
  onSaved:     () => void;
}) {
  const first = parseDispatchRemark(group.items[0]?.remark);
  const [vehicle, setVehicle] = useState(first.vehicle);
  const [lr, setLr]           = useState(first.lr);
  const [saving, setSaving]   = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    fetch(`/api/dispatch-notifications/preview?party=${encodeURIComponent(group.party)}`)
      .then((r) => r.json())
      .then((d) => { if (live && !d.error) setPreview(d); })
      .catch(() => { /* preview is a convenience — sending doesn't depend on it */ });
    return () => { live = false; };
  }, [group.party, version]);

  // Write vehicle / LR into every item's remark that doesn't already say so.
  async function saveDetails() {
    const changes = group.items
      .map((item) => {
        const r = parseDispatchRemark(item.remark);
        const next = composeDispatchRemark({ vehicle, lr, rest: r.rest });
        return next === (item.remark ?? '') ? null : { item, next };
      })
      .filter((x): x is { item: PendingDispatchNotification; next: string } => Boolean(x));
    if (changes.length === 0) return;
    setSaving(true);
    try {
      for (const { item, next } of changes) {
        const res = await fetch(`/api/dispatch-notifications/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            party: item.party, po_number: item.po_number, job_name: item.job_name ?? '',
            pm_code: item.pm_code ?? '', status: item.status, qty: item.qty, remark: next,
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          toast.error(d.error ?? 'Could not save the vehicle details');
          return;
        }
      }
      setVersion((v) => v + 1);
      onSaved();
    } catch {
      toast.error('Network error');
    } finally {
      setSaving(false);
    }
  }

  const teamDone = group.items.every((i) => i.internal_notified_at);

  return (
    <div className="flex min-w-0 flex-[2_1_480px] flex-col gap-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-[10px] font-medium uppercase tracking-[0.025em] text-brand-muted">
          Vehicle no
          <input value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} onBlur={saveDetails} placeholder="GJ 16 AX 4471" className={cn(fieldCls, 'w-[180px]')} />
        </label>
        <label className="flex flex-col gap-1.5 text-[10px] font-medium uppercase tracking-[0.025em] text-brand-muted">
          LR / docket
          <input value={lr} onChange={(e) => setLr(e.target.value.toUpperCase())} onBlur={saveDetails} placeholder="LR-88213" className={cn(fieldCls, 'w-[150px]')} />
        </label>
        <span className="min-h-11 pb-3 text-xs text-brand-muted">{saving ? 'Saving…' : 'Saved to every item, printed in the email.'}</span>
        <span className="ml-auto flex gap-2">
          <button type="button" onClick={() => onSendTeam()} disabled={sendingKey !== null} className={ghostBtn}>
            {teamDone ? <CheckCircle2 className="h-4 w-4 text-brand-success" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
            {sendingKey === `${group.party}:internal` ? 'Sending…' : teamDone ? 'Team notified' : 'Send to Team'}
          </button>
          <button
            type="button"
            onClick={onSendParty}
            disabled={sendingKey !== null}
            className="inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap rounded-[10px] bg-brand-primary px-3.5 text-sm font-semibold text-white hover:bg-brand-primary-hover disabled:opacity-40"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            {sendingKey === `${group.party}:party` ? 'Sending…' : 'Send to party'}
          </button>
        </span>
      </div>

      {/* Live preview — what Send will deliver. */}
      <div className="overflow-hidden rounded-xl border border-brand-border">
        <div className="flex flex-col gap-1 border-b border-brand-line-soft bg-brand-surface-alt px-4 py-3 text-[13px]">
          <span className="truncate"><span className="mr-2 text-[10px] font-medium uppercase tracking-[0.025em] text-brand-muted">To</span>
            {preview ? (preview.to.length ? preview.to.join(' · ') : <span className="font-semibold text-brand-danger">No contact on file</span>) : '…'}
          </span>
          <span className="truncate"><span className="mr-2 text-[10px] font-medium uppercase tracking-[0.025em] text-brand-muted">Subject</span>
            <strong>{preview?.subject ?? '…'}</strong>
          </span>
        </div>
        {preview?.html ? (
          <iframe title={`Email preview for ${group.party}`} srcDoc={preview.html} sandbox="" className="h-[420px] w-full bg-white" />
        ) : (
          <div className="h-[200px] animate-pulse bg-brand-sunken motion-reduce:animate-none" aria-hidden="true" />
        )}
      </div>

      {/* Items in this email — per-item team send, edit, remove. */}
      <ul className="flex flex-col gap-1">
        {group.items.map((item) => (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-x-3 text-xs">
            <span className="font-medium text-brand-ink">
              {item.job_name ?? item.po_number}
              <span className="ml-1.5 font-mono font-normal text-brand-muted">{item.po_number}{item.pm_code ? ` · PM ${item.pm_code}` : ''}</span>
            </span>
            <span className="flex items-center gap-1 whitespace-nowrap">
              <span className="text-brand-muted">
                {item.status === 'Partial Dispatch' ? 'Partial — ' : ''}
                {item.qty ? <><span className="font-mono">{item.qty.toLocaleString('en-IN')}</span> labels</> : '—'}
              </span>
              <button
                onClick={() => onSendTeam([item.id])}
                disabled={sendingKey !== null}
                aria-label={item.internal_notified_at ? `Resend team notification for ${item.po_number}` : `Send team notification for ${item.po_number}`}
                title={item.internal_notified_at ? 'Resend to Team' : 'Send to Team'}
                className={cn('inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg transition-colors hover:bg-brand-surface-alt disabled:opacity-40', item.internal_notified_at ? 'text-brand-success' : 'text-brand-muted hover:text-brand-ink')}
              >
                {item.internal_notified_at ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Mail className="h-3.5 w-3.5" aria-hidden="true" />}
              </button>
              <button onClick={() => onEdit(item)} aria-label={`Edit entry for ${item.po_number}`} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-brand-muted transition-colors hover:bg-brand-surface-alt hover:text-brand-ink">
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button onClick={() => onRemove(item)} disabled={deletingId === item.id} aria-label={`Remove entry for ${item.po_number}`} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-brand-muted transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40">
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
