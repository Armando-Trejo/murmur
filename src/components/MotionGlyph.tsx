import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { motionMs, settle } from "../core/motion";

export function MotionGlyph({ state, children }: { state: string; children: ReactNode }) {
  const reduced = useReducedMotion();
  return (
    <span className="motion-glyph" aria-hidden="true">
      <AnimatePresence initial={false} mode="sync">
        <motion.span
          key={state}
          initial={{ opacity: 0, scale: reduced ? 1 : 0.82, y: reduced ? 0 : 3 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{
            opacity: 0, scale: reduced ? 1 : 0.88, y: reduced ? 0 : -2,
            transition: { duration: 0.09, ease: settle },
          }}
          transition={{ duration: (reduced ? motionMs.reduced : motionMs.feedback + 35) / 1000, ease: settle }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}
