import type { Board } from './board';
import type { Axis, Vec3L } from './vec';

/** Bump when the saved shape changes, and add a migration in `parseDocument`. */
export const DOCUMENT_VERSION = 1;

export interface CabbageDocument {
  version: typeof DOCUMENT_VERSION;
  boards: readonly Board[];
}

export const EMPTY_DOCUMENT: CabbageDocument = { version: DOCUMENT_VERSION, boards: [] };

export function createId(): string {
  return `b_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

export function addBoards(document: CabbageDocument, boards: readonly Board[]): CabbageDocument {
  return { ...document, boards: [...document.boards, ...boards] };
}

export function removeBoards(document: CabbageDocument, ids: ReadonlySet<string>): CabbageDocument {
  return { ...document, boards: document.boards.filter((board) => !ids.has(board.id)) };
}

export function replaceBoard(document: CabbageDocument, board: Board): CabbageDocument {
  return { ...document, boards: document.boards.map((other) => (other.id === board.id ? board : other)) };
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
  return { version: DOCUMENT_VERSION, boards };
}
