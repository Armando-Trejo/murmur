export type Axis = "x" | "y";
export function intentAxis(dx: number, dy: number): Axis | "pending" {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 12) return "pending";
  return Math.abs(dx) > Math.abs(dy) * 1.4 ? "x" : "y";
}
export function swipeAction(
  dx: number,
  dy: number,
  axis: Axis,
  allowed: "both" | "positive" = "both",
): number {
  const distance = axis === "x" ? dx : dy;
  const cross = axis === "x" ? dy : dx;
  if (
    Math.abs(distance) < 80 ||
    Math.abs(distance) < Math.abs(cross) * 1.6 ||
    (allowed === "positive" && distance < 0)
  )
    return 0;
  return Math.sign(distance);
}

/** Position of the finger (or of what it drags) along one axis, at a pointer event time in ms. */
export type Sample = { t: number; v: number };

/** Below this speed (px/ms) a release is a placement, not a throw. */
export const FLICK_SPEED = 0.45;
/** A throw back the other way at this speed (px/ms) cancels the gesture. */
export const FLICK_BACK = 0.3;

/**
 * Release speed in px/ms over the last ~100 ms. A finger that stopped before lifting has no speed,
 * so resting on the commit point and letting go is a placement, not a flick.
 */
export function trackVelocity(samples: readonly Sample[], now: number, window = 100): number {
  const last = samples[samples.length - 1];
  if (!last || now - last.t > 60) return 0;
  let first = last;
  for (let i = samples.length - 2; i >= 0 && last.t - samples[i].t <= window; i--) first = samples[i];
  const elapsed = last.t - first.t;
  return elapsed > 0 ? (last.v - first.v) / elapsed : 0;
}

/**
 * Horizontal swipe on a track: commits past the distance, or earlier on a quick flick the same way.
 * Throwing it back the other way cancels even past the distance. Returns the direction (−1, 1) or 0.
 */
export function swipeCommit(
  distance: number,
  cross: number,
  velocity: number,
  allowed: "both" | "positive" = "both",
  commitAt = 80,
): number {
  const direction = Math.sign(distance);
  if (!direction || (allowed === "positive" && direction < 0)) return 0;
  if (Math.abs(distance) < Math.abs(cross) * 1.6) return 0;
  const along = velocity * direction;
  if (along <= -FLICK_BACK) return 0;
  if (Math.abs(distance) >= commitAt) return direction;
  return along >= FLICK_SPEED && Math.abs(distance) >= 20 ? direction : 0;
}

/** Content under the finger: 1:1-ish up to the commit point, then a heavier rubber band. */
export function followSwipe(distance: number, commitAt = 80): number {
  const reach = Math.abs(distance);
  const eased = reach <= commitAt ? reach * 0.9 : commitAt * 0.9 + (reach - commitAt) * 0.45;
  return Math.sign(distance) * eased;
}

/**
 * Pull-down to close a full-screen layer: past about a fifth of the screen, or a downward flick.
 * An upward flick keeps it open wherever it was released.
 */
export function dismissCommit(offset: number, velocity: number, height: number): boolean {
  if (offset <= 0 || velocity <= -FLICK_BACK) return false;
  if (offset >= Math.min(180, height * 0.22)) return true;
  return velocity >= 0.5 && offset >= 24;
}

/**
 * Order to keep after a reorder gesture that outlived a queue change (a song ended mid-drag):
 * the dragged order for songs still upcoming, and songs that arrived meanwhile at their live place.
 */
export function settleReorder(dragged: readonly string[], live: readonly string[]): string[] {
  const upcoming = new Set(live);
  const kept = dragged.filter((id) => upcoming.has(id));
  const placed = new Set(kept);
  live.forEach((id, index) => {
    if (!placed.has(id)) kept.splice(Math.min(index, kept.length), 0, id);
  });
  return kept;
}
