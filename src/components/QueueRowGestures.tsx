import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";
import {
  animate,
  useIsPresent,
  useReducedMotion,
  type AnimationPlaybackControls,
  type TargetAndTransition,
} from "framer-motion";
import { Trash2 } from "lucide-react";
import {
  followSwipe,
  intentAxis,
  removeCommit,
  removeDistance,
  trackVelocity,
  type Axis,
  type Sample,
} from "../core/gestures";
import { haptic } from "../core/haptics";
import { motionMs, release, settle } from "../core/motion";
import { useLongPress } from "./useLongPress";

/** Red layer uncovered on the right as the row slides left (sized by --swipe in gestures216.css). */
export function QueueRemoveReveal() {
  return (
    <div className="queue-remove-reveal" aria-hidden="true">
      <Trash2 size={18} />
      <span>Quitar</span>
    </div>
  );
}

/** Never on the reorder handle or the arrow buttons: those keep their own gestures. */
const OWN_GESTURE = ".drag-handle,.icon-button,input,select";

/**
 * Queue row gestures besides reordering: swipe left to remove (the row follows the finger over a red
 * "Quitar" layer, ticks when the release would remove it, then is thrown out and collapses) and hold to
 * open the song's menu. `onRemove` does the removal and returns false when it may not happen (the song
 * started playing meanwhile): the row then springs back.
 */
export function useQueueRowGestures({ onRemove, onMenu }: { onRemove?: () => boolean; onMenu?: () => void }) {
  const row = useRef<HTMLLIElement>(null);
  const reduced = useReducedMotion();
  const [leaving, setLeaving] = useState(false);
  const swipe = useRef<{
    id: number; x: number; y: number; lock: Axis | "pending";
    /** Finger travel already "in" the row when it was caught mid-settle, and the finger dx at that moment. */
    base: number; from: number; reach: number; armed: boolean; width: number; samples: Sample[];
  } | null>(null);
  const offset = useRef(0);
  const commitAt = useRef(140);
  const motion = useRef<AnimationPlaybackControls>();
  const blocked = useRef(0);
  const press = useLongPress(row, onMenu && (() => {
    swipe.current = null;
    onMenu();
  }));
  useEffect(() => () => motion.current?.stop(), []);
  /** Where the row content sits (px, ≤ 0); the reveal and its strength follow from it. */
  const place = (value: number) => {
    offset.current = value;
    const element = row.current;
    if (!element) return;
    const progress = Math.min(1, -value / (commitAt.current * 0.9));
    element.style.setProperty("--swipe", value + "px");
    element.style.setProperty("--swipe-p", progress.toFixed(3));
    element.dataset.armed = progress >= 1 ? "true" : "false";
  };
  const springBack = (velocity: number) => {
    motion.current?.stop();
    const element = row.current;
    const done = () => { if (element) delete element.dataset.swiping; };
    if (reduced || !offset.current) {
      place(0);
      done();
      return;
    }
    motion.current = animate(offset.current, 0, {
      type: "spring", stiffness: 520, damping: 38, restDelta: 0.5, velocity: velocity * 1000,
      onUpdate: place, onComplete: done,
    });
  };
  // "Deshacer" tapped while the row was still folding away: the same row comes back, so slide it back in.
  const present = useIsPresent();
  useEffect(() => {
    if (!present || !leaving) return;
    setLeaving(false);
    springBack(0);
  }, [present]);
  const throwOut = (velocity: number, width: number) => {
    motion.current?.stop();
    // Reduced motion: it simply fades where the finger left it.
    if (reduced) return;
    // Keeps the finger's momentum on its way out; the exit then folds the row away under it.
    const speed = Math.max(Math.abs(velocity), 1.2);
    const duration = Math.min(0.22, Math.max(0.12, (width + offset.current) / speed / 1000));
    motion.current = animate(offset.current, -width, { duration, ease: release, onUpdate: place });
  };
  return {
    ref: row,
    leaving,
    /** Exit of a row removed by the finger: it folds its height away so the rows below rise into place. */
    leaveExit: (reduced
      ? { opacity: 0, transition: { duration: motionMs.reduced / 1000 } }
      : {
          height: 0,
          paddingTop: 0,
          paddingBottom: 0,
          marginTop: 0,
          marginBottom: 0,
          opacity: 0,
          transition: {
            default: { duration: 0.24, ease: settle, delay: 0.12 },
            opacity: { duration: 0.16, ease: release, delay: 0.2 },
          },
        }) as TargetAndTransition,
    handlers: {
      onPointerDown(event: ReactPointerEvent<HTMLLIElement>) {
        if (leaving || !event.isPrimary || event.button !== 0) return;
        if ((event.target as HTMLElement).closest(OWN_GESTURE)) return;
        swipe.current = {
          id: event.pointerId, x: event.clientX, y: event.clientY, lock: "pending",
          base: 0, from: 0, reach: 0, armed: false, width: event.currentTarget.offsetWidth, samples: [],
        };
        press.start(event);
      },
      onPointerMove(event: ReactPointerEvent<HTMLLIElement>) {
        press.move(event);
        const start = swipe.current;
        if (!start || start.id !== event.pointerId) return;
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (start.lock === "pending") {
          start.lock = intentAxis(dx, dy);
          if (start.lock === "pending") return;
          // Up and down belong to the scroll; a swipe right only matters to a row still settling.
          if (start.lock !== "x" || (dx > 0 && offset.current >= 0) || !onRemove) {
            swipe.current = null;
            return;
          }
          motion.current?.stop();
          commitAt.current = removeDistance(start.width);
          start.base = offset.current / 0.9;
          start.from = dx;
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.dataset.swiping = "true";
        }
        if (start.lock !== "x") return;
        event.preventDefault();
        blocked.current = performance.now() + 450;
        start.reach = start.base + dx - start.from;
        place(Math.min(0, followSwipe(start.reach, commitAt.current)));
        const armed = -start.reach >= commitAt.current;
        if (armed !== start.armed) {
          start.armed = armed;
          // A light tick: letting go now removes it.
          if (armed) haptic();
        }
        start.samples.push({ t: event.timeStamp, v: start.reach });
        if (start.samples.length > 8) start.samples.shift();
      },
      onPointerUp(event: ReactPointerEvent<HTMLLIElement>) {
        press.end();
        const start = swipe.current;
        swipe.current = null;
        if (!start || start.id !== event.pointerId || start.lock !== "x") return;
        blocked.current = performance.now() + 450;
        const velocity = trackVelocity(start.samples, event.timeStamp);
        if (onRemove && removeCommit(start.reach, event.clientY - start.y, velocity, start.width)) {
          // The exit must already be the fold when the queue drops the row.
          flushSync(() => setLeaving(true));
          if (onRemove()) {
            throwOut(velocity, start.width);
            return;
          }
          setLeaving(false);
        }
        springBack(velocity);
      },
      onPointerCancel() {
        press.end();
        if (swipe.current?.lock === "x") springBack(0);
        swipe.current = null;
      },
      onLostPointerCapture(event: ReactPointerEvent<HTMLLIElement>) {
        if (event.target !== event.currentTarget) return;
        if (swipe.current?.lock === "x") springBack(0);
        swipe.current = null;
      },
      onContextMenu(event: ReactMouseEvent<HTMLLIElement>) {
        // The hold opens MURMUR's own menu; no text selection or system menu on top of it.
        if (onMenu) event.preventDefault();
      },
      onClickCapture(event: ReactMouseEvent<HTMLLIElement>) {
        // The release of a swipe or a hold is not a tap on the song under the finger.
        if (press.swallowClick() || (event.detail > 0 && performance.now() < blocked.current)) {
          blocked.current = 0;
          event.preventDefault();
          event.stopPropagation();
        }
      },
    },
  };
}
