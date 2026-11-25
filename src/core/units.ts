/**
 * Exact lengths.
 *
 * Every length in a Cabbage document is a whole number of nanometers. One
 * sixty-fourth of an inch is 396,875 nm and a tenth of a millimeter is
 * 100,000 nm, so fractional inches and metric values are both stored exactly
 * and can be mixed in one project without drift.
 */
export type Length = number;

export const NM_PER_MM = 1_000_000;
export const NM_PER_INCH = 25_400_000;

/** The finest inch fraction that is still a whole number of nanometers. */
export const FINEST_INCH_DENOMINATOR = 64;

export function mm(value: number): Length {
  return Math.round(value * NM_PER_MM);
}

export function inches(value: number): Length {
  return Math.round(value * NM_PER_INCH);
}

/** Builds an exact length from whole inches plus a fraction, such as 34 1/2. */
export function inchFraction(whole: number, numerator = 0, denominator = 1): Length {
  return Math.round(whole * NM_PER_INCH + (numerator * NM_PER_INCH) / denominator);
}

export function toMm(length: Length): number {
  return length / NM_PER_MM;
}

export function toInches(length: Length): number {
  return length / NM_PER_INCH;
}

export type UnitSystem = 'imperial' | 'metric';

/** Smallest inch fraction shown, given as its denominator. */
export type ImperialPrecision = 8 | 16 | 32 | 64;

/** Smallest metric step shown, in millimeters. */
export type MetricPrecision = 1 | 0.5 | 0.1;

export interface UnitSettings {
  system: UnitSystem;
  imperialPrecision: ImperialPrecision;
  metricPrecision: MetricPrecision;
}

export const DEFAULT_UNIT_SETTINGS: UnitSettings = {
  system: 'imperial',
  imperialPrecision: 16,
  metricPrecision: 0.5,
};

export const IMPERIAL_PRECISIONS: readonly ImperialPrecision[] = [8, 16, 32, 64];
export const METRIC_PRECISIONS: readonly MetricPrecision[] = [1, 0.5, 0.1];

export interface FormattedLength {
  /** The value as shown, without any marker for rounding. */
  text: string;
  /** False when the stored length had to be rounded to fit the display precision. */
  exact: boolean;
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

function formatImperial(length: Length, precision: ImperialPrecision): FormattedLength {
  const step = NM_PER_INCH / precision;
  const steps = Math.round(length / step);
  const exact = steps * step === length;
  const sign = steps < 0 ? '-' : '';
  const magnitude = Math.abs(steps);
  const whole = Math.floor(magnitude / precision);
  const remainder = magnitude % precision;

  if (remainder === 0) {
    return { text: `${sign}${whole}"`, exact };
  }
  const divisor = gcd(remainder, precision);
  const fraction = `${remainder / divisor}/${precision / divisor}`;
  const text = whole === 0 ? `${sign}${fraction}"` : `${sign}${whole} ${fraction}"`;
  return { text, exact };
}

function formatMetric(length: Length, precision: MetricPrecision): FormattedLength {
  const step = Math.round(precision * NM_PER_MM);
  const steps = Math.round(length / step);
  const exact = steps * step === length;
  // Work in tenths of a millimeter so the printed digits never show float noise.
  const tenths = Math.round((steps * step) / (NM_PER_MM / 10));
  const sign = tenths < 0 ? '-' : '';
  const magnitude = Math.abs(tenths);
  const whole = Math.floor(magnitude / 10);
  const tenth = magnitude % 10;
  const digits = tenth === 0 ? `${whole}` : `${whole}.${tenth}`;
  return { text: `${sign}${digits} mm`, exact };
}

export function formatLengthParts(length: Length, settings: UnitSettings): FormattedLength {
  return settings.system === 'imperial'
    ? formatImperial(length, settings.imperialPrecision)
    : formatMetric(length, settings.metricPrecision);
}

/**
 * Formats a length for display. A leading "~" marks a value that was rounded
 * to the display precision, so a rounded number is never mistaken for an
 * exact one.
 */
export function formatLength(length: Length, settings: UnitSettings): string {
  const { text, exact } = formatLengthParts(length, settings);
  return exact ? text : `~${text}`;
}

export function describeImperialPrecision(precision: ImperialPrecision): string {
  return `1/${precision}"`;
}

export function describeMetricPrecision(precision: MetricPrecision): string {
  return `${precision} mm`;
}
