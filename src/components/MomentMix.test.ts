import { describe, expect, it } from "vitest";
import { momentFor } from "./MomentMix";

describe("mix of the moment", () => {
  it.each([
    [7, 3, "morning"], [13, 3, "focus"], [13, 6, "weekend"], [20, 2, "evening"], [2, 4, "late"], [23, 1, "late"],
  ])("%s h, day %s → %s", (hour, day, key) => expect(momentFor(hour, day).key).toBe(key));
  it("always asks explicitly («pon …»), so the voice router plays it", () => {
    for (let h = 0; h < 24; h++) expect(momentFor(h, 2).request.startsWith("pon ")).toBe(true);
  });
});
