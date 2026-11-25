import { Plane, Raycaster, Vector2, Vector3, type PerspectiveCamera, type Ray } from 'three';
import {
  UP,
  clonePose,
  interpolatePose,
  orbitPose,
  panPose,
  poseDistance,
  viewDirection,
  zoomPose,
  type CameraPose,
} from './camera-math';

/** What a plain left-button drag or a single finger does. */
export type NavigationTool = 'orbit' | 'pan';

type DragMode = 'orbit' | 'pan';

interface DragState {
  mode: DragMode;
  pointerId: number;
  lastX: number;
  lastY: number;
  /** World point under the cursor when the drag began. Orbit turns around it and pan keeps it under the cursor. */
  anchor: Vector3;
}

interface PinchState {
  anchor: Vector3;
  lastX: number;
  lastY: number;
  lastSpread: number;
}

export interface CameraControllerOptions {
  /** Returns the world point a ray lands on, or null when it hits nothing useful. */
  pick: (ray: Ray) => Vector3 | null;
  /** The navigation tool in use, or null when a plain left drag or single finger belongs to a drawing tool. */
  getTool: () => NavigationTool | null;
  onChange: () => void;
}

/** Radians of rotation per pixel of drag. A drag across a 1,000 pixel view is a bit under a full turn. */
const ORBIT_SPEED = 0.0055;
const WHEEL_ZOOM_SPEED = 0.0015;
/** Trackpad pinches arrive as wheel events with ctrlKey set and much smaller deltas. */
const PINCH_WHEEL_ZOOM_SPEED = 0.01;
const VIEW_ANIMATION_MS = 240;

/**
 * Turns pointer, touch, and wheel input into camera movement.
 *
 * Mouse: middle drag orbits, Shift + middle drag or right drag pans, the wheel
 * zooms toward the cursor, and a left drag does whatever the active navigation
 * tool says. Touch: one finger uses the active tool, two fingers pan and pinch.
 * When a drawing tool is active, the left button and a single finger are left
 * alone for it.
 */
export class CameraController {
  private pose: CameraPose;
  private drag: DragState | null = null;
  private pinch: PinchState | null = null;
  private readonly touches = new Map<number, { x: number; y: number }>();
  private animation: number | null = null;
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();

  constructor(
    private readonly element: HTMLElement,
    private readonly camera: PerspectiveCamera,
    initialPose: CameraPose,
    private readonly options: CameraControllerOptions,
  ) {
    this.pose = clonePose(initialPose);
    this.applyPose();

    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerEnd);
    element.addEventListener('pointercancel', this.onPointerEnd);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('contextmenu', this.onContextMenu);
    element.addEventListener('mousedown', this.onMouseDown);
  }

  dispose(): void {
    this.stopAnimation();
    const element = this.element;
    element.removeEventListener('pointerdown', this.onPointerDown);
    element.removeEventListener('pointermove', this.onPointerMove);
    element.removeEventListener('pointerup', this.onPointerEnd);
    element.removeEventListener('pointercancel', this.onPointerEnd);
    element.removeEventListener('wheel', this.onWheel);
    element.removeEventListener('contextmenu', this.onContextMenu);
    element.removeEventListener('mousedown', this.onMouseDown);
  }

  getPose(): CameraPose {
    return clonePose(this.pose);
  }

  /** True while a drag or pinch is moving the camera. */
  isNavigating(): boolean {
    return this.drag !== null || this.pinch !== null;
  }

  setPose(pose: CameraPose, animate = false): void {
    this.stopAnimation();
    if (!animate) {
      this.pose = clonePose(pose);
      this.applyPose();
      return;
    }
    const from = clonePose(this.pose);
    const to = clonePose(pose);
    const start = performance.now();
    const step = (now: number) => {
      const linear = Math.min(1, (now - start) / VIEW_ANIMATION_MS);
      const eased = linear < 0.5 ? 2 * linear * linear : 1 - Math.pow(-2 * linear + 2, 2) / 2;
      this.pose = linear >= 1 ? to : interpolatePose(from, to, eased);
      this.applyPose();
      this.animation = linear >= 1 ? null : requestAnimationFrame(step);
    };
    this.animation = requestAnimationFrame(step);
  }

  /** The ray leaving the camera through a point given in client (page) pixels. */
  rayAt(clientX: number, clientY: number): Ray {
    const rect = this.element.getBoundingClientRect();
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.camera);
    return this.raycaster.ray;
  }

  private applyPose(): void {
    const { camera, pose } = this;
    const distance = poseDistance(pose);
    camera.up.copy(UP);
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
    camera.near = Math.max(1, distance * 0.02);
    camera.far = distance * 100 + 200_000;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    this.options.onChange();
  }

  private stopAnimation(): void {
    if (this.animation !== null) {
      cancelAnimationFrame(this.animation);
      this.animation = null;
    }
  }

  /** The plane facing the camera that passes through a point. Panning slides along it. */
  private screenPlaneThrough(point: Vector3): Plane {
    return new Plane().setFromNormalAndCoplanarPoint(viewDirection(this.pose), point);
  }

  /**
   * The world point under the cursor: geometry or the floor when the ray hits
   * them, otherwise the spot at the same depth as the camera's target.
   */
  private worldPointAt(clientX: number, clientY: number): Vector3 {
    const ray = this.rayAt(clientX, clientY);
    const hit = this.options.pick(ray);
    if (hit) return hit;
    const fallback = ray.intersectPlane(this.screenPlaneThrough(this.pose.target), new Vector3());
    return fallback ?? this.pose.target.clone();
  }

  private dragModeFor(event: PointerEvent): DragMode | null {
    if (event.pointerType === 'mouse') {
      if (event.button === 1) return event.shiftKey ? 'pan' : 'orbit';
      if (event.button === 2) return 'pan';
      if (event.button !== 0) return null;
    }
    const tool = this.options.getTool();
    if (tool === 'orbit' && event.shiftKey) return 'pan';
    return tool;
  }

  private beginDrag(mode: DragMode, pointerId: number, x: number, y: number): void {
    this.drag = { mode, pointerId, lastX: x, lastY: y, anchor: this.worldPointAt(x, y) };
  }

  private beginPinch(): void {
    const [a, b] = [...this.touches.values()];
    if (!a || !b) return;
    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2;
    this.drag = null;
    this.pinch = {
      anchor: this.worldPointAt(x, y),
      lastX: x,
      lastY: y,
      lastSpread: Math.hypot(a.x - b.x, a.y - b.y),
    };
  }

  /** Slides the camera so the anchor point follows the cursor from one screen position to the next. */
  private panBetween(anchor: Vector3, fromX: number, fromY: number, toX: number, toY: number): void {
    const plane = this.screenPlaneThrough(anchor);
    const before = this.rayAt(fromX, fromY).intersectPlane(plane, new Vector3());
    const after = this.rayAt(toX, toY).intersectPlane(plane, new Vector3());
    if (!before || !after) return;
    this.pose = panPose(this.pose, before.sub(after));
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.stopAnimation();
    this.element.setPointerCapture(event.pointerId);

    if (event.pointerType === 'touch') {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touches.size === 1) {
        const tool = this.options.getTool();
        if (tool) this.beginDrag(tool, event.pointerId, event.clientX, event.clientY);
      } else if (this.touches.size === 2) {
        this.beginPinch();
      }
      return;
    }

    const mode = this.dragModeFor(event);
    if (!mode) return;
    event.preventDefault();
    this.beginDrag(mode, event.pointerId, event.clientX, event.clientY);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch' && this.touches.has(event.pointerId)) {
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pinch) {
        this.updatePinch();
        return;
      }
    }

    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    if (dx === 0 && dy === 0) return;

    if (drag.mode === 'orbit') {
      // Dragging right swings the camera to the left, so the model turns with the hand.
      this.pose = orbitPose(this.pose, drag.anchor, -dx * ORBIT_SPEED, -dy * ORBIT_SPEED);
    } else {
      this.panBetween(drag.anchor, drag.lastX, drag.lastY, event.clientX, event.clientY);
    }
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    this.applyPose();
  };

  private updatePinch(): void {
    const pinch = this.pinch;
    const [a, b] = [...this.touches.values()];
    if (!pinch || !a || !b) return;

    const x = (a.x + b.x) / 2;
    const y = (a.y + b.y) / 2;
    const spread = Math.hypot(a.x - b.x, a.y - b.y);

    this.panBetween(pinch.anchor, pinch.lastX, pinch.lastY, x, y);
    if (spread > 0 && pinch.lastSpread > 0) {
      this.pose = zoomPose(this.pose, pinch.anchor, pinch.lastSpread / spread);
    }
    pinch.lastX = x;
    pinch.lastY = y;
    pinch.lastSpread = spread;
    this.applyPose();
  }

  private readonly onPointerEnd = (event: PointerEvent): void => {
    if (this.element.hasPointerCapture(event.pointerId)) {
      this.element.releasePointerCapture(event.pointerId);
    }
    if (event.pointerType === 'touch') {
      this.touches.delete(event.pointerId);
      // Lifting one finger of a pinch ends the gesture. The finger still down
      // does nothing until it lifts, so the view never jumps.
      this.pinch = null;
      this.drag = null;
      return;
    }
    if (this.drag?.pointerId === event.pointerId) {
      this.drag = null;
    }
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.stopAnimation();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    const delta = Math.max(-400, Math.min(400, event.deltaY * unit));
    const speed = event.ctrlKey ? PINCH_WHEEL_ZOOM_SPEED : WHEEL_ZOOM_SPEED;
    const point = this.worldPointAt(event.clientX, event.clientY);
    this.pose = zoomPose(this.pose, point, Math.exp(delta * speed));
    this.applyPose();
  };

  private readonly onContextMenu = (event: Event): void => {
    event.preventDefault();
  };

  /** Stops the browser's own middle-button autoscroll from starting on top of an orbit. */
  private readonly onMouseDown = (event: MouseEvent): void => {
    if (event.button === 1) event.preventDefault();
  };
}
