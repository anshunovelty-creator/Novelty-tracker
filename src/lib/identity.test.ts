import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { deptKeyOf, appMetaOf } from './identity';

describe('identity comes from app_metadata only', () => {
  it('reads the department from app_metadata', () => {
    expect(deptKeyOf({ app_metadata: { department: 'dispatch' } })).toBe('dispatch');
  });

  it('ignores a department the user wrote into user_metadata', () => {
    const forged = { app_metadata: { department: 'dispatch' }, user_metadata: { department: 'admin' } };
    expect(deptKeyOf(forged)).toBe('dispatch');
    expect(deptKeyOf({ app_metadata: {}, user_metadata: { department: 'admin' } } as never)).toBeUndefined();
  });

  it('has no department for an empty or missing account', () => {
    expect(deptKeyOf(null)).toBeUndefined();
    expect(deptKeyOf({ app_metadata: { department: '' } })).toBeUndefined();
    expect(appMetaOf(undefined)).toEqual({});
  });

  // The fix only holds while nothing goes back to trusting user_metadata.
  // Any code (not comments) that reads a department or username from it,
  // or writes one into it, fails here.
  it('nothing in src reads or writes department/username via user_metadata', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) { walk(p); continue; }
        if (!/\.(ts|tsx)$/.test(name) || /\.test\.tsx?$/.test(name)) continue;
        readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, '');
          if (/user_metadata/.test(code)) offenders.push(`${p}:${i + 1}: ${line.trim()}`);
        });
      }
    };
    walk(join(process.cwd(), 'src'));
    expect(offenders).toEqual([]);
  });
});
