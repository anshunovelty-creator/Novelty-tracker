import { describe, it, expect } from 'vitest';
import { enqueue, readQueue, flushQueue, flushQueueOnce, newRequestId, OFFLINE_QUEUE_KEY } from './offlineQueue';
import { joinOr, notYourStageTitle } from './stageBlocked';

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
};

const ok  = () => new Response('{"job":{}}', { status: 200 });
const no  = (error: string) => new Response(JSON.stringify({ error }), { status: 403 });

describe('offline queue', () => {
  it('keeps changes in the order they were made', () => {
    const s = mem();
    enqueue({ jobId: 'a', poNumber: 'OCT26-14', payload: { new_status: 'Packing' } }, s);
    enqueue({ jobId: 'b', poNumber: 'OCT26-11', payload: { new_status: 'Quality Check', remark: 'ok' } }, s);
    expect(readQueue(s).map((c) => c.poNumber)).toEqual(['OCT26-14', 'OCT26-11']);
  });

  it('ignores junk in storage', () => {
    const s = mem();
    s.setItem(OFFLINE_QUEUE_KEY, '{not json');
    expect(readQueue(s)).toEqual([]);
    s.setItem(OFFLINE_QUEUE_KEY, JSON.stringify([{ jobId: 1 }, null]));
    expect(readQueue(s)).toEqual([]);
  });

  it('sends everything and empties the queue', async () => {
    const s = mem();
    enqueue({ jobId: 'a', poNumber: 'A', payload: { new_status: 'Packing' } }, s);
    enqueue({ jobId: 'b', poNumber: 'B', payload: { new_status: 'Slitting' } }, s);
    const sent: string[] = [];
    const r = await flushQueue((async (url: string) => { sent.push(url); return ok(); }) as unknown as typeof fetch, s);
    expect(sent).toEqual(['/api/jobs/a/status', '/api/jobs/b/status']);
    expect(r.synced).toHaveLength(2);
    expect(readQueue(s)).toEqual([]);
  });

  it('drops and reports a change the server refuses', async () => {
    const s = mem();
    enqueue({ jobId: 'a', poNumber: 'A', payload: { new_status: 'Packing' } }, s);
    const r = await flushQueue((async () => no('Only Dispatch can move a job to Packing')) as unknown as typeof fetch, s);
    expect(r.failed[0].error).toBe('Only Dispatch can move a job to Packing');
    expect(readQueue(s)).toEqual([]);
  });

  it('stops at a network failure and keeps the rest', async () => {
    const s = mem();
    enqueue({ jobId: 'a', poNumber: 'A', payload: { new_status: 'Packing' } }, s);
    enqueue({ jobId: 'b', poNumber: 'B', payload: { new_status: 'Slitting' } }, s);
    let n = 0;
    const r = await flushQueue((async () => { if (n++ === 0) return ok(); throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch, s);
    expect(r.stopped).toBe(true);
    expect(readQueue(s).map((c) => c.poNumber)).toEqual(['B']);
  });
});

describe('offline queue never applies a change twice', () => {
  it('replays with the Idempotency-Key of the first send', async () => {
    const s = mem();
    const key = newRequestId();
    enqueue({ jobId: 'a', poNumber: 'A', payload: { new_status: 'Partial Dispatch', qty_dispatched: 500 }, requestId: key }, s);
    enqueue({ jobId: 'b', poNumber: 'B', payload: { new_status: 'Packing' } }, s); // queued before keys existed
    const headers: (string | null)[] = [];
    await flushQueue((async (_u: string, init: RequestInit) => {
      headers.push(new Headers(init.headers).get('Idempotency-Key'));
      return ok();
    }) as unknown as typeof fetch, s);
    expect(headers).toEqual([key, null]);
  });

  it('makes v4 UUIDs the server accepts', () => {
    const a = newRequestId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(newRequestId()).not.toBe(a);
  });

  it('keeps — and sends — a change queued while a replay is running', async () => {
    const s = mem();
    enqueue({ jobId: 'a', poNumber: 'A', payload: { new_status: 'Packing' } }, s);
    const sent: string[] = [];
    const r = await flushQueue((async (url: string) => {
      sent.push(url);
      // The connection blips mid-replay and another stage change is queued.
      if (sent.length === 1) enqueue({ jobId: 'c', poNumber: 'C', payload: { new_status: 'Slitting' } }, s);
      return ok();
    }) as unknown as typeof fetch, s);
    expect(sent).toEqual(['/api/jobs/a/status', '/api/jobs/c/status']);
    expect(r.synced.map((c) => c.poNumber)).toEqual(['A', 'C']);
    expect(readQueue(s)).toEqual([]);
  });

  it('keeps a change queued during a replay that then loses the connection', async () => {
    const s = mem();
    enqueue({ jobId: 'a', poNumber: 'A', payload: { new_status: 'Packing' } }, s);
    enqueue({ jobId: 'b', poNumber: 'B', payload: { new_status: 'Slitting' } }, s);
    let n = 0;
    await flushQueue((async () => {
      if (n++ === 0) { enqueue({ jobId: 'c', poNumber: 'C', payload: { new_status: 'Dispatched' } }, s); return ok(); }
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch, s);
    expect(readQueue(s).map((c) => c.poNumber)).toEqual(['B', 'C']);
  });

  it('lets only one tab replay at a time', async () => {
    const s = mem();
    enqueue({ jobId: 'a', poNumber: 'A', payload: { new_status: 'Packing' } }, s);
    let held = false;
    const locks = {
      request: async (_n: string, _o: { ifAvailable: boolean }, cb: (lock: unknown) => Promise<unknown>) => {
        if (held) return cb(null);
        held = true;
        try { return await cb({}); } finally { held = false; }
      },
    };
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const slow = (async () => { calls++; await gate; return ok(); }) as unknown as typeof fetch;

    const first  = flushQueueOnce(slow, locks, s);
    const second = await flushQueueOnce(slow, locks, s); // another tab, same moment
    expect(second).toBeNull();
    release();
    expect((await first)?.synced).toHaveLength(1);
    expect(calls).toBe(1);
  });

  it('still replays where the browser has no Web Locks', async () => {
    const s = mem();
    enqueue({ jobId: 'a', poNumber: 'A', payload: { new_status: 'Packing' } }, s);
    const r = await flushQueueOnce((async () => ok()) as unknown as typeof fetch, undefined, s);
    expect(r?.synced).toHaveLength(1);
  });
});

describe('not your stage wording', () => {
  it('joins owners naturally', () => {
    expect(joinOr(['Dispatch'])).toBe('Dispatch');
    expect(joinOr(['Dispatch', 'QC'])).toBe('Dispatch or QC');
    expect(joinOr(['Dispatch', 'QC', 'Dispatch', 'Prepress'])).toBe('Dispatch, QC or Prepress');
  });
  it('names Admin when no floor department holds the stage', () => {
    expect(notYourStageTitle([], 'PO Closed')).toBe('Only Admin can move a job to PO Closed');
    expect(notYourStageTitle(['Dispatch'], 'Packing')).toBe('Only Dispatch can move a job to Packing');
  });
});
