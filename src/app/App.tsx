import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { boardDimensions } from '../core/board';
import type { Editor, EditorState, ToolId } from '../core/editor';
import { createSampleCabinet } from '../core/sample-cabinet';
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
import type { ToolManager } from '../tools/tool-manager';
import type { ViewName } from '../viewport/camera-math';
import type { FloorPoint } from '../viewport/engine';
import { Viewport, type ViewportHandle } from '../viewport/Viewport';
import {
  BoardIcon,
  CloseIcon,
  FitIcon,
  HelpIcon,
  LogoMark,
  OrbitIcon,
  PanIcon,
  RedoIcon,
  SelectIcon,
  UndoIcon,
} from './icons';

const HELP_SEEN_KEY = 'cabbage.help-seen';
/** Changes when the controls change enough that the card is worth showing once more. */
const HELP_VERSION = 'draw-boards';

const VIEWS: readonly { view: ViewName; label: string }[] = [
  { view: 'front', label: 'Front' },
  { view: 'right', label: 'Right' },
  { view: 'top', label: 'Top' },
  { view: 'home', label: 'Home' },
];

const TOOLS: readonly { id: ToolId; label: string; key: string; Icon: () => React.JSX.Element }[] = [
  { id: 'select', label: 'Select', key: 'Space', Icon: SelectIcon },
  { id: 'board', label: 'Board', key: 'B', Icon: BoardIcon },
  { id: 'orbit', label: 'Orbit', key: 'O', Icon: OrbitIcon },
  { id: 'pan', label: 'Pan', key: 'H', Icon: PanIcon },
];

const NAVIGATION_HINTS: Partial<Record<ToolId, string>> = {
  orbit: 'Drag to orbit. Scroll to zoom toward the cursor. Hold Shift and drag to pan.',
  pan: 'Drag to pan. Scroll to zoom toward the cursor.',
};

function helpSeenBefore(): boolean {
  try {
    return window.localStorage.getItem(HELP_SEEN_KEY) === HELP_VERSION;
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

/** What the measurement box shows: the active tool's own reading, or the size of the selection. */
function measurementFor(state: EditorState): { label: string; value: string } {
  if (state.tool === 'board') return state.measurement;
  const { selection, document, units } = state;
  if (selection.size === 1) {
    const board = document.boards.find((candidate) => selection.has(candidate.id));
    if (board) {
      const { length, width, thickness } = boardDimensions(board);
      const sizes = [length, width, thickness].map((size) => formatLength(size, units));
      return { label: board.name, value: sizes.join(' x ') };
    }
  }
  if (selection.size > 1) return { label: 'Selected', value: `${selection.size} boards` };
  return { label: 'Measurement', value: '' };
}

interface AppProps {
  editor: Editor;
  tools: ToolManager;
}

export function App({ editor, tools }: AppProps) {
  const state = useSyncExternalStore(editor.subscribe, editor.getState);
  const [floorPoint, setFloorPoint] = useState<FloorPoint | null>(null);
  const [gridMinor, setGridMinor] = useState<Length | null>(null);
  const [helpOpen, setHelpOpen] = useState(() => !helpSeenBefore());
  const viewportRef = useRef<ViewportHandle>(null);
  const { units, tool } = state;

  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    try {
      window.localStorage.setItem(HELP_SEEN_KEY, HELP_VERSION);
    } catch {
      // Storage can be unavailable. The card simply shows again next visit.
    }
  }, []);

  const addSampleCabinet = useCallback(() => {
    editor.addBoards(createSampleCabinet(), 'Add sample cabinet');
    viewportRef.current?.fit();
  }, [editor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      // A focused button keeps Space and Enter for itself.
      if (event.target instanceof HTMLButtonElement && (event.key === ' ' || event.key === 'Enter')) return;

      const command = event.ctrlKey || event.metaKey;
      const typing = editor.getState().measurement.typed !== null;
      let used: boolean;
      if (!command && !event.altKey && !typing && event.key === '?') {
        setHelpOpen((open) => !open);
        used = true;
      } else {
        used = tools.key({ key: event.key, command, shift: event.shiftKey, alt: event.altKey });
      }
      if (!used && !command && !event.altKey) {
        if (event.key.toLowerCase() === 'f') {
          viewportRef.current?.fit();
          used = true;
        } else if (event.key === 'Escape') {
          closeHelp();
          used = true;
        }
      }
      if (used) event.preventDefault();
    };

    // A button clicked with the mouse gives the keyboard back, so the next key goes to the tool.
    const onClick = (event: MouseEvent) => {
      const focused = document.activeElement;
      if (event.detail > 0 && focused instanceof HTMLButtonElement) focused.blur();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('click', onClick);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('click', onClick);
    };
  }, [editor, tools, closeHelp]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <LogoMark />
          <span className="brand-name">Cabbage</span>
          <span className="chip">Milestone 2 preview</span>
        </div>
        <div className="topbar-controls">
          <div className="history-controls">
            <button
              type="button"
              className="icon-button"
              aria-label="Undo"
              title={state.undoLabel ? `Undo ${state.undoLabel.toLowerCase()} (Ctrl+Z)` : 'Nothing to undo'}
              disabled={!state.canUndo}
              onClick={() => editor.undo()}
            >
              <UndoIcon />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Redo"
              title={state.redoLabel ? `Redo ${state.redoLabel.toLowerCase()} (Ctrl+Shift+Z)` : 'Nothing to redo'}
              disabled={!state.canRedo}
              onClick={() => editor.redo()}
            >
              <RedoIcon />
            </button>
          </div>
          <UnitControls units={units} onChange={(change) => editor.setUnits(change)} />
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
          editor={editor}
          tools={tools}
          onFloorPoint={setFloorPoint}
          onGridChange={setGridMinor}
        />

        <nav className="toolrail" aria-label="Tools">
          {TOOLS.map(({ id, label, key, Icon }) => (
            <button
              key={id}
              type="button"
              className="tool-button"
              aria-label={label}
              aria-pressed={tool === id}
              title={`${label} (${key})`}
              data-divided={id === 'orbit' || undefined}
              onClick={() => editor.setTool(id)}
            >
              <Icon />
            </button>
          ))}
          <button
            type="button"
            className="tool-button"
            aria-label="Fit model in view"
            title="Fit model in view (F)"
            data-divided
            onClick={() => viewportRef.current?.fit()}
          >
            <FitIcon />
          </button>
        </nav>

        <div className="viewbar" role="group" aria-label="Standard views">
          {VIEWS.map(({ view, label }) => (
            <button
              key={view}
              type="button"
              className="view-button"
              title={`${label} view`}
              onClick={() => viewportRef.current?.showView(view)}
            >
              {label}
            </button>
          ))}
        </div>

        {state.document.boards.length === 0 && !helpOpen && tool !== 'board' && (
          <div className="empty-card">
            <p>
              <strong>Nothing here yet.</strong> Press <kbd>B</kbd> and click two corners on the floor to draw a
              board.
            </p>
            <button type="button" className="text-button" onClick={addSampleCabinet}>
              Add a sample cabinet
            </button>
          </div>
        )}

        {helpOpen && <HelpCard onClose={closeHelp} onAddSample={addSampleCabinet} />}
      </main>

      <footer className="statusbar">
        <span className="status-hint">{NAVIGATION_HINTS[tool] ?? state.hint}</span>
        <span className="status-readouts">
          <MeasurementBox state={state} editor={editor} tools={tools} />
          {floorPoint && (
            <span className="readout readout-floor" title="Where the cursor meets the floor">
              <span className="readout-label">Floor</span>
              <span className="axis-x">X</span> {formatLengthParts(floorPoint.x, units).text}
              <span className="axis-y">Y</span> {formatLengthParts(floorPoint.y, units).text}
            </span>
          )}
          {gridMinor !== null && (
            <span className="readout readout-grid" title="Spacing of the fine grid lines">
              <span className="readout-label">Grid</span>
              {formatLength(gridMinor, units)}
            </span>
          )}
        </span>
      </footer>
    </div>
  );
}

interface MeasurementBoxProps {
  state: EditorState;
  editor: Editor;
  tools: ToolManager;
}

/**
 * Shows what the active tool is measuring. Typing anywhere on the page fills
 * it, and it also works as an ordinary text box for a tablet's keyboard.
 */
function MeasurementBox({ state, editor, tools }: MeasurementBoxProps) {
  const { label, value } = measurementFor(state);
  const { typed, error } = state.measurement;
  const drawing = state.tool === 'board';
  return (
    <label className="measure">
      <span className="readout-label">{label}</span>
      <input
        className="measure-input"
        type="text"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={typed ?? value}
        size={Math.max(14, (typed ?? value).length + 2)}
        readOnly={!drawing}
        data-typing={typed !== null || undefined}
        data-error={error || undefined}
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => {
          if (editor.getState().measurement.typed === '') editor.setTyped(null);
        }}
        onChange={(event) => editor.setTyped(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            if (tools.applyTyped()) event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            editor.setTyped(null);
            event.currentTarget.blur();
          }
        }}
      />
    </label>
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

function HelpCard({ onClose, onAddSample }: { onClose: () => void; onAddSample: () => void }) {
  return (
    <aside className="help-card" aria-label="Controls">
      <header className="help-header">
        <h2>Controls</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>

      <h3>
        Draw a board <kbd>B</kbd>
      </h3>
      <ol>
        <li>Click a corner, then click the opposite corner.</li>
        <li>Move to set the thickness and click, or press Enter to keep the one shown.</li>
      </ol>
      <dl>
        <dt>Type a size</dt>
        <dd>
          Type <kbd>24, 34 1/2</kbd> and press Enter. No need to click a box first. Right after a board is
          drawn, typing <kbd>1/2</kbd> changes its thickness.
        </dd>
        <dt>Stand it up</dt>
        <dd>
          <kbd>→</kbd> <kbd>←</kbd> <kbd>↑</kbd> pick which way the board faces. <kbd>↓</kbd> goes back to
          automatic.
        </dd>
        <dt>Back out</dt>
        <dd>
          <kbd>Esc</kbd> undoes one step of the drawing.
        </dd>
      </dl>

      <h3>
        Select <kbd>Space</kbd>
      </h3>
      <dl>
        <dt>Pick</dt>
        <dd>Click a board. Shift and click adds or removes one.</dd>
        <dt>Delete</dt>
        <dd>
          <kbd>Delete</kbd> removes the selected boards.
        </dd>
        <dt>Undo</dt>
        <dd>
          <kbd>Ctrl</kbd> <kbd>Z</kbd>, and <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>Z</kbd> to redo.
        </dd>
      </dl>

      <h3>Getting around</h3>
      <dl>
        <dt>Orbit</dt>
        <dd>
          Drag with the middle button, or pick Orbit <kbd>O</kbd>
        </dd>
        <dt>Pan</dt>
        <dd>
          Right drag, Shift and middle drag, or pick Pan <kbd>H</kbd>
        </dd>
        <dt>Zoom</dt>
        <dd>Scroll. The view zooms toward the cursor</dd>
        <dt>Fit</dt>
        <dd>
          <kbd>F</kbd> brings the whole model into view
        </dd>
        <dt>Touch</dt>
        <dd>One finger aims and places when it lifts. Two fingers pan and zoom.</dd>
      </dl>

      <p className="help-note">
        Want something to snap to?{' '}
        <button type="button" className="text-button" onClick={onAddSample}>
          Add a sample cabinet
        </button>
      </p>
    </aside>
  );
}
