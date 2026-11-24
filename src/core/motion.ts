// Express the distance between UI states with a shared pace.
export const settle = [0.16, 1, 0.3, 1] as const;
export const release = [0.23, 1, 0.32, 1] as const;
export const settleCss = "cubic-bezier(" + settle.join(",") + ")";
export const motionMs = {
  feedback: 130,
  route: 220,
  playerIn: 320,
  playerOut: 185,
  swapIn: 260,
  swapOut: 170,
  reduced: 100,
} as const;
