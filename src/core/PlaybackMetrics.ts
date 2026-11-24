import type { Source } from "./types";

/** One explicit selection: from the tap to the engine confirming playback, or to its error. */
export interface PlaybackSample {
  source: Source;
  ms: number;
  at: number;
  ok: boolean;
  code?: string;
  transport?: string;
}
export interface SourceSummary {
  count: number;
  failures: number;
  p50?: number;
  p95?: number;
  lastCode?: string;
}

const KEY = "murmur.playbackMetrics.v1";
const LIMIT = 80;
const listeners = new Set<() => void>();
type MetricStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const memory = new Map<string, string>();
const fallback: MetricStore = {
  getItem: key => memory.get(key) ?? null,
  setItem: (key, value) => void memory.set(key, value),
  removeItem: key => void memory.delete(key),
};
function store(): MetricStore {
  try {
    return globalThis.localStorage ?? fallback;
  } catch {
    return fallback;
  }
}

export function percentile(values: number[], fraction: number) {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return Math.round(sorted[index]);
}

export function summarize(samples: PlaybackSample[]): Record<Source, SourceSummary> {
  const result = {} as Record<Source, SourceSummary>;
  for (const source of ["youtube", "spotify"] as Source[]) {
    const own = samples.filter(sample => sample.source === source);
    const times = own.filter(sample => sample.ok).map(sample => sample.ms);
    const failed = own.filter(sample => !sample.ok);
    result[source] = {
      count: own.length,
      failures: failed.length,
      p50: percentile(times, 0.5),
      p95: percentile(times, 0.95),
      lastCode: failed.at(-1)?.code,
    };
  }
  return result;
}

/** Error codes only: messages can carry URLs or account details and stay out of reports. */
export function sanitizeCode(code: unknown) {
  return typeof code === "string" ? code.replace(/[^A-Z0-9_]/gi, "").slice(0, 40).toUpperCase() || undefined : undefined;
}

export function readSamples(storage: Pick<Storage, "getItem"> = store()): PlaybackSample[] {
  try {
    const parsed = JSON.parse(storage.getItem(KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter(s => s && (s.source === "youtube" || s.source === "spotify") && Number.isFinite(s.ms) && Number.isFinite(s.at))
      : [];
  } catch {
    return [];
  }
}

export function recordSample(sample: PlaybackSample, storage: Pick<Storage, "getItem" | "setItem"> = store()) {
  try {
    const samples = [...readSamples(storage), { ...sample, ms: Math.round(sample.ms), code: sanitizeCode(sample.code) }].slice(-LIMIT);
    storage.setItem(KEY, JSON.stringify(samples));
  } catch {
    /* Metrics never interfere with playback. */
  }
  listeners.forEach(listener => listener());
}

export function clearSamples(storage: Pick<Storage, "removeItem"> = store()) {
  try {
    storage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  listeners.forEach(listener => listener());
}

export function onSamples(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * Tracks the selection the user is waiting for. Only the newest selection is measured; a
 * newer tap supersedes it so a late confirmation can never be credited to another entry.
 */
export class SelectionTimer {
  private pending?: { queueId: string; source: Source; started: number; transport?: string };
  constructor(private now: () => number = () => performance.now(), private record = recordSample) {}
  start(queueId: string | undefined, source: Source, transport?: string) {
    this.pending = queueId ? { queueId, source, started: this.now(), transport } : undefined;
  }
  observe(state: { queueId?: string; playing: boolean; loading: boolean; error?: string; errorCode?: string }) {
    const pending = this.pending;
    if (!pending) return;
    if (state.queueId !== pending.queueId) {
      this.pending = undefined;
      return;
    }
    if (state.error) {
      this.pending = undefined;
      this.record({ source: pending.source, ms: this.now() - pending.started, at: Date.now(), ok: false, code: state.errorCode || "PLAYBACK_FAILED", transport: pending.transport });
    } else if (state.playing && !state.loading) {
      this.pending = undefined;
      this.record({ source: pending.source, ms: this.now() - pending.started, at: Date.now(), ok: true, transport: pending.transport });
    }
  }
  cancel() {
    this.pending = undefined;
  }
}
