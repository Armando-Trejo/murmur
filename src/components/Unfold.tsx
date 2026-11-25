import { useLayoutEffect, useRef, type ReactNode } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { motionMs, release, settle } from "../core/motion";

/**
 * A section that unfolds (lyrics, queue): it grows to its real height so what sits below glides instead
 * of jumping, and folds back the same way. Use as the direct child of an AnimatePresence. It clips only
 * while it moves (data-unfolded), so a lifted queue row or the lyrics glow can spill out once it rests.
 * Reduced motion: a plain fade.
 */
export function Unfold({ children }: { children: ReactNode }) {
  const reduced = useReducedMotion();
  const element = useRef<HTMLDivElement>(null);
  const rest = (resting: boolean) => {
    if (element.current) element.current.dataset.unfolded = String(resting);
  };
  // Mounted already open (no entrance animation): it rests from the first frame.
  useLayoutEffect(() => rest(element.current?.style.height !== "0px"), []);
  const fade = { duration: motionMs.reduced / 1000 };
  return reduced ? (
    <motion.div
      ref={element}
      className="expand-panel"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, pointerEvents: "none", transition: fade }}
      transition={fade}
    >
      {children}
    </motion.div>
  ) : (
    <motion.div
      ref={element}
      className="expand-panel"
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{
        height: 0,
        opacity: 0,
        pointerEvents: "none",
        transition: { height: { duration: 0.24, ease: release }, opacity: { duration: 0.14, ease: release } },
      }}
      transition={{
        height: { duration: 0.34, ease: settle },
        opacity: { duration: 0.24, ease: settle, delay: 0.04 },
      }}
      onAnimationStart={() => rest(false)}
      onAnimationComplete={() => rest(true)}
    >
      {children}
    </motion.div>
  );
}
