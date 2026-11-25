import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  MAX_DISTANCE,
  MAX_ELEVATION,
  MIN_DISTANCE,
  UP,
  fitDistance,
  interpolatePose,
  orbitPose,
  panPose,
  poseDistance,
  poseFromDirection,
  viewDirection,
  viewDirectionFor,
  worldPerPixel,
  zoomPose,
  type CameraPose,
  type ViewName,
} from './camera-math';

const front = (): CameraPose => ({ position: new Vector3(0, -1000, 0), target: new Vector3(0, 0, 0) });

function expectVector(actual: Vector3, expected: [number, number, number], digits = 6) {
  expect(actual.x).toBeCloseTo(expected[0], digits);
  expect(actual.y).toBeCloseTo(expected[1], digits);
  expect(actual.z).toBeCloseTo(expected[2], digits);
}

/** Where a world point lands on screen, in normalized device coordinates. */
function project(pose: CameraPose, point: Vector3): Vector3 {
  const camera = new PerspectiveCamera(32, 1.5, 1, 1_000_000);
  camera.up.copy(UP);
  camera.position.copy(pose.position);
  camera.lookAt(pose.target);
  camera.updateMatrixWorld();
  return point.clone().project(camera);
}

describe('orbit', () => {
  it('keeps the camera the same distance from the pivot', () => {
    const pivot = new Vector3(120, 300, 40);
    const before = front();
    const after = orbitPose(before, pivot, 0.7, -0.4);
    expect(after.position.distanceTo(pivot)).toBeCloseTo(before.position.distanceTo(pivot), 6);
    expect(after.target.distanceTo(pivot)).toBeCloseTo(before.target.distanceTo(pivot), 6);
    expect(poseDistance(after)).toBeCloseTo(poseDistance(before), 6);
  });

  it('keeps the pivot at the same place on screen', () => {
    const pivot = new Vector3(200, 150, 90);
    const before = front();
    const after = orbitPose(before, pivot, -0.5, 0.3);
    const a = project(before, pivot);
    const b = project(after, pivot);
    expect(b.x).toBeCloseTo(a.x, 5);
    expect(b.y).toBeCloseTo(a.y, 5);
  });

  it('turns counterclockwise from above for positive yaw', () => {
    const after = orbitPose(front(), new Vector3(), Math.PI / 2, 0);
    expectVector(after.position, [1000, 0, 0]);
  });

  it('raises the camera when the view pitches down', () => {
    const after = orbitPose(front(), new Vector3(), 0, -Math.PI / 4);
    expect(after.position.z).toBeGreaterThan(0);
    expect(viewDirection(after).z).toBeCloseTo(-Math.sin(Math.PI / 4), 6);
  });

  it('never flips over the top or under the bottom', () => {
    let pose = front();
    for (let i = 0; i < 50; i++) pose = orbitPose(pose, new Vector3(), 0, -0.2);
    expect(Math.asin(viewDirection(pose).z)).toBeCloseTo(-MAX_ELEVATION, 6);
    for (let i = 0; i < 100; i++) pose = orbitPose(pose, new Vector3(), 0, 0.2);
    expect(Math.asin(viewDirection(pose).z)).toBeCloseTo(MAX_ELEVATION, 6);
  });

  it('keeps the horizon level', () => {
    const pose = orbitPose(front(), new Vector3(50, 20, 10), 1.1, -0.6);
    const right = new Vector3().crossVectors(viewDirection(pose), UP);
    expect(right.z).toBeCloseTo(0, 9);
  });
});

describe('pan', () => {
  it('moves the camera and target together', () => {
    const after = panPose(front(), new Vector3(10, 0, -5));
    expectVector(after.position, [10, -1000, -5]);
    expectVector(after.target, [10, 0, -5]);
  });
});

describe('zoom', () => {
  it('keeps the point under the cursor fixed on screen', () => {
    const point = new Vector3(300, 0, 200);
    const before = front();
    const after = zoomPose(before, point, 0.5);
    const a = project(before, point);
    const b = project(after, point);
    expect(b.x).toBeCloseTo(a.x, 5);
    expect(b.y).toBeCloseTo(a.y, 5);
    expect(poseDistance(after)).toBeCloseTo(500, 6);
  });

  it('does not change the viewing direction', () => {
    const after = zoomPose(front(), new Vector3(300, 0, 200), 1.8);
    expectVector(viewDirection(after), [0, 1, 0]);
  });

  it('stops at the closest and farthest distances', () => {
    let pose = front();
    for (let i = 0; i < 100; i++) pose = zoomPose(pose, new Vector3(), 0.5);
    expect(poseDistance(pose)).toBeCloseTo(MIN_DISTANCE, 6);
    for (let i = 0; i < 100; i++) pose = zoomPose(pose, new Vector3(), 2);
    expect(poseDistance(pose)).toBeCloseTo(MAX_DISTANCE, 3);
  });
});

describe('standard views', () => {
  it('uses unit directions that never point straight along the vertical', () => {
    for (const view of ['front', 'right', 'top', 'home'] as ViewName[]) {
      const direction = viewDirectionFor(view);
      expect(direction.length()).toBeCloseTo(1, 9);
      expect(Math.abs(direction.z)).toBeLessThan(1);
    }
  });

  it('puts the front of the model at the bottom of the top view', () => {
    const pose = poseFromDirection(new Vector3(), viewDirectionFor('top'), 1000);
    const frontEdge = project(pose, new Vector3(0, -100, 0));
    const backEdge = project(pose, new Vector3(0, 100, 0));
    expect(frontEdge.y).toBeLessThan(backEdge.y);
  });

  it('shows width left to right in the front view', () => {
    const pose = poseFromDirection(new Vector3(), viewDirectionFor('front'), 1000);
    expect(project(pose, new Vector3(100, 0, 0)).x).toBeGreaterThan(0);
    expect(project(pose, new Vector3(0, 0, 100)).y).toBeGreaterThan(0);
  });
});

describe('framing', () => {
  it('backs up far enough to fit a sphere in a wide view', () => {
    const fov = MathUtils.degToRad(32);
    const distance = fitDistance(500, fov, 2);
    expect(distance).toBeCloseTo(500 / Math.sin(fov / 2), 6);
  });

  it('backs up further in a tall, narrow view', () => {
    const fov = MathUtils.degToRad(32);
    expect(fitDistance(500, fov, 0.5)).toBeGreaterThan(fitDistance(500, fov, 2));
  });

  it('reports the size of a pixel at the target', () => {
    const fov = MathUtils.degToRad(90);
    expect(worldPerPixel(500, fov, 1000)).toBeCloseTo(1, 9);
  });
});

describe('view transitions', () => {
  const from = front();
  const to: CameraPose = { position: new Vector3(600, 100, 400), target: new Vector3(100, 100, 0) };

  it('starts and ends on the given poses', () => {
    const start = interpolatePose(from, to, 0);
    const end = interpolatePose(from, to, 1);
    expectVector(start.position, [0, -1000, 0]);
    expectVector(end.position, [600, 100, 400]);
    expectVector(end.target, [100, 100, 0]);
  });

  it('swings around the target instead of cutting through it', () => {
    const side: CameraPose = { position: new Vector3(0, 1000, 0), target: new Vector3() };
    const halfway = interpolatePose(from, side, 0.5);
    expect(poseDistance(halfway)).toBeCloseTo(1000, 6);
  });

  it('takes the short way around', () => {
    const a: CameraPose = { position: new Vector3(-1000, -50, 0), target: new Vector3() };
    const b: CameraPose = { position: new Vector3(-1000, 50, 0), target: new Vector3() };
    const halfway = interpolatePose(a, b, 0.5);
    expect(halfway.position.x).toBeLessThan(-990);
  });
});
