import { describe, it, expect } from 'vitest';
import { allPages } from './allPages';

// A table of n rows behind a PostgREST-like range(): never more than 1000 per answer.
const table = (n: number) => {
  const calls: [number, number][] = [];
  const page = (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to + 1, n, from + 1000);
    return Promise.resolve({ data: Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i), error: null });
  };
  return { page, calls };
};

describe('allPages', () => {
  it('reads past the 1000-row cap', async () => {
    const t = table(2500);
    const rows = await allPages(t.page);
    expect(rows).toHaveLength(2500);
    expect(rows[2499]).toBe(2499);
    expect(t.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it('stops after one request when everything fits', async () => {
    const t = table(42);
    expect(await allPages(t.page)).toHaveLength(42);
    expect(t.calls).toHaveLength(1);
  });

  it('asks once more after an exactly-full page, then stops', async () => {
    const t = table(1000);
    expect(await allPages(t.page)).toHaveLength(1000);
    expect(t.calls).toHaveLength(2);
  });

  it('fails loudly instead of returning a short list', async () => {
    let n = 0;
    const page = () => Promise.resolve(n++ === 0
      ? { data: Array.from({ length: 1000 }, (_, i) => i), error: null }
      : { data: null, error: { message: 'timeout' } });
    await expect(allPages(page)).rejects.toThrow('timeout');
  });
});
