import { useEffect, useState } from "react";
import { AudioLines } from "lucide-react";
import { artworkOptions, isLetterboxed, type ArtworkSize } from "../core/artwork";
import type { ArtworkFrame } from "../core/types";

type CoverItem = { artworkUrl?: string; videoId?: string; customArtwork?: string; artworkFrame?: ArtworkFrame };

/** The user's framing of a cover: focal point, zoom, and fill or fit. */
export function frameStyle(frame?: ArtworkFrame): React.CSSProperties | undefined {
  if (!frame) return undefined;
  // Zoom crops inside the image itself (object-view-box), so a zoomed cover never spills out of
  // its square in a list row; the focal point decides where the crop sits.
  const hidden = Math.max(0, 1 - 1 / Math.max(1, frame.zoom)) * 100;
  const left = (hidden * frame.x) / 100;
  const top = (hidden * frame.y) / 100;
  return {
    objectFit: frame.fit,
    objectPosition: `${frame.x}% ${frame.y}%`,
    backgroundColor: frame.fit === "contain" ? "#0d0c11" : undefined,
    ...(hidden > 0.1 ? { objectViewBox: `inset(${top}% ${hidden - left}% ${hidden - top}% ${left}%)` } : {}),
  } as React.CSSProperties;
}

/**
 * Album/track artwork with ordered fallbacks. When every candidate fails (a flaky network or a
 * throttled CDN) it retries twice with a pause and once more when the connection returns, instead
 * of leaving a permanent placeholder.
 */
export function Cover({
  track,
  kind = 0,
  className = "",
  large = false,
  size,
}: {
  track?: CoverItem;
  kind?: number;
  className?: string;
  large?: boolean;
  /** small: list rows (~300 px source), medium: cards, large: the player. */
  size?: ArtworkSize;
}) {
  const candidates = artworkOptions(track, large ? "large" : size ?? "medium");
  const key = candidates.join("\n");
  const [attempt, setAttempt] = useState({ key: "", index: 0, retry: 0 });
  const current = attempt.key === key ? attempt : { key, index: 0, retry: 0 };
  const artwork = candidates[current.index];
  useEffect(() => {
    if (artwork || !candidates.length || current.retry >= 2) return;
    const retry = () => setAttempt({ key, index: 0, retry: current.retry + 1 });
    const timer = setTimeout(retry, 1600 * (current.retry + 1));
    window.addEventListener("online", retry);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", retry);
    };
  }, [artwork, key, current.retry, candidates.length]);
  const next = () => setAttempt({ key, index: current.index + 1, retry: current.retry });
  if (!artwork)
    return (
      <div className={`cover art art-${kind % 4} ${className}`} aria-hidden="true">
        <div className="vinyl">
          <i />
          <i />
          <i />
          <b />
        </div>
        <AudioLines size={22} className="art-mark" />
      </div>
    );
  return (
    <img
      key={artwork + "#" + current.retry}
      className={"cover " + (isLetterboxed(artwork) ? "letterboxed " : "") + className}
      src={artwork}
      alt=""
      loading={large ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      style={frameStyle(track?.artworkFrame)}
      referrerPolicy="no-referrer"
      onError={next}
      onLoad={(event) => {
        // YouTube answers a missing maxres frame with a tiny grey placeholder instead of an error.
        if (large && artwork.includes("i.ytimg.com/vi/") && event.currentTarget.naturalWidth < 480 &&
            current.index < candidates.length - 1) next();
      }}
    />
  );
}
