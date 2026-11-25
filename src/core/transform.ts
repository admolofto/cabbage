import {
  boxFromCorners,
  boxMax,
  faceAxis,
  faceIndex,
  faceSign,
  tidyBoard,
  type Board,
  type Box,
  type FaceIndex,
} from './board';
import type { Length } from './units';
import { addVec, withAxis, type Axis, type Vec3L } from './vec';

/**
 * Exact edits to boards. Everything here works in whole document units, so a
 * board that is moved, turned, or resized any number of times never drifts.
 */

export function subtractVec(a: Vec3L, b: Vec3L): Vec3L {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scaleVec(v: Vec3L, factor: number): Vec3L {
  return [Math.round(v[0] * factor), Math.round(v[1] * factor), Math.round(v[2] * factor)];
}

/** Straight-line length of a vector, rounded to a whole document unit. */
export function vecLength(v: Vec3L): Length {
  return Math.round(Math.hypot(v[0], v[1], v[2]));
}

export function isZeroVec(v: Vec3L): boolean {
  return v[0] === 0 && v[1] === 0 && v[2] === 0;
}

export function moveBoard(board: Board, delta: Vec3L): Board {
  return { ...board, min: addVec(board.min, delta) };
}

/** The position of one face of a box: its low side for sign -1, its high side for sign 1. */
export function facePosition(box: Box, axis: Axis, sign: 1 | -1): Length {
  return sign > 0 ? box.min[axis] + box.size[axis] : box.min[axis];
}

/** The four corners of one face of a box, in order around the face. */
export function faceCorners(box: Box, axis: Axis, sign: 1 | -1): Vec3L[] {
  const max = boxMax(box);
  const at = facePosition(box, axis, sign);
  const [u, v] = axis === 0 ? ([1, 2] as const) : axis === 1 ? ([0, 2] as const) : ([0, 1] as const);
  const corner = (uValue: Length, vValue: Length) =>
    withAxis(withAxis(withAxis(box.min, axis, at), u, uValue), v, vValue);
  return [
    corner(box.min[u], box.min[v]),
    corner(max[u], box.min[v]),
    corner(max[u], max[v]),
    corner(box.min[u], max[v]),
  ];
}

/**
 * Moves one face of a board outward by a distance, or inward when it is
 * negative. The opposite face stays where it is. The board never gets thinner
 * than `minimum` along that axis.
 */
export function pullBoard(board: Board, axis: Axis, sign: 1 | -1, distance: Length, minimum: Length): Board {
  const size = Math.max(board.size[axis] + distance, minimum);
  const min = sign > 0 ? board.min[axis] : board.min[axis] + board.size[axis] - size;
  // Pulled far enough, a board is thinnest another way, and its thickness follows.
  return tidyBoard({ ...board, min: withAxis(board.min, axis, min), size: withAxis(board.size, axis, size) });
}

/** The two axes a quarter turn about `axis` swaps, in right-handed order. */
function turningAxes(axis: Axis): readonly [Axis, Axis] {
  if (axis === 0) return [1, 2];
  if (axis === 1) return [2, 0];
  return [0, 1];
}

/**
 * Turns a point about a line through `pivot` along `axis`, in quarter turns.
 * A positive turn is counterclockwise when looking back down the axis toward
 * the pivot, the same way angles run on a drawing.
 */
export function rotatePointQuarter(point: Vec3L, pivot: Vec3L, axis: Axis, turns: number): Vec3L {
  const [u, v] = turningAxes(axis);
  let du = point[u] - pivot[u];
  let dv = point[v] - pivot[v];
  for (let count = ((turns % 4) + 4) % 4; count > 0; count -= 1) {
    [du, dv] = [-dv, du];
  }
  return withAxis(withAxis(point, u, pivot[u] + du), v, pivot[v] + dv);
}

/** Turns a board in quarter turns. Its thickness direction, grain, and banded edges turn with it. */
export function rotateBoardQuarter(board: Board, pivot: Vec3L, axis: Axis, turns: number): Board {
  const box = boxFromCorners(
    rotatePointQuarter(board.min, pivot, axis, turns),
    rotatePointQuarter(boxMax(board), pivot, axis, turns),
  );
  const [u, v] = turningAxes(axis);
  const count = ((turns % 4) + 4) % 4;
  const odd = count % 2 === 1;
  const turnAxis = (other: Axis): Axis => (!odd ? other : other === u ? v : other === v ? u : other);
  // Where a face ends up: the same sums as turning a point, applied to the way the face looks.
  const turnFace = (face: FaceIndex): FaceIndex => {
    let faceAlong = faceAxis(face);
    let side = faceSign(face);
    for (let step = 0; step < count; step += 1) {
      if (faceAlong === u) faceAlong = v;
      else if (faceAlong === v) [faceAlong, side] = [u, side === 1 ? -1 : 1];
    }
    return faceIndex(faceAlong, side);
  };
  return tidyBoard({
    ...board,
    ...box,
    thicknessAxis: turnAxis(board.thicknessAxis),
    grain: board.grain === undefined ? undefined : turnAxis(board.grain),
    banding: board.banding?.map(turnFace),
  });
}

/** The angle of a direction around an axis, in quarter turns from the first turning axis. */
export function quarterTurnsBetween(from: Vec3L, to: Vec3L, pivot: Vec3L, axis: Axis): number | null {
  const [u, v] = turningAxes(axis);
  const fromU = from[u] - pivot[u];
  const fromV = from[v] - pivot[v];
  const toU = to[u] - pivot[u];
  const toV = to[v] - pivot[v];
  if ((fromU === 0 && fromV === 0) || (toU === 0 && toV === 0)) return null;
  const angle = Math.atan2(toV, toU) - Math.atan2(fromV, fromU);
  return ((Math.round(angle / (Math.PI / 2)) % 4) + 4) % 4;
}
