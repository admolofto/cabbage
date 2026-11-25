import type { Board } from './board';
import type { Axis, Vec3L } from './vec';

/** Bump when the saved shape changes, and add a migration in `parseDocument`. */
export const DOCUMENT_VERSION = 1;

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
  boards: readonly Board[];
  guides: readonly Guide[];
}

export const EMPTY_DOCUMENT: CabbageDocument = { version: DOCUMENT_VERSION, boards: [], guides: [] };

export function createId(prefix = 'b'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function createGuide(axis: Axis, through: Vec3L): Guide {
  const point: [number, number, number] = [through[0], through[1], through[2]];
  point[axis] = 0;
  return { id: createId('g'), axis, through: point };
}

export function addBoards(document: CabbageDocument, boards: readonly Board[]): CabbageDocument {
  return { ...document, boards: [...document.boards, ...boards] };
}

/** Removes boards and guides by id. */
export function removeItems(document: CabbageDocument, ids: ReadonlySet<string>): CabbageDocument {
  return {
    ...document,
    boards: document.boards.filter((board) => !ids.has(board.id)),
    guides: document.guides.filter((guide) => !ids.has(guide.id)),
  };
}

export function replaceBoard(document: CabbageDocument, board: Board): CabbageDocument {
  return replaceBoards(document, [board]);
}

/** Swaps in new versions of boards already in the model, matched by id. */
export function replaceBoards(document: CabbageDocument, boards: readonly Board[]): CabbageDocument {
  const byId = new Map(boards.map((board) => [board.id, board]));
  return { ...document, boards: document.boards.map((board) => byId.get(board.id) ?? board) };
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

function parseBoard(value: unknown): Board | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
  if (!isLengthTriple(raw.min, false) || !isLengthTriple(raw.size, true)) return null;
  if (raw.thicknessAxis !== 0 && raw.thicknessAxis !== 1 && raw.thicknessAxis !== 2) return null;
  return {
    id: raw.id,
    name: raw.name,
    min: [raw.min[0], raw.min[1], raw.min[2]],
    size: [raw.size[0], raw.size[1], raw.size[2]],
    thicknessAxis: raw.thicknessAxis as Axis,
  };
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
  if (raw.version !== DOCUMENT_VERSION || !Array.isArray(raw.boards)) return null;
  const boards: Board[] = [];
  const seen = new Set<string>();
  for (const entry of raw.boards) {
    const board = parseBoard(entry);
    if (!board || seen.has(board.id)) return null;
    seen.add(board.id);
    boards.push(board);
  }
  // Models saved before guides existed simply have none.
  const guides: Guide[] = [];
  for (const entry of Array.isArray(raw.guides) ? raw.guides : []) {
    const guide = parseGuide(entry);
    if (!guide || seen.has(guide.id)) return null;
    seen.add(guide.id);
    guides.push(guide);
  }
  return { version: DOCUMENT_VERSION, boards, guides };
}
