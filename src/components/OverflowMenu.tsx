import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, MoreVertical } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { settle } from "../core/motion";
import { haptic } from "../core/haptics";

export type MenuEntry =
  | { label: string; icon?: ReactNode; onSelect: () => void; checked?: boolean; disabled?: boolean; hint?: string }
  | { heading: string }
  | "divider";

/**
 * Three-dot menu that keeps secondary actions out of the layout. It renders in a portal so
 * clipped or transformed parents (player, cards) cannot cut it, and opens upwards near the bottom.
 */
export function OverflowMenu({
  label,
  entries,
  icon,
  className = "",
}: {
  label: string;
  entries: MenuEntry[];
  icon?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top?: number; bottom?: number; right: number }>({ right: 12 });
  const reduced = useReducedMotion();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = (focus = false) => {
    setOpen(false);
    if (focus) trigger.current?.focus({ preventScroll: true });
  };
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const rect = trigger.current.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - rect.right);
    const below = window.innerHeight - rect.bottom;
    setPlace(below < 320 && rect.top > below
      ? { bottom: window.innerHeight - rect.top + 6, right }
      : { top: rect.bottom + 6, right });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) close();
    };
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(true);
      }
    };
    const dismiss = () => close();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", keys, true);
    window.addEventListener("popstate", dismiss);
    window.addEventListener("resize", dismiss);
    const frame = requestAnimationFrame(() =>
      panel.current?.querySelector<HTMLElement>("[role^=menuitem]:not(:disabled)")?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", keys, true);
      window.removeEventListener("popstate", dismiss);
      window.removeEventListener("resize", dismiss);
    };
  }, [open]);
  const move = (step: number) => {
    const items = [...(panel.current?.querySelectorAll<HTMLElement>("[role^=menuitem]:not(:disabled)") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + step + items.length) % items.length]?.focus({ preventScroll: true });
  };
  return (
    <span className={"overflow-menu " + className}>
      <button
        ref={trigger}
        className="icon-button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          haptic();
          setOpen((value) => !value);
        }}
      >
        {icon ?? <MoreVertical size={20} />}
      </button>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={panel}
              id={id}
              role="menu"
              aria-label={label}
              className={"overflow-panel" + (place.bottom !== undefined ? " opens-up" : "")}
              style={place}
              initial={{ opacity: 0, scale: reduced ? 1 : 0.92, y: reduced ? 0 : place.bottom !== undefined ? 6 : -6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: reduced ? 1 : 0.96, transition: { duration: 0.11 } }}
              transition={{ duration: reduced ? 0.1 : 0.2, ease: settle }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") { event.preventDefault(); move(1); }
                if (event.key === "ArrowUp") { event.preventDefault(); move(-1); }
                if (event.key === "Tab") close();
              }}
            >
              {entries.map((entry, index) =>
                entry === "divider" ? (
                  <hr key={"d" + index} />
                ) : "heading" in entry ? (
                  <p className="overflow-heading" key={"h" + index}>{entry.heading}</p>
                ) : (
                  <motion.button
                    key={entry.label}
                    role={entry.checked === undefined ? "menuitem" : "menuitemradio"}
                    aria-checked={entry.checked}
                    className="overflow-item"
                    disabled={entry.disabled}
                    initial={reduced ? false : { opacity: 0, x: 6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.18, delay: reduced ? 0 : 0.02 * index, ease: settle }}
                    onClick={() => {
                      close();
                      entry.onSelect();
                    }}
                  >
                    <span className="overflow-icon" aria-hidden="true">{entry.icon}</span>
                    <span className="overflow-label">
                      {entry.label}
                      {entry.hint && <small>{entry.hint}</small>}
                    </span>
                    {entry.checked && <Check size={17} className="highlight" aria-hidden="true" />}
                  </motion.button>
                ),
              )}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </span>
  );
}
