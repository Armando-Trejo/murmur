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
    panelAnimation.current = panel.animate(
      [{ opacity: from }, { opacity: open ? 1 : 0 }],
      { duration, easing: settleCss, fill: "forwards" },
    );
    const mini = document.querySelector<HTMLElement>(".mini-info .cover");
    if (!reduced && cover && mini) {
      const end = cover.getBoundingClientRect();
      const start = mini.getBoundingClientRect();
      if (visible(start) && visible(end)) {
        const deltaX = center(start).x - center(end).x;
        const deltaY = center(start).y - center(end).y;
        const anchor = { transform: `translate(${deltaX}px, ${deltaY}px) scale(${start.width / end.width})` };
        const full = { transform: "none" };
        artAnimation.current = cover.animate(
          [inFlight ?? (open ? anchor : full), open ? full : anchor],
          { duration, easing: settleCss },
        );
      }
    }
    const timeout = !open ? setTimeout(() => setPresent(false), duration) : undefined;
    return () => clearTimeout(timeout);
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
