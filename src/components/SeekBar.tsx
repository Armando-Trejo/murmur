import { useRef, useState } from "react";
import { player } from "../core/AudioOrchestrator";

/** Keep the thumb under the finger; provider progress cannot pull it back mid-drag. */
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
  const dragging = useRef(false);
  const end = Math.max(1, Number.isFinite(duration) ? duration : 1);
  const seconds = Math.max(0, Math.min(draft ?? position, end));
  const commit = (seconds: number) => {
    void player
      .seek(seconds)
      .catch((error) => onError((error as Error).message))
      .finally(() => {
        if (!dragging.current) setDraft(undefined);
      });
  };
  return (
    <input
      className="seek"
      type="range"
      aria-label="Posición de reproducción"
      min="0"
      max={end}
      value={seconds}
      style={{ "--seek-progress": `${seconds / end * 100}%` } as React.CSSProperties}
      onPointerDown={() => {
        dragging.current = true;
        setDraft(position);
      }}
      onChange={(event) => {
        const seconds = Number(event.target.value);
        setDraft(seconds);
        if (!dragging.current) commit(seconds);
      }}
      onPointerUp={(event) => {
        dragging.current = false;
        commit(Number(event.currentTarget.value));
      }}
      onPointerCancel={() => {
        dragging.current = false;
        setDraft(undefined);
      }}
    />
  );
}
