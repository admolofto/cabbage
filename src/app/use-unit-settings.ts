import { useCallback, useState } from 'react';
import {
  DEFAULT_UNIT_SETTINGS,
  IMPERIAL_PRECISIONS,
  METRIC_PRECISIONS,
  type UnitSettings,
} from '../core/units';

const STORAGE_KEY = 'cabbage.units';

/** Accepts only a well-formed saved value. Anything else falls back to the defaults. */
export function parseUnitSettings(raw: string | null): UnitSettings {
  if (!raw) return DEFAULT_UNIT_SETTINGS;
  try {
    const saved = JSON.parse(raw) as Partial<UnitSettings> | null;
    if (!saved || typeof saved !== 'object') return DEFAULT_UNIT_SETTINGS;
    return {
      system:
        saved.system === 'imperial' || saved.system === 'metric'
          ? saved.system
          : DEFAULT_UNIT_SETTINGS.system,
      imperialPrecision:
        IMPERIAL_PRECISIONS.find((precision) => precision === saved.imperialPrecision) ??
        DEFAULT_UNIT_SETTINGS.imperialPrecision,
      metricPrecision:
        METRIC_PRECISIONS.find((precision) => precision === saved.metricPrecision) ??
        DEFAULT_UNIT_SETTINGS.metricPrecision,
    };
  } catch {
    return DEFAULT_UNIT_SETTINGS;
  }
}

function load(): UnitSettings {
  try {
    return parseUnitSettings(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_UNIT_SETTINGS;
  }
}

/** The display units, remembered on this device between visits. */
export function useUnitSettings(): [UnitSettings, (change: Partial<UnitSettings>) => void] {
  const [settings, setSettings] = useState(load);

  const update = useCallback((change: Partial<UnitSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...change };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Private windows can refuse storage. The setting still applies for this visit.
      }
      return next;
    });
  }, []);

  return [settings, update];
}
