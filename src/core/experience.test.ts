import { expect, it } from "vitest";
import { intentAxis, swipeAction } from "./gestures";
import { validAccent, accentInk, readableAccent } from "./appearance";
import { orderMusic, listeningStats } from "./musicOrder";
import { artworkFor, artworkOptions, isLetterboxed, sizedArtwork } from "./artwork";
import type { QueueItem } from "./types";
const item = (
  id: string,
  source: "spotify" | "youtube",
  score: number,
): QueueItem => ({
  id,
  source,
  title: id,
  artist: "Fixture",
  duration: 100,
  tags: [],
  ...(source === "spotify" ? { popularity: score } : { viewCount: score }),
});
it("locks scrolling vertically and rejects small or diagonal swipe actions", () => {
  expect(intentAxis(5, 6)).toBe("pending");
  expect(intentAxis(18, 44)).toBe("y");
  expect(intentAxis(44, 10)).toBe("x");
  expect(swipeAction(110, 80, "x")).toBe(0);
  expect(swipeAction(79, 0, "x")).toBe(0);
  expect(swipeAction(-110, 2, "x", "positive")).toBe(0);
  expect(swipeAction(110, 8, "x", "positive")).toBe(1);
});
it("makes dismiss a downward-only action independent of horizontal track swipes", () => {
  expect(swipeAction(3, 110, "y", "positive")).toBe(1);
  expect(swipeAction(3, -110, "y", "positive")).toBe(0);
  expect(swipeAction(-110, 3, "x")).toBe(-1);
});
it("uses valid user colors with readable foregrounds and rejects CSS injection", () => {
  expect(validAccent("red;display:none")).toBe("#B69AFF");
  expect(validAccent("#ffcc00")).toBe("#FFCC00");
  expect(accentInk("#000000")).toBe("#FFFFFF");
  expect(accentInk("#FFFFFF")).toBe("#000000");
});
it("orders popularity within each provider without comparing Spotify score to YouTube views", () => {
  const tracks = [
    item("quiet", "spotify", 5),
    item("small", "youtube", 100),
    item("hit", "spotify", 98),
    item("large", "youtube", 10000),
  ];
  const sorted = orderMusic(tracks, "popular");
  expect(sorted.findIndex((t) => t.id === "hit")).toBeLessThan(
    sorted.findIndex((t) => t.id === "quiet"),
  );
  expect(sorted.findIndex((t) => t.id === "large")).toBeLessThan(
    sorted.findIndex((t) => t.id === "small"),
  );
  expect(tracks[0].id).toBe("quiet");
});
it("uses qualifying listening rather than accidental taps for personal ordering", () => {
  const stats = listeningStats([
    { trackId: "tap", at: 1, seconds: 2, skipped: true },
    { trackId: "heard", at: 2, seconds: 70, skipped: false },
    { trackId: "heard", at: 3, seconds: 60, skipped: false },
  ]);
  expect(stats.tap).toBeUndefined();
  expect(stats.heard.plays).toBe(2);
  expect(
    orderMusic(
      [item("tap", "spotify", 99), item("heard", "spotify", 2)],
      "listening",
      stats,
    )[0].id,
  ).toBe("heard");
});
it("recovers real YouTube thumbnails when an older local record has no artwork", () => {
  expect(artworkFor({ videoId: "abcdefghijk" })).toBe(
    "https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg",
  );
  expect(
    artworkFor({
      artworkUrl: "https://image.example/cover.jpg",
      videoId: "abcdefghijk",
    }),
  ).toBe("https://image.example/cover.jpg");
  expect(artworkFor({ artworkUrl: "javascript:alert(1)" })).toBeUndefined();
});
it("asks the CDN for sharp covers and keeps fallbacks for broken ones", () => {
  const music = "https://lh3.googleusercontent.com/abc=w120-h120-l90-rj";
  expect(sizedArtwork(music, 1200)).toBe("https://lh3.googleusercontent.com/abc=w1200-h1200-l90-rj");
  expect(sizedArtwork("https://yt3.ggpht.com/xyz=s88-c-k-c0x00ffffff-no-rj", 544))
    .toBe("https://yt3.ggpht.com/xyz=w544-h544-l90-rj");
  expect(sizedArtwork("https://i.scdn.co/image/ab67616d00001e02aaaa", 1200))
    .toBe("https://i.scdn.co/image/ab67616d0000b273aaaa");
  const options = artworkOptions({ artworkUrl: music, videoId: "abcdefghijk" }, true);
  expect(options[0]).toContain("=w1200-h1200");
  expect(options).toContain(music);
  expect(options.at(-1)).toBe("https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg");
  expect(isLetterboxed("https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg")).toBe(true);
  expect(isLetterboxed("https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg")).toBe(false);
  expect(isLetterboxed("https://i.ytimg.com/vi/abcdefghijk/mqdefault.jpg")).toBe(false);
});

it("keeps an arbitrary dark accent readable on AMOLED surfaces", () => {
  expect(readableAccent("#000000")).not.toBe("#000000");
  expect(readableAccent("#FFFFFF")).toBe("#FFFFFF");
});
it("preserves mixed-source relevance when every popularity metric is missing", () => {
  const a = { ...item("A", "spotify", 1), popularity: undefined },
    b = { ...item("B", "spotify", 1), popularity: undefined },
    c = { ...item("C", "youtube", 1), viewCount: undefined };
  expect(orderMusic([a, b, c], "popular").map((t) => t.id)).toEqual([
    "A",
    "B",
    "C",
  ]);
});
it("only rearranges measured slots within their own provider", () => {
  const unknown = { ...item("unknown", "youtube", 1), viewCount: undefined };
  const otherUnknown = {
    ...item("other", "spotify", 1),
    popularity: undefined,
  };
  const input = [
    item("low", "spotify", 5),
    unknown,
    item("high", "spotify", 99),
    otherUnknown,
    item("yt-low", "youtube", 2),
    item("yt-high", "youtube", 2000),
  ];
  expect(orderMusic(input, "popular").map((t) => t.id)).toEqual([
    "high",
    "unknown",
    "low",
    "other",
    "yt-high",
    "yt-low",
  ]);
});
