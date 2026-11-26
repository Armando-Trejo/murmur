/**
 * Android does not fade a styled scrollbar by itself, so it stayed visible in the player. Every
 * scrolling element (and the page) gets `is-scrolling` while it moves; CSS shows the thumb only then.
 */
export function fadeScrollbars(idleMs = 900) {
  if (typeof document === "undefined") return;
  const timers = new WeakMap<Element, ReturnType<typeof setTimeout>>();
  document.addEventListener("scroll", (event) => {
    const target = event.target === document ? document.documentElement : (event.target as Element);
    if (!(target instanceof Element)) return;
    target.classList.add("is-scrolling");
    clearTimeout(timers.get(target));
    timers.set(target, setTimeout(() => target.classList.remove("is-scrolling"), idleMs));
  }, { capture: true, passive: true });
}
