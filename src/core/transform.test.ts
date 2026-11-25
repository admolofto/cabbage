import { describe, expect, it } from 'vitest';
import type { Board } from './board';
import { EMPTY_DOCUMENT, parseDocument } from './document';
import { parseLength } from './parse-length';
import { faceCorners, pullBoard, quarterTurnsBetween, rotateBoardQuarter, rotatePointQuarter } from './transform';
import { inchFraction, mm } from './units';

const inch = inchFraction;
const SHELF: Board = { id: 's', name: 'Shelf', min: [inch(2), inch(1), inch(10)], size: [inch(30), inch(11), inch(0, 3, 4)], thicknessAxis: 2, materialId: 'plywood' };

describe('pullBoard', () => {
  it('moves the high face and leaves the low face alone', () => {
    const pulled = pullBoard(SHELF, 0, 1, inch(6), mm(1));
    expect(pulled.min).toEqual(SHELF.min);
    expect(pulled.size).toEqual([inch(36), inch(11), inch(0, 3, 4)]);
  });

  it('moves the low face and leaves the high face alone', () => {
    const pulled = pullBoard(SHELF, 1, -1, inch(2), mm(1));
    expect(pulled.min).toEqual([inch(2), inch(-1), inch(10)]);
    expect(pulled.size[1]).toBe(inch(13));
  });

  it('never pushes a board thinner than the minimum', () => {
    const pushed = pullBoard(SHELF, 0, -1, inch(-100), mm(1));
    expect(pushed.size[0]).toBe(mm(1));
    expect(pushed.min[0] + pushed.size[0]).toBe(inch(32));
  });
});

describe('quarter turns', () => {
  it('turns a point counterclockwise about Z', () => {
    expect(rotatePointQuarter([inch(3), 0, inch(5)], [0, 0, 0], 2, 1)).toEqual([0, inch(3), inch(5)]);
    expect(rotatePointQuarter([inch(3), 0, 0], [inch(1), inch(1), 0], 2, 2)).toEqual([inch(-1), inch(2), 0]);
    expect(rotatePointQuarter([inch(3), 0, 0], [0, 0, 0], 2, -1)).toEqual([0, inch(-3), 0]);
  });

  it('stands a flat board up and turns its thickness with it', () => {
    const turned = rotateBoardQuarter(SHELF, SHELF.min, 0, 1);
    expect(turned.size).toEqual([inch(30), inch(0, 3, 4), inch(11)]);
    expect(turned.thicknessAxis).toBe(1);
    // The corner it turned about is still a corner of the board.
    expect(turned.min[0]).toBe(SHELF.min[0]);
    expect(turned.min[2]).toBe(SHELF.min[2]);
    expect(turned.min[1] + turned.size[1]).toBe(SHELF.min[1]);
  });

  it('comes back exactly after four turns', () => {
    let board = SHELF;
    for (let turn = 0; turn < 4; turn += 1) board = rotateBoardQuarter(board, [inch(7), inch(-3), inch(2)], 1, 1);
    expect(board).toEqual(SHELF);
  });

  it('reads the nearest quarter turn between two directions', () => {
    const pivot = [0, 0, 0] as const;
    expect(quarterTurnsBetween([inch(5), 0, 0], [inch(1), inch(9), 0], pivot, 2)).toBe(1);
    expect(quarterTurnsBetween([inch(5), 0, 0], [inch(4), inch(1), 0], pivot, 2)).toBe(0);
    expect(quarterTurnsBetween([inch(5), 0, 0], [inch(1), inch(-9), 0], pivot, 2)).toBe(3);
    expect(quarterTurnsBetween([inch(5), 0, 0], pivot, pivot, 2)).toBeNull();
  });
});

describe('faceCorners', () => {
  it('lists the four corners of a face in order around it', () => {
    expect(faceCorners(SHELF, 2, 1)).toEqual([
      [inch(2), inch(1), inch(10, 3, 4)],
      [inch(32), inch(1), inch(10, 3, 4)],
      [inch(32), inch(12), inch(10, 3, 4)],
      [inch(2), inch(12), inch(10, 3, 4)],
    ]);
  });
});

describe('sums in typed measurements', () => {
  it('adds, subtracts, and multiplies', () => {
    expect(parseLength('36 - 3/4 * 2', 'imperial')).toBe(inch(34, 1, 2));
    expect(parseLength('12 + 1/2', 'imperial')).toBe(inch(12, 1, 2));
    expect(parseLength('2 * 3/4', 'imperial')).toBe(inch(1, 1, 2));
    expect(parseLength('600 - 18 * 2', 'metric')).toBe(mm(564));
    expect(parseLength('30 - 18mm', 'imperial')).toBe(inch(30) - mm(18));
  });

  it('still reads a hyphen without spaces as a mixed number', () => {
    expect(parseLength('34-1/2', 'imperial')).toBe(inch(34, 1, 2));
    expect(parseLength('34 - 1/2', 'imperial')).toBe(inch(33, 1, 2));
  });

  it('refuses sums it cannot read', () => {
    for (const text of ['36 -', '36 - ', '3/4 * 1/2', '36 - abc', '* 2']) {
      expect(parseLength(text, 'imperial'), text).toBeNull();
    }
  });
});

describe('guides in saved models', () => {
  it('loads a model saved before guides existed', () => {
    expect(parseDocument({ version: 1, boards: [] })).toEqual(EMPTY_DOCUMENT);
  });

  it('loads guides and refuses damaged ones', () => {
    const guide = { id: 'g1', axis: 0, through: [0, inch(3), 0] };
    expect(parseDocument({ version: 1, boards: [], guides: [guide] })?.guides).toEqual([guide]);
    expect(parseDocument({ version: 1, boards: [], guides: [{ ...guide, axis: 5 }] })).toBeNull();
    expect(parseDocument({ version: 1, boards: [], guides: [guide, guide] })).toBeNull();
  });
});
