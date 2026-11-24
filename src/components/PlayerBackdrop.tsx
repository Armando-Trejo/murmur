import { useEffect, useRef, useState } from "react";
import { artworkTone, drawCentered, loadArtworkImage } from "../core/palette";

/** "r,g,b" tint of an artwork, or undefined while loading or when the host blocks pixel reads. */
export function useArtworkTone(url?: string) {
  const [tone, setTone] = useState<{ url: string; value?: string }>();
  useEffect(() => {
    if (!url) return;
    let live = true;
    void artworkTone(url).then(value => {
      if (live) setTone({ url, value });
    });
    return () => {
      live = false;
    };
  }, [url]);
  return tone && tone.url === url ? tone.value : undefined;
}

function BackdropLayer({ url, onReady }: { url: string; onReady: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    void loadArtworkImage(url).then(image => {
      const target = canvas.current;
      const context = target?.getContext("2d");
      if (!live || !target || !context) return;
      // Two short steps average the artwork; CSS then stretches this tiny field smoothly.
      const step = document.createElement("canvas");
      step.width = step.height = 96;
      const stepContext = step.getContext("2d");
      if (!stepContext) return;
      stepContext.imageSmoothingQuality = "high";
      drawCentered(stepContext, image, 96);
      context.imageSmoothingQuality = "high";
      context.drawImage(step, 0, 0, target.width, target.height);
      setReady(true);
      onReady();
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, [url]);
  return <canvas ref={canvas} className={"backdrop-layer" + (ready ? " ready" : "")} width={18} height={18} aria-hidden="true" />;
}

/**
 * A soft colour field taken from the current artwork, cross-faded between tracks.
 * It only paints the upper part of the player and fades into the AMOLED black below.
 */
export function PlayerBackdrop({ url }: { url?: string }) {
  const [layers, setLayers] = useState<{ url: string; id: number }[]>([]);
  const counter = useRef(0);
  useEffect(() => {
    if (!url) {
      setLayers([]);
      return;
    }
    setLayers(current => current.at(-1)?.url === url ? current : [...current.slice(-1), { url, id: ++counter.current }]);
  }, [url]);
  return (
    <div className="player-backdrop" aria-hidden="true">
      {layers.map(layer => (
        <BackdropLayer key={layer.id} url={layer.url} onReady={() => {
          // Drop the previous field once the new one has had time to fade in.
          window.setTimeout(() => setLayers(current => current.filter(item => item.id >= layer.id)), 900);
        }} />
      ))}
    </div>
  );
}
