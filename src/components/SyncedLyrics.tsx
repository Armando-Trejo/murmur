import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { LocateFixed } from "lucide-react";
import { activeLyricIndex, lyricScrollTarget, type TimedLine } from "../core/lyrics";

/**
 * Time-synced lyrics that follow the song inside their own scroll area. Touching or
 * scrolling the lyrics pauses the follow mode for a few seconds; tapping a line seeks.
 */
export function SyncedLyrics({ lines, position, onSeek }: {
  lines: TimedLine[];
  position: number;
  onSeek: (seconds: number) => void;
}) {
  const reduced = useReducedMotion();
  const scroller = useRef<HTMLDivElement>(null);
  const resume = useRef<number>();
  const [following, setFollowing] = useState(true);
  const active = activeLyricIndex(lines, position);
  useEffect(() => () => window.clearTimeout(resume.current), []);
  useEffect(() => {
    const box = scroller.current;
    if (!following || !box) return;
    const line = box.children[Math.max(0, active)] as HTMLElement | undefined;
    if (!line) return;
    const top = active < 0 ? 0 : lyricScrollTarget(line.offsetTop, line.offsetHeight, box.clientHeight);
    if (Math.abs(box.scrollTop - top) < 2) return;
    box.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
  }, [active, following, reduced, lines]);
  const pauseFollow = () => {
    setFollowing(false);
    window.clearTimeout(resume.current);
    resume.current = window.setTimeout(() => setFollowing(true), 6000);
  };
  const follow = () => {
    window.clearTimeout(resume.current);
    setFollowing(true);
  };
  return (
    <div className="synced-lyrics">
      <div
        className="lyrics-scroller"
        ref={scroller}
        onWheel={pauseFollow}
        onTouchMove={pauseFollow}
        onKeyDown={event => {
          if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) pauseFollow();
        }}
      >
        {lines.map((line, index) => (
          <button
            type="button"
            key={line.time + ":" + index}
            className={index === active ? "active" : index < active ? "past" : ""}
            aria-current={index === active ? "true" : undefined}
            onClick={() => {
              follow();
              onSeek(line.time);
            }}
          >
            {line.text || "♪"}
          </button>
        ))}
      </div>
      {!following && (
        <button type="button" className="lyrics-follow" onClick={follow}>
          <LocateFixed size={16} aria-hidden="true" /> Seguir la letra
        </button>
      )}
    </div>
  );
}
