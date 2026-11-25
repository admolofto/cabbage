import type { Board } from '../core/board';
import { replaceBoards, type CabbageDocument } from '../core/document';
import { dragStep, type Editor } from '../core/editor';
import { parseLength } from '../core/parse-length';
import { faceCorners, facePosition, pullBoard } from '../core/transform';
import type { Length } from '../core/units';
import { withAxis, type Axis, type Vec3L } from '../core/vec';
import { findSnap, firstSurfaceHit, fromMillimeters } from '../inference/inference';
import { Vector3 } from 'three';
import { onLine } from './pick';
import { dragged, formatSize, quantize, sign, stepNear } from './steps';
import { NO_PREVIEW, markerFor, type SnapMarker, type Tool, type ToolPointer, type ToolPreview } from './tool';

/**
 * Resizes a board by one of its faces: click a face, move, and click again.
 * The opposite face stays put. A typed number is the distance to pull, and
 * "=" followed by a number sets the full size instead.
 */

interface FaceHover {
  board: Board;
  axis: Axis;
  sign: 1 | -1;
  /** Where on the face the cursor is. */
  point: Vec3L;
}

interface Pulling extends FaceHover {
  /** How far the face has moved outward. Negative pushes it in. */
  distance: Length;
  pressedAt: { x: number; y: number } | null;
}

/** The pull just made, kept so a typed value can still correct it. */
interface LastPull {
  board: Board;
  axis: Axis;
  sign: 1 | -1;
  direction: 1 | -1;
  before: CabbageDocument;
  after: CabbageDocument;
}

const HINTS = {
  idle: 'Click a face of a board to pull it.',
  pulling: 'Move and click, or type a distance. Type = and a size, such as =30, to set the full size.',
} as const;

export class PullTool implements Tool {
  readonly id = 'pull' as const;

  private hover: FaceHover | null = null;
  private pulling: Pulling | null = null;
  private marker: SnapMarker | null = null;
  private last: LastPull | null = null;

  constructor(private readonly editor: Editor) {}

  activate(): void {
    this.reset();
  }

  deactivate(): void {
    this.reset();
  }

  pointerMove(pointer: ToolPointer): void {
    if (this.pulling) this.track(this.pulling, pointer);
    else this.hover = this.faceUnder(pointer);
    this.report();
  }

  pointerDown(pointer: ToolPointer): void {
    this.pointerMove(pointer);
    if (this.pulling) {
      this.finish(this.pulling);
    } else if (this.hover) {
      this.last = null;
      this.pulling = { ...this.hover, distance: 0, pressedAt: { ...pointer.view.cursor } };
      this.hover = null;
    }
    this.report();
  }

  pointerUp(pointer: ToolPointer): void {
    const pulling = this.pulling;
    if (!pulling?.pressedAt) return;
    const wasDragged = dragged(pulling.pressedAt, pointer.view.cursor);
    pulling.pressedAt = null;
    // Press, drag, and release pulls in one motion, the same as two clicks.
    if (wasDragged) {
      this.track(pulling, pointer);
      this.finish(pulling);
      this.report();
    }
  }

  pointerLeave(): void {
    this.hover = null;
  }

  keyDown(): boolean {
    return false;
  }

  acceptsMeasurement(): boolean {
    return this.pulling !== null || this.correctable() !== null;
  }

  applyMeasurement(text: string): boolean {
    const target = this.pulling ?? this.correctable();
    if (!target) return false;
    const { units } = this.editor.getState();
    const minimum = dragStep(units);
    const size = target.board.size[target.axis];

    let distance: Length;
    if (text.trim().startsWith('=')) {
      const full = parseLength(text.trim().slice(1), units.system);
      if (full === null || full < minimum) return false;
      distance = full - size;
    } else {
      const typed = parseLength(text, units.system);
      if (typed === null || typed === 0) return false;
      // A typed distance goes the way the face is already heading.
      const direction = 'direction' in target ? target.direction : sign(target.distance);
      distance = direction * typed;
      if (size + distance < minimum) return false;
    }

    if (this.pulling) {
      this.pulling.distance = distance;
      this.finish(this.pulling);
    } else if (this.last) {
      const { board, axis, sign: side, before } = this.last;
      const next = replaceBoards(before, [pullBoard(board, axis, side, distance, minimum)]);
      this.editor.amendDocument(next);
      this.last = { ...this.last, after: this.editor.getState().document, direction: sign(distance) };
    }
    this.report();
    return true;
  }

  cancel(): boolean {
    if (!this.pulling) return false;
    this.pulling = null;
    this.marker = null;
    this.report();
    return true;
  }

  busy(): boolean {
    return this.pulling !== null;
  }

  refresh(): void {
    this.report();
  }

  preview(): ToolPreview {
    const pulling = this.pulling;
    if (!pulling) {
      const hover = this.hover;
      return hover ? { ...NO_PREVIEW, outline: faceCorners(hover.board, hover.axis, hover.sign) } : NO_PREVIEW;
    }
    const { board, axis, sign: side, point } = pulling;
    const pulled = this.pulled(pulling);
    const from = withAxis(point, axis, facePosition(pulled, axis, side > 0 ? -1 : 1));
    const to = withAxis(point, axis, facePosition(pulled, axis, side));
    return {
      ...NO_PREVIEW,
      marker: this.marker,
      outline: faceCorners(pulled, axis, side),
      overrides: new Map([[board.id, pulled]]),
      lines: [{ from: point, to, axis }],
      dimensions: [{ from, to, text: formatSize(pulled.size[axis], this.editor.getState().units) }],
    };
  }

  // Steps

  private faceUnder(pointer: ToolPointer): FaceHover | null {
    const { ray } = pointer.view;
    const hit = firstSurfaceHit(this.editor.getState().document.boards, ray);
    if (!hit) return null;
    const { board, axis, sign: side } = hit;
    const point = fromMillimeters(ray.at(hit.distance, new Vector3()));
    return { board, axis, sign: side, point: withAxis(point, axis, facePosition(board, axis, side)) };
  }

  private track(pulling: Pulling, pointer: ToolPointer): void {
    const { document, units } = this.editor.getState();
    const { board, axis, point } = pulling;
    // The board being pulled never snaps to itself, but it still hides what is behind it.
    const others = document.boards.filter((other) => other.id !== board.id);
    const snap = findSnap(others, pointer.view, { kind: 'line', axis, through: point }, document.guides, [board]);
    if (!snap) return;
    let offset = snap.point[axis] - point[axis];
    if (snap.kind === 'free' || (onLine(snap) && snap.edgeAxis === axis)) {
      offset = quantize(offset, stepNear(units, pointer, snap.point, axis));
    }
    // A board cannot be pushed through itself.
    pulling.distance = Math.max(offset * pulling.sign, dragStep(units) - board.size[axis]);
    this.marker = markerFor(snap);
  }

  private finish(pulling: Pulling): void {
    this.pulling = null;
    this.marker = null;
    if (pulling.distance === 0) return;
    const before = this.editor.getState().document;
    this.editor.commitDocument(replaceBoards(before, [this.pulled(pulling)]), 'Pull board');
    this.last = {
      board: pulling.board,
      axis: pulling.axis,
      sign: pulling.sign,
      direction: sign(pulling.distance),
      before,
      after: this.editor.getState().document,
    };
  }

  // Helpers

  private pulled(pulling: Pulling): Board {
    const minimum = dragStep(this.editor.getState().units);
    return pullBoard(pulling.board, pulling.axis, pulling.sign, pulling.distance, minimum);
  }

  /** The pull just made, while it is still the latest change to the model. */
  private correctable(): LastPull | null {
    const last = this.last;
    return last && last.after === this.editor.getState().document ? last : null;
  }

  private reset(): void {
    this.hover = null;
    this.pulling = null;
    this.marker = null;
    this.last = null;
    this.report();
  }

  private report(): void {
    const editor = this.editor;
    if (editor.getState().tool !== this.id) return;
    const { units } = editor.getState();
    editor.setHint(this.pulling ? HINTS.pulling : HINTS.idle);

    const signed = (distance: Length) => `${distance < 0 ? '-' : ''}${formatSize(distance, units)}`;
    const last = this.correctable();
    if (this.pulling) {
      editor.setMeasurement('Distance', signed(this.pulling.distance));
    } else if (last) {
      const now = editor.getState().document.boards.find((board) => board.id === last.board.id);
      editor.setMeasurement('Distance', now ? signed(now.size[last.axis] - last.board.size[last.axis]) : '');
    } else {
      editor.setMeasurement('Distance', '');
    }
  }
}
