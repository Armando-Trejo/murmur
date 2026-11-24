import type { QueueItem } from "../src/core/types";

interface PreviewTransport {
  read: () => { track: QueueItem; playing: boolean; positionMs: number };
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seek: (seconds: number) => void;
}

const glyphs = {
  back: '<path d="M6 5v14M19 5l-10 7 10 7Z"/>',
  next: '<path d="M18 5v14M5 5l10 7-10 7Z"/>',
  play: '<path d="M8 5l11 7-11 7Z"/>',
  pause: '<path d="M9 5v14m6-14v14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};
type Glyph = keyof typeof glyphs;
const icon = (name: Glyph) => '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + glyphs[name] + "</svg>";
const time = (ms: number) => Math.floor(ms / 60000) + ":" + String(Math.floor(ms / 1000) % 60).padStart(2, "0");
const fallback = [218, 272, 36];
const dateFormat = new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short" });
const clockFormat = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function huesFor(image: HTMLImageElement) {
  const sample = document.createElement("canvas");
  sample.width = sample.height = 16;
  const context = sample.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(image, 0, 0, 16, 16);
  const data = context.getImageData(0, 0, 16, 16).data;
  const votes = new Float32Array(12);
  for (let i = 0; i < data.length; i += 4) {
    const [r, g, b] = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255];
    const max = Math.max(r, g, b);
    const delta = max - Math.min(r, g, b);
    if (max < .18 || max > .97 || delta / max < .16) continue;
    const hue = max === r ? (g - b) / delta : max === g ? 2 + (b - r) / delta : 4 + (r - g) / delta;
    votes[Math.floor(((hue * 60 + 360) % 360) / 30)] += delta;
  }
  const ranked = [...votes.keys()].sort((a, b) => votes[b] - votes[a]);
  const primary = ranked[0];
  if (votes[primary] < .3) return fallback;
  const secondary = ranked.find(index => {
    const gap = Math.abs(primary - index);
    return gap >= 2 && gap <= 10 && votes[index] > votes[primary] * .26;
  });
  const hue = primary * 30 + 15;
  return [hue, secondary === undefined ? (hue + 64) % 360 : secondary * 30 + 15, hue];
}

export function openAuraPreview(transport: PreviewTransport) {
  const dialog = document.createElement("dialog");
  dialog.className = "aura-demo";
  dialog.setAttribute("aria-label", "Pantalla musical animada · preview");
  dialog.innerHTML = `
    <header><p class="aura-demo-date"></p><p class="aura-demo-clock"></p></header>
    <button class="aura-demo-button aura-demo-close" aria-label="Volver a MURMUR">${icon("close")}</button>
    <div class="aura-demo-stage"><canvas aria-hidden="true"></canvas></div>
    <section class="aura-demo-info">
      <h1></h1><p class="aura-demo-artist"></p>
      <input type="range" min="0" max="1" step="0.1" value="0" aria-label="Posición de reproducción">
      <div class="aura-demo-times"><span></span><span></span></div>
      <div class="aura-demo-transport">
        <button class="aura-demo-button" aria-label="Anterior">${icon("back")}</button>
        <button class="aura-demo-button aura-demo-play" aria-label="Reproducir">${icon("play")}</button>
        <button class="aura-demo-button" aria-label="Siguiente">${icon("next")}</button>
      </div>
      <p class="aura-demo-note">Vista previa · Pulso simulado</p>
    </section>`;
  const get = <T extends HTMLElement = HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
  const canvas = get<HTMLCanvasElement>("canvas");
  const context = canvas.getContext("2d", { alpha: true })!;
  const stage = get(".aura-demo-stage");
  const position = get<HTMLInputElement>("input");
  const progress = get(".aura-demo-times span:first-child");
  const duration = get(".aura-demo-times span:last-child");
  const play = get<HTMLButtonElement>(".aura-demo-play");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  let hues = fallback;
  let previousHues = fallback;
  let imageAt = 0;
  let artworkKey: string | undefined;
  let raf = 0;
  let phase = .7;
  let beatTime = 0;
  let last = 0;
  let movingSeek = false;
  const resize = new ResizeObserver(() => {
    const px = Math.min(devicePixelRatio, 2);
    canvas.width = Math.max(1, Math.round(stage.clientWidth * px));
    canvas.height = Math.max(1, Math.round(stage.clientHeight * px));
    context.setTransform(px, 0, 0, px, 0, 0);
  });
  function update() {
    const { track, playing, positionMs } = transport.read();
    get("h1").textContent = track.title;
    get(".aura-demo-artist").textContent = track.artist;
    get(".aura-demo-date").textContent = dateFormat.format(new Date());
    get(".aura-demo-clock").textContent = clockFormat.format(new Date());
    const label = playing ? "Pausar" : "Reproducir";
    if (play.getAttribute("aria-label") !== label) {
      play.setAttribute("aria-label", label);
      play.innerHTML = icon(playing ? "pause" : "play");
    }
    if (!movingSeek) {
      position.max = String(track.duration || 1);
      position.value = String(positionMs / 1000);
      progress.textContent = time(positionMs);
    }
    duration.textContent = time(track.duration * 1000);
    if (artworkKey !== track.artworkUrl) {
      artworkKey = track.artworkUrl;
      const pending = new Image();
      const key = artworkKey;
      pending.onload = () => {
        if (key !== artworkKey || !dialog.open) return;
        previousHues = hues;
        hues = huesFor(pending);
        imageAt = performance.now();
      };
      if (track.artworkUrl) pending.src = track.artworkUrl;
    }
  }

  function draw(now: number) {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const current = transport.read();
    const dt = last ? Math.min((now - last) / 1000, .05) : 0;
    last = now;
    const motion = !reduced.matches;
    if (motion && current.playing) {
      phase += dt * .87;
      beatTime += dt;
    }
    const beat = motion && current.playing ? Math.exp(-(beatTime % .5) / .093) : 0;
    const sweep = phase * .57;
    const t = motion ? Math.min(1, (now - imageAt) / 630) : 1;
    const blend = t * t * (3 - 2 * t);
    context.clearRect(0, 0, w, h);
    const paint = (palette: number[], alpha: number) => {
      const light = (index: number, x: number, y: number, sx: number, sy: number, angle: number, opacity: number) => {
        context.save();
        context.translate(w * x, h * y);
        context.rotate(angle * Math.PI / 180);
        context.scale(w * sx, h * sy);
        const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
        const hue = palette[index];
        const color = index === 2 ? `hsl(${hue} 95% 82%` : `hsl(${hue} 94% 61%`;
        for (const [stop, level] of [[0,1],[.26,.69],[.53,.26],[.76,.046],[1,0]]) {
          gradient.addColorStop(stop, color + ` / ${level})`);
        }
        context.globalAlpha = opacity * alpha;
        context.fillStyle = gradient;
        context.fillRect(-1, -1, 2, 2);
        context.restore();
      };
      light(1, .5 + .19 * Math.cos(sweep * .9), .35, .88 + beat * .20, .41,
        -35 + 15 * Math.sin(sweep), .56 + beat * .22);
      light(0, .4 + .16 * Math.sin(sweep), .6 + .13 * Math.cos(sweep), .91 + beat * .19, .47,
        -39 + 21 * Math.cos(sweep * .8), .78 + beat * .17);
      light(2, .42 + .25 * Math.sin(sweep * .87 + .5), .55 + .1 * Math.sin(sweep), .63 + beat * .23, .18 + beat * .12,
        -34 + 21 * Math.cos(sweep * .8), .46 + beat * .43);
    };
    if (blend < 1) paint(previousHues, 1);
    paint(hues, blend);
    const shade = context.createLinearGradient(0, 0, 0, Math.max(1, h));
    shade.addColorStop(0, "#05060b");
    shade.addColorStop(.24, "#05060b00");
    shade.addColorStop(.72, "#05060b03");
    shade.addColorStop(1, "#05060b");
    context.fillStyle = shade;
    context.fillRect(0, 0, w, h);
    raf = reduced.matches ? 0 : requestAnimationFrame(draw);
  }

  get(".aura-demo-close").onclick = () => dialog.close();
  play.onclick = () => { transport.toggle(); update(); };
  get('[aria-label="Anterior"]').onclick = () => { transport.previous(); update(); };
  get('[aria-label="Siguiente"]').onclick = () => { transport.next(); update(); };
  position.onpointerdown = () => { movingSeek = true; };
  position.oninput = () => { progress.textContent = time(Number(position.value) * 1000); };
  position.onchange = () => { movingSeek = false; transport.seek(Number(position.value)); update(); };
  position.onpointercancel = () => { movingSeek = false; update(); };
  dialog.addEventListener("keydown", event => {
    if (event.key === "Escape" || event.key === "Tab") event.stopPropagation();
  });
  dialog.addEventListener("close", () => {
    cancelAnimationFrame(raf);
    clearInterval(poll);
    resize.disconnect();
    dialog.remove();
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  update();
  resize.observe(stage);
  const poll = setInterval(() => {
    update();
    if (reduced.matches) draw(performance.now());
    else if (!raf) raf = requestAnimationFrame(draw);
  }, 200);
  raf = requestAnimationFrame(draw);
}
