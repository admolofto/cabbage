import { dragStep, roundSteps } from '../core/editor';
import { formatLength, type Length, type UnitSettings } from '../core/units';
import { withAxis, type Axis, type Vec3L } from '../core/vec';
import { toMillimeters } from '../inference/inference';
import type { ToolPointer } from './tool';

/** A dragged length lands on the roundest step that is no wider than this on screen. */
const MAX_STEP_PIXELS = 8;
/** Length used to measure how big the model is on screen near a point: 100 mm. */
const PROBE: Length = 100_000_000;

/** How far the cursor may travel between press and release and still count as a click. */
export const DRAG_THRESHOLD = 6;

export function quantize(value: Length, step: Length): Length {
  return Math.round(value / step) * step;
}

export function sign(value: number): 1 | -1 {
  return value < 0 ? -1 : 1;
}

/**
 * The roundest step a drag along an axis can land on while still following
 * the cursor closely. Zoomed out that is a whole inch or 10 mm. Zooming in
 * brings finer steps, down to the display precision.
 */
export function stepNear(units: UnitSettings, pointer: ToolPointer, point: Vec3L, axis: Axis): Length {
  const { project } = pointer.view;
  const here = project(toMillimeters(point));
  const there = project(toMillimeters(withAxis(point, axis, point[axis] + PROBE)));
  if (!here || !there) return dragStep(units);
  const pixelsPerUnit = Math.hypot(there.x - here.x, there.y - here.y) / PROBE;
  const steps = roundSteps(units);
  return steps.find((step) => step * pixelsPerUnit <= MAX_STEP_PIXELS) ?? steps[steps.length - 1]!;
}

/** Rounds a point's distance from an origin, along one axis, to a round step. */
export function roundAlong(
  units: UnitSettings,
  pointer: ToolPointer,
  point: Vec3L,
  origin: Vec3L,
  axis: Axis,
): Vec3L {
  const step = stepNear(units, pointer, point, axis);
  return withAxis(point, axis, origin[axis] + quantize(point[axis] - origin[axis], step));
}

/** A length as the status bar shows it: always positive. */
export function formatSize(length: Length, units: UnitSettings): string {
  return formatLength(Math.abs(length), units);
}

export function dragged(from: { x: number; y: number }, to: { x: number; y: number }): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) > DRAG_THRESHOLD;
}
