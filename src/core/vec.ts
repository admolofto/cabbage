import type { Length } from './units';

/** A point or a size in exact document units, as x, y, z. */
export type Vec3L = readonly [Length, Length, Length];

/** 0 is X (width), 1 is Y (depth, front to back), 2 is Z (height). */
export type Axis = 0 | 1 | 2;

export const AXES: readonly Axis[] = [0, 1, 2];
export const AXIS_NAMES = ['X', 'Y', 'Z'] as const;

/** The two axes that are not the given one, lowest first. */
export function otherAxes(axis: Axis): readonly [Axis, Axis] {
  if (axis === 0) return [1, 2];
  if (axis === 1) return [0, 2];
  return [0, 1];
}

export function withAxis(v: Vec3L, axis: Axis, value: Length): Vec3L {
  const next: [Length, Length, Length] = [v[0], v[1], v[2]];
  next[axis] = value;
  return next;
}

export function vecEquals(a: Vec3L, b: Vec3L): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function addVec(a: Vec3L, b: Vec3L): Vec3L {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
