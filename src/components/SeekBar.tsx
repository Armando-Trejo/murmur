import { useEffect, useRef, useState } from "react";
import { player } from "../core/AudioOrchestrator";
import { haptic } from "../core/haptics";

const clock = (value: number) => {
  const s = Math.max(0, Math.floor(value));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
};

/** How far past the last report the clock may run on its own (a stalled stream stops the bar). */
const MAX_AHEAD = 1.2;

/**
 * The engine reports the position every 0.5 s (2 s in the background). Between reports the clock
 * runs on its own, frame by frame, so bars and labels glide instead of stepping. It never runs more
 * than [MAX_AHEAD] seconds past the last report, nor past the song's real length.
 */
export function usePlaybackClock(position: number, playing: boolean, duration: number) {
  const anchor = useRef({ pos: position, at: 0 });
  if (anchor.current.pos !== position || anchor.current.at === 0)
    anchor.current = { pos: position, at: typeof performance === "undefined" ? 0 : performance.now() };
  const [, setFrame] = useState(0);
  useEffect(() => {
    if (!playing || typeof requestAnimationFrame === "undefined") return;
    let id = requestAnimationFrame(function frame() {
      setFrame((f) => (f + 1) % 1_000_000);
      id = requestAnimationFrame(frame);
    });
    return () => cancelAnimationFrame(id);
  }, [playing]);
  if (!playing || typeof performance === "undefined") return clamp(position, duration);
  const ahead = Math.min(MAX_AHEAD, (performance.now() - anchor.current.at) / 1000);
  return clamp(anchor.current.pos + Math.max(0, ahead), duration);
}
const clamp = (value: number, duration: number) => Math.max(0, duration > 0 ? Math.min(value, duration) : value);

/**
 * Scrubber: a 44 px touch target over a thin track. While dragging, the track thickens, the thumb
 * grows with an accent halo, a bubble and the left label show the time you will land on, and
 * provider progress cannot pull the thumb back. The fill ends exactly under the thumb's centre.
 * `duration` is the real length the engine reports (the catalogue's only until it is known).
 */
export function SeekBar({
  position,
  duration,
  playing,
  onError,
}: {
  position: number;
  duration: number;
  playing: boolean;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState<number>();
  const [scrubbing, setScrubbing] = useState(false);
  const dragging = useRef(false);
  const known = Number.isFinite(duration) && duration > 0;
  const end = known ? duration : 1;
  const live = usePlaybackClock(position, playing && draft === undefined, known ? duration : 0);
  const seconds = Math.max(0, Math.min(draft ?? live, end));
  const fraction = known ? seconds / end : 0;
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
    <>
      <div className={"seek-wrap" + (scrubbing ? " scrubbing" : "") + (known ? "" : " unknown")}
        style={{ "--seek-fraction": fraction.toFixed(5), "--seek-progress": `${fraction * 100}%` } as React.CSSProperties}>
        <input
          className="seek"
          type="range"
          aria-label="Posición de reproducción"
          aria-valuetext={known ? `${clock(seconds)} de ${clock(end)}` : clock(seconds)}
          min="0"
          max={end}
          step="any"
          value={seconds}
          disabled={!known}
          onPointerDown={() => {
            dragging.current = true;
            setScrubbing(true);
            setDraft(live);
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
      <div className={"time-labels" + (scrubbing ? " scrubbing" : "")}>
        <span>{clock(seconds)}</span>
        <span>{known ? clock(end) : "--:--"}</span>
      </div>
    </>
  );
}

/** The thin line under the mini player: same clock as the scrubber, so both always agree. */
export function MiniProgress({ position, duration, playing }: { position: number; duration: number; playing: boolean }) {
  const known = Number.isFinite(duration) && duration > 0;
  const seconds = usePlaybackClock(position, playing, known ? duration : 0);
  return (
    <div className={"mini-progress" + (known ? "" : " unknown")}>
      <i style={{ transform: `scaleX(${known ? Math.min(1, seconds / duration) : 0})` }} />
    </div>
  );
}
