import { beforeEach, describe, expect, it } from 'vitest';
import { boxCorners } from '../core/board';
import { cabinetBoards, cabinetBox, type Cabinet } from '../core/cabinet';
import { Editor } from '../core/editor';
import { inchFraction } from '../core/units';
import type { Vec3L } from '../core/vec';
import { createTestView } from '../test-support/view';
import { ToolManager, type KeyInput } from './tool-manager';

const inch = inchFraction;
const TOP = inch(34, 1, 2);

let editor: Editor;
let tools: ToolManager;
let view: ReturnType<typeof createTestView>;
/** A base cabinet 24" wide, standing with its back on y = 24" and its front on y = 0. */
let first: Cabinet;

const cabinets = () => editor.getState().document.cabinets;
const cabinet = (id: string) => cabinets().find((candidate) => candidate.id === id)!;
const newest = () => cabinets()[cabinets().length - 1]!;
const measurement = () => editor.getState().measurement;
const selection = () => [...editor.getState().selection];

function key(name: string, modifiers: Partial<KeyInput> = {}): boolean {
  return tools.key({ key: name, command: false, shift: false, alt: false, ...modifiers });
}

function type(text: string): void {
  for (const character of text) key(character);
  key('Enter');
}

function move(point: Vec3L): void {
  tools.pointerMove(view.pointerAt(point));
}

function click(point: Vec3L): void {
  const pointer = view.pointerAt(point);
  tools.pointerMove(pointer);
  tools.pointerDown(pointer);
  tools.pointerUp(pointer);
}

beforeEach(() => {
  editor = new Editor();
  tools = new ToolManager(editor);
  // Far enough back to see a cabinet and the floor around it, from the front right and above.
  view = createTestView({ position: [3200, -4500, 3000], target: [400, 200, 400] });
  first = editor.placeCabinet([0, inch(24), 0])!;
});

describe('Cabinet', () => {
  const openFloor: Vec3L = [inch(60), inch(-12), 0];
  /** Corners of the back of the first cabinet, at the top, where they show from the front. */
  const backRight: Vec3L = [inch(24), inch(24), TOP];
  const backLeft: Vec3L = [0, inch(24), TOP];

  beforeEach(() => void key('c'));

  it('shows the boards of the cabinet a click would place', () => {
    move(openFloor);
    expect(tools.preview().boxes).toHaveLength(8);
    expect(measurement()).toMatchObject({ label: 'Width, height, depth', value: '24", 34 1/2", 24"' });
    tools.pointerLeave();
    expect(tools.preview().boxes).toHaveLength(0);
  });

  it('stands a cabinet on the floor where it is clicked, on round numbers, and stays ready for the next', () => {
    click(openFloor);
    expect(cabinets()).toHaveLength(2);
    expect(newest()).toMatchObject({ name: 'Base 2', kind: 'base', position: openFloor, turns: 0, width: inch(24) });
    expect(editor.getState().tool).toBe('cabinet');
    expect(editor.getState().undoLabel).toBe('Place cabinet');
    // Nothing is selected by placing, so the next click is never mistaken for an edit.
    expect(selection()).toEqual([]);
  });

  it('sets a cabinet beside one already there when its back corner is clicked', () => {
    click(backRight);
    expect(newest().position).toEqual([inch(24), inch(24), 0]);
    // The two stand side by side with their backs in line.
    expect(cabinetBox(newest())).toEqual({ min: [inch(24), 0, 0], size: [inch(24), inch(24), TOP] });
  });

  it('goes to the left of a corner it would otherwise land inside', () => {
    move(backLeft);
    expect(tools.preview().marker?.kind).toBe('corner');
    click(backLeft);
    expect(cabinetBox(newest())).toEqual({ min: [inch(-24), 0, 0], size: [inch(24), inch(24), TOP] });
  });

  it('takes a typed width for the cabinets that follow', () => {
    move(openFloor);
    type('30');
    expect(measurement().value).toBe('30", 34 1/2", 24"');
    expect(cabinets()).toHaveLength(1);
    click(openFloor);
    expect(newest()).toMatchObject({ width: inch(30), height: TOP, depth: inch(24) });
    click([inch(100), inch(-12), 0]);
    expect(newest().width).toBe(inch(30));
    expect(cabinets()).toHaveLength(3);
  });

  it('takes a width, height, and depth, and leaves a skipped one as it is', () => {
    type('18, 36, 21');
    click(openFloor);
    expect(newest()).toMatchObject({ width: inch(18), height: inch(36), depth: inch(21) });
    type(', , 12');
    expect(newest()).toMatchObject({ width: inch(18), height: inch(36), depth: inch(12) });
  });

  it('corrects the cabinet just placed without a second undo step', () => {
    click(openFloor);
    type('36');
    expect(cabinets()).toHaveLength(2);
    expect(newest()).toMatchObject({ width: inch(36), position: openFloor });
    key('z', { command: true });
    expect(cabinets()).toEqual([first]);
  });

  it('grows a cabinet set to the left of a corner further to the left', () => {
    click(backLeft);
    type('30');
    expect(cabinetBox(newest())).toEqual({ min: [inch(-30), 0, 0], size: [inch(30), inch(24), TOP] });
  });

  it('turns down a size that could not be built', () => {
    click(openFloor);
    type('1');
    expect(measurement().error).toBe(true);
    expect(newest().width).toBe(inch(24));
    type('20, 30, 12, 4');
    expect(measurement().error).toBe(true);
  });

  it('ignores a second click in the same spot', () => {
    click(openFloor);
    click(openFloor);
    expect(cabinets()).toHaveLength(2);
    click(backRight);
    click(backRight);
    expect(cabinets()).toHaveLength(3);
  });

  it('hangs wall cabinets at the usual height wherever the click lands', () => {
    editor.setCabinetKind('wall');
    click(backRight);
    expect(newest()).toMatchObject({ name: 'Wall 1', kind: 'wall', position: [inch(24), inch(24), inch(54)] });
    expect(newest()).toMatchObject({ width: inch(24), height: inch(30), depth: inch(12) });
    click(openFloor);
    expect(newest().position).toEqual([inch(60), inch(-12), inch(54)]);
  });

  it('keeps a typed size for each kind of cabinet on its own', () => {
    type('30');
    editor.setCabinetKind('tall');
    expect(measurement().value).toBe('24", 84", 24"');
    type('18');
    click(openFloor);
    expect(newest()).toMatchObject({ kind: 'tall', width: inch(18), height: inch(84) });
    editor.setCabinetKind('base');
    click([inch(100), inch(-12), 0]);
    expect(newest()).toMatchObject({ kind: 'base', width: inch(30) });
  });

  it('follows the stock picked for new cabinets', () => {
    editor.setStock({ thickness: inch(0, 1, 2) });
    click(openFloor);
    expect(newest().build.thickness).toBe(inch(0, 1, 2));
  });
});

describe('a cabinet under the editing tools', () => {
  /** A point in the middle of the right side, and corners of that side that show from the front. */
  const onRight: Vec3L = [inch(24), inch(12), inch(17)];
  const frontRightTop: Vec3L = [inch(24), 0, TOP];
  const frontRightFloor: Vec3L = [inch(24), 0, 0];

  it('is selected whole by a click on any of its boards', () => {
    move(onRight);
    expect(editor.getState().hovered).toBe(first.id);
    click(onRight);
    expect(selection()).toEqual([first.id]);
    // The top of the front stretcher belongs to the same cabinet.
    click([inch(12), inch(2), TOP]);
    expect(selection()).toEqual([first.id]);
  });

  it('is selected with everything else by Ctrl+A, and deleted whole', () => {
    key('a', { command: true });
    expect(selection()).toEqual([first.id]);
    key('Delete');
    expect(cabinets()).toEqual([]);
    expect(editor.getState().undoLabel).toBe('Delete cabinet');
  });

  it('is inside a selection box only when all of it is', () => {
    const points = cabinetBoards(first).flatMap((board) => boxCorners(board)).map((corner) => view.screen(corner));
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const [left, right, top, bottom] = [Math.min(...xs) - 4, Math.max(...xs) + 4, Math.min(...ys) - 4, Math.max(...ys) + 4];
    const drag = (from: [number, number], to: [number, number]) => {
      tools.pointerMove(view.pointerAtScreen(...from));
      tools.pointerDown(view.pointerAtScreen(...from));
      tools.pointerMove(view.pointerAtScreen(...to));
      tools.pointerUp(view.pointerAtScreen(...to));
    };
    drag([left, top], [right - 60, bottom]);
    expect(selection()).toEqual([]);
    drag([left, top], [right, bottom]);
    expect(selection()).toEqual([first.id]);
    editor.setSelection([]);
    // Dragged to the left, touching any of its boards is enough.
    drag([right, bottom], [right - 30, bottom - 30]);
    expect(selection()).toEqual([first.id]);
  });

  it('moves as one thing', () => {
    key('m');
    click(frontRightTop);
    expect(selection()).toEqual([first.id]);
    move([inch(34), inch(-10), TOP]);
    expect(tools.preview().overrides.size).toBe(8);
    click([inch(34), inch(-10), TOP]);
    expect(cabinet(first.id).position).toEqual([inch(10), inch(14), 0]);
    expect(editor.getState().undoLabel).toBe('Move cabinet');
  });

  it('copies with Ctrl, and the copy gets the next name', () => {
    key('m');
    click(frontRightTop);
    key('Control', { command: true });
    move([inch(30), 0, TOP]);
    type('24');
    expect(cabinets().map((item) => item.name)).toEqual(['Base 1', 'Base 2']);
    expect(newest().position).toEqual([inch(24), inch(24), 0]);
    expect(selection()).toEqual([newest().id]);
    expect(editor.getState().undoLabel).toBe('Copy cabinet');
    type('3x');
    expect(cabinets().map((item) => item.name)).toEqual(['Base 1', 'Base 2', 'Base 3', 'Base 4']);
    expect(cabinets().map((item) => item.position[0])).toEqual([0, inch(24), inch(48), inch(72)]);
  });

  it('turns about an upright line, a quarter turn at a time', () => {
    key('r');
    click(frontRightFloor);
    type('90');
    // Turned counterclockwise about its front right corner, it now faces right.
    expect(cabinet(first.id)).toMatchObject({ turns: 1, position: [0, inch(-24), 0] });
    expect(cabinetBox(cabinet(first.id))).toEqual({ min: [0, inch(-24), 0], size: [inch(24), inch(24), TOP] });
    expect(editor.getState().undoLabel).toBe('Turn cabinet');
  });

  it('stays upright when Rotate is asked for another axis', () => {
    key('r');
    click(onRight);
    key('ArrowRight');
    type('90');
    expect(cabinet(first.id).turns).toBe(1);
    expect(cabinetBox(cabinet(first.id)).size[2]).toBe(TOP);
  });

  it('gets wider when its side is pulled, with every board following', () => {
    key('p');
    click(onRight);
    move([inch(27), inch(12), inch(17)]);
    expect(tools.preview().overrides.size).toBeGreaterThan(0);
    type('6');
    expect(cabinet(first.id)).toMatchObject({ width: inch(30), position: first.position });
    expect(cabinetBoards(cabinet(first.id)).find((board) => board.name === 'Bottom')?.size[0]).toBe(inch(28, 1, 2));
    expect(editor.getState().undoLabel).toBe('Resize cabinet');
    // A full size after an equals sign, on the same face.
    type('=36');
    expect(cabinet(first.id).width).toBe(inch(36));
    key('z', { command: true });
    expect(cabinets()).toEqual([first]);
  });

  it('gets taller when its top is pulled', () => {
    key('p');
    click([inch(12), inch(2), TOP]);
    move([inch(12), inch(2), inch(36)]);
    type('1 1/2');
    expect(cabinet(first.id)).toMatchObject({ height: inch(36), position: first.position });
  });

  it('gets deeper toward the front when its front is pulled', () => {
    key('p');
    // The front edge of the right side.
    click([inch(23, 5, 8), 0, inch(17)]);
    move([inch(23, 5, 8), inch(-2), inch(17)]);
    type('3');
    expect(cabinet(first.id)).toMatchObject({ depth: inch(27), position: first.position });
  });

  it('will not push a cabinet smaller than it can be built', () => {
    key('p');
    click(onRight);
    move([inch(20), inch(12), inch(17)]);
    type('23');
    expect(measurement().error).toBe(true);
    expect(cabinet(first.id).width).toBe(inch(24));
  });

  it('leaves the faces inside a cabinet alone', () => {
    key('p');
    // The top of the bottom panel, seen through the open front.
    const inside: Vec3L = [inch(12), inch(6), inch(4, 3, 4)];
    move(inside);
    expect(tools.preview().outline).toBeNull();
    expect(editor.getState().hint).toContain('inside a cabinet');
    click(inside);
    click([inch(12), inch(6), inch(8)]);
    expect(cabinets()).toEqual([first]);
  });

  it('measures and snaps to the boards of a cabinet like any others', () => {
    key('t');
    click(frontRightFloor);
    move(frontRightTop);
    expect(measurement()).toMatchObject({ value: '34 1/2"' });
  });
});

describe('a cabinet unlocked into boards', () => {
  it('can then be changed one board at a time', () => {
    editor.unlockCabinets([first.id]);
    const { document } = editor.getState();
    expect(document.boards).toHaveLength(8);
    key('p');
    // The top of the bottom panel can now be pulled, since it is a plain board.
    const inside: Vec3L = [inch(12), inch(6), inch(4, 3, 4)];
    click(inside);
    move([inch(12), inch(6), inch(6)]);
    type('1/4');
    const bottom = editor.getState().document.boards.find((board) => board.name === 'Bottom')!;
    expect(bottom.size[2]).toBe(inch(1));
    expect(editor.getState().undoLabel).toBe('Pull board');
  });
});
