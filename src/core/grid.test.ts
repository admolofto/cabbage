import { describe, expect, it } from 'vitest';
import { chooseGridSteps, gridLadder } from './grid';
import { inches, mm } from './units';

describe('grid spacing', () => {
  it('uses whole inches when an inch is comfortably wide on screen', () => {
    // 1 inch is 20 pixels wide.
    const steps = chooseGridSteps('imperial', inches(1) / 20);
    expect(steps).toEqual({ minor: inches(1), major: inches(12) });
  });

  it('steps down to eighths when zoomed in close', () => {
    const steps = chooseGridSteps('imperial', inches(1) / 200);
    expect(steps).toEqual({ minor: inches(1) / 8, major: inches(1) });
  });

  it('steps up to feet when zoomed out', () => {
    const steps = chooseGridSteps('imperial', inches(1) / 2);
    expect(steps).toEqual({ minor: inches(12), major: inches(120) });
  });

  it('uses powers of ten in metric', () => {
    expect(chooseGridSteps('metric', mm(1))).toEqual({ minor: mm(10), major: mm(100) });
    expect(chooseGridSteps('metric', mm(0.05))).toEqual({ minor: mm(1), major: mm(10) });
  });

  it('keeps a valid pair at the extremes of zoom', () => {
    for (const system of ['imperial', 'metric'] as const) {
      const ladder = gridLadder(system);
      const far = chooseGridSteps(system, 1e15);
      expect(far.major).toBe(ladder[ladder.length - 1]);
      expect(far.minor).toBe(ladder[ladder.length - 2]);
      const near = chooseGridSteps(system, 1e-3);
      expect(near.minor).toBe(ladder[0]);
      expect(near.major).toBe(ladder[1]);
    }
  });

  it('never draws fine lines closer than the minimum, except at the coarsest step', () => {
    for (let nmPerPixel = 1_000; nmPerPixel < 1e8; nmPerPixel *= 1.7) {
      const { minor, major } = chooseGridSteps('imperial', nmPerPixel, 8);
      expect(major).toBeGreaterThan(minor);
      expect(minor / nmPerPixel).toBeGreaterThanOrEqual(8);
    }
  });
});
