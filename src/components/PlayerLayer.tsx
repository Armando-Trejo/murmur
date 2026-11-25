import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type AnimationPlaybackControls,
} from "framer-motion";
import { motionMs, settleCss } from "../core/motion";
import { dismissCommit, intentAxis, trackVelocity, type Axis, type Sample } from "../core/gestures";
import { haptic } from "../core/haptics";

const center = (rect: DOMRect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
const visible = (rect: DOMRect) => rect.width > 0 && rect.top >= 0 && rect.bottom <= window.innerHeight + 1;
/** Controls that own vertical drags (or scroll on their own): a pull never starts on them. */
const OWN_DRAG = "input,select,textarea,.seek-wrap,.drag-handle,.lyrics-scroller";
/** The cover of the song on screen in the mini player (a swap briefly shows the outgoing one too). */
const miniCover = () =>
  document.querySelector<HTMLElement>(".mini-info .mini-track:not([data-leaving]) .cover") ??
  document.querySelector<HTMLElement>(".mini-info .cover");

/**
 * Keep the player exit bounded independently from queue reorder animations.
 * Pulling down from the header, or from anywhere while the player is scrolled to the top, carries the
 * whole panel with the finger; a long enough pull or a downward flick closes it, anything else springs back.
 */
export function PlayerLayer({ open, onDismiss, children }: {
  open: boolean;
  onDismiss?: () => void;
  children: ReactNode;
}) {
  const [present, setPresent] = useState(open);
  const reduced = useReducedMotion();
  const element = useRef<HTMLDivElement>(null);
  const panelAnimation = useRef<Animation>();
  const artAnimation = useRef<Animation>();
  const y = useMotionValue(0);
  // The card recedes a little as it is pulled, anchored at its top edge (under the finger).
  const scale = useTransform(y, (offset) => (reduced ? 1 : 1 - Math.min(Math.max(offset, 0), 640) / 640 * 0.06));
  const travel = useRef<AnimationPlaybackControls>();
  const pull = useRef<{
    id: number; x: number; y: number; lock: Axis | "pending"; from: number; base: number; samples: Sample[];
  } | null>(null);
  /** Release speed (px/ms) when the finger closed the player, read by the exit. */
  const thrown = useRef<number | null>(null);
  const latestOpen = useRef(open);
  latestOpen.current = open;
  const stuck = useRef<number>();
  const clickBlock = useRef(0);
  const settleBack = (velocity = 0) => {
    const panel = element.current;
    travel.current?.stop();
    if (reduced || !panel) {
      y.jump(0);
      if (panel) delete panel.dataset.pulling;
      return;
    }
    travel.current = animate(y, 0, {
      type: "spring", stiffness: 480, damping: 40, velocity: velocity * 1000, restDelta: 0.5,
      onComplete: () => { delete panel.dataset.pulling; },
    });
  };
  useLayoutEffect(() => {
    if (open && !present) {
      setPresent(true);
      return;
    }
    const panel = element.current;
    if (!panel) return;
    panel.inert = !open;
    const flung = open ? null : thrown.current;
    thrown.current = null;
    clearTimeout(stuck.current);
    if (open) {
      travel.current?.stop();
      y.jump(0);
      delete panel.dataset.pulling;
      panel.dataset.atTop = String(panel.scrollTop <= 0);
    }
    const from = panelAnimation.current ? Number(getComputedStyle(panel).opacity) : open ? 0 : 1;
    panelAnimation.current?.cancel();
    if (flung !== null) {
      // Thrown down: the panel keeps the finger's momentum and fades on its way out; no cover flight.
      const duration = reduced ? motionMs.reduced : motionMs.playerDismiss;
      panelAnimation.current = panel.animate(
        reduced ? [{ opacity: from }, { opacity: 0 }] : [{ opacity: from }, { opacity: from, offset: 0.4 }, { opacity: 0 }],
        { duration, easing: "linear", fill: "forwards" },
      );
      if (!reduced)
        travel.current = animate(y, window.innerHeight, {
          type: "spring", stiffness: 320, damping: 36, restDelta: 1, velocity: Math.max(flung, 0.6) * 1000,
        });
      const timeout = setTimeout(() => {
        travel.current?.stop();
        setPresent(false);
        y.jump(0);
      }, duration);
      return () => clearTimeout(timeout);
    }
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
    const mini = miniCover();
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
    travel.current?.stop();
    clearTimeout(stuck.current);
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
      style={{ pointerEvents: open ? "auto" : "none", y, scale, originY: 0 }}
      onScroll={(event) => {
        // At the top a downward drag belongs to the pull (touch-action: pan-down), elsewhere to the scroll.
        event.currentTarget.dataset.atTop = String(event.currentTarget.scrollTop <= 0);
      }}
      onPointerDown={(event) => {
        const panel = element.current;
        if (!open || !onDismiss || !panel || !event.isPrimary || event.button !== 0) return;
        const target = event.target as HTMLElement;
        if (target.closest(OWN_DRAG)) return;
        if (!target.closest(".player-top") && panel.scrollTop > 0) return;
        pull.current = { id: event.pointerId, x: event.clientX, y: event.clientY, lock: "pending", from: 0, base: 0, samples: [] };
      }}
      onPointerMove={(event) => {
        const start = pull.current;
        const panel = element.current;
        if (!start || start.id !== event.pointerId || !panel) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (start.lock === "pending") {
          start.lock = intentAxis(dx, dy);
          if (start.lock === "pending") return;
          const caught = y.get();
          // Sideways belongs to the cover swipe, upward to the scroll (unless the panel is still settling).
          if (start.lock !== "y" || (dy < 0 && caught <= 0)) {
            pull.current = null;
            return;
          }
          travel.current?.stop();
          // Follow from here on, so the panel does not jump by the distance needed to read the intent.
          start.base = caught;
          start.from = dy;
          panel.setPointerCapture(event.pointerId);
          panel.dataset.pulling = "true";
        }
        if (start.lock !== "y") return;
        event.preventDefault();
        const offset = Math.max(0, start.base + (dy - start.from) * 0.86);
        y.set(offset);
        start.samples.push({ t: event.timeStamp, v: offset });
        if (start.samples.length > 8) start.samples.shift();
      }}
      onPointerUp={(event) => {
        const start = pull.current;
        pull.current = null;
        if (!start || start.id !== event.pointerId || start.lock !== "y") return;
        clickBlock.current = performance.now() + 400;
        const velocity = trackVelocity(start.samples, event.timeStamp);
        if (!dismissCommit(y.get(), velocity, window.innerHeight)) {
          settleBack(velocity);
          return;
        }
        thrown.current = Math.max(0, velocity);
        haptic();
        onDismiss?.();
        // If navigation is busy and the player stays open, never leave it hanging half-way down.
        clearTimeout(stuck.current);
        stuck.current = window.setTimeout(() => {
          if (!latestOpen.current) return;
          thrown.current = null;
          settleBack();
        }, 450);
      }}
      onPointerCancel={() => {
        if (pull.current?.lock === "y") settleBack();
        pull.current = null;
      }}
      onLostPointerCapture={(event) => {
        if (event.target !== event.currentTarget) return;
        if (pull.current?.lock === "y") settleBack();
        pull.current = null;
      }}
      onClickCapture={(event) => {
        // The release of a pull is not a tap on whatever button sat under the finger.
        if (performance.now() < clickBlock.current) {
          clickBlock.current = 0;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {children}
    </motion.div>
  ) : null;
}
