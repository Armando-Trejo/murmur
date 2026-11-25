import { describe, expect, it } from "vitest";
import { navTransitionKind } from "./viewTransition";

describe("navTransitionKind", () => {
  it("rises in place when the tab changes", () => {
    expect(navTransitionKind({ view: "home" }, { view: "search" }, 1)).toBe("tab");
    expect(navTransitionKind({ view: "library", playlistId: "p" }, { view: "home" }, -1)).toBe("tab");
  });
  it("arrives from the right on a deeper page and from the left going back", () => {
    expect(navTransitionKind({ view: "library" }, { view: "library", playlistId: "p" }, 1)).toBe("forward");
    expect(navTransitionKind({ view: "library", artist: "A" }, { view: "library" }, -1)).toBe("back");
    // Closing a page without history (replaced in place) still reads as going back.
    expect(navTransitionKind({ view: "library", directory: "albums" }, { view: "library" }, 0)).toBe("back");
  });
  it("follows the history direction between pages of the same depth", () => {
    const a = { view: "library" as const, artist: "A" };
    const b = { view: "library" as const, artist: "B" };
    expect(navTransitionKind(a, b, 1)).toBe("forward");
    expect(navTransitionKind(b, a, -1)).toBe("back");
    expect(navTransitionKind(a, b, 0)).toBeNull();
  });
  it("leaves the player, panels and sheets to their own animations", () => {
    expect(navTransitionKind({ view: "home" }, { view: "home", player: true }, 1)).toBeNull();
    expect(navTransitionKind({ view: "home", player: true }, { view: "library", artist: "A" }, 1)).toBeNull();
    expect(navTransitionKind({ view: "home" }, { view: "home", sheet: { kind: "sleep" } }, 1)).toBeNull();
    expect(navTransitionKind({ view: "home" }, { view: "home" }, 1)).toBeNull();
  });
});
