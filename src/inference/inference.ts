import { Ray, Vector3 } from 'three';
import { boxCorners, boxEdges, boxMax, midpoint, type Board } from '../core/board';
import type { Guide } from '../core/document';
import { NM_PER_MM, type Length } from '../core/units';
import { AXES, withAxis, type Axis, type Vec3L } from '../core/vec';

/**
 * The inference engine: given the boards, the camera, and the cursor, decide
 * what the cursor most plausibly means.
 *
 * Geometry is done in millimeters as ordinary floating point. Results go back
 * to exact document units, and a snap to a corner returns the corner's own
 * stored coordinates, so snapped points never pick up rounding error.
 */

export type SnapKind =
  | 'corner'
  | 'midpoint'
  | 'origin'
  | 'intersection'
  | 'edge'
  | 'guide'
  | 'face'
  | 'floor'
  | 'free';

export interface Snap {
  point: Vec3L;
  kind: SnapKind;
  boardId?: string;
  /** For a face snap: which face of the board, as its axis and the side it faces. */
  face?: { axis: Axis; sign: 1 | -1 };
  /** For an edge or guide snap: the axis it runs along, which is the one direction the point is free in. */
  edgeAxis?: Axis;
  guideId?: string;
  /**
   * True when the point was carried over from a corner, midpoint, or edge
   * elsewhere, instead of sitting on it. This is how a drag lines up with
   * something that is not on the plane or line being worked on.
   */
  aligned: boolean;
  /** For an aligned snap: the corner, midpoint, or edge point it was carried over from. */
  source?: Vec3L;
}

/** What the engine needs to know about the camera and the cursor. */
export interface SnapView {
  /** Ray from the camera through the cursor, in millimeters. */
  ray: Ray;
  /** Cursor position in screen pixels. */
  cursor: { x: number; y: number };
  /** Screen position of a point in millimeters, or null when it is behind the camera. */
  project: (point: Vector3) => { x: number; y: number } | null;
  /** How close, in pixels, the cursor must be to a point or edge to snap to it. */
  tolerance: number;
}

/** Limits the result to a plane or a line that runs along an axis. */
export type Constraint =
  | { kind: 'plane'; axis: Axis; value: Length }
  | { kind: 'line'; axis: Axis; through: Vec3L };

export const DEFAULT_SNAP_TOLERANCE = 10;

const ORIGIN: Vec3L = [0, 0, 0];

export function toMillimeters(point: Vec3L): Vector3 {
  return new Vector3(point[0] / NM_PER_MM, point[1] / NM_PER_MM, point[2] / NM_PER_MM);
}

function toLength(millimeters: number): Length {
  return Math.round(millimeters * NM_PER_MM);
}

export function fromMillimeters(point: Vector3): Vec3L {
  return [toLength(point.x), toLength(point.y), toLength(point.z)];
}

export interface SurfaceHit {
  board: Board;
  /** Distance along the ray, in millimeters. */
  distance: number;
  axis: Axis;
  sign: 1 | -1;
}

/** Where a ray enters a board, or null if it misses or starts inside it. */
function enterBoard(board: Board, ray: Ray): SurfaceHit | null {
  const min = toMillimeters(board.min);
  const max = toMillimeters(boxMax(board));
  const origin = ray.origin.toArray();
  const direction = ray.direction.toArray();
  const low = min.toArray();
  const high = max.toArray();

  let enter = -Infinity;
  let exit = Infinity;
  let enterAxis: Axis = 0;
  for (const axis of [0, 1, 2] as const) {
    const o = origin[axis]!;
    const d = direction[axis]!;
    if (Math.abs(d) < 1e-12) {
      if (o < low[axis]! || o > high[axis]!) return null;
      continue;
    }
    let near = (low[axis]! - o) / d;
    let far = (high[axis]! - o) / d;
    if (near > far) [near, far] = [far, near];
    if (near > enter) {
      enter = near;
      enterAxis = axis;
    }
    exit = Math.min(exit, far);
    if (enter > exit) return null;
  }
  if (enter <= 0 || !Number.isFinite(enter)) return null;
  return { board, distance: enter, axis: enterAxis, sign: direction[enterAxis]! > 0 ? -1 : 1 };
}

/** The first board surface a ray lands on. */
export function firstSurfaceHit(boards: readonly Board[], ray: Ray): SurfaceHit | null {
  let best: SurfaceHit | null = null;
  for (const board of boards) {
    const hit = enterBoard(board, ray);
    if (hit && (!best || hit.distance < best.distance)) best = hit;
  }
  return best;
}

/** True when nothing solid sits between the camera and the point. */
function isVisible(point: Vector3, boards: readonly Board[], cameraPosition: Vector3): boolean {
  const toPoint = point.clone().sub(cameraPosition);
  const distance = toPoint.length();
  if (distance < 1e-9) return true;
  const hit = firstSurfaceHit(boards, new Ray(cameraPosition, toPoint.divideScalar(distance)));
  // The point usually lies on a board itself, so a hit right at it does not hide it.
  return !hit || hit.distance > distance - Math.max(0.05, distance * 1e-4);
}

interface Candidate {
  snap: Snap;
  pixels: number;
  depth: number;
}

function pixelDistance(point: Vector3, view: SnapView): number | null {
  const screen = view.project(point);
  if (!screen) return null;
  return Math.hypot(screen.x - view.cursor.x, screen.y - view.cursor.y);
}

function better(candidate: Candidate, best: Candidate | null): boolean {
  if (!best) return true;
  if (Math.abs(candidate.pixels - best.pixels) > 0.5) return candidate.pixels < best.pixels;
  return candidate.depth < best.depth;
}

/** Where two guides cross, or null when they pass each other by. */
function guideCrossing(first: Guide, second: Guide): Vec3L | null {
  if (first.axis === second.axis) return null;
  const third = AXES.find((axis) => axis !== first.axis && axis !== second.axis)!;
  if (first.through[third] !== second.through[third]) return null;
  return withAxis(first.through, first.axis, second.through[first.axis]);
}

/** The nearest visible corner, midpoint, crossing, or the origin within tolerance of the cursor. */
function findPointSnap(
  boards: readonly Board[],
  guides: readonly Guide[],
  view: SnapView,
  solids: readonly Board[] = boards,
): Snap | null {
  const best: { corner: Candidate | null; other: Candidate | null } = { corner: null, other: null };

  const consider = (point: Vec3L, kind: SnapKind, boardId?: string, alwaysVisible = false) => {
    const position = toMillimeters(point);
    const pixels = pixelDistance(position, view);
    if (pixels === null || pixels > view.tolerance) return;
    if (!alwaysVisible && !isVisible(position, solids, view.ray.origin)) return;
    const candidate: Candidate = {
      snap: { point, kind, boardId, aligned: false },
      pixels,
      depth: position.distanceTo(view.ray.origin),
    };
    if (kind === 'corner') {
      if (better(candidate, best.corner)) best.corner = candidate;
    } else if (better(candidate, best.other)) {
      best.other = candidate;
    }
  };

  for (const board of boards) {
    for (const corner of boxCorners(board)) consider(corner, 'corner', board.id);
    const edges = boxEdges(board);
    for (const edge of edges) consider(midpoint(edge.a, edge.b), 'midpoint', board.id);
    // Where a guide crosses an edge of this board.
    for (const guide of guides) {
      for (const edge of edges) {
        if (edge.axis === guide.axis) continue;
        const third = AXES.find((axis) => axis !== edge.axis && axis !== guide.axis)!;
        const along = guide.through[edge.axis];
        if (guide.through[third] !== edge.a[third] || along <= edge.a[edge.axis] || along >= edge.b[edge.axis]) {
          continue;
        }
        consider(withAxis(edge.a, edge.axis, along), 'intersection', board.id);
      }
    }
  }
  // Guides are drawn over everything, so their crossings are never hidden.
  guides.forEach((first, index) => {
    for (const second of guides.slice(index + 1)) {
      const crossing = guideCrossing(first, second);
      if (crossing) consider(crossing, 'intersection', undefined, true);
    }
  });
  consider(ORIGIN, 'origin');

  // A corner within reach always wins over a midpoint or the origin.
  const winner = best.corner ?? best.other;
  return winner ? winner.snap : null;
}

/** The nearest visible point along a board edge within tolerance of the cursor. */
function findEdgeSnap(boards: readonly Board[], view: SnapView, solids: readonly Board[] = boards): Snap | null {
  let best: Candidate | null = null;
  const { ray } = view;

  for (const board of boards) {
    for (const edge of boxEdges(board)) {
      const a = toMillimeters(edge.a);
      const b = toMillimeters(edge.b);
      const closest = new Vector3();
      ray.distanceSqToSegment(a, b, undefined, closest);
      const pixels = pixelDistance(closest, view);
      if (pixels === null || pixels > view.tolerance) continue;
      if (!isVisible(closest, solids, ray.origin)) continue;

      // Only the coordinate along the edge is free. The other two stay exact.
      const along = Math.min(
        Math.max(toLength(closest.getComponent(edge.axis)), edge.a[edge.axis]),
        edge.b[edge.axis],
      );
      const candidate: Candidate = {
        snap: {
          point: withAxis(edge.a, edge.axis, along),
          kind: 'edge',
          boardId: board.id,
          edgeAxis: edge.axis,
          aligned: false,
        },
        pixels,
        depth: closest.distanceTo(ray.origin),
      };
      if (better(candidate, best)) best = candidate;
    }
  }
  return best ? best.snap : null;
}

/** The nearest point along a guide within tolerance of the cursor. */
function findGuideSnap(guides: readonly Guide[], view: SnapView): Snap | null {
  let best: Candidate | null = null;
  for (const guide of guides) {
    const point = closestOnAxisLine(view.ray, guide.axis, guide.through);
    if (!point) continue;
    const position = toMillimeters(point);
    const pixels = pixelDistance(position, view);
    if (pixels === null || pixels > view.tolerance) continue;
    const candidate: Candidate = {
      snap: { point, kind: 'guide', guideId: guide.id, edgeAxis: guide.axis, aligned: false },
      pixels,
      depth: position.distanceTo(view.ray.origin),
    };
    if (better(candidate, best)) best = candidate;
  }
  return best ? best.snap : null;
}

/** The guide under the cursor, if any. */
export function guideUnderCursor(guides: readonly Guide[], view: SnapView): Guide | null {
  const id = findGuideSnap(guides, view)?.guideId;
  return guides.find((guide) => guide.id === id) ?? null;
}

export interface AxisInference {
  axis: Axis;
  /** The point on the axis line nearest the cursor. */
  point: Vec3L;
}

/**
 * Notices when the cursor is heading along an axis from a starting point: it
 * returns the axis whose line through that point passes within tolerance of
 * the cursor. Right at the starting point no direction is clear yet, so it
 * returns nothing there.
 */
export function findAxisInference(view: SnapView, through: Vec3L, axes: readonly Axis[] = AXES): AxisInference | null {
  const start = pixelDistance(toMillimeters(through), view);
  if (start === null || start < view.tolerance) return null;
  let best: (AxisInference & { pixels: number }) | null = null;
  for (const axis of axes) {
    const point = closestOnAxisLine(view.ray, axis, through);
    if (!point || point[axis] === through[axis]) continue;
    const pixels = pixelDistance(toMillimeters(point), view);
    if (pixels === null || pixels > view.tolerance) continue;
    if (!best || pixels < best.pixels) best = { axis, point, pixels };
  }
  return best ? { axis: best.axis, point: best.point } : null;
}

/** Where the cursor meets a plane square to an axis, or null when it never does. */
export function pointOnPlane(view: SnapView, axis: Axis, value: Length): Vec3L | null {
  return intersectAxisPlane(view.ray, axis, value);
}

function findFaceSnap(boards: readonly Board[], ray: Ray): Snap | null {
  const hit = firstSurfaceHit(boards, ray);
  if (!hit) return null;
  const point = fromMillimeters(ray.at(hit.distance, new Vector3()));
  const { axis, sign, board } = hit;
  // The coordinate across the face is exactly the face's own position.
  const across = sign > 0 ? board.min[axis] + board.size[axis] : board.min[axis];
  return {
    point: withAxis(point, axis, across),
    kind: 'face',
    boardId: board.id,
    face: { axis, sign },
    aligned: false,
  };
}

function intersectAxisPlane(ray: Ray, axis: Axis, value: Length): Vec3L | null {
  const direction = ray.direction.getComponent(axis);
  if (Math.abs(direction) < 1e-9) return null;
  const distance = (value / NM_PER_MM - ray.origin.getComponent(axis)) / direction;
  if (distance <= 0) return null;
  return withAxis(fromMillimeters(ray.at(distance, new Vector3())), axis, value);
}

/** The point on an axis-parallel line that passes closest to the ray. */
function closestOnAxisLine(ray: Ray, axis: Axis, through: Vec3L): Vec3L | null {
  const origin = toMillimeters(through);
  const direction = new Vector3().setComponent(axis, 1);
  const between = origin.clone().sub(ray.origin);
  const b = direction.dot(ray.direction);
  const denominator = 1 - b * b;
  // Looking straight down the line: every point on it is under the cursor.
  if (denominator < 1e-6) return null;
  const along = (b * between.dot(ray.direction) - between.dot(direction)) / denominator;
  return withAxis(through, axis, through[axis] + toLength(along));
}

/**
 * Finds what the cursor snaps to.
 *
 * With no constraint, the order of preference is: a corner, then a midpoint,
 * a crossing with a guide, or the origin, then a point along an edge, a point
 * along a guide, a point on a face, and last the floor.
 *
 * With a constraint, corners, midpoints, edges, and guides under the cursor still win,
 * but the result is carried onto the plane or line and marked as aligned.
 * Otherwise the result is simply where the cursor meets the plane or line.
 *
 * Boards in `hiddenBy` are never snapped to, but they still hide what is behind
 * them. A tool passes the board it is changing, so nothing snaps through it.
 */
export function findSnap(
  boards: readonly Board[],
  view: SnapView,
  constraint?: Constraint,
  guides: readonly Guide[] = [],
  hiddenBy: readonly Board[] = [],
): Snap | null {
  const solids = hiddenBy.length > 0 ? [...boards, ...hiddenBy] : boards;
  const reference =
    findPointSnap(boards, guides, view, solids) ?? findEdgeSnap(boards, view, solids) ?? findGuideSnap(guides, view);

  if (constraint?.kind === 'plane') {
    const { axis, value } = constraint;
    if (reference) {
      if (reference.point[axis] === value) return reference;
      return { ...reference, point: withAxis(reference.point, axis, value), aligned: true, source: reference.point };
    }
    const point = intersectAxisPlane(view.ray, axis, value);
    return point ? { point, kind: 'free', aligned: false } : null;
  }

  if (constraint?.kind === 'line') {
    const { axis, through } = constraint;
    if (reference) {
      const point = withAxis(through, axis, reference.point[axis]);
      const onLine = withAxis(reference.point, axis, through[axis]);
      const aligned = onLine[0] !== through[0] || onLine[1] !== through[1] || onLine[2] !== through[2];
      return aligned ? { ...reference, point, aligned, source: reference.point } : { ...reference, point };
    }
    const point = closestOnAxisLine(view.ray, axis, through);
    return point ? { point, kind: 'free', aligned: false } : null;
  }

  if (reference) return reference;
  const face = findFaceSnap(boards, view.ray);
  if (face) return face;
  const floor = intersectAxisPlane(view.ray, 2, 0);
  return floor ? { point: floor, kind: 'floor', aligned: false } : null;
}
