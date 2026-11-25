import { edgeFaces, faceAxis, tidyBoard, type Board, type FaceIndex } from './board';
import {
  EMPTY_DOCUMENT,
  addBoards,
  cleanProjectName,
  parseDocument,
  removeItems,
  replaceBoard,
  updateBoards,
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
  allMaterials,
  createMaterial,
  defaultStock,
  findMaterial,
  stockInSystem,
  type Material,
  type Stock,
} from './materials';
import {
  DEFAULT_UNIT_SETTINGS,
  IMPERIAL_PRECISIONS,
  METRIC_PRECISIONS,
  NM_PER_INCH,
  NM_PER_MM,
  type Length,
  type UnitSettings,
} from './units';
import type { Axis } from './vec';

export type ToolId = 'select' | 'board' | 'pull' | 'move' | 'rotate' | 'tape' | 'orbit' | 'pan';

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
  /** What the next board drawn is made of, and how thick it starts out. */
  stock: Stock;
  /** True when the model has changes that are not in a file yet. */
  unsaved: boolean;
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
const STOCK_KEY = 'cabbage.stock';
/** Holds "yes" while the model in this browser matches the file it was last saved to or opened from. */
const IN_FILE_KEY = 'cabbage.in-file';
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

/** Accepts only a well-formed saved stock. Anything else falls back to the usual sheet for the unit system. */
export function parseStock(raw: string | null, units: UnitSettings): Stock {
  const fallback = defaultStock(units.system);
  if (!raw) return fallback;
  try {
    const saved = JSON.parse(raw) as Partial<Stock> | null;
    if (!saved || typeof saved !== 'object') return fallback;
    const thickness = saved.thickness;
    return {
      materialId: typeof saved.materialId === 'string' ? saved.materialId : fallback.materialId,
      thickness: Number.isSafeInteger(thickness) && (thickness as number) > 0 ? (thickness as number) : fallback.thickness,
    };
  } catch {
    return fallback;
  }
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
  /** The model as it stood when it was last written to or read from a file. */
  private saved: CabbageDocument | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: EditorStorage | null = null) {
    this.history = createHistory(this.loadDocument());
    // A model that was safely in a file when the page was left still is.
    if (this.read(IN_FILE_KEY) === 'yes') this.saved = this.history.present;
    const units = parseUnitSettings(this.read(UNITS_KEY));
    const stock = parseStock(this.read(STOCK_KEY), units);
    this.state = {
      ...this.historyState(),
      selection: EMPTY_SELECTION,
      hovered: null,
      tool: 'select',
      units,
      // A stock naming a material this project does not have falls back to the default one.
      stock: { ...stock, materialId: findMaterial(this.history.present.materials, stock.materialId).id },
      unsaved: this.isUnsaved(),
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

  /** Removes the selected boards and guides as one undo step. */
  deleteSelection(): boolean {
    const { selection, document } = this.state;
    if (selection.size === 0) return false;
    const boards = document.boards.filter((board) => selection.has(board.id)).length;
    const guides = document.guides.filter((guide) => selection.has(guide.id)).length;
    const count = (amount: number, one: string) => (amount === 1 ? one : `${amount} ${one}s`);
    const parts = [boards > 0 ? count(boards, 'board') : '', guides > 0 ? count(guides, 'guide') : ''];
    this.commitDocument(removeItems(document, selection), `Delete ${parts.filter(Boolean).join(' and ')}`);
    return true;
  }

  // Board details

  /** Changes the selected boards, or the ones named, as one undo step. Does nothing when nothing would change. */
  private changeBoards(ids: Iterable<string>, label: string, change: (board: Board) => Board): boolean {
    const wanted = new Set(ids);
    const next = updateBoards(this.state.document, wanted, change);
    if (next === this.state.document) return false;
    const count = next.boards.filter((board, index) => board !== this.state.document.boards[index]).length;
    this.commitDocument(next, count === 1 ? label : `${label} of ${count} boards`);
    return true;
  }

  renameBoards(ids: Iterable<string>, name: string): boolean {
    const cleaned = name.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (cleaned === '') return false;
    return this.changeBoards(ids, 'Rename', (board) => (board.name === cleaned ? board : { ...board, name: cleaned }));
  }

  setBoardMaterial(ids: Iterable<string>, materialId: string): boolean {
    const id = findMaterial(this.state.document.materials, materialId).id;
    return this.changeBoards(ids, 'Change material', (board) =>
      board.materialId === id ? board : { ...board, materialId: id },
    );
  }

  /** Runs the grain along an axis, on every board named whose face has that axis. Null goes back to the longer side. */
  setBoardGrain(ids: Iterable<string>, axis: Axis | null): boolean {
    return this.changeBoards(ids, 'Change grain', (board) => {
      if (axis === null) return board.grain === undefined ? board : tidyBoard({ ...board, grain: undefined });
      if (axis === board.thicknessAxis || board.grain === axis) return board;
      return tidyBoard({ ...board, grain: axis });
    });
  }

  /** Bands or unbands one side, on every board named where that side is an edge. */
  setBoardBanding(ids: Iterable<string>, face: FaceIndex, banded: boolean): boolean {
    return this.changeBoards(ids, banded ? 'Band edge' : 'Remove banding', (board) => {
      if (faceAxis(face) === board.thicknessAxis || !edgeFaces(board).includes(face)) return board;
      const has = board.banding?.includes(face) ?? false;
      if (has === banded) return board;
      const banding = banded ? [...(board.banding ?? []), face] : (board.banding ?? []).filter((other) => other !== face);
      return tidyBoard({ ...board, banding });
    });
  }

  /** Adds a material to the project and returns it, or null when the name is empty or already taken. */
  addMaterial(name: string, grain: boolean): Material | null {
    const { document } = this.state;
    const material = createMaterial(name, grain, document.materials);
    if (!material) return null;
    const taken = allMaterials(document.materials).some(
      (other) => other.name.toLowerCase() === material.name.toLowerCase(),
    );
    if (taken) return null;
    this.commitDocument({ ...document, materials: [...document.materials, material] }, 'Add material');
    return material;
  }

  // The project as a whole

  renameProject(name: string): void {
    const cleaned = cleanProjectName(name);
    if (cleaned === this.state.document.name) return;
    this.commitDocument({ ...this.state.document, name: cleaned }, 'Rename project');
  }

  /**
   * Replaces the whole model with another one: a file that was opened, or an
   * empty project. Undo does not reach back across it, so the caller makes
   * sure nothing unsaved is lost first.
   */
  openDocument(document: CabbageDocument, fromFile: boolean): void {
    this.history = createHistory(document);
    this.saved = fromFile ? document : null;
    this.state = { ...this.state, selection: EMPTY_SELECTION, hovered: null, measurement: NO_MEASUREMENT };
    this.afterDocumentChange();
    this.setStock(this.state.stock);
  }

  /** Records that the model as it stands now is safely in a file. */
  markSaved(): void {
    this.saved = this.state.document;
    this.write(IN_FILE_KEY, 'yes');
    this.update({ unsaved: this.isUnsaved() });
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
    // Tools that ignore the selection start with nothing selected, so Delete can never remove something out of mind.
    const selection = tool === 'board' || tool === 'pull' || tool === 'tape' ? EMPTY_SELECTION : this.state.selection;
    this.update({ tool, selection, hovered: null, measurement: NO_MEASUREMENT, hint: '' });
  }

  setUnits(change: Partial<UnitSettings>): void {
    const units = { ...this.state.units, ...change };
    this.write(UNITS_KEY, JSON.stringify(units));
    // The stock follows the units: 3/4" becomes 18 mm, and back.
    const stock = stockInSystem(this.state.stock, this.state.units.system, units.system);
    if (stock !== this.state.stock) this.write(STOCK_KEY, JSON.stringify(stock));
    this.update({ units, stock });
  }

  setStock(change: Partial<Stock>): void {
    const merged = { ...this.state.stock, ...change };
    const stock = { ...merged, materialId: findMaterial(this.state.document.materials, merged.materialId).id };
    if (stock.materialId === this.state.stock.materialId && stock.thickness === this.state.stock.thickness) return;
    this.write(STOCK_KEY, JSON.stringify(stock));
    this.update({ stock });
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
    const ids = new Set([...document.boards, ...document.guides].map((item) => item.id));
    const selection = new Set([...this.state.selection].filter((id) => ids.has(id)));
    const hovered = this.state.hovered && ids.has(this.state.hovered) ? this.state.hovered : null;
    this.write(DOCUMENT_KEY, JSON.stringify(document));
    this.write(IN_FILE_KEY, document === this.saved ? 'yes' : 'no');
    this.update({ ...this.historyState(), selection, hovered, unsaved: this.isUnsaved() });
  }

  /** An empty model has nothing to lose. Anything else counts until it has been written to a file. */
  private isUnsaved(): boolean {
    const document = this.history.present;
    if (document === this.saved) return false;
    return document.boards.length > 0 || document.guides.length > 0 || document.materials.length > 0;
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
