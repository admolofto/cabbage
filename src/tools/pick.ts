import { ownerId } from '../core/cabinet';
import { modelBoards } from '../core/document';
import type { Editor } from '../core/editor';
import { pickedCount, pickedIn, type Picked } from '../core/picked';
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

/** The selected boards and cabinets. */
export function selectedPicked(editor: Editor): Picked {
  const { document, selection } = editor.getState();
  return pickedIn(document, selection);
}

/** What a click on a board selects: the board itself, or the cabinet it is part of. */
export function ownerUnder(editor: Editor, pointer: ToolPointer, snap?: Snap | null): string | null {
  const boards = modelBoards(editor.getState().document);
  const id = firstSurfaceHit(boards, pointer.view.ray)?.board.id ?? snap?.boardId;
  return id === undefined ? null : ownerId(id);
}

/**
 * The boards and cabinets an editing tool should act on when it is clicked:
 * the selection if there is one, otherwise whatever is under the cursor,
 * which then becomes the selection.
 */
export function pickToEdit(editor: Editor, pointer: ToolPointer, snap: Snap | null): Picked {
  const selected = selectedPicked(editor);
  if (pickedCount(selected) > 0) return selected;
  const owner = ownerUnder(editor, pointer, snap);
  const picked = pickedIn(editor.getState().document, new Set(owner === null ? [] : [owner]));
  if (pickedCount(picked) > 0) editor.setSelection([owner!]);
  return picked;
}
