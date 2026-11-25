import { useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { intentAxis, riseCommit, trackVelocity, type Axis, type Sample } from "../core/gestures";
import { haptic } from "../core/haptics";
import type { PlayerRiseHandle } from "./PlayerLayer";

/**
 * Swipe up on the mini player to open the full player. Spread on the element around the mini player: a
 * sideways drag is left to its song swipe (SwipeSurface), a tap to its own button; an upward drag lifts the
 * player with the finger (PlayerLayer) and opens it past about a fifth of the screen or on an upward
 * flick, otherwise it sinks back. With reduced motion nothing follows the finger: the same swipe just
 * opens the player with its usual fade.
 */
export function useMiniRise(rise: RefObject<PlayerRiseHandle>, onOpen: () => void) {
  const drag = useRef<{
    id: number; x: number; y: number; lock: Axis | "pending";
    /** Finger dy when the lift began, the mini player's top edge then, and where the player's top is now. */
    from: number; top: number; at: number; follows: boolean; samples: Sample[];
  } | null>(null);
  const blocked = useRef(0);
  const latest = useRef(onOpen);
  latest.current = onOpen;
  const stop = () => {
    const current = drag.current;
    drag.current = null;
    if (current?.lock === "y" && current.follows) rise.current?.cancel();
  };
  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (!event.isPrimary || event.button !== 0) return;
      drag.current = {
        id: event.pointerId, x: event.clientX, y: event.clientY, lock: "pending",
        from: 0, top: 0, at: 0, follows: false, samples: [],
      };
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      const current = drag.current;
      if (!current || current.id !== event.pointerId) return;
      const dx = event.clientX - current.x;
      const dy = event.clientY - current.y;
      if (current.lock === "pending") {
        current.lock = intentAxis(dx, dy);
        if (current.lock === "pending") return;
        // Sideways changes the song (SwipeSurface); only an upward drag lifts the player.
        if (current.lock !== "y" || dy > 0) {
          drag.current = null;
          return;
        }
        const bar = event.currentTarget.querySelector<HTMLElement>(".mini-player") ?? event.currentTarget;
        current.top = current.at = bar.getBoundingClientRect().top;
        // From here on, so the player does not jump by the distance needed to read the intent.
        current.from = dy;
        event.currentTarget.setPointerCapture(event.pointerId);
        current.follows = rise.current?.begin(current.top) ?? false;
      }
      if (current.lock !== "y") return;
      event.preventDefault();
      blocked.current = performance.now() + 450;
      current.at = Math.max(0, Math.min(current.top, current.top + dy - current.from));
      if (current.follows) rise.current?.move(current.at);
      current.samples.push({ t: event.timeStamp, v: current.at });
      if (current.samples.length > 8) current.samples.shift();
    },
    onPointerUp(event: ReactPointerEvent<HTMLElement>) {
      const current = drag.current;
      drag.current = null;
      if (!current || current.id !== event.pointerId || current.lock !== "y") return;
      blocked.current = performance.now() + 450;
      // Samples are the player's top edge: rising means a negative speed on screen.
      const velocity = -trackVelocity(current.samples, event.timeStamp);
      const opens = current.follows
        ? rise.current?.release(velocity) ?? false
        : riseCommit(current.top - current.at, velocity, window.innerHeight);
      if (!opens) return;
      haptic();
      latest.current();
    },
    onPointerCancel: stop,
    onLostPointerCapture(event: ReactPointerEvent<HTMLElement>) {
      if (event.target === event.currentTarget) stop();
    },
    onClickCapture(event: ReactMouseEvent<HTMLElement>) {
      // The release of a lift is not a tap on the button under the finger (which would open it anyway).
      if (performance.now() < blocked.current) {
        blocked.current = 0;
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}
