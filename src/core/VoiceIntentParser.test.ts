import { describe, it, expect } from "vitest";
import { asksToPlay, parseVoiceIntent, stripInvocation } from "./VoiceIntentParser";
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
      type: "request",
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
    expect(parseVoiceIntent("Murmur reproduce Afuera de Caifanes")).toMatchObject({
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
    expect(parseVoiceIntent("pon enjambre desde youtube music")).toMatchObject({ type: "request", query: "enjambre", platform: "youtube" });
    expect(parseVoiceIntent("pon bailarina de miranda")).not.toHaveProperty("platform", "spotify");
  });
  it("understands whole albums", () =>
    expect(parseVoiceIntent("pon el disco el segundo es mas de enjambre en youtube")).toMatchObject({
      type: "album", title: "el segundo es mas", artist: "enjambre", platform: "youtube" }));
  it.each([
    ["oye murmur ya pasale a la que sigue", "next"],
    ["regresate a la anterior porfa", "previous"],
    ["parale tantito", "pause"],
    ["como se llama esta rola", "nowPlaying"],
    ["ponme algo parecido a esta", "moreLikeThis"],
    ["guardala en mis favoritas", "save"],
    ["revuelvelas", "shuffle"],
  ])("understands colloquial control: %s", (text, type) => expect(parseVoiceIntent(text).type).toBe(type));
  it.each([
    ["oye ponme una rola de miranda que se llama bailarina", "track"],
    ["quiero escuchar bailarina de miranda en spotify", "track"],
    ["me pones en youtube algo de enjambre", "artist"],
    ["ponme algo de los caifanes", "artist"],
    ["quisiera oir el disco completo de sin restricciones", "album"],
    ["reproduceme la cancion que se llama vamonos de viaje", "track"],
    ["ponme bailarina", "request"],
  ])("understands colloquial requests: %s", (text, type) => expect(parseVoiceIntent(text).type).toBe(type));
  it("keeps the platform wherever it is said", () => {
    expect(parseVoiceIntent("pon en spotify bailarina de miranda")).toMatchObject({ type: "track", platform: "spotify", title: "bailarina" });
    expect(parseVoiceIntent("desde youtube ponme enjambre")).toMatchObject({ platform: "youtube", query: "enjambre" });
    expect(parseVoiceIntent("pon bailarina en espotifai")).toMatchObject({ platform: "spotify", query: "bailarina" });
  });
});

describe("controls said with the music after them (2.15)", () => {
  it.each([
    ["para la música", "pause"],
    ["oye para la música", "pause"],
    ["pausa la canción", "pause"],
    ["detén la canción un momento", "pause"],
    ["ponle pausa", "pause"],
    ["apaga la música", "pause"],
    ["continúa con la música", "resume"],
    ["sigue con la música", "resume"],
    ["reanuda la canción", "resume"],
    ["ponle play", "resume"],
    ["dale play", "resume"],
    ["vuelve a ponerla", "resume"],
  ])("%s", (text, type) => expect(parseVoiceIntent(text).type).toBe(type));
  it("«para» alone keeps meaning «for» in a request", () =>
    expect(parseVoiceIntent("pon algo para trabajar").type).toBe("vibe"));
});

describe("asksToPlay: music only with an explicit ask", () => {
  it.each([
    ["pon bailarina de miranda", true],
    ["Ok MURMUR ponme algo de enjambre", true],
    ["quiero escuchar algo tranquilo", true],
    ["se me antoja bailarina", true],
    ["bailarina en spotify", true],
    ["bailarina de miranda", false],
    ["la casa de mi mamá", false],
    ["algo tranquilo para trabajar", false],
  ])("%s → %s", (text, expected) => expect(asksToPlay(text)).toBe(expected));
});

describe("sleep timer by voice (2.16)", () => {
  it.each([
    ["apaga la música en 20 minutos", 20],
    ["para en media hora", 30],
    ["duérmete en una hora y media", 90],
    ["pon un temporizador de 45 minutos", 45],
    ["temporizador de una hora", 60],
    ["Ok MURMUR apaga la música en diez minutos", 10],
    ["para la música en 2 horas", 120],
  ])("%s → %s min", (text, minutes) => expect(parseVoiceIntent(text)).toEqual({ type: "sleep", minutes }));
  it("when this song ends", () =>
    expect(parseVoiceIntent("apaga la música al terminar esta canción")).toEqual({ type: "sleep", minutes: "track" }));
  it("cancel", () => expect(parseVoiceIntent("cancela el temporizador")).toEqual({ type: "sleep", minutes: 0 }));
  it("a plain stop is still a pause", () => expect(parseVoiceIntent("para la música").type).toBe("pause"));
  it("a song title with numbers is not a timer", () =>
    expect(parseVoiceIntent("pon 20 minutos de los caifanes").type).not.toBe("sleep"));
});
