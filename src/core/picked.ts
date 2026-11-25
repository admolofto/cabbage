import type { Board } from './board';
import {
  cabinetBoards,
  isUsualCabinetName,
  moveCabinet,
  nextCabinetName,
  turnCabinet,
  type Cabinet,
} from './cabinet';
import { replaceBoards, replaceCabinets, type CabbageDocument } from './document';
import { createId } from './id';
import { moveBoard, rotateBoardQuarter } from './transform';
import type { Axis, Vec3L } from './vec';

/**
 * The things an edit applies to: boards that stand alone, and whole cabinets.
 * Moving, copying, and turning work the same way on both, so the tools deal
 * in these and never need to know which is which.
 */
export interface Picked {
  boards: readonly Board[];
  cabinets: readonly Cabinet[];
}

/** The boards and cabinets among a set of ids. Guides are left out. */
export function pickedIn(document: CabbageDocument, ids: ReadonlySet<string>): Picked {
  return {
    boards: document.boards.filter((board) => ids.has(board.id)),
    cabinets: document.cabinets.filter((cabinet) => ids.has(cabinet.id)),
  };
}

export function pickedCount(picked: Picked): number {
  return picked.boards.length + picked.cabinets.length;
}

export function pickedIds(picked: Picked): string[] {
  return [...picked.boards, ...picked.cabinets].map((item) => item.id);
}

/** Every board involved: the ones picked, and the ones the picked cabinets are made of. */
export function pickedSolids(picked: Picked): Board[] {
  return [...picked.boards, ...picked.cabinets.flatMap(cabinetBoards)];
}

export function movePicked(picked: Picked, delta: Vec3L): Picked {
  return {
    boards: picked.boards.map((board) => moveBoard(board, delta)),
    cabinets: picked.cabinets.map((cabinet) => moveCabinet(cabinet, delta)),
  };
}

/** True when the picked things can turn about an axis. A cabinet only turns about the upright one. */
export function canTurn(picked: Picked, axis: Axis): boolean {
  return axis === 2 || picked.cabinets.length === 0;
}

/** Turns everything picked in quarter turns. Check `canTurn` first: a cabinet is left as it is about any other axis. */
export function turnPicked(picked: Picked, pivot: Vec3L, axis: Axis, turns: number): Picked {
  return {
    boards: picked.boards.map((board) => rotateBoardQuarter(board, pivot, axis, turns)),
    cabinets: axis === 2 ? picked.cabinets.map((cabinet) => turnCabinet(cabinet, pivot, turns)) : picked.cabinets,
  };
}

/** Swaps in new versions of things already in the model, matched by id. */
export function replacePicked(document: CabbageDocument, picked: Picked): CabbageDocument {
  let next = document;
  if (picked.boards.length > 0) next = replaceBoards(next, picked.boards);
  if (picked.cabinets.length > 0) next = replaceCabinets(next, picked.cabinets);
  return next;
}

/**
 * Adds copies to the model under ids of their own. A copied cabinet that
 * still has the name it was given, such as "Base 1", gets the next number.
 */
export function addCopies(document: CabbageDocument, picked: Picked): { document: CabbageDocument; ids: string[] } {
  const boards = picked.boards.map((board) => ({ ...board, id: createId() }));
  const cabinets = [...document.cabinets];
  const added: Cabinet[] = [];
  for (const cabinet of picked.cabinets) {
    const name = isUsualCabinetName(cabinet) ? nextCabinetName(cabinets, cabinet.kind) : cabinet.name;
    const copy = { ...cabinet, id: createId('c'), name };
    cabinets.push(copy);
    added.push(copy);
  }
  return {
    document: { ...document, boards: [...document.boards, ...boards], cabinets },
    ids: [...boards, ...added].map((item) => item.id),
  };
}

/** "Move board", "Move 3 boards", "Move cabinet", or "Move 4 items" for a mix. */
export function pickedLabel(verb: string, picked: Picked): string {
  const boards = picked.boards.length;
  const cabinets = picked.cabinets.length;
  if (boards > 0 && cabinets > 0) return `${verb} ${boards + cabinets} items`;
  const [count, one] = cabinets > 0 ? [cabinets, 'cabinet'] : [boards, 'board'];
  return count === 1 ? `${verb} ${one}` : `${verb} ${count} ${one}s`;
}
