// src/lib/basicCalculator.test.ts
// The Basic calculator, driven key by key the way the panel drives it —
// checked against what the Windows Standard calculator shows for the same
// presses.

import { describe, expect, it } from 'vitest';
import {
  calcReducer, formatEntry, INITIAL_CALC, isBlank, MAX_HISTORY, parsePasted, toEntry,
  type CalcKey, type CalcState,
} from './basicCalculator';

/** Presses keys in order. A string is split into single keys (with * / -
 *  standing in for × ÷ −); named keys (CE, back, sqrt, …) go in an array. */
function press(keys: string | string[], from: CalcState = INITIAL_CALC): CalcState {
  const list = typeof keys === 'string'
    ? keys.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−').split('')
    : keys;
  return list.reduce<CalcState>((s, key) => calcReducer(s, { type: 'key', key: key as CalcKey }), from);
}

const shown = (s: CalcState) => s.error ?? formatEntry(s.entry);

describe('number display', () => {
  it('groups the Indian way and keeps what is being typed', () => {
    expect(formatEntry('1234567')).toBe('12,34,567');
    expect(formatEntry('-100000.50')).toBe('-1,00,000.50');
    expect(formatEntry('12.')).toBe('12.');
    expect(formatEntry('999')).toBe('999');
  });

  it('trims float noise from results', () => {
    expect(toEntry(0.1 + 0.2)).toBe('0.3');
    expect(toEntry(1.1 * 3)).toBe('3.3');
    expect(toEntry(-0)).toBe('0');
  });

  it('switches to e-notation for very large and very small numbers', () => {
    expect(toEntry(1e21)).toBe('1e+21');
    expect(toEntry(1.5e-9)).toBe('1.5e-9');
  });
});

describe('typing', () => {
  it('builds a number without leading zeros and with one decimal point', () => {
    expect(shown(press('007'))).toBe('7');
    expect(shown(press('1.2.3'))).toBe('1.23');
    expect(shown(press('.5'))).toBe('0.5');
  });

  it('stops at 16 digits', () => {
    expect(press('12345678901234567').entry).toBe('1234567890123456');
  });

  it('backspace removes the last digit and bottoms out at 0', () => {
    expect(shown(press(['1', '2', '3', 'back']))).toBe('12');
    expect(shown(press(['5', 'back', 'back']))).toBe('0');
    expect(shown(press(['5', 'neg', 'back']))).toBe('0');
  });

  it('± flips the sign of a number still being typed', () => {
    expect(shown(press(['1', '2', 'neg']))).toBe('-12');
    expect(shown(press(['1', '2', 'neg', '3']))).toBe('-123');
  });
});

describe('arithmetic', () => {
  it('does the four operations', () => {
    expect(shown(press('12+30='))).toBe('42');
    expect(shown(press('12-30='))).toBe('-18');
    expect(shown(press('12*30='))).toBe('360');
    expect(shown(press('12/30='))).toBe('0.4');
  });

  it('chains left to right, like the Windows Standard mode', () => {
    expect(shown(press('5+3*2='))).toBe('16');
    const mid = press('5+3*');
    expect(shown(mid)).toBe('8');
    expect(mid.expr).toBe('8 × ');
  });

  it('a second operator replaces the first', () => {
    const s = press('5+*');
    expect(s.expr).toBe('5 × ');
    expect(shown(press('2=', s))).toBe('10');
  });

  it('gets 0.1 + 0.2 right', () => {
    expect(shown(press('.1+.2='))).toBe('0.3');
  });

  it('repeats the last operation on further =', () => {
    const s = press('2+3===');
    expect(shown(s)).toBe('11');
    expect(s.expr).toBe('8 + 3 =');
  });

  it('"5 + =" uses the 5 again', () => {
    expect(shown(press('5+='))).toBe('10');
  });

  it('a digit after = starts a new sum; an operator carries the answer on', () => {
    const fresh = press('2+3=7');
    expect(shown(fresh)).toBe('7');
    expect(fresh.expr).toBe('');
    expect(shown(press('2+3=*4='))).toBe('20');
  });

  it('shows the expression line', () => {
    expect(press('12+').expr).toBe('12 + ');
    expect(press('12+3=').expr).toBe('12 + 3 =');
    expect(press('125000+').expr).toBe('1,25,000 + ');
  });
});

describe('percent', () => {
  it('is a percent of the running total after + and −', () => {
    expect(shown(press('200+10%='))).toBe('220');
    expect(shown(press('200-10%='))).toBe('180');
  });

  it('is a plain fraction after × and ÷, or alone', () => {
    expect(shown(press('200*10%='))).toBe('20');
    expect(shown(press('50%'))).toBe('0.5');
  });

  it('shows the worked-out percent in the line', () => {
    expect(press('200+10%=').expr).toBe('200 + 20 =');
  });
});

describe('unary keys', () => {
  it('square, square root and reciprocal', () => {
    expect(shown(press(['9', 'sqrt']))).toBe('3');
    expect(shown(press(['1', '2', 'sqr']))).toBe('144');
    expect(shown(press(['4', 'inv']))).toBe('0.25');
  });

  it('wrap the entry in the line, and nest', () => {
    const s = press(['8', '1', 'sqrt', 'sqrt']);
    expect(shown(s)).toBe('3');
    expect(press(['+', '1', '='], s).expr).toBe('√(√(81)) + 1 =');
  });

  it('work as the right-hand operand', () => {
    const s = press(['1', '0', '+', '9', 'sqrt', '=']);
    expect(shown(s)).toBe('13');
    expect(s.expr).toBe('10 + √(9) =');
  });

  it('± after an answer negates it as a new start', () => {
    const s = press(['2', '+', '3', '=', 'neg']);
    expect(shown(s)).toBe('-5');
    expect(s.expr).toBe('');
  });

  it('a digit after a unary result replaces it', () => {
    expect(shown(press(['9', 'sqrt', '4']))).toBe('4');
  });
});

describe('errors', () => {
  it('divide by zero, 0 ÷ 0, root of a negative and 1/0', () => {
    expect(shown(press('5/0='))).toBe('Cannot divide by zero');
    expect(shown(press('0/0='))).toBe('Result is undefined');
    expect(shown(press(['4', 'neg', 'sqrt']))).toBe('Invalid input');
    expect(shown(press(['0', 'inv']))).toBe('Cannot divide by zero');
  });

  it('ignores operators until cleared, and a digit starts over', () => {
    const err = press('5/0=');
    expect(press('+', err).error).toBe('Cannot divide by zero');
    expect(shown(press('7', err))).toBe('7');
    expect(isBlank(press(['CE'], err))).toBe(true);
  });

  it('overflows instead of showing Infinity', () => {
    const big = calcReducer(INITIAL_CALC, { type: 'paste', text: '1e300' });
    expect(shown(press(['×', '='], press(['×', '='], big)))).toBe('Overflow');
  });
});

describe('clearing', () => {
  it('CE clears the entry and keeps the pending sum', () => {
    expect(shown(press(['5', '+', '3', 'CE', '4', '=']))).toBe('9');
  });

  it('C clears everything but the history', () => {
    const s = press(['2', '+', '2', '=', '5', '+', 'C']);
    expect(isBlank(s)).toBe(true);
    expect(s.history).toHaveLength(1);
  });

  it('backspace after = drops the line but keeps the answer', () => {
    const s = press(['2', '+', '2', '=', 'back']);
    expect(shown(s)).toBe('4');
    expect(s.expr).toBe('');
  });
});

describe('history', () => {
  it('records each finished sum, newest first', () => {
    const s = press('2+2=10*3=');
    expect(s.history).toEqual([
      { expr: '10 × 3 =', result: '30' },
      { expr: '2 + 2 =', result: '4' },
    ]);
  });

  it('records a lone wrapped number, not a lone plain one', () => {
    expect(press(['9', 'sqrt', '=']).history).toEqual([{ expr: '√(9) =', result: '3' }]);
    expect(press('9=').history).toEqual([]);
  });

  it('does not record a sum that errored', () => {
    expect(press('5/0=').history).toEqual([]);
  });

  it(`keeps at most ${MAX_HISTORY}`, () => {
    let s = INITIAL_CALC;
    for (let i = 0; i < MAX_HISTORY + 5; i++) s = press('1+1=', s);
    expect(s.history).toHaveLength(MAX_HISTORY);
  });

  it('can be cleared', () => {
    expect(calcReducer(press('1+1='), { type: 'clearHistory' }).history).toEqual([]);
  });
});

describe('paste', () => {
  it('reads grouped, ₹ and spaced numbers', () => {
    expect(parsePasted('1,00,000')).toBe(100000);
    expect(parsePasted('₹4,650.01')).toBe(4650.01);
    expect(parsePasted(' -12.5 ')).toBe(-12.5);
    expect(parsePasted('12abc')).toBeNull();
    expect(parsePasted('')).toBeNull();
  });

  it('puts the number in as an operand that can be typed onto', () => {
    const s = calcReducer(press('10+'), { type: 'paste', text: '1,250' });
    expect(shown(s)).toBe('1,250');
    expect(shown(press('0=', s))).toBe('12,510');
  });

  it('ignores text that is not a number', () => {
    const s = press('42');
    expect(calcReducer(s, { type: 'paste', text: 'hello' })).toBe(s);
  });
});
