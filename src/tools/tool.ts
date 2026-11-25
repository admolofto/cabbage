import type { Vector3 } from 'three';
import type { Box } from '../core/board';
import type { ToolId } from '../core/editor';
import { AXIS_NAMES, type Axis, type Vec3L } from '../core/vec';
import type { Snap, SnapKind, SnapView } from '../inference/inference';

/** One pointer event, already turned into what a tool cares about. */
export interface ToolPointer {
  view: SnapView;
  shiftKey: boolean;
  /** Unit vector from the camera toward what it looks at. */
  cameraDirection: Vector3;
}

export interface SnapMarker {
  point: Vec3L;
  /** What was snapped to, or 'axis' for a point that is following an axis from where the step began. */
  kind: SnapKind | 'axis';
  label: string;
  /** For a point lined up with something elsewhere: where that something is. */
  source: Vec3L | null;
}

export interface DimensionLabel {
  from: Vec3L;
  to: Vec3L;
  text: string;
}

/** A straight line drawn over the model, colored like its axis when it follows one. */
export interface PreviewLine {
  from: Vec3L;
  to: Vec3L;
  axis: Axis | null;
}

/** A rectangle in screen pixels, such as the one dragged out to select boards. */
export interface ScreenRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** True when anything the rectangle touches counts, false when only what is fully inside does. */
  crossing: boolean;
}

/** What a tool wants drawn on top of the model while it works. */
export interface ToolPreview {
  marker: SnapMarker | null;
  /** A closed outline, such as a rectangle being drawn or the face about to be pulled. */
  outline: readonly Vec3L[] | null;
  /** Boards that the next click would create. */
  boxes: readonly Box[];
  /** Boards already in the model, shown at a new place or size while an edit is under way. */
  overrides: ReadonlyMap<string, Box>;
  lines: readonly PreviewLine[];
  /** A guide that the next click would place. */
  guide: { axis: Axis; through: Vec3L } | null;
  rect: ScreenRect | null;
  dimensions: readonly DimensionLabel[];
}

export const NO_PREVIEW: ToolPreview = {
  marker: null,
  outline: null,
  boxes: [],
  overrides: new Map(),
  lines: [],
  guide: null,
  rect: null,
  dimensions: [],
};

/**
 * A tool is a small state machine. It is fed pointer and key events, changes
 * the model through the editor, and describes what it wants drawn. It never
 * touches the screen itself, which keeps every tool testable without a browser.
 */
export interface Tool {
  readonly id: ToolId;
  activate(): void;
  deactivate(): void;
  pointerMove(pointer: ToolPointer): void;
  pointerDown(pointer: ToolPointer): void;
  pointerUp(pointer: ToolPointer): void;
  pointerLeave(): void;
  /** Handles a non-typing key such as an arrow or Enter. Returns true when it was used. */
  keyDown(key: string): boolean;
  /** True when digits typed now would mean something to the tool. */
  acceptsMeasurement(): boolean;
  /** Applies typed text. Returns false when it could not be used. */
  applyMeasurement(text: string): boolean;
  /** Backs out of the current step. Returns false when there was nothing to back out of. */
  cancel(): boolean;
  /** True in the middle of an operation, such as a board that is half drawn. */
  busy(): boolean;
  /** Describes the current step again, after something like the units changed. */
  refresh(): void;
  preview(): ToolPreview;
}

const SNAP_NAMES: Record<SnapKind, string> = {
  corner: 'Corner',
  midpoint: 'Midpoint',
  origin: 'Origin',
  intersection: 'Intersection',
  edge: 'On edge',
  guide: 'On guide',
  face: 'On face',
  floor: '',
  free: '',
};

export function snapLabel(kind: SnapKind, aligned: boolean): string {
  const name = SNAP_NAMES[kind];
  if (!aligned || name === '') return name;
  if (kind === 'edge' || kind === 'guide') return `In line with ${kind}`;
  return `In line with ${name.toLowerCase()}`;
}

/** The marker for a snap, or null for one that needs no marker, such as a bare point on the floor. */
export function markerFor(snap: Snap | null): SnapMarker | null {
  if (!snap) return null;
  const label = snapLabel(snap.kind, snap.aligned);
  if (label === '' || snap.kind === 'face') return null;
  return { point: snap.point, kind: snap.kind, label, source: snap.source ?? null };
}

/** The marker for a point that is following an axis. */
export function axisMarker(point: Vec3L, axis: Axis): SnapMarker {
  return { point, kind: 'axis', label: `Along ${AXIS_NAMES[axis]}`, source: null };
}
