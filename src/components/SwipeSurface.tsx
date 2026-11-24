import { useRef, type HTMLAttributes, type ReactNode } from "react";
import { intentAxis, swipeAction, type Axis } from "../core/gestures";
import { haptic } from "../core/haptics";

/** Distance, in finger pixels, at which a release commits the swipe (mirrors swipeAction). */
const COMMIT = 80;

export function SwipeSurface({
  axis = "x",
  positive = false,
  onSwipe,
  reveal,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  axis?: Axis;
  positive?: boolean;
  onSwipe: (direction: number) => void;
  /** Layer uncovered behind the content while dragging (the content slides, the layer stays). */
  reveal?: ReactNode;
}) {
  const active = useRef<{
    id: number;
    x: number;
    y: number;
    lock: Axis | "pending";
    element: HTMLDivElement;
    armed: boolean;
  } | null>(null);
  const blocked = useRef(0);
  const surface = useRef<HTMLDivElement>(null);
  const setOffset = (offset: number, distance = 0) => {
    const element = surface.current;
    if (!element) return;
    const progress = Math.min(1, Math.abs(distance) / COMMIT);
    element.style.setProperty("--swipe", offset + "px");
    element.style.setProperty("--swipe-p", progress.toFixed(3));
    element.dataset.direction = distance < 0 ? "start" : "end";
    if (!reveal)
      element.style.transform = offset ? `translate${axis.toUpperCase()}(${offset}px)` : "";
    element.dataset.swiping = offset ? "true" : "false";
    const armed = progress >= 1;
    if (active.current && armed !== active.current.armed) {
      active.current.armed = armed;
      // A light tick tells the finger the release will now act.
      if (armed) haptic();
    }
    element.dataset.armed = armed ? "true" : "false";
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
        };
      }}
      onPointerMove={(event) => {
        const start = active.current;
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x,
          dy = event.clientY - start.y;
        if (start.lock === "pending") start.lock = intentAxis(dx, dy);
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
        // Follows the finger closely up to the commit point, then resists like a rubber band.
        const eased = Math.sign(allowed) * (Math.abs(allowed) <= COMMIT
          ? Math.abs(allowed) * 0.62
          : COMMIT * 0.62 + (Math.abs(allowed) - COMMIT) * 0.18);
        setOffset(Math.max(-112, Math.min(112, eased)), allowed);
      }}
      onPointerUp={(event) => {
        const start = active.current;
        active.current = null;
        setOffset(0);
        if (!start || start.id !== event.pointerId || start.lock !== axis)
          return;
        blocked.current = performance.now() + 450;
        const direction = swipeAction(
          event.clientX - start.x,
          event.clientY - start.y,
          axis,
          positive ? "positive" : "both",
        );
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
        active.current = null;
        setOffset(0);
      }}
      onPointerCancel={() => {
        if (active.current?.lock === axis)
          blocked.current = performance.now() + 450;
        active.current = null;
        setOffset(0);
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
