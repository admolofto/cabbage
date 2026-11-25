export type ScreenPoint = { x: number; y: number };

/**
 * Cuts a line on screen down to the part inside the view, with a small margin
 * so its cut ends are out of sight. Returns null when no part of it shows.
 *
 * A guide is a kilometer long in the model, which can put its ends millions
 * of pixels off screen. Browsers are very slow to draw a dashed line that
 * long, so only the part in view is ever handed over.
 */
export function clipToView(
  a: ScreenPoint,
  b: ScreenPoint,
  width: number,
  height: number,
  margin = 16,
): [ScreenPoint, ScreenPoint] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let enter = 0;
  let leave = 1;
  // Each side of the view trims the stretch of the line that is still inside.
  const sides: [number, number][] = [
    [-dx, a.x + margin],
    [dx, width + margin - a.x],
    [-dy, a.y + margin],
    [dy, height + margin - a.y],
  ];
  for (const [direction, room] of sides) {
    if (direction === 0) {
      if (room < 0) return null;
      continue;
    }
    const at = room / direction;
    if (direction < 0) enter = Math.max(enter, at);
    else leave = Math.min(leave, at);
    if (enter > leave) return null;
  }
  return [
    { x: a.x + dx * enter, y: a.y + dy * enter },
    { x: a.x + dx * leave, y: a.y + dy * leave },
  ];
}
