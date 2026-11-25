import { addGuides, createGuide, replaceGuide, type CabbageDocument, type Guide } from '../core/document';
import type { Editor } from '../core/editor';
import { parseLength } from '../core/parse-length';
import { subtractVec, vecLength } from '../core/transform';
import type { Length } from '../core/units';
import { AXES, otherAxes, withAxis, type Axis, type Vec3L } from '../core/vec';
import { findAxisInference, findSnap, toMillimeters, type Snap } from '../inference/inference';
import { isDefinite, onLine } from './pick';
import { dragged, formatSize, roundAlong, sign } from './steps';
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
 * Measures and makes guides.
 *
 * Click two points to read the distance between them. Start on an edge or on
 * an existing guide instead, and the tool pulls a guide off it: a line
 * parallel to that edge, placed by a click or a typed offset.
 */

interface Measuring {
  start: Vec3L;
  end: Vec3L;
  /** When pulling a guide: the axis the edge runs along. Null when only measuring. */
  lineAxis: Axis | null;
  /** When pulling a guide: the direction it is being pulled in. */
  offsetAxis: Axis | null;
  /** A pull direction chosen with the arrow keys. */
  arrowAxis: Axis | null;
  pressedAt: { x: number; y: number } | null;
}

/** The guide just placed, kept so a typed offset can still correct it. */
interface LastGuide {
  guide: Guide;
  start: Vec3L;
  offsetAxis: Axis;
  direction: 1 | -1;
  after: CabbageDocument;
}

const HINTS = {
  idle: 'Click two points to measure. Start on an edge to pull a guide off it.',
  measuring: 'Click the second point.',
  guide: 'Click to place the guide, or type an offset. Arrow keys pick the direction.',
} as const;

const ARROW_AXES: Record<string, Axis | null> = { ArrowRight: 0, ArrowLeft: 1, ArrowUp: 2, ArrowDown: null };

export class TapeTool implements Tool {
  readonly id = 'tape' as const;

  private hover: Snap | null = null;
  private measuring: Measuring | null = null;
  private marker: SnapMarker | null = null;
  private lastPointer: ToolPointer | null = null;
  private last: LastGuide | null = null;
  /** The last distance read, shown until the next measurement starts. */
  private reading: Length | null = null;

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
    const { document } = this.editor.getState();
    if (this.measuring) {
      this.track(this.measuring, pointer);
    } else {
      this.hover = findSnap(document.boards, pointer.view, undefined, document.guides);
      this.marker = markerFor(this.hover);
    }
    this.report();
  }

  pointerDown(pointer: ToolPointer): void {
    this.pointerMove(pointer);
    if (this.measuring) {
      this.finish(this.measuring);
    } else if (this.hover) {
      const snap = this.hover;
      this.last = null;
      this.reading = null;
      this.measuring = {
        start: snap.point,
        end: snap.point,
        lineAxis: onLine(snap) ? (snap.edgeAxis ?? null) : null,
        offsetAxis: null,
        arrowAxis: null,
        pressedAt: { ...pointer.view.cursor },
      };
    }
    this.report();
  }

  pointerUp(pointer: ToolPointer): void {
    const measuring = this.measuring;
    if (!measuring?.pressedAt) return;
    const wasDragged = dragged(measuring.pressedAt, pointer.view.cursor);
    measuring.pressedAt = null;
    // Press, drag, and release measures or pulls a guide in one motion.
    if (wasDragged) {
      this.track(measuring, pointer);
      this.finish(measuring);
      this.report();
    }
  }

  pointerLeave(): void {
    if (!this.measuring) {
      this.hover = null;
      this.marker = null;
    }
  }

  keyDown(key: string): boolean {
    const measuring = this.measuring;
    if (!measuring || measuring.lineAxis === null || !(key in ARROW_AXES)) return false;
    const axis = ARROW_AXES[key]!;
    // A guide cannot be pulled along its own length.
    if (axis === measuring.lineAxis) return true;
    measuring.arrowAxis = axis === null || measuring.arrowAxis === axis ? null : axis;
    if (this.lastPointer) this.track(measuring, this.lastPointer);
    this.report();
    return true;
  }

  acceptsMeasurement(): boolean {
    return (this.measuring !== null && this.measuring.lineAxis !== null) || this.correctable() !== null;
  }

  applyMeasurement(text: string): boolean {
    const offset = parseLength(text, this.editor.getState().units.system);
    if (offset === null || offset === 0) return false;
    const measuring = this.measuring;

    if (measuring) {
      const { offsetAxis, start } = measuring;
      if (measuring.lineAxis === null || offsetAxis === null) return false;
      // A typed offset goes the way the guide is already being pulled.
      const direction = sign(measuring.end[offsetAxis] - start[offsetAxis]);
      measuring.end = withAxis(start, offsetAxis, start[offsetAxis] + direction * offset);
      this.finish(measuring);
      this.report();
      return true;
    }

    const last = this.correctable();
    if (!last) return false;
    const { start, offsetAxis, direction } = last;
    const through = withAxis(start, offsetAxis, start[offsetAxis] + direction * offset);
    const guide: Guide = { ...createGuide(last.guide.axis, through), id: last.guide.id };
    this.editor.amendDocument(replaceGuide(this.editor.getState().document, guide));
    this.last = { ...last, guide, after: this.editor.getState().document };
    this.report();
    return true;
  }

  cancel(): boolean {
    if (!this.measuring) return false;
    this.measuring = null;
    this.marker = null;
    this.report();
    return true;
  }

  busy(): boolean {
    return this.measuring !== null;
  }

  refresh(): void {
    this.report();
  }

  preview(): ToolPreview {
    const measuring = this.measuring;
    if (!measuring) return this.marker ? { ...NO_PREVIEW, marker: this.marker } : NO_PREVIEW;
    const { start, end, lineAxis, offsetAxis } = measuring;
    const length = vecLength(subtractVec(end, start));
    const delta = subtractVec(end, start);
    const moving = AXES.filter((axis) => delta[axis] !== 0);
    return {
      ...NO_PREVIEW,
      marker: this.marker,
      lines: [{ from: start, to: end, axis: offsetAxis ?? (moving.length === 1 ? moving[0]! : null) }],
      guide: lineAxis !== null && length > 0 ? { axis: lineAxis, through: end } : null,
      dimensions: length > 0 ? [{ from: start, to: end, text: formatSize(length, this.editor.getState().units) }] : [],
    };
  }

  // Steps

  private track(measuring: Measuring, pointer: ToolPointer): void {
    if (measuring.lineAxis === null) this.trackMeasure(measuring, pointer);
    else this.trackGuide(measuring, measuring.lineAxis, pointer);
  }

  private trackMeasure(measuring: Measuring, pointer: ToolPointer): void {
    const { document, units } = this.editor.getState();
    const { start } = measuring;
    const snap = findSnap(document.boards, pointer.view, undefined, document.guides);
    if (snap && isDefinite(snap)) {
      measuring.end = snap.point;
      this.marker = markerFor(snap);
      return;
    }
    // Away from anything definite, follow an axis when the cursor heads along one.
    const inference = findAxisInference(pointer.view, start);
    if (inference) {
      measuring.end = roundAlong(units, pointer, inference.point, start, inference.axis);
      this.marker = axisMarker(measuring.end, inference.axis);
      return;
    }
    if (!snap) return;
    let end = snap.point;
    for (const axis of otherAxes(snap.face?.axis ?? 2)) end = roundAlong(units, pointer, end, start, axis);
    measuring.end = end;
    this.marker = null;
  }

  /**
   * Pulls a guide straight off its edge in one of the two directions square to
   * it: whichever one the cursor is closer to.
   */
  private trackGuide(measuring: Measuring, lineAxis: Axis, pointer: ToolPointer): void {
    const { document, units } = this.editor.getState();
    const { start, arrowAxis } = measuring;
    const { view } = pointer;
    const directions = arrowAxis !== null ? [arrowAxis] : otherAxes(lineAxis);

    let best: { axis: Axis; point: Vec3L; snap: Snap; pixels: number } | null = null;
    for (const axis of directions) {
      const snap = findSnap(document.boards, view, { kind: 'line', axis, through: start }, document.guides);
      if (!snap) continue;
      const free = snap.kind === 'free' || (onLine(snap) && snap.edgeAxis === axis);
      const point = free ? roundAlong(units, pointer, snap.point, start, axis) : snap.point;
      const screen = view.project(toMillimeters(point));
      if (!screen) continue;
      const pixels = Math.hypot(screen.x - view.cursor.x, screen.y - view.cursor.y);
      if (!best || pixels < best.pixels) best = { axis, point, snap, pixels };
    }
    if (!best) return;
    measuring.end = best.point;
    measuring.offsetAxis = best.axis;
    this.marker = markerFor(best.snap);
  }

  private finish(measuring: Measuring): void {
    this.measuring = null;
    this.marker = null;
    const { start, end, lineAxis, offsetAxis } = measuring;
    const length = vecLength(subtractVec(end, start));
    if (length === 0) return;
    if (lineAxis === null || offsetAxis === null) {
      this.reading = length;
      return;
    }
    const guide = createGuide(lineAxis, end);
    this.editor.commitDocument(addGuides(this.editor.getState().document, [guide]), 'Add guide');
    this.last = {
      guide,
      start,
      offsetAxis,
      direction: sign(end[offsetAxis] - start[offsetAxis]),
      after: this.editor.getState().document,
    };
  }

  /** The guide just placed, while it is still the latest change to the model. */
  private correctable(): LastGuide | null {
    const last = this.last;
    return last && last.after === this.editor.getState().document ? last : null;
  }

  private reset(): void {
    this.hover = null;
    this.measuring = null;
    this.marker = null;
    this.last = null;
    this.reading = null;
    this.report();
  }

  private report(): void {
    const editor = this.editor;
    if (editor.getState().tool !== this.id) return;
    const { units } = editor.getState();
    const measuring = this.measuring;
    editor.setHint(!measuring ? HINTS.idle : measuring.lineAxis === null ? HINTS.measuring : HINTS.guide);

    const last = this.correctable();
    if (measuring) {
      const length = vecLength(subtractVec(measuring.end, measuring.start));
      editor.setMeasurement(measuring.lineAxis === null ? 'Length' : 'Offset', formatSize(length, units));
    } else if (last) {
      const offset = last.guide.through[last.offsetAxis] - last.start[last.offsetAxis];
      editor.setMeasurement('Offset', formatSize(offset, units));
    } else {
      editor.setMeasurement('Length', this.reading === null ? '' : formatSize(this.reading, units));
    }
  }
}
