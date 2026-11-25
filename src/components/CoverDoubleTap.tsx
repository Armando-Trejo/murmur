import { useRef, useState, type ReactNode } from "react";
import { Heart } from "lucide-react";
import { isDoubleTap, isTap, type Touch } from "../core/gestures";
import { haptic } from "../core/haptics";

/**
 * Double-tap the big cover to save the song: a heart pops over the cover and fades (gestures216.css),
 * with a light haptic. Only quick taps in place count: any travel belongs to the cover swipe (Siguiente /
 * Anterior) or to the pull that closes the player. A single tap does nothing, so nothing waits for a
 * second one, and a third tap starts a new pair instead of firing again.
 */
export function CoverDoubleTap({ onDoubleTap, children }: { onDoubleTap: () => void; children: ReactNode }) {
  const down = useRef<Touch & { id: number }>();
  const lastTap = useRef<Touch>();
  /** Each double tap remounts the heart, restarting its pop even while the previous one fades. */
  const [burst, setBurst] = useState(0);
  return (
    <div
      className="cover-tap"
      onPointerDown={(event) => {
        down.current = event.isPrimary && event.button === 0
          ? { id: event.pointerId, t: event.timeStamp, x: event.clientX, y: event.clientY }
          : undefined;
      }}
      onPointerUp={(event) => {
        const start = down.current;
        down.current = undefined;
        if (!start || start.id !== event.pointerId) return;
        const up = { t: event.timeStamp, x: event.clientX, y: event.clientY };
        if (!isTap(start, up)) {
          lastTap.current = undefined;
          return;
        }
        if (!isDoubleTap(lastTap.current, start)) {
          lastTap.current = up;
          return;
        }
        lastTap.current = undefined;
        haptic();
        setBurst((count) => count + 1);
        onDoubleTap();
      }}
      onPointerCancel={() => {
        // The browser took the touch (a scroll): neither this tap nor the previous one pairs up.
        down.current = undefined;
        lastTap.current = undefined;
      }}
    >
      {children}
      {burst > 0 && (
        <span key={burst} className="cover-heart" aria-hidden="true">
          <Heart size={92} fill="currentColor" strokeWidth={1.5} />
        </span>
      )}
    </div>
  );
}
