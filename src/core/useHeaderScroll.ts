import { useEffect } from "react";

/**
 * Drives the top bar from the page scroll, on <html data-header="…">:
 * - "top": at the start of the page, the bar is fully transparent (no dark block over the hero);
 * - "hidden": scrolling down past the bar, it slides away and leaves the content alone;
 * - "shown": a short scroll up brings it back as frosted glass.
 * One passive listener, coalesced per animation frame.
 */
export function useHeaderScroll() {
  useEffect(() => {
    const root = document.documentElement;
    let last = window.scrollY;
    let frame = 0;
    let state = "";
    const set = (next: string) => {
      if (next !== state) root.dataset.header = state = next;
    };
    const read = () => {
      frame = 0;
      const y = window.scrollY;
      const delta = y - last;
      if (y < 12) set("top");
      else if (delta > 6 && y > 96) set("hidden");
      else if (delta < -6) set("shown");
      if (Math.abs(delta) > 6 || y < 12) last = y;
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      delete root.dataset.header;
    };
  }, []);
}
