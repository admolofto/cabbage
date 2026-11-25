import { describe, expect, it } from 'vitest';
import type { Board } from '../core/board';
import { inchFraction, mm } from '../core/units';
import { createTestView } from '../test-support/view';
import { findSnap, firstSurfaceHit } from './inference';

const inch = inchFraction;

/** A box 24" wide, 12" deep, and 6" tall with one corner on the origin. */
const BOX: Board = { id: 'box', name: 'Box', min: [0, 0, 0], size: [inch(24), inch(12), inch(6)], thicknessAxis: 2 };
const view = createTestView();

describe('findSnap', () => {
  it('snaps to a corner and returns its exact coordinates', () => {
    const corner = [inch(24), 0, inch(6)] as const;
    const snap = findSnap([BOX], view.pointerAt(corner, { x: 4, y: -3 }).view);
    expect(snap).toMatchObject({ kind: 'corner', point: corner, boardId: 'box', aligned: false });
  });

  it('prefers a corner to the edge it sits on', () => {
    const snap = findSnap([BOX], view.pointerAt([inch(24), 0, inch(6)], { x: -6 }).view);
    expect(snap?.kind).toBe('corner');
  });

  it('snaps to the middle of an edge', () => {
    const snap = findSnap([BOX], view.pointerAt([inch(12), 0, inch(6)], { x: 2, y: 2 }).view);
    expect(snap).toMatchObject({ kind: 'midpoint', point: [inch(12), 0, inch(6)] });
  });

  it('snaps along an edge, keeping the other two coordinates exact', () => {
    const snap = findSnap([BOX], view.pointerAt([inch(5), 0, inch(6)], { y: 3 }).view);
    expect(snap?.kind).toBe('edge');
    expect(snap?.point[1]).toBe(0);
    expect(snap?.point[2]).toBe(inch(6));
    expect(Math.abs(snap!.point[0] - inch(5))).toBeLessThan(inch(0, 1, 4));
  });

  it('ignores corners hidden behind a board', () => {
    // The back bottom left corner is behind the box from this camera.
    const hidden = [0, inch(12), 0] as const;
    const snap = findSnap([BOX], view.pointerAt(hidden).view);
    expect(snap?.kind).not.toBe('corner');
  });

  it('lands on a face, exactly on its surface', () => {
    const snap = findSnap([BOX], view.pointerAt([inch(10), inch(5), inch(6)]).view);
    expect(snap).toMatchObject({ kind: 'face', boardId: 'box', face: { axis: 2, sign: 1 } });
    expect(snap?.point[2]).toBe(inch(6));
  });

  it('falls back to the floor, then to the origin when near it', () => {
    const floor = findSnap([BOX], view.pointerAt([inch(40), inch(-10), 0]).view);
    expect(floor?.kind).toBe('floor');
    expect(floor?.point[2]).toBe(0);
    expect(Math.abs(floor!.point[0] - inch(40))).toBeLessThan(mm(0.01));

    const origin = findSnap([], view.pointerAt([0, 0, 0], { x: 5 }).view);
    expect(origin).toMatchObject({ kind: 'origin', point: [0, 0, 0] });
  });

  it('returns nothing when the cursor is above the horizon', () => {
    const level = createTestView({ position: [0, -3000, 500], target: [0, 0, 500] });
    expect(findSnap([], level.pointerAtScreen(500, 100).view)).toBeNull();
  });

  it('carries a corner onto a plane and says where it came from', () => {
    const corner = [inch(24), 0, inch(6)] as const;
    const snap = findSnap([BOX], view.pointerAt(corner).view, { kind: 'plane', axis: 2, value: 0 });
    expect(snap).toMatchObject({ kind: 'corner', point: [inch(24), 0, 0], aligned: true, source: corner });
  });

  it('does not call a point aligned when it is already on the plane', () => {
    const corner = [inch(24), 0, inch(6)] as const;
    const snap = findSnap([BOX], view.pointerAt(corner).view, { kind: 'plane', axis: 2, value: inch(6) });
    expect(snap).toMatchObject({ kind: 'corner', point: corner, aligned: false });
    expect(snap?.source).toBeUndefined();
  });

  it('meets a plane where the cursor points when nothing is nearby', () => {
    const target = [inch(40), inch(20), inch(6)] as const;
    const snap = findSnap([BOX], view.pointerAt(target).view, { kind: 'plane', axis: 2, value: inch(6) });
    expect(snap?.kind).toBe('free');
    expect(snap?.point[2]).toBe(inch(6));
    expect(Math.abs(snap!.point[0] - target[0])).toBeLessThan(mm(0.01));
    expect(Math.abs(snap!.point[1] - target[1])).toBeLessThan(mm(0.01));
  });

  it('slides along a line, and lines up with a corner under the cursor', () => {
    const through = [inch(40), 0, 0] as const;
    const free = findSnap([BOX], view.pointerAt([inch(40), 0, inch(9)]).view, { kind: 'line', axis: 2, through });
    expect(free?.kind).toBe('free');
    expect(free?.point[0]).toBe(inch(40));
    expect(free?.point[1]).toBe(0);
    expect(Math.abs(free!.point[2] - inch(9))).toBeLessThan(mm(0.01));

    const corner = [inch(24), 0, inch(6)] as const;
    const aligned = findSnap([BOX], view.pointerAt(corner).view, { kind: 'line', axis: 2, through });
    expect(aligned).toMatchObject({ kind: 'corner', point: [inch(40), 0, inch(6)], aligned: true, source: corner });
  });
});

describe('firstSurfaceHit', () => {
  it('finds the nearest board and the face the ray enters by', () => {
    const behind: Board = { ...BOX, id: 'behind', min: [0, inch(30), 0] };
    const hit = firstSurfaceHit([behind, BOX], view.pointerAt([inch(12), 0, inch(3)]).view.ray);
    expect(hit).toMatchObject({ axis: 1, sign: -1 });
    expect(hit?.board.id).toBe('box');
  });

  it('misses when the ray passes beside every board', () => {
    expect(firstSurfaceHit([BOX], view.pointerAt([inch(60), 0, 0]).view.ray)).toBeNull();
  });
});
