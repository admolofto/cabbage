import type { Board } from '../core/board';
import { replaceBoards, type CabbageDocument } from '../core/document';
import type { Editor } from '../core/editor';
import { quarterTurnsBetween, rotateBoardQuarter, rotatePointQuarter } from '../core/transform';
import { AXIS_NAMES, vecEquals, type Axis, type Vec3L } from '../core/vec';
import { findSnap } from '../inference/inference';
import { boardsToEdit, countLabel } from './pick';
import { NO_PREVIEW, markerFor, type SnapMarker, type Tool, type ToolPointer, type ToolPreview } from './tool';

/**
 * Turns boards in quarter turns about an axis: click the point to turn about,
 * click a point to grab, then move around to the new direction and click.
 * Typing 90, 180, or -90 after the first click turns straight away.
 *
 * Boards stay square to the axes for now, so only quarter turns are offered.
 */

interface Turning {
  boards: readonly Board[];
  pivot: Vec3L;
  /** The axis suggested by where the pivot was clicked. */
  autoAxis: Axis;
  /** The axis chosen with the arrow keys, if any. */
  arrowAxis: Axis | null;
  /** The grabbed point, once it has been clicked. */
  grab: Vec3L | null;
  /** Where the cursor is, on the plane square to the axis through the pivot. */
  cursor: Vec3L;
  turns: number;
}

interface LastTurn {
  boards: readonly Board[];
  pivot: Vec3L;
  axis: Axis;
  before: CabbageDocument;
  after: CabbageDocument;
}

const HINTS = {
  idle: 'Click the point to turn about. Select boards first to turn several together.',
  grab: 'Click a point to grab, or type 90 and press Enter. Arrow keys pick the axis.',
  aim: 'Move around to turn in quarter turns, then click.',
} as const;

const ARROW_AXES: Record<string, Axis | null> = { ArrowRight: 0, ArrowLeft: 1, ArrowUp: 2, ArrowDown: null };

/** Reads a typed angle as quarter turns, or null when it is not a multiple of 90 degrees. */
function parseQuarterTurns(text: string): number | null {
  const match = /^([+-]?\d+(?:\.\d+)?)\s*(?:°|deg|degrees)?$/i.exec(text.trim());
  if (!match) return null;
  const turns = Number(match[1]) / 90;
  return Number.isInteger(turns) && turns % 4 !== 0 ? turns : null;
}

function degrees(turns: number): string {
  const quarter = ((turns % 4) + 4) % 4;
  return `${quarter === 3 ? -90 : quarter * 90}°`;
}

export class RotateTool implements Tool {
  readonly id = 'rotate' as const;

  private turning: Turning | null = null;
  private marker: SnapMarker | null = null;
  private lastPointer: ToolPointer | null = null;
  private last: LastTurn | null = null;

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
    if (this.turning) this.track(this.turning, pointer);
    else this.hoverAt(pointer);
    this.report();
  }

  pointerDown(pointer: ToolPointer): void {
    this.pointerMove(pointer);
    const turning = this.turning;
    if (!turning) {
      const { document } = this.editor.getState();
      const snap = findSnap(document.boards, pointer.view, undefined, document.guides);
      if (!snap) return;
      const boards = boardsToEdit(this.editor, pointer, snap);
      if (boards.length === 0) return;
      this.last = null;
      this.editor.setHovered(null);
      this.turning = {
        boards,
        pivot: snap.point,
        // Clicking a face turns about the line square to it. Anything else turns flat, about Z.
        autoAxis: snap.kind === 'face' && snap.face ? snap.face.axis : 2,
        arrowAxis: null,
        grab: null,
        cursor: snap.point,
        turns: 0,
      };
    } else if (!turning.grab) {
      if (!vecEquals(turning.cursor, turning.pivot)) turning.grab = turning.cursor;
    } else {
      this.finish(turning, turning.turns);
    }
    this.report();
  }

  pointerUp(): void {}

  pointerLeave(): void {
    if (!this.turning) {
      this.marker = null;
      this.editor.setHovered(null);
    }
  }

  keyDown(key: string): boolean {
    const turning = this.turning;
    if (!turning || !(key in ARROW_AXES)) return false;
    const axis = ARROW_AXES[key]!;
    turning.arrowAxis = axis === null || turning.arrowAxis === axis ? null : axis;
    // A new axis means a new plane, so the grabbed point no longer applies.
    turning.grab = null;
    turning.turns = 0;
    if (this.lastPointer) this.track(turning, this.lastPointer);
    this.report();
    return true;
  }

  acceptsMeasurement(): boolean {
    return this.turning !== null || this.correctable() !== null;
  }

  applyMeasurement(text: string): boolean {
    const turns = parseQuarterTurns(text);
    if (turns === null) return false;
    if (this.turning) {
      this.finish(this.turning, turns);
    } else {
      const last = this.correctable();
      if (!last) return false;
      const { boards, pivot, axis, before } = last;
      const turned = boards.map((board) => rotateBoardQuarter(board, pivot, axis, turns));
      this.editor.amendDocument(replaceBoards(before, turned));
      this.last = { ...last, after: this.editor.getState().document };
    }
    this.report();
    return true;
  }

  cancel(): boolean {
    if (!this.turning) return false;
    this.turning = null;
    this.marker = null;
    this.report();
    return true;
  }

  busy(): boolean {
    return this.turning !== null;
  }

  refresh(): void {
    this.report();
  }

  preview(): ToolPreview {
    const turning = this.turning;
    if (!turning) return this.marker ? { ...NO_PREVIEW, marker: this.marker } : NO_PREVIEW;
    const { pivot, grab, cursor, turns, boards } = turning;
    const axis = this.axisOf(turning);
    if (!grab) {
      return { ...NO_PREVIEW, marker: this.marker, lines: [{ from: pivot, to: cursor, axis: null }] };
    }
    const turned = boards.map((board) => rotateBoardQuarter(board, pivot, axis, turns));
    const landed = rotatePointQuarter(grab, pivot, axis, turns);
    return {
      ...NO_PREVIEW,
      marker: this.marker,
      overrides: new Map(turned.map((board) => [board.id, board])),
      lines: [
        { from: pivot, to: grab, axis: null },
        { from: pivot, to: landed, axis },
      ],
      dimensions: [{ from: landed, to: landed, text: degrees(turns) }],
    };
  }

  // Steps

  private axisOf(turning: Turning): Axis {
    return turning.arrowAxis ?? turning.autoAxis;
  }

  private hoverAt(pointer: ToolPointer): void {
    const { document, selection } = this.editor.getState();
    const snap = findSnap(document.boards, pointer.view, undefined, document.guides);
    this.marker = markerFor(snap);
    const selected = document.boards.some((board) => selection.has(board.id));
    this.editor.setHovered(selected ? null : (snap?.boardId ?? null));
  }

  private track(turning: Turning, pointer: ToolPointer): void {
    const { document } = this.editor.getState();
    const axis = this.axisOf(turning);
    const { pivot, grab } = turning;
    // Before grabbing, the boards themselves can be snapped to. While turning, they are left out.
    const ids = new Set(turning.boards.map((board) => board.id));
    const boards = grab ? document.boards.filter((board) => !ids.has(board.id)) : document.boards;
    const snap = findSnap(boards, pointer.view, { kind: 'plane', axis, value: pivot[axis] }, document.guides);
    if (!snap) return;
    turning.cursor = snap.point;
    this.marker = markerFor(snap);
    if (grab) turning.turns = quarterTurnsBetween(grab, snap.point, pivot, axis) ?? turning.turns;
  }

  private finish(turning: Turning, turns: number): void {
    this.turning = null;
    this.marker = null;
    if (turns % 4 === 0) return;
    const axis = this.axisOf(turning);
    const before = this.editor.getState().document;
    const turned = turning.boards.map((board) => rotateBoardQuarter(board, turning.pivot, axis, turns));
    this.editor.commitDocument(replaceBoards(before, turned), countLabel('Turn', turning.boards.length));
    this.last = {
      boards: turning.boards,
      pivot: turning.pivot,
      axis,
      before,
      after: this.editor.getState().document,
    };
  }

  /** The turn just made, while it is still the latest change to the model. */
  private correctable(): LastTurn | null {
    const last = this.last;
    return last && last.after === this.editor.getState().document ? last : null;
  }

  private reset(): void {
    this.turning = null;
    this.marker = null;
    this.last = null;
    this.report();
  }

  private report(): void {
    const editor = this.editor;
    if (editor.getState().tool !== this.id) return;
    const turning = this.turning;
    editor.setHint(!turning ? HINTS.idle : turning.grab ? HINTS.aim : HINTS.grab);
    if (turning) {
      editor.setMeasurement(`Angle about ${AXIS_NAMES[this.axisOf(turning)]}`, turning.grab ? degrees(turning.turns) : '');
    } else {
      editor.setMeasurement('Angle', '');
    }
  }
}
