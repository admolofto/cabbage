import { ownerId } from '../core/cabinet';
import { modelBoards, type CabbageDocument } from '../core/document';
import type { Editor } from '../core/editor';
import { parseLength } from '../core/parse-length';
import {
  addCopies,
  movePicked,
  pickedCount,
  pickedLabel,
  pickedSolids,
  replacePicked,
  type Picked,
} from '../core/picked';
import { isZeroVec, scaleVec, subtractVec, vecLength } from '../core/transform';
import { AXES, addVec, withAxis, type Axis, type Vec3L } from '../core/vec';
import { findAxisInference, findSnap, pointOnPlane } from '../inference/inference';
import { isDefinite, onLine, pickToEdit, selectedPicked } from './pick';
import { dragged, formatSize, roundAlong } from './steps';
import {
  NO_PREVIEW,
  axisMarker,
  markerFor,
  type SnapMarker,
  type Tool,
  type ToolPointer,
  type ToolPreview,
} from './tool';

/**
 * Moves or copies boards and cabinets: click a point to pick them up, click
 * where that point goes. With nothing selected it moves what was clicked.
 *
 * Free movement stays level: it slides in the horizontal plane through the
 * grabbed point, follows an axis when the cursor heads along one, and goes
 * exactly to any corner, midpoint, edge, or guide it reaches. Arrow keys lock
 * an axis and Ctrl switches between moving and copying.
 */

interface Moving {
  picked: Picked;
  start: Vec3L;
  end: Vec3L;
  /** An axis locked with the arrow keys. */
  arrowAxis: Axis | null;
  /** An axis held with Shift. */
  shiftAxis: Axis | null;
  /** The axis the movement is following right now, locked or not. */
  following: Axis | null;
  /** Which way the cursor is heading along a locked axis, for typed distances when a snap holds the end at the start. */
  heading: Vec3L | null;
  copy: boolean;
  pressedAt: { x: number; y: number } | null;
}

/** The move just made, kept so typed text can still correct or repeat it. */
interface LastMove {
  picked: Picked;
  delta: Vec3L;
  copy: boolean;
  /** How many copies, and whether they divide the distance instead of repeating it. */
  count: number;
  divided: boolean;
  before: CabbageDocument;
  after: CabbageDocument;
}

const HINTS = {
  idle: 'Click a point on a board or cabinet to pick it up. Select several first to move them together.',
  moving: 'Click where it goes, or type a distance. Arrow keys lock an axis. Ctrl makes a copy.',
  copied: 'Type 3x to repeat the copy 3 times, or /3 to space 3 copies evenly up to here.',
} as const;

const ARROW_AXES: Record<string, Axis | null> = { ArrowRight: 0, ArrowLeft: 1, ArrowUp: 2, ArrowDown: null };

/** The single axis a movement runs along, or null when it runs along none or several. */
function axisOf(delta: Vec3L): Axis | null {
  const moving = AXES.filter((axis) => delta[axis] !== 0);
  return moving.length === 1 ? moving[0]! : null;
}

/** Stretches a movement to a given length, keeping its direction. */
function withLength(delta: Vec3L, length: number): Vec3L | null {
  const current = Math.hypot(delta[0], delta[1], delta[2]);
  return current === 0 ? null : scaleVec(delta, length / current);
}

export class MoveTool implements Tool {
  readonly id = 'move' as const;

  private moving: Moving | null = null;
  private marker: SnapMarker | null = null;
  private lastPointer: ToolPointer | null = null;
  private last: LastMove | null = null;

  constructor(private readonly editor: Editor) {}

  activate(): void {
    this.reset();
  }

  deactivate(): void {
    this.reset();
    this.editor.setHovered(null);
    this.lastPointer = null;
  }

  pointerMove(pointer: ToolPointer): void {
    this.lastPointer = pointer;
    if (this.moving) this.track(this.moving, pointer);
    else this.hoverAt(pointer);
    this.report();
  }

  pointerDown(pointer: ToolPointer): void {
    this.pointerMove(pointer);
    if (this.moving) {
      this.finish(this.moving);
    } else {
      const { document } = this.editor.getState();
      const snap = findSnap(modelBoards(document), pointer.view, undefined, document.guides);
      if (!snap) return;
      const picked = pickToEdit(this.editor, pointer, snap);
      if (pickedCount(picked) === 0) return;
      this.last = null;
      this.editor.setHovered(null);
      this.moving = {
        picked,
        start: snap.point,
        end: snap.point,
        arrowAxis: null,
        shiftAxis: null,
        following: null,
        heading: null,
        copy: false,
        pressedAt: { ...pointer.view.cursor },
      };
    }
    this.report();
  }

  pointerUp(pointer: ToolPointer): void {
    const moving = this.moving;
    if (!moving?.pressedAt) return;
    const wasDragged = dragged(moving.pressedAt, pointer.view.cursor);
    moving.pressedAt = null;
    // Press, drag, and release moves in one motion, the same as two clicks.
    if (wasDragged) {
      this.track(moving, pointer);
      this.finish(moving);
      this.report();
    }
  }

  pointerLeave(): void {
    if (!this.moving) {
      this.marker = null;
      this.editor.setHovered(null);
    }
  }

  keyDown(key: string): boolean {
    const moving = this.moving;
    if (!moving) return false;
    if (key === 'Control') {
      moving.copy = !moving.copy;
    } else if (key in ARROW_AXES) {
      const axis = ARROW_AXES[key]!;
      // Pressing the same arrow again releases the lock.
      moving.arrowAxis = axis === null || moving.arrowAxis === axis ? null : axis;
    } else {
      return false;
    }
    if (this.lastPointer) this.track(moving, this.lastPointer);
    this.report();
    return true;
  }

  acceptsMeasurement(): boolean {
    return this.moving !== null || this.correctable() !== null;
  }

  applyMeasurement(text: string): boolean {
    const { units } = this.editor.getState();
    const moving = this.moving;
    const repeat = /^(?:[x*]\s*(\d+)|(\d+)\s*[x*])$/i.exec(text.trim());
    const divide = /^\/\s*(\d+)$/.exec(text.trim());

    if (moving) {
      if (repeat || divide) return false;
      const distance = parseLength(text, units.system);
      const travelled = subtractVec(moving.end, moving.start);
      const direction = isZeroVec(travelled) ? moving.heading : travelled;
      const delta = distance === null || !direction ? null : withLength(direction, distance);
      if (!delta || isZeroVec(delta)) return false;
      moving.end = addVec(moving.start, delta);
      this.finish(moving);
      this.report();
      return true;
    }

    const last = this.correctable();
    if (!last) return false;
    let next: LastMove;
    if (repeat || divide) {
      const count = Number(repeat ? (repeat[1] ?? repeat[2]) : divide![1]);
      if (!last.copy || count < 1 || count > 200) return false;
      next = { ...last, count, divided: divide !== null };
    } else {
      const distance = parseLength(text, units.system);
      const delta = distance === null ? null : withLength(last.delta, distance);
      if (!delta || isZeroVec(delta)) return false;
      next = { ...last, delta };
    }
    this.commit(next, true);
    this.report();
    return true;
  }

  cancel(): boolean {
    if (!this.moving) return false;
    this.moving = null;
    this.marker = null;
    this.report();
    return true;
  }

  busy(): boolean {
    return this.moving !== null;
  }

  refresh(): void {
    this.report();
  }

  preview(): ToolPreview {
    const moving = this.moving;
    if (!moving) return this.marker ? { ...NO_PREVIEW, marker: this.marker } : NO_PREVIEW;
    const { start, end } = moving;
    const delta = subtractVec(end, start);
    const moved = pickedSolids(movePicked(moving.picked, delta));
    const { units } = this.editor.getState();
    return {
      ...NO_PREVIEW,
      marker: this.marker,
      boxes: moving.copy ? moved : [],
      overrides: moving.copy ? new Map() : new Map(moved.map((board) => [board.id, board])),
      lines: [{ from: start, to: end, axis: axisOf(delta) }],
      dimensions: isZeroVec(delta) ? [] : [{ from: start, to: end, text: formatSize(vecLength(delta), units) }],
    };
  }

  // Steps

  private hoverAt(pointer: ToolPointer): void {
    const { document } = this.editor.getState();
    const snap = findSnap(modelBoards(document), pointer.view, undefined, document.guides);
    this.marker = markerFor(snap);
    // With nothing selected, show what a click would pick up.
    const selected = pickedCount(selectedPicked(this.editor)) > 0;
    this.editor.setHovered(selected || !snap?.boardId ? null : ownerId(snap.boardId));
  }

  private track(moving: Moving, pointer: ToolPointer): void {
    const { document, units } = this.editor.getState();
    const { start } = moving;
    const { view } = pointer;
    // Boards being moved are left out, so they never snap to themselves. Copies leave the originals in place.
    const ids = new Set(pickedSolids(moving.picked).map((board) => board.id));
    const solids = modelBoards(document);
    const others = moving.copy ? solids : solids.filter((board) => !ids.has(board.id));

    // Holding Shift keeps the axis the movement is already following.
    if (!pointer.shiftKey) moving.shiftAxis = null;
    else if (moving.shiftAxis === null) moving.shiftAxis = moving.following;
    const locked = moving.arrowAxis ?? moving.shiftAxis;

    if (locked !== null) {
      const snap = findSnap(others, view, { kind: 'line', axis: locked, through: start }, document.guides);
      if (!snap) return;
      const free = snap.kind === 'free' || (onLine(snap) && snap.edgeAxis === locked);
      moving.end = free ? roundAlong(units, pointer, snap.point, start, locked) : snap.point;
      moving.following = locked;
      this.marker = markerFor(snap) ?? axisMarker(moving.end, locked);
      const cursor = findSnap([], view, { kind: 'line', axis: locked, through: start });
      const side = cursor ? Math.sign(cursor.point[locked] - start[locked]) : 0;
      moving.heading = withAxis([0, 0, 0], locked, side === 0 ? 1 : side);
      return;
    }
    moving.heading = null;

    const snap = findSnap(others, view, undefined, document.guides);
    if (snap && isDefinite(snap)) {
      const along = onLine(snap) ? snap.edgeAxis : undefined;
      moving.end = along === undefined ? snap.point : roundAlong(units, pointer, snap.point, start, along);
      moving.following = axisOf(subtractVec(moving.end, start));
      this.marker = markerFor(snap);
      return;
    }

    const inference = findAxisInference(view, start);
    if (inference) {
      moving.end = roundAlong(units, pointer, inference.point, start, inference.axis);
      moving.following = inference.axis;
      this.marker = axisMarker(moving.end, inference.axis);
      return;
    }

    // Nothing to snap to: slide level, at the height of the grabbed point.
    let level = pointOnPlane(view, 2, start[2]);
    if (!level) return;
    for (const axis of [0, 1] as const) level = roundAlong(units, pointer, level, start, axis);
    moving.end = level;
    moving.following = null;
    this.marker = null;
  }

  private finish(moving: Moving): void {
    this.moving = null;
    this.marker = null;
    const delta = subtractVec(moving.end, moving.start);
    if (isZeroVec(delta)) return;
    const before = this.editor.getState().document;
    this.commit(
      { picked: moving.picked, delta, copy: moving.copy, count: 1, divided: false, before, after: before },
      false,
    );
  }

  /** Builds the model as it stands after a move or a run of copies, starting from the model before it. */
  private apply(move: LastMove): { document: CabbageDocument; copies: string[] } {
    const { picked, delta, before } = move;
    if (!move.copy) return { document: replacePicked(before, movePicked(picked, delta)), copies: [] };
    let document = before;
    const copies: string[] = [];
    for (let index = 1; index <= move.count; index += 1) {
      const step = move.divided ? scaleVec(delta, index / move.count) : scaleVec(delta, index);
      const added = addCopies(document, movePicked(picked, step));
      document = added.document;
      copies.push(...added.ids);
    }
    return { document, copies };
  }

  /** Puts a move into the model, as a new undo step or as a correction of the last one. */
  private commit(move: LastMove, amend: boolean): void {
    const { document, copies } = this.apply(move);
    if (amend) this.editor.amendDocument(document);
    else this.editor.commitDocument(document, pickedLabel(move.copy ? 'Copy' : 'Move', move.picked));
    // The copies become the selection, ready to be moved or copied again.
    if (copies.length > 0) this.editor.setSelection(copies);
    this.last = { ...move, after: this.editor.getState().document };
  }

  /** The move just made, while it is still the latest change to the model. */
  private correctable(): LastMove | null {
    const last = this.last;
    return last && last.after === this.editor.getState().document ? last : null;
  }

  private reset(): void {
    this.moving = null;
    this.marker = null;
    this.last = null;
    this.report();
  }

  private report(): void {
    const editor = this.editor;
    if (editor.getState().tool !== this.id) return;
    const { units } = editor.getState();
    const last = this.correctable();
    editor.setHint(this.moving ? HINTS.moving : last?.copy ? HINTS.copied : HINTS.idle);

    const label = (this.moving?.copy ?? last?.copy) ? 'Copy distance' : 'Distance';
    const delta = this.moving ? subtractVec(this.moving.end, this.moving.start) : last?.delta;
    editor.setMeasurement(label, delta ? formatSize(vecLength(delta), units) : '');
  }
}
