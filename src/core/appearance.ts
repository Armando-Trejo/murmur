export const DEFAULT_ACCENT = "#B69AFF";
export function validAccent(value: unknown): string {
  return typeof value === "string" && /^#[\da-f]{6}$/i.test(value)
    ? value.toUpperCase()
    : DEFAULT_ACCENT;
}
function luminance(hex: string) {
  const channels = hex
    .match(/[\da-f]{2}/gi)!
    .map((n) => parseInt(n, 16) / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}
export function accentInk(hex: string) {
  return luminance(validAccent(hex)) > 0.179 ? "#000000" : "#FFFFFF";
}
export function readableAccent(value: string) {
  let hex = validAccent(value);
  for (let step = 0; step < 24 && luminance(hex) < 0.26; step++) {
    hex =
      "#" +
      hex
        .slice(1)
        .match(/../g)!
        .map((n) => {
          const channel = parseInt(n, 16);
          return Math.round(channel + (255 - channel) * 0.12)
            .toString(16)
            .padStart(2, "0");
        })
        .join("");
  }
  return hex.toUpperCase();
}
export function applyAppearance(color: string, glows: boolean) {
  const hex = validAccent(color);
  const root = document.documentElement;
  root.style.setProperty("--brand-accent", hex);
  root.style.setProperty("--brand-readable", readableAccent(hex));
  root.style.setProperty("--brand-ink", accentInk(hex));
  root.style.setProperty(
    "--brand-rgb",
    hex
      .slice(1)
      .match(/../g)!
      .map((n) => parseInt(n, 16))
      .join(","),
  );
  root.dataset.glows = String(glows);
}
