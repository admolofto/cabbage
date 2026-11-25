import { beforeEach, describe, expect, it } from 'vitest';
import type { Board } from '../core/board';
import { Editor } from '../core/editor';
import { inchFraction, mm } from '../core/units';
import type { Vec3L } from '../core/vec';
import { createTestView } from '../test-support/view';
import { ToolManager, type KeyInput } from './tool-manager';

const inch = inchFraction;
const SHEET = inch(0, 3, 4);

let editor: Editor;
let tools: ToolManager;
let view: ReturnType<typeof createTestView>;

const boards = () => editor.getState().document.boards;
const measurement = () => editor.getState().measurement;

function key(name: string, modifiers: Partial<KeyInput> = {}): boolean {
  return tools.key({ key: name, command: false, shift: false, alt: false, ...modifiers });
}

function type(text: string): void {
  for (const character of text) key(character);
}

function move(point: Vec3L, offset?: { x?: number; y?: number }): void {
  tools.pointerMove(view.pointerAt(point, offset));
}

function click(point: Vec3L, offset?: { x?: number; y?: number }): void {
  const pointer = view.pointerAt(point, offset);
  tools.pointerMove(pointer);
  tools.pointerDown(pointer);
  tools.pointerUp(pointer);
}

beforeEach(() => {
  editor = new Editor();
  tools = new ToolManager(editor);
  view = createTestView();
  key('b');
});

describe('drawing a board with the mouse', () => {
  it('takes two clicks and Enter to make a board of the usual thickness', () => {
    click([0, 0, 0]);
    click([inch(24), inch(12), 0]);
    expect(boards()).toHaveLength(0);
    expect(measurement()).toMatchObject({ label: 'Thickness', value: '3/4"' });

    expect(key('Enter')).toBe(true);
    expect(boards()).toHaveLength(1);
    expect(boards()[0]).toMatchObject({
      name: 'Board 1',
      min: [0, 0, 0],
      size: [inch(24), inch(12), SHEET],
      thicknessAxis: 2,
    });
    expect(editor.getState().undoLabel).toBe('Draw board');
  });

  it('shows the size while the second corner is being placed', () => {
    click([0, 0, 0]);
    move([inch(24), inch(12), 0]);
    expect(measurement()).toMatchObject({ label: 'Size X, Y', value: '24", 12"' });
    const preview = tools.preview();
    expect(preview.outline).toHaveLength(4);
    expect(preview.dimensions.map((dimension) => dimension.text)).toEqual(['24"', '12"']);
  });

  it('draws the face with one press, drag, and release', () => {
    const start = view.pointerAt([0, 0, 0]);
    const end = view.pointerAt([inch(24), inch(12), 0]);
    tools.pointerMove(start);
    tools.pointerDown(start);
    tools.pointerMove(end);
    tools.pointerUp(end);
    expect(measurement().label).toBe('Thickness');
    key('Enter');
    expect(boards()[0]?.size).toEqual([inch(24), inch(12), SHEET]);
  });

  it('sets the thickness by moving along the board normal', () => {
    click([0, 0, 0]);
    click([inch(24), inch(12), 0]);
    click([inch(24), inch(12), inch(6)]);
    expect(boards()[0]?.size).toEqual([inch(24), inch(12), inch(6)]);
  });

  it('keeps the usual thickness until the cursor really moves', () => {
    click([0, 0, 0]);
    click([inch(24), inch(12), 0]);
    move([inch(24), inch(12), 0], { x: 2, y: -1 });
    expect(measurement().value).toBe('3/4"');
  });

  it('lands free drags on round numbers when zoomed out', () => {
    view = createTestView({ position: [6000, -7500, 5400] });
    // An inch is about three pixels from here, so a cursor a pixel off still lands on whole inches.
    click([inch(10), inch(5), 0], { x: 1 });
    click([inch(34), inch(17), 0], { x: -1 });
    key('Enter');
    expect(boards()[0]).toMatchObject({ min: [inch(10), inch(5), 0], size: [inch(24), inch(12), SHEET] });
  });

  it('ignores a second click on the first corner', () => {
    click([0, 0, 0]);
    click([0, 0, 0]);
    expect(measurement().label).toBe('Size X, Y');
  });
});

describe('snapping while drawing', () => {
  const BOX: Board = { id: 'box', name: 'Box', min: [0, 0, 0], size: [inch(24), inch(12), inch(6)], thicknessAxis: 2 };

  beforeEach(() => editor.addBoards([BOX], 'Add box'));

  it('starts exactly on a corner and shows what it snapped to', () => {
    move([inch(24), 0, inch(6)], { x: 3, y: 3 });
    expect(tools.preview().marker).toMatchObject({ kind: 'corner', label: 'Corner', point: [inch(24), 0, inch(6)] });
  });

  it('draws on top of a board and grows upward from it', () => {
    click([inch(4), inch(4), inch(6)]);
    click([inch(20), inch(10), inch(6)]);
    key('Enter');
    expect(boards()[1]).toMatchObject({ min: [inch(4), inch(4), inch(6)], size: [inch(16), inch(6), SHEET] });
  });

  it('lines a floor corner up with a corner higher up', () => {
    click([inch(40), inch(-10), 0]);
    move([inch(24), 0, inch(6)]);
    expect(tools.preview().marker).toMatchObject({ label: 'In line with corner', source: [inch(24), 0, inch(6)] });
    click([inch(24), 0, inch(6)]);
    key('Enter');
    expect(boards()[1]).toMatchObject({ min: [inch(24), inch(-10), 0], size: [inch(16), inch(10), SHEET] });
  });

  it('keeps round sizes when the second corner lines up with an edge', () => {
    click([inch(30), inch(-10), 0]);
    move([inch(24), inch(9), inch(6)], { x: 2 });
    expect(tools.preview().marker?.label).toBe('In line with edge');
    expect(measurement().value).toBe('6", 19"');
  });

  it('matches the height of a corner when setting the thickness', () => {
    click([inch(30), 0, 0]);
    click([inch(40), inch(10), 0]);
    move([inch(24), 0, inch(6)]);
    expect(measurement().value).toBe('6"');
  });
});

describe('typed measurements', () => {
  it('sets both sizes, then the thickness', () => {
    click([0, 0, 0]);
    move([inch(5), inch(3), 0]);
    type('24, 34 1/2');
    expect(measurement().typed).toBe('24, 34 1/2');
    key('Enter');
    expect(measurement()).toMatchObject({ label: 'Thickness', typed: null });
    type('1/2');
    key('Enter');
    expect(boards()[0]).toMatchObject({ min: [0, 0, 0], size: [inch(24), inch(34, 1, 2), inch(0, 1, 2)] });
  });

  it('goes the way the cursor is heading', () => {
    click([0, 0, 0]);
    move([inch(-5), inch(3), 0]);
    type('24, 12');
    key('Enter');
    key('Enter');
    expect(boards()[0]).toMatchObject({ min: [inch(-24), 0, 0], size: [inch(24), inch(12), SHEET] });
  });

  it('changes only the size that was typed', () => {
    click([0, 0, 0]);
    move([inch(20), inch(10), 0]);
    type(', 18');
    key('Enter');
    key('Enter');
    expect(boards()[0]?.size).toEqual([inch(20), inch(18), SHEET]);
  });

  it('takes metric in an imperial project', () => {
    click([0, 0, 0]);
    move([inch(5), inch(3), 0]);
    type('600mm, 300mm');
    key('Enter');
    type('18mm');
    key('Enter');
    expect(boards()[0]?.size).toEqual([mm(600), mm(300), mm(18)]);
  });

  it('corrects the thickness of the board just drawn without a second undo step', () => {
    click([0, 0, 0]);
    click([inch(24), inch(12), 0]);
    key('Enter');
    type('1/4');
    key('Enter');
    expect(boards()).toHaveLength(1);
    expect(boards()[0]?.size[2]).toBe(inch(0, 1, 4));

    key('z', { command: true });
    expect(boards()).toHaveLength(0);
  });

  it('stops offering to correct a board once something else has changed', () => {
    click([0, 0, 0]);
    click([inch(24), inch(12), 0]);
    key('Enter');
    key('z', { command: true });
    expect(key('5')).toBe(false);
    expect(measurement().typed).toBeNull();
  });

  it('marks text it cannot read and keeps it for fixing', () => {
    click([0, 0, 0]);
    move([inch(5), inch(3), 0]);
    type('24, abc');
    key('Enter');
    expect(measurement()).toMatchObject({ typed: '24, abc', error: true, label: 'Size X, Y' });
    for (let count = 0; count < 3; count += 1) key('Backspace');
    expect(measurement()).toMatchObject({ typed: '24, ', error: false });
    type('12');
    key('Enter');
    expect(measurement().label).toBe('Thickness');
  });

  it('drops half typed text on Escape without leaving the step', () => {
    click([0, 0, 0]);
    move([inch(5), inch(3), 0]);
    type('24');
    key('Escape');
    expect(measurement()).toMatchObject({ typed: null, label: 'Size X, Y' });
  });

  it('does not treat letters as tool shortcuts while typing', () => {
    click([0, 0, 0]);
    move([inch(5), inch(3), 0]);
    type('600mm');
    expect(editor.getState().tool).toBe('board');
    expect(measurement().typed).toBe('600mm');
  });

  it('leaves digits alone before anything is being drawn', () => {
    expect(key('5')).toBe(false);
  });
});

describe('keys while drawing', () => {
  it('stands the board up with the arrow keys', () => {
    click([0, 0, 0]);
    key('ArrowLeft');
    move([inch(24), 0, inch(30)]);
    expect(measurement()).toMatchObject({ label: 'Size X, Z', value: '24", 30"' });
    click([inch(24), 0, inch(30)]);
    key('Enter');
    // It grows toward the viewer, who is on the negative Y side.
    expect(boards()[0]).toMatchObject({ min: [0, -SHEET, 0], size: [inch(24), SHEET, inch(30)], thicknessAxis: 1 });
  });

  it('unlocks when the same arrow is pressed again', () => {
    click([0, 0, 0]);
    key('ArrowRight');
    key('ArrowRight');
    move([inch(24), inch(12), 0]);
    expect(measurement().label).toBe('Size X, Y');
  });

  it('backs out one step with Escape', () => {
    click([0, 0, 0]);
    expect(key('Escape')).toBe(true);
    expect(measurement().label).toBe('Size');
    expect(key('Escape')).toBe(false);
  });

  it('cancels the drawing on undo instead of removing the board before it', () => {
    click([0, 0, 0]);
    click([inch(24), inch(12), 0]);
    key('Enter');
    click([inch(30), 0, 0]);
    key('z', { command: true });
    expect(boards()).toHaveLength(1);
    expect(measurement().label).toBe('Size');
    key('z', { command: true });
    expect(boards()).toHaveLength(0);
  });

  it('switches tools with Space, B, O, and H', () => {
    for (const [name, tool] of [[' ', 'select'], ['o', 'orbit'], ['h', 'pan'], ['B', 'board']] as const) {
      key(name);
      expect(editor.getState().tool).toBe(tool);
    }
  });
});

describe('selecting', () => {
  const BOX: Board = { id: 'box', name: 'Box', min: [0, 0, 0], size: [inch(24), inch(12), inch(6)], thicknessAxis: 2 };
  const OTHER: Board = { ...BOX, id: 'other', name: 'Other', min: [inch(40), 0, 0] };
  const onBox: Vec3L = [inch(12), inch(6), inch(6)];
  const onOther: Vec3L = [inch(52), inch(6), inch(6)];
  const onFloor: Vec3L = [inch(30), inch(-20), 0];

  beforeEach(() => {
    editor.addBoards([BOX, OTHER], 'Add boxes');
    key(' ');
  });

  it('highlights the board under the cursor', () => {
    move(onBox);
    expect(editor.getState().hovered).toBe('box');
    move(onFloor);
    expect(editor.getState().hovered).toBeNull();
  });

  it('selects on click, adds with Shift, and clears on a click on nothing', () => {
    click(onBox);
    expect([...editor.getState().selection]).toEqual(['box']);

    const shifted = view.pointerAt(onOther, {}, true);
    tools.pointerDown(shifted);
    expect([...editor.getState().selection]).toEqual(['box', 'other']);
    tools.pointerDown(shifted);
    expect([...editor.getState().selection]).toEqual(['box']);

    click(onFloor);
    expect(editor.getState().selection.size).toBe(0);
  });

  it('deletes the selection and brings it back with undo', () => {
    click(onBox);
    expect(key('Delete')).toBe(true);
    expect(boards().map((board) => board.id)).toEqual(['other']);
    key('z', { command: true });
    expect(boards()).toHaveLength(2);
    expect(key('Delete')).toBe(false);
  });

  it('selects everything with Ctrl A and clears with Escape', () => {
    key('a', { command: true });
    expect(editor.getState().selection.size).toBe(2);
    expect(key('Escape')).toBe(true);
    expect(editor.getState().selection.size).toBe(0);
  });
});
