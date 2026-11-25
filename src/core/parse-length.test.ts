import { describe, expect, it } from 'vitest';
import { parseLength, parseLengthList } from './parse-length';
import { inchFraction, mm } from './units';

describe('parseLength', () => {
  it('reads bare numbers in the project units', () => {
    expect(parseLength('24', 'imperial')).toBe(inchFraction(24));
    expect(parseLength('24', 'metric')).toBe(mm(24));
    expect(parseLength('34.5', 'imperial')).toBe(inchFraction(34, 1, 2));
    expect(parseLength('.75', 'imperial')).toBe(inchFraction(0, 3, 4));
    expect(parseLength('18.5', 'metric')).toBe(mm(18.5));
  });

  it('reads fractions and mixed numbers exactly', () => {
    expect(parseLength('3/4', 'imperial')).toBe(inchFraction(0, 3, 4));
    expect(parseLength('34 1/2', 'imperial')).toBe(inchFraction(34, 1, 2));
    expect(parseLength('34-1/2', 'imperial')).toBe(inchFraction(34, 1, 2));
    expect(parseLength('23 15/16"', 'imperial')).toBe(inchFraction(23, 15, 16));
    expect(parseLength('1/64', 'imperial')).toBe(396_875);
  });

  it('reads feet and inches', () => {
    expect(parseLength("8'", 'imperial')).toBe(inchFraction(96));
    expect(parseLength('2\' 6 1/2"', 'imperial')).toBe(inchFraction(30, 1, 2));
    expect(parseLength("2'6", 'imperial')).toBe(inchFraction(30));
    expect(parseLength('2ft 6in', 'imperial')).toBe(inchFraction(30));
  });

  it('lets a unit on the value win over the project units', () => {
    expect(parseLength('18mm', 'imperial')).toBe(mm(18));
    expect(parseLength('87.6 cm', 'imperial')).toBe(mm(876));
    expect(parseLength('2.4m', 'imperial')).toBe(mm(2400));
    expect(parseLength('3/4"', 'metric')).toBe(inchFraction(0, 3, 4));
    expect(parseLength('1 in', 'metric')).toBe(inchFraction(1));
  });

  it('reads a sign', () => {
    expect(parseLength('-3/4', 'imperial')).toBe(-inchFraction(0, 3, 4));
    expect(parseLength('+12', 'imperial')).toBe(inchFraction(12));
  });

  it('refuses anything that is not a measurement', () => {
    for (const text of ['', '  ', 'abc', '1/0', '1//2', '12 13', '3 mm mm', '--4', '1.2.3']) {
      expect(parseLength(text, 'imperial'), text).toBeNull();
    }
  });
});

describe('parseLengthList', () => {
  it('splits on commas, semicolons, and x', () => {
    const expected = [inchFraction(24), inchFraction(34, 1, 2)];
    expect(parseLengthList('24, 34 1/2', 'imperial')).toEqual(expected);
    expect(parseLengthList('24;34 1/2', 'imperial')).toEqual(expected);
    expect(parseLengthList('24 x 34 1/2', 'imperial')).toEqual(expected);
  });

  it('treats an empty slot as "leave this one alone"', () => {
    expect(parseLengthList(', 12', 'imperial')).toEqual([null, inchFraction(12)]);
    expect(parseLengthList('12,', 'imperial')).toEqual([inchFraction(12), null]);
  });

  it('refuses a list with a bad entry or with nothing in it', () => {
    expect(parseLengthList('24, abc', 'imperial')).toBeNull();
    expect(parseLengthList(',', 'imperial')).toBeNull();
  });
});
