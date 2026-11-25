import { useCallback, useEffect, useRef, useState } from 'react';
import {
  IMPERIAL_PRECISIONS,
  METRIC_PRECISIONS,
  describeImperialPrecision,
  describeMetricPrecision,
  formatLength,
  formatLengthParts,
  type ImperialPrecision,
  type Length,
  type MetricPrecision,
  type UnitSettings,
} from '../core/units';
import type { NavigationTool } from '../viewport/camera-controller';
import type { ViewName } from '../viewport/camera-math';
import { Viewport, type FloorPoint, type ViewportHandle } from '../viewport/Viewport';
import { CloseIcon, FitIcon, HelpIcon, LogoMark, OrbitIcon, PanIcon } from './icons';
import { useUnitSettings } from './use-unit-settings';

const HELP_SEEN_KEY = 'cabbage.help-seen';

const VIEWS: readonly { view: ViewName; label: string; key: string }[] = [
  { view: 'front', label: 'Front', key: '1' },
  { view: 'right', label: 'Right', key: '2' },
  { view: 'top', label: 'Top', key: '3' },
  { view: 'home', label: 'Home', key: '4' },
];

const TOOL_HINTS: Record<NavigationTool, string> = {
  orbit: 'Drag to orbit. Scroll to zoom toward the cursor. Hold Shift and drag to pan.',
  pan: 'Drag to pan. Scroll to zoom toward the cursor.',
};

function helpSeenBefore(): boolean {
  try {
    return window.localStorage.getItem(HELP_SEEN_KEY) === 'yes';
  } catch {
    return false;
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function App() {
  const [units, updateUnits] = useUnitSettings();
  const [tool, setTool] = useState<NavigationTool>('orbit');
  const [floorPoint, setFloorPoint] = useState<FloorPoint | null>(null);
  const [gridMinor, setGridMinor] = useState<Length | null>(null);
  const [helpOpen, setHelpOpen] = useState(() => !helpSeenBefore());
  const viewportRef = useRef<ViewportHandle>(null);

  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    try {
      window.localStorage.setItem(HELP_SEEN_KEY, 'yes');
    } catch {
      // Storage can be unavailable. The card simply shows again next visit.
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === 'o') setTool('orbit');
      else if (key === 'h') setTool('pan');
      else if (key === 'f') viewportRef.current?.fit();
      else if (key === '?') setHelpOpen((open) => !open);
      else if (key === 'escape') closeHelp();
      else {
        const match = VIEWS.find((entry) => entry.key === key);
        if (!match) return;
        viewportRef.current?.showView(match.view);
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeHelp]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <LogoMark />
          <span className="brand-name">Cabbage</span>
          <span className="chip">Milestone 1 preview</span>
        </div>
        <div className="topbar-controls">
          <UnitControls units={units} onChange={updateUnits} />
          <button
            type="button"
            className="icon-button"
            aria-label="Show controls"
            aria-pressed={helpOpen}
            title="Controls (?)"
            onClick={() => (helpOpen ? closeHelp() : setHelpOpen(true))}
          >
            <HelpIcon />
          </button>
        </div>
      </header>

      <main className="stage">
        <Viewport
          ref={viewportRef}
          tool={tool}
          unitSystem={units.system}
          onFloorPoint={setFloorPoint}
          onGridChange={setGridMinor}
        />

        <nav className="toolrail" aria-label="Navigation tools">
          <button
            type="button"
            className="tool-button"
            aria-label="Orbit"
            aria-pressed={tool === 'orbit'}
            title="Orbit (O)"
            onClick={() => setTool('orbit')}
          >
            <OrbitIcon />
          </button>
          <button
            type="button"
            className="tool-button"
            aria-label="Pan"
            aria-pressed={tool === 'pan'}
            title="Pan (H)"
            onClick={() => setTool('pan')}
          >
            <PanIcon />
          </button>
          <span className="toolrail-divider" />
          <button
            type="button"
            className="tool-button"
            aria-label="Fit model in view"
            title="Fit model in view (F)"
            onClick={() => viewportRef.current?.fit()}
          >
            <FitIcon />
          </button>
        </nav>

        <div className="viewbar" role="group" aria-label="Standard views">
          {VIEWS.map(({ view, label, key }) => (
            <button
              key={view}
              type="button"
              className="view-button"
              title={`${label} view (${key})`}
              onClick={() => viewportRef.current?.showView(view)}
            >
              {label}
            </button>
          ))}
        </div>

        {helpOpen && <HelpCard onClose={closeHelp} />}
      </main>

      <footer className="statusbar">
        <span className="status-hint">{TOOL_HINTS[tool]}</span>
        <span className="status-readouts">
          {floorPoint && (
            <span className="readout" title="Where the cursor meets the floor">
              <span className="readout-label">Floor</span>
              <span className="axis-x">X</span> {formatLengthParts(floorPoint.x, units).text}
              <span className="axis-y">Y</span> {formatLengthParts(floorPoint.y, units).text}
            </span>
          )}
          {gridMinor !== null && (
            <span className="readout" title="Spacing of the fine grid lines">
              <span className="readout-label">Grid</span>
              {formatLength(gridMinor, units)}
            </span>
          )}
        </span>
      </footer>
    </div>
  );
}

interface UnitControlsProps {
  units: UnitSettings;
  onChange: (change: Partial<UnitSettings>) => void;
}

function UnitControls({ units, onChange }: UnitControlsProps) {
  const imperial = units.system === 'imperial';
  return (
    <div className="unit-controls">
      <div className="segmented" role="group" aria-label="Units">
        <button type="button" aria-pressed={imperial} onClick={() => onChange({ system: 'imperial' })}>
          Inches
        </button>
        <button type="button" aria-pressed={!imperial} onClick={() => onChange({ system: 'metric' })}>
          Millimeters
        </button>
      </div>
      <label className="precision">
        <span className="precision-label">Show to</span>
        {imperial ? (
          <select
            value={units.imperialPrecision}
            onChange={(event) =>
              onChange({ imperialPrecision: Number(event.target.value) as ImperialPrecision })
            }
          >
            {IMPERIAL_PRECISIONS.map((precision) => (
              <option key={precision} value={precision}>
                {describeImperialPrecision(precision)}
              </option>
            ))}
          </select>
        ) : (
          <select
            value={units.metricPrecision}
            onChange={(event) =>
              onChange({ metricPrecision: Number(event.target.value) as MetricPrecision })
            }
          >
            {METRIC_PRECISIONS.map((precision) => (
              <option key={precision} value={precision}>
                {describeMetricPrecision(precision)}
              </option>
            ))}
          </select>
        )}
      </label>
    </div>
  );
}

function HelpCard({ onClose }: { onClose: () => void }) {
  return (
    <aside className="help-card" aria-label="Controls">
      <header className="help-header">
        <h2>Getting around</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>

      <h3>Mouse</h3>
      <dl>
        <dt>Orbit</dt>
        <dd>Drag with the middle button</dd>
        <dt>Pan</dt>
        <dd>Shift and middle drag, or right drag</dd>
        <dt>Zoom</dt>
        <dd>Scroll. The view zooms toward the cursor</dd>
        <dt>Left drag</dt>
        <dd>Uses the tool picked on the left: Orbit or Pan</dd>
      </dl>

      <h3>Touch</h3>
      <dl>
        <dt>One finger</dt>
        <dd>Uses the tool picked on the left</dd>
        <dt>Two fingers</dt>
        <dd>Drag to pan, pinch to zoom</dd>
      </dl>

      <h3>Keys</h3>
      <dl>
        <dt>
          <kbd>O</kbd> <kbd>H</kbd>
        </dt>
        <dd>Orbit tool, Pan tool</dd>
        <dt>
          <kbd>F</kbd>
        </dt>
        <dd>Fit the model in view</dd>
        <dt>
          <kbd>1</kbd> to <kbd>4</kbd>
        </dt>
        <dd>Front, Right, Top, Home</dd>
      </dl>

      <p className="help-note">
        The cabinet is a placeholder for judging scale. It is 30" wide, 34 1/2" tall, and 24" deep.
      </p>
    </aside>
  );
}
