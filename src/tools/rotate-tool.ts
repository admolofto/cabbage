import { ownerId } from '../core/cabinet';
import { modelBoards, type CabbageDocument } from '../core/document';
import type { Editor } from '../core/editor';
import {
  canTurn,
  pickedCount,
  pickedLabel,
  pickedSolids,
  replacePicked,
  turnPicked,
  type Picked,
} from '../core/picked';
import { quarterTurnsBetween, rotatePointQuarter } from '../core/transform';
import { AXIS_NAMES, vecEquals, type Axis, type Vec3L } from '../core/vec';
import { findSnap } from '../inference/inference';
import { pickToEdit, selectedPicked } from './pick';
import { NO_PREVIEW, markerFor, type SnapMarker, type Tool, type ToolPointer, type ToolPreview } from './tool';

/**
 * Turns boards and cabinets in quarter turns about an axis: click the point
 * to turn about, click a point to grab, then move around to the new direction
 * and click. Typing 90, 180, or -90 after the first click turns straight away.
 *
 * Boards stay square to the axes for now, so only quarter turns are offered.
 * A cabinet stays upright: it turns about the up axis and no other.
 */

interface Turning {
  picked: Picked;
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
  picked: Picked;
  pivot: Vec3L;
  axis: Axis;
  before: CabbageDocument;
  after: CabbageDocument;
}

const HINTS = {
  idle: 'Click the point to turn about. Select several things first to turn them together.',
  grab: 'Click a point to grab, or type 90 and press Enter. Arrow keys pick the axis.',
  grabUpright: 'Click a point to grab, or type 90 and press Enter. A cabinet stays upright as it turns.',
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
      const snap = findSnap(modelBoards(document), pointer.view, undefined, document.guides);
      if (!snap) return;
      const picked = pickToEdit(this.editor, pointer, snap);
      if (pickedCount(picked) === 0) return;
      this.last = null;
      this.editor.setHovered(null);
      this.turning = {
        picked,
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
      const { picked, pivot, axis, before } = last;
      this.editor.amendDocument(replacePicked(before, turnPicked(picked, pivot, axis, turns)));
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
    const { pivot, grab, cursor, turns, picked } = turning;
    const axis = this.axisOf(turning);
    if (!grab) {
      return { ...NO_PREVIEW, marker: this.marker, lines: [{ from: pivot, to: cursor, axis: null }] };
    }
    const turned = pickedSolids(turnPicked(picked, pivot, axis, turns));
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
    const axis = turning.arrowAxis ?? turning.autoAxis;
    // A cabinet cannot be laid on its side, so anything picked along with one turns upright too.
    return canTurn(turning.picked, axis) ? axis : 2;
  }

  private hoverAt(pointer: ToolPointer): void {
    const { document } = this.editor.getState();
    const snap = findSnap(modelBoards(document), pointer.view, undefined, document.guides);
    this.marker = markerFor(snap);
    const selected = pickedCount(selectedPicked(this.editor)) > 0;
    this.editor.setHovered(selected || !snap?.boardId ? null : ownerId(snap.boardId));
  }

  private track(turning: Turning, pointer: ToolPointer): void {
    const { document } = this.editor.getState();
    const axis = this.axisOf(turning);
    const { pivot, grab } = turning;
    // Before grabbing, the boards themselves can be snapped to. While turning, they are left out.
    const ids = new Set(pickedSolids(turning.picked).map((board) => board.id));
    const solids = modelBoards(document);
    const boards = grab ? solids.filter((board) => !ids.has(board.id)) : solids;
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
    const turned = turnPicked(turning.picked, turning.pivot, axis, turns);
    this.editor.commitDocument(replacePicked(before, turned), pickedLabel('Turn', turning.picked));
    this.last = {
      picked: turning.picked,
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
    const upright = turning !== null && turning.picked.cabinets.length > 0;
    editor.setHint(!turning ? HINTS.idle : turning.grab ? HINTS.aim : upright ? HINTS.grabUpright : HINTS.grab);
    if (turning) {
      editor.setMeasurement(`Angle about ${AXIS_NAMES[this.axisOf(turning)]}`, turning.grab ? degrees(turning.turns) : '');
    } else {
      editor.setMeasurement('Angle', '');
    }
  }
}
