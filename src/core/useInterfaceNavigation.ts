import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { resolveView, type ViewId } from "./navigation";
import { navTransitionKind, startNavTransition } from "./viewTransition";
import type { QueueItem } from "./types";
type Sheet = {
  kind: "actions" | "picker" | "shared" | "create" | "sleep" | "share" | "jam";
  track?: QueueItem;
  parentTrack?: QueueItem;
};
export interface InterfaceRoute {
  view: ViewId;
  playlistId?: string;
  artist?: string;
  /** YouTube Music channel of the artist, when the profile was opened from a provider page. */
  artistId?: string;
  directory?: "artists" | "albums" | "insights";
  player?: boolean;
  panel?: "queue" | "lyrics";
  sheet?: Sheet;
}
function href(route: InterfaceRoute) {
  const params = new URLSearchParams();
  if (route.playlistId) params.set("playlist", route.playlistId);
  if(route.artist)params.set("artist",route.artist);
  if(route.artistId)params.set("artistId",route.artistId);
  if(route.directory)params.set("directory",route.directory);
  if (route.player) params.set("player", "1");
  return "#/" + route.view + (params.size ? "?" + params : "");
}
function fromUrl(): InterfaceRoute {
  const [path, query] = location.hash.split("?");
  const params = new URLSearchParams(query);
  return {
    view: resolveView(path).view,
    playlistId: params.get("playlist") || undefined,
    artist: params.get("artist") || undefined,
    artistId: /^UC[\w-]{10,120}$/.test(params.get("artistId") || "") ? params.get("artistId")! : undefined,
    directory: ["artists","albums","insights"].includes(params.get("directory")||"") ? params.get("directory") as "artists"|"albums"|"insights" : undefined,
    player: params.get("player") === "1" || undefined,
  };
}
export function useInterfaceNavigation() {
  const initial = useRef<InterfaceRoute>(
    (window.history.state?.murmur as InterfaceRoute) || fromUrl(),
  );
  const [route, setRoute] = useState(initial.current);
  const current = useRef(route);
  const index = useRef(0);
  const known = useRef(new Map<number, InterfaceRoute>([[0, initial.current]]));
  const waiting = useRef(false);
  const scrollFrame = useRef(0);
  const queued = useRef<InterfaceRoute>();
  const [invalid, setInvalid] = useState(resolveView(location.hash).invalid);
  /**
   * Shows the latest route. A page change runs inside a View Transition when available: the old page is
   * kept as a still while the new one renders and takes its scroll, so nothing jumps. `place` restores
   * the scroll; `inTransition` says the new page is already in the DOM.
   */
  const show = (before: InterfaceRoute, travel: -1 | 0 | 1, place: (inTransition: boolean) => void) => {
    const kind = navTransitionKind(before, current.current, travel);
    if (kind && startNavTransition(kind, () => {
      flushSync(() => setRoute(current.current));
      place(true);
    }))
      return;
    setRoute(current.current);
    place(false);
  };
  const commit = (next: InterfaceRoute, replace = false) => {
    if (waiting.current) {
      queued.current = next;
      return;
    }
    if (JSON.stringify(current.current) === JSON.stringify(next)) return;
    cancelAnimationFrame(scrollFrame.current);
    const before = current.current;
    const scrollY = window.scrollY;
    window.history.replaceState({ ...window.history.state, scrollY }, "");
    if (!replace) {
      for (const key of known.current.keys())
        if (key > index.current) known.current.delete(key);
      index.current++;
    }
    known.current.set(index.current, next);
    current.current = next;
    window.history[replace ? "replaceState" : "pushState"](
      { murmur: next, murmurIndex: index.current, scrollY: 0 },
      "",
      href(next),
    );
    const page = before.view !== next.view || before.playlistId !== next.playlistId || before.artist !== next.artist || before.artistId !== next.artistId || before.directory !== next.directory;
    show(before, replace ? 0 : 1, () => {
      if (page) window.scrollTo({ top: 0 });
    });
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;
  useEffect(() => {
    if (resolveView(location.hash).invalid) initial.current = { view: "home" };
    window.history.replaceState(
      { murmur: initial.current, murmurIndex: 0, scrollY: window.scrollY },
      "",
      href(initial.current),
    );
    const restore = () => {
      const invalidRoute = resolveView(location.hash).invalid;
      setInvalid(invalidRoute);
      const next: InterfaceRoute = invalidRoute
        ? { view: "home" }
        : window.history.state?.murmur || fromUrl();
      if (!window.history.state?.murmur) known.current.clear();
      const before = current.current;
      const from = index.current;
      index.current = window.history.state?.murmurIndex ?? 0;
      known.current.set(index.current, next);
      current.current = next;
      waiting.current = false;
      if (invalidRoute)
        window.history.replaceState(
          { murmur: next, murmurIndex: index.current },
          "",
          href(next),
        );
      cancelAnimationFrame(scrollFrame.current);
      const scroll = window.history.state?.scrollY || 0;
      show(before, index.current < from ? -1 : 1, (inTransition) => {
        // Inside a transition the page is already rendered: restore now, under the still of the old one.
        if (inTransition) window.scrollTo({ top: scroll });
        cancelAnimationFrame(scrollFrame.current);
        scrollFrame.current = requestAnimationFrame(() =>
          window.scrollTo({ top: scroll }),
        );
      });
      if (queued.current) {
        const target = queued.current;
        queued.current = undefined;
        commitRef.current(target);
      }
    };
    window.addEventListener("popstate", restore);
    window.addEventListener("hashchange", restore);
    return () => {
      cancelAnimationFrame(scrollFrame.current);
      window.removeEventListener("popstate", restore);
      window.removeEventListener("hashchange", restore);
    };
  }, []);
  const back = () => {
    if (waiting.current) return true;
    if (index.current <= 0) {
      const next = { ...current.current };
      if (next.sheet) delete next.sheet;
      else if (next.panel) delete next.panel;
      else if (next.player) delete next.player;
      else if (next.playlistId) delete next.playlistId;
      else if(next.artist){delete next.artist;delete next.artistId;}
      else if(next.directory)delete next.directory;
      else return false;
      commit(next, true);
      return true;
    }
    waiting.current = true;
    window.history.back();
    return true;
  };
  const close = (
    layer: "sheet" | "panel" | "player" | "playlistId",
    kind?: Sheet["kind"],
  ) => {
    if (
      waiting.current ||
      !current.current[layer] ||
      (kind && current.current.sheet?.kind !== kind)
    )
      return;
    let target = index.current - 1;
    while (target >= 0 && known.current.get(target)?.[layer]) target--;
    if (target >= 0 && known.current.has(target)) {
      waiting.current = true;
      window.history.go(target - index.current);
    } else {
      const next = { ...current.current };
      delete next[layer];
      if (layer === "player") {
        delete next.panel;
        delete next.sheet;
      }
      commit(next, true);
    }
  };
  return {
    route,
    invalid,
    back,
    canBack:
      index.current > 0 ||
      !!(route.sheet || route.panel || route.player || route.playlistId || route.artist || route.directory),
    canForward: known.current.has(index.current + 1),
    forward: () => {
      if (!waiting.current && known.current.has(index.current + 1)) {
        waiting.current = true;
        window.history.forward();
      }
    },
    push: commit,
    patch: (patch: Partial<InterfaceRoute>) =>
      commit({ ...current.current, ...patch }),
    close,
    sheet: (kind: Sheet["kind"], track?: QueueItem) =>
      commit({
        ...current.current,
        sheet: {
          kind,
          track,
          parentTrack:
            kind === "create" ? current.current.sheet?.track : undefined,
        },
      }),
  };
}
