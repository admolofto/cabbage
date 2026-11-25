import type { Editor } from '../core/editor';
import { firstSurfaceHit } from '../inference/inference';
import { NO_PREVIEW, type Tool, type ToolPointer, type ToolPreview } from './tool';

const HINT = 'Click a board to select it. Shift-click adds or removes. Delete removes the selection.';

/** Picks boards. Click selects one, Shift-click adds or removes, and a click on nothing clears. */
export class SelectTool implements Tool {
  readonly id = 'select' as const;

  constructor(private readonly editor: Editor) {}

  activate(): void {
    this.editor.setHint(HINT);
  }

  deactivate(): void {
    this.editor.setHovered(null);
  }

  pointerMove(pointer: ToolPointer): void {
    this.editor.setHovered(this.boardUnder(pointer));
  }

  pointerDown(pointer: ToolPointer): void {
    const id = this.boardUnder(pointer);
    if (id && pointer.shiftKey) this.editor.toggleSelected(id);
    else if (id) this.editor.setSelection([id]);
    else if (!pointer.shiftKey) this.editor.setSelection([]);
  }

  pointerUp(): void {}

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
    if (this.editor.getState().selection.size === 0) return false;
    this.editor.setSelection([]);
    return true;
  }

  busy(): boolean {
    return false;
  }

  refresh(): void {}

  preview(): ToolPreview {
    return NO_PREVIEW;
  }

  private boardUnder(pointer: ToolPointer): string | null {
    const { boards } = this.editor.getState().document;
    return firstSurfaceHit(boards, pointer.view.ray)?.board.id ?? null;
  }
}
