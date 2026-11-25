import type { Editor, ToolId } from '../core/editor';
import { BoardTool } from './board-tool';
import { CabinetTool } from './cabinet-tool';
import { MoveTool } from './move-tool';
import { PullTool } from './pull-tool';
import { RotateTool } from './rotate-tool';
import { SelectTool } from './select-tool';
import { TapeTool } from './tape-tool';
import { NO_PREVIEW, type Tool, type ToolPointer, type ToolPreview } from './tool';

/** A key press, reduced to what matters here. `command` is Ctrl, or Cmd on a Mac. */
export interface KeyInput {
  key: string;
  command: boolean;
  shift: boolean;
  alt: boolean;
}

const TOOL_KEYS: Record<string, ToolId> = {
  ' ': 'select',
  b: 'board',
  c: 'cabinet',
  p: 'pull',
  m: 'move',
  r: 'rotate',
  t: 'tape',
  o: 'orbit',
  h: 'pan',
};

/** Keys that begin typed input for a tool. Once it has begun, any character is taken. */
const STARTS_MEASUREMENT = /^[0-9.,=/x*-]$/i;

/**
 * Owns the drawing tools and sends pointer and key input to whichever one is
 * active. Orbit and Pan are not tools here: the camera handles those itself.
 *
 * It also runs the typed measurement: digits typed while a tool can use them
 * collect in the measurement box, Enter applies them, and Escape drops them.
 */
export class ToolManager {
  private readonly tools: Partial<Record<ToolId, Tool>>;
  private activeId: ToolId;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly editor: Editor) {
    this.tools = {
      select: new SelectTool(editor),
      board: new BoardTool(editor),
      cabinet: new CabinetTool(editor),
      pull: new PullTool(editor),
      move: new MoveTool(editor),
      rotate: new RotateTool(editor),
      tape: new TapeTool(editor),
    };
    const state = editor.getState();
    this.activeId = state.tool;
    let units = state.units;
    let stock = state.stock;
    let cabinetKind = state.cabinetKind;
    this.active()?.activate();

    editor.subscribe(() => {
      const next = editor.getState();
      if (next.tool !== this.activeId) {
        const previous = this.active();
        this.activeId = next.tool;
        previous?.deactivate();
        this.active()?.activate();
        this.changed();
      }
      // What a tool is about to make depends on these, so it describes its step again when they change.
      if (next.units !== units || next.stock !== stock || next.cabinetKind !== cabinetKind) {
        units = next.units;
        stock = next.stock;
        cabinetKind = next.cabinetKind;
        this.active()?.refresh();
        this.changed();
      }
    });
  }

  /** Calls back whenever what the active tool wants drawn may have changed. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** The active drawing tool, or null while Orbit or Pan is picked. */
  active(): Tool | null {
    return this.tools[this.activeId] ?? null;
  }

  preview(): ToolPreview {
    return this.active()?.preview() ?? NO_PREVIEW;
  }

  pointerMove(pointer: ToolPointer): void {
    this.active()?.pointerMove(pointer);
    this.changed();
  }

  pointerDown(pointer: ToolPointer): void {
    // A click settles the step by hand, so anything half typed no longer applies.
    this.editor.setTyped(null);
    this.active()?.pointerDown(pointer);
    this.changed();
  }

  pointerUp(pointer: ToolPointer): void {
    this.active()?.pointerUp(pointer);
    this.changed();
  }

  pointerLeave(): void {
    this.active()?.pointerLeave();
    this.changed();
  }

  /** Applies whatever is in the measurement box. Returns false and marks the box when it cannot be read. */
  applyTyped(): boolean {
    const { typed } = this.editor.getState().measurement;
    if (typed === null) return false;
    const applied = this.active()?.applyMeasurement(typed) ?? false;
    this.editor.setTyped(applied ? null : typed, !applied);
    this.changed();
    return applied;
  }

  /** Handles a key press. Returns true when the key was used. */
  key(input: KeyInput): boolean {
    const used = this.handleKey(input);
    if (used) this.changed();
    return used;
  }

  private handleKey({ key, command, shift, alt }: KeyInput): boolean {
    const editor = this.editor;
    const tool = this.active();
    const lower = key.toLowerCase();

    // Ctrl on its own is a key for the tool, such as switching Move to copy.
    if (key === 'Control' || key === 'Meta') return tool?.keyDown('Control') ?? false;

    if (command) {
      if (lower === 'z' || lower === 'y') {
        editor.setTyped(null);
        if (lower === 'y' || shift) editor.redo();
        // Undo in the middle of drawing backs out of the drawing, not the board before it.
        else if (!(tool?.busy() && tool.cancel())) editor.undo();
        return true;
      }
      if (lower === 'a') {
        editor.setTool('select');
        const { boards, cabinets, guides } = editor.getState().document;
        editor.setSelection([...boards, ...cabinets, ...guides].map((item) => item.id));
        return true;
      }
      return false;
    }
    if (alt) return false;

    const { typed, error } = editor.getState().measurement;
    if (typed !== null) {
      // Text that was just turned down is replaced by the next thing typed, not added to.
      if (error && STARTS_MEASUREMENT.test(key)) {
        editor.setTyped(key);
        return true;
      }
      if (key === 'Enter') {
        this.applyTyped();
      } else if (key === 'Escape') {
        editor.setTyped(null);
      } else if (key === 'Backspace') {
        editor.setTyped(typed.length > 1 ? typed.slice(0, -1) : null);
      } else if (key.length === 1) {
        editor.setTyped(typed + key);
      } else {
        return false;
      }
      return true;
    }
    if (tool?.acceptsMeasurement() && STARTS_MEASUREMENT.test(key)) {
      editor.setTyped(key);
      return true;
    }

    if (key === 'Escape') return tool?.cancel() ?? false;
    if (key === 'Delete' || key === 'Backspace') return editor.deleteSelection();
    if (key === 'Enter' || key.startsWith('Arrow')) return tool?.keyDown(key) ?? false;

    const toolForKey = TOOL_KEYS[lower];
    if (toolForKey) {
      editor.setTool(toolForKey);
      return true;
    }
    return false;
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }
}
