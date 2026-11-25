/**
 * "Entrena tu voz": the three takes of «Ok MURMUR» behind «Solo mi voz», as a small state machine
 * the sheet renders. The phone records and judges each take; this only decides what to show next.
 */
export const ENROLL_TAKES = 3;

export type EnrollPhase = "preparing" | "ready" | "listening" | "checking" | "done" | "unavailable";

export interface EnrollState {
  phase: EnrollPhase;
  /** Take being asked for, 1 to ENROLL_TAKES. */
  take: number;
  /** Takes accepted so far. */
  accepted: number;
  /** The microphone is really open (the phone said so): safe to speak. */
  live: boolean;
  /** How the last take went, shown under the microphone. */
  feedback?: { kind: "success" | "error"; message: string };
}

export type EnrollAction =
  | { type: "prepared" }
  | { type: "unavailable"; message: string }
  | { type: "retryPrepare" }
  | { type: "listen" }
  | { type: "live" }
  | { type: "checking" }
  | { type: "result"; ok: boolean; done?: boolean; restart?: boolean; message?: string }
  | { type: "restart" };

export const initialEnroll: EnrollState = { phase: "preparing", take: 1, accepted: 0, live: false };

const PRAISE = ["¡Bien! Una vez más.", "Perfecto. Solo falta una."];

export function enrollReducer(state: EnrollState, action: EnrollAction): EnrollState {
  switch (action.type) {
    case "prepared":
      return state.phase === "preparing" ? { ...state, phase: "ready" } : state;
    case "unavailable":
      return { ...state, phase: "unavailable", live: false, feedback: { kind: "error", message: action.message } };
    case "retryPrepare":
      return state.phase === "unavailable" ? { ...initialEnroll } : state;
    case "listen":
      return state.phase === "ready" ? { ...state, phase: "listening", live: false, feedback: undefined } : state;
    case "live":
      return state.phase === "listening" ? { ...state, live: true } : state;
    case "checking":
      return state.phase === "listening" ? { ...state, phase: "checking", live: false } : state;
    case "result": {
      if (state.phase !== "listening" && state.phase !== "checking") return state;
      if (action.ok && action.done) return { phase: "done", take: ENROLL_TAKES, accepted: ENROLL_TAKES, live: false };
      if (action.ok) {
        const accepted = Math.min(state.take, ENROLL_TAKES - 1);
        return {
          phase: "ready",
          take: accepted + 1,
          accepted,
          live: false,
          feedback: { kind: "success", message: PRAISE[accepted - 1] ?? PRAISE[0] },
        };
      }
      const message = action.message || "No salió bien. Inténtalo otra vez.";
      if (action.restart) return { phase: "ready", take: 1, accepted: 0, live: false, feedback: { kind: "error", message } };
      return { ...state, phase: "ready", live: false, feedback: { kind: "error", message } };
    }
    case "restart":
      return { phase: "ready", take: 1, accepted: 0, live: false };
  }
}

/** What the sheet says under the microphone when there is no feedback to show. */
export function enrollPrompt(state: EnrollState): string {
  switch (state.phase) {
    case "preparing":
      return "Preparando…";
    case "ready":
      return "Toca el micrófono y di «Ok MURMUR»";
    case "listening":
      return state.live ? "Te escucho: di «Ok MURMUR»" : "Un momento…";
    case "checking":
      return "Comprobando…";
    case "done":
      return "Listo: MURMUR solo responderá a tu voz";
    case "unavailable":
      return "«Solo mi voz» no pudo prepararse.";
  }
}

/** Microphone level (RMS of 16-bit samples) as 0..1 on a log scale: a whisper ~0.2, a clear voice ~0.8. */
export function micLevel(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  const decibels = 20 * Math.log10(Math.min(rms, 32768) / 32768);
  return Math.max(0, Math.min(1, (decibels + 55) / 40));
}
