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
