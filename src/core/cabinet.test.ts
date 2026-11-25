import { describe, expect, it } from 'vitest';
import { boxMax, faceIndex, type Board } from './board';
import {
  cabinetBoards,
  cabinetBox,
  createCabinet,
  mostShelves,
  nextCabinetName,
  ownerId,
  parseCabinet,
  pullCabinet,
  resizeCabinet,
  smallestSize,
  turnCabinet,
  usualElevation,
  type Cabinet,
  type CabinetKind,
} from './cabinet';
import { buildCutList, describeBanding } from './cut-list';
import {
  EMPTY_DOCUMENT,
  addCabinets,
  deserializeDocument,
  modelBoards,
  parseDocument,
  serializeDocument,
  type CabbageDocument,
} from './document';
import { Editor } from './editor';
import { defaultStock } from './materials';
import { addCopies, pickedIn, pickedLabel } from './picked';
import { DEFAULT_UNIT_SETTINGS, formatLength, inchFraction, mm } from './units';
import type { Vec3L } from './vec';

const inch = inchFraction;
const T = inch(0, 3, 4);
const BACK = inch(0, 1, 4);
const FRONT = faceIndex(1, -1);

function cabinet(kind: CabinetKind = 'base', more: Partial<Cabinet> = {}): Cabinet {
  return { ...createCabinet('c1', 'Base 1', kind, 'imperial', defaultStock('imperial')), ...more };
}

const part = (boards: readonly Board[], key: string) => boards.find((board) => board.id === `c1/${key}`)!;
const keys = (boards: readonly Board[]) => boards.map((board) => board.id.slice(3));

/** "2 Side 3/4 x 23 3/4 x 34 1/2, 1 length edge" for every line of a cut list. */
function cutLines(document: CabbageDocument): string[] {
  const text = (length: number) => formatLength(length, DEFAULT_UNIT_SETTINGS).replace('"', '');
  return buildCutList(document).flatMap((group) =>
    group.parts.map((line) =>
      [
        `${line.quantity} ${line.names.join('/')} ${text(line.thickness)} x ${text(line.width)} x ${text(line.length)}`,
        describeBanding(line),
      ]
        .filter(Boolean)
        .join(', '),
    ),
  );
}

describe('the cabinet recipe', () => {
  it('builds a base cabinet from two sides, a bottom, two stretchers, a back, a toe kick, and a shelf', () => {
    const boards = cabinetBoards(cabinet());
    expect(keys(boards)).toEqual([
      'side-left',
      'side-right',
      'bottom',
      'stretcher-front',
      'stretcher-back',
      'back',
      'toe-kick',
      'shelf-1',
    ]);
    // The cabinet stands behind its front: back at y = 0, front at y = -24".
    expect(part(boards, 'side-left')).toMatchObject({ min: [0, inch(-24), 0], size: [T, inch(23, 3, 4), inch(34, 1, 2)] });
    expect(part(boards, 'side-right')).toMatchObject({ min: [inch(23, 1, 4), inch(-24), 0] });
    // The bottom sits between the sides, on top of the toe kick.
    expect(part(boards, 'bottom')).toMatchObject({
      min: [T, inch(-24), inch(4)],
      size: [inch(22, 1, 2), inch(23, 3, 4), T],
      thicknessAxis: 2,
      grain: 0,
      banding: [FRONT],
    });
    expect(part(boards, 'stretcher-front')).toMatchObject({ min: [T, inch(-24), inch(33, 3, 4)], size: [inch(22, 1, 2), inch(4), T] });
    expect(part(boards, 'stretcher-back')).toMatchObject({ min: [T, -inch(4, 1, 4), inch(33, 3, 4)] });
    // The back covers the back edges of the sides and stops at the bottom panel.
    expect(part(boards, 'back')).toMatchObject({ min: [0, -BACK, inch(4)], size: [inch(24), BACK, inch(30, 1, 2)], thicknessAxis: 1 });
    // The toe kick stands 3" behind the front.
    expect(part(boards, 'toe-kick')).toMatchObject({ min: [T, inch(-21), 0], size: [inch(22, 1, 2), T, inch(4)], thicknessAxis: 1 });
    // The shelf is 1/8" narrower than the opening and 1/4" shy of the front, halfway up the inside.
    expect(part(boards, 'shelf-1')).toMatchObject({
      min: [inch(0, 13, 16), -inch(23, 3, 4), inch(18, 7, 8)],
      size: [inch(22, 3, 8), inch(23, 1, 2), T],
    });
    for (const board of boards) expect(board.cabinetId).toBe('c1');
  });

  it('gives wall and tall cabinets a full top, and wall cabinets no toe kick', () => {
    const wall = cabinetBoards(cabinet('wall'));
    expect(keys(wall)).toEqual(['side-left', 'side-right', 'bottom', 'top', 'back', 'shelf-1', 'shelf-2']);
    expect(part(wall, 'top')).toMatchObject({ min: [T, inch(-12), inch(29, 1, 4)], size: [inch(22, 1, 2), inch(11, 3, 4), T] });
    expect(part(wall, 'back')).toMatchObject({ min: [0, -BACK, 0], size: [inch(24), BACK, inch(30)] });

    const tall = cabinetBoards(cabinet('tall'));
    expect(keys(tall)).toEqual([
      'side-left',
      'side-right',
      'bottom',
      'top',
      'back',
      'toe-kick',
      'shelf-1',
      'shelf-2',
      'shelf-3',
      'shelf-4',
    ]);
    expect(part(tall, 'side-left').size).toEqual([T, inch(23, 3, 4), inch(84)]);
  });

  it('spaces shelves so every opening is the same', () => {
    // Inside height 28 1/2" with three 3/4" shelves leaves four openings of 6 9/16".
    const boards = cabinetBoards(cabinet('wall', { shelves: 3 }));
    const tops = [T, ...[1, 2, 3].map((index) => boxMax(part(boards, `shelf-${index}`))[2])];
    const bottoms = [...[1, 2, 3].map((index) => part(boards, `shelf-${index}`).min[2]), inch(29, 1, 4)];
    expect(bottoms.map((bottom, index) => bottom - tops[index]!)).toEqual(Array(4).fill(inch(6, 9, 16)));
  });

  it('gives a shallow base cabinet a full top, and sets a toe kick flush when there is no room to set it back', () => {
    const shallow = cabinetBoards(cabinet('base', { depth: inch(8) }));
    expect(keys(shallow)).toContain('top');
    expect(keys(shallow)).not.toContain('stretcher-front');
    const thin = cabinetBoards(cabinet('base', { depth: inch(3, 1, 2) }));
    expect(part(thin, 'toe-kick').min[1]).toBe(-inch(3, 1, 2));
  });

  it('leaves the toe kick out at zero, and sets the bottom on the floor', () => {
    const boards = cabinetBoards(cabinet('base', { toeKick: 0 }));
    expect(keys(boards)).not.toContain('toe-kick');
    expect(part(boards, 'bottom').min[2]).toBe(0);
    expect(part(boards, 'back').size[2]).toBe(inch(34, 1, 2));
  });

  it('hands back the very same boards for the same cabinet', () => {
    const one = cabinet();
    expect(cabinetBoards(one)).toBe(cabinetBoards(one));
    expect(ownerId('c1/side-left')).toBe('c1');
    expect(ownerId('b7')).toBe('b7');
  });

  it('uses metric sizes and allowances in a metric model', () => {
    const base = createCabinet('c1', 'Base 1', 'base', 'metric', defaultStock('metric'));
    expect(base).toMatchObject({ width: mm(600), height: mm(870), depth: mm(560), toeKick: mm(150) });
    expect(base.build).toMatchObject({ thickness: mm(18), backThickness: mm(6), toeKickSetback: mm(75) });
    expect(usualElevation('wall', 'metric')).toBe(mm(1400));
    expect(usualElevation('base', 'metric')).toBe(0);
  });

  it('grows the usual size just enough for very thick stock', () => {
    const chunky = createCabinet('c1', 'Wall 1', 'wall', 'imperial', { materialId: 'plywood', thickness: inch(6) });
    expect(chunky.width).toBe(inch(24));
    expect(chunky.height).toBe(inch(30));
    const huge = createCabinet('c1', 'Wall 1', 'wall', 'imperial', { materialId: 'plywood', thickness: inch(16) });
    expect(huge.width).toBe(smallestSize(huge).width);
    expect(resizeCabinet(huge, {})).not.toBeNull();
  });
});

describe('the cut list of a cabinet', () => {
  it('lists a base cabinet the way it would be cut', () => {
    expect(cutLines(addCabinets(EMPTY_DOCUMENT, [cabinet()]))).toEqual([
      '2 Side 3/4 x 23 3/4 x 34 1/2, 1 length edge',
      '1 Bottom 3/4 x 23 3/4 x 22 1/2, 1 length edge',
      '1 Stretcher 3/4 x 4 x 22 1/2, 1 length edge',
      // The rear stretcher and the toe kick are the same size, so they are one line.
      '2 Stretcher/Toe kick 3/4 x 4 x 22 1/2',
      '1 Shelf 3/4 x 23 1/2 x 22 3/8, 1 length edge',
      '1 Back 1/4 x 24 x 30 1/2',
    ]);
  });

  it('is the same list whichever way the cabinet is turned', () => {
    const straight = cutLines(addCabinets(EMPTY_DOCUMENT, [cabinet()]));
    for (const turns of [1, 2, 3]) {
      const turned = turnCabinet(cabinet(), [inch(5), inch(7), 0], turns);
      expect(cutLines(addCabinets(EMPTY_DOCUMENT, [turned]))).toEqual(straight);
    }
  });

  it('merges matching parts across cabinets and points each line at the cabinets it came from', () => {
    const document = addCabinets(EMPTY_DOCUMENT, [cabinet(), cabinet('base', { id: 'c2', name: 'Base 2' })]);
    const sides = buildCutList(document)[0]!.parts[0]!;
    expect(sides).toMatchObject({ quantity: 4, names: ['Side'], renamable: false });
    expect(sides.ownerIds).toEqual(['c1', 'c2']);
  });

  it('follows the cabinet when a size changes', () => {
    const wider = resizeCabinet(cabinet(), { width: inch(30) })!;
    expect(cutLines(addCabinets(EMPTY_DOCUMENT, [wider]))).toContain('1 Bottom 3/4 x 23 3/4 x 28 1/2, 1 length edge');
  });
});

describe('changing the size of a cabinet', () => {
  it('turns down sizes that could not be built', () => {
    const base = cabinet();
    expect(resizeCabinet(base, { width: inch(3) })).toBeNull();
    expect(resizeCabinet(base, { height: inch(5) })).toBeNull();
    expect(resizeCabinet(base, { depth: inch(1) })).toBeNull();
    expect(resizeCabinet(base, { width: mm(6001) })).toBeNull();
    expect(resizeCabinet(base, { width: 1.5 })).toBeNull();
    expect(resizeCabinet(base, { width: -inch(24) })).toBeNull();
    expect(resizeCabinet(base, { width: inch(30), depth: inch(22) })).toMatchObject({ width: inch(30), depth: inch(22) });
  });

  it('takes no toe kick, or one at least as tall as the stock is thick', () => {
    const base = cabinet();
    expect(resizeCabinet(base, { toeKick: 0 })?.toeKick).toBe(0);
    expect(resizeCabinet(base, { toeKick: inch(0, 1, 2) })).toBeNull();
    expect(resizeCabinet(base, { toeKick: inch(1) })?.toeKick).toBe(inch(1));
    expect(resizeCabinet(base, { toeKick: inch(33) })).toBeNull();
  });

  it('holds as many shelves as fit, and drops the ones that no longer fit when it gets shorter', () => {
    const wall = cabinet('wall', { shelves: 8 });
    // 28 1/2" inside: each shelf needs its 3/4" and about 2" of opening.
    expect(mostShelves(wall)).toBe(9);
    expect(resizeCabinet(wall, { shelves: 9 })?.shelves).toBe(9);
    expect(resizeCabinet(wall, { shelves: 10 })).toBeNull();
    const short = resizeCabinet(wall, { height: inch(12) })!;
    expect(short.shelves).toBe(mostShelves(short));
    expect(short.shelves).toBeLessThan(8);
    expect(cabinetBoards(short).filter((board) => board.name === 'Shelf')).toHaveLength(short.shelves);
  });
});

describe('a cabinet turned and pulled', () => {
  const at: Vec3L = [inch(100), inch(50), 0];

  it('keeps its back left corner in place as it turns', () => {
    const boxes = [0, 1, 2, 3].map((turns) => cabinetBox(cabinet('base', { position: at, turns: turns as Cabinet['turns'] })));
    // Facing front, right, back, and left in turn. Depth runs the way it faces.
    expect(boxes[0]).toEqual({ min: [inch(100), inch(26), 0], size: [inch(24), inch(24), inch(34, 1, 2)] });
    expect(boxes[1]).toEqual({ min: [inch(100), inch(50), 0], size: [inch(24), inch(24), inch(34, 1, 2)] });
    expect(boxes[2]).toEqual({ min: [inch(76), inch(50), 0], size: [inch(24), inch(24), inch(34, 1, 2)] });
    expect(boxes[3]).toEqual({ min: [inch(76), inch(26), 0], size: [inch(24), inch(24), inch(34, 1, 2)] });
  });

  it('keeps every board inside its box however it is turned', () => {
    for (const turns of [0, 1, 2, 3] as const) {
      const turned = cabinet('base', { position: at, turns, width: inch(30), depth: inch(18) });
      const box = cabinetBox(turned);
      const boards = cabinetBoards(turned);
      const lows = [0, 1, 2].map((axis) => Math.min(...boards.map((board) => board.min[axis]!)));
      const highs = [0, 1, 2].map((axis) => Math.max(...boards.map((board) => boxMax(board)[axis]!)));
      expect(lows).toEqual(box.min);
      expect(highs).toEqual(boxMax(box));
    }
  });

  it('turns about a point, a quarter turn at a time', () => {
    const turned = turnCabinet(cabinet(), [inch(10), 0, 0], 1);
    expect(turned).toMatchObject({ turns: 1, position: [inch(10), inch(-10), 0] });
    expect(turnCabinet(turned, [inch(10), 0, 0], -1)).toEqual(cabinet());
    expect(turnCabinet(cabinet(), [0, 0, 0], 6).turns).toBe(2);
  });

  it('moves the pulled face and leaves the opposite one where it is', () => {
    const base = cabinet('base', { position: at });
    // Right side out 6": wider, same corner.
    expect(pullCabinet(base, 0, 1, inch(6))).toMatchObject({ position: at, width: inch(30) });
    // Left side out 6": wider, and the corner moves left.
    expect(pullCabinet(base, 0, -1, inch(6))).toMatchObject({ position: [inch(94), inch(50), 0], width: inch(30) });
    // Front out 3": deeper, the back stays on the wall.
    expect(pullCabinet(base, 1, -1, inch(3))).toMatchObject({ position: at, depth: inch(27) });
    // Back out 3": deeper, and the back corner moves with it.
    expect(pullCabinet(base, 1, 1, inch(3))).toMatchObject({ position: [inch(100), inch(53), 0], depth: inch(27) });
    // Top up, bottom down.
    expect(pullCabinet(base, 2, 1, inch(2))).toMatchObject({ position: at, height: inch(36, 1, 2) });
    expect(pullCabinet(base, 2, -1, inch(2))).toMatchObject({ position: [inch(100), inch(50), inch(-2)], height: inch(36, 1, 2) });
  });

  it('pulls the right size when the cabinet is turned', () => {
    // A quarter turn: the cabinet faces right, so its width runs front to back.
    const turned = cabinet('base', { position: at, turns: 1 });
    const deeper = pullCabinet(turned, 0, 1, inch(6));
    expect(deeper).toMatchObject({ depth: inch(30), width: inch(24), position: at });
    const wider = pullCabinet(turned, 1, 1, inch(6));
    expect(wider).toMatchObject({ width: inch(30), depth: inch(24), position: at });
    // The box only grew on the side that was pulled.
    expect(cabinetBox(wider)).toEqual({ min: at, size: [inch(24), inch(30), inch(34, 1, 2)] });
    const fromBack = pullCabinet(turned, 0, -1, inch(6));
    expect(cabinetBox(fromBack)).toEqual({ min: [inch(94), inch(50), 0], size: [inch(30), inch(24), inch(34, 1, 2)] });
  });

  it('stops at the smallest cabinet that can be built', () => {
    const squeezed = pullCabinet(cabinet(), 0, 1, -inch(40));
    expect(squeezed.width).toBe(smallestSize(cabinet()).width);
    const squat = pullCabinet(cabinet('tall'), 2, 1, -inch(70));
    expect(squat.shelves).toBe(mostShelves(squat));
  });
});

describe('cabinets in a saved project', () => {
  const stored = () => addCabinets(EMPTY_DOCUMENT, [cabinet(), cabinet('wall', { id: 'c2', name: 'Uppers', turns: 3 })]);

  it('saves cabinets as their sizes, not their boards, and reads them back the same', () => {
    const text = serializeDocument(stored());
    const saved = JSON.parse(text) as { version: number; boards: unknown[]; cabinets: unknown[] };
    expect(saved.version).toBe(3);
    expect(saved.boards).toEqual([]);
    expect(saved.cabinets).toHaveLength(2);
    expect(text).not.toContain('side-left');
    expect(deserializeDocument(text)).toEqual(stored());
  });

  it('opens a project saved before cabinets existed', () => {
    const older = JSON.parse(serializeDocument(EMPTY_DOCUMENT)) as Record<string, unknown>;
    older.version = 2;
    delete older.cabinets;
    expect(parseDocument(older)).toMatchObject({ cabinets: [] });
  });

  it('turns down a project with a cabinet that could not be built, or one that shares an id', () => {
    const saved = () => JSON.parse(serializeDocument(stored())) as { cabinets: Record<string, unknown>[] };
    const tooNarrow = saved();
    tooNarrow.cabinets[0] = { ...tooNarrow.cabinets[0], width: 10 };
    expect(parseDocument(tooNarrow)).toBeNull();
    const twins = saved();
    twins.cabinets[1] = { ...twins.cabinets[1], id: 'c1' };
    expect(parseDocument(twins)).toBeNull();
  });

  it('checks every part of a saved cabinet', () => {
    const good = JSON.parse(JSON.stringify(cabinet())) as Record<string, unknown>;
    const materials = new Set(['plywood']);
    const parse = (change: Record<string, unknown>) => parseCabinet({ ...good, ...change }, materials, 'plywood');
    expect(parse({})).toEqual(cabinet());
    expect(parse({ id: 'c1/side' })).toBeNull();
    expect(parse({ kind: 'corner' })).toBeNull();
    expect(parse({ turns: 4 })).toBeNull();
    expect(parse({ position: [0, 0] })).toBeNull();
    expect(parse({ build: null })).toBeNull();
    expect(parse({ shelves: 2.5 })).toBeNull();
    // An unknown material falls back, and too many shelves are trimmed to what fits.
    expect(parse({ materialId: 'gone' })?.materialId).toBe('plywood');
    expect(parse({ shelves: 500 })?.shelves).toBe(mostShelves(cabinet()));
  });
});

describe('cabinets in the editor', () => {
  it('places cabinets named in order, each as one undo step', () => {
    const editor = new Editor();
    const first = editor.placeCabinet([0, 0, 0])!;
    const second = editor.placeCabinet([inch(24), 0, 0], { width: inch(30), height: inch(34, 1, 2), depth: inch(24) })!;
    expect([first.name, second.name]).toEqual(['Base 1', 'Base 2']);
    expect(second.width).toBe(inch(30));
    expect(editor.getState().undoLabel).toBe('Place cabinet');
    expect(editor.placeCabinet([0, 0, 0], { width: inch(1), height: inch(30), depth: inch(24) })).toBeNull();
    editor.setCabinetKind('wall');
    expect(editor.placeCabinet([0, 0, 0])?.name).toBe('Wall 1');
    editor.undo();
    editor.undo();
    expect(editor.getState().document.cabinets.map((item) => item.name)).toEqual(['Base 1']);
    expect(modelBoards(editor.getState().document)).toHaveLength(8);
  });

  it('makes new cabinets from the stock picked for new work', () => {
    const editor = new Editor();
    editor.setStock({ thickness: inch(0, 1, 2), materialId: 'mdf' });
    const made = editor.placeCabinet([0, 0, 0])!;
    expect(made).toMatchObject({ materialId: 'mdf', build: { thickness: inch(0, 1, 2) } });
    expect(cabinetBoards(made)[0]!.size[0]).toBe(inch(0, 1, 2));
  });

  it('resizes several cabinets together, or none when one of them cannot take the size', () => {
    const editor = new Editor();
    const base = editor.placeCabinet([0, 0, 0])!;
    const tall = editor.placeCabinet([inch(24), 0, 0], undefined, 'tall')!;
    expect(editor.resizeCabinets([base.id, tall.id], { width: inch(18) })).toBe(true);
    expect(editor.getState().document.cabinets.map((item) => item.width)).toEqual([inch(18), inch(18)]);
    expect(editor.getState().undoLabel).toBe('Resize cabinet of 2 cabinets');
    // 20 shelves fit the tall cabinet and not the base one.
    expect(editor.resizeCabinets([base.id, tall.id], { shelves: 20 })).toBe(false);
    expect(editor.getState().document.cabinets.map((item) => item.shelves)).toEqual([1, 4]);
    // Nothing to do is not an undo step.
    expect(editor.resizeCabinets([base.id], { width: inch(18) })).toBe(false);
  });

  it('renames a cabinet and changes its material', () => {
    const editor = new Editor();
    const base = editor.placeCabinet([0, 0, 0])!;
    expect(editor.renameCabinets([base.id], '  Sink   base ')).toBe(true);
    expect(editor.setCabinetMaterial([base.id], 'mdf')).toBe(true);
    expect(editor.getState().document.cabinets[0]).toMatchObject({ name: 'Sink base', materialId: 'mdf' });
    expect(modelBoards(editor.getState().document).every((board) => board.materialId === 'mdf')).toBe(true);
    expect(editor.renameCabinets([base.id], '   ')).toBe(false);
  });

  it('unlocks a cabinet into plain boards that stand where it stood', () => {
    const editor = new Editor();
    const base = editor.placeCabinet([inch(10), inch(30), 0])!;
    const before = cabinetBoards(base);
    expect(editor.unlockCabinets([base.id])).toBe(true);
    const { document, selection, undoLabel } = editor.getState();
    expect(document.cabinets).toEqual([]);
    expect(document.boards).toHaveLength(8);
    expect(document.boards.map(({ name, min, size }) => ({ name, min, size }))).toEqual(
      before.map(({ name, min, size }) => ({ name, min, size })),
    );
    for (const board of document.boards) {
      expect(board.id).not.toContain('/');
      expect(board.cabinetId).toBeUndefined();
    }
    expect([...selection].sort()).toEqual(document.boards.map((board) => board.id).sort());
    expect(undoLabel).toBe('Unlock cabinet');
    // The plain boards save and open like any others.
    expect(deserializeDocument(serializeDocument(document))?.boards).toHaveLength(8);
    editor.undo();
    expect(editor.getState().document.cabinets).toHaveLength(1);
    expect(editor.getState().document.boards).toEqual([]);
  });

  it('deletes a selected cabinet whole, and says what it deleted', () => {
    const editor = new Editor();
    const base = editor.placeCabinet([0, 0, 0])!;
    editor.placeCabinet([inch(24), 0, 0]);
    editor.setSelection([base.id]);
    expect(editor.deleteSelection()).toBe(true);
    expect(editor.getState().document.cabinets.map((item) => item.name)).toEqual(['Base 2']);
    expect(editor.getState().undoLabel).toBe('Delete cabinet');
  });

  it('counts a model with only cabinets as work that could be lost', () => {
    const editor = new Editor();
    expect(editor.getState().unsaved).toBe(false);
    editor.placeCabinet([0, 0, 0]);
    expect(editor.getState().unsaved).toBe(true);
  });
});

describe('copies of cabinets', () => {
  it('gives a copy the next number, and keeps a name typed by hand', () => {
    const document = addCabinets(EMPTY_DOCUMENT, [cabinet(), cabinet('base', { id: 'c2', name: 'Sink base' })]);
    const copied = addCopies(document, pickedIn(document, new Set(['c1', 'c2'])));
    expect(copied.document.cabinets.map((item) => item.name)).toEqual(['Base 1', 'Sink base', 'Base 2', 'Sink base']);
    expect(copied.ids).toHaveLength(2);
    expect(new Set([...copied.ids, 'c1', 'c2']).size).toBe(4);
    expect(nextCabinetName(copied.document.cabinets, 'base')).toBe('Base 3');
    expect(nextCabinetName(copied.document.cabinets, 'tall')).toBe('Tall 1');
  });

  it('names edits after what they apply to', () => {
    const one = cabinet();
    const board = cabinetBoards(one)[0]!;
    expect(pickedLabel('Move', { boards: [], cabinets: [one] })).toBe('Move cabinet');
    expect(pickedLabel('Move', { boards: [], cabinets: [one, one] })).toBe('Move 2 cabinets');
    expect(pickedLabel('Copy', { boards: [board], cabinets: [] })).toBe('Copy board');
    expect(pickedLabel('Turn', { boards: [board, board], cabinets: [one] })).toBe('Turn 3 items');
  });
});
