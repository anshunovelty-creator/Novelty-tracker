import { describe, it, expect } from 'vitest';
import { claimAlert } from './notify';

function memoryStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}

describe('claimAlert — one tab alerts per note/message', () => {
  it('the first tab to see an id alerts, the next one stays quiet', () => {
    const shared = memoryStore();
    expect(claimAlert('msg-1', shared)).toBe(true);
    expect(claimAlert('msg-1', shared)).toBe(false);
  });

  it('a new id alerts again', () => {
    const shared = memoryStore();
    claimAlert('msg-1', shared);
    expect(claimAlert('msg-2', shared)).toBe(true);
  });

  it('still alerts when storage is unavailable or throws', () => {
    expect(claimAlert('msg-1', null)).toBe(true);
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => {} };
    expect(claimAlert('msg-1', broken)).toBe(true);
  });
});
