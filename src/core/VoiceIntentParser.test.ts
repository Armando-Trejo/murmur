import { describe, it, expect } from "vitest";
import { parseVoiceIntent, stripInvocation } from "./VoiceIntentParser";
describe("MURMUR VoiceIntentParser", () => {
  it.each([
    "Murmur, siguiente canción, por favor.",
    "por favor siguiente canción",
    "Next track please",
  ])("handles polite spoken transport %s", (text) =>
    expect(parseVoiceIntent(text)).toEqual({ type: "next" }),
  );
  it("recognizes reanudar", () =>
    expect(parseVoiceIntent("Murmur reanudar")).toEqual({ type: "resume" }));
  it.each([
    "murmur",
    "mur mur",
    "múrmur",
    "mormor",
    "oye murmur",
    "ok murmur",
    "hey murmur",
    "oye mur mur",
    "OK, MÚRMUR:",
  ])("recognizes invocation %s", (prefix) =>
    expect(parseVoiceIntent(prefix + " pon misfits")).toEqual({
      type: "artist",
      query: "misfits",
    }),
  );
  it("accepts hardware-triggered commands without invocation", () =>
    expect(parseVoiceIntent("Siguiente")).toEqual({ type: "next" }));
  it("recognizes requested mix command", () =>
    expect(parseVoiceIntent("múrmur mezcla ahora")).toEqual({ type: "mix" }));
  it("forces concerts onto YouTube", () =>
    expect(parseVoiceIntent("pon el concierto de caifanes en vivo")).toEqual({
      type: "youtube",
      query: "caifanes en vivo live",
    }));
  it("recognizes en vivo wording", () =>
    expect(parseVoiceIntent("Murmur pon en vivo de Misfits").type).toBe(
      "youtube",
    ));
  it("resolves a named song and artist", () =>
    expect(parseVoiceIntent("Murmur reproduce Afuera de Caifanes")).toEqual({
      type: "track",
      query: "afuera caifanes",
      title: "afuera",
      artist: "caifanes",
    }));
  it("supports English song commands", () =>
    expect(parseVoiceIntent("hey murmur play Halloween by Misfits").type).toBe(
      "track",
    ));
  it.each([
    ["anterior", "previous"],
    ["pausa", "pause"],
    ["guarda esta canción", "save"],
    ["mezcla ahora", "mix"],
    ["next track", "next"],
    ["resume", "resume"],
  ])("routes transport %s", (text, type) =>
    expect(parseVoiceIntent("murmur " + text).type).toBe(type),
  );
  it("matches playlist names with accents", () =>
    expect(
      parseVoiceIntent("Murmur pon mi playlist musica oscura", [
        { id: "p1", title: "Música oscura" },
      ]),
    ).toEqual({ type: "playlist", id: "p1" }));
  it("allows fuzzy playlist recognition", () =>
    expect(
      parseVoiceIntent("pon mi playlist noche oscurra", [
        { id: "p1", title: "Noche oscura" },
      ]),
    ).toEqual({ type: "playlist", id: "p1" }));
  it("does not invent an unknown playlist", () =>
    expect(
      parseVoiceIntent("pon mi playlist desconocida", [
        { id: "p1", title: "Rock" },
      ]).type,
    ).toBe("unknown"));
  it("routes any requested vibe", () =>
    expect(
      parseVoiceIntent("murmur pon algo oscuro y rápido para manejar"),
    ).toEqual({ type: "vibe", query: "oscuro y rapido para manejar" }));
  it("does not strip artist names that contain the invocation", () =>
    expect(stripInvocation("reproduce murmur")).toBe("reproduce murmur"));
  it.each(["", "murmur", "qué hora es", "borra toda mi biblioteca"])(
    "rejects unsupported commands: %s",
    (text) => expect(parseVoiceIntent(text).type).toBe("unknown"),
  );
  it("takes the platform the user asks for", () => {
    expect(parseVoiceIntent("ok murmur pon bailarina de miranda en spotify")).toMatchObject({
      type: "track", title: "bailarina", artist: "miranda", platform: "spotify" });
    expect(parseVoiceIntent("pon enjambre desde youtube music")).toMatchObject({ type: "artist", query: "enjambre", platform: "youtube" });
    expect(parseVoiceIntent("pon bailarina de miranda")).not.toHaveProperty("platform", "spotify");
  });
  it("understands whole albums", () =>
    expect(parseVoiceIntent("pon el disco el segundo es mas de enjambre en youtube")).toMatchObject({
      type: "album", title: "el segundo es mas", artist: "enjambre", platform: "youtube" }));
});
