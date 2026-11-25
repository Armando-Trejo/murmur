import { describe, expect, it } from "vitest";
import {
  holdBroken,
  isDoubleTap,
  isTap,
  removeCommit,
  removeDistance,
  restoreUpcoming,
  riseCommit,
  riseOpacity,
  withoutUpcoming,
} from "./gestures";

describe("riseCommit", () => {
  it("opens past about a fifth of the screen", () => {
    expect(riseCommit(190, 0, 844)).toBe(true);
    expect(riseCommit(120, 0, 844)).toBe(false);
  });
  it("opens on an upward flick after a short lift", () => {
    expect(riseCommit(40, 0.8, 844)).toBe(true);
    expect(riseCommit(12, 2, 844)).toBe(false);
  });
  it("stays closed when thrown back down, wherever it was", () => {
    expect(riseCommit(400, -0.5, 844)).toBe(false);
    expect(riseCommit(0, 1, 844)).toBe(false);
  });
});

describe("riseOpacity", () => {
  it("materialises over the first pixels of the lift", () => {
    expect(riseOpacity(0)).toBeCloseTo(0.2);
    expect(riseOpacity(-30)).toBeCloseTo(0.2);
    expect(riseOpacity(35)).toBeCloseTo(0.7);
    expect(riseOpacity(200)).toBe(1);
  });
});

describe("isTap / isDoubleTap", () => {
  const at = (t: number, x = 100, y = 100) => ({ t, x, y });
  it("a quick touch that lifts in place is a tap", () => {
    expect(isTap(at(0), at(120, 104, 97))).toBe(true);
  });
  it("travel or a long hold is not a tap", () => {
    expect(isTap(at(0), at(120, 120, 100))).toBe(false);
    expect(isTap(at(0), at(450))).toBe(false);
  });
  it("a second tap soon after and near the first is a double tap", () => {
    expect(isDoubleTap(at(100), at(260, 120, 110))).toBe(true);
  });
  it("too late, too far or without a first tap it is not", () => {
    expect(isDoubleTap(at(100), at(450))).toBe(false);
    expect(isDoubleTap(at(100), at(200, 180, 100))).toBe(false);
    expect(isDoubleTap(undefined, at(200))).toBe(false);
    expect(isDoubleTap(at(300), at(200))).toBe(false);
  });
});

describe("holdBroken", () => {
  it("tolerates up to 8 px of finger travel", () => {
    expect(holdBroken(0, 0)).toBe(false);
    expect(holdBroken(5, -6)).toBe(false);
    expect(holdBroken(8, 0)).toBe(false);
  });
  it("is broken by more travel or by the list scrolling", () => {
    expect(holdBroken(0, 9)).toBe(true);
    expect(holdBroken(6, 6)).toBe(true);
    expect(holdBroken(0, 0, true)).toBe(true);
  });
});

describe("removeCommit", () => {
  it("needs about 40 % of the row, within 96–150 px", () => {
    expect(removeDistance(350)).toBe(140);
    expect(removeDistance(180)).toBe(96);
    expect(removeDistance(900)).toBe(150);
  });
  it("removes a slow drag left past the distance", () => {
    expect(removeCommit(-150, 10, 0, 350)).toBe(true);
    expect(removeCommit(-120, 0, 0, 350)).toBe(false);
  });
  it("removes on a quick flick left after a little travel", () => {
    expect(removeCommit(-60, 4, -0.8, 350)).toBe(true);
    expect(removeCommit(-30, 0, -2, 350)).toBe(false);
    expect(removeCommit(-80, 0, -0.2, 350)).toBe(false);
  });
  it("keeps the row when thrown back, swiped right or dragged diagonally", () => {
    expect(removeCommit(-200, 0, 0.5, 350)).toBe(false);
    expect(removeCommit(200, 0, 1, 350)).toBe(false);
    expect(removeCommit(-150, 120, 0, 350)).toBe(false);
  });
});

describe("withoutUpcoming / restoreUpcoming", () => {
  const queue = (...keys: string[]) => keys.map((key) => ({ id: "song-" + key, queueId: key }));
  it("removes an upcoming song and remembers what preceded it", () => {
    const removal = withoutUpcoming(queue("a", "b", "c", "d"), 1, "c");
    expect(removal?.queue.map((t) => t.queueId)).toEqual(["a", "b", "d"]);
    expect(removal?.item.queueId).toBe("c");
    expect(removal?.after).toBe("b");
  });
  it("never removes the song playing or one already played", () => {
    expect(withoutUpcoming(queue("a", "b", "c"), 1, "b")).toBeNull();
    expect(withoutUpcoming(queue("a", "b", "c"), 1, "a")).toBeNull();
    expect(withoutUpcoming(queue("a", "b"), 0, "zz")).toBeNull();
  });
  it("puts it back where it was", () => {
    const q = queue("a", "b", "d");
    expect(restoreUpcoming(q, 1, { id: "song-c", queueId: "c" }, "b")?.map((t) => t.queueId))
      .toEqual(["a", "b", "c", "d"]);
  });
  it("goes right after the song playing when its neighbour has played meanwhile", () => {
    const q = queue("a", "b", "d", "e");
    expect(restoreUpcoming(q, 2, { id: "song-c", queueId: "c" }, "b")?.map((t) => t.queueId))
      .toEqual(["a", "b", "d", "c", "e"]);
    expect(restoreUpcoming(queue("x", "y"), 0, { id: "song-c", queueId: "c" }, "gone")?.map((t) => t.queueId))
      .toEqual(["x", "c", "y"]);
  });
  it("does nothing when it is already back or the queue is gone", () => {
    expect(restoreUpcoming(queue("a", "c"), 0, { id: "song-c", queueId: "c" }, "a")).toBeNull();
    expect(restoreUpcoming([], 0, { id: "song-c", queueId: "c" }, "a")).toBeNull();
  });
});
