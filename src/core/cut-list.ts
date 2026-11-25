import { faceAxis, grainAxis, type Board } from './board';
import type { CabbageDocument } from './document';
import { SHEET_SIZE, allMaterials, findMaterial, type Material } from './materials';
import { formatLength, toInches, toMm, type Length, type UnitSettings } from './units';
import { otherAxes } from './vec';

/**
 * The cut list: every board in the model as a part to cut, grouped by what it
 * is cut from. It is worked out fresh from the boards each time, so it can
 * never fall out of step with the model.
 */

/** One board as a part: its size the way a cut list states it. */
export interface PartSize {
  /** The side that runs with the grain. Without grain, the longer side. */
  length: Length;
  width: Length;
  thickness: Length;
  /** How many of the two edges that run the length are banded. */
  bandedLengthEdges: number;
  /** How many of the two edges that run the width are banded. */
  bandedWidthEdges: number;
}

/** A line of the cut list: identical parts, counted. */
export interface CutPart extends PartSize {
  /** Stable for as long as the size, material, and banding stay the same. */
  key: string;
  quantity: number;
  /** The different names the boards on this line carry, in the order first met. */
  names: readonly string[];
  boardIds: readonly string[];
  /** True when the part is bigger than a full sheet of its material. */
  oversize: boolean;
}

/** The parts cut from one material at one thickness. */
export interface CutGroup {
  key: string;
  material: Material;
  thickness: Length;
  parts: readonly CutPart[];
  /** How many pieces in all, counting repeats. */
  pieces: number;
  /** Face area of all the pieces, in square millimeters. */
  area: number;
  /** The fewest full sheets the area could come out of. Zero for lumber. */
  sheetsAtLeast: number;
  /** Total length of edge banding. */
  banding: Length;
}

/** The size of one board as a part, given whether its material has grain. */
export function partSize(board: Board, grain: boolean): PartSize {
  const [u, v] = otherAxes(board.thicknessAxis);
  const longer = board.size[u] >= board.size[v] ? u : v;
  const lengthAxis = grain ? grainAxis(board) : longer;
  const widthAxis = lengthAxis === u ? v : u;
  let bandedLengthEdges = 0;
  let bandedWidthEdges = 0;
  for (const face of board.banding ?? []) {
    // An edge that faces across the width runs the length of the part.
    if (faceAxis(face) === widthAxis) bandedLengthEdges += 1;
    else if (faceAxis(face) === lengthAxis) bandedWidthEdges += 1;
  }
  return {
    length: board.size[lengthAxis],
    width: board.size[widthAxis],
    thickness: board.size[board.thicknessAxis],
    bandedLengthEdges,
    bandedWidthEdges,
  };
}

function fitsOnSheet(part: PartSize, grain: boolean): boolean {
  const [short, long] = SHEET_SIZE;
  const withGrain = part.length <= long && part.width <= short;
  // Without grain a part can be turned on the sheet.
  return withGrain || (!grain && part.length <= short && part.width <= long);
}

export function buildCutList(document: CabbageDocument): CutGroup[] {
  const order = allMaterials(document.materials).map((material) => material.id);
  const groups = new Map<string, { material: Material; thickness: Length; parts: Map<string, CutPart> }>();

  for (const board of document.boards) {
    const material = findMaterial(document.materials, board.materialId);
    const size = partSize(board, material.grain);
    const groupKey = `${material.id}|${size.thickness}`;
    let group = groups.get(groupKey);
    if (!group) {
      group = { material, thickness: size.thickness, parts: new Map() };
      groups.set(groupKey, group);
    }
    const key = `${groupKey}|${size.length}|${size.width}|${size.bandedLengthEdges}|${size.bandedWidthEdges}`;
    const part = group.parts.get(key);
    if (part) {
      group.parts.set(key, {
        ...part,
        quantity: part.quantity + 1,
        names: part.names.includes(board.name) ? part.names : [...part.names, board.name],
        boardIds: [...part.boardIds, board.id],
      });
    } else {
      group.parts.set(key, {
        ...size,
        key,
        quantity: 1,
        names: [board.name],
        boardIds: [board.id],
        oversize: material.kind === 'sheet' && !fitsOnSheet(size, material.grain),
      });
    }
  }

  const sheetArea = toMm(SHEET_SIZE[0]) * toMm(SHEET_SIZE[1]);
  return [...groups.entries()]
    .map(([key, { material, thickness, parts }]): CutGroup => {
      // Biggest parts first, the order they are usually cut in.
      const sorted = [...parts.values()].sort(
        (a, b) => b.length - a.length || b.width - a.width || a.names[0]!.localeCompare(b.names[0]!),
      );
      let pieces = 0;
      let area = 0;
      let banding = 0;
      for (const part of sorted) {
        pieces += part.quantity;
        area += part.quantity * toMm(part.length) * toMm(part.width);
        banding += part.quantity * (part.bandedLengthEdges * part.length + part.bandedWidthEdges * part.width);
      }
      const sheetsAtLeast = material.kind === 'sheet' ? Math.ceil(area / sheetArea - 1e-9) : 0;
      return { key, material, thickness, parts: sorted, pieces, area, sheetsAtLeast, banding };
    })
    .sort(
      (a, b) =>
        order.indexOf(a.material.id) - order.indexOf(b.material.id) ||
        // Thick stock first: it is usually the carcass, and what people look for first.
        b.thickness - a.thickness,
    );
}

/** "2 length, 1 width", "All four", or nothing. */
export function describeBanding(part: PartSize): string {
  const { bandedLengthEdges: long, bandedWidthEdges: short } = part;
  if (long === 0 && short === 0) return '';
  if (long === 2 && short === 2) return 'All four edges';
  const pieces: string[] = [];
  if (long > 0) pieces.push(`${long} length`);
  if (short > 0) pieces.push(`${short} width`);
  return `${pieces.join(', ')} ${long + short === 1 ? 'edge' : 'edges'}`;
}

/** Face area in the project's units: square feet to one decimal, or square meters to two. */
export function formatArea(squareMillimeters: number, units: UnitSettings): string {
  if (units.system === 'imperial') return `${(squareMillimeters / (304.8 * 304.8)).toFixed(1)} sq ft`;
  return `${(squareMillimeters / 1_000_000).toFixed(2)} m²`;
}

/** A long run, such as edge banding, in feet to one decimal or meters to two. */
export function formatRun(length: Length, units: UnitSettings): string {
  if (units.system === 'imperial') return `${(toInches(length) / 12).toFixed(1)} ft`;
  return `${(toMm(length) / 1000).toFixed(2)} m`;
}

/** A full sheet, in the project's units. */
export function describeSheet(units: UnitSettings): string {
  return units.system === 'imperial' ? '4 x 8 ft' : '1220 x 2440 mm';
}

export function partName(part: CutPart): string {
  return part.names.join(', ');
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** A plain number in the project's units, for spreadsheets and sheet layout programs. */
function plainNumber(length: Length, units: UnitSettings): string {
  const value = units.system === 'imperial' ? toInches(length) : toMm(length);
  return String(Number(value.toFixed(4)));
}

/**
 * The cut list as a spreadsheet file. Sizes appear twice: as written on a
 * shop drawing, and as plain numbers that other programs can add up.
 */
export function cutListCsv(groups: readonly CutGroup[], units: UnitSettings): string {
  const unit = units.system === 'imperial' ? 'in' : 'mm';
  const rows: (string | number)[][] = [
    [
      'Material',
      'Thickness',
      'Quantity',
      'Part',
      'Length',
      'Width',
      'Grain',
      'Banded length edges',
      'Banded width edges',
      `Length (${unit})`,
      `Width (${unit})`,
      `Thickness (${unit})`,
    ],
  ];
  for (const group of groups) {
    for (const part of group.parts) {
      rows.push([
        group.material.name,
        formatLength(group.thickness, units),
        part.quantity,
        partName(part),
        formatLength(part.length, units),
        formatLength(part.width, units),
        group.material.grain ? 'Along length' : 'None',
        part.bandedLengthEdges,
        part.bandedWidthEdges,
        plainNumber(part.length, units),
        plainNumber(part.width, units),
        plainNumber(group.thickness, units),
      ]);
    }
  }
  // Spreadsheet programs expect a line ending they can all read.
  return `${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
