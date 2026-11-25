import { beforeEach, describe, expect, it } from 'vitest';
import { boxCorners, type Board } from '../core/board';
import { Editor } from '../core/editor';
import { inchFraction } from '../core/units';
import type { Vec3L } from '../core/vec';
import { createTestView } from '../test-support/view';
import { ToolManager, type KeyInput } from './tool-manager';

const inch = inchFraction;

/** Two boxes, 24" wide, 12" deep, and 6" tall, standing 16" apart along X. */
const BOX: Board = { id: 'box', name: 'Box', min: [0, 0, 0], size: [inch(24), inch(12), inch(6)], thicknessAxis: 2, materialId: 'plywood' };
const OTHER: Board = { ...BOX, id: 'other', name: 'Other', min: [inch(40), 0, 0] };

let editor: Editor;
let tools: ToolManager;
let view: ReturnType<typeof createTestView>;

const boards = () => editor.getState().document.boards;
const board = (id: string) => boards().find((candidate) => candidate.id === id)!;
const guides = () => editor.getState().document.guides;
const measurement = () => editor.getState().measurement;
const selection = () => [...editor.getState().selection];

function key(name: string, modifiers: Partial<KeyInput> = {}): boolean {
  return tools.key({ key: name, command: false, shift: false, alt: false, ...modifiers });
}

function type(text: string): void {
  for (const character of text) key(character);
  key('Enter');
}

function move(point: Vec3L, offset?: { x?: number; y?: number }, shiftKey = false): void {
  tools.pointerMove(view.pointerAt(point, offset, shiftKey));
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
  editor.addBoards([BOX, OTHER], 'Add boxes');
});

describe('Pull', () => {
  const onTop: Vec3L = [inch(12), inch(6), inch(6)];
  const onRight: Vec3L = [inch(24), inch(6), inch(3)];

  beforeEach(() => void key('p'));

  it('outlines the face under the cursor', () => {
    move(onTop);
    expect(tools.preview().outline).toEqual([
      [0, 0, inch(6)],
      [inch(24), 0, inch(6)],
      [inch(24), inch(12), inch(6)],
      [0, inch(12), inch(6)],
    ]);
  });

  it('raises the top face with two clicks', () => {
    click(onTop);
    move([inch(12), inch(6), inch(10)]);
    expect(measurement()).toMatchObject({ label: 'Distance', value: '4"' });
    expect(tools.preview().overrides.get('box')?.size[2]).toBe(inch(10));
    click([inch(12), inch(6), inch(10)]);
    expect(board('box')).toMatchObject({ min: [0, 0, 0], size: [inch(24), inch(12), inch(10)] });
    expect(editor.getState().undoLabel).toBe('Pull board');
  });

  it('takes a typed distance, or a full size after an equals sign', () => {
    click(onRight);
    move([inch(26), inch(6), inch(3)]);
    type('3 1/2');
    expect(board('box').size[0]).toBe(inch(27, 1, 2));

    click([inch(27, 1, 2), inch(6), inch(3)]);
    type('=30');
    expect(board('box')).toMatchObject({ min: [0, 0, 0], size: [inch(30), inch(12), inch(6)] });
  });

  it('pushes in, the way the face is already heading', () => {
    click(onTop);
    move([inch(12), inch(6), inch(4)]);
    type('1');
    expect(board('box').size[2]).toBe(inch(5));
  });

  it('refuses to push a board through itself', () => {
    click(onTop);
    move([inch(12), inch(6), inch(4)]);
    type('9');
    expect(measurement().error).toBe(true);
    expect(board('box').size[2]).toBe(inch(6));
  });

  it('lines the face up with a corner of another board', () => {
    click(onRight);
    click([inch(40), 0, inch(6)]);
    expect(board('box').size[0]).toBe(inch(40));
  });

  it('corrects the pull just made without a second undo step', () => {
    click(onTop);
    click([inch(12), inch(6), inch(10)]);
    type('1');
    expect(board('box').size[2]).toBe(inch(7));
    type('=12');
    expect(board('box').size[2]).toBe(inch(12));
    key('z', { command: true });
    expect(board('box').size[2]).toBe(inch(6));
  });

  it('does nothing on a click with no movement, and backs out with Escape', () => {
    click(onTop);
    click(onTop);
    expect(editor.getState().undoLabel).toBe('Add boxes');
    click(onTop);
    expect(key('Escape')).toBe(true);
    expect(tools.preview().overrides.size).toBe(0);
  });
});

describe('Pull, with a board hidden behind the one being pulled', () => {
  /** Sits behind the box as the test camera sees it. */
  const HIDDEN: Board = { ...BOX, id: 'hidden', min: [inch(2), inch(14), 0], size: [inch(4), inch(1), inch(2)] };

  it('does not snap to what the pulled board hides', () => {
    editor.addBoards([HIDDEN], 'Add hidden board');
    key('p');
    click([inch(10), inch(7), inch(6)]);
    // The cursor passes over a corner of the hidden board, which the box covers.
    move([inch(6), inch(14), inch(2)]);
    expect(tools.preview().marker).toBeNull();
    expect(tools.preview().overrides.get('box')?.size[2]).not.toBe(inch(2));
  });
});

describe('Move', () => {
  const grab: Vec3L = [inch(24), 0, inch(6)];

  beforeEach(() => void key('m'));

  it('picks up the clicked board and slides it level', () => {
    click(grab);
    expect(selection()).toEqual(['box']);
    click([inch(34), inch(-10), inch(6)]);
    expect(board('box').min).toEqual([inch(10), inch(-10), 0]);
    expect(editor.getState().undoLabel).toBe('Move board');
  });

  it('follows an axis when the cursor heads along one', () => {
    click(grab);
    move([inch(24), inch(-10), inch(6)], { x: 4 });
    expect(tools.preview().marker).toMatchObject({ kind: 'axis', label: 'Along Y' });
    expect(tools.preview().lines[0]?.axis).toBe(1);
    click([inch(24), inch(-10), inch(6)], { x: 4 });
    expect(board('box').min).toEqual([0, inch(-10), 0]);
  });

  it('locks an axis with the arrow keys', () => {
    click(grab);
    key('ArrowUp');
    click([inch(30), inch(-4), inch(16)]);
    const moved = board('box').min;
    expect(moved[0]).toBe(0);
    expect(moved[1]).toBe(0);
    expect(moved[2]).toBeGreaterThan(0);
  });

  it('keeps the axis it is on while Shift is held', () => {
    click(grab);
    move([inch(24), inch(-10), inch(6)]);
    move([inch(30), inch(-14), inch(6)], {}, true);
    expect(tools.preview().lines[0]?.axis).toBe(1);
    move([inch(30), inch(-14), inch(6)]);
    expect(tools.preview().lines[0]?.axis).toBeNull();
  });

  it('snaps the grabbed point exactly onto a corner of another board', () => {
    click([inch(24), 0, 0]);
    click([inch(40), 0, inch(6)], { x: -3, y: 2 });
    // The bottom corner went to the top corner of the other box: this box now sits against it, raised.
    expect(board('box').min).toEqual([inch(16), 0, inch(6)]);
  });

  it('lines up with a corner while locked to an axis', () => {
    click([inch(24), 0, 0]);
    key('ArrowRight');
    move([inch(40), 0, inch(6)]);
    expect(tools.preview().marker?.label).toBe('In line with corner');
    click([inch(40), 0, inch(6)]);
    expect(board('box').min).toEqual([inch(16), 0, 0]);
  });

  it('moves a typed distance in the direction it is heading', () => {
    click(grab);
    move([inch(24), inch(-5), inch(6)]);
    type('12');
    expect(board('box').min).toEqual([0, inch(-12), 0]);
    // Typing again corrects the move.
    type('3 1/2');
    expect(board('box').min).toEqual([0, -inch(3, 1, 2), 0]);
    key('z', { command: true });
    expect(board('box').min).toEqual([0, 0, 0]);
  });

  it('takes a typed distance along a locked axis before the cursor has gone anywhere', () => {
    click(grab);
    key('ArrowUp');
    type('6');
    expect(board('box').min).toEqual([0, 0, inch(6)]);
  });

  it('moves everything selected together', () => {
    editor.setSelection(['box', 'other']);
    click(grab);
    move([inch(24), inch(-5), inch(6)]);
    type('10');
    expect(board('box').min).toEqual([0, inch(-10), 0]);
    expect(board('other').min).toEqual([inch(40), inch(-10), 0]);
    expect(editor.getState().undoLabel).toBe('Move 2 boards');
  });

  it('copies with Ctrl and selects the copy', () => {
    click(grab);
    key('Control', { command: true });
    move([inch(24), inch(-5), inch(6)]);
    expect(tools.preview().boxes).toHaveLength(1);
    expect(tools.preview().overrides.size).toBe(0);
    type('20');
    expect(boards()).toHaveLength(3);
    expect(board('box').min).toEqual([0, 0, 0]);
    const copy = boards()[2]!;
    expect(copy).toMatchObject({ name: 'Box', min: [0, inch(-20), 0], size: BOX.size });
    expect(selection()).toEqual([copy.id]);
    expect(editor.getState().undoLabel).toBe('Copy board');
  });

  it('repeats a copy, or spaces copies evenly, as one undo step', () => {
    click(grab);
    key('Control', { command: true });
    move([inch(24), inch(-5), inch(6)]);
    type('20');
    type('3x');
    expect(boards().slice(2).map((copy) => copy.min[1])).toEqual([inch(-20), inch(-40), inch(-60)]);
    type('/4');
    expect(boards().slice(2).map((copy) => copy.min[1])).toEqual([inch(-5), inch(-10), inch(-15), inch(-20)]);
    key('z', { command: true });
    expect(boards()).toHaveLength(2);
  });

  it('will not repeat a plain move', () => {
    click(grab);
    move([inch(24), inch(-5), inch(6)]);
    type('20');
    type('3x');
    expect(measurement().error).toBe(true);
    expect(boards()).toHaveLength(2);
  });

  it('puts the board back on Escape', () => {
    click(grab);
    move([inch(30), inch(-5), inch(6)]);
    expect(tools.preview().overrides.size).toBe(1);
    key('Escape');
    expect(tools.preview().overrides.size).toBe(0);
    expect(board('box').min).toEqual([0, 0, 0]);
  });
});

describe('Rotate', () => {
  beforeEach(() => void key('r'));

  it('turns a board a typed quarter turn about the clicked point', () => {
    click([inch(24), 0, 0]);
    type('90');
    // Turning counterclockwise about its front right corner stands the box out in front of that corner.
    expect(board('box')).toMatchObject({ min: [inch(12), inch(-24), 0], size: [inch(12), inch(24), inch(6)] });
    expect(board('box').thicknessAxis).toBe(2);
    expect(editor.getState().undoLabel).toBe('Turn board');
  });

  it('turns by grabbing a point and swinging it around', () => {
    click([inch(24), 0, 0]);
    click([0, 0, 0]);
    move([inch(24), inch(-20), 0]);
    expect(measurement()).toMatchObject({ label: 'Angle about Z', value: '90°' });
    expect(tools.preview().overrides.get('box')?.size).toEqual([inch(12), inch(24), inch(6)]);
    click([inch(24), inch(-20), 0]);
    expect(board('box').min).toEqual([inch(12), inch(-24), 0]);
  });

  it('turns about another axis with the arrow keys', () => {
    click([inch(24), 0, 0]);
    key('ArrowRight');
    type('90');
    // About X, the depth stands up and becomes the height.
    expect(board('box').size).toEqual([inch(24), inch(6), inch(12)]);
  });

  it('refuses angles that are not quarter turns', () => {
    click([inch(24), 0, 0]);
    type('45');
    expect(measurement().error).toBe(true);
    expect(board('box')).toEqual(BOX);
  });

  it('corrects the turn just made', () => {
    click([inch(24), 0, 0]);
    type('90');
    type('180');
    expect(board('box')).toMatchObject({ min: [inch(24), inch(-12), 0], size: BOX.size });
    key('z', { command: true });
    expect(board('box')).toEqual(BOX);
  });

  it('turns everything selected together', () => {
    editor.setSelection(['box', 'other']);
    click([0, 0, 0]);
    type('180');
    expect(board('box').min).toEqual([inch(-24), inch(-12), 0]);
    expect(board('other').min).toEqual([inch(-64), inch(-12), 0]);
  });
});

describe('Tape', () => {
  beforeEach(() => void key('t'));

  it('reads the distance between two points and changes nothing', () => {
    click([0, 0, inch(6)]);
    move([inch(24), 0, inch(6)]);
    expect(measurement()).toMatchObject({ label: 'Length', value: '24"' });
    click([inch(24), 0, inch(6)]);
    expect(measurement()).toMatchObject({ label: 'Length', value: '24"' });
    expect(guides()).toHaveLength(0);
    expect(editor.getState().undoLabel).toBe('Add boxes');
  });

  it('measures across open space between boards', () => {
    click([inch(24), 0, inch(6)]);
    click([inch(40), 0, inch(6)]);
    expect(measurement().value).toBe('16"');
  });

  it('pulls a guide off an edge with a click', () => {
    click([inch(5), 0, inch(6)], { y: 2 });
    move([inch(5), inch(4), inch(6)]);
    expect(measurement()).toMatchObject({ label: 'Offset', value: '4"' });
    expect(tools.preview().guide).toMatchObject({ axis: 0 });
    click([inch(5), inch(4), inch(6)]);
    expect(guides()).toHaveLength(1);
    expect(guides()[0]).toMatchObject({ axis: 0, through: [0, inch(4), inch(6)] });
    expect(editor.getState().undoLabel).toBe('Add guide');
  });

  it('places a guide at a typed offset, and corrects it when retyped', () => {
    click([inch(5), 0, inch(6)], { y: 2 });
    move([inch(5), inch(2), inch(6)]);
    type('3/4');
    expect(guides()[0]?.through).toEqual([0, inch(0, 3, 4), inch(6)]);
    type('1 1/2');
    expect(guides()).toHaveLength(1);
    expect(guides()[0]?.through).toEqual([0, inch(1, 1, 2), inch(6)]);
  });

  it('pulls a guide down the front face too', () => {
    click([inch(5), 0, inch(6)], { y: 2 });
    move([inch(5), 0, inch(2)]);
    type('2');
    expect(guides()[0]?.through).toEqual([0, 0, inch(4)]);
  });

  it('makes guides that can be snapped to, selected, and deleted', () => {
    click([inch(5), 0, inch(6)], { y: 2 });
    move([inch(5), inch(2), inch(6)]);
    type('4');
    const guide = guides()[0]!;

    key('b');
    move([inch(10), inch(4), inch(6)], { y: 3 });
    expect(tools.preview().marker).toMatchObject({ kind: 'guide', label: 'On guide' });

    key(' ');
    click([inch(-10), inch(4), inch(6)]);
    expect(selection()).toEqual([guide.id]);
    key('Delete');
    expect(guides()).toHaveLength(0);
    expect(editor.getState().undoLabel).toBe('Delete guide');
  });
});

describe('box select', () => {
  /** The screen rectangle around some boards, grown by a margin in pixels. */
  function around(items: Board[], margin: number) {
    const points = items.flatMap((item) => boxCorners(item)).map((corner) => view.screen(corner));
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return {
      left: Math.min(...xs) - margin,
      right: Math.max(...xs) + margin,
      top: Math.min(...ys) - margin,
      bottom: Math.max(...ys) + margin,
    };
  }

  function drag(from: [number, number], to: [number, number], shiftKey = false): void {
    const start = view.pointerAtScreen(...from, shiftKey);
    tools.pointerMove(start);
    tools.pointerDown(start);
    tools.pointerMove(view.pointerAtScreen(...to, shiftKey));
    tools.pointerUp(view.pointerAtScreen(...to, shiftKey));
  }

  it('selects boards entirely inside a box dragged to the right', () => {
    const { left, right, top, bottom } = around([BOX], 4);
    drag([left, top], [right, bottom]);
    expect(selection()).toEqual(['box']);
    expect(tools.preview().rect).toBeNull();
  });

  it('leaves out a board that is only partly inside a box dragged to the right', () => {
    const { left, right, top, bottom } = around([BOX], 4);
    drag([left, top], [right - 40, bottom]);
    expect(selection()).toEqual([]);
  });

  it('selects anything touched by a box dragged to the left', () => {
    const box = around([BOX], 4);
    drag([box.left + 30, box.top], [box.left, box.bottom]);
    expect(selection()).toEqual(['box']);
    const all = around([BOX, OTHER], -30);
    drag([all.right, all.top], [all.left, all.bottom]);
    expect(selection()).toEqual(['box', 'other']);
  });

  it('adds to the selection with Shift', () => {
    editor.setSelection(['other']);
    const { left, right, top, bottom } = around([BOX], 4);
    drag([left, top], [right, bottom], true);
    expect(selection().sort()).toEqual(['box', 'other']);
  });

  it('puts the selection back when Escape stops a box drag', () => {
    editor.setSelection(['other']);
    const { left, right, top, bottom } = around([BOX], 4);
    const start = view.pointerAtScreen(left, top);
    tools.pointerMove(start);
    tools.pointerDown(start);
    tools.pointerMove(view.pointerAtScreen(right, bottom));
    expect(selection()).toEqual(['box']);
    expect(tools.preview().rect).toMatchObject({ crossing: false });
    key('Escape');
    expect(selection()).toEqual(['other']);
  });
});
