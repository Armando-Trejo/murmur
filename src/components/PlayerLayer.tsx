import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { motionMs, settleCss } from "../core/motion";

const center = (rect: DOMRect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
const visible = (rect: DOMRect) => rect.width > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight + 1;

/** Keep the player exit bounded independently from queue reorder animations. */
export function PlayerLayer({ open, children }: { open: boolean; children: ReactNode }) {
  const [present, setPresent] = useState(open);
  const reduced = useReducedMotion();
  const element = useRef<HTMLDivElement>(null);
  const panelAnimation = useRef<Animation>();
  const artAnimation = useRef<Animation>();
  useLayoutEffect(() => {
    if (open && !present) {
      setPresent(true);
      return;
    }
    const panel = element.current;
    if (!panel) return;
    panel.inert = !open;
    const from = panelAnimation.current ? Number(getComputedStyle(panel).opacity) : open ? 0 : 1;
    panelAnimation.current?.cancel();
    const cover = panel.querySelector<HTMLElement>(".ambient-cover");
    const inFlight = cover && artAnimation.current?.playState === "running"
      ? { transform: getComputedStyle(cover).transform }
      : undefined;
    artAnimation.current?.cancel();
    const duration = reduced ? motionMs.reduced : open ? motionMs.playerIn : motionMs.playerOut;
    // The backdrop turns opaque early so the travelling cover is seen the whole way, not faded.
    panelAnimation.current = panel.animate(
      open ? [{ opacity: from }, { opacity: 1, offset: 0.32 }, { opacity: 1 }] : [{ opacity: from }, { opacity: 1, offset: 0.55 }, { opacity: 0 }],
      { duration, easing: settleCss, fill: "forwards" },
    );
    const mini = document.querySelector<HTMLElement>(".mini-info .cover");
    let frame = 0;
    // Start the morph a frame later: by then the cover has its fitted size (useFitCover),
    // so the end of the flight matches where the cover really rests (no jump at the end).
    const morph = () => {
      if (cover) cover.style.opacity = "";
      if (reduced || !cover || !mini) return;
      const end = cover.getBoundingClientRect();
      const start = mini.getBoundingClientRect();
      if (!visible(start) || !visible(end)) return;
      const deltaX = center(start).x - center(end).x;
      const deltaY = center(start).y - center(end).y;
      const anchor = { transform: `translate(${deltaX}px, ${deltaY}px) scale(${start.width / end.width})`, borderRadius: "28px" };
      const full = { transform: "none", borderRadius: "0px" };
      mini.style.visibility = "hidden"; // one object travelling, not two
      artAnimation.current = cover.animate(
        [inFlight ?? (open ? anchor : full), open ? full : anchor],
        { duration: duration * 1.1, easing: "cubic-bezier(0.2, 0.9, 0.22, 1.04)" },
      );
      artAnimation.current.finished.catch(() => {}).finally(() => { mini.style.visibility = ""; });
    };
    if (open) {
      // Hidden for the two frames before the flight starts, so it never flashes at its final spot.
      if (cover && mini && !reduced) cover.style.opacity = "0";
      frame = requestAnimationFrame(() => requestAnimationFrame(morph));
    } else morph();
    const timeout = !open ? setTimeout(() => setPresent(false), duration) : undefined;
    return () => { clearTimeout(timeout); cancelAnimationFrame(frame); if (cover) cover.style.opacity = ""; };
  }, [open, present, reduced]);
  useLayoutEffect(() => () => {
    panelAnimation.current?.cancel();
    artAnimation.current?.cancel();
  }, []);
  return present ? (
    <motion.div
      ref={element}
      role="dialog"
      aria-modal={open ? true : undefined}
      aria-hidden={!open}
      aria-label="Reproductor"
      className="expanded-player"
      layoutScroll
      layoutRoot
      style={{ pointerEvents: open ? "auto" : "none" }}
    >
      {children}
    </motion.div>
  ) : null;
}
