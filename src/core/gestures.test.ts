import { describe, expect, it } from "vitest";
import { dismissCommit, followSwipe, settleReorder, swipeCommit, trackVelocity } from "./gestures";

describe("trackVelocity", () => {
  it("measures px/ms over the last 100 ms", () => {
    const samples = [
      { t: 0, v: 0 },
      { t: 150, v: 10 },
      { t: 200, v: 40 },
      { t: 250, v: 90 },
    ];
    expect(trackVelocity(samples, 255)).toBeCloseTo(80 / 100);
  });
  it("is zero when the finger stopped before lifting", () => {
    expect(trackVelocity([{ t: 0, v: 0 }, { t: 16, v: 30 }], 200)).toBe(0);
    expect(trackVelocity([], 10)).toBe(0);
    expect(trackVelocity([{ t: 5, v: 12 }], 10)).toBe(0);
  });
});

describe("swipeCommit", () => {
  it("commits a quick flick before the distance", () => {
    expect(swipeCommit(-36, 4, -0.9)).toBe(-1);
    expect(swipeCommit(30, 2, 0.6)).toBe(1);
  });
  it("needs a little travel and real speed for a flick", () => {
    expect(swipeCommit(-12, 0, -2)).toBe(0);
    expect(swipeCommit(-50, 0, -0.2)).toBe(0);
  });
  it("still commits a slow drag past the distance", () => {
    expect(swipeCommit(-90, 6, 0)).toBe(-1);
  });
  it("cancels when thrown back the other way, even past the distance", () => {
    expect(swipeCommit(-120, 0, 0.5)).toBe(0);
  });
  it("rejects diagonal gestures and the disallowed direction", () => {
    expect(swipeCommit(40, 40, 1.2)).toBe(0);
    expect(swipeCommit(-100, 0, -1, "positive")).toBe(0);
    expect(swipeCommit(100, 0, 1, "positive")).toBe(1);
  });
});

describe("followSwipe", () => {
  it("follows closely up to the commit point and resists beyond it", () => {
    expect(followSwipe(40)).toBeCloseTo(36);
    expect(followSwipe(-80)).toBeCloseTo(-72);
    expect(followSwipe(180)).toBeCloseTo(72 + 45);
    expect(followSwipe(0)).toBe(0);
  });
});

describe("dismissCommit", () => {
  it("closes past about a fifth of the screen", () => {
    expect(dismissCommit(190, 0, 800)).toBe(true);
    expect(dismissCommit(150, 0, 600)).toBe(true);
    expect(dismissCommit(120, 0, 800)).toBe(false);
  });
  it("closes on a downward flick after a short pull", () => {
    expect(dismissCommit(40, 0.8, 800)).toBe(true);
    expect(dismissCommit(10, 2, 800)).toBe(false);
  });
  it("stays open when flicked back up, wherever it was", () => {
    expect(dismissCommit(300, -0.5, 800)).toBe(false);
    expect(dismissCommit(0, 1, 800)).toBe(false);
  });
});

describe("settleReorder", () => {
  it("keeps the dragged order for songs still upcoming", () => {
    expect(settleReorder(["b", "a", "c"], ["a", "b", "c"])).toEqual(["b", "a", "c"]);
  });
  it("drops the song that started playing mid-drag", () => {
    expect(settleReorder(["c", "a", "b", "d"], ["b", "c", "d"])).toEqual(["c", "b", "d"]);
  });
  it("places songs added meanwhile where they live", () => {
    expect(settleReorder(["b", "a"], ["a", "b", "x"])).toEqual(["b", "a", "x"]);
    expect(settleReorder(["b", "a"], ["n", "a", "b"])).toEqual(["n", "b", "a"]);
  });
});
