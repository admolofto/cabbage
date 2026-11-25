import type { Board } from './board';
import {
  EMPTY_DOCUMENT,
  addBoards,
  parseDocument,
  removeBoards,
  replaceBoard,
  type CabbageDocument,
} from './document';
import {
  amend,
  canRedo,
  canUndo,
  commit,
  createHistory,
  redo,
  redoLabel,
  undo,
  undoLabel,
  type History,
} from './history';
import {
  DEFAULT_UNIT_SETTINGS,
  IMPERIAL_PRECISIONS,
  METRIC_PRECISIONS,
  NM_PER_INCH,
  NM_PER_MM,
  inchFraction,
  mm,
  type Length,
  type UnitSettings,
} from './units';

export type ToolId = 'select' | 'board' | 'orbit' | 'pan';

/** The measurement box: what the active tool is measuring, and anything being typed into it. */
export interface MeasurementState {
  label: string;
  value: string;
  /** Text typed so far, or null when nothing is being typed. */
  typed: string | null;
  /** True right after typed text could not be read as a measurement. */
  error: boolean;
}

export interface EditorState {
  document: CabbageDocument;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  selection: ReadonlySet<string>;
  hovered: string | null;
  tool: ToolId;
  units: UnitSettings;
  measurement: MeasurementState;
  hint: string;
}

/** The slice of browser storage the editor needs. Tests pass a plain object. */
export interface EditorStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const DOCUMENT_KEY = 'cabbage.document';
const UNITS_KEY = 'cabbage.units';
const EMPTY_SELECTION: ReadonlySet<string> = new Set();
const NO_MEASUREMENT: MeasurementState = { label: 'Measurement', value: '', typed: null, error: false };

/** Accepts only a well-formed saved value. Anything else falls back to the defaults, one field at a time. */
export function parseUnitSettings(raw: string | null): UnitSettings {
  if (!raw) return DEFAULT_UNIT_SETTINGS;
  try {
    const saved = JSON.parse(raw) as Partial<UnitSettings> | null;
    if (!saved || typeof saved !== 'object') return DEFAULT_UNIT_SETTINGS;
    return {
      system:
        saved.system === 'imperial' || saved.system === 'metric'
          ? saved.system
          : DEFAULT_UNIT_SETTINGS.system,
      imperialPrecision:
        IMPERIAL_PRECISIONS.find((precision) => precision === saved.imperialPrecision) ??
        DEFAULT_UNIT_SETTINGS.imperialPrecision,
      metricPrecision:
        METRIC_PRECISIONS.find((precision) => precision === saved.metricPrecision) ??
        DEFAULT_UNIT_SETTINGS.metricPrecision,
    };
  } catch {
    return DEFAULT_UNIT_SETTINGS;
  }
}

/** Thickness a new board gets until a material library exists: 3/4" or 18 mm. */
export function defaultThickness(units: UnitSettings): Length {
  return units.system === 'imperial' ? inchFraction(0, 3, 4) : mm(18);
}

/** The smallest step a freely dragged length lands on: the display precision. */
export function dragStep(units: UnitSettings): Length {
  return units.system === 'imperial'
    ? NM_PER_INCH / units.imperialPrecision
    : Math.round(units.metricPrecision * NM_PER_MM);
}

const ROUND_INCH_DENOMINATORS = [1, 2, 4, 8, 16, 32, 64];
const ROUND_MILLIMETERS = [10, 5, 1, 0.5, 0.1];

/**
 * Steps a dragged length may land on, roundest first: whole inches down to the
 * display precision, or 10 mm down to it. A drag uses the roundest one that
 * still follows the cursor closely, so a quick drag gives 24" and not 23 15/16".
 */
export function roundSteps(units: UnitSettings): Length[] {
  const finest = dragStep(units);
  const steps =
    units.system === 'imperial'
      ? ROUND_INCH_DENOMINATORS.map((denominator) => NM_PER_INCH / denominator)
      : ROUND_MILLIMETERS.map((millimeters) => Math.round(millimeters * NM_PER_MM));
  return steps.filter((step) => step >= finest);
}

/**
 * Everything the app knows that is not pixels: the model and its undo history,
 * the selection, the active tool, and the units. The 3D view and the panels
 * both read from here and are told when it changes.
 */
export class Editor {
  private history: History<CabbageDocument>;
  private state: EditorState;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: EditorStorage | null = null) {
    this.history = createHistory(this.loadDocument());
    this.state = {
      ...this.historyState(),
      selection: EMPTY_SELECTION,
      hovered: null,
      tool: 'select',
      units: parseUnitSettings(this.read(UNITS_KEY)),
      measurement: NO_MEASUREMENT,
      hint: '',
    };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): EditorState => this.state;

  // Model changes

  /** Applies a change to the model as one undo step. */
  commitDocument(next: CabbageDocument, label: string): void {
    this.history = commit(this.history, next, label);
    this.afterDocumentChange();
  }

  /** Corrects the change just made without adding another undo step. */
  amendDocument(next: CabbageDocument): void {
    this.history = amend(this.history, next);
    this.afterDocumentChange();
  }

  addBoards(boards: readonly Board[], label: string): void {
    this.commitDocument(addBoards(this.state.document, boards), label);
  }

  replaceBoardInPlace(board: Board): void {
    this.amendDocument(replaceBoard(this.state.document, board));
  }

  deleteSelection(): boolean {
    const { selection, document } = this.state;
    if (selection.size === 0) return false;
    const label = selection.size === 1 ? 'Delete board' : `Delete ${selection.size} boards`;
    this.commitDocument(removeBoards(document, selection), label);
    return true;
  }

  undo(): void {
    if (!canUndo(this.history)) return;
    this.history = undo(this.history);
    this.afterDocumentChange();
  }

  redo(): void {
    if (!canRedo(this.history)) return;
    this.history = redo(this.history);
    this.afterDocumentChange();
  }

  // Selection and hover

  setSelection(ids: Iterable<string>): void {
    const selection = new Set(ids);
    if (selection.size === 0 && this.state.selection.size === 0) return;
    this.update({ selection });
  }

  toggleSelected(id: string): void {
    const selection = new Set(this.state.selection);
    if (!selection.delete(id)) selection.add(id);
    this.update({ selection });
  }

  setHovered(id: string | null): void {
    if (id !== this.state.hovered) this.update({ hovered: id });
  }

  // Tool, units, and status

  setTool(tool: ToolId): void {
    if (tool === this.state.tool) return;
    // Drawing starts with nothing selected, so Delete can never remove something out of mind.
    const selection = tool === 'board' ? EMPTY_SELECTION : this.state.selection;
    this.update({ tool, selection, hovered: null, measurement: NO_MEASUREMENT, hint: '' });
  }

  setUnits(change: Partial<UnitSettings>): void {
    const units = { ...this.state.units, ...change };
    this.write(UNITS_KEY, JSON.stringify(units));
    this.update({ units });
  }

  setHint(hint: string): void {
    if (hint !== this.state.hint) this.update({ hint });
  }

  setMeasurement(label: string, value: string): void {
    const current = this.state.measurement;
    if (current.label === label && current.value === value) return;
    this.update({ measurement: { ...current, label, value } });
  }

  setTyped(typed: string | null, error = false): void {
    const current = this.state.measurement;
    if (current.typed === typed && current.error === error) return;
    this.update({ measurement: { ...current, typed, error } });
  }

  // Internals

  private historyState(): Pick<EditorState, 'document' | 'canUndo' | 'canRedo' | 'undoLabel' | 'redoLabel'> {
    return {
      document: this.history.present,
      canUndo: canUndo(this.history),
      canRedo: canRedo(this.history),
      undoLabel: undoLabel(this.history),
      redoLabel: redoLabel(this.history),
    };
  }

  private afterDocumentChange(): void {
    const document = this.history.present;
    const ids = new Set(document.boards.map((board) => board.id));
    const selection = new Set([...this.state.selection].filter((id) => ids.has(id)));
    const hovered = this.state.hovered && ids.has(this.state.hovered) ? this.state.hovered : null;
    this.write(DOCUMENT_KEY, JSON.stringify(document));
    this.update({ ...this.historyState(), selection, hovered });
  }

  private update(change: Partial<EditorState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }

  private loadDocument(): CabbageDocument {
    const raw = this.read(DOCUMENT_KEY);
    if (!raw) return EMPTY_DOCUMENT;
    try {
      return parseDocument(JSON.parse(raw)) ?? EMPTY_DOCUMENT;
    } catch {
      return EMPTY_DOCUMENT;
    }
  }

  private read(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.storage?.setItem(key, value);
    } catch {
      // Storage can be full or refused. The model still works for this visit.
    }
  }
}
