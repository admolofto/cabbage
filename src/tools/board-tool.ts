import { boxFromCorners, tidyBoard, type Board, type Box } from '../core/board';
import { createId, nextBoardName, type CabbageDocument } from '../core/document';
import type { Editor } from '../core/editor';
import { parseLength, parseLengthList } from '../core/parse-length';
import { formatLength, type Length } from '../core/units';
import { AXIS_NAMES, otherAxes, withAxis, type Axis, type Vec3L } from '../core/vec';
import { findSnap, toMillimeters, type Snap } from '../inference/inference';
import { DRAG_THRESHOLD, quantize, sign, stepNear } from './steps';
import {
  NO_PREVIEW,
  markerFor,
  type DimensionLabel,
  type SnapMarker,
  type Tool,
  type ToolPointer,
  type ToolPreview,
} from './tool';

/**
 * Draws a board in three steps: click a corner, click the opposite corner of
 * its face, then set the thickness.
 *
 * The face is drawn flat on the floor, or on whatever board face the first
 * click landed on. Arrow keys stand it up instead: Right for a face square to
 * the X axis, Left for Y, Up for flat, Down to go back to automatic. Every
 * step also takes a typed measurement.
 */

interface IdlePhase {
  kind: 'idle';
}

interface FacePhase {
  kind: 'face';
  start: Vec3L;
  /** The plane the first click suggested. */
  autoAxis: Axis;
  /** The plane chosen with the arrow keys, if any. */
  lockedAxis: Axis | null;
  /** When the first click was on a board face, the side that face looks toward. */
  outward: 1 | -1 | 0;
  corner: Vec3L;
  /** Where the button went down, to tell a click from a drag. */
  pressedAt: { x: number; y: number } | null;
}

interface ThicknessPhase {
  kind: 'thickness';
  /** The drawn face, with zero extent along `axis`. */
  face: Box;
  axis: Axis;
  /** Signed thickness: positive grows toward larger coordinates. Never zero. */
  thickness: Length;
  /** The corner the thickness is measured from. */
  anchor: Vec3L;
  /** Where the cursor was when this step began. The default holds until it moves away. */
  enteredAt: { x: number; y: number };
  moved: boolean;
}

type Phase = IdlePhase | FacePhase | ThicknessPhase;

/** The board just drawn, kept so a typed thickness can still correct it. */
interface LastBoard {
  board: Board;
  face: Box;
  /** The axis the face was pulled along, which is not always the board's thickness. */
  axis: Axis;
  direction: 1 | -1;
  /** The model as it stood with this board in it. Any other change ends the chance to correct it. */
  document: CabbageDocument;
}

const DEFAULT_HOLD = 4;
const DETENT_PIXELS = 7;

const HINTS = {
  idle: 'Click to place the first corner of a board.',
  face: 'Click the opposite corner, or type two sizes such as 24, 34 1/2. Arrow keys stand the board up.',
  thickness: 'Move to set the thickness and click, or type one. Enter keeps the thickness shown.',
} as const;

/** True for a point along an edge or a guide, which is free in one direction. */
function onLine(snap: Snap): boolean {
  return snap.kind === 'edge' || snap.kind === 'guide';
}

export class BoardTool implements Tool {
  readonly id = 'board' as const;

  private phase: Phase = { kind: 'idle' };
  private hover: Snap | null = null;
  private marker: SnapMarker | null = null;
  private lastPointer: ToolPointer | null = null;
  private lastBoard: LastBoard | null = null;

  constructor(private readonly editor: Editor) {}

  activate(): void {
    this.reset();
  }

  deactivate(): void {
    this.reset();
    this.lastPointer = null;
  }

  pointerMove(pointer: ToolPointer): void {
    this.lastPointer = pointer;
    const phase = this.phase;
    if (phase.kind === 'idle') this.moveIdle(pointer);
    else if (phase.kind === 'face') this.moveFace(phase, pointer);
    else this.moveThickness(phase, pointer);
    this.report();
  }

  pointerDown(pointer: ToolPointer): void {
    this.pointerMove(pointer);
    const phase = this.phase;
    if (phase.kind === 'idle') {
      if (!this.hover) return;
      const onFace = this.hover.kind === 'face' ? this.hover.face : undefined;
      this.lastBoard = null;
      this.phase = {
        kind: 'face',
        start: this.hover.point,
        autoAxis: onFace?.axis ?? 2,
        lockedAxis: null,
        outward: onFace?.sign ?? 0,
        corner: this.hover.point,
        pressedAt: { ...pointer.view.cursor },
      };
    } else if (phase.kind === 'face') {
      this.finishFace(phase, pointer);
    } else {
      this.finishBoard(phase);
    }
    this.report();
  }

  pointerUp(pointer: ToolPointer): void {
    const phase = this.phase;
    if (phase.kind !== 'face' || !phase.pressedAt) return;
    const { x, y } = pointer.view.cursor;
    const dragged = Math.hypot(x - phase.pressedAt.x, y - phase.pressedAt.y) > DRAG_THRESHOLD;
    phase.pressedAt = null;
    // Press, drag, and release draws the face in one motion, the same as two clicks.
    if (dragged) {
      this.pointerMove(pointer);
      this.finishFace(phase, pointer);
      this.report();
    }
  }

  pointerLeave(): void {
    if (this.phase.kind === 'idle') {
      this.hover = null;
      this.marker = null;
    }
  }

  keyDown(key: string): boolean {
    const phase = this.phase;
    if (phase.kind === 'face') {
      const axisForKey: Record<string, Axis | null> = {
        ArrowRight: 0,
        ArrowLeft: 1,
        ArrowUp: 2,
        ArrowDown: null,
      };
      if (!(key in axisForKey)) return false;
      const axis = axisForKey[key]!;
      // Pressing the same arrow again releases the lock.
      phase.lockedAxis = axis === null || phase.lockedAxis === axis ? null : axis;
      if (this.lastPointer) this.moveFace(phase, this.lastPointer);
      this.report();
      return true;
    }
    if (phase.kind === 'thickness' && key === 'Enter') {
      this.finishBoard(phase);
      this.report();
      return true;
    }
    return false;
  }

  acceptsMeasurement(): boolean {
    return this.phase.kind !== 'idle' || this.correctable() !== null;
  }

  busy(): boolean {
    return this.phase.kind !== 'idle';
  }

  refresh(): void {
    this.report();
  }

  applyMeasurement(text: string): boolean {
    const { units } = this.editor.getState();
    const phase = this.phase;

    if (phase.kind === 'face') {
      const sizes = parseLengthList(text, units.system);
      if (!sizes || sizes.length > 2) return false;
      const axis = phase.lockedAxis ?? phase.autoAxis;
      const [u, v] = otherAxes(axis);
      let corner = phase.corner;
      for (const [index, along] of [u, v].entries()) {
        const size = sizes[index];
        if (size === null || size === undefined) continue;
        if (size === 0) return false;
        // A typed size goes the way the cursor is already heading.
        const direction = sign(corner[along] - phase.start[along]) * sign(size);
        corner = withAxis(corner, along, phase.start[along] + direction * Math.abs(size));
      }
      if (corner[u] === phase.start[u] || corner[v] === phase.start[v]) return false;
      phase.corner = corner;
      this.beginThickness(phase, this.lastPointer);
      this.report();
      return true;
    }

    const value = parseLength(text, units.system);
    if (value === null || value === 0) return false;

    if (phase.kind === 'thickness') {
      phase.thickness = sign(phase.thickness) * sign(value) * Math.abs(value);
      this.finishBoard(phase);
      this.report();
      return true;
    }

    const last = this.correctable();
    if (last) {
      // Retyping right after drawing corrects the board instead of starting over.
      const { face, direction, axis } = last;
      const board = tidyBoard({
        ...last.board,
        ...this.solid(face, axis, direction * sign(value) * Math.abs(value)),
      });
      this.editor.replaceBoardInPlace(board);
      this.lastBoard = { ...last, board, document: this.editor.getState().document };
      this.report();
      return true;
    }
    return false;
  }

  cancel(): boolean {
    if (this.phase.kind === 'idle') return false;
    this.phase = { kind: 'idle' };
    this.marker = null;
    if (this.lastPointer) this.moveIdle(this.lastPointer);
    this.report();
    return true;
  }

  preview(): ToolPreview {
    const phase = this.phase;
    if (phase.kind === 'idle') {
      return this.marker ? { ...NO_PREVIEW, marker: this.marker } : NO_PREVIEW;
    }
    if (phase.kind === 'face') {
      const axis = phase.lockedAxis ?? phase.autoAxis;
      const [u, v] = otherAxes(axis);
      const { start, corner } = phase;
      const alongU = withAxis(start, u, corner[u]);
      const alongV = withAxis(start, v, corner[v]);
      const dimensions: DimensionLabel[] = [];
      if (corner[u] !== start[u]) dimensions.push({ from: start, to: alongU, text: this.format(corner[u] - start[u]) });
      if (corner[v] !== start[v]) dimensions.push({ from: alongU, to: corner, text: this.format(corner[v] - start[v]) });
      return { ...NO_PREVIEW, marker: this.marker, outline: [start, alongU, corner, alongV], dimensions };
    }
    const box = this.solid(phase.face, phase.axis, phase.thickness);
    const top = withAxis(phase.anchor, phase.axis, phase.anchor[phase.axis] + phase.thickness);
    return {
      ...NO_PREVIEW,
      marker: this.marker,
      boxes: [box],
      dimensions: [{ from: phase.anchor, to: top, text: this.format(phase.thickness) }],
    };
  }

  // Steps

  private moveIdle(pointer: ToolPointer): void {
    const { document } = this.editor.getState();
    let snap = findSnap(document.boards, pointer.view, undefined, document.guides);
    if (snap && (snap.kind === 'floor' || snap.kind === 'face')) {
      // A free point lands on round numbers, so drawn positions and sizes come out clean.
      let point = snap.point;
      for (const along of otherAxes(snap.face?.axis ?? 2)) {
        point = withAxis(point, along, quantize(point[along], this.stepNear(pointer, snap.point, along)));
      }
      snap = { ...snap, point };
    } else if (snap && onLine(snap) && snap.edgeAxis !== undefined) {
      // Along an edge the point is free in one direction, and gets round numbers there too.
      const along = snap.edgeAxis;
      const rounded = quantize(snap.point[along], this.stepNear(pointer, snap.point, along));
      snap = { ...snap, point: withAxis(snap.point, along, rounded) };
    }
    this.hover = snap;
    this.marker = markerFor(snap);
  }

  private moveFace(phase: FacePhase, pointer: ToolPointer): void {
    const { document } = this.editor.getState();
    const axis = phase.lockedAxis ?? phase.autoAxis;
    const constraint = { kind: 'plane', axis, value: phase.start[axis] } as const;
    const snap = findSnap(document.boards, pointer.view, constraint, document.guides);
    if (!snap) return;
    let corner = snap.point;
    // Whatever the snap left free lands on round sizes: both directions of a
    // free point, or the one direction along an edge.
    const free = snap.kind === 'free' ? otherAxes(axis) : onLine(snap) ? [snap.edgeAxis] : [];
    for (const along of free) {
      if (along === undefined || along === axis) continue;
      const step = this.stepNear(pointer, snap.point, along);
      corner = withAxis(corner, along, phase.start[along] + quantize(corner[along] - phase.start[along], step));
    }
    phase.corner = corner;
    this.marker = markerFor(snap);
  }

  private finishFace(phase: FacePhase, pointer: ToolPointer): void {
    const axis = phase.lockedAxis ?? phase.autoAxis;
    const [u, v] = otherAxes(axis);
    if (phase.corner[u] === phase.start[u] || phase.corner[v] === phase.start[v]) return;
    this.beginThickness(phase, pointer);
  }

  private beginThickness(phase: FacePhase, pointer: ToolPointer | null): void {
    const { stock } = this.editor.getState();
    const axis = phase.lockedAxis ?? phase.autoAxis;
    const plane = phase.start[axis];

    // Grow away from the face it was drawn on, up from the floor, or otherwise toward the viewer.
    let direction: 1 | -1;
    if (phase.outward !== 0 && axis === phase.autoAxis && phase.lockedAxis === null) direction = phase.outward;
    else if (axis === 2 && plane === 0) direction = 1;
    else direction = pointer && pointer.cameraDirection.getComponent(axis) > 0 ? -1 : 1;

    this.phase = {
      kind: 'thickness',
      face: boxFromCorners(phase.start, phase.corner),
      axis,
      thickness: direction * stock.thickness,
      anchor: phase.corner,
      enteredAt: pointer ? { ...pointer.view.cursor } : { x: Infinity, y: Infinity },
      moved: false,
    };
    this.marker = null;
  }

  private moveThickness(phase: ThicknessPhase, pointer: ToolPointer): void {
    const { cursor } = pointer.view;
    if (!phase.moved) {
      const travelled = Math.hypot(cursor.x - phase.enteredAt.x, cursor.y - phase.enteredAt.y);
      if (travelled < DEFAULT_HOLD) return;
      phase.moved = true;
    }

    const { document, stock } = this.editor.getState();
    const { axis, anchor } = phase;
    const snap = findSnap(document.boards, pointer.view, { kind: 'line', axis, through: anchor }, document.guides);
    if (!snap) return;
    let thickness = snap.point[axis] - anchor[axis];
    this.marker = markerFor(snap);

    if (snap.kind === 'free' || (onLine(snap) && snap.edgeAxis === axis)) {
      thickness = quantize(thickness, this.stepNear(pointer, snap.point, axis));
      // The usual sheet thickness is easy to land on: the cursor sticks to it when close.
      const usual = sign(thickness || phase.thickness) * stock.thickness;
      const usualPoint = pointer.view.project(toMillimeters(withAxis(anchor, axis, anchor[axis] + usual)));
      const here = pointer.view.project(toMillimeters(snap.point));
      if (usualPoint && here && Math.hypot(usualPoint.x - here.x, usualPoint.y - here.y) < DETENT_PIXELS) {
        thickness = usual;
      }
    }
    if (thickness !== 0) phase.thickness = thickness;
  }

  private finishBoard(phase: ThicknessPhase): void {
    const { document, stock } = this.editor.getState();
    // Its thickness is whichever way it ends up thinnest, which need not be the way it was pulled.
    const board: Board = tidyBoard({
      id: createId(),
      name: nextBoardName(document),
      thicknessAxis: phase.axis,
      materialId: stock.materialId,
      ...this.solid(phase.face, phase.axis, phase.thickness),
    });
    this.editor.addBoards([board], 'Draw board');
    this.lastBoard = {
      board,
      face: phase.face,
      axis: phase.axis,
      direction: sign(phase.thickness),
      document: this.editor.getState().document,
    };
    this.phase = { kind: 'idle' };
    this.marker = null;
    if (this.lastPointer) this.moveIdle(this.lastPointer);
  }

  // Helpers

  private stepNear(pointer: ToolPointer, point: Vec3L, axis: Axis): Length {
    return stepNear(this.editor.getState().units, pointer, point, axis);
  }

  /** Gives a flat face its thickness, growing in the direction of the sign. */
  private solid(face: Box, axis: Axis, thickness: Length): Box {
    const base = face.min[axis];
    return {
      min: withAxis(face.min, axis, thickness > 0 ? base : base + thickness),
      size: withAxis(face.size, axis, Math.abs(thickness)),
    };
  }

  /** The board just drawn, while it is still the latest change to the model. */
  private correctable(): LastBoard | null {
    const last = this.lastBoard;
    return last && last.document === this.editor.getState().document ? last : null;
  }

  private format(length: Length): string {
    return formatLength(Math.abs(length), this.editor.getState().units);
  }

  private reset(): void {
    this.phase = { kind: 'idle' };
    this.hover = null;
    this.marker = null;
    this.lastBoard = null;
    this.report();
  }

  /** Keeps the status bar's hint and measurement box in step with the tool. */
  private report(): void {
    const phase = this.phase;
    const editor = this.editor;
    if (editor.getState().tool !== this.id) return;
    editor.setHint(HINTS[phase.kind]);

    if (phase.kind === 'face') {
      const axis = phase.lockedAxis ?? phase.autoAxis;
      const [u, v] = otherAxes(axis);
      const sizeU = this.format(phase.corner[u] - phase.start[u]);
      const sizeV = this.format(phase.corner[v] - phase.start[v]);
      editor.setMeasurement(`Size ${AXIS_NAMES[u]}, ${AXIS_NAMES[v]}`, `${sizeU}, ${sizeV}`);
    } else if (phase.kind === 'thickness') {
      editor.setMeasurement('Thickness', this.format(phase.thickness));
    } else if (this.correctable()) {
      const { board, axis } = this.correctable()!;
      editor.setMeasurement('Thickness', this.format(board.size[axis]));
    } else {
      editor.setMeasurement('Size', '');
    }
  }
}
