import { PerspectiveCamera, Vector3, WebGLRenderer } from 'three';
import type { Box } from '../core/board';
import type { Editor } from '../core/editor';
import { chooseGridSteps } from '../core/grid';
import { NM_PER_MM, mm, toMm, type Length } from '../core/units';
import type { Vec3L } from '../core/vec';
import { DEFAULT_SNAP_TOLERANCE, toMillimeters } from '../inference/inference';
import type { ToolPointer } from '../tools/tool';
import type { ToolManager } from '../tools/tool-manager';
import { CameraController } from './camera-controller';
import {
  fitDistance,
  poseDistance,
  poseFromDirection,
  viewDirection,
  viewDirectionFor,
  worldPerPixel,
  type ViewName,
} from './camera-math';
import { clipToView, type ScreenPoint } from './clip';
import { ViewportOverlay } from './overlay';
import { ViewportScene } from './scene';

export interface FloorPoint {
  x: Length;
  y: Length;
}

export interface ViewportCallbacks {
  /** Reports the point on the floor under the cursor, or null when the cursor leaves. */
  onFloorPoint: (point: FloorPoint | null) => void;
  onGridChange: (minor: Length) => void;
}

const FIELD_OF_VIEW = 32;
/** Extra room around the model when framing it, so it never touches the edges. */
const FIT_MARGIN = 1.2;
/** A fingertip covers more than a mouse pointer, so it reaches further for snaps. */
const TOUCH_SNAP_TOLERANCE = 18;
const NO_OVERRIDES: ReadonlyMap<string, Box> = new Map();
/** Guides have no ends. This is how far each way they are drawn, in millimeters. */
const GUIDE_REACH = 1_000_000;

interface Cursor {
  clientX: number;
  clientY: number;
  shiftKey: boolean;
  tolerance: number;
}

/**
 * The 3D view: it draws the model, moves the camera, and passes pointer input
 * to the active tool. It reads everything it draws from the editor and the
 * tools, and changes the model only through them.
 */
export class ViewportEngine {
  private readonly renderer: WebGLRenderer;
  private readonly canvas: HTMLCanvasElement;
  private readonly scene = new ViewportScene();
  private readonly camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 1, 1_000_000);
  private readonly verticalFov = (FIELD_OF_VIEW * Math.PI) / 180;
  private readonly controller: CameraController;
  private readonly overlay: ViewportOverlay;
  private readonly resizeObserver: ResizeObserver;
  private readonly unsubscribe: (() => void)[] = [];

  private width = 0;
  private height = 0;
  private frame: number | null = null;
  private rendering = false;
  private framedOnce = false;
  private lastGridMinor: Length | null = null;

  /** Where the mouse is, while it is over the view. */
  private cursor: Cursor | null = null;
  /** Set when the camera or the model moved under a still cursor, so the tool should look again. */
  private lookAgain = false;
  private floorStale = false;
  private pressed = false;
  private readonly touches = new Set<number>();
  /** The finger that started the current touch, and whether more fingers joined it. */
  private gesture: { id: number; multi: boolean } | null = null;
  private readonly scratch = new Vector3();

  constructor(
    private readonly container: HTMLElement,
    private readonly editor: Editor,
    private readonly tools: ToolManager,
    private readonly callbacks: ViewportCallbacks,
  ) {
    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    this.canvas.className = 'viewport-canvas';
    container.appendChild(this.canvas);
    this.overlay = new ViewportOverlay(container);

    this.syncModel();
    this.controller = new CameraController(this.canvas, this.camera, this.homePose(), {
      pick: (ray) => this.scene.pick(ray, poseDistance(this.controller.getPose()) * 12),
      getTool: () => {
        const { tool } = this.editor.getState();
        return tool === 'orbit' || tool === 'pan' ? tool : null;
      },
      onChange: () => {
        this.lookAgain = true;
        this.requestRender();
      },
    });

    let { document } = editor.getState();
    this.unsubscribe.push(
      editor.subscribe(() => {
        const next = editor.getState().document;
        if (next !== document) {
          document = next;
          this.lookAgain = true;
        }
        this.requestRender();
      }),
      tools.subscribe(this.requestRender),
    );

    const canvas = this.canvas;
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('pointerleave', this.onPointerLeave);

    this.resizeObserver = new ResizeObserver(this.resize);
    this.resizeObserver.observe(container);
    this.resize();

    if (import.meta.env.DEV) {
      // A handle for browser tests and for poking at the view from the console.
      (window as unknown as { __cabbage?: unknown }).__cabbage = {
        controller: this.controller,
        scene: this.scene,
        camera: this.camera,
        editor,
        tools,
      };
    }
  }

  /** Swings to a standard view, framed on the model. */
  showView(view: ViewName): void {
    const pose = poseFromDirection(this.scene.modelBounds.center, viewDirectionFor(view), this.framedDistance());
    this.controller.setPose(pose, true);
  }

  /** Frames the whole model without changing the viewing angle. */
  fit(): void {
    const direction = viewDirection(this.controller.getPose());
    const pose = poseFromDirection(this.scene.modelBounds.center, direction, this.framedDistance());
    this.controller.setPose(pose, true);
  }

  dispose(): void {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    for (const unsubscribe of this.unsubscribe) unsubscribe();
    this.resizeObserver.disconnect();
    const canvas = this.canvas;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.controller.dispose();
    this.overlay.dispose();
    this.scene.dispose();
    this.renderer.dispose();
    canvas.remove();
  }

  // Drawing

  private readonly requestRender = (): void => {
    if (this.rendering) return;
    this.frame ??= requestAnimationFrame(this.render);
  };

  private readonly render = (): void => {
    this.frame = null;
    if (this.height === 0) return;
    this.rendering = true;

    if (this.lookAgain) {
      this.lookAgain = false;
      this.floorStale = true;
      if (this.cursor && !this.pressed) this.tools.pointerMove(this.pointerAt(this.cursor));
    }
    if (this.floorStale) {
      this.floorStale = false;
      this.reportFloorPoint();
    }

    const { scene, camera, controller } = this;
    const state = this.editor.getState();
    const preview = this.tools.preview();
    this.syncModel(preview.overrides);
    scene.setPreview(preview);
    this.container.dataset.tool = state.tool;

    const pose = controller.getPose();
    const distance = poseDistance(pose);
    const nmPerPixel = worldPerPixel(distance, this.verticalFov, this.height) * NM_PER_MM;
    const steps = chooseGridSteps(state.units.system, nmPerPixel);
    const reach = Math.max(distance * 40, 5_000);
    scene.setGrid(toMm(steps.minor), toMm(steps.major), pose.target, reach);
    scene.updateAxes(pose.position, viewDirection(pose), camera.near, reach + pose.target.length());
    if (steps.minor !== this.lastGridMinor) {
      this.lastGridMinor = steps.minor;
      this.callbacks.onGridChange(steps.minor);
    }

    this.renderer.render(scene.scene, camera);
    this.overlay.update(
      { preview, guides: state.document.guides, selection: state.selection, hovered: state.hovered },
      { point: (point) => this.project(toMillimeters(point)), segment: this.projectSegment, reach: GUIDE_REACH },
    );
    this.rendering = false;
  };

  private syncModel(overrides: ReadonlyMap<string, Box> = NO_OVERRIDES): void {
    const { document, selection, hovered } = this.editor.getState();
    this.scene.setBoards(document.boards, document.materials, selection, hovered, overrides);
  }

  private framedDistance(): number {
    return fitDistance(this.scene.modelBounds.radius * FIT_MARGIN, this.verticalFov, this.camera.aspect);
  }

  private homePose() {
    return poseFromDirection(this.scene.modelBounds.center, viewDirectionFor('home'), this.framedDistance());
  }

  private readonly resize = (): void => {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (width === 0 || height === 0) return;
    this.width = width;
    this.height = height;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (!this.framedOnce) {
      // The first real size is known only now, so frame the opening view here.
      this.framedOnce = true;
      this.controller.setPose(this.homePose());
    }
    this.lookAgain = true;
    this.requestRender();
  };

  /** Where a point in millimeters lands on screen, in pixels from the view's top left corner. */
  private readonly project = (point: Vector3): { x: number; y: number } | null => {
    const { camera } = this;
    const v = this.scratch.copy(point).applyMatrix4(camera.matrixWorldInverse);
    // Behind the camera, or too close in front of it to place.
    if (v.z > -1e-3) return null;
    v.applyMatrix4(camera.projectionMatrix);
    return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
  };

  /**
   * Where a line between two model points lands on screen, or null when all of
   * it is behind the camera. A line that passes behind the camera is cut off
   * just in front of it, because a point behind the camera has no place on screen.
   */
  private readonly projectSegment = (from: Vec3L, to: Vec3L): [ScreenPoint, ScreenPoint] | null => {
    const { camera } = this;
    const limit = -Math.max(camera.near, 1e-3);
    const a = toMillimeters(from).applyMatrix4(camera.matrixWorldInverse);
    const b = toMillimeters(to).applyMatrix4(camera.matrixWorldInverse);
    if (a.z > limit && b.z > limit) return null;
    if (a.z > limit) a.lerp(b, (limit - a.z) / (b.z - a.z));
    else if (b.z > limit) b.lerp(a, (limit - b.z) / (a.z - b.z));
    const onScreen = (v: Vector3): ScreenPoint => {
      v.applyMatrix4(camera.projectionMatrix);
      return { x: ((v.x + 1) / 2) * this.width, y: ((1 - v.y) / 2) * this.height };
    };
    // Only the part in view is handed on. See clipToView for why that matters.
    return clipToView(onScreen(a), onScreen(b), this.width, this.height);
  };

  // Pointer input

  private pointerAt({ clientX, clientY, shiftKey, tolerance }: Cursor): ToolPointer {
    const rect = this.canvas.getBoundingClientRect();
    return {
      view: {
        ray: this.controller.rayAt(clientX, clientY).clone(),
        cursor: { x: clientX - rect.left, y: clientY - rect.top },
        project: this.project,
        tolerance,
      },
      shiftKey,
      cameraDirection: viewDirection(this.controller.getPose()),
    };
  }

  private cursorFor(event: PointerEvent): Cursor {
    return {
      clientX: event.clientX,
      clientY: event.clientY,
      shiftKey: event.shiftKey,
      tolerance: event.pointerType === 'touch' ? TOUCH_SNAP_TOLERANCE : DEFAULT_SNAP_TOLERANCE,
    };
  }

  private reportFloorPoint(): void {
    if (!this.cursor) {
      this.callbacks.onFloorPoint(null);
      return;
    }
    const ray = this.controller.rayAt(this.cursor.clientX, this.cursor.clientY);
    const point = this.scene.pickFloor(ray);
    this.callbacks.onFloorPoint(point ? { x: mm(point.x), y: mm(point.y) } : null);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    // The camera controller hears this event first, so it has already decided whether it is navigation.
    this.container.toggleAttribute('data-dragging', this.controller.isNavigating());
    const cursor = this.cursorFor(event);

    if (event.pointerType === 'touch') {
      this.touches.add(event.pointerId);
      if (this.touches.size === 1) {
        this.gesture = { id: event.pointerId, multi: false };
        // A finger aims while it is down and places when it lifts.
        if (this.tools.active()) this.tools.pointerMove(this.pointerAt(cursor));
      } else if (this.gesture) {
        this.gesture.multi = true;
      }
      return;
    }

    this.cursor = cursor;
    if (event.button === 0 && this.tools.active()) {
      this.pressed = true;
      this.tools.pointerDown(this.pointerAt(cursor));
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const cursor = this.cursorFor(event);
    if (event.pointerType === 'touch') {
      const { gesture } = this;
      if (gesture && !gesture.multi && gesture.id === event.pointerId && this.tools.active()) {
        this.tools.pointerMove(this.pointerAt(cursor));
      }
      return;
    }
    this.cursor = cursor;
    this.floorStale = true;
    if (this.tools.active()) this.tools.pointerMove(this.pointerAt(cursor));
    else this.requestRender();
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.container.toggleAttribute('data-dragging', false);
    const cursor = this.cursorFor(event);

    if (event.pointerType === 'touch') {
      const { gesture } = this;
      this.touches.delete(event.pointerId);
      if (gesture && !gesture.multi && gesture.id === event.pointerId && this.tools.active()) {
        const pointer = this.pointerAt(cursor);
        this.tools.pointerDown(pointer);
        this.tools.pointerUp(pointer);
      }
      if (this.touches.size === 0) this.gesture = null;
      return;
    }

    if (event.button === 0 && this.pressed) {
      this.pressed = false;
      this.tools.pointerUp(this.pointerAt(cursor));
    }
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    this.container.toggleAttribute('data-dragging', false);
    this.touches.delete(event.pointerId);
    if (this.touches.size === 0) this.gesture = null;
    this.pressed = false;
  };

  private readonly onPointerLeave = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch') this.cursor = null;
    this.floorStale = true;
    this.tools.pointerLeave();
  };
}
