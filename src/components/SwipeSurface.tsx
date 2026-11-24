import { useRef, type HTMLAttributes } from "react";
import { intentAxis, swipeAction, type Axis } from "../core/gestures";
export function SwipeSurface({
  axis = "x",
  positive = false,
  onSwipe,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  axis?: Axis;
  positive?: boolean;
  onSwipe: (direction: number) => void;
}) {
  const active = useRef<{
    id: number;
    x: number;
    y: number;
    lock: Axis | "pending";
    element: HTMLDivElement;
  } | null>(null);
  const blocked = useRef(0);
  const surface = useRef<HTMLDivElement>(null);
  const setOffset = (offset: number) => {
    const element = surface.current;
    if (!element) return;
    element.style.transform = offset
      ? `translate${axis.toUpperCase()}(${offset}px)`
      : "";
    element.dataset.swiping = offset ? "true" : "false";
  };
  return (
    <div
      {...props}
      ref={surface}
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
        setOffset(Math.max(positive ? 0 : -96, Math.min(96, distance * 0.35)));
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
        if (direction) onSwipe(direction);
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
      {children}
    </div>
  );
}
