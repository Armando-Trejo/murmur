import { Audio, isNative } from "../native";

export type HapticKind = "tick" | "confirm" | "reject";
const KEY = "murmur.haptics";
let last = 0;

export function hapticsEnabled() {
  try {
    return globalThis.localStorage?.getItem(KEY) !== "false";
  } catch {
    return true;
  }
}

export function setHapticsEnabled(value: boolean) {
  try {
    globalThis.localStorage?.setItem(KEY, String(value));
  } catch {
    /* The preference falls back to the default. */
  }
}

/**
 * Light confirmation through Android's own haptic feedback, which honours the system
 * "touch feedback" setting. Calls closer than 40 ms collapse into one.
 */
export function haptic(kind: HapticKind = "tick") {
  if (!isNative || !hapticsEnabled()) return;
  const now = Date.now();
  if (now - last < 40) return;
  last = now;
  void Audio.haptic({ kind }).catch(() => {});
}
