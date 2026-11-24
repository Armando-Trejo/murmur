import { useRef, useState } from "react";
import { player } from "../core/AudioOrchestrator";
import { haptic } from "../core/haptics";

const clock = (value: number) => {
  const s = Math.max(0, Math.floor(value));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
};

/**
 * Scrubber: a 44 px touch target over a thin track. While dragging, the track thickens, the thumb
 * grows with an accent halo and a bubble shows the time you will land on; provider progress cannot
 * pull the thumb back mid-drag. A light haptic marks grabbing and releasing.
 */
export function SeekBar({
  position,
  duration,
  onError,
}: {
  position: number;
  duration: number;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState<number>();
  const [scrubbing, setScrubbing] = useState(false);
  const dragging = useRef(false);
  const end = Math.max(1, Number.isFinite(duration) ? duration : 1);
  const seconds = Math.max(0, Math.min(draft ?? position, end));
  const progress = `${(seconds / end) * 100}%`;
  const commit = (seconds: number) => {
    void player
      .seek(seconds)
      .catch((error) => onError((error as Error).message))
      .finally(() => {
        if (!dragging.current) setDraft(undefined);
      });
  };
  const release = (value: number) => {
    dragging.current = false;
    setScrubbing(false);
    haptic();
    commit(value);
  };
  return (
    <div className={"seek-wrap" + (scrubbing ? " scrubbing" : "")} style={{ "--seek-progress": progress } as React.CSSProperties}>
      <input
        className="seek"
        type="range"
        aria-label="Posición de reproducción"
        aria-valuetext={`${clock(seconds)} de ${clock(end)}`}
        min="0"
        max={end}
        step="1"
        value={seconds}
        onPointerDown={() => {
          dragging.current = true;
          setScrubbing(true);
          setDraft(position);
          haptic();
        }}
        onChange={(event) => {
          const value = Number(event.target.value);
          setDraft(value);
          if (!dragging.current) commit(value);
        }}
        onPointerUp={(event) => release(Number(event.currentTarget.value))}
        onPointerCancel={() => {
          dragging.current = false;
          setScrubbing(false);
          setDraft(undefined);
        }}
      />
      <output className="seek-bubble" aria-hidden="true">{clock(seconds)}</output>
    </div>
  );
}
