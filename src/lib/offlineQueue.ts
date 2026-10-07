// src/lib/offlineQueue.ts
// ============================================================
// Stage changes made with no connection. The floor loses wifi in the press
// hall; a change pressed then is kept on this device and sent when the
// connection comes back, instead of being lost to a "Network error" toast.
//
// Kept in localStorage (per device, survives a reload). Replayed in the
// order they were made, through the same /status route as always — so every
// server rule still applies. A change the server refuses on replay is dropped
// and reported, never retried forever; a network failure stops the replay
// and keeps the rest for next time.
//
// Never twice: each change carries the Idempotency-Key it was first sent
// with, so if that first send did reach the server (only the answer was
// lost) the replay is recognised and not applied again. Only one tab replays
// at a time, and a change leaves the queue only once it has an answer.
// ============================================================

export const OFFLINE_QUEUE_KEY   = 'tracker:offline-stage-changes';
/** Fired on window whenever the queue changes, so the banner can re-read it. */
export const OFFLINE_QUEUE_EVENT = 'tracker:offline-queue';

export type QueuedChange = {
  id:        string;
  jobId:     string;
  poNumber:  string;
  /** The /status request body, exactly as it would have been sent. */
  payload:   { new_status: string } & Record<string, unknown>;
  /** The Idempotency-Key the first send used. Absent on changes queued before keys existed. */
  requestId?: string;
  queuedAt:  string;
};

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function store(s?: Store): Store | null {
  if (s) return s;
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

export function readQueue(s?: Store): QueuedChange[] {
  try {
    const raw = store(s)?.getItem(OFFLINE_QUEUE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((c) => c && typeof c.jobId === 'string' && c.payload?.new_status) : [];
  } catch {
    return [];
  }
}

export function writeQueue(list: QueuedChange[], s?: Store): void {
  try { store(s)?.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(list)); } catch { /* storage full or blocked */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OFFLINE_QUEUE_EVENT));
}

export function enqueue(change: Omit<QueuedChange, 'id' | 'queuedAt'>, s?: Store, now = new Date()): QueuedChange {
  const item: QueuedChange = {
    ...change,
    id:       `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    queuedAt: now.toISOString(),
  };
  writeQueue([...readQueue(s), item], s);
  return item;
}

/** A fresh Idempotency-Key: made once per change, before its first send. */
export function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Older browsers / non-secure origins: a v4 UUID from getRandomValues.
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The headers for a /status POST, with the change's Idempotency-Key when it has one. */
export function statusHeaders(requestId?: string): Record<string, string> {
  return requestId
    ? { 'Content-Type': 'application/json', 'Idempotency-Key': requestId }
    : { 'Content-Type': 'application/json' };
}

/** fetch() rejects (rather than resolving with a status) only when the request never got an answer. */
export function isNetworkFailure(err: unknown): boolean {
  return err instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

export type FlushResult = {
  synced: QueuedChange[];
  failed: { change: QueuedChange; error: string }[];
  /** True when the connection dropped again partway; what's left stays queued. */
  stopped: boolean;
};

/**
 * Send every queued change in order, oldest first, until the queue is empty
 * or the connection drops. Each change is removed from storage on its own
 * once it has an answer (synced or refused), re-reading storage each time —
 * so a change queued while this runs is kept, and sent in the same pass.
 */
export async function flushQueue(fetchImpl: typeof fetch, s?: Store): Promise<FlushResult> {
  const result: FlushResult = { synced: [], failed: [], stopped: false };
  const tried = new Set<string>();
  for (;;) {
    const change = readQueue(s).find((c) => !tried.has(c.id));
    if (!change) break;
    tried.add(change.id);
    try {
      const res  = await fetchImpl(`/api/jobs/${change.jobId}/status`, {
        method:  'POST',
        headers: statusHeaders(change.requestId),
        body:    JSON.stringify(change.payload),
      });
      if (res.ok) {
        result.synced.push(change);
      } else {
        const body = await res.json().catch(() => ({}));
        result.failed.push({ change, error: typeof body.error === 'string' ? body.error : `refused (${res.status})` });
      }
    } catch {
      result.stopped = true;
      break;
    }
    writeQueue(readQueue(s).filter((c) => c.id !== change.id), s);
  }
  return result;
}

type Locks = { request: (name: string, opts: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<unknown>) => Promise<unknown> };

/**
 * flushQueue, but only in one tab at a time: every open tab has the banner,
 * and each would otherwise replay the same queue when the connection comes
 * back. Returns null when another tab is already sending — it will report.
 * Browsers without the Web Locks API fall back to a plain flush (the
 * Idempotency-Key still stops a double apply).
 */
export async function flushQueueOnce(
  fetchImpl: typeof fetch,
  locks: Locks | undefined = typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: Locks }).locks : undefined,
  s?: Store,
): Promise<FlushResult | null> {
  if (!locks) return flushQueue(fetchImpl, s);
  let out: FlushResult | null = null;
  await locks.request('tracker:offline-flush', { ifAvailable: true }, async (lock) => {
    if (lock) out = await flushQueue(fetchImpl, s);
  });
  return out;
}
