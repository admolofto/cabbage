import { Vector3 } from 'three';
import type { Board, Box } from '../core/board';
import { cabinetBoards, cabinetBox, ownerId, pullCabinet, smallestAlong, type Cabinet } from '../core/cabinet';
import { modelBoards, replaceBoards, replaceCabinets, type CabbageDocument } from '../core/document';
import { dragStep, type Editor } from '../core/editor';
import { parseLength } from '../core/parse-length';
import { faceCorners, facePosition, pullBoard } from '../core/transform';
import type { Length } from '../core/units';
import { withAxis, type Axis, type Vec3L } from '../core/vec';
import { findSnap, firstSurfaceHit, fromMillimeters } from '../inference/inference';
import { onLine } from './pick';
import { dragged, formatSize, quantize, sign, stepNear } from './steps';
import { NO_PREVIEW, markerFor, type SnapMarker, type Tool, type ToolPointer, type ToolPreview } from './tool';

/**
 * Resizes a board by one of its faces: click a face, move, and click again.
 * The opposite face stays put. A typed number is the distance to pull, and
 * "=" followed by a number sets the full size instead.
 *
 * On a cabinet it pulls a whole outside face: a side for the width, the front
 * or back for the depth, the top or bottom for the height. The cabinet's
 * boards follow. Faces inside a cabinet cannot be pulled.
 */

/** What is being resized: a board that stands alone, or a whole cabinet. */
type Subject = { kind: 'board'; board: Board } | { kind: 'cabinet'; cabinet: Cabinet };

interface FaceHover {
  subject: Subject;
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
  subject: Subject;
  axis: Axis;
  sign: 1 | -1;
  direction: 1 | -1;
  before: CabbageDocument;
  after: CabbageDocument;
}

const HINTS = {
  idle: 'Click a face of a board to pull it, or an outside face of a cabinet to resize it.',
  inside: 'That face is inside a cabinet. Pull an outside face, or unlock the cabinet to change its boards.',
  pulling: 'Move and click, or type a distance. Type = and a size, such as =30, to set the full size.',
} as const;

function boxOf(subject: Subject): Box {
  return subject.kind === 'board' ? subject.board : cabinetBox(subject.cabinet);
}

export class PullTool implements Tool {
  readonly id = 'pull' as const;

  private hover: FaceHover | null = null;
  /** True while the cursor is on a face inside a cabinet, which cannot be pulled. */
  private inside = false;
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
    this.inside = false;
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
    const minimum = this.smallest(target.subject, target.axis);
    const size = boxOf(target.subject).size[target.axis];

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
      const { subject, axis, sign: side, before } = this.last;
      this.editor.amendDocument(this.pulledDocument(before, subject, axis, side, distance));
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
      return hover ? { ...NO_PREVIEW, outline: faceCorners(boxOf(hover.subject), hover.axis, hover.sign) } : NO_PREVIEW;
    }
    const { subject, axis, sign: side, point, distance } = pulling;
    const pulled = this.pulled(subject, axis, side, distance);
    const box = boxOf(pulled);
    const from = withAxis(point, axis, facePosition(box, axis, side > 0 ? -1 : 1));
    const to = withAxis(point, axis, facePosition(box, axis, side));
    return {
      ...NO_PREVIEW,
      marker: this.marker,
      outline: faceCorners(box, axis, side),
      overrides: new Map(this.boardsOf(pulled).map((board) => [board.id, board])),
      lines: [{ from: point, to, axis }],
      dimensions: [{ from, to, text: formatSize(box.size[axis], this.editor.getState().units) }],
    };
  }

  // Steps

  private faceUnder(pointer: ToolPointer): FaceHover | null {
    const { ray } = pointer.view;
    const { document } = this.editor.getState();
    this.inside = false;
    const hit = firstSurfaceHit(modelBoards(document), ray);
    if (!hit) return null;
    const { board, axis, sign: side } = hit;

    let subject: Subject = { kind: 'board', board };
    const cabinet = document.cabinets.find((candidate) => candidate.id === board.cabinetId);
    if (cabinet) {
      // Only a face on the outside of the cabinet stands for one of its sizes.
      if (facePosition(board, axis, side) !== facePosition(cabinetBox(cabinet), axis, side)) {
        this.inside = true;
        return null;
      }
      subject = { kind: 'cabinet', cabinet };
    }
    const point = fromMillimeters(ray.at(hit.distance, new Vector3()));
    return { subject, axis, sign: side, point: withAxis(point, axis, facePosition(board, axis, side)) };
  }

  private track(pulling: Pulling, pointer: ToolPointer): void {
    const { document, units } = this.editor.getState();
    const { subject, axis, point } = pulling;
    // What is being pulled never snaps to itself, but it still hides what is behind it.
    const own = this.boardsOf(subject);
    const owner = ownerId(own[0]!.id);
    const others = modelBoards(document).filter((other) => ownerId(other.id) !== owner);
    const snap = findSnap(others, pointer.view, { kind: 'line', axis, through: point }, document.guides, own);
    if (!snap) return;
    let offset = snap.point[axis] - point[axis];
    if (snap.kind === 'free' || (onLine(snap) && snap.edgeAxis === axis)) {
      offset = quantize(offset, stepNear(units, pointer, snap.point, axis));
    }
    // Nothing can be pushed through itself, or made smaller than it can be built.
    const least = this.smallest(subject, axis) - boxOf(subject).size[axis];
    pulling.distance = Math.max(offset * pulling.sign, least);
    this.marker = markerFor(snap);
  }

  private finish(pulling: Pulling): void {
    this.pulling = null;
    this.marker = null;
    if (pulling.distance === 0) return;
    const { subject, axis, sign: side, distance } = pulling;
    const before = this.editor.getState().document;
    const label = subject.kind === 'board' ? 'Pull board' : 'Resize cabinet';
    this.editor.commitDocument(this.pulledDocument(before, subject, axis, side, distance), label);
    this.last = { subject, axis, sign: side, direction: sign(distance), before, after: this.editor.getState().document };
  }

  // Helpers

  /** The smallest the subject may be along an axis. */
  private smallest(subject: Subject, axis: Axis): Length {
    return subject.kind === 'board' ? dragStep(this.editor.getState().units) : smallestAlong(subject.cabinet, axis);
  }

  private pulled(subject: Subject, axis: Axis, side: 1 | -1, distance: Length): Subject {
    if (subject.kind === 'cabinet') {
      return { kind: 'cabinet', cabinet: pullCabinet(subject.cabinet, axis, side, distance) };
    }
    const minimum = dragStep(this.editor.getState().units);
    return { kind: 'board', board: pullBoard(subject.board, axis, side, distance, minimum) };
  }

  private pulledDocument(
    before: CabbageDocument,
    subject: Subject,
    axis: Axis,
    side: 1 | -1,
    distance: Length,
  ): CabbageDocument {
    const pulled = this.pulled(subject, axis, side, distance);
    return pulled.kind === 'board'
      ? replaceBoards(before, [pulled.board])
      : replaceCabinets(before, [pulled.cabinet]);
  }

  private boardsOf(subject: Subject): readonly Board[] {
    return subject.kind === 'board' ? [subject.board] : cabinetBoards(subject.cabinet);
  }

  /** The subject as it stands in the model now, or null when it is gone. */
  private current(subject: Subject): Subject | null {
    const { document } = this.editor.getState();
    if (subject.kind === 'board') {
      const board = document.boards.find((candidate) => candidate.id === subject.board.id);
      return board ? { kind: 'board', board } : null;
    }
    const cabinet = document.cabinets.find((candidate) => candidate.id === subject.cabinet.id);
    return cabinet ? { kind: 'cabinet', cabinet } : null;
  }

  /** The pull just made, while it is still the latest change to the model. */
  private correctable(): LastPull | null {
    const last = this.last;
    return last && last.after === this.editor.getState().document ? last : null;
  }

  private reset(): void {
    this.hover = null;
    this.inside = false;
    this.pulling = null;
    this.marker = null;
    this.last = null;
    this.report();
  }

  private report(): void {
    const editor = this.editor;
    if (editor.getState().tool !== this.id) return;
    const { units } = editor.getState();
    editor.setHint(this.pulling ? HINTS.pulling : this.inside ? HINTS.inside : HINTS.idle);

    const signed = (distance: Length) => `${distance < 0 ? '-' : ''}${formatSize(distance, units)}`;
    const last = this.correctable();
    if (this.pulling) {
      editor.setMeasurement('Distance', signed(this.pulling.distance));
    } else if (last) {
      const now = this.current(last.subject);
      const grown = now ? boxOf(now).size[last.axis] - boxOf(last.subject).size[last.axis] : null;
      editor.setMeasurement('Distance', grown === null ? '' : signed(grown));
    } else {
      editor.setMeasurement('Distance', '');
    }
  }
}
