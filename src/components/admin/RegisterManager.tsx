'use client';
// src/components/admin/RegisterManager.tsx
// Register — Admin-only customer follow-up CRM: accounts, deals (enquiries
// moving through a 5-stage pipeline), and a follow-up activity log.
// Migrated from a prototype artifact built by Dibin that stored everything
// in ephemeral, per-artifact key/value storage — this version is backed by
// real Supabase tables (027_register_crm.sql) so nothing is lost between
// sessions. Admin-only end to end: gated by canDeptManageRegister both
// here and in every /api/register/* route, and by RLS at the DB layer.

import { useState, useEffect, useCallback, useMemo, useId } from 'react';
import {
  Search, Plus, Users, Contact, KanbanSquare, CalendarClock, History,
  Pencil, Trash2, PhoneCall, Copy,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { ModalShell, ConfirmModal, PromptModal } from './modals';
import CsvExportButton from './CsvExportButton';
import { SkeletonRows } from '@/components/ui/Skeleton';
import type { CsvColumn } from '@/lib/export/csv';
import type {
  RegisterAccount, RegisterDeal, RegisterActivity, RegisterStage, RegisterDealStatus,
} from '@/lib/types';

// ── constants ────────────────────────────────────────────────
const STAGES: { id: RegisterStage; name: string; dot: string }[] = [
  { id: 'enquiry',   name: 'Enquiry',   dot: 'bg-sky-400' },
  { id: 'artwork',   name: 'Artwork',   dot: 'bg-fuchsia-400' },
  { id: 'quotation', name: 'Quotation', dot: 'bg-amber-400' },
  { id: 'approval',  name: 'Approval',  dot: 'bg-violet-400' },
  { id: 'po',        name: 'PO in',     dot: 'bg-emerald-500' },
];
const ACTIVITY_TYPES = ['Call', 'WhatsApp', 'Email', 'Visit', 'Sample sent', 'Quote sent', 'Note'];
const SEGMENTS = ['Agrochem', 'FMCG / Personal care', 'Pharma', 'Food', 'Industrial', 'Other'];
const POLL_MS = 30_000;
type View = 'today' | 'pipeline' | 'accounts' | 'log';

const stageMeta = (id: string) => STAGES.find((s) => s.id === id) ?? STAGES[0];

// ── date helpers ─────────────────────────────────────────────
function todayISO(): string { return new Date().toISOString().slice(0, 10); }
function addDaysISO(n: number): string {
  const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10);
}
function fmtShort(iso: string | null): string {
  if (!iso) return '—';
  const [, m, d] = iso.split('-');
  const M = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d} ${M[Number(m) - 1]}`;
}
function daysLate(iso: string): number {
  return Math.round((new Date(todayISO()).getTime() - new Date(iso).getTime()) / 86_400_000);
}
function dueChipCls(iso: string | null): string {
  if (!iso) return 'bg-white text-[var(--glass-muted)] border border-dashed border-[var(--glass-border)]';
  if (iso < todayISO()) return 'bg-red-100 text-red-800 border border-red-200 font-semibold';
  if (iso === todayISO()) return 'bg-amber-100 text-amber-800 border border-amber-200 font-semibold';
  return 'bg-slate-100 text-slate-700 border border-slate-200';
}
function dueLabel(iso: string | null): string {
  if (!iso) return 'No date';
  if (iso < todayISO()) return `${daysLate(iso)}d late`;
  if (iso === todayISO()) return 'Today';
  return fmtShort(iso);
}
function fmtMoney(v: number | null): string {
  if (v === null) return '—';
  return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

const chip = 'inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium whitespace-nowrap';
const inputCls = cn(
  'w-full min-h-11 px-3.5 py-2 rounded-xl text-sm bg-[var(--glass-bg)] border border-[var(--glass-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);
const labelCls = 'block text-[11px] font-semibold uppercase tracking-wide text-[var(--glass-muted)] mb-1.5';
const btnPrimary = 'inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-xl text-sm font-medium bg-brand-primary text-white hover:bg-brand-primary/90 disabled:opacity-40 transition-colors';
const btnQuiet = 'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-xl text-sm font-medium border border-[var(--glass-border)] text-[var(--glass-muted)] hover:bg-black/[0.04] hover:text-[var(--glass-ink)] transition-colors';
const btnDanger = 'inline-flex items-center justify-center gap-1.5 min-h-9 px-3 rounded-lg text-xs font-medium border border-red-300 bg-red-50 text-red-700 hover:bg-red-100 transition-colors disabled:opacity-50';

// ── main component ───────────────────────────────────────────
export default function RegisterManager() {
  const [accounts,   setAccounts]   = useState<RegisterAccount[]>([]);
  const [deals,      setDeals]      = useState<RegisterDeal[]>([]);
  const [activities, setActivities] = useState<RegisterActivity[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [view,       setView]       = useState<View>('today');
  const [search,     setSearch]     = useState('');

  const [addingAccount, setAddingAccount] = useState(false);
  const [editingAccount, setEditingAccount] = useState<RegisterAccount | null>(null);
  const [detailAccount, setDetailAccount] = useState<RegisterAccount | null>(null);
  const [dealModal, setDealModal] = useState<{ deal: RegisterDeal | null; accountId?: string } | null>(null);
  const [logDeal, setLogDeal] = useState<RegisterDeal | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, d, act] = await Promise.all([
        fetch('/api/register/accounts').then((r) => r.json()),
        fetch('/api/register/deals').then((r) => r.json()),
        fetch('/api/register/activities').then((r) => r.json()),
      ]);
      if (a.accounts) setAccounts(a.accounts);
      if (d.deals) setDeals(d.deals);
      if (act.activities) setActivities(act.activities);
    } catch {
      toast.error('Network error loading Register');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const interval = setInterval(() => { if (document.visibilityState === 'visible') load(); }, POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const accountOf = useCallback((id: string) => accounts.find((a) => a.id === id), [accounts]);
  const openDeals = useMemo(() => deals.filter((d) => d.status === 'open'), [deals]);

  const matchesQuery = useCallback((d: RegisterDeal) => {
    if (!search) return true;
    const a = accountOf(d.account_id);
    const q = search.toLowerCase();
    return (d.title + ' ' + (a ? a.name + ' ' + (a.contact_name ?? '') : '') + ' ' + (d.next_action ?? ''))
      .toLowerCase().includes(q);
  }, [search, accountOf]);

  function afterMutate(msg?: string) { load(); if (msg) toast.success(msg); }

  async function copyWeekReport() {
    const wk = addDaysISO(-7);
    const acts = activities.filter((a) => a.date >= wk);
    const overdue = openDeals.filter((d) => d.next_action_date && d.next_action_date < todayISO());
    const unset = openDeals.filter((d) => !d.next_action_date);
    const won = deals.filter((d) => d.status === 'won' && (d.closed_at ?? '') >= wk);
    const lost = deals.filter((d) => d.status === 'lost' && (d.closed_at ?? '') >= wk);

    let t = `REGISTER — week to ${fmtShort(todayISO())}\n`;
    t += `\nOpen enquiries: ${openDeals.length}`;
    t += `\nFollow-ups logged: ${acts.length}`;
    t += `\nWon: ${won.length}   Lost: ${lost.length}`;
    t += `\n\nOVERDUE (${overdue.length})`;
    overdue.slice(0, 15).forEach((d) => {
      const a = accountOf(d.account_id);
      t += `\n  · ${a?.name ?? '—'} — ${d.title} — ${dueLabel(d.next_action_date)} (${d.owner ?? '—'})`;
    });
    if (!overdue.length) t += '\n  none';
    t += `\n\nNO NEXT DATE (${unset.length})`;
    unset.slice(0, 15).forEach((d) => {
      const a = accountOf(d.account_id);
      t += `\n  · ${a?.name ?? '—'} — ${d.title} (${d.owner ?? '—'})`;
    });
    if (!unset.length) t += '\n  none';

    try {
      await navigator.clipboard.writeText(t);
      toast.success('Week report copied — paste it into WhatsApp or email');
    } catch {
      toast.error('Could not copy — clipboard access blocked');
    }
  }

  const csvColumns: CsvColumn<RegisterDeal>[] = [
    { header: 'Account',     value: (d) => accountOf(d.account_id)?.name ?? '' },
    { header: 'Contact',     value: (d) => accountOf(d.account_id)?.contact_name ?? '' },
    { header: 'Phone',       value: (d) => accountOf(d.account_id)?.phone ?? '' },
    { header: 'Job',         value: (d) => d.title },
    { header: 'Stage',       value: (d) => stageMeta(d.stage).name },
    { header: 'Owner',       value: (d) => d.owner },
    { header: 'Qty',         value: (d) => d.qty },
    { header: 'Value',       value: (d) => d.value },
    { header: 'Next action', value: (d) => d.next_action },
    { header: 'Next date',   value: (d) => d.next_action_date },
    { header: 'Status',      value: (d) => d.status },
  ];

  const VIEW_TABS: { id: View; label: string; icon: typeof CalendarClock }[] = [
    { id: 'today',    label: 'Today',    icon: CalendarClock },
    { id: 'pipeline', label: 'Pipeline', icon: KanbanSquare },
    { id: 'accounts', label: 'Accounts', icon: Contact },
    { id: 'log',      label: 'Log',      icon: History },
  ];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-2">
        <div className="inline-flex rounded-xl border border-[var(--glass-border)] bg-[var(--glass-bg)] p-1 gap-1 shrink-0">
          {VIEW_TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setView(t.id)}
              aria-current={view === t.id}
              className={cn(
                'inline-flex items-center gap-1.5 min-h-9 px-3 rounded-lg text-sm font-medium transition-colors',
                view === t.id
                  ? 'bg-brand-primary text-white'
                  : 'text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-black/[0.04]',
              )}
            >
              <t.icon className="w-4 h-4" aria-hidden="true" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--glass-muted)]" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search accounts, jobs, next actions…"
            aria-label="Search Follow-ups"
            data-global-search
            className={cn(inputCls, 'pl-9 pr-3.5')}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button onClick={copyWeekReport} className={btnQuiet}>
            <Copy className="w-4 h-4" aria-hidden="true" /> Week report
          </button>
          <CsvExportButton rows={openDeals} columns={csvColumns} filename="register-enquiries" />
          <button onClick={() => setAddingAccount(true)} className={btnQuiet}>
            <Users className="w-4 h-4" aria-hidden="true" /> New account
          </button>
          <button onClick={() => setDealModal({ deal: null })} className={btnPrimary}>
            <Plus className="w-4 h-4" aria-hidden="true" /> New enquiry
          </button>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl glass overflow-hidden">
          <table className="w-full text-sm"><tbody><SkeletonRows rows={4} cols={5} /></tbody></table>
        </div>
      ) : view === 'today' ? (
        <TodayView deals={openDeals.filter(matchesQuery)} activities={activities}
          accountOf={accountOf} onLog={setLogDeal} onEdit={(d) => setDealModal({ deal: d })} />
      ) : view === 'pipeline' ? (
        <PipelineView deals={openDeals.filter(matchesQuery)} accountOf={accountOf}
          onEdit={(d) => setDealModal({ deal: d })} />
      ) : view === 'accounts' ? (
        <AccountsView accounts={accounts} deals={deals} search={search} onOpen={setDetailAccount} />
      ) : (
        <LogView activities={activities} accountOf={accountOf} deals={deals} search={search} />
      )}

      {(addingAccount || editingAccount) && (
        <AccountFormModal
          account={editingAccount}
          onClose={() => { setAddingAccount(false); setEditingAccount(null); }}
          onSaved={(msg) => { setAddingAccount(false); setEditingAccount(null); afterMutate(msg); }}
        />
      )}

      {dealModal && (
        <DealFormModal
          deal={dealModal.deal}
          presetAccountId={dealModal.accountId}
          accounts={accounts}
          onClose={() => setDealModal(null)}
          onSaved={(msg) => { setDealModal(null); afterMutate(msg); }}
        />
      )}

      {logDeal && (
        <LogFollowUpModal
          deal={logDeal}
          account={accountOf(logDeal.account_id)}
          onClose={() => setLogDeal(null)}
          onSaved={() => { setLogDeal(null); afterMutate('Follow-up logged'); }}
        />
      )}

      {detailAccount && (
        <AccountDetailModal
          account={detailAccount}
          deals={deals.filter((d) => d.account_id === detailAccount.id)}
          activities={activities.filter((a) => a.account_id === detailAccount.id)}
          onClose={() => setDetailAccount(null)}
          onEditAccount={() => { setEditingAccount(detailAccount); setDetailAccount(null); }}
          onNewDeal={() => { setDealModal({ deal: null, accountId: detailAccount.id }); setDetailAccount(null); }}
          onOpenDeal={(d) => { setDealModal({ deal: d }); setDetailAccount(null); }}
        />
      )}
    </div>
  );
}

// ── row card (Today view) ───────────────────────────────────
function DealRow({ deal, account, onLog, onEdit }: {
  deal: RegisterDeal; account?: RegisterAccount;
  onLog: () => void; onEdit: () => void;
}) {
  const s = stageMeta(deal.stage);
  return (
    <div className="rounded-xl glass p-3 sm:p-3.5 flex flex-col sm:flex-row gap-3 sm:items-center">
      <span className={cn('w-2 h-2 rounded-full shrink-0', s.dot)} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-semibold text-sm text-[var(--glass-ink)]">{account?.name ?? '—'}</span>
          <span className="text-xs text-[var(--glass-muted)]">{deal.title}</span>
        </div>
        <p className="text-xs text-[var(--glass-muted)] mt-1">
          Next: <strong className="text-[var(--glass-ink)] font-normal">{deal.next_action || 'not set'}</strong>
        </p>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          <span className={cn(chip, dueChipCls(deal.next_action_date))}>{dueLabel(deal.next_action_date)}</span>
          <span className={cn(chip, 'bg-violet-50 text-violet-700 border border-violet-200')}>{deal.owner || '—'}</span>
          <span className={cn(chip, 'bg-slate-100 text-slate-600 border border-slate-200')}>{s.name}</span>
          {deal.value !== null && <span className={cn(chip, 'bg-slate-100 text-slate-600 border border-slate-200 font-mono')}>{fmtMoney(deal.value)}</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button onClick={onLog} className={cn(btnPrimary, '!min-h-9 !px-3 text-xs')}>
          <PhoneCall className="w-3.5 h-3.5" aria-hidden="true" /> Log follow-up
        </button>
        <button onClick={onEdit} className={cn(btnQuiet, '!min-h-9 !px-3 text-xs')}>Edit</button>
      </div>
    </div>
  );
}

// ── Today view ───────────────────────────────────────────────
function TodayView({ deals, activities, accountOf, onLog, onEdit }: {
  deals: RegisterDeal[]; activities: RegisterActivity[];
  accountOf: (id: string) => RegisterAccount | undefined;
  onLog: (d: RegisterDeal) => void; onEdit: (d: RegisterDeal) => void;
}) {
  const t = todayISO();
  const overdue = deals.filter((d) => d.next_action_date && d.next_action_date < t)
    .sort((a, b) => (a.next_action_date ?? '').localeCompare(b.next_action_date ?? ''));
  const due = deals.filter((d) => d.next_action_date === t);
  const soon = deals.filter((d) => d.next_action_date && d.next_action_date > t && d.next_action_date <= addDaysISO(7))
    .sort((a, b) => (a.next_action_date ?? '').localeCompare(b.next_action_date ?? ''));
  const unset = deals.filter((d) => !d.next_action_date);

  // Three counts, each a genuine risk signal (not a vanity metric like
  // "logged this week" — that belongs in the week report, not here).
  // Styled to match DashboardSummaryCard's exact card treatment so the
  // whole admin panel shares one KPI-tile vocabulary, not a one-off.
  const tiles = [
    { label: 'Overdue',       n: overdue.length, color: overdue.length > 0 ? 'text-red-600'   : 'text-[var(--glass-ink)]' },
    { label: 'Due today',     n: due.length,     color: due.length > 0    ? 'text-amber-600'  : 'text-[var(--glass-ink)]' },
    { label: 'No next date',  n: unset.length,   color: unset.length > 0  ? 'text-red-600'    : 'text-[var(--glass-ink)]' },
  ];

  if (deals.length === 0) {
    return <EmptyRegister message='No open enquiries yet. Add one with "New enquiry" above.' />;
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {tiles.map((tile) => (
          <div key={tile.label} className="glass rounded-xl px-4 py-4">
            <p className="text-xs text-[var(--glass-muted)] font-medium mb-1">{tile.label}</p>
            <p className={cn('text-2xl font-semibold font-mono tabular-nums', tile.color)}>{tile.n}</p>
          </div>
        ))}
      </div>

      <RegisterSection title="Overdue" urgent list={overdue} emptyMsg="Nothing overdue. This is the state to keep it in." accountOf={accountOf} onLog={onLog} onEdit={onEdit} />
      <RegisterSection title="Due today" list={due} emptyMsg="Nothing scheduled for today." accountOf={accountOf} onLog={onLog} onEdit={onEdit} />
      <RegisterSection title="Unscheduled — at risk" list={unset} emptyMsg="Every open enquiry has a next date. Good." accountOf={accountOf} onLog={onLog} onEdit={onEdit} />
      <RegisterSection title="Next 7 days" list={soon} emptyMsg="Nothing in the coming week." accountOf={accountOf} onLog={onLog} onEdit={onEdit} />
    </div>
  );
}

function RegisterSection({ title, list, emptyMsg, urgent, accountOf, onLog, onEdit }: {
  title: string; list: RegisterDeal[]; emptyMsg: string; urgent?: boolean;
  accountOf: (id: string) => RegisterAccount | undefined;
  onLog: (d: RegisterDeal) => void; onEdit: (d: RegisterDeal) => void;
}) {
  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2 pb-1.5 border-b border-[var(--glass-border)]">
        <h2 className={cn('text-xs font-semibold uppercase tracking-wide', urgent ? 'text-red-600' : 'text-[var(--glass-ink)]')}>{title}</h2>
        <span className="text-xs font-mono text-[var(--glass-muted)]">{list.length}</span>
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-[var(--glass-muted)] py-1.5">{emptyMsg}</p>
      ) : (
        <div className="space-y-2">
          {list.map((d) => (
            <DealRow key={d.id} deal={d} account={accountOf(d.account_id)} onLog={() => onLog(d)} onEdit={() => onEdit(d)} />
          ))}
        </div>
      )}
    </section>
  );
}

// ── Pipeline view ────────────────────────────────────────────
function PipelineView({ deals, accountOf, onEdit }: {
  deals: RegisterDeal[]; accountOf: (id: string) => RegisterAccount | undefined;
  onEdit: (d: RegisterDeal) => void;
}) {
  if (deals.length === 0) return <EmptyRegister message="No open enquiries in the pipeline yet." />;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
      {STAGES.map((s) => {
        const list = deals.filter((d) => d.stage === s.id);
        return (
          <div key={s.id} className="rounded-xl glass overflow-hidden flex flex-col">
            <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-[var(--glass-border)]">
              <span className={cn('w-2 h-2 rounded-full', s.dot)} aria-hidden="true" />
              <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--glass-ink)]">{s.name}</span>
              <span className="ml-auto text-[11px] font-mono text-[var(--glass-muted)]">{list.length}</span>
            </div>
            <div className="p-2 space-y-1.5 flex-1 min-h-[80px]">
              {list.map((d) => (
                <button key={d.id} onClick={() => onEdit(d)}
                  className="w-full text-left rounded-lg border border-[var(--glass-border)] bg-white/60 hover:border-emerald-300/70 transition-colors p-2.5">
                  <p className="text-xs font-semibold text-[var(--glass-ink)]">{accountOf(d.account_id)?.name ?? '—'}</p>
                  <p className="text-[11px] text-[var(--glass-muted)] mt-0.5">{d.title}</p>
                  <span className={cn(chip, dueChipCls(d.next_action_date), 'mt-1.5')}>{dueLabel(d.next_action_date)}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Accounts view ────────────────────────────────────────────
function AccountsView({ accounts, deals, search, onOpen }: {
  accounts: RegisterAccount[]; deals: RegisterDeal[]; search: string;
  onOpen: (a: RegisterAccount) => void;
}) {
  const list = accounts.filter((a) => !search ||
    (a.name + ' ' + (a.contact_name ?? '') + ' ' + (a.city ?? '')).toLowerCase().includes(search.toLowerCase()));

  if (accounts.length === 0) return <EmptyRegister message='No accounts yet. Add one with "New account" above.' />;
  if (list.length === 0) return <p className="text-sm text-[var(--glass-muted)]">No account matches your search.</p>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
      {list.map((a) => {
        const ds = deals.filter((d) => d.account_id === a.id && d.status === 'open');
        const overdue = ds.filter((d) => d.next_action_date && d.next_action_date < todayISO()).length;
        return (
          <button key={a.id} onClick={() => onOpen(a)} className="text-left rounded-xl glass p-4 hover:border-emerald-300/70 transition-colors">
            <h3 className="font-semibold text-sm text-[var(--glass-ink)]">{a.name}</h3>
            <p className="text-xs text-[var(--glass-muted)] mt-1">{a.contact_name || 'No contact named'}{a.contact_role ? ` · ${a.contact_role}` : ''}</p>
            <div className="flex flex-wrap gap-1.5 mt-2.5">
              <span className={cn(chip, 'bg-slate-100 text-slate-600 border border-slate-200')}>{a.segment || '—'}</span>
              <span className={cn(chip, 'bg-slate-100 text-slate-600 border border-slate-200')}>{ds.length} open</span>
              {overdue > 0 && <span className={cn(chip, 'bg-red-100 text-red-800 border border-red-200 font-semibold')}>{overdue} overdue</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Log view ─────────────────────────────────────────────────
function LogView({ activities, accountOf, deals, search }: {
  activities: RegisterActivity[]; accountOf: (id: string) => RegisterAccount | undefined;
  deals: RegisterDeal[]; search: string;
}) {
  const list = activities.filter((x) => !search ||
    ((x.note ?? '') + ' ' + x.type + ' ' + (accountOf(x.account_id)?.name ?? '')).toLowerCase().includes(search.toLowerCase()));

  if (activities.length === 0) return <EmptyRegister message="Nothing logged yet. Every follow-up you record shows up here." />;
  if (list.length === 0) return <p className="text-sm text-[var(--glass-muted)]">No log entry matches your search.</p>;

  return (
    <div className="rounded-xl glass divide-y divide-[var(--glass-border)] overflow-hidden">
      {list.map((x) => {
        const a = accountOf(x.account_id);
        const d = deals.find((dd) => dd.id === x.deal_id);
        return (
          <div key={x.id} className="flex gap-3 px-4 py-3">
            <span className="text-[11px] font-mono text-[var(--glass-muted)] w-14 shrink-0 pt-0.5">{fmtShort(x.date)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className={cn(chip, 'bg-slate-100 text-slate-600 border border-slate-200')}>{x.type}</span>
                <strong className="text-sm text-[var(--glass-ink)]">{a?.name ?? '—'}</strong>
                {d && <span className="text-xs text-[var(--glass-muted)]">{d.title}</span>}
                <span className={cn(chip, 'bg-violet-50 text-violet-700 border border-violet-200')}>{x.by || '—'}</span>
              </div>
              {x.note && <p className="text-xs text-[var(--glass-muted)] mt-1">{x.note}</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EmptyRegister({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center rounded-xl border border-black/[0.08] bg-white px-4 py-14">
      <Contact className="w-6 h-6 text-[var(--glass-muted)]" aria-hidden="true" />
      <p className="text-sm text-[var(--glass-muted)] mt-3 max-w-[42ch]">{message}</p>
    </div>
  );
}

// ── Account form modal ───────────────────────────────────────
function AccountFormModal({ account, onClose, onSaved }: {
  account: RegisterAccount | null; onClose: () => void; onSaved: (msg: string) => void;
}) {
  const titleId = useId();
  const [name, setName] = useState(account?.name ?? '');
  const [contactName, setContactName] = useState(account?.contact_name ?? '');
  const [contactRole, setContactRole] = useState(account?.contact_role ?? '');
  const [phone, setPhone] = useState(account?.phone ?? '');
  const [email, setEmail] = useState(account?.email ?? '');
  const [segment, setSegment] = useState(account?.segment ?? '');
  const [city, setCity] = useState(account?.city ?? '');
  const [notes, setNotes] = useState(account?.notes ?? '');
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function save() {
    if (!name.trim()) return toast.error('Give the account a company name');
    setBusy(true);
    try {
      const url = account ? `/api/register/accounts/${account.id}` : '/api/register/accounts';
      const res = await fetch(url, {
        method: account ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(), contact_name: contactName, contact_role: contactRole,
          phone, email, segment, city, notes,
        }),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error ?? 'Failed to save account');
      onSaved(account ? 'Account updated' : 'Account added');
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!account) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/register/accounts/${account.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error ?? 'Failed to delete account');
      onSaved('Account deleted');
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell titleId={titleId} onClose={onClose}>
      <div className="p-6">
        <h3 id={titleId} className="font-semibold text-[var(--glass-ink)] text-base mb-4">
          {account ? 'Edit account' : 'New account'}
        </h3>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Company name *</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Meghmani Organics" className={inputCls} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Contact person</label>
              <input value={contactName ?? ''} onChange={(e) => setContactName(e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Their role</label>
              <input value={contactRole ?? ''} onChange={(e) => setContactRole(e.target.value)} placeholder="Purchase / Packaging dev" className={inputCls} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Phone</label>
              <input value={phone ?? ''} onChange={(e) => setPhone(e.target.value)} className={inputCls} /></div>
            <div><label className={labelCls}>Email</label>
              <input value={email ?? ''} onChange={(e) => setEmail(e.target.value)} className={inputCls} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Segment</label>
              <select value={segment ?? ''} onChange={(e) => setSegment(e.target.value)} className={inputCls}>
                <option value="">—</option>
                {SEGMENTS.map((s) => <option key={s}>{s}</option>)}
              </select></div>
            <div><label className={labelCls}>Location</label>
              <input value={city ?? ''} onChange={(e) => setCity(e.target.value)} placeholder="Ankleshwar" className={inputCls} /></div>
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea value={notes ?? ''} onChange={(e) => setNotes(e.target.value)} rows={3}
              placeholder="Substrates they run, rate history, who signs off…" className={cn(inputCls, 'resize-none')} />
          </div>
        </div>
        <div className="flex items-center gap-3 justify-between mt-5">
          <div>
            {account && (
              confirmingDelete ? (
                <button onClick={remove} disabled={busy} onBlur={() => setConfirmingDelete(false)} className={btnDanger}>
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Confirm delete
                </button>
              ) : (
                <button onClick={() => setConfirmingDelete(true)} disabled={busy} className={btnDanger}>
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Delete account
                </button>
              )
            )}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)] transition-colors">Cancel</button>
            <button onClick={save} disabled={busy} className={btnPrimary}>{account ? 'Save changes' : 'Add account'}</button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

// ── Deal form modal ──────────────────────────────────────────
function DealFormModal({ deal, presetAccountId, accounts, onClose, onSaved }: {
  deal: RegisterDeal | null; presetAccountId?: string; accounts: RegisterAccount[];
  onClose: () => void; onSaved: (msg: string) => void;
}) {
  const titleId = useId();
  const [accountId, setAccountId] = useState(deal?.account_id ?? presetAccountId ?? accounts[0]?.id ?? '');
  const [title, setTitle] = useState(deal?.title ?? '');
  const [stage, setStage] = useState<RegisterStage>(deal?.stage ?? 'enquiry');
  const [owner, setOwner] = useState(deal?.owner ?? '');
  const [qty, setQty] = useState(deal?.qty ?? '');
  const [value, setValue] = useState(deal?.value?.toString() ?? '');
  const [substrate, setSubstrate] = useState(deal?.substrate ?? '');
  const [nextAction, setNextAction] = useState(deal?.next_action ?? '');
  const [nextDate, setNextDate] = useState(deal?.next_action_date ?? addDaysISO(2));
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [promptingLost, setPromptingLost] = useState(false);

  async function patch(body: Record<string, unknown>, msg: string) {
    if (!deal) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/register/deals/${deal.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error ?? 'Failed to update enquiry');
      onSaved(msg);
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!accountId) return toast.error('Choose an account');
    if (!title.trim()) return toast.error('Describe the job in a line');
    if (deal) {
      return patch({ account_id: accountId, title: title.trim(), stage, owner, qty, value, substrate, next_action: nextAction, next_action_date: nextDate }, 'Enquiry updated');
    }
    setBusy(true);
    try {
      const res = await fetch('/api/register/deals', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account_id: accountId, title: title.trim(), stage, owner, qty, value, substrate, next_action: nextAction, next_action_date: nextDate }),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error ?? 'Failed to add enquiry');
      onSaved('Enquiry added');
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deal) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/register/deals/${deal.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error ?? 'Failed to delete enquiry');
      onSaved('Enquiry deleted');
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(false);
      setConfirmingDelete(false);
    }
  }

  return (
    <>
    <ModalShell titleId={titleId} onClose={onClose}>
      <div className="p-6">
        <h3 id={titleId} className="font-semibold text-[var(--glass-ink)] text-base mb-4">{deal ? 'Edit enquiry' : 'New enquiry'}</h3>
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Account *</label>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputCls}>
              {accounts.length === 0 && <option value="">Add an account first</option>}
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Job / enquiry *</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 500ml herbicide front + back label" className={inputCls} autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Stage</label>
              <select value={stage} onChange={(e) => setStage(e.target.value as RegisterStage)} className={inputCls}>
                {STAGES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div><label className={labelCls}>Owner</label>
              <input value={owner ?? ''} onChange={(e) => setOwner(e.target.value)} placeholder="Who's following up" className={inputCls} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>Quantity</label>
              <input value={qty ?? ''} onChange={(e) => setQty(e.target.value)} placeholder="1,00,000 labels" className={inputCls} /></div>
            <div><label className={labelCls}>Order value ₹</label>
              <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder="1,85,000" className={cn(inputCls, 'font-mono')} /></div>
          </div>
          <div><label className={labelCls}>Substrate / spec</label>
            <input value={substrate ?? ''} onChange={(e) => setSubstrate(e.target.value)} placeholder="Chromo art paper, 5 col + varnish" className={inputCls} /></div>
          <div><label className={labelCls}>Next action</label>
            <input value={nextAction ?? ''} onChange={(e) => setNextAction(e.target.value)} placeholder="Call purchase for artwork approval" className={inputCls} /></div>
          <div>
            <label className={labelCls}>Next action date</label>
            <input type="date" value={nextDate ?? ''} onChange={(e) => setNextDate(e.target.value)} className={inputCls} />
            <div className="flex gap-1.5 mt-1.5 flex-wrap">
              {[['Today', 0], ['Tomorrow', 1], ['+3 days', 3], ['+1 week', 7], ['+15 days', 15]].map(([label, n]) => (
                <button key={label} type="button" onClick={() => setNextDate(addDaysISO(n as number))}
                  className="text-xs px-2.5 py-1 rounded-lg border border-[var(--glass-border)] text-[var(--glass-muted)] hover:bg-black/[0.04] hover:text-[var(--glass-ink)] transition-colors">
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 justify-between mt-5">
          <div className="flex gap-2 flex-wrap">
            {deal && <button onClick={() => setConfirmingDelete(true)} disabled={busy} className={btnDanger}><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Delete</button>}
            {deal && deal.status === 'open' && <button onClick={() => setPromptingLost(true)} disabled={busy} className={cn(btnQuiet, '!min-h-9 !px-3 text-xs')}>Mark lost</button>}
            {deal && deal.status === 'open' && <button onClick={() => patch({ status: 'won' }, 'Marked won')} disabled={busy} className={cn(btnQuiet, '!min-h-9 !px-3 text-xs !text-emerald-700 !border-emerald-300')}>Mark won</button>}
            {deal && deal.status !== 'open' && <button onClick={() => patch({ status: 'open' }, 'Reopened')} disabled={busy} className={cn(btnQuiet, '!min-h-9 !px-3 text-xs')}>Reopen</button>}
          </div>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)] transition-colors">Cancel</button>
            <button onClick={save} disabled={busy || accounts.length === 0} className={btnPrimary}>{deal ? 'Save changes' : 'Add enquiry'}</button>
          </div>
        </div>
      </div>
    </ModalShell>

    {confirmingDelete && (
      <ConfirmModal
        title="Delete this enquiry?"
        message="Its follow-up history goes with it. This can't be undone."
        tone="danger"
        confirmLabel="Delete"
        busy={busy}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={remove}
      />
    )}
    {promptingLost && (
      <PromptModal
        title="Mark as lost"
        description="Why was it lost?"
        label="Reason"
        placeholder="Rate, lead time, quality, no reason given…"
        confirmLabel="Mark lost"
        onCancel={() => setPromptingLost(false)}
        onConfirm={(reason) => { setPromptingLost(false); patch({ status: 'lost', lost_reason: reason }, 'Marked lost'); }}
      />
    )}
    </>
  );
}

// ── Log follow-up modal ──────────────────────────────────────
function LogFollowUpModal({ deal, account, onClose, onSaved }: {
  deal: RegisterDeal; account?: RegisterAccount; onClose: () => void; onSaved: () => void;
}) {
  const titleId = useId();
  const [type, setType] = useState(ACTIVITY_TYPES[0]);
  const [note, setNote] = useState('');
  const [stage, setStage] = useState<RegisterStage>(deal.stage);
  const [nextAction, setNextAction] = useState(deal.next_action ?? '');
  const [nextDate, setNextDate] = useState(addDaysISO(3));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const res = await fetch('/api/register/activities', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_id: deal.account_id, deal_id: deal.id, type, note,
          stage, next_action: nextAction, next_action_date: nextDate || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) return toast.error(data.error ?? 'Failed to log follow-up');
      onSaved();
    } catch {
      toast.error('Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell titleId={titleId} onClose={onClose}>
      <div className="p-6">
        <h3 id={titleId} className="font-semibold text-[var(--glass-ink)] text-base mb-1">Log follow-up — {account?.name}</h3>
        <p className="text-xs text-[var(--glass-muted)] mb-4">{deal.title}</p>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={labelCls}>What happened</label>
              <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
                {ACTIVITY_TYPES.map((t) => <option key={t}>{t}</option>)}
              </select></div>
            <div><label className={labelCls}>Move stage to</label>
              <select value={stage} onChange={(e) => setStage(e.target.value as RegisterStage)} className={inputCls}>
                {STAGES.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
          </div>
          <div><label className={labelCls}>What was said</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} autoFocus
              placeholder="Spoke to purchase — artwork approved, PO expected next week" className={cn(inputCls, 'resize-none')} /></div>
          <div><label className={labelCls}>Next action</label>
            <input value={nextAction} onChange={(e) => setNextAction(e.target.value)} className={inputCls} /></div>
          <div>
            <label className={labelCls}>Next action date</label>
            <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className={inputCls} />
            <p className="text-xs text-[var(--glass-muted)] mt-1.5">Leave empty only if the job is finished — an open enquiry without a date is the one that gets forgotten.</p>
            <div className="flex gap-1.5 mt-1.5 flex-wrap">
              {[['Today', 0], ['Tomorrow', 1], ['+3 days', 3], ['+1 week', 7], ['+15 days', 15]].map(([label, n]) => (
                <button key={label} type="button" onClick={() => setNextDate(addDaysISO(n as number))}
                  className="text-xs px-2.5 py-1 rounded-lg border border-[var(--glass-border)] text-[var(--glass-muted)] hover:bg-black/[0.04] hover:text-[var(--glass-ink)] transition-colors">
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-3 justify-end mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)] transition-colors">Cancel</button>
          <button onClick={save} disabled={busy} className={btnPrimary}>Save follow-up</button>
        </div>
      </div>
    </ModalShell>
  );
}

// ── Account detail modal ─────────────────────────────────────
function AccountDetailModal({ account, deals, activities, onClose, onEditAccount, onNewDeal, onOpenDeal }: {
  account: RegisterAccount; deals: RegisterDeal[]; activities: RegisterActivity[];
  onClose: () => void; onEditAccount: () => void; onNewDeal: () => void; onOpenDeal: (d: RegisterDeal) => void;
}) {
  const titleId = useId();
  const sortedActs = [...activities].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <ModalShell titleId={titleId} onClose={onClose}>
      <div className="p-6 max-h-[80vh] overflow-y-auto">
        <h3 id={titleId} className="font-semibold text-[var(--glass-ink)] text-lg mb-3">{account.name}</h3>
        <dl className="text-sm space-y-1.5 mb-5">
          <div className="flex gap-2"><dt className="w-20 shrink-0 text-[11px] uppercase tracking-wide text-[var(--glass-muted)] pt-0.5">Contact</dt><dd>{account.contact_name || '—'}{account.contact_role ? ` · ${account.contact_role}` : ''}</dd></div>
          <div className="flex gap-2"><dt className="w-20 shrink-0 text-[11px] uppercase tracking-wide text-[var(--glass-muted)] pt-0.5">Phone</dt><dd>{account.phone || '—'}</dd></div>
          <div className="flex gap-2"><dt className="w-20 shrink-0 text-[11px] uppercase tracking-wide text-[var(--glass-muted)] pt-0.5">Email</dt><dd>{account.email || '—'}</dd></div>
          <div className="flex gap-2"><dt className="w-20 shrink-0 text-[11px] uppercase tracking-wide text-[var(--glass-muted)] pt-0.5">Segment</dt><dd>{account.segment || '—'}{account.city ? ` · ${account.city}` : ''}</dd></div>
          {account.notes && <div className="flex gap-2"><dt className="w-20 shrink-0 text-[11px] uppercase tracking-wide text-[var(--glass-muted)] pt-0.5">Notes</dt><dd>{account.notes}</dd></div>}
        </dl>

        <div className="mb-5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--glass-muted)] mb-2">Enquiries ({deals.length})</p>
          {deals.length === 0 ? <p className="text-xs text-[var(--glass-muted)]">No enquiries logged against this account.</p> : (
            <div className="space-y-1.5">
              {deals.map((d) => {
                const s = stageMeta(d.stage);
                return (
                  <button key={d.id} onClick={() => onOpenDeal(d)} className="w-full text-left flex items-center gap-2 rounded-lg border border-[var(--glass-border)] px-3 py-2 hover:border-emerald-300/70 transition-colors">
                    <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', s.dot)} aria-hidden="true" />
                    <span className="text-xs font-medium text-[var(--glass-ink)] flex-1 truncate">{d.title}</span>
                    <span className={cn(chip, d.status === 'won' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : d.status === 'lost' ? 'bg-slate-100 text-slate-700 border border-slate-200' : dueChipCls(d.next_action_date))}>
                      {d.status === 'open' ? dueLabel(d.next_action_date) : d.status.toUpperCase()}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--glass-muted)] mb-2">History ({sortedActs.length})</p>
          {sortedActs.length === 0 ? <p className="text-xs text-[var(--glass-muted)]">Never contacted.</p> : (
            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {sortedActs.slice(0, 20).map((x) => (
                <div key={x.id} className="flex gap-2 text-xs">
                  <span className="font-mono text-[var(--glass-muted)] w-12 shrink-0">{fmtShort(x.date)}</span>
                  <div className="min-w-0">
                    <span className={cn(chip, 'bg-slate-100 text-slate-600 border border-slate-200')}>{x.type}</span>{' '}
                    {x.note && <span className="text-[var(--glass-muted)]">{x.note}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end mt-5 pt-4 border-t border-[var(--glass-border)]">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)] transition-colors">Close</button>
          <button onClick={onEditAccount} className={btnQuiet}><Pencil className="w-4 h-4" aria-hidden="true" /> Edit account</button>
          <button onClick={onNewDeal} className={btnPrimary}><Plus className="w-4 h-4" aria-hidden="true" /> New enquiry</button>
        </div>
      </div>
    </ModalShell>
  );
}
