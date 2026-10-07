'use client';
// src/components/admin/OfflineBanner.tsx
// The strip under the header that appears when this device has no
// connection, or is holding stage changes made while it had none
// (lib/offlineQueue.ts). It sends them as soon as the browser reports it is
// back online, on load, and on Retry now — and says what happened to each.

import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { WifiOff } from 'lucide-react';
import { flushQueueOnce, readQueue, OFFLINE_QUEUE_EVENT, OFFLINE_QUEUE_KEY, type QueuedChange } from '@/lib/offlineQueue';
import { JOBS_CHANGED_EVENT } from '@/lib/constants/events';

export default function OfflineBanner() {
  const [online, setOnline]   = useState(true);
  const [queue, setQueue]     = useState<QueuedChange[]>([]);
  const [syncing, setSyncing] = useState(false);
  const busy = useRef(false);

  const sync = useCallback(async () => {
    if (busy.current || readQueue().length === 0) return;
    busy.current = true;
    setSyncing(true);
    try {
      // null: another open tab is already sending this queue.
      const r = await flushQueueOnce(fetch);
      if (!r) return;
      if (r.synced.length) {
        toast.success(`${r.synced.length} stage ${r.synced.length === 1 ? 'change' : 'changes'} synced`);
        window.dispatchEvent(new Event(JOBS_CHANGED_EVENT));
      }
      for (const f of r.failed) {
        toast.error(`${f.change.poNumber} → ${f.change.payload.new_status} didn’t sync: ${f.error}`, { duration: 8000 });
      }
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    const refresh = () => setQueue(readQueue());
    const onStorage = (e: StorageEvent) => { if (e.key === OFFLINE_QUEUE_KEY) refresh(); };
    const goOnline  = () => { setOnline(true); sync(); };
    const goOffline = () => setOnline(false);

    setOnline(navigator.onLine);
    refresh();
    if (navigator.onLine) sync();

    window.addEventListener(OFFLINE_QUEUE_EVENT, refresh);
    window.addEventListener('storage', onStorage);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener(OFFLINE_QUEUE_EVENT, refresh);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, [sync]);

  if (online && queue.length === 0) return null;

  const n = queue.length;
  return (
    <section aria-label="Connection" className="border-b border-[#FDE68A] bg-[#FFFBEB] text-brand-warning">
      <div role="status" className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 3xl:max-w-[1800px] 4xl:max-w-[2200px]">
        <WifiOff className="h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm">
          {online ? <strong>Back online.</strong> : <strong>No connection.</strong>}{' '}
          {n === 0
            ? 'Stage changes you make now are saved on this device and sync automatically.'
            : `${n} stage ${n === 1 ? 'change' : 'changes'} saved on this device — ${online ? (syncing ? 'syncing now.' : 'not sent yet.') : 'they’ll sync automatically.'}`}
        </p>
        {n > 0 && (
          <button
            type="button"
            onClick={sync}
            disabled={syncing || !online}
            className="min-h-9 rounded-[10px] border border-[#FCD34D] bg-white px-3.5 text-sm font-medium text-brand-ink disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Retry now'}
          </button>
        )}
      </div>
      {n > 0 && (
        <ul className="mx-auto flex max-w-screen-2xl flex-col gap-1.5 px-4 pb-3 3xl:max-w-[1800px] 4xl:max-w-[2200px]">
          {queue.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 text-sm text-brand-ink">
              <span><span className="font-mono font-semibold">{c.poNumber}</span> → {c.payload.new_status}</span>
              <span className="flex items-center gap-1.5 text-xs text-brand-warning">
                <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-[#D97706]" />
                Waiting to sync
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
