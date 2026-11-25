import { boxMax, type Box } from '../core/board';
import {
  CABINET_KIND_NAMES,
  cabinetBoards,
  cabinetBox,
  moveCabinet,
  ownerId,
  resizeCabinet,
  usualElevation,
  usualSize,
  type Cabinet,
  type CabinetKind,
  type CabinetSize,
} from '../core/cabinet';
import { modelBoards, replaceCabinets, type CabbageDocument } from '../core/document';
import type { Editor } from '../core/editor';
import { parseLengthList } from '../core/parse-length';
import { formatLength } from '../core/units';
import { AXES, withAxis, type Vec3L } from '../core/vec';
import { findSnap, pointOnPlane } from '../inference/inference';
import { isDefinite, onLine } from './pick';
import { quantize, stepNear } from './steps';
import { NO_PREVIEW, markerFor, type SnapMarker, type Tool, type ToolPointer, type ToolPreview } from './tool';

/**
 * Places cabinets: pick base, wall, or tall, and click where it goes. The
 * cabinet is held by a back corner, so clicking the back corner of a cabinet
 * already there sets the new one beside it, flush along the wall.
 *
 * Base and tall cabinets stand on the floor and wall cabinets hang at the
 * usual height, wherever the click lands. A typed size applies to the next
 * cabinet, and typed right after a click it corrects the one just placed.
 */

interface Ghost {
  cabinet: Cabinet;
  /** True when it is held by its back right corner, because it would not fit to the right of what was snapped to. */
  heldRight: boolean;
}

/** The cabinet just placed, kept so a typed size can still correct it. */
interface LastPlaced {
  id: string;
  kind: CabinetKind;
  heldRight: boolean;
  /** The model as it stood with this cabinet in it. Any other change ends the chance to correct it. */
  document: CabbageDocument;
}

function overlaps(a: Box, b: Box): boolean {
  const aMax = boxMax(a);
  const bMax = boxMax(b);
  return AXES.every((axis) => a.min[axis] < bMax[axis] && b.min[axis] < aMax[axis]);
}

export class CabinetTool implements Tool {
  readonly id = 'cabinet' as const;

  private ghost: Ghost | null = null;
  private marker: SnapMarker | null = null;
  private lastPointer: ToolPointer | null = null;
  private last: LastPlaced | null = null;
  /** Sizes typed for each kind, kept for the cabinets that follow. */
  private readonly sizes: Partial<Record<CabinetKind, CabinetSize>> = {};

  constructor(private readonly editor: Editor) {}

  activate(): void {
    this.reset();
  }

  deactivate(): void {
    this.reset();
    this.lastPointer = null;
  }

  pointerMove(pointer: ToolPointer): void {
    this.lastPointer = pointer;
    this.aim(pointer);
    this.report();
  }

  pointerDown(pointer: ToolPointer): void {
    this.pointerMove(pointer);
    const ghost = this.ghost;
    if (!ghost) return;
    // A second click in the same spot would stack a cabinet inside the one just placed.
    const placed = this.placed();
    if (placed && placed.position.every((value, axis) => value === ghost.cabinet.position[axis])) return;

    const { width, height, depth } = ghost.cabinet;
    const cabinet = this.editor.placeCabinet(ghost.cabinet.position, { width, height, depth });
    if (!cabinet) return;
    this.last = {
      id: cabinet.id,
      kind: cabinet.kind,
      heldRight: ghost.heldRight,
      document: this.editor.getState().document,
    };
    // The cabinet is in the model now. Its outline comes back when the cursor moves on.
    this.ghost = null;
    this.marker = null;
    this.report();
  }

  pointerUp(): void {}

  pointerLeave(): void {
    this.ghost = null;
    this.marker = null;
  }

  keyDown(): boolean {
    return false;
  }

  acceptsMeasurement(): boolean {
    return true;
  }

  /** Takes a width, or a width, height, and depth. An empty place, as in ", 30", leaves that size as it is. */
  applyMeasurement(text: string): boolean {
    const { units, cabinetKind } = this.editor.getState();
    const typed = parseLengthList(text, units.system);
    if (!typed || typed.length > 3) return false;
    const placed = this.placed();
    const current = placed ?? this.size();
    const size: CabinetSize = {
      width: typed[0] ?? current.width,
      height: typed[1] ?? current.height,
      depth: typed[2] ?? current.depth,
    };
    // A size that cannot be built is turned down before anything changes.
    if (!this.editor.newCabinet('probe', '', [0, 0, 0], size)) return false;

    if (placed && this.last) {
      let next = resizeCabinet(placed, size);
      if (!next) return false;
      // A cabinet held by its right corner grows to the left.
      if (this.last.heldRight) next = moveCabinet(next, [placed.width - next.width, 0, 0]);
      this.editor.amendDocument(replaceCabinets(this.editor.getState().document, [next]));
      this.last = { ...this.last, document: this.editor.getState().document };
    }
    this.sizes[cabinetKind] = size;
    if (this.lastPointer && this.ghost) this.aim(this.lastPointer);
    this.report();
    return true;
  }

  cancel(): boolean {
    return false;
  }

  busy(): boolean {
    return false;
  }

  refresh(): void {
    if (this.lastPointer && this.ghost) this.aim(this.lastPointer);
    this.report();
  }

  preview(): ToolPreview {
    if (!this.ghost) return NO_PREVIEW;
    return { ...NO_PREVIEW, marker: this.marker, boxes: cabinetBoards(this.ghost.cabinet) };
  }

  // Steps

  /** Works out where a click would put a cabinet. */
  private aim(pointer: ToolPointer): void {
    const { document, units, cabinetKind } = this.editor.getState();
    const solids = modelBoards(document);
    const snap = findSnap(solids, pointer.view, undefined, document.guides);
    this.ghost = null;
    this.marker = null;
    if (!snap) return;

    // Only where the point is on the floor plan matters. A definite point gives it exactly.
    let spot: Vec3L | null = snap.point;
    if (!isDefinite(snap)) {
      // Anything else, the floor under the cursor, on round numbers.
      spot = pointOnPlane(pointer.view, 2, 0);
      if (!spot) return;
      for (const axis of [0, 1] as const) {
        spot = withAxis(spot, axis, quantize(spot[axis], stepNear(units, pointer, spot, axis)));
      }
    } else if (onLine(snap) && snap.edgeAxis !== undefined && snap.edgeAxis !== 2) {
      const along = snap.edgeAxis;
      spot = withAxis(spot, along, quantize(spot[along], stepNear(units, pointer, spot, along)));
    }

    const position: Vec3L = [spot[0], spot[1], usualElevation(cabinetKind, units.system)];
    const cabinet =
      this.editor.newCabinet('ghost', '', position, this.size()) ?? this.editor.newCabinet('ghost', '', position);
    if (!cabinet) return;
    this.ghost = { cabinet, heldRight: false };
    this.marker = isDefinite(snap) ? markerFor(snap) : null;

    // Snapped to something it would land inside of, the cabinet goes to the other side of the point.
    if (!isDefinite(snap) || snap.boardId === undefined) return;
    const owner = ownerId(snap.boardId);
    const blocked = (candidate: Cabinet) =>
      solids.some((board) => ownerId(board.id) === owner && overlaps(board, cabinetBox(candidate)));
    if (!blocked(cabinet)) return;
    const flipped = moveCabinet(cabinet, [-cabinet.width, 0, 0]);
    if (!blocked(flipped)) this.ghost = { cabinet: flipped, heldRight: true };
  }

  /** The size the next cabinet of the picked kind gets. */
  private size(): CabinetSize {
    const { units, cabinetKind } = this.editor.getState();
    return this.sizes[cabinetKind] ?? usualSize(cabinetKind, units.system);
  }

  /** The cabinet just placed, while it is still the latest change and still the kind being placed. */
  private placed(): Cabinet | null {
    const last = this.last;
    const { document, cabinetKind } = this.editor.getState();
    if (!last || last.document !== document || last.kind !== cabinetKind) return null;
    return document.cabinets.find((cabinet) => cabinet.id === last.id) ?? null;
  }

  private reset(): void {
    this.ghost = null;
    this.marker = null;
    this.last = null;
    this.report();
  }

  private report(): void {
    const editor = this.editor;
    if (editor.getState().tool !== this.id) return;
    const { units, cabinetKind } = editor.getState();
    const kind = CABINET_KIND_NAMES[cabinetKind].toLowerCase();
    const placed = this.placed();
    editor.setHint(
      placed
        ? 'Type a width, or a width, height, and depth, to correct the cabinet just placed. Click to place another.'
        : `Click to place a ${kind} cabinet. Type a width, or a width, height, and depth, at any time.`,
    );
    const { width, height, depth } = placed ?? this.ghost?.cabinet ?? this.size();
    editor.setMeasurement(
      'Width, height, depth',
      [width, height, depth].map((size) => formatLength(size, units)).join(', '),
    );
  }
}
