import { useLayoutEffect } from "react";

/**
 * Sizes the cover so the whole "now playing" block (title, scrubber, controls, Auto-Mix line) ends
 * inside the screen: on a short phone the cover shrinks instead of pushing Play off the screen.
 * It measures where the last control actually ends and corrects the cover by the difference, so
 * paddings, safe areas and font scaling are all accounted for. Sets --cover-fit on the player.
 */
export function useFitCover(open: boolean, trackKey: string) {
  useLayoutEffect(() => {
    if (!open) return;
    let cleanup = () => {};
    let frame = 0;
    let tries = 0;
    // The player mounts with its opening animation: wait for it to exist.
    const attach = () => {
      const found = document.querySelector<HTMLElement>(".expanded-player");
      if (!found?.querySelector(".mix-mode-note, .transport")) { if (tries++ < 90) frame = requestAnimationFrame(attach); return; }
      cleanup = watch(found);
    };
    attach();
    return () => { cancelAnimationFrame(frame); cleanup(); };
  }, [open, trackKey]);
}

/**
 * One fitting pass on the player. Measured in the player's own pixels, so it also holds while a finger
 * moves and scales the player (pull to close, swipe up to open).
 */
export function fitCover(player: HTMLElement) {
  const cover = player.querySelector<HTMLElement>(".ambient-cover");
  const last = player.querySelector<HTMLElement>(".mix-mode-note") ?? player.querySelector<HTMLElement>(".transport");
  if (!cover || !last) return;
  const max = Math.min(player.clientWidth - 40, 420);
  // Two passes: the second corrects any wrap the first size caused.
  for (let pass = 0; pass < 2; pass++) {
    const box = player.getBoundingClientRect();
    const scale = player.offsetWidth ? box.width / player.offsetWidth : 1;
    const current = cover.getBoundingClientRect().width / scale;
    // The player rests at the top of the screen: measure from its own top edge, wherever it is right now.
    const bottom = (last.getBoundingClientRect().bottom - box.top) / scale + player.scrollTop;
    const spare = window.innerHeight - 14 - bottom;
    const size = Math.round(Math.max(150, Math.min(max, current + spare)));
    if (Math.abs(size - current) < 2) break;
    player.style.setProperty("--cover-fit", `${size}px`);
  }
}

function watch(player: HTMLElement) {
  const fit = () => fitCover(player);
  fit();
  // The opening slide moves the controls while it runs: measure again once it has settled.
  const settled = [setTimeout(fit, 450), setTimeout(fit, 1100)];
  const observer = new ResizeObserver(() => fit());
  for (const selector of [".now-title", ".transport", ".expanded-player"]) {
    const el = selector === ".expanded-player" ? player : player.querySelector(selector);
    if (el) observer.observe(el);
  }
  window.addEventListener("resize", fit);
  return () => {
    settled.forEach(clearTimeout);
    observer.disconnect();
    window.removeEventListener("resize", fit);
  };
}
