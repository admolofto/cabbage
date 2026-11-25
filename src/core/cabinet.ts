import {
  boxFromCorners,
  faceIndex,
  tidyBoard,
  type Board,
  type Box,
  type FaceIndex,
} from './board';
import { THICKNESS_PRESETS, type Stock } from './materials';
import { rotateBoardQuarter, rotatePointQuarter } from './transform';
import { inchFraction, mm, type Length, type UnitSystem } from './units';
import { withAxis, type Axis, type Vec3L } from './vec';

/**
 * A cabinet: a handful of sizes that a recipe turns into boards.
 *
 * The boards are never stored. They are worked out from the cabinet whenever
 * they are needed, so changing a size changes every board that depends on it,
 * and the drawing and the cut list cannot disagree with the cabinet.
 *
 * This first recipe is a frameless case with butt joints and a back applied
 * over the back edges, the plainest build for a shop with a track saw. Other
 * ways of building arrive with build styles.
 */

export type CabinetKind = 'base' | 'wall' | 'tall';

export const CABINET_KINDS: readonly CabinetKind[] = ['base', 'wall', 'tall'];

export const CABINET_KIND_NAMES: Record<CabinetKind, string> = { base: 'Base', wall: 'Wall', tall: 'Tall' };

/** The sizes a build uses that are not the cabinet's own: stock thicknesses and standing allowances. */
export interface CabinetBuild {
  /** Thickness of the sides, bottom, top, shelves, and toe kick. */
  thickness: Length;
  backThickness: Length;
  /** How far the toe kick board sits behind the front of the cabinet. */
  toeKickSetback: Length;
  /** Width of the two strips that tie the top of a base cabinet together. */
  stretcherWidth: Length;
  /** How much narrower a loose shelf is than the opening it sits in, both sides together. */
  shelfGap: Length;
  /** How far a loose shelf stops short of the front of the cabinet. */
  shelfSetback: Length;
}

export interface Cabinet {
  id: string;
  name: string;
  kind: CabinetKind;
  /** The back left bottom corner, as seen standing in front of the cabinet. */
  position: Vec3L;
  /**
   * Quarter turns about the up axis, counterclockwise seen from above. At
   * zero the cabinet faces the front of the model, toward smaller y.
   */
  turns: 0 | 1 | 2 | 3;
  /** Outside sizes of the case. The depth includes the back and leaves out doors. */
  width: Length;
  height: Length;
  depth: Length;
  /** Height of the recess at the floor. Zero for none. */
  toeKick: Length;
  /** How many loose shelves, spaced evenly. */
  shelves: number;
  materialId: string;
  build: CabinetBuild;
}

export interface CabinetSize {
  width: Length;
  height: Length;
  depth: Length;
}

/** The narrowest opening a case may be left with: 50 mm. */
const SMALLEST_OPENING: Length = mm(50);
/** Nothing is built bigger than this: 6 meters. */
const LARGEST_SIZE: Length = mm(6000);
const MOST_SHELVES = 30;

const USUAL: Record<UnitSystem, Record<CabinetKind, CabinetSize & { toeKick: Length; shelves: number }>> = {
  imperial: {
    base: { width: inchFraction(24), height: inchFraction(34, 1, 2), depth: inchFraction(24), toeKick: inchFraction(4), shelves: 1 },
    wall: { width: inchFraction(24), height: inchFraction(30), depth: inchFraction(12), toeKick: 0, shelves: 2 },
    tall: { width: inchFraction(24), height: inchFraction(84), depth: inchFraction(24), toeKick: inchFraction(4), shelves: 4 },
  },
  metric: {
    base: { width: mm(600), height: mm(870), depth: mm(560), toeKick: mm(150), shelves: 1 },
    wall: { width: mm(600), height: mm(720), depth: mm(320), toeKick: 0, shelves: 2 },
    tall: { width: mm(600), height: mm(2100), depth: mm(560), toeKick: mm(150), shelves: 4 },
  },
};

/** How high off the floor the bottom of a wall cabinet hangs. */
const HANGING_HEIGHT: Record<UnitSystem, Length> = { imperial: inchFraction(54), metric: mm(1400) };

/** The height a new cabinet of a kind starts at: on the floor, or hung on the wall. */
export function usualElevation(kind: CabinetKind, system: UnitSystem): Length {
  return kind === 'wall' ? HANGING_HEIGHT[system] : 0;
}

export function usualSize(kind: CabinetKind, system: UnitSystem): CabinetSize {
  const { width, height, depth } = USUAL[system][kind];
  return { width, height, depth };
}

/** The standing allowances for a unit system, around a case stock of the given thickness. */
export function usualBuild(system: UnitSystem, thickness: Length): CabinetBuild {
  // The back is the second thinnest of the usual sheets: 1/4", or 6 mm.
  const backThickness = THICKNESS_PRESETS[system][1]!;
  return system === 'imperial'
    ? {
        thickness,
        backThickness,
        toeKickSetback: inchFraction(3),
        stretcherWidth: inchFraction(4),
        shelfGap: inchFraction(0, 1, 8),
        shelfSetback: inchFraction(0, 1, 4),
      }
    : {
        thickness,
        backThickness,
        toeKickSetback: mm(75),
        stretcherWidth: mm(100),
        shelfGap: mm(2),
        shelfSetback: mm(6),
      };
}

/** A new cabinet of the usual size for its kind, made of the stock picked for new work. */
export function createCabinet(
  id: string,
  name: string,
  kind: CabinetKind,
  system: UnitSystem,
  stock: Stock,
  position: Vec3L = [0, 0, 0],
): Cabinet {
  const usual = USUAL[system][kind];
  const build = usualBuild(system, stock.thickness);
  const cabinet: Cabinet = {
    id,
    name,
    kind,
    position,
    turns: 0,
    width: usual.width,
    height: usual.height,
    depth: usual.depth,
    toeKick: usual.toeKick === 0 ? 0 : Math.max(usual.toeKick, smallestToeKick(build)),
    shelves: usual.shelves,
    materialId: stock.materialId,
    build,
  };
  // Stock far from the usual can leave the usual sizes too small. Grow them just enough.
  const least = smallestSize(cabinet);
  return {
    ...cabinet,
    width: Math.max(cabinet.width, least.width),
    height: Math.max(cabinet.height, least.height),
    depth: Math.max(cabinet.depth, least.depth),
  };
}

/** A toe kick is either left out or at least this tall, so its board is never thinner than it is tall. */
export function smallestToeKick(build: CabinetBuild): Length {
  return Math.max(mm(25), build.thickness);
}

/** The smallest outside sizes a cabinet can be built at. */
export function smallestSize(cabinet: Cabinet): CabinetSize {
  const { thickness, backThickness } = cabinet.build;
  return {
    width: 2 * thickness + SMALLEST_OPENING,
    height: cabinet.toeKick + 2 * thickness + SMALLEST_OPENING,
    depth: backThickness + SMALLEST_OPENING,
  };
}

/** The tallest toe kick that still leaves room for the case above it. */
export function tallestToeKick(cabinet: Cabinet): Length {
  return cabinet.height - 2 * cabinet.build.thickness - SMALLEST_OPENING;
}

/** The inside of the case from the top of the bottom panel to the underside of the top. */
function insideHeight(cabinet: Cabinet): Length {
  return cabinet.height - cabinet.toeKick - 2 * cabinet.build.thickness;
}

/** The most loose shelves that fit with a usable gap between them. */
export function mostShelves(cabinet: Cabinet): number {
  const each = cabinet.build.thickness + SMALLEST_OPENING;
  const count = Math.floor((insideHeight(cabinet) - SMALLEST_OPENING) / each);
  return Math.max(0, Math.min(MOST_SHELVES, count));
}

/**
 * A cabinet with some of its sizes changed, or null when the result could not
 * be built: too small for its own boards, or too big to be a cabinet.
 */
export function resizeCabinet(
  cabinet: Cabinet,
  change: Partial<CabinetSize & { toeKick: Length; shelves: number }>,
): Cabinet | null {
  const next: Cabinet = { ...cabinet, ...change };
  for (const value of [next.width, next.height, next.depth, next.toeKick, next.shelves]) {
    if (!Number.isSafeInteger(value) || value < 0) return null;
  }
  if (next.toeKick !== 0 && next.toeKick < smallestToeKick(next.build)) return null;
  const least = smallestSize(next);
  if (next.width < least.width || next.height < least.height || next.depth < least.depth) return null;
  if (Math.max(next.width, next.height, next.depth) > LARGEST_SIZE) return null;
  // A cabinet made shorter keeps as many of its shelves as still fit.
  const shelves = Math.min(next.shelves, mostShelves(next));
  if (change.shelves !== undefined && shelves !== change.shelves) return null;
  return { ...next, shelves };
}

const FRONT: FaceIndex = faceIndex(1, -1);

interface Part {
  key: string;
  name: string;
  min: Vec3L;
  size: Vec3L;
  thicknessAxis: Axis;
  /** Which way the grain runs, before the cabinet is turned. */
  grain: Axis;
  banded: boolean;
}

/** The boards of a cabinet standing at the origin, unturned: x to the right, y toward the back, z up. */
function parts(cabinet: Cabinet): Part[] {
  const { width, height, depth, toeKick } = cabinet;
  const { thickness: t, backThickness, toeKickSetback, stretcherWidth, shelfGap, shelfSetback } = cabinet.build;
  const inner = width - 2 * t;
  /** Depth of the case without its back. */
  const caseDepth = depth - backThickness;
  const front = -depth;
  const top = height - t;
  const list: Part[] = [];

  const add = (
    key: string,
    name: string,
    min: Vec3L,
    size: Vec3L,
    thicknessAxis: Axis,
    grain: Axis,
    banded: boolean,
  ) => {
    if (size[0] > 0 && size[1] > 0 && size[2] > 0) list.push({ key, name, min, size, thicknessAxis, grain, banded });
  };

  add('side-left', 'Side', [0, front, 0], [t, caseDepth, height], 0, 2, true);
  add('side-right', 'Side', [width - t, front, 0], [t, caseDepth, height], 0, 2, true);
  add('bottom', 'Bottom', [t, front, toeKick], [inner, caseDepth, t], 2, 0, true);

  // A base cabinet is tied together at the top by two strips, since a countertop covers it.
  // Other cabinets, and base cabinets too shallow for two strips, get a full top.
  if (cabinet.kind === 'base' && caseDepth > 2 * stretcherWidth) {
    add('stretcher-front', 'Stretcher', [t, front, top], [inner, stretcherWidth, t], 2, 0, true);
    add('stretcher-back', 'Stretcher', [t, -backThickness - stretcherWidth, top], [inner, stretcherWidth, t], 2, 0, false);
  } else {
    add('top', 'Top', [t, front, top], [inner, caseDepth, t], 2, 0, true);
  }

  add('back', 'Back', [0, -backThickness, toeKick], [width, backThickness, height - toeKick], 1, 2, false);

  if (toeKick > 0) {
    // In a cabinet too shallow for the setback, the toe kick sits flush with the front.
    const setback = toeKickSetback + t <= caseDepth ? toeKickSetback : 0;
    add('toe-kick', 'Toe kick', [t, front + setback, 0], [inner, t, toeKick], 1, 0, false);
  }

  const count = Math.min(cabinet.shelves, mostShelves(cabinet));
  const floor = toeKick + t;
  const open = insideHeight(cabinet) - count * t;
  for (let index = 1; index <= count; index += 1) {
    // Equal openings between the bottom, each shelf, and the top.
    const z = floor + Math.round((open * index) / (count + 1)) + (index - 1) * t;
    add(
      `shelf-${index}`,
      'Shelf',
      [t + Math.round(shelfGap / 2), front + shelfSetback, z],
      [inner - shelfGap, caseDepth - shelfSetback, t],
      2,
      0,
      true,
    );
  }
  return list;
}

const boardCache = new WeakMap<Cabinet, readonly Board[]>();

/** The id of the cabinet a board id belongs to, or the id itself for a board that stands alone. */
export function ownerId(boardId: string): string {
  const slash = boardId.indexOf('/');
  return slash < 0 ? boardId : boardId.slice(0, slash);
}

/** The boards a cabinet is made of, where it stands. The same cabinet always gives the very same boards. */
export function cabinetBoards(cabinet: Cabinet): readonly Board[] {
  const cached = boardCache.get(cabinet);
  if (cached) return cached;
  const { position, turns, materialId } = cabinet;
  const boards = parts(cabinet).map((part) => {
    const placed: Board = {
      id: `${cabinet.id}/${part.key}`,
      name: part.name,
      min: [position[0] + part.min[0], position[1] + part.min[1], position[2] + part.min[2]],
      size: part.size,
      thicknessAxis: part.thicknessAxis,
      materialId,
      grain: part.grain,
      banding: part.banded ? [FRONT] : undefined,
      cabinetId: cabinet.id,
    };
    return turns === 0 ? tidyBoard(placed) : rotateBoardQuarter(placed, position, 2, turns);
  });
  boardCache.set(cabinet, boards);
  return boards;
}

/** The box around a cabinet, where it stands. */
export function cabinetBox(cabinet: Cabinet): Box {
  const { position, turns, width, height, depth } = cabinet;
  const far: Vec3L = [position[0] + width, position[1] - depth, position[2] + height];
  return boxFromCorners(position, rotatePointQuarter(far, position, 2, turns));
}

/** The same cabinet, sized and placed to fill a box. The box must be the right way round for how it is turned. */
function cabinetInBox(cabinet: Cabinet, box: Box): Cabinet {
  // Where the cabinet's right and its front point, in the model.
  const right = rotatePointQuarter([1, 0, 0], [0, 0, 0], 2, cabinet.turns);
  const front = rotatePointQuarter([0, -1, 0], [0, 0, 0], 2, cabinet.turns);
  const sideways = cabinet.turns % 2 === 1;
  // The cabinet grows away from its back left corner, so that corner is at the low end of an axis it grows up.
  const corner = (axis: 0 | 1) =>
    right[axis] + front[axis] > 0 ? box.min[axis] : box.min[axis] + box.size[axis];
  return {
    ...cabinet,
    position: [corner(0), corner(1), box.min[2]],
    width: box.size[sideways ? 1 : 0],
    depth: box.size[sideways ? 0 : 1],
    height: box.size[2],
  };
}

/** The smallest a cabinet can be along one axis of the model. */
export function smallestAlong(cabinet: Cabinet, axis: Axis): Length {
  const least = smallestSize(cabinet);
  if (axis === 2) return least.height;
  const sideways = cabinet.turns % 2 === 1;
  return (axis === 0) !== sideways ? least.width : least.depth;
}

/**
 * Moves one outside face of a cabinet outward by a distance, or inward when
 * it is negative. The opposite face stays put, and the cabinet never gets
 * smaller than it can be built.
 */
export function pullCabinet(cabinet: Cabinet, axis: Axis, sign: 1 | -1, distance: Length): Cabinet {
  const box = cabinetBox(cabinet);
  const size = Math.min(Math.max(box.size[axis] + distance, smallestAlong(cabinet, axis)), LARGEST_SIZE);
  const min = sign > 0 ? box.min[axis] : box.min[axis] + box.size[axis] - size;
  const next = cabinetInBox(cabinet, { min: withAxis(box.min, axis, min), size: withAxis(box.size, axis, size) });
  return { ...next, shelves: Math.min(next.shelves, mostShelves(next)) };
}

export function moveCabinet(cabinet: Cabinet, delta: Vec3L): Cabinet {
  const { position } = cabinet;
  return { ...cabinet, position: [position[0] + delta[0], position[1] + delta[1], position[2] + delta[2]] };
}

/** Turns a cabinet about an upright line through a point, in quarter turns. */
export function turnCabinet(cabinet: Cabinet, pivot: Vec3L, turns: number): Cabinet {
  return {
    ...cabinet,
    position: rotatePointQuarter(cabinet.position, pivot, 2, turns),
    turns: ((((cabinet.turns + turns) % 4) + 4) % 4) as Cabinet['turns'],
  };
}

/** "Base 1", "Base 2", and so on, never reusing a number still in the model. */
export function nextCabinetName(cabinets: readonly Cabinet[], kind: CabinetKind): string {
  const label = CABINET_KIND_NAMES[kind];
  let highest = 0;
  for (const cabinet of cabinets) {
    const match = new RegExp(`^${label} (\\d+)$`).exec(cabinet.name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `${label} ${highest + 1}`;
}

/** True for a name the app gave, as opposed to one typed by hand. */
export function isUsualCabinetName(cabinet: Cabinet): boolean {
  return new RegExp(`^${CABINET_KIND_NAMES[cabinet.kind]} \\d+$`).test(cabinet.name);
}

function isLength(value: unknown, least: number): value is Length {
  return Number.isSafeInteger(value) && (value as number) >= least;
}

/** Checks a saved cabinet. Returns null for anything that could not be built. */
export function parseCabinet(value: unknown, materialIds: ReadonlySet<string>, fallbackMaterialId: string): Cabinet | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || raw.id.includes('/') || typeof raw.name !== 'string') return null;
  const kind = CABINET_KINDS.find((candidate) => candidate === raw.kind);
  if (!kind) return null;
  const position = raw.position;
  if (!Array.isArray(position) || position.length !== 3 || !position.every((n) => Number.isSafeInteger(n))) return null;
  if (raw.turns !== 0 && raw.turns !== 1 && raw.turns !== 2 && raw.turns !== 3) return null;
  const build = raw.build as Record<string, unknown> | null;
  if (!build || typeof build !== 'object') return null;
  if (!isLength(build.thickness, 1) || !isLength(build.backThickness, 1)) return null;
  if (!isLength(build.toeKickSetback, 0) || !isLength(build.stretcherWidth, 1)) return null;
  if (!isLength(build.shelfGap, 0) || !isLength(build.shelfSetback, 0)) return null;
  if (!isLength(raw.width, 1) || !isLength(raw.height, 1) || !isLength(raw.depth, 1)) return null;
  if (!isLength(raw.toeKick, 0) || !isLength(raw.shelves, 0)) return null;

  const cabinet: Cabinet = {
    id: raw.id,
    name: raw.name,
    kind,
    position: [position[0] as Length, position[1] as Length, position[2] as Length],
    turns: raw.turns,
    width: raw.width,
    height: raw.height,
    depth: raw.depth,
    toeKick: raw.toeKick,
    shelves: raw.shelves,
    materialId: typeof raw.materialId === 'string' && materialIds.has(raw.materialId) ? raw.materialId : fallbackMaterialId,
    build: {
      thickness: build.thickness,
      backThickness: build.backThickness,
      toeKickSetback: build.toeKickSetback,
      stretcherWidth: build.stretcherWidth,
      shelfGap: build.shelfGap,
      shelfSetback: build.shelfSetback,
    },
  };
  // Run the sizes through the same checks as a size typed in the app.
  return resizeCabinet(cabinet, { shelves: Math.min(cabinet.shelves, mostShelves(cabinet)) });
}
