import { describe, expect, it } from 'vitest';
import { DEFAULT_UNIT_SETTINGS } from '../core/units';
import { parseUnitSettings } from './use-unit-settings';

describe('saved unit settings', () => {
  it('falls back to the defaults when nothing is saved', () => {
    expect(parseUnitSettings(null)).toEqual(DEFAULT_UNIT_SETTINGS);
  });

  it('reads a saved value', () => {
    const saved = JSON.stringify({ system: 'metric', imperialPrecision: 64, metricPrecision: 0.1 });
    expect(parseUnitSettings(saved)).toEqual({
      system: 'metric',
      imperialPrecision: 64,
      metricPrecision: 0.1,
    });
  });

  it('ignores damaged or unknown values one field at a time', () => {
    expect(parseUnitSettings('not json')).toEqual(DEFAULT_UNIT_SETTINGS);
    expect(parseUnitSettings('null')).toEqual(DEFAULT_UNIT_SETTINGS);
    const partial = JSON.stringify({ system: 'furlongs', imperialPrecision: 7, metricPrecision: 1 });
    expect(parseUnitSettings(partial)).toEqual({ ...DEFAULT_UNIT_SETTINGS, metricPrecision: 1 });
  });
});
