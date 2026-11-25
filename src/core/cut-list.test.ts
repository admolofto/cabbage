import { describe, expect, it } from 'vitest';
import { faceIndex, tidyBoard, type Board, type FaceIndex } from './board';
import { buildCutList, cutListCsv, describeBanding, formatArea, formatRun, partSize } from './cut-list';
import {
  EMPTY_DOCUMENT,
  cleanProjectName,
  deserializeDocument,
  parseDocument,
  serializeDocument,
  type CabbageDocument,
} from './document';
import { Editor, type EditorStorage } from './editor';
import { pullBoard, rotateBoardQuarter } from './transform';
import { DEFAULT_UNIT_SETTINGS, inchFraction, mm } from './units';
import type { Axis, Vec3L } from './vec';

const inch = inchFraction;
const SHEET = inch(0, 3, 4);
const FRONT = faceIndex(1, -1);
const BACK = faceIndex(1, 1);
const LEFT = faceIndex(0, -1);
const RIGHT = faceIndex(0, 1);
const TOP = faceIndex(2, 1);

let nextId = 0;
function board(name: string, size: Vec3L, thicknessAxis: Axis, more: Partial<Board> = {}): Board {
  nextId += 1;
  return tidyBoard({ id: `b${nextId}`, name, min: [0, 0, 0], size, thicknessAxis, materialId: 'plywood', ...more });
}

function documentOf(boards: Board[], more: Partial<CabbageDocument> = {}): CabbageDocument {
  return { ...EMPTY_DOCUMENT, boards, ...more };
}

/** A bookcase by hand: two sides, four shelves, and a thin back. */
function bookcase(): Board[] {
  const side = () => board('Side', [SHEET, inch(12), inch(36)], 0, { banding: [FRONT] });
  const shelf = () => board('Shelf', [inch(28, 1, 2), inch(12), SHEET], 2, { banding: [FRONT] });
  return [side(), side(), shelf(), shelf(), shelf(), shelf(), board('Back', [inch(30), inch(0, 1, 4), inch(36)], 1)];
}

describe('part sizes', () => {
  it('runs the length with the longer side unless the grain is set by hand', () => {
    const door = board('Door', [inch(15), SHEET, inch(30)], 1);
    expect(partSize(door, true)).toMatchObject({ length: inch(30), width: inch(15), thickness: SHEET });
    // Grain run across the door makes the short side the length.
    expect(partSize({ ...door, grain: 0 }, true)).toMatchObject({ length: inch(15), width: inch(30) });
    // A material without grain ignores the choice.
    expect(partSize({ ...door, grain: 0 }, false)).toMatchObject({ length: inch(30), width: inch(15) });
  });

  it('counts banded edges by whether they run the length or the width', () => {
    const shelf = board('Shelf', [inch(28), inch(12), SHEET], 2, { banding: [FRONT, LEFT, RIGHT] });
    expect(partSize(shelf, true)).toMatchObject({ bandedLengthEdges: 1, bandedWidthEdges: 2 });
    expect(describeBanding(partSize(shelf, true))).toBe('1 length, 2 width edges');
    expect(describeBanding(partSize(board('Side', [SHEET, inch(12), inch(36)], 0, { banding: [FRONT] }), true))).toBe(
      '1 length edge',
    );
    expect(describeBanding(partSize(board('Plain', [inch(5), inch(5), SHEET], 2), true))).toBe('');
    const all: FaceIndex[] = [FRONT, BACK, LEFT, RIGHT];
    expect(describeBanding(partSize(board('Top', [inch(5), inch(6), SHEET], 2, { banding: all }), true))).toBe(
      'All four edges',
    );
  });

  it('never bands a wide face or runs grain through the thickness', () => {
    const shelf = board('Shelf', [inch(28), inch(12), SHEET], 2, { banding: [TOP, FRONT, FRONT], grain: 2 });
    expect(shelf.banding).toEqual([FRONT]);
    expect(shelf.grain).toBeUndefined();
  });
});

describe('which way a board is thick', () => {
  it('is the thinnest way through it, however it was drawn', () => {
    // A side drawn as a 3/4" by 12" rectangle on the floor and pulled up 36".
    const side = board('Side', [SHEET, inch(12), inch(36)], 2);
    expect(side.thicknessAxis).toBe(0);
    expect(partSize(side, true)).toMatchObject({ length: inch(36), width: inch(12), thickness: SHEET });
  });

  it('keeps the way it was drawn when two ways tie', () => {
    expect(board('Leg', [inch(2), inch(2), inch(30)], 1).thicknessAxis).toBe(1);
    expect(board('Leg', [inch(2), inch(2), inch(30)], 2).thicknessAxis).toBe(0);
  });

  it('follows a board that is pulled until it is thinnest another way', () => {
    const strip = board('Strip', [inch(30), inch(2), SHEET], 2, { banding: [FRONT] });
    const squashed = pullBoard(strip, 1, 1, -inch(1, 1, 2), inch(0, 1, 16));
    expect(squashed.size).toEqual([inch(30), inch(0, 1, 2), SHEET]);
    expect(squashed.thicknessAxis).toBe(1);
    // The front is now a wide face, so its banding is gone.
    expect(squashed.banding).toBeUndefined();
  });

  it('puts right a board saved with its thickness the long way', () => {
    const old = { id: 'a', name: 'Side', min: [0, 0, 0], size: [SHEET, inch(12), inch(36)], thicknessAxis: 2 };
    const document = parseDocument({ version: 1, boards: [old] })!;
    expect(document.boards[0]!.thicknessAxis).toBe(0);
    expect(buildCutList(document)[0]).toMatchObject({ thickness: SHEET });
  });
});

describe('the cut list', () => {
  it('matches what you would write by hand for a bookcase', () => {
    const groups = buildCutList(documentOf(bookcase()));
    expect(groups.map((group) => [group.material.name, group.thickness, group.pieces])).toEqual([
      ['Plywood', SHEET, 6],
      ['Plywood', inch(0, 1, 4), 1],
    ]);
    expect(groups[0]!.parts.map((part) => [part.quantity, part.names, part.length, part.width])).toEqual([
      [2, ['Side'], inch(36), inch(12)],
      [4, ['Shelf'], inch(28, 1, 2), inch(12)],
    ]);
    expect(groups[1]!.parts[0]).toMatchObject({ quantity: 1, names: ['Back'], length: inch(36), width: inch(30) });
    // Two sides and four shelves, each banded along the front.
    expect(groups[0]!.banding).toBe(2 * inch(36) + 4 * inch(28, 1, 2));
    expect(groups[0]!.sheetsAtLeast).toBe(1);
    expect(formatRun(groups[0]!.banding, DEFAULT_UNIT_SETTINGS)).toBe('15.5 ft');
    expect(formatArea(groups[0]!.area, DEFAULT_UNIT_SETTINGS)).toBe('15.5 sq ft');
  });

  it('merges identical parts however they are turned, and lists their different names', () => {
    const groups = buildCutList(
      documentOf([
        board('Left side', [SHEET, inch(24), inch(34)], 0),
        board('Right side', [SHEET, inch(24), inch(34)], 0),
        board('Spare', [inch(34), inch(24), SHEET], 2),
      ]),
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.parts).toHaveLength(1);
    expect(groups[0]!.parts[0]).toMatchObject({ quantity: 3, names: ['Left side', 'Right side', 'Spare'] });
  });

  it('keeps parts apart when their banding or material differs', () => {
    const groups = buildCutList(
      documentOf([
        board('Shelf', [inch(28), inch(12), SHEET], 2, { banding: [FRONT] }),
        board('Shelf', [inch(28), inch(12), SHEET], 2),
        board('Shelf', [inch(28), inch(12), SHEET], 2, { materialId: 'mdf' }),
      ]),
    );
    expect(groups.map((group) => group.material.name)).toEqual(['Plywood', 'MDF']);
    expect(groups[0]!.parts.map((part) => part.bandedLengthEdges)).toEqual([1, 0]);
  });

  it('lists a board at the thickness it was drawn, whatever its material', () => {
    const groups = buildCutList(documentOf([board('Thin', [inch(10), inch(10), inch(0, 23, 32)], 2)]));
    expect(groups[0]!.thickness).toBe(inch(0, 23, 32));
  });

  it('flags a part too big for a full sheet', () => {
    const groups = buildCutList(
      documentOf([
        board('Long', [inch(100), inch(12), SHEET], 2),
        board('Tall', [inch(60), inch(40), SHEET], 2, { grain: 1 }),
        board('Tall', [inch(60), inch(40), SHEET], 2, { grain: 1, materialId: 'mdf' }),
        board('Beam', [inch(120), inch(4), SHEET], 2, { materialId: 'hardwood' }),
      ]),
    );
    const flags = groups.flatMap((group) => group.parts.map((part) => [group.material.name, part.names[0], part.oversize]));
    expect(flags).toEqual([
      ['Plywood', 'Long', true],
      // Grain across a 40" part needs a sheet 60" wide.
      ['Plywood', 'Tall', true],
      // MDF has no grain, so the same part can be turned to fit.
      ['MDF', 'Tall', false],
      // Lumber is not cut from sheets.
      ['Hardwood', 'Beam', false],
    ]);
  });

  it('writes a spreadsheet file with sizes as written and as plain numbers', () => {
    const csv = cutListCsv(buildCutList(documentOf(bookcase())), DEFAULT_UNIT_SETTINGS);
    const rows = csv.trimEnd().split('\r\n');
    expect(rows[0]).toBe(
      'Material,Thickness,Quantity,Part,Length,Width,Grain,Banded length edges,Banded width edges,Length (in),Width (in),Thickness (in)',
    );
    expect(rows[1]).toBe('Plywood,"3/4""",2,Side,"36""","12""",Along length,1,0,36,12,0.75');
    expect(rows[2]).toBe('Plywood,"3/4""",4,Shelf,"28 1/2""","12""",Along length,1,0,28.5,12,0.75');
    expect(rows).toHaveLength(4);

    const metric = cutListCsv(buildCutList(documentOf([board('A, "B"', [mm(600), mm(300), mm(18)], 2)])), {
      ...DEFAULT_UNIT_SETTINGS,
      system: 'metric',
    });
    expect(metric.split('\r\n')[1]).toBe('Plywood,18 mm,1,"A, ""B""",600 mm,300 mm,Along length,0,0,600,300,18');
  });
});

describe('turning a board', () => {
  it('carries the grain and the banded edges around with it', () => {
    const shelf = board('Shelf', [inch(28), inch(12), SHEET], 2, { banding: [FRONT], grain: 0 });
    const turned = rotateBoardQuarter(shelf, [0, 0, 0], 2, 1);
    // A quarter turn counterclockwise, seen from above, swings the front edge around to the right.
    expect(turned.banding).toEqual([RIGHT]);
    expect(turned.grain).toBe(1);
    expect(partSize(turned, true)).toEqual(partSize(shelf, true));

    // Four quarter turns bring everything home.
    let around = shelf;
    for (let count = 0; count < 4; count += 1) around = rotateBoardQuarter(around, [0, 0, 0], 2, 1);
    expect(around).toEqual(shelf);

    // Stood up on end about X, the front edge ends up underneath.
    const stood = rotateBoardQuarter(shelf, [0, 0, 0], 0, 1);
    expect(stood.thicknessAxis).toBe(1);
    expect(stood.banding).toEqual([faceIndex(2, -1)]);
    expect(partSize(stood, true)).toEqual(partSize(shelf, true));
  });
});

describe('saved projects', () => {
  it('opens a model from before materials as plywood', () => {
    const old = {
      version: 1,
      boards: [{ id: 'a', name: 'Board 1', min: [0, 0, 0], size: [inch(24), inch(12), SHEET], thicknessAxis: 2 }],
    };
    const document = parseDocument(old)!;
    expect(document).toMatchObject({ version: 3, name: 'Untitled', cabinets: [], guides: [], materials: [] });
    expect(document.boards[0]).toMatchObject({ materialId: 'plywood' });
    expect(buildCutList(document)[0]!.material.name).toBe('Plywood');
  });

  it('comes back from a file exactly as it went in', () => {
    const document = documentOf(bookcase(), {
      name: 'Hall bookcase',
      materials: [{ id: 'm_walnut', name: 'Walnut ply', kind: 'sheet', grain: true, color: '#e3c9a0' }],
      guides: [{ id: 'g1', axis: 2, through: [inch(4), 0, 0] }],
    });
    const text = serializeDocument(document);
    expect(JSON.parse(text)).toMatchObject({ app: 'cabbage', version: 3, name: 'Hall bookcase' });
    expect(deserializeDocument(text)).toEqual(document);
  });

  it('turns away files that are not projects', () => {
    expect(deserializeDocument('not json')).toBeNull();
    expect(deserializeDocument('{"hello": 1}')).toBeNull();
    expect(deserializeDocument('[]')).toBeNull();
  });

  it('falls back to plywood for a material the file does not define, and refuses to redefine a built-in one', () => {
    const lost = parseDocument({ version: 2, boards: [{ ...bookcase()[0], materialId: 'm_gone' }] })!;
    expect(lost.boards[0]!.materialId).toBe('plywood');
    const hijack = { version: 2, boards: [], materials: [{ id: 'plywood', name: 'Gold', grain: false }] };
    expect(parseDocument(hijack)).toBeNull();
  });

  it('keeps project names fit for file names', () => {
    expect(cleanProjectName('  Kitchen: north/south  ')).toBe('Kitchen north south');
    expect(cleanProjectName('   ')).toBe('Untitled');
  });
});

describe('board details in the editor', () => {
  function memoryStorage(): EditorStorage & { data: Map<string, string> } {
    const data = new Map<string, string>();
    return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
  }

  function editorWith(boards: Board[]): Editor {
    const editor = new Editor();
    editor.addBoards(boards, 'Add boards');
    return editor;
  }

  it('renames several boards as one undo step', () => {
    const [left, right] = bookcase();
    const editor = editorWith([left!, right!]);
    expect(editor.renameBoards([left!.id, right!.id], '  End   panel ')).toBe(true);
    expect(editor.getState().document.boards.map((item) => item.name)).toEqual(['End panel', 'End panel']);
    expect(editor.getState().undoLabel).toBe('Rename of 2 boards');
    // The same name again, or an empty one, changes nothing.
    expect(editor.renameBoards([left!.id], 'End panel')).toBe(false);
    expect(editor.renameBoards([left!.id], '  ')).toBe(false);
    editor.undo();
    expect(editor.getState().document.boards.map((item) => item.name)).toEqual(['Side', 'Side']);
  });

  it('bands a side only on the boards where that side is an edge', () => {
    const side = board('Side', [SHEET, inch(12), inch(36)], 0);
    const shelf = board('Shelf', [inch(28), inch(12), SHEET], 2);
    const editor = editorWith([side, shelf]);
    // The top of a shelf is a wide face, so only the side takes banding there.
    editor.setBoardBanding([side.id, shelf.id], TOP, true);
    const [first, second] = editor.getState().document.boards;
    expect(first!.banding).toEqual([TOP]);
    expect(second!.banding).toBeUndefined();
    expect(editor.getState().undoLabel).toBe('Band edge');
    editor.setBoardBanding([side.id, shelf.id], TOP, false);
    expect(editor.getState().document.boards[0]!.banding).toBeUndefined();
  });

  it('sets the grain and the material', () => {
    const shelf = board('Shelf', [inch(28), inch(12), SHEET], 2);
    const editor = editorWith([shelf]);
    expect(editor.setBoardGrain([shelf.id], 2)).toBe(false);
    expect(editor.setBoardGrain([shelf.id], 1)).toBe(true);
    expect(editor.getState().document.boards[0]!.grain).toBe(1);
    expect(editor.setBoardGrain([shelf.id], null)).toBe(true);
    expect(editor.getState().document.boards[0]!.grain).toBeUndefined();
    expect(editor.setBoardMaterial([shelf.id], 'mdf')).toBe(true);
    expect(editor.getState().document.boards[0]!.materialId).toBe('mdf');
    expect(editor.setBoardMaterial([shelf.id], 'mdf')).toBe(false);
  });

  it('adds a material to the project and refuses a name already in use', () => {
    const editor = new Editor();
    const walnut = editor.addMaterial(' Walnut  ply ', true)!;
    expect(walnut).toMatchObject({ name: 'Walnut ply', grain: true, kind: 'sheet' });
    expect(editor.getState().document.materials).toEqual([walnut]);
    expect(editor.addMaterial('walnut ply', false)).toBeNull();
    expect(editor.addMaterial('plywood', false)).toBeNull();
    expect(editor.addMaterial('  ', false)).toBeNull();
  });

  it('knows when the model has changes that are not in a file', () => {
    const editor = new Editor();
    expect(editor.getState().unsaved).toBe(false);
    editor.addBoards([board('A', [inch(10), inch(10), SHEET], 2)], 'Add board');
    expect(editor.getState().unsaved).toBe(true);
    editor.markSaved();
    expect(editor.getState().unsaved).toBe(false);
    editor.renameProject('Bookcase');
    expect(editor.getState()).toMatchObject({ unsaved: true, undoLabel: 'Rename project' });
    // Undo back to what is in the file, and there is nothing left to save.
    editor.undo();
    expect(editor.getState().unsaved).toBe(false);
  });

  it('still knows the model is in a file after the page is loaded again', () => {
    const storage = memoryStorage();
    const editor = new Editor(storage);
    editor.addBoards([board('A', [inch(10), inch(10), SHEET], 2)], 'Add board');
    expect(new Editor(storage).getState().unsaved).toBe(true);
    editor.markSaved();
    expect(new Editor(storage).getState().unsaved).toBe(false);
    editor.renameBoards([editor.getState().document.boards[0]!.id], 'B');
    expect(new Editor(storage).getState().unsaved).toBe(true);
    editor.undo();
    expect(new Editor(storage).getState().unsaved).toBe(false);
  });

  it('opens another project with a clean history and no selection', () => {
    const editor = editorWith(bookcase());
    editor.setSelection([editor.getState().document.boards[0]!.id]);
    const other = documentOf([board('Lid', [inch(10), inch(10), SHEET], 2)], { name: 'Box' });
    editor.openDocument(other, true);
    expect(editor.getState()).toMatchObject({ document: other, canUndo: false, unsaved: false });
    expect(editor.getState().selection.size).toBe(0);
    editor.openDocument(EMPTY_DOCUMENT, false);
    expect(editor.getState()).toMatchObject({ document: EMPTY_DOCUMENT, unsaved: false });
  });

  it('remembers the stock between visits and draws with it', () => {
    const storage = memoryStorage();
    const editor = new Editor(storage);
    editor.setStock({ materialId: 'mdf', thickness: inch(0, 1, 2) });
    expect(new Editor(storage).getState().stock).toEqual({ materialId: 'mdf', thickness: inch(0, 1, 2) });
    // A stock naming a material that no longer exists falls back to plywood.
    storage.setItem('cabbage.stock', JSON.stringify({ materialId: 'm_gone', thickness: inch(0, 1, 2) }));
    expect(new Editor(storage).getState().stock.materialId).toBe('plywood');
    storage.setItem('cabbage.stock', 'nonsense');
    expect(new Editor(storage).getState().stock).toEqual({ materialId: 'plywood', thickness: SHEET });
  });
});
