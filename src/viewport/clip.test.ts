import { describe, expect, it } from 'vitest';
import { clipToView } from './clip';

describe('clipToView', () => {
  it('leaves a line inside the view alone', () => {
    expect(clipToView({ x: 10, y: 20 }, { x: 300, y: 200 }, 800, 600)).toEqual([
      { x: 10, y: 20 },
      { x: 300, y: 200 },
    ]);
  });

  it('cuts a very long line down to the view and its margin', () => {
    const clipped = clipToView({ x: -4_000_000, y: 300 }, { x: 9_000_000, y: 300 }, 800, 600, 16)!;
    expect(clipped[0].x).toBeCloseTo(-16);
    expect(clipped[1].x).toBeCloseTo(816);
    expect(clipped[0].y).toBe(300);
    expect(clipped[1].y).toBe(300);
  });

  it('keeps a slanted line on the same path', () => {
    const clipped = clipToView({ x: -1000, y: -1000 }, { x: 3000, y: 3000 }, 800, 600, 0)!;
    expect(clipped[0].x).toBeCloseTo(0);
    expect(clipped[0].y).toBeCloseTo(0);
    expect(clipped[1].x).toBeCloseTo(600);
    expect(clipped[1].y).toBeCloseTo(600);
  });

  it('drops a line that misses the view', () => {
    expect(clipToView({ x: -500, y: -40 }, { x: 5000, y: -40 }, 800, 600)).toBeNull();
    expect(clipToView({ x: 900, y: 0 }, { x: 2000, y: 600 }, 800, 600)).toBeNull();
  });

  it('keeps a line that only crosses a corner of the view', () => {
    const clipped = clipToView({ x: -100, y: 150 }, { x: 150, y: -100 }, 800, 600, 0)!;
    expect(clipped[0].x).toBeCloseTo(0);
    expect(clipped[0].y).toBeCloseTo(50);
    expect(clipped[1].x).toBeCloseTo(50);
    expect(clipped[1].y).toBeCloseTo(0);
    // Just outside the corner, it misses.
    expect(clipToView({ x: -100, y: 50 }, { x: 50, y: -100 }, 800, 600, 0)).toBeNull();
  });
});
