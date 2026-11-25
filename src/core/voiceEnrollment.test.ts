import { describe, expect, it } from "vitest";
import { ENROLL_TAKES, enrollPrompt, enrollReducer, initialEnroll, micLevel, type EnrollAction, type EnrollState } from "./voiceEnrollment";

const run = (actions: EnrollAction[], from: EnrollState = initialEnroll) => actions.reduce(enrollReducer, from);
const ready = run([{ type: "prepared" }]);

describe("Entrena tu voz", () => {
  it("walks through three accepted takes to done", () => {
    let state = ready;
    expect(state).toMatchObject({ phase: "ready", take: 1, accepted: 0 });
    state = run([{ type: "listen" }, { type: "live" }, { type: "checking" }, { type: "result", ok: true }], state);
    expect(state).toMatchObject({ phase: "ready", take: 2, accepted: 1, feedback: { kind: "success" } });
    state = run([{ type: "listen" }, { type: "result", ok: true }], state);
    expect(state).toMatchObject({ phase: "ready", take: 3, accepted: 2 });
    state = run([{ type: "listen" }, { type: "checking" }, { type: "result", ok: true, done: true }], state);
    expect(state).toMatchObject({ phase: "done", take: ENROLL_TAKES, accepted: ENROLL_TAKES });
    expect(enrollPrompt(state)).toBe("Listo: MURMUR solo responderá a tu voz");
  });

  it("keeps the take after a failed attempt and shows why", () => {
    const state = run([{ type: "listen" }, { type: "result", ok: true }, { type: "listen" },
      { type: "result", ok: false, message: "No reconocí «Ok MURMUR»." }], ready);
    expect(state).toMatchObject({ phase: "ready", take: 2, accepted: 1, feedback: { kind: "error", message: "No reconocí «Ok MURMUR»." } });
    // Without a message from the phone there is still something useful to read.
    expect(run([{ type: "listen" }, { type: "result", ok: false }], ready).feedback?.message).toMatch(/otra vez/);
  });

  it("starts over when the phone lost the earlier takes", () => {
    const state = run([{ type: "listen" }, { type: "result", ok: true }, { type: "listen" },
      { type: "result", ok: false, restart: true, message: "Empecemos de nuevo." }], ready);
    expect(state).toMatchObject({ phase: "ready", take: 1, accepted: 0 });
  });

  it("only speaks of listening once the microphone is really open", () => {
    const listening = run([{ type: "listen" }], ready);
    expect(enrollPrompt(listening)).toBe("Un momento…");
    expect(enrollPrompt(run([{ type: "live" }], listening))).toBe("Te escucho: di «Ok MURMUR»");
  });

  it("ignores taps and late events that do not belong to the current phase", () => {
    // A second tap while a take is recording does not start another.
    const listening = run([{ type: "listen" }], ready);
    expect(run([{ type: "listen" }], listening)).toBe(listening);
    // Results before the sheet is ready, or after it finished, change nothing.
    expect(run([{ type: "result", ok: true }], initialEnroll)).toBe(initialEnroll);
    expect(run([{ type: "live" }], ready)).toBe(ready);
    const done = run([{ type: "listen" }, { type: "result", ok: true, done: true }], ready);
    expect(run([{ type: "result", ok: false }], done)).toBe(done);
  });

  it("can retry when preparing failed", () => {
    const failed = run([{ type: "unavailable", message: "Sin conexión" }], initialEnroll);
    expect(failed).toMatchObject({ phase: "unavailable", feedback: { kind: "error", message: "Sin conexión" } });
    expect(run([{ type: "retryPrepare" }], failed)).toEqual(initialEnroll);
    expect(run([{ type: "restart" }], failed)).toMatchObject({ phase: "ready", take: 1, accepted: 0 });
  });
});

describe("micLevel", () => {
  it("maps microphone RMS to a calm 0..1 scale", () => {
    expect(micLevel(0)).toBe(0);
    expect(micLevel(-5)).toBe(0);
    expect(micLevel(Number.NaN)).toBe(0);
    expect(micLevel(150)).toBeGreaterThan(0.1);
    expect(micLevel(150)).toBeLessThan(0.3);
    expect(micLevel(3000)).toBeGreaterThan(0.75);
    expect(micLevel(32768)).toBe(1);
    expect(micLevel(99999)).toBe(1);
    expect(micLevel(600)).toBeLessThan(micLevel(1200));
  });
});
