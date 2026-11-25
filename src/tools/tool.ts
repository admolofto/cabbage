import type { Vector3 } from 'three';
import type { Box } from '../core/board';
import type { ToolId } from '../core/editor';
import type { Vec3L } from '../core/vec';
import type { SnapKind, SnapView } from '../inference/inference';

/** One pointer event, already turned into what a tool cares about. */
export interface ToolPointer {
  view: SnapView;
  shiftKey: boolean;
  /** Unit vector from the camera toward what it looks at. */
  cameraDirection: Vector3;
}

export interface SnapMarker {
  point: Vec3L;
  kind: SnapKind;
  label: string;
  /** For a point lined up with something elsewhere: where that something is. */
  source: Vec3L | null;
}

export interface DimensionLabel {
  from: Vec3L;
  to: Vec3L;
  text: string;
}

/** What a tool wants drawn on top of the model while it works. */
export interface ToolPreview {
  marker: SnapMarker | null;
  /** A closed outline, such as a rectangle being drawn. */
  outline: readonly Vec3L[] | null;
  /** A board that would be created by the next click. */
  box: Box | null;
  dimensions: readonly DimensionLabel[];
}

export const NO_PREVIEW: ToolPreview = { marker: null, outline: null, box: null, dimensions: [] };

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

export function snapLabel(kind: SnapKind, aligned: boolean): string {
  const names: Record<SnapKind, string> = {
    corner: 'Corner',
    midpoint: 'Midpoint',
    origin: 'Origin',
    edge: 'On edge',
    face: 'On face',
    floor: '',
    free: '',
  };
  const name = names[kind];
  if (!aligned || name === '') return name;
  return kind === 'edge' ? 'In line with edge' : `In line with ${name.toLowerCase()}`;
}
