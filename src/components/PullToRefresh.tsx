import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { haptic } from "../core/haptics";

/** How far the indicator (moving at half the finger's speed) must come down for a release to refresh. */
export const PULL_READY = 56;
const MAX_PULL = 110;

/**
 * Pull down from the top of the page to refresh, like Spotify and YouTube Music. Only starts when the
 * page is already at the top and the gesture is mostly vertical, so carousels and the page scroll
 * keep working. `busy` keeps the spinner turning until the new content arrived.
 */
export function PullToRefresh({ enabled, busy, onRefresh }: { enabled: boolean; busy: boolean; onRefresh: () => void }) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const tracking = useRef(false);
  const armed = useRef(false);
  const since = useRef(0);

  useEffect(() => {
    if (!enabled) { setPull(0); return; }
    const down = (e: TouchEvent) => {
      if (refreshing || e.touches.length !== 1 || window.scrollY > 0) { start.current = null; return; }
      // Not from inside a sheet, a horizontal carousel or a slider.
      const target = e.target as HTMLElement | null;
      if (target?.closest(".expanded-player, [role='dialog'], input[type='range'], .no-pull")) { start.current = null; return; }
      start.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      tracking.current = false;
      armed.current = false;
    };
    const move = (e: TouchEvent) => {
      const origin = start.current;
      if (!origin) return;
      const dx = e.touches[0].clientX - origin.x;
      const dy = e.touches[0].clientY - origin.y;
      if (!tracking.current) {
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || window.scrollY > 0) { start.current = null; return; }
        tracking.current = true;
      }
      // Resistance: the further you pull, the less it moves.
      const distance = Math.min(MAX_PULL, dy * 0.5);
      setPull(distance);
      const ready = distance >= PULL_READY;
      if (ready !== armed.current) { armed.current = ready; if (ready) haptic("tick"); }
    };
    const up = () => {
      if (!start.current) return;
      start.current = null;
      if (tracking.current && armed.current) {
        setRefreshing(true);
        since.current = Date.now();
        haptic("confirm");
        onRefresh();
      }
      tracking.current = false;
      armed.current = false;
      setPull(0);
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up, { passive: true });
    window.addEventListener("touchcancel", up, { passive: true });
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, [enabled, refreshing, onRefresh]);

  // Spin at least a moment (it reads as "done"), at most 15 s even if a source never answers.
  useEffect(() => {
    if (!refreshing) return;
    if (busy) {
      const t = setTimeout(() => setRefreshing(false), 15_000);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setRefreshing(false), Math.max(0, 700 - (Date.now() - since.current)));
    return () => clearTimeout(t);
  }, [refreshing, busy]);

  const shown = refreshing ? 56 : pull;
  if (!enabled || shown <= 0) return null;
  const progress = Math.min(1, pull / PULL_READY);
  return (
    <div className="pull-refresh" role="status" aria-label={refreshing ? "Actualizando Inicio" : "Suelta para actualizar"}
      style={{ transform: `translate(-50%, ${shown - 44}px)` }}>
      <span className={refreshing ? "spinning" : ""} style={{ opacity: refreshing ? 1 : 0.35 + progress * 0.65 }}>
        <RefreshCw size={20} style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }} />
      </span>
    </div>
  );
}
