// Express the distance between UI states with a shared pace.
export const settle = [0.16, 1, 0.3, 1] as const;
export const release = [0.23, 1, 0.32, 1] as const;
export const settleCss = "cubic-bezier(" + settle.join(",") + ")";
export const motionMs = {
  feedback: 130,
  route: 220,
  playerIn: 320,
  playerOut: 185,
  /** The player thrown down by the finger: it keeps travelling while it fades. */
  playerDismiss: 300,
  swapIn: 260,
  swapOut: 170,
  reduced: 100,
} as const;

/**
 * Which way a song change moves on screen: back (−1) only when the song that was playing now sits
 * after the current one (Anterior), forward (1) for everything else (Siguiente, a tap in the queue or a
 * list, the song ending). Following the listener's action, not raw queue positions.
 */
export function songStep(
  queue: readonly { id: string; queueId?: string }[],
  index: number,
  previousKey: string,
): number {
  const at = queue.findIndex((track) => (track.queueId || track.id) === previousKey);
  return at > index ? -1 : 1;
}
