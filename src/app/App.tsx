import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { boardDimensions } from '../core/board';
import { usualSize } from '../core/cabinet';
import type { Editor, EditorState, ToolId } from '../core/editor';
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
import { CabinetPanel } from './CabinetPanel';
import { CutListPanel } from './CutListPanel';
import type { ViewName } from '../viewport/camera-math';
import type { FloorPoint } from '../viewport/engine';
import { Viewport, type ViewportHandle } from '../viewport/Viewport';
import { Inspector } from './Inspector';
import { ProjectBar, ReplaceDialog, useProject } from './ProjectBar';
import { StockPicker } from './StockPicker';
import {
  BoardIcon,
  CabinetIcon,
  CloseIcon,
  FitIcon,
  HelpIcon,
  LogoMark,
  MoveIcon,
  OrbitIcon,
  PanIcon,
  PullIcon,
  RedoIcon,
  RotateIcon,
  SelectIcon,
  TapeIcon,
  UndoIcon,
} from './icons';

const HELP_SEEN_KEY = 'cabbage.help-seen';
/** Changes when the controls change enough that the card is worth showing once more. */
const HELP_VERSION = 'cabinets';

const VIEWS: readonly { view: ViewName; label: string }[] = [
  { view: 'front', label: 'Front' },
  { view: 'right', label: 'Right' },
  { view: 'top', label: 'Top' },
  { view: 'home', label: 'Home' },
];

const TOOLS: readonly { id: ToolId; label: string; key: string; Icon: () => React.JSX.Element }[] = [
  { id: 'select', label: 'Select', key: 'Space', Icon: SelectIcon },
  { id: 'board', label: 'Board', key: 'B', Icon: BoardIcon },
  { id: 'cabinet', label: 'Cabinet', key: 'C', Icon: CabinetIcon },
  { id: 'pull', label: 'Pull', key: 'P', Icon: PullIcon },
  { id: 'move', label: 'Move', key: 'M', Icon: MoveIcon },
  { id: 'rotate', label: 'Rotate', key: 'R', Icon: RotateIcon },
  { id: 'tape', label: 'Tape', key: 'T', Icon: TapeIcon },
  { id: 'orbit', label: 'Orbit', key: 'O', Icon: OrbitIcon },
  { id: 'pan', label: 'Pan', key: 'H', Icon: PanIcon },
];

const NAVIGATION_HINTS: Partial<Record<ToolId, string>> = {
  orbit: 'Drag to orbit. Scroll to zoom toward the cursor. Hold Shift and drag to pan.',
  pan: 'Drag to pan. Scroll to zoom toward the cursor.',
};

/** Tools that measure nothing themselves, so the measurement box describes the selection instead. */
const SELECTION_TOOLS: ReadonlySet<ToolId> = new Set(['select', 'orbit', 'pan']);

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
  if (!SELECTION_TOOLS.has(state.tool)) return state.measurement;
  const { selection, document, units } = state;
  if (selection.size === 1) {
    const board = document.boards.find((candidate) => selection.has(candidate.id));
    if (board) {
      const { length, width, thickness } = boardDimensions(board);
      const sizes = [length, width, thickness].map((size) => formatLength(size, units));
      return { label: board.name, value: sizes.join(' x ') };
    }
    const cabinet = document.cabinets.find((candidate) => selection.has(candidate.id));
    if (cabinet) {
      const sizes = [cabinet.width, cabinet.height, cabinet.depth].map((size) => formatLength(size, units));
      return { label: cabinet.name, value: sizes.join(' x ') };
    }
  }
  if (selection.size > 1) return { label: 'Selected', value: `${selection.size} items` };
  if (selection.size === 1) return { label: 'Selected', value: 'Guide' };
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
  const [cutListOpen, setCutListOpen] = useState(false);
  const viewportRef = useRef<ViewportHandle>(null);
  const { units, tool, document: model, selection } = state;

  const fitView = useCallback(() => viewportRef.current?.fit(), []);
  const project = useProject(editor, fitView);
  const selectedBoards = useMemo(
    () => model.boards.filter((board) => selection.has(board.id)),
    [model.boards, selection],
  );
  const selectedCabinets = useMemo(
    () => model.cabinets.filter((cabinet) => selection.has(cabinet.id)),
    [model.cabinets, selection],
  );

  const closeHelp = useCallback(() => {
    setHelpOpen(false);
    try {
      window.localStorage.setItem(HELP_SEEN_KEY, HELP_VERSION);
    } catch {
      // Storage can be unavailable. The card simply shows again next visit.
    }
  }, []);

  const addSampleCabinet = useCallback(() => {
    // A base cabinet with its front left corner at the origin.
    const { depth } = usualSize('base', editor.getState().units.system);
    editor.placeCabinet([0, depth, 0], undefined, 'base');
    viewportRef.current?.fit();
  }, [editor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // File keys work even while typing in a box, and never reach the browser's own Save and Open.
      const fileKey = (event.ctrlKey || event.metaKey) && !event.altKey ? event.key.toLowerCase() : '';
      if (fileKey === 's' || fileKey === 'o') {
        event.preventDefault();
        if (event.repeat) return;
        if (fileKey === 's') void project.save(event.shiftKey);
        else project.request('open');
        return;
      }
      if (isTypingTarget(event.target) || project.asking) return;
      // Holding a modifier key down repeats it. Only the first press counts.
      if (event.repeat && (event.key === 'Control' || event.key === 'Meta')) return;
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
        } else if (event.key.toLowerCase() === 'l') {
          setCutListOpen((open) => !open);
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
  }, [editor, tools, closeHelp, project]);

  return (
    <div className="app" data-cutlist={cutListOpen || undefined}>
      <header className="topbar">
        <div className="topbar-start">
          <div className="brand">
            <LogoMark />
            <span className="brand-name">Cabbage</span>
            <span className="chip">Milestone 5 preview</span>
          </div>
          <ProjectBar editor={editor} state={state} project={project} />
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
            className="toggle-button"
            aria-pressed={cutListOpen}
            title="Cut list (L)"
            onClick={() => setCutListOpen((open) => !open)}
          >
            Cut list
          </button>
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
        <div className="view-area">
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

          {model.boards.length === 0 && model.cabinets.length === 0 && !helpOpen && SELECTION_TOOLS.has(tool) && (
            <div className="empty-card">
              <p>
                <strong>Nothing here yet.</strong> Press <kbd>C</kbd> and click to place a cabinet, or{' '}
                <kbd>B</kbd> and click two corners on the floor to draw a board.
              </p>
              <button type="button" className="text-button" onClick={addSampleCabinet}>
                Add a base cabinet
              </button>
            </div>
          )}

          <StockPicker
            editor={editor}
            stock={state.stock}
            materials={model.materials}
            units={units}
            cabinetKind={tool === 'cabinet' ? state.cabinetKind : null}
          />

          {/* One kind of thing at a time gets a panel. A mixed selection can still be moved, turned, and deleted. */}
          {selectedBoards.length > 0 && selectedCabinets.length === 0 && !helpOpen && (
            <Inspector editor={editor} boards={selectedBoards} materials={model.materials} units={units} />
          )}
          {selectedCabinets.length > 0 && selectedBoards.length === 0 && !helpOpen && (
            <CabinetPanel editor={editor} cabinets={selectedCabinets} materials={model.materials} units={units} />
          )}

          {helpOpen && <HelpCard onClose={closeHelp} onAddSample={addSampleCabinet} />}

          {project.notice && (
            <p className="notice" role="status">
              {project.notice}
            </p>
          )}
        </div>

        {cutListOpen && (
          <CutListPanel
            editor={editor}
            document={model}
            selection={selection}
            units={units}
            onClose={() => setCutListOpen(false)}
          />
        )}
      </main>

      {project.asking && (
        <ReplaceDialog kind={project.asking} unsaved={state.unsaved} name={model.name} project={project} />
      )}

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
  const drawing = !SELECTION_TOOLS.has(state.tool);
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

      <h3>Every tool</h3>
      <dl>
        <dt>Type a size</dt>
        <dd>
          Just type and press Enter. No need to click a box first. Sums work: <kbd>36 - 3/4 * 2</kbd>. Typing
          again right after a step corrects it.
        </dd>
        <dt>Lock an axis</dt>
        <dd>
          <kbd>→</kbd> X, <kbd>←</kbd> Y, <kbd>↑</kbd> Z, <kbd>↓</kbd> free. Or hold <kbd>Shift</kbd> to keep
          the axis you are on.
        </dd>
        <dt>Back out</dt>
        <dd>
          <kbd>Esc</kbd> cancels the step. <kbd>Ctrl</kbd> <kbd>Z</kbd> undoes, with <kbd>Shift</kbd> to redo.
        </dd>
      </dl>

      <h3>
        Board <kbd>B</kbd>
      </h3>
      <p>
        Click a corner, click the opposite corner, then set the thickness or press Enter. Type{' '}
        <kbd>24, 34 1/2</kbd> for both sizes. Arrow keys stand the board up.
      </p>

      <h3>
        Cabinet <kbd>C</kbd>
      </h3>
      <p>
        Pick base, wall, or tall at the top left, then click to place one. It is held by a back corner, so
        clicking the back corner of another cabinet sets it alongside. Type a width, or{' '}
        <kbd>30, 34 1/2, 24</kbd> for width, height, and depth. Select a cabinet to change its size, toe kick,
        shelves, and material, or to unlock it into plain boards.
      </p>

      <h3>
        Pull <kbd>P</kbd>
      </h3>
      <p>
        Click a face, move, click. Type a distance, or <kbd>=30</kbd> to set the full size. On a cabinet, an
        outside face resizes the whole cabinet.
      </p>

      <h3>
        Move <kbd>M</kbd>
      </h3>
      <p>
        Click a point on a board or cabinet, then click where that point goes. <kbd>Ctrl</kbd> makes a copy. After a
        copy, type <kbd>3x</kbd> for three in a row or <kbd>/3</kbd> to space three evenly.
      </p>

      <h3>
        Rotate <kbd>R</kbd>
      </h3>
      <p>
        Click the point to turn about, then type <kbd>90</kbd>. Or click a point to grab and swing it
        around. Turns are in quarter turns for now.
      </p>

      <h3>
        Tape <kbd>T</kbd>
      </h3>
      <p>
        Click two points to measure. Start on an edge to pull a guide off it, then click or type its offset.
      </p>

      <h3>
        Select <kbd>Space</kbd>
      </h3>
      <p>
        Click a board, cabinet, or guide. Shift and click adds or removes. Drag a box to the right for what is inside
        it, to the left for anything it touches. <kbd>Delete</kbd> removes the selection.
      </p>

      <h3>Board details</h3>
      <p>
        Select boards to name them, pick their material, set the grain, and band edges. Banded edges show
        darker. The material and thickness for new boards are picked at the top left.
      </p>

      <h3>
        Cut list <kbd>L</kbd>
      </h3>
      <p>
        Lists every board as a part, with identical parts counted together. Click a line to select its boards.
        Type in the Part column to rename them all. Export it for a spreadsheet, or print it.
      </p>

      <h3>Files</h3>
      <p>
        <kbd>Ctrl</kbd> <kbd>S</kbd> saves the project to a file and <kbd>Ctrl</kbd> <kbd>O</kbd> opens one. Your
        work is also kept in this browser as you go.
      </p>

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
        Want something to look at?{' '}
        <button type="button" className="text-button" onClick={onAddSample}>
          Add a base cabinet
        </button>
      </p>
    </aside>
  );
}
