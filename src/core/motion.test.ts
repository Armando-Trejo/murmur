import { describe, expect, it } from "vitest";
import { songStep } from "./motion";

const queue = (...keys: string[]) => keys.map((key) => ({ id: "song-" + key, queueId: key }));

describe("songStep", () => {
  it("goes forward on Siguiente", () => {
    expect(songStep(queue("a", "b", "c"), 1, "a")).toBe(1);
  });
  it("goes back only on Anterior", () => {
    expect(songStep(queue("a", "b", "c"), 0, "b")).toBe(-1);
  });
  it("goes forward when a later song is tapped in the queue (the queue is trimmed to it)", () => {
    // playQueueEntry: the queue now starts at the tapped song and the previous one is gone.
    expect(songStep(queue("d", "e"), 0, "a")).toBe(1);
  });
  it("goes forward when a list starts over with new entries", () => {
    expect(songStep(queue("x", "y", "z"), 2, "b")).toBe(1);
  });
  it("matches songs without a queue entry by id", () => {
    expect(songStep([{ id: "one" }, { id: "two" }], 0, "two")).toBe(-1);
  });
});
