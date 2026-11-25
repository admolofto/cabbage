import { inchFraction, mm, type Length, type UnitSystem } from './units';

export interface GridSteps {
  /** Spacing of the fine lines. */
  minor: Length;
  /** Spacing of the heavier lines. Always the next step up the ladder. */
  major: Length;
}

/** Grid spacings to choose from, smallest first. Each is a natural unit to count in. */
const IMPERIAL_LADDER: readonly Length[] = [
  inchFraction(0, 1, 8),
  inchFraction(1),
  inchFraction(12),
  inchFraction(120),
  inchFraction(1200),
];

const METRIC_LADDER: readonly Length[] = [mm(1), mm(10), mm(100), mm(1000), mm(10_000), mm(100_000)];

export function gridLadder(system: UnitSystem): readonly Length[] {
  return system === 'imperial' ? IMPERIAL_LADDER : METRIC_LADDER;
}

/**
 * Picks the grid spacing for the current zoom level: the smallest step whose
 * lines are still at least `minPixels` apart on screen.
 */
export function chooseGridSteps(system: UnitSystem, nmPerPixel: number, minPixels = 8): GridSteps {
  const ladder = gridLadder(system);
  const last = ladder.length - 1;
  let index = ladder.findIndex((step) => step / nmPerPixel >= minPixels);
  if (index === -1 || index === last) {
    index = last - 1;
  }
  return { minor: ladder[index]!, major: ladder[index + 1]! };
}
