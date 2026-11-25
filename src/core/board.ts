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
  /**
   * Which axis the board's thickness runs along. The other two are its face.
   * It is always the thinnest way through the board. See `tidyBoard`.
   */
  thicknessAxis: Axis;
  /** What it is made of: the id of a material in the library or in the project. */
  materialId: string;
  /**
   * The axis the grain runs along, when it has been chosen by hand. Left out,
   * the grain follows the longer side of the face, which is nearly always right.
   */
  grain?: Axis;
  /** The narrow faces that get edge banding. Never one of the two wide faces. */
  banding?: readonly FaceIndex[];
  /**
   * Set on a board that a cabinet is made of. Such a board is worked out from
   * the cabinet each time and is never saved or changed on its own.
   */
  cabinetId?: string;
}

/**
 * One of the six faces of a box: twice the axis it faces along, plus one for
 * the side facing the positive direction. 0 is left, 1 right, 2 front, 3 back,
 * 4 bottom, and 5 top.
 */
export type FaceIndex = 0 | 1 | 2 | 3 | 4 | 5;

export const FACE_NAMES = ['Left', 'Right', 'Front', 'Back', 'Bottom', 'Top'] as const;

export function faceIndex(axis: Axis, sign: 1 | -1): FaceIndex {
  return (axis * 2 + (sign > 0 ? 1 : 0)) as FaceIndex;
}

export function faceAxis(face: FaceIndex): Axis {
  return Math.floor(face / 2) as Axis;
}

export function faceSign(face: FaceIndex): 1 | -1 {
  return face % 2 === 1 ? 1 : -1;
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

/** The axis the grain runs along: the one chosen by hand, or else the longer side of the face. */
export function grainAxis(board: Board): Axis {
  const [u, v] = otherAxes(board.thicknessAxis);
  if (board.grain === u || board.grain === v) return board.grain;
  return board.size[u] >= board.size[v] ? u : v;
}

/** The faces of a board that can take edge banding: the four narrow ones. */
export function edgeFaces(board: Board): FaceIndex[] {
  return otherAxes(board.thicknessAxis).flatMap((axis) => [faceIndex(axis, -1), faceIndex(axis, 1)]);
}

/** The axis a box is thinnest along. When several tie, the preferred one wins if it is among them. */
export function thinnestAxis(size: Vec3L, preferred: Axis): Axis {
  const least = Math.min(size[0], size[1], size[2]);
  if (size[preferred] === least) return preferred;
  return AXES.find((axis) => size[axis] === least)!;
}

/**
 * Puts a board in order after it is made or changed.
 *
 * The thickness is whichever way the board is thinnest. A side panel drawn as
 * a 3/4" by 12" rectangle and pulled up 36" is a 12" by 36" part in 3/4"
 * stock, however it was drawn, and that is how the cut list must see it.
 *
 * Details that depend on which way the board faces follow: a grain choice
 * across the thickness is dropped, and so is banding on a wide face. Empty
 * details are left out altogether, so equal boards stay equal.
 */
export function tidyBoard(board: Board): Board {
  const { grain, banding, ...rest } = board;
  const thicknessAxis = thinnestAxis(board.size, board.thicknessAxis);
  const next: Board = { ...rest, thicknessAxis };
  if (grain !== undefined && grain !== thicknessAxis) next.grain = grain;
  const kept = [...new Set(banding ?? [])]
    .filter((face) => faceAxis(face) !== thicknessAxis)
    .sort((a, b) => a - b);
  if (kept.length > 0) next.banding = kept;
  return next;
}
