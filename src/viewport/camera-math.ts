import { MathUtils, Quaternion, Vector3 } from 'three';

/**
 * Pure camera math. Nothing here touches the DOM or a renderer, so the feel of
 * orbit, pan, and zoom can be tested directly.
 *
 * The world is Z up. The floor is the XY plane, X runs left to right across a
 * cabinet's face, and Y runs from the front of a cabinet back toward the wall.
 */
export interface CameraPose {
  position: Vector3;
  /** The point the camera looks at. Its distance from the camera sets the zoom level. */
  target: Vector3;
}

export const UP = new Vector3(0, 0, 1);

/** Orbiting stops just short of straight up or straight down, where "up" stops meaning anything. */
export const MAX_ELEVATION = MathUtils.degToRad(89.5);

export const MIN_DISTANCE = 20;
export const MAX_DISTANCE = 500_000;

export type ViewName = 'front' | 'right' | 'top' | 'home';

export function clonePose(pose: CameraPose): CameraPose {
  return { position: pose.position.clone(), target: pose.target.clone() };
}

export function poseDistance(pose: CameraPose): number {
  return pose.position.distanceTo(pose.target);
}

/** Unit vector from the camera toward what it looks at. */
export function viewDirection(pose: CameraPose): Vector3 {
  return pose.target.clone().sub(pose.position).normalize();
}

/**
 * Turns the camera around a pivot like a turntable: yaw spins about the
 * vertical axis and pitch tilts over the top, so the floor always stays level.
 * Positive yaw is counterclockwise seen from above. Positive pitch tilts the
 * view upward.
 */
export function orbitPose(pose: CameraPose, pivot: Vector3, yaw: number, pitch: number): CameraPose {
  const direction = viewDirection(pose);
  const elevation = Math.asin(MathUtils.clamp(direction.z, -1, 1));
  const nextElevation = MathUtils.clamp(elevation + pitch, -MAX_ELEVATION, MAX_ELEVATION);
  const appliedPitch = nextElevation - elevation;

  const right = new Vector3().crossVectors(direction, UP);
  if (right.lengthSq() < 1e-12) {
    right.set(1, 0, 0);
  } else {
    right.normalize();
  }

  const rotation = new Quaternion()
    .setFromAxisAngle(UP, yaw)
    .multiply(new Quaternion().setFromAxisAngle(right, appliedPitch));

  return {
    position: pose.position.clone().sub(pivot).applyQuaternion(rotation).add(pivot),
    target: pose.target.clone().sub(pivot).applyQuaternion(rotation).add(pivot),
  };
}

export function panPose(pose: CameraPose, delta: Vector3): CameraPose {
  return { position: pose.position.clone().add(delta), target: pose.target.clone().add(delta) };
}

/**
 * Zooms toward or away from a point so that the point stays put on screen.
 * A factor below 1 moves closer.
 */
export function zoomPose(pose: CameraPose, point: Vector3, factor: number): CameraPose {
  const distance = poseDistance(pose);
  const clamped = MathUtils.clamp(factor, MIN_DISTANCE / distance, MAX_DISTANCE / distance);
  return {
    position: point.clone().add(pose.position.clone().sub(point).multiplyScalar(clamped)),
    target: point.clone().add(pose.target.clone().sub(point).multiplyScalar(clamped)),
  };
}

/** The direction each standard view looks along. */
export function viewDirectionFor(view: ViewName): Vector3 {
  switch (view) {
    case 'front':
      return new Vector3(0, 1, 0);
    case 'right':
      return new Vector3(-1, 0, 0);
    case 'top':
      // Almost straight down, leaning a hair toward the back so the front edge sits at the bottom of the screen.
      return new Vector3(0, Math.cos(MAX_ELEVATION), -Math.sin(MAX_ELEVATION));
    case 'home':
      return new Vector3(-0.62, 1, -0.5).normalize();
  }
}

export function poseFromDirection(target: Vector3, direction: Vector3, distance: number): CameraPose {
  return {
    position: target.clone().sub(direction.clone().normalize().multiplyScalar(distance)),
    target: target.clone(),
  };
}

/** How far back the camera must sit for a sphere of the given radius to fit in view. */
export function fitDistance(radius: number, verticalFov: number, aspect: number): number {
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
  const narrowest = Math.min(verticalFov, horizontalFov);
  return radius / Math.sin(narrowest / 2);
}

interface Spherical {
  distance: number;
  yaw: number;
  elevation: number;
}

function toSpherical(offset: Vector3): Spherical {
  const distance = offset.length();
  return {
    distance,
    yaw: Math.atan2(offset.y, offset.x),
    elevation: Math.asin(MathUtils.clamp(offset.z / distance, -1, 1)),
  };
}

/**
 * Blends between two poses by swinging the camera around the target instead of
 * cutting straight through the model. `t` runs from 0 to 1.
 */
export function interpolatePose(from: CameraPose, to: CameraPose, t: number): CameraPose {
  const a = toSpherical(from.position.clone().sub(from.target));
  const b = toSpherical(to.position.clone().sub(to.target));

  let yawDelta = b.yaw - a.yaw;
  if (yawDelta > Math.PI) yawDelta -= 2 * Math.PI;
  if (yawDelta < -Math.PI) yawDelta += 2 * Math.PI;

  const distance = a.distance * Math.pow(b.distance / a.distance, t);
  const yaw = a.yaw + yawDelta * t;
  const elevation = a.elevation + (b.elevation - a.elevation) * t;
  const target = from.target.clone().lerp(to.target, t);

  const horizontal = Math.cos(elevation) * distance;
  const offset = new Vector3(
    Math.cos(yaw) * horizontal,
    Math.sin(yaw) * horizontal,
    Math.sin(elevation) * distance,
  );
  return { position: target.clone().add(offset), target };
}

/** World size of one screen pixel at the target's depth, for a viewport of the given height. */
export function worldPerPixel(distance: number, verticalFov: number, viewportHeight: number): number {
  return (2 * distance * Math.tan(verticalFov / 2)) / viewportHeight;
}
