export type Rgb = [number, number, number];

/**
 * Picks the most characteristic colour of an artwork sample.
 * Pixels are grouped in a coarse 4-bit histogram and weighted by saturation so
 * that grey borders, black bars and white text do not win over the artwork.
 */
export function dominantColor(data: ArrayLike<number>): Rgb | undefined {
  const buckets = new Map<number, { weight: number; r: number; g: number; b: number }>();
  for (let i = 0; i + 3 < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const value = max / 255;
    const saturation = max ? (max - min) / max : 0;
    const usable = value > 0.12 && value < 0.97 ? 1 : 0.08;
    const weight = (0.12 + saturation * saturation * 1.6) * usable;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { weight: 0, r: 0, g: 0, b: 0 };
    bucket.weight += weight;
    bucket.r += r * weight;
    bucket.g += g * weight;
    bucket.b += b * weight;
    buckets.set(key, bucket);
  }
  let best: { weight: number; r: number; g: number; b: number } | undefined;
  for (const bucket of buckets.values()) if (!best || bucket.weight > best.weight) best = bucket;
  if (!best || best.weight <= 0) return undefined;
  return [best.r / best.weight, best.g / best.weight, best.b / best.weight].map(Math.round) as Rgb;
}

function toHsl([r, g, b]: Rgb): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h / 6, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): Rgb {
  if (!s) return [l, l, l].map(v => Math.round(v * 255)) as Rgb;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map(v => Math.round(v * 255)) as Rgb;
}

/** Keeps a tint dark and calm enough for white text on an AMOLED surface. */
export function backdropTone(color: Rgb): Rgb {
  const [h, s, l] = toHsl(color);
  return fromHsl([h, Math.min(s, 0.72), Math.min(0.4, Math.max(0.2, l))]);
}

const tones = new Map<string, Promise<string | undefined>>();

function loadImage(url: string, cors: boolean) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    if (cors) image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("artwork"));
    image.src = url;
  });
}

/** Draws the centre square of an image, which suits both album art and 16:9 video frames. */
export function drawCentered(context: CanvasRenderingContext2D, image: CanvasImageSource & { naturalWidth?: number; naturalHeight?: number; width: number; height: number }, size: number) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const side = Math.min(width, height);
  context.drawImage(image, (width - side) / 2, (height - side) / 2, side, side, 0, 0, size, size);
}

export function loadArtworkImage(url: string) {
  // A CORS-enabled copy lets MURMUR read its colour; otherwise it can still be drawn.
  return loadImage(url, true).catch(() => loadImage(url, false));
}

/** Resolves an "r,g,b" tint for the artwork or undefined when the host forbids reading pixels. */
export function artworkTone(url: string): Promise<string | undefined> {
  const cached = tones.get(url);
  if (cached) return cached;
  const pending = loadImage(url, true).then(image => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return undefined;
    drawCentered(context, image, 32);
    const color = dominantColor(context.getImageData(0, 0, 32, 32).data);
    return color ? backdropTone(color).join(",") : undefined;
  }).catch(() => undefined);
  if (tones.size > 60) tones.delete(tones.keys().next().value!);
  tones.set(url, pending);
  return pending;
}
