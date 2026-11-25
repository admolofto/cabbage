import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { PerspectiveCamera, WebGLRenderer } from 'three';
import { chooseGridSteps } from '../core/grid';
import { NM_PER_MM, mm, toMm, type Length, type UnitSystem } from '../core/units';
import { CameraController, type NavigationTool } from './camera-controller';
import {
  fitDistance,
  poseDistance,
  poseFromDirection,
  viewDirection,
  viewDirectionFor,
  worldPerPixel,
  type ViewName,
} from './camera-math';
import { ViewportScene } from './scene';

export interface FloorPoint {
  x: Length;
  y: Length;
}

export interface ViewportHandle {
  /** Swings to a standard view, framed on the model. */
  showView: (view: ViewName) => void;
  /** Frames the whole model without changing the viewing angle. */
  fit: () => void;
}

interface ViewportProps {
  ref?: Ref<ViewportHandle>;
  tool: NavigationTool;
  unitSystem: UnitSystem;
  /** Reports the point on the floor under the cursor, or null when the cursor leaves. */
  onFloorPoint: (point: FloorPoint | null) => void;
  onGridChange: (minor: Length) => void;
}

const FIELD_OF_VIEW = 32;
/** Extra room around the model when framing it, so it never touches the edges. */
const FIT_MARGIN = 1.2;

export function Viewport({ ref, tool, unitSystem, onFloorPoint, onGridChange }: ViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<ViewportHandle | null>(null);
  const requestRenderRef = useRef<(() => void) | null>(null);

  // The 3D view is set up once. These refs let it read the latest props without being rebuilt.
  const toolRef = useRef(tool);
  const unitSystemRef = useRef(unitSystem);
  const onFloorPointRef = useRef(onFloorPoint);
  const onGridChangeRef = useRef(onGridChange);

  useEffect(() => {
    toolRef.current = tool;
    unitSystemRef.current = unitSystem;
    onFloorPointRef.current = onFloorPoint;
    onGridChangeRef.current = onGridChange;
    requestRenderRef.current?.();
  }, [tool, unitSystem, onFloorPoint, onGridChange]);

  useImperativeHandle(
    ref,
    () => ({
      showView: (view) => handleRef.current?.showView(view),
      fit: () => handleRef.current?.fit(),
    }),
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderer = new WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.className = 'viewport-canvas';
    container.appendChild(canvas);

    const scene = new ViewportScene();
    const camera = new PerspectiveCamera(FIELD_OF_VIEW, 1, 1, 1_000_000);
    const verticalFov = (FIELD_OF_VIEW * Math.PI) / 180;

    let frame: number | null = null;
    let lastGridMinor: Length | null = null;

    const render = () => {
      frame = null;
      const height = container.clientHeight;
      if (height === 0) return;

      const pose = controller.getPose();
      const distance = poseDistance(pose);
      const nmPerPixel = worldPerPixel(distance, verticalFov, height) * NM_PER_MM;
      const steps = chooseGridSteps(unitSystemRef.current, nmPerPixel);
      const reach = Math.max(distance * 40, 5_000);
      scene.setGrid(toMm(steps.minor), toMm(steps.major), pose.target, reach);
      scene.updateAxes(pose.position, viewDirection(pose), camera.near, reach + pose.target.length());
      if (steps.minor !== lastGridMinor) {
        lastGridMinor = steps.minor;
        onGridChangeRef.current(steps.minor);
      }
      renderer.render(scene.scene, camera);
    };

    const requestRender = () => {
      frame ??= requestAnimationFrame(render);
    };
    requestRenderRef.current = requestRender;

    const framedDistance = () =>
      fitDistance(scene.modelBounds.radius * FIT_MARGIN, verticalFov, camera.aspect);

    const controller: CameraController = new CameraController(
      canvas,
      camera,
      poseFromDirection(scene.modelBounds.center, viewDirectionFor('home'), framedDistance()),
      {
        pick: (ray) => scene.pick(ray, poseDistance(controller.getPose()) * 12),
        getTool: () => toolRef.current,
        onChange: requestRender,
      },
    );

    handleRef.current = {
      showView: (view) => {
        const pose = poseFromDirection(scene.modelBounds.center, viewDirectionFor(view), framedDistance());
        controller.setPose(pose, true);
      },
      fit: () => {
        const direction = viewDirection(controller.getPose());
        controller.setPose(poseFromDirection(scene.modelBounds.center, direction, framedDistance()), true);
      },
    };

    let framedOnce = false;
    const resize = () => {
      const { clientWidth: width, clientHeight: height } = container;
      if (width === 0 || height === 0) return;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (!framedOnce) {
        // The first real size is known only now, so frame the opening view here.
        framedOnce = true;
        controller.setPose(
          poseFromDirection(scene.modelBounds.center, viewDirectionFor('home'), framedDistance()),
        );
      }
      requestRender();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    let pendingHover: { x: number; y: number } | null = null;
    let hoverFrame: number | null = null;
    const reportHover = () => {
      hoverFrame = null;
      if (!pendingHover) return;
      const point = scene.pickFloor(controller.rayAt(pendingHover.x, pendingHover.y));
      onFloorPointRef.current(point ? { x: mm(point.x), y: mm(point.y) } : null);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      pendingHover = { x: event.clientX, y: event.clientY };
      hoverFrame ??= requestAnimationFrame(reportHover);
    };
    const onPointerLeave = () => {
      pendingHover = null;
      onFloorPointRef.current(null);
    };
    const setDragging = (dragging: boolean) => () => {
      container.toggleAttribute('data-dragging', dragging);
    };
    const startDragging = setDragging(true);
    const stopDragging = setDragging(false);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('pointerdown', startDragging);
    canvas.addEventListener('pointerup', stopDragging);
    canvas.addEventListener('pointercancel', stopDragging);

    if (import.meta.env.DEV) {
      // A handle for browser tests and for poking at the camera from the console.
      (window as unknown as { __cabbage?: unknown }).__cabbage = { controller, scene, camera };
    }

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      if (hoverFrame !== null) cancelAnimationFrame(hoverFrame);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('pointerdown', startDragging);
      canvas.removeEventListener('pointerup', stopDragging);
      canvas.removeEventListener('pointercancel', stopDragging);
      controller.dispose();
      scene.dispose();
      renderer.dispose();
      canvas.remove();
      handleRef.current = null;
      requestRenderRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="viewport" data-tool={tool} />;
}
