import { tidyBoard, type Board, type FaceIndex } from './board';
import { cabinetBoards, parseCabinet, type Cabinet } from './cabinet';
import { createId } from './id';
import { DEFAULT_MATERIAL_ID, BUILT_IN_MATERIALS, parseMaterial, type Material } from './materials';
import type { Axis, Vec3L } from './vec';

export { createId };

/**
 * Bump when the saved shape changes, and teach `parseDocument` to read the
 * older shape too, so files and browser saves from earlier versions keep opening.
 *
 * 1: boards and guides. 2: adds the project name, materials, grain, and edge banding.
 * 3: adds cabinets.
 */
export const DOCUMENT_VERSION = 3;

const OLDER_VERSIONS: readonly unknown[] = [1, 2];

export const DEFAULT_PROJECT_NAME = 'Untitled';

/**
 * A guide: an endless construction line along one axis. It is never cut or
 * listed. It exists only to be snapped to.
 */
export interface Guide {
  id: string;
  /** The axis the line runs along. */
  axis: Axis;
  /** A point on the line. Its coordinate along `axis` is always zero. */
  through: Vec3L;
}

export interface CabbageDocument {
  version: typeof DOCUMENT_VERSION;
  /** The project's name, which is also what its file is called. */
  name: string;
  /** Boards that stand alone. The boards cabinets are made of are not kept here. See `modelBoards`. */
  boards: readonly Board[];
  cabinets: readonly Cabinet[];
  guides: readonly Guide[];
  /** Materials this project added to the built-in ones. */
  materials: readonly Material[];
}

export const EMPTY_DOCUMENT: CabbageDocument = {
  version: DOCUMENT_VERSION,
  name: DEFAULT_PROJECT_NAME,
  boards: [],
  cabinets: [],
  guides: [],
  materials: [],
};

const solidCache = new WeakMap<CabbageDocument, readonly Board[]>();

/**
 * Every board in the model: the ones that stand alone, then the ones each
 * cabinet is made of. This is what gets drawn, snapped to, and listed for
 * cutting. The same model always gives the very same list.
 */
export function modelBoards(document: CabbageDocument): readonly Board[] {
  if (document.cabinets.length === 0) return document.boards;
  let boards = solidCache.get(document);
  if (!boards) {
    boards = [...document.boards, ...document.cabinets.flatMap(cabinetBoards)];
    solidCache.set(document, boards);
  }
  return boards;
}

/** A project name fit for a title and a file name. Empty names fall back to the default. */
export function cleanProjectName(name: string): string {
  // Characters a file name cannot hold are dropped, since the name becomes one.
  const cleaned = name.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return cleaned === '' ? DEFAULT_PROJECT_NAME : cleaned;
}

export function createGuide(axis: Axis, through: Vec3L): Guide {
  const point: [number, number, number] = [through[0], through[1], through[2]];
  point[axis] = 0;
  return { id: createId('g'), axis, through: point };
}

export function addBoards(document: CabbageDocument, boards: readonly Board[]): CabbageDocument {
  return { ...document, boards: [...document.boards, ...boards] };
}

/** Removes boards, cabinets, and guides by id. */
export function removeItems(document: CabbageDocument, ids: ReadonlySet<string>): CabbageDocument {
  return {
    ...document,
    boards: document.boards.filter((board) => !ids.has(board.id)),
    cabinets: document.cabinets.filter((cabinet) => !ids.has(cabinet.id)),
    guides: document.guides.filter((guide) => !ids.has(guide.id)),
  };
}

export function addCabinets(document: CabbageDocument, cabinets: readonly Cabinet[]): CabbageDocument {
  return { ...document, cabinets: [...document.cabinets, ...cabinets] };
}

/** Swaps in new versions of cabinets already in the model, matched by id. */
export function replaceCabinets(document: CabbageDocument, cabinets: readonly Cabinet[]): CabbageDocument {
  const byId = new Map(cabinets.map((cabinet) => [cabinet.id, cabinet]));
  return { ...document, cabinets: document.cabinets.map((cabinet) => byId.get(cabinet.id) ?? cabinet) };
}

/** Applies a change to some cabinets, by id. Cabinets the change leaves alone stay the very same objects. */
export function updateCabinets(
  document: CabbageDocument,
  ids: ReadonlySet<string>,
  change: (cabinet: Cabinet) => Cabinet,
): CabbageDocument {
  let changed = false;
  const cabinets = document.cabinets.map((cabinet) => {
    if (!ids.has(cabinet.id)) return cabinet;
    const next = change(cabinet);
    if (next !== cabinet) changed = true;
    return next;
  });
  return changed ? { ...document, cabinets } : document;
}

export function replaceBoard(document: CabbageDocument, board: Board): CabbageDocument {
  return replaceBoards(document, [board]);
}

/** Swaps in new versions of boards already in the model, matched by id. */
export function replaceBoards(document: CabbageDocument, boards: readonly Board[]): CabbageDocument {
  const byId = new Map(boards.map((board) => [board.id, board]));
  return { ...document, boards: document.boards.map((board) => byId.get(board.id) ?? board) };
}

/** Applies a change to some boards, by id. Boards the change leaves alone stay the very same objects. */
export function updateBoards(
  document: CabbageDocument,
  ids: ReadonlySet<string>,
  change: (board: Board) => Board,
): CabbageDocument {
  let changed = false;
  const boards = document.boards.map((board) => {
    if (!ids.has(board.id)) return board;
    const next = change(board);
    if (next !== board) changed = true;
    return next;
  });
  return changed ? { ...document, boards } : document;
}

export function addGuides(document: CabbageDocument, guides: readonly Guide[]): CabbageDocument {
  return { ...document, guides: [...document.guides, ...guides] };
}

export function replaceGuide(document: CabbageDocument, guide: Guide): CabbageDocument {
  return { ...document, guides: document.guides.map((other) => (other.id === guide.id ? guide : other)) };
}

/** "Board 1", "Board 2", and so on, never reusing a number still in the model. */
export function nextBoardName(document: CabbageDocument): string {
  let highest = 0;
  for (const board of document.boards) {
    const match = /^Board (\d+)$/.exec(board.name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Board ${highest + 1}`;
}

function isLengthTriple(value: unknown, positive: boolean): value is Vec3L {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((n) => Number.isSafeInteger(n) && (!positive || (n as number) > 0))
  );
}

function isAxis(value: unknown): value is Axis {
  return value === 0 || value === 1 || value === 2;
}

function isFaceIndex(value: unknown): value is FaceIndex {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 5;
}

function parseBoard(value: unknown, materialIds: ReadonlySet<string>): Board | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  // A slash in an id marks a board that belongs to a cabinet, which is never saved on its own.
  if (typeof raw.id !== 'string' || raw.id.includes('/') || typeof raw.name !== 'string') return null;
  if (!isLengthTriple(raw.min, false) || !isLengthTriple(raw.size, true)) return null;
  if (!isAxis(raw.thicknessAxis)) return null;
  // Boards saved before materials existed, or naming one that is gone, are plain plywood.
  const materialId =
    typeof raw.materialId === 'string' && materialIds.has(raw.materialId) ? raw.materialId : DEFAULT_MATERIAL_ID;
  return tidyBoard({
    id: raw.id,
    name: raw.name,
    min: [raw.min[0], raw.min[1], raw.min[2]],
    size: [raw.size[0], raw.size[1], raw.size[2]],
    thicknessAxis: raw.thicknessAxis,
    materialId,
    grain: isAxis(raw.grain) ? raw.grain : undefined,
    banding: Array.isArray(raw.banding) ? raw.banding.filter(isFaceIndex) : undefined,
  });
}

function parseGuide(value: unknown): Guide | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !isLengthTriple(raw.through, false)) return null;
  if (raw.axis !== 0 && raw.axis !== 1 && raw.axis !== 2) return null;
  return { ...createGuide(raw.axis, raw.through), id: raw.id };
}

/**
 * Checks a loaded value and returns it as a document, or null when it is not
 * one. Nothing outside this function should trust saved data.
 */
export function parseDocument(value: unknown): CabbageDocument | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (raw.version !== DOCUMENT_VERSION && !OLDER_VERSIONS.includes(raw.version)) return null;
  if (!Array.isArray(raw.boards)) return null;

  const materials: Material[] = [];
  const materialIds = new Set(BUILT_IN_MATERIALS.map((material) => material.id));
  for (const entry of Array.isArray(raw.materials) ? raw.materials : []) {
    const material = parseMaterial(entry);
    if (!material || materialIds.has(material.id)) return null;
    materialIds.add(material.id);
    materials.push(material);
  }

  const boards: Board[] = [];
  const seen = new Set<string>();
  for (const entry of raw.boards) {
    const board = parseBoard(entry, materialIds);
    if (!board || seen.has(board.id)) return null;
    seen.add(board.id);
    boards.push(board);
  }
  // Models saved before cabinets existed simply have none. The same goes for guides.
  const cabinets: Cabinet[] = [];
  for (const entry of Array.isArray(raw.cabinets) ? raw.cabinets : []) {
    const cabinet = parseCabinet(entry, materialIds, DEFAULT_MATERIAL_ID);
    if (!cabinet || seen.has(cabinet.id)) return null;
    seen.add(cabinet.id);
    cabinets.push(cabinet);
  }
  const guides: Guide[] = [];
  for (const entry of Array.isArray(raw.guides) ? raw.guides : []) {
    const guide = parseGuide(entry);
    if (!guide || seen.has(guide.id)) return null;
    seen.add(guide.id);
    guides.push(guide);
  }
  const name = cleanProjectName(typeof raw.name === 'string' ? raw.name : '');
  return { version: DOCUMENT_VERSION, name, boards, cabinets, guides, materials };
}

/** Marks a saved file as a Cabbage project, so opening the wrong kind of file can be told apart. */
const FILE_MARK = 'cabbage';

/** The text of a project file. */
export function serializeDocument(document: CabbageDocument): string {
  return `${JSON.stringify({ app: FILE_MARK, ...document }, null, 2)}\n`;
}

/** Reads the text of a project file. Returns null when it is not a Cabbage project. */
export function deserializeDocument(text: string): CabbageDocument | null {
  try {
    return parseDocument(JSON.parse(text));
  } catch {
    return null;
  }
}
