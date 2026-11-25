import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { holdBroken, LONG_PRESS_MS } from "../core/gestures";
import { haptic } from "../core/haptics";

/** The row starts to give under the finger only once a press is clearly not a quick tap. */
const FEEDBACK_AFTER = 110;

/**
 * Hold a row to open its menu. Driven by the row's own pointer handlers (start / move / end), so it lives
 * alongside the row's swipe: past 8 px of travel, or when the list under the finger scrolls, the hold is
 * dropped and the swipe or the scroll takes over. While it is held the row carries data-pressing (a slow,
 * subtle squeeze in CSS); when it fires, a haptic, then `onLongPress`, and the click that follows the
 * finger lifting is swallowed so it does not also play the song.
 */
export function useLongPress(element: RefObject<HTMLElement>, onLongPress?: () => void) {
  const press = useRef<{ id: number; x: number; y: number; timer: number; feedback: number; scroll: (e: Event) => void }>();
  /** The last hold fired: its click is still to come. Reset by the next press. */
  const fired = useRef(false);
  const liftedAt = useRef(0);
  const latest = useRef(onLongPress);
  latest.current = onLongPress;
  const cancel = () => {
    const current = press.current;
    if (!current) return;
    press.current = undefined;
    clearTimeout(current.timer);
    clearTimeout(current.feedback);
    document.removeEventListener("scroll", current.scroll, true);
    if (element.current) delete element.current.dataset.pressing;
  };
  useEffect(() => cancel, []);
  return {
    start(event: ReactPointerEvent) {
      cancel();
      fired.current = false;
      if (!latest.current || !event.isPrimary || event.button !== 0) return;
      const row = element.current;
      const scroll = (scrolled: Event) => {
        // Only a scroll that carries the row away (the list or the page), not lyrics scrolling elsewhere.
        const owner = scrolled.target;
        if (owner === document || (owner instanceof Node && row && owner.contains(row))) cancel();
      };
      document.addEventListener("scroll", scroll, { capture: true, passive: true });
      press.current = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        scroll,
        feedback: window.setTimeout(() => {
          if (row) row.dataset.pressing = "true";
        }, FEEDBACK_AFTER),
        timer: window.setTimeout(() => {
          cancel();
          fired.current = true;
          haptic("confirm");
          latest.current?.();
        }, LONG_PRESS_MS),
      };
    },
    move(event: ReactPointerEvent) {
      const current = press.current;
      if (current && current.id === event.pointerId && holdBroken(event.clientX - current.x, event.clientY - current.y))
        cancel();
    },
    /** Finger lifted or the gesture was taken away (pointerup, pointercancel). */
    end() {
      cancel();
      if (fired.current) liftedAt.current = performance.now();
    },
    /** True once for the click that follows the finger lifting from a hold that fired. */
    swallowClick() {
      const swallow = fired.current && performance.now() - liftedAt.current < 600;
      fired.current = false;
      return swallow;
    },
    /** The hold fired and the finger is still down: no swipe may start from it. */
    get held() {
      return fired.current;
    },
  };
}
