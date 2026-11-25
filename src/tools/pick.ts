import type { Board } from '../core/board';
import type { Editor } from '../core/editor';
import { firstSurfaceHit, type Snap } from '../inference/inference';
import type { ToolPointer } from './tool';

/** True for a point along an edge or a guide, which is free in one direction. */
export function onLine(snap: Snap): boolean {
  return snap.kind === 'edge' || snap.kind === 'guide';
}

/** True for a snap to something definite, as opposed to a bare spot on a face or the floor. */
export function isDefinite(snap: Snap): boolean {
  return snap.kind !== 'face' && snap.kind !== 'floor' && snap.kind !== 'free';
}

export function selectedBoards(editor: Editor): Board[] {
  const { document, selection } = editor.getState();
  return document.boards.filter((board) => selection.has(board.id));
}

/**
 * The boards an editing tool should act on when it is clicked: the selection
 * if there is one, otherwise the board under the cursor, which then becomes
 * the selection.
 */
export function boardsToEdit(editor: Editor, pointer: ToolPointer, snap: Snap | null): Board[] {
  const selected = selectedBoards(editor);
  if (selected.length > 0) return selected;
  const { boards } = editor.getState().document;
  const id = firstSurfaceHit(boards, pointer.view.ray)?.board.id ?? snap?.boardId;
  const board = boards.find((candidate) => candidate.id === id);
  if (!board) return [];
  editor.setSelection([board.id]);
  return [board];
}

export function countLabel(verb: string, count: number): string {
  return count === 1 ? `${verb} board` : `${verb} ${count} boards`;
}
