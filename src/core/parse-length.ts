import { NM_PER_INCH, NM_PER_MM, type Length, type UnitSystem } from './units';

/**
 * Reads a typed measurement into an exact length.
 *
 * Accepted forms, with or without a unit:
 *   34 1/2   34-1/2   1/2   34.5   34 1/2"   34.5in
 *   2' 6 1/2"   2ft 6   8'
 *   876mm   87.6cm   2.4m
 *
 * A bare number is read in the project's own units: inches for imperial,
 * millimeters for metric. A unit on the value always wins, so metric can be
 * typed into an imperial project and the other way around.
 */

const NM_PER: Record<string, number> = {
  mm: NM_PER_MM,
  cm: NM_PER_MM * 10,
  m: NM_PER_MM * 1000,
  in: NM_PER_INCH,
  ft: NM_PER_INCH * 12,
};

const UNIT_ALIASES: Record<string, keyof typeof NM_PER> = {
  mm: 'mm',
  cm: 'cm',
  m: 'm',
  '"': 'in',
  '”': 'in',
  "''": 'in',
  in: 'in',
  inch: 'in',
  inches: 'in',
  "'": 'ft',
  '’': 'ft',
  ft: 'ft',
  foot: 'ft',
  feet: 'ft',
};

const UNIT_PATTERN = `(mm|cm|m|inches|inch|in|feet|foot|ft|''|["'”’])`;
const DECIMAL = String.raw`(?:\d+\.?\d*|\.\d+)`;
const MIXED = String.raw`(?:(\d+)[\s-]+)?(\d+)\s*/\s*(\d+)`;

const MIXED_RE = new RegExp(`^${MIXED}\\s*${UNIT_PATTERN}?$`);
const DECIMAL_RE = new RegExp(`^(${DECIMAL})\\s*${UNIT_PATTERN}?$`);
const FEET_RE = new RegExp(`^(${DECIMAL})\\s*(?:feet|foot|ft|['’])\\s*(.+)$`);

/** Scales a decimal string by a whole factor without going through a rounded float first. */
function scaleDecimal(text: string, factor: number): number {
  const [whole = '', fraction = ''] = text.split('.');
  const digits = Number(`${whole}${fraction}` || '0');
  return (digits * factor) / 10 ** fraction.length;
}

function parseUnsigned(text: string, defaultUnit: keyof typeof NM_PER): number | null {
  const feet = FEET_RE.exec(text);
  if (feet) {
    // Whatever follows a feet value is inches unless it says otherwise.
    const rest = parseUnsigned(feet[2]!.trim(), 'in');
    if (rest !== null) return scaleDecimal(feet[1]!, NM_PER.ft!) + rest;
  }

  const mixed = MIXED_RE.exec(text);
  if (mixed) {
    const [, whole, numerator, denominator, unit] = mixed;
    const den = Number(denominator);
    if (den === 0) return null;
    const perUnit = NM_PER[unit ? UNIT_ALIASES[unit]! : defaultUnit]!;
    return ((Number(whole ?? 0) * den + Number(numerator)) * perUnit) / den;
  }

  const decimal = DECIMAL_RE.exec(text);
  if (decimal) {
    const [, value, unit] = decimal;
    return scaleDecimal(value!, NM_PER[unit ? UNIT_ALIASES[unit]! : defaultUnit]!);
  }
  return null;
}

/** Returns the length in document units, or null when the text is not a measurement. */
export function parseLength(input: string, system: UnitSystem): Length | null {
  let text = input.trim().toLowerCase();
  if (text === '') return null;
  let sign = 1;
  if (text.startsWith('-')) {
    sign = -1;
    text = text.slice(1).trim();
  } else if (text.startsWith('+')) {
    text = text.slice(1).trim();
  }
  const value = parseUnsigned(text, system === 'imperial' ? 'in' : 'mm');
  if (value === null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value) * sign;
  return Number.isSafeInteger(rounded) ? rounded : null;
}

/**
 * Reads several measurements separated by commas, semicolons, or "x", such as
 * "24, 34 1/2". An empty slot, as in ", 12", comes back as null and means
 * "leave this one as it is". Returns null when any filled slot is not a
 * measurement.
 */
export function parseLengthList(input: string, system: UnitSystem): (Length | null)[] | null {
  const parts = input.split(/[,;]|\s+x\s+/i);
  const lengths: (Length | null)[] = [];
  for (const part of parts) {
    if (part.trim() === '') {
      lengths.push(null);
      continue;
    }
    const length = parseLength(part, system);
    if (length === null) return null;
    lengths.push(length);
  }
  return lengths.some((length) => length !== null) ? lengths : null;
}
