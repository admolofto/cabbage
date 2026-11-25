import { PerspectiveCamera, Ray, Vector3 } from 'three';
import type { Vec3L } from '../core/vec';
import { DEFAULT_SNAP_TOLERANCE, toMillimeters } from '../inference/inference';
import type { ToolPointer } from '../tools/tool';

interface TestViewOptions {
  /** Camera position in millimeters. */
  position?: [number, number, number];
  target?: [number, number, number];
  width?: number;
  height?: number;
}

/**
 * A camera and a screen with no browser behind them, for tests. It builds the
 * same pointer a real mouse move would produce, aimed at a point in the model.
 */
export function createTestView(options: TestViewOptions = {}) {
  const { position = [2000, -2500, 1800], target = [300, 300, 0], width = 1000, height = 800 } = options;
  const camera = new PerspectiveCamera(32, width / height, 1, 1_000_000);
  camera.up.set(0, 0, 1);
  camera.position.set(...position);
  camera.lookAt(new Vector3(...target));
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  const cameraDirection = new Vector3(...target).sub(camera.position).normalize();

  const project = (point: Vector3): { x: number; y: number } | null => {
    const v = point.clone().applyMatrix4(camera.matrixWorldInverse);
    if (v.z > -1e-3) return null;
    v.applyMatrix4(camera.projectionMatrix);
    return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height };
  };

  /** The pointer for a cursor at a screen position, in pixels. */
  const pointerAtScreen = (x: number, y: number, shiftKey = false): ToolPointer => {
    const through = new Vector3((x / width) * 2 - 1, 1 - (y / height) * 2, 0.5).unproject(camera);
    const ray = new Ray(camera.position.clone(), through.sub(camera.position).normalize());
    return {
      view: { ray, cursor: { x, y }, project, tolerance: DEFAULT_SNAP_TOLERANCE },
      shiftKey,
      cameraDirection,
    };
  };

  /** Where a model point lands on screen. */
  const screen = (point: Vec3L): { x: number; y: number } => {
    const at = project(toMillimeters(point));
    if (!at) throw new Error('The point is behind the test camera.');
    return at;
  };

  /** The pointer for a cursor resting on a model point, or a few pixels off it. */
  const pointerAt = (point: Vec3L, offset: { x?: number; y?: number } = {}, shiftKey = false): ToolPointer => {
    const at = screen(point);
    return pointerAtScreen(at.x + (offset.x ?? 0), at.y + (offset.y ?? 0), shiftKey);
  };

  return { camera, project, screen, pointerAt, pointerAtScreen };
}
