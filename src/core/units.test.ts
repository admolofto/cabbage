import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UNIT_SETTINGS,
  NM_PER_INCH,
  formatLength,
  formatLengthParts,
  inchFraction,
  inches,
  mm,
  toInches,
  toMm,
  type UnitSettings,
} from './units';

const imperial = (imperialPrecision: UnitSettings['imperialPrecision'] = 16): UnitSettings => ({
  ...DEFAULT_UNIT_SETTINGS,
  system: 'imperial',
  imperialPrecision,
});

const metric = (metricPrecision: UnitSettings['metricPrecision'] = 0.5): UnitSettings => ({
  ...DEFAULT_UNIT_SETTINGS,
  system: 'metric',
  metricPrecision,
});

describe('exact lengths', () => {
  it('stores every sixty-fourth of an inch as a whole number', () => {
    for (let n = 0; n <= 64; n++) {
      expect(Number.isInteger(inchFraction(0, n, 64))).toBe(true);
    }
    expect(inchFraction(0, 1, 64) * 64).toBe(NM_PER_INCH);
  });

  it('stores tenths of a millimeter as whole numbers', () => {
    expect(mm(0.1)).toBe(100_000);
    expect(mm(18)).toBe(18_000_000);
  });

  it('adds fractions without drift', () => {
    let total = 0;
    for (let i = 0; i < 64; i++) total += inchFraction(0, 1, 64);
    expect(total).toBe(inches(1));
    expect(inchFraction(34, 1, 2) - 2 * inchFraction(0, 3, 4)).toBe(inches(33));
  });

  it('converts back to plain numbers', () => {
    expect(toInches(inchFraction(34, 1, 2))).toBe(34.5);
    expect(toMm(inches(1))).toBe(25.4);
  });
});

describe('fractional inch display', () => {
  it('reduces fractions', () => {
    expect(formatLength(inchFraction(34, 1, 2), imperial())).toBe('34 1/2"');
    expect(formatLength(inchFraction(0, 3, 4), imperial())).toBe('3/4"');
    expect(formatLength(inchFraction(23, 11, 16), imperial())).toBe('23 11/16"');
    expect(formatLength(inchFraction(1, 5, 64), imperial(64))).toBe('1 5/64"');
  });

  it('shows whole inches and zero plainly', () => {
    expect(formatLength(inches(30), imperial())).toBe('30"');
    expect(formatLength(0, imperial())).toBe('0"');
  });

  it('handles negative lengths', () => {
    expect(formatLength(-inchFraction(1, 1, 8), imperial())).toBe('-1 1/8"');
    expect(formatLength(-inchFraction(0, 1, 4), imperial())).toBe('-1/4"');
  });

  it('marks a value that had to be rounded', () => {
    const odd = inchFraction(12, 1, 64);
    expect(formatLength(odd, imperial(64))).toBe('12 1/64"');
    expect(formatLength(odd, imperial(16))).toBe('~12"');
    expect(formatLengthParts(odd, imperial(16))).toEqual({ text: '12"', exact: false });
  });

  it('carries into the next inch when rounding up', () => {
    expect(formatLength(inchFraction(11, 63, 64), imperial(8))).toBe('~12"');
  });

  it('shows metric lengths as approximate inches', () => {
    expect(formatLength(mm(18), imperial(16))).toBe('~11/16"');
  });
});

describe('metric display', () => {
  it('shows whole and half millimeters', () => {
    expect(formatLength(mm(876), metric())).toBe('876 mm');
    expect(formatLength(mm(12.5), metric())).toBe('12.5 mm');
    expect(formatLength(mm(0.3), metric(0.1))).toBe('0.3 mm');
    expect(formatLength(0, metric())).toBe('0 mm');
  });

  it('handles negative lengths', () => {
    expect(formatLength(-mm(4.5), metric())).toBe('-4.5 mm');
  });

  it('marks a value that had to be rounded', () => {
    expect(formatLength(mm(12.3), metric(1))).toBe('~12 mm');
    expect(formatLength(inchFraction(0, 3, 4), metric(0.1))).toBe('~19.1 mm');
    expect(formatLength(inchFraction(0, 3, 4), metric(0.5))).toBe('~19 mm');
  });

  it('shows one inch exactly at tenth precision', () => {
    expect(formatLength(inches(1), metric(0.1))).toBe('25.4 mm');
  });
});
