import { boxCorners } from '../core/board';
import { ownerId } from '../core/cabinet';
import { modelBoards } from '../core/document';
import type { Editor } from '../core/editor';
import { guideUnderCursor, toMillimeters } from '../inference/inference';
import { ownerUnder } from './pick';
import { dragged } from './steps';
import { NO_PREVIEW, type ScreenRect, type Tool, type ToolPointer, type ToolPreview } from './tool';

const HINT =
  'Click a board, cabinet, or guide to select it. Shift-click adds or removes. Drag a box to select several. Delete removes them.';

interface Press {
  x: number;
  y: number;
  shiftKey: boolean;
  /** What was selected when the button went down, for a Shift-drag to add to. */
  before: ReadonlySet<string>;
  rect: ScreenRect | null;
}

/**
 * Picks boards, cabinets, and guides. Click selects one, Shift-click adds or
 * removes, and a click on nothing clears. Dragging draws a box: to the right
 * it selects what is entirely inside, to the left anything it touches. A
 * cabinet is picked as a whole, by any of its boards.
 */
export class SelectTool implements Tool {
  readonly id = 'select' as const;

  private press: Press | null = null;

  constructor(private readonly editor: Editor) {}

  activate(): void {
    this.press = null;
    this.editor.setHint(HINT);
  }

  deactivate(): void {
    this.press = null;
    this.editor.setHovered(null);
  }

  pointerMove(pointer: ToolPointer): void {
    const press = this.press;
    if (!press) {
      this.editor.setHovered(this.itemUnder(pointer));
      return;
    }
    const { x, y } = pointer.view.cursor;
    if (!press.rect && !dragged(press, { x, y })) return;
    press.rect = { x0: press.x, y0: press.y, x1: x, y1: y, crossing: x < press.x };
    this.editor.setHovered(null);
    this.editor.setSelection(this.boxed(press, pointer));
  }

  pointerDown(pointer: ToolPointer): void {
    const { cursor } = pointer.view;
    this.press = {
      x: cursor.x,
      y: cursor.y,
      shiftKey: pointer.shiftKey,
      before: this.editor.getState().selection,
      rect: null,
    };
    const id = this.itemUnder(pointer);
    if (id && pointer.shiftKey) this.editor.toggleSelected(id);
    else if (id) this.editor.setSelection([id]);
    else if (!pointer.shiftKey) this.editor.setSelection([]);
  }

  pointerUp(): void {
    this.press = null;
  }

  pointerLeave(): void {
    this.editor.setHovered(null);
  }

  keyDown(): boolean {
    return false;
  }

  acceptsMeasurement(): boolean {
    return false;
  }

  applyMeasurement(): boolean {
    return false;
  }

  cancel(): boolean {
    if (this.press?.rect) {
      this.editor.setSelection(this.press.before);
      this.press = null;
      return true;
    }
    if (this.editor.getState().selection.size === 0) return false;
    this.editor.setSelection([]);
    return true;
  }

  busy(): boolean {
    return false;
  }

  refresh(): void {}

  preview(): ToolPreview {
    const rect = this.press?.rect;
    return rect ? { ...NO_PREVIEW, rect } : NO_PREVIEW;
  }

  /** The guide, board, or cabinet under the cursor. A guide is thin, so it gets first claim. */
  private itemUnder(pointer: ToolPointer): string | null {
    const guide = guideUnderCursor(this.editor.getState().document.guides, pointer.view);
    if (guide) return guide.id;
    return ownerUnder(this.editor, pointer);
  }

  /** What a dragged box selects, added to what was selected before when Shift is held. */
  private boxed(press: Press, pointer: ToolPointer): string[] {
    const rect = press.rect!;
    const left = Math.min(rect.x0, rect.x1);
    const right = Math.max(rect.x0, rect.x1);
    const top = Math.min(rect.y0, rect.y1);
    const bottom = Math.max(rect.y0, rect.y1);
    const ids = new Set(press.shiftKey ? press.before : []);
    // A cabinet is inside the box when all of its boards are, and touched by it when any of them is.
    const inside = new Map<string, boolean>();
    const touching = new Set<string>();

    for (const board of modelBoards(this.editor.getState().document)) {
      const owner = ownerId(board.id);
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let visible = true;
      for (const corner of boxCorners(board)) {
        const at = pointer.view.project(toMillimeters(corner));
        if (!at) {
          visible = false;
          break;
        }
        minX = Math.min(minX, at.x);
        maxX = Math.max(maxX, at.x);
        minY = Math.min(minY, at.y);
        maxY = Math.max(maxY, at.y);
      }
      if (!visible) {
        inside.set(owner, false);
        continue;
      }
      const within = minX >= left && maxX <= right && minY >= top && maxY <= bottom;
      inside.set(owner, within && (inside.get(owner) ?? true));
      if (maxX >= left && minX <= right && maxY >= top && minY <= bottom) touching.add(owner);
    }
    if (rect.crossing) for (const owner of touching) ids.add(owner);
    else for (const [owner, within] of inside) if (within) ids.add(owner);
    return [...ids];
  }
}
