import type { ReactNode } from "react";
import { AnimatePresence, motion, useIsPresent, type Variants } from "framer-motion";
import { motionMs, release, settle } from "../core/motion";

/**
 * How the mini player's song changes. `dir` is the way the outgoing song travels (−1 to the left for
 * Siguiente, 1 to the right for Anterior); `flung` means a finger already threw it out.
 */
export type SwapMotion = { dir: number; flung: boolean };

const variants: Variants = {
  enter: ({ dir, flung }: SwapMotion) => ({ opacity: 0, x: -dir * (flung ? 56 : 24) }),
  center: {
    opacity: 1,
    x: 0,
    transition: {
      x: { type: "spring", stiffness: 420, damping: 38 },
      opacity: { duration: motionMs.swapIn / 1000, ease: settle },
    },
  },
  leave: ({ dir, flung }: SwapMotion) =>
    flung
      ? { opacity: 0, transition: { duration: 0.14, ease: release } }
      : { opacity: 0, x: dir * 24, transition: { duration: motionMs.swapOut / 1000, ease: release } },
};

/**
 * Cover and title of the mini player. The outgoing song leaves the way it went (or keeps the momentum of
 * the finger that threw it) and the next one arrives from the opposite side, in the same spot.
 */
export function MiniTrackSwap({ swapKey, swap, children }: {
  swapKey: string;
  swap: SwapMotion;
  children: ReactNode;
}) {
  return (
    <span className="mini-stage">
      <AnimatePresence initial={false} custom={swap}>
        <MiniTrack key={swapKey} swap={swap}>
          {children}
        </MiniTrack>
      </AnimatePresence>
    </span>
  );
}

function MiniTrack({ swap, children }: { swap: SwapMotion; children: ReactNode }) {
  const present = useIsPresent();
  return (
    <motion.span
      className="mini-track"
      // The swipe surface only ever moves the song on screen, never the one leaving.
      data-leaving={present ? undefined : "true"}
      custom={swap}
      variants={variants}
      initial="enter"
      animate="center"
      exit="leave"
    >
      {children}
    </motion.span>
  );
}
