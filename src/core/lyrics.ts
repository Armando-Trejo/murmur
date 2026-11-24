export interface TimedLine {
  time: number;
  text: string;
}

/** Index of the line sung at `position` seconds, or -1 before the first line. */
export function activeLyricIndex(lines: TimedLine[], position: number): number {
  if (!lines.length || !Number.isFinite(position) || position < lines[0].time) return -1;
  let low = 0;
  let high = lines.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (lines[middle].time <= position) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Scroll offset that keeps a line slightly above the centre of its container. */
export function lyricScrollTarget(lineTop: number, lineHeight: number, viewport: number, anchor = 0.38) {
  return Math.max(0, Math.round(lineTop + lineHeight / 2 - viewport * anchor));
}
