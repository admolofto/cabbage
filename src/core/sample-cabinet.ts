import type { Board } from './board';
import { createId } from './document';
import { inchFraction } from './units';
import type { Axis, Vec3L } from './vec';

/**
 * A plain frameless base cabinet, 30" wide, 34 1/2" tall, and 24" deep, built
 * from ordinary boards. It gives a new model something to snap to and measure
 * against. Parametric cabinets replace it in a later phase.
 */
export function createSampleCabinet(): Board[] {
  const inch = inchFraction;
  const width = inch(30);
  const height = inch(34, 1, 2);
  const depth = inch(24);
  const sheet = inch(0, 3, 4);
  const back = inch(0, 1, 4);
  const toeKickHeight = inch(4);
  const toeKickSetback = inch(3);
  const stretcherDepth = inch(4);
  const innerWidth = width - 2 * sheet;
  const innerDepth = depth - back;

  const parts: readonly [string, Vec3L, Vec3L, Axis][] = [
    ['Left side', [0, 0, 0], [sheet, depth, height], 0],
    ['Right side', [width - sheet, 0, 0], [sheet, depth, height], 0],
    ['Bottom', [sheet, 0, toeKickHeight], [innerWidth, innerDepth, sheet], 2],
    ['Back', [sheet, innerDepth, toeKickHeight], [innerWidth, back, height - toeKickHeight], 1],
    ['Toe kick', [sheet, toeKickSetback, 0], [innerWidth, sheet, toeKickHeight], 1],
    ['Front stretcher', [sheet, 0, height - sheet], [innerWidth, stretcherDepth, sheet], 2],
    ['Rear stretcher', [sheet, innerDepth - stretcherDepth, height - sheet], [innerWidth, stretcherDepth, sheet], 2],
    ['Shelf', [sheet, inch(1), inch(19)], [innerWidth, innerDepth - inch(1), sheet], 2],
  ];
  return parts.map(([name, min, size, thicknessAxis]) => ({ id: createId(), name, min, size, thicknessAxis }));
}
