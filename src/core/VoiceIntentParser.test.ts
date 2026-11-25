import { describe, it, expect } from "vitest";
import { asksToPlay, misheardPlay, parseVoiceIntent, spokenContent, stripInvocation } from "./VoiceIntentParser";
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

describe("more natural requests (2.17)", () => {
  it.each([
    ["pon la canción holiday in cambodia", { type: "request", query: "holiday in cambodia", want: "song" }],
    ["ponme la de last caress", { type: "request", query: "last caress", want: "song" }],
    ["pon la de bailarina de miranda", { type: "track", title: "bailarina", artist: "miranda" }],
    ["pon el disco static age de misfits", { type: "album", title: "static age", artist: "misfits" }],
    ["pon algo de misfits", { type: "artist", query: "misfits" }],
    ["ponme otra de misfits", { type: "artist", query: "misfits", another: true }],
    ["ponme una canción de misfits", { type: "artist", query: "misfits" }],
    ["pon lo nuevo de misfits", { type: "latest", query: "misfits" }],
    ["pon lo último de caifanes", { type: "latest", query: "caifanes" }],
    ["pon lo más nuevo de king gizzard", { type: "latest", query: "king gizzard" }],
    ["pon el disco nuevo de enjambre", { type: "latest", query: "enjambre" }],
    ["pon el último disco de ween", { type: "latest", query: "ween" }],
    ["pon la nueva de miranda", { type: "latest", query: "miranda" }],
    ["pon las mejores de misfits", { type: "top", query: "misfits" }],
    ["pon los éxitos de caifanes", { type: "top", query: "caifanes" }],
    ["pon lo mejor de enjambre", { type: "top", query: "enjambre" }],
    ["ponme puros éxitos de los vaguens", { type: "top", query: "los vaguens" }],
    ["pon las más famosas de ween", { type: "top", query: "ween" }],
    ["pon las canciones más escuchadas de death grips", { type: "top", query: "death grips" }],
    ["pon los grandes éxitos de alejandro sanz", { type: "top", query: "alejandro sanz" }],
    ["pon mis favoritas", { type: "saved" }],
    ["ponme mis guardadas", { type: "saved" }],
    ["pon mi música", { type: "saved" }],
    ["pon mis canciones", { type: "saved" }],
    ["pon lo que me gusta", { type: "saved" }],
    ["pon lo que escuché ayer", { type: "history", when: "yesterday" }],
    ["pon la que estaba escuchando ayer", { type: "history", when: "yesterday" }],
    ["ponme lo que estaba escuchando", { type: "history", when: "recent" }],
    ["pon lo que oí hoy", { type: "history", when: "today" }],
  ])("%s", (text, expected) => expect(parseVoiceIntent(text)).toMatchObject(expected));

  it("«mi playlist X» also by sound", () =>
    expect(parseVoiceIntent("pon mi playlist jolidei", [{ id: "p1", title: "Holiday" }, { id: "p2", title: "Rock" }])).toEqual({ type: "playlist", id: "p1" }));

  it.each([
    ["échame algo de misfits", "artist"],
    ["rólame una de caifanes", "artist"],
    ["aviéntate con unas de enjambre", "artist"],
    ["ponte con algo de ween", "artist"],
    ["échate una de los vaguens", "artist"],
    ["dame algo de misfits", "artist"],
    ["a ver ponme misfits", "request"],
    ["a ver si me pones misfits", "request"],
    ["porfa pon misfits", "request"],
    ["ok pon misfits", "request"],
    ["órale ponme dead kennedys porfa", "request"],
  ])("colloquial: %s → %s", (text, type) => {
    expect(parseVoiceIntent(text).type).toBe(type);
    expect(asksToPlay(text)).toBe(true);
  });

  it("«dame un momento» is not a song", () => expect(parseVoiceIntent("dame un momento").type).toBe("unknown"));
  it("«otra de X» without a verb still asks for «pon»", () => expect(asksToPlay("otra de misfits")).toBe(false));
});

describe("wake phrase and misheard «pon» (2.17)", () => {
  it.each(["okay murmuro", "okay mur", "Okay muro", "okay murmu", "Ok MURMUR", "oye mur mur", "ok"])("«%s» says nothing else", (text) =>
    expect(spokenContent(text)).toBe(""));
  it.each([
    ["oye mur mur pon misfits", "pon misfits"],
    ["okay mur pon misfits", "pon misfits"],
    ["okay murmuro ponme algo de ween", "ponme algo de ween"],
  ])("«%s» → «%s»", (text, rest) => expect(stripInvocation(text)).toBe(rest));
  it("the wake phrase alone is not music", () => expect(parseVoiceIntent("okay murmuro").type).toBe("unknown"));
  it.each([
    ["Don Can you West", "can you west"],
    ["con kanye west", "kanye west"],
    ["Bon misfits", "misfits"],
    ["pon misfits", undefined],
    ["de lo de Roma", undefined],
    ["Costa sabes", undefined],
  ])("misheardPlay(%s) = %s", (text, rest) => expect(misheardPlay(text)).toBe(rest));
  it.each([
    "punkies de lizard wizard", "wizard", "deliciar wizard", "de lo de Roma", "lo de Román", "del primo", "te acuerdas",
    "bueno y cuál fue el personaje que más odiaste", "pero si tengo que separar", "Costa sabes", "Sí sí te escucha", "Don Can you West",
  ])("talk near the phone does not ask to play: %s", (text) => expect(asksToPlay(text)).toBe(false));
  it.each(["Pon King de lizard weiser", "Reproduce los backs", "Pon el álbum Avengers", "pon static age de misfits en youtube"])(
    "these do: %s", (text) => expect(asksToPlay(text)).toBe(true));
});
