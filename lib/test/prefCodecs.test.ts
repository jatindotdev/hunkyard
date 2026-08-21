import { describe, expect, test } from 'bun:test';

import { boolPref, oneOf } from '@/components/usePersistedState';

describe('oneOf', () => {
  const decode = oneOf(['split', 'unified'] as const);

  test('accepts a value still in the union', () => {
    expect(decode('unified')).toBe('unified');
  });

  test('rejects a value dropped from a later build', () => {
    expect(decode('side-by-side')).toBeUndefined();
  });

  test('rejects a stored value of the wrong type', () => {
    for (const raw of [null, 0, true, {}, ['split']]) {
      expect(decode(raw)).toBeUndefined();
    }
  });
});

describe('boolPref', () => {
  test('accepts a boolean', () => {
    expect(boolPref(true)).toBe(true);
    expect(boolPref(false)).toBe(false);
  });

  test('rejects the truthy strings JSON round-trips can produce', () => {
    expect(boolPref('true')).toBeUndefined();
    expect(boolPref(1)).toBeUndefined();
    expect(boolPref(null)).toBeUndefined();
  });
});
