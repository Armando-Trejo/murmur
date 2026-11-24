import { useEffect, useState } from "react";
import { AudioLines } from "lucide-react";
import { artworkOptions, isLetterboxed } from "../core/artwork";

type CoverItem = { artworkUrl?: string; videoId?: string };

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
}: {
  track?: CoverItem;
  kind?: number;
  className?: string;
  large?: boolean;
}) {
  const candidates = artworkOptions(track, large);
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
