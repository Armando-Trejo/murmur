import type { InterfaceRoute } from "./useInterfaceNavigation";

export type NavTransition = "forward" | "back" | "tab";

const depth = (route: InterfaceRoute) =>
  Number(!!route.playlistId) + Number(!!route.artist) + Number(!!route.directory);

/**
 * How a page change moves: another tab rises in place, a deeper page arrives from the right and going
 * back returns from the left. Opening or closing the player or a sheet returns null: those layers animate
 * themselves. `travel` is the history direction (−1 back, 1 forward, 0 replaced in place).
 */
export function navTransitionKind(
  before: InterfaceRoute,
  next: InterfaceRoute,
  travel: -1 | 0 | 1,
): NavTransition | null {
  if (before.player || next.player || before.sheet || next.sheet) return null;
  if (before.view !== next.view) return "tab";
  if (
    before.playlistId === next.playlistId &&
    before.artist === next.artist &&
    before.artistId === next.artistId &&
    before.directory === next.directory
  )
    return null;
  const step = depth(next) - depth(before) || travel;
  return step > 0 ? "forward" : step < 0 ? "back" : null;
}

let latest = 0;

/** True while a page change is animating, so the fallback slide stays out of its way. */
export function navTransitionRunning() {
  return !!document.documentElement.dataset.navTransition;
}

/**
 * Applies a page change inside a View Transition when the WebView has them and motion is welcome.
 * Returns false without calling `update` otherwise, so the caller applies the change itself.
 * The kind is exposed on <html data-nav-transition> for the stylesheet while it runs.
 */
export function startNavTransition(kind: NavTransition, update: () => void): boolean {
  if (
    !("startViewTransition" in document) ||
    typeof document.startViewTransition !== "function" ||
    document.visibilityState !== "visible" ||
    matchMedia("(prefers-reduced-motion: reduce)").matches
  )
    return false;
  const root = document.documentElement;
  const mine = ++latest;
  root.dataset.navTransition = kind;
  const done = () => {
    if (mine === latest) delete root.dataset.navTransition;
  };
  try {
    const transition = document.startViewTransition(update);
    transition.ready.catch(() => {});
    transition.updateCallbackDone.catch(() => {});
    transition.finished.then(done, done);
    return true;
  } catch {
    done();
    return false;
  }
}
