import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import type { Editor } from '../core/editor';
import type { ToolManager } from '../tools/tool-manager';
import type { ViewName } from './camera-math';
import { ViewportEngine, type ViewportCallbacks } from './engine';

export interface ViewportHandle {
  /** Swings to a standard view, framed on the model. */
  showView: (view: ViewName) => void;
  /** Frames the whole model without changing the viewing angle. */
  fit: () => void;
}

interface ViewportProps extends ViewportCallbacks {
  ref?: Ref<ViewportHandle>;
  editor: Editor;
  tools: ToolManager;
}

/** Puts the 3D view on the page. All of the real work is in `ViewportEngine`. */
export function Viewport({ ref, editor, tools, onFloorPoint, onGridChange }: ViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ViewportEngine | null>(null);

  // The engine is set up once. This ref lets it reach the latest callbacks without being rebuilt.
  const callbacksRef = useRef<ViewportCallbacks>({ onFloorPoint, onGridChange });
  useEffect(() => {
    callbacksRef.current = { onFloorPoint, onGridChange };
  }, [onFloorPoint, onGridChange]);

  useImperativeHandle(
    ref,
    () => ({
      showView: (view) => engineRef.current?.showView(view),
      fit: () => engineRef.current?.fit(),
    }),
    [],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const engine = new ViewportEngine(container, editor, tools, {
      onFloorPoint: (point) => callbacksRef.current.onFloorPoint(point),
      onGridChange: (minor) => callbacksRef.current.onGridChange(minor),
    });
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, [editor, tools]);

  return <div ref={containerRef} className="viewport" />;
}
