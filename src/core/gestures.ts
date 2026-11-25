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

/* ---------- MURMUR 2.16: opening, saving, removing and holding by touch ---------- */

/**
 * Swipe up on the mini player: the mirror of pulling the player down to close. It opens past about a
 * fifth of the screen, or on an upward flick after a short lift; thrown back down it stays closed.
 * `lift` is how far the player rose (px), `velocity` the upward release speed (px/ms, positive up).
 */
export function riseCommit(lift: number, velocity: number, height: number): boolean {
  return dismissCommit(lift, velocity, height);
}

/** The player lifted from the mini player materialises over its first few dozen pixels. */
export function riseOpacity(lift: number): number {
  return Math.min(1, Math.max(0.2, 0.2 + lift / 70));
}

/** Where and when a finger touched down or lifted (pointer event time in ms). */
export type Touch = { t: number; x: number; y: number };

/** A finger that lifted quickly near where it landed: a tap, not a swipe or a hold. */
export function isTap(down: Touch, up: Touch): boolean {
  return up.t - down.t <= 300 && Math.hypot(up.x - down.x, up.y - down.y) <= 10;
}

/** The second tap lands soon after the first one lifted, and near it. */
export function isDoubleTap(firstUp: Touch | undefined, secondDown: Touch): boolean {
  if (!firstUp) return false;
  const gap = secondDown.t - firstUp.t;
  return gap >= 0 && gap <= 300 && Math.hypot(secondDown.x - firstUp.x, secondDown.y - firstUp.y) <= 40;
}

/** A held row opens its menu after this long (ms). */
export const LONG_PRESS_MS = 450;

/** A hold is abandoned once the finger travels more than 8 px, or the list under it scrolls. */
export function holdBroken(dx: number, dy: number, scrolled = false): boolean {
  return scrolled || Math.hypot(dx, dy) > 8;
}

/** Finger travel at which a queue row swiped left is removed: about 40 % of the row (96–150 px). */
export function removeDistance(width: number): number {
  return Math.min(150, Math.max(96, width * 0.4));
}

/**
 * A queue row swiped left is removed past the distance, or on a quick flick left after 48 px (more travel
 * than a song change asks, since it removes something). Diagonal drags and a throw back right keep it.
 */
export function removeCommit(dx: number, dy: number, velocity: number, width: number): boolean {
  if (dx >= 0 || -dx < Math.abs(dy) * 1.6 || velocity >= FLICK_BACK) return false;
  if (-dx >= removeDistance(width)) return true;
  return velocity <= -FLICK_SPEED && -dx >= 48;
}

type QueueEntry = { id: string; queueId?: string };

/**
 * The queue without one upcoming song, plus what is needed to put it back. Null for the song playing,
 * one already played, or one no longer in the queue (it started playing mid-gesture).
 */
export function withoutUpcoming<T extends QueueEntry>(
  queue: readonly T[],
  index: number,
  queueId: string,
): { queue: T[]; item: T; after?: string } | null {
  const at = queue.findIndex((track) => track.queueId === queueId);
  if (at < 0 || at <= index) return null;
  return {
    queue: [...queue.slice(0, at), ...queue.slice(at + 1)],
    item: queue[at],
    after: queue[at - 1]?.queueId,
  };
}

/**
 * Undo a removal: the song goes back after the one that preceded it, or right after the song playing when
 * that one has played meanwhile. Null when it is already back or there is no queue to return to.
 */
export function restoreUpcoming<T extends QueueEntry>(
  queue: readonly T[],
  index: number,
  item: T,
  after?: string,
): T[] | null {
  if (!queue.length || queue.some((track) => track.queueId === item.queueId)) return null;
  const anchor = after ? queue.findIndex((track) => track.queueId === after) : -1;
  const at = anchor >= index ? anchor + 1 : index + 1;
  return [...queue.slice(0, at), item, ...queue.slice(at)];
}
