import { useEffect, useRef, type HTMLAttributes, type ReactNode } from "react";
import { animate, type AnimationPlaybackControls } from "framer-motion";
import {
  followSwipe,
  intentAxis,
  swipeAction,
  swipeCommit,
  trackVelocity,
  type Axis,
  type Sample,
} from "../core/gestures";
import { haptic } from "../core/haptics";
import { release } from "../core/motion";

/** Distance, in finger pixels, at which a release commits the swipe (mirrors swipeAction). */
const COMMIT = 80;
const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The child moved by a fling-mode surface, and where it is right now. */
type Moving = { element: HTMLElement; offset: number; controls?: AnimationPlaybackControls; timer?: number };

export function SwipeSurface({
  axis = "x",
  positive = false,
  onSwipe,
  reveal,
  fling,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  axis?: Axis;
  positive?: boolean;
  /** In fling mode, return false when the swipe will not change what is shown: it springs back instead. */
  onSwipe: (direction: number) => void | boolean;
  /** Layer uncovered behind the content while dragging (the content slides, the layer stays). */
  reveal?: ReactNode;
  /**
   * Selector of the child that follows the finger. A release past the distance, or a quick flick, throws it
   * out the way it was going (the caller brings the next item in from the other side); anything else springs
   * it back. Grabbing it while it settles continues from where it is.
   */
  fling?: string;
}) {
  const active = useRef<{
    id: number;
    x: number;
    y: number;
    lock: Axis | "pending";
    element: HTMLDivElement;
    armed: boolean;
    samples: Sample[];
    /** Fling mode: finger distance when the axis locked, and the child's offset at that moment. */
    from: number;
    base: number;
    target: HTMLElement | null;
  } | null>(null);
  const blocked = useRef(0);
  const surface = useRef<HTMLDivElement>(null);
  const moving = useRef<Moving>();
  useEffect(() => () => {
    moving.current?.controls?.stop();
    clearTimeout(moving.current?.timer);
  }, []);
  const place = (element: HTMLElement, offset: number) => {
    element.style.translate = offset ? (axis === "x" ? `${offset}px 0` : `0 ${offset}px`) : "";
  };
  /** Takes over the child from any running settle or throw, returning where it currently is. */
  const grab = (element: HTMLElement) => {
    const current = moving.current;
    if (!current || current.element !== element) return 0;
    current.controls?.stop();
    clearTimeout(current.timer);
    return current.offset;
  };
  const settleTo = (element: HTMLElement, from: number, velocity: number) => {
    const state: Moving = { element, offset: from };
    moving.current = state;
    if (reducedMotion() || !from) {
      state.offset = 0;
      place(element, 0);
      return;
    }
    state.controls = animate(from, 0, {
      type: "spring", stiffness: 520, damping: 36, restDelta: 0.5, velocity: velocity * 1000,
      onUpdate: (value) => { state.offset = value; place(element, value); },
    });
  };
  const throwOut = (element: HTMLElement, from: number, direction: number, velocity: number) => {
    const state: Moving = { element, offset: from };
    moving.current = state;
    if (reducedMotion()) {
      // The swap itself becomes a plain crossfade.
      state.offset = 0;
      place(element, 0);
      return;
    }
    const width = surface.current?.getBoundingClientRect().width || 320;
    const to = direction * width * 0.7;
    const speed = Math.max(Math.abs(velocity), 0.9);
    const duration = Math.min(0.24, Math.max(0.14, (Math.abs(to - from) / speed / 1000) * 1.8));
    state.controls = animate(from, to, {
      duration, ease: release,
      onUpdate: (value) => { state.offset = value; place(element, value); },
    });
    // The song did not change after all (the queue was still loading): bring the same one back.
    state.timer = window.setTimeout(() => {
      if (moving.current === state && element.isConnected && !element.hasAttribute("data-leaving"))
        settleTo(element, state.offset, 0);
    }, 480);
  };
  const setOffset = (offset: number, distance = 0) => {
    const element = surface.current;
    if (!element) return;
    const progress = Math.min(1, Math.abs(distance) / COMMIT);
    element.style.setProperty("--swipe", offset + "px");
    element.style.setProperty("--swipe-p", progress.toFixed(3));
    element.dataset.direction = distance < 0 ? "start" : "end";
    if (fling) {
      const target = active.current?.target;
      if (target) place(target, offset);
    } else {
      if (!reveal)
        element.style.transform = offset ? `translate${axis.toUpperCase()}(${offset}px)` : "";
      element.dataset.swiping = offset ? "true" : "false";
    }
    const armed = progress >= 1;
    if (active.current && armed !== active.current.armed) {
      active.current.armed = armed;
      // A light tick tells the finger the release will now act.
      if (armed) haptic();
    }
    element.dataset.armed = armed ? "true" : "false";
  };
  /** Fling mode: clears the drag feedback without touching the child, which settles on its own. */
  const clearFeedback = () => {
    const element = surface.current;
    if (!element) return;
    element.style.setProperty("--swipe-p", "0");
    element.dataset.armed = "false";
  };
  const end = () => {
    const start = active.current;
    active.current = null;
    if (!fling) {
      setOffset(0);
      return;
    }
    clearFeedback();
    if (start?.lock === axis && start.target) {
      const current = moving.current?.element === start.target ? moving.current.offset : 0;
      settleTo(start.target, current, 0);
    }
  };
  return (
    <div
      {...props}
      ref={surface}
      data-reveal={reveal ? "true" : undefined}
      style={{
        ...props.style,
        touchAction: axis === "x" ? "pan-y" : "none",
      }}
      onPointerDown={(event) => {
        if (
          !event.isPrimary ||
          event.button !== 0 ||
          event.clientX < 26 ||
          event.clientX > window.innerWidth - 26 ||
          (event.target as HTMLElement).closest(
            ".icon-button,input,select,.drag-handle",
          )
        )
          return;
        active.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          lock: "pending",
          element: event.currentTarget,
          armed: false,
          samples: [],
          from: 0,
          base: 0,
          target: fling ? event.currentTarget.querySelector<HTMLElement>(fling) : null,
        };
      }}
      onPointerMove={(event) => {
        const start = active.current;
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x,
          dy = event.clientY - start.y;
        if (start.lock === "pending") {
          start.lock = intentAxis(dx, dy);
          if (start.lock === axis && start.target) {
            // Caught mid-settle: continue from where it is, and from this finger position.
            start.base = grab(start.target);
            start.from = axis === "x" ? dx : dy;
            moving.current = { element: start.target, offset: start.base };
          }
        }
        if (start.lock !== axis) {
          if (start.lock !== "pending") active.current = null;
          return;
        }
        if (!event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
        blocked.current = performance.now() + 450;
        const distance = axis === "x" ? dx : dy;
        const allowed = positive ? Math.max(0, distance) : distance;
        if (fling) {
          const offset = start.base + followSwipe(allowed - (positive ? Math.max(0, start.from) : start.from), COMMIT);
          if (moving.current && moving.current.element === start.target) moving.current.offset = offset;
          start.samples.push({ t: event.timeStamp, v: allowed });
          if (start.samples.length > 8) start.samples.shift();
          setOffset(offset, allowed);
          return;
        }
        // Follows the finger closely up to the commit point, then resists like a rubber band.
        const eased = Math.sign(allowed) * (Math.abs(allowed) <= COMMIT
          ? Math.abs(allowed) * 0.62
          : COMMIT * 0.62 + (Math.abs(allowed) - COMMIT) * 0.18);
        setOffset(Math.max(-112, Math.min(112, eased)), allowed);
      }}
      onPointerUp={(event) => {
        const start = active.current;
        if (!start || start.id !== event.pointerId || start.lock !== axis) {
          end();
          return;
        }
        blocked.current = performance.now() + 450;
        const dx = event.clientX - start.x,
          dy = event.clientY - start.y;
        if (fling) {
          active.current = null;
          clearFeedback();
          const velocity = trackVelocity(start.samples, event.timeStamp);
          const direction = swipeCommit(
            axis === "x" ? dx : dy,
            axis === "x" ? dy : dx,
            velocity,
            positive ? "positive" : "both",
            COMMIT,
          );
          const target = start.target;
          const offset = target && moving.current?.element === target ? moving.current.offset : 0;
          const changes = direction ? onSwipe(direction) !== false : false;
          if (target) {
            if (changes) throwOut(target, offset, direction, velocity);
            else settleTo(target, offset, velocity);
          }
          return;
        }
        active.current = null;
        setOffset(0);
        const direction = swipeAction(dx, dy, axis, positive ? "positive" : "both");
        if (direction) {
          const element = surface.current;
          if (element) {
            element.dataset.committed = direction > 0 ? "end" : "start";
            setTimeout(() => { delete element.dataset.committed; }, 520);
          }
          onSwipe(direction);
        }
      }}
      onLostPointerCapture={(event) => {
        if (event.target !== event.currentTarget) return;
        if (active.current) end();
      }}
      onPointerCancel={() => {
        if (active.current?.lock === axis)
          blocked.current = performance.now() + 450;
        end();
      }}
      onClickCapture={(event) => {
        if (
          event.detail > 0 &&
          performance.now() < blocked.current &&
          !(event.target as HTMLElement).closest(
            ".icon-button,input,select,.drag-handle",
          )
        ) {
          blocked.current = 0;
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {reveal && <span className="swipe-reveal" aria-hidden="true">{reveal}</span>}
      {children}
    </div>
  );
}
