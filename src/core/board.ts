import type { Length } from './units';
import { AXES, addVec, otherAxes, withAxis, type Axis, type Vec3L } from './vec';

/**
 * A board: the only kind of solid in a Cabbage model.
 *
 * For now every board is a plain rectangular panel lined up with the three
 * axes. Rotation and shaped outlines arrive with later milestones.
 */
export interface Board {
  id: string;
  name: string;
  /** Corner with the smallest x, y, and z. */
  min: Vec3L;
  /** Extent along each axis. Always positive. */
  size: Vec3L;
  /** Which axis the board's thickness runs along. The other two are its face. */
  thicknessAxis: Axis;
}

export interface Box {
  min: Vec3L;
  size: Vec3L;
}

export function boxMax(box: Box): Vec3L {
  return addVec(box.min, box.size);
}

/** The box spanning two opposite corners, whichever order they come in. */
export function boxFromCorners(a: Vec3L, b: Vec3L): Box {
  const min: Vec3L = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])];
  const size: Vec3L = [Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2])];
  return { min, size };
}

export function boxCorners(box: Box): Vec3L[] {
  const max = boxMax(box);
  const corners: Vec3L[] = [];
  for (const x of [box.min[0], max[0]]) {
    for (const y of [box.min[1], max[1]]) {
      for (const z of [box.min[2], max[2]]) {
        corners.push([x, y, z]);
      }
    }
  }
  return corners;
}

export interface BoxEdge {
  a: Vec3L;
  b: Vec3L;
  /** The axis the edge runs along. */
  axis: Axis;
}

/** The twelve edges of a box: four along each axis. */
export function boxEdges(box: Box): BoxEdge[] {
  const max = boxMax(box);
  const edges: BoxEdge[] = [];
  for (const axis of AXES) {
    const [u, v] = otherAxes(axis);
    for (const uValue of [box.min[u], max[u]]) {
      for (const vValue of [box.min[v], max[v]]) {
        const a = withAxis(withAxis(box.min, u, uValue), v, vValue);
        edges.push({ a, b: withAxis(a, axis, max[axis]), axis });
      }
    }
  }
  return edges;
}

/** Halfway between two points, rounded to a whole document unit. */
export function midpoint(a: Vec3L, b: Vec3L): Vec3L {
  const half = (p: Length, q: Length) => Math.round((p + q) / 2);
  return [half(a[0], b[0]), half(a[1], b[1]), half(a[2], b[2])];
}

/** The two face dimensions of a board, longest first, then its thickness. */
export function boardDimensions(board: Board): { length: Length; width: Length; thickness: Length } {
  const [u, v] = otherAxes(board.thicknessAxis);
  const a = board.size[u];
  const b = board.size[v];
  return { length: Math.max(a, b), width: Math.min(a, b), thickness: board.size[board.thicknessAxis] };
}
