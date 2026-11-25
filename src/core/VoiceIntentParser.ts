import { normalize } from "./FanUploadParser";
import { similarity } from "./SourceResolver";
export type Platform = "spotify" | "youtube";
export type VoiceIntent =
  | { type: "mix" | "next" | "previous" | "save" | "pause" | "resume" | "nowPlaying" | "moreLikeThis" | "shuffle" }
  | { type: "playlist"; id: string }
  | { type: "youtube" | "vibe"; query: string }
  | { type: "artist"; query: string; platform?: Platform }
  | { type: "album"; query: string; title: string; artist?: string; platform?: Platform }
  /** `said` keeps the words as spoken ("vamonos de viaje"): the catalogue decides if "de" splits title and artist. */
  | { type: "track"; query: string; title: string; artist: string; platform?: Platform; said?: string; exact?: boolean }
  /** Anything else that sounds like music: resolved against the catalogues (song, artist or album). */
  /** `strict`: said without a verb; plays only if the catalogue clearly confirms it. */
  | { type: "request"; query: string; platform?: Platform; strict?: boolean }
  | { type: "unknown" };

export function stripInvocation(text: string) {
  return normalize(text)
    .replace(
      /^(?:(?:oye|ok|okey|okay|hey|o que)\s+)?(?:murmur\w*|mur\s+mur\w*|mormor|mor\s+mur)(?:\s+|$)/,
      "",
    )
    .trim();
}

/**
 * How speech recognizers (Google online, the phone's own, the offline Vosk model) actually write
 * the platform names in Spanish. Matched as whole words after normalize().
 */
const SPOTIFY = "(?:spotify|spotifai|spotifay|espotify|espotifai|es potify|spoti|spotyfi|spotifi)";
const YOUTUBE = "(?:youtube music|you tube music|youtube|you tube|yutub|yutubmusic|yutu|youtub|yt music)";
const PLATFORM = `(?:(?:en|desde|de|por|con|on|from|usando|via)\\s+(?:el\\s+)?)?(${SPOTIFY}|${YOUTUBE})`;
const platformOf = (word: string): Platform => (new RegExp(`^${SPOTIFY}$`).test(word) ? "spotify" : "youtube");

/** The platform the user asked for, anywhere in the sentence ("pon en Spotify X", "X de YouTube"). */
export function splitPlatform(text: string): { text: string; platform?: Platform } {
  const match = text.match(new RegExp(`(?:^|\\s)${PLATFORM}(?=\\s|$)`));
  if (!match) return { text };
  const rest = (text.slice(0, match.index) + " " + text.slice(match.index! + match[0].length)).replace(/\s+/g, " ").trim();
  return { text: rest, platform: platformOf(match[1]) };
}

/** Courtesy and filler words people add before a request; they carry no meaning for MURMUR. */
const FILLER = /^(?:(?:por favor|porfa|please|oye|bueno|a ver|ahora|mejor|y|ya)\s+)+/;
const ASK = /^(?:(?:me |nos )?(?:puedes|podrias|quieres|quisiera|quiero|queremos|deseo|me gustaria|necesito|vamos a|hay que|me late|me laten|se me antoja|tengo ganas de|ando con ganas de|me apetece|me dan ganas de|antojo de)\s+)+/;
/** Every way of saying "play" (with the pronouns Spanish glues to it). */
const PLAY = /^(?:(?:me |nos )?(?:pones|pondrias|pondras|pon(?:me|nos|le|la|lo)?|ponga|poner(?:me)?|reproduc(?:e|eme|ir|elo|ela)|toca(?:me|r)?|escuchar|oir|play|dale play a|dale play|busca(?:me|r)?|encuentra(?:me)?|suena|que suene|mete(?:me)?|agrega(?:me)?|manda(?:me)?|ponte|oir|escuche|escuchemos|reproduzcas|toques))\s+/;

/** What a control can act on, optional: "la música", "esta canción", "la reproducción". */
const MUSIC_OBJECT = "(?: (?:(?:la|el|esta|esa|este|ese) )?(?:musica|cancion|rola|reproduccion|audio|tema|rolita))?";
const A_MOMENT = "(?: (?:tantito|un momento|un rato|un segundo|ahorita|por ahora))?";

const TRANSPORT: [RegExp, VoiceIntent["type"]][] = [
  [/^(?:mezcla ahora|mezclar ahora|mezclala|mix now|haz la mezcla|cruzala)$/, "mix"],
  [/^(?:(?:la )?siguiente|next|salta(?:la|te)?|skip|pasa(?:la|le)?|cambia(?:la|le)?|otra|la que sigue|adelanta(?:la)?|no me gusta(?: esta)?|quita(?: esta|la)?)(?: cancion| track| rola| tema)?$/, "next"],
  [/^(?:(?:la )?anterior|previous|go back|vuelve|regresa(?:la)?|atras|la de antes|repite(?:la)?(?: la anterior)?)(?: cancion| track| rola| tema)?$/, "previous"],
  [/^(?:guarda(?:la|r)?|save|me gusta(?: mucho)?(?: esta)?|dale like|like|agrega(?:la)? a (?:mis )?(?:favoritas|favoritos|guardadas|mi biblioteca)|me encanta(?: esta)?)(?: esta| this)?(?: cancion| song| track| rola)?$/, "save"],
  // "Para", "pausa la música", "detén la canción un momento", "ponle pausa".
  [new RegExp(`^(?:pausa(?:la|lo)?|pausar|pause|detente|deten(?:la|lo|er)?|para(?:la|le|lo|r)?|alto|stop|silencio|callate|apaga(?:la|lo)?|quita la musica|pon(?:le)? pausa|ya no)${MUSIC_OBJECT}${A_MOMENT}$`), "pause"],
  // "Continúa", "sigue con la música", "reanuda la canción", "ponle play", "vuelve a ponerla".
  [new RegExp(`^(?:continua(?:r)?|reanuda(?:r|la|lo)?|resume|play|sigue|dale|seguir|reproduce|ponla|pon musica|quita la pausa|quitale la pausa|pon(?:le|la)? play|dale play|regresa la musica|vuelve a (?:ponerla|sonar|poner la musica)|sigue sonando)(?: con)?${MUSIC_OBJECT}$`), "resume"],
  [/^(?:que (?:cancion|rola|tema) es(?: esta| esto)?|que (?:esta sonando|suena|estoy escuchando)|como se llama(?: esta)?(?: cancion| rola)?|quien canta(?: esta)?)$/, "nowPlaying"],
  [/^(?:(?:pon |quiero )?(?:mas|algo) (?:como|parecido a|similar a) (?:esta|esto)|mas de esto|radio de esta|haz(?:me)? un mix con esta)$/, "moreLikeThis"],
  [/^(?:aleatorio|modo aleatorio|revuelve(?:la|las)?|mezcla(?: las canciones)?|shuffle|aleatorio magico)$/, "shuffle"],
];

/** Words that, inside a short sentence, are enough to know the action. */
const LOOSE: [RegExp, VoiceIntent["type"]][] = [
  [/\b(?:que cancion|que rola|que tema|como se llama|quien canta|que suena|que esta sonando)\b/, "nowPlaying"],
  [/\b(?:anterior|regresa\w*|atras|la de antes|la pasada)\b/, "previous"],
  [/\b(?:siguiente|que sigue|pasale|pasala|salta\w*|cambia\w*|adelanta\w*|otra cancion|otra rola|skip|next)\b/, "next"],
  [/\b(?:pausa\w*|parale|detente|deten\w*|stop|silencio|callate)\b/, "pause"],
  // "Para" alone is also "for"; only with the music after it is it a stop ("oye para la música").
  [/\b(?:para(?:la|le|lo)?|apaga(?:la)?) (?:(?:la|el|esta|esa) )?(?:musica|cancion|rola|reproduccion)\b/, "pause"],
  [/\b(?:guardala|guarda esta|me gusta esta|me encanta esta|dale like|a favoritos|a mis favoritas)\b/, "save"],
  [/\b(?:aleatorio|revuelve\w*|shuffle)\b/, "shuffle"],
  [/\b(?:parecid\w+|similar\w*|como esta|mas de esto)\b/, "moreLikeThis"],
  [/\b(?:continua\w*|reanuda\w*|quita(?:le)? la pausa|sigue sonando|dale play|ponle play|sigue (?:con )?(?:la )?(?:musica|cancion))\b/, "resume"],
];

/**
 * True when the words ask for music explicitly: a verb ("pon", "reproduce", "quiero escuchar"),
 * a wish ("quiero", "se me antoja") or a platform ("… en Spotify"). Without one, a sentence that
 * merely sounds like a title ("la casa de mi mamá") is not played: MURMUR asks for "pon" instead.
 */
export function asksToPlay(text: string) {
  const n = stripInvocation(text).replace(FILLER, "").trim();
  if (ASK.test(n)) return true;
  const rest = n.replace(ASK, "");
  return PLAY.test(rest + " ") || splitPlatform(rest).platform !== undefined;
}

/** What is left of a request once the verbs and the filler are gone: the music itself. */
export function musicQuery(text: string) {
  return text
    .replace(/^(?:(?:una|un|la|el|unas|unos|las|los|alguna|algun|mi)\s+)?(?:cancion(?:cita)?|rola|tema|song|track|pieza|musica|canciones|rolas|temas)\s+(?:que se llama\s+|llamada\s+|llamado\s+)?/, "")
    .replace(/^(?:esa|esta|aquella)\s+(?:que (?:dice|se llama)\s+)?/, "")
    .replace(/\s+(?:ahora|ahorita|ya|un rato|tantito|porfa|por favor|please|si puedes|para mi)$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseVoiceIntent(
  text: string,
  playlists: { id: string; title: string }[] = [],
): VoiceIntent {
  let n = stripInvocation(text)
    .replace(FILLER, "")
    .replace(ASK, "")
    .replace(/\s+(?:por favor|porfa|please)$/, "")
    .trim();
  for (const [pattern, type] of TRANSPORT)
    if (pattern.test(n)) return { type } as VoiceIntent;
  // Colloquial control: short sentences that mention the action anywhere
  // ("ya pásale a la que sigue", "oye párale tantito", "regrésate a la otra").
  if (!PLAY.test(n + " ") && n.split(" ").length <= 7) {
    for (const [pattern, type] of LOOSE) if (pattern.test(n)) return { type } as VoiceIntent;
  }
  const split = splitPlatform(n);
  n = split.text;
  const platform = split.platform;
  const verb = n.match(PLAY);
  if (/^(?:algo |mas |musica |canciones |rolas )?(?:parecid\w*|similar\w*|como esta|del estilo de esta|asi)\b/.test(n.slice(verb?.[0].length ?? 0)))
    return { type: "moreLikeThis" };
  // "Algo de Miranda", "música de Enjambre": the artist, not one song.
  let what = musicQuery(verb ? n.slice(verb[0].length) : n);
  const artistOnly = /^(?:algo|musica|canciones|rolas|temas|lo que sea|cualquier cosa|puro|pura|puras|puros|exitos|lo mejor) (?:de|del)\s+/.test(what);
  if (artistOnly) what = what.replace(/^\S+(?: \S+)? (?:de|del)\s+/, "").replace(/^(?:lo mejor|lo que sea|cualquier cosa) (?:de|del)\s+/, "");
  what = what.replace(/^(?:a|al)\s+(?=\S)/, "").trim();
  if (!what) return verb ? { type: "resume" } : { type: "unknown" };
  // Without a verb only something that clearly names music counts (a song "de" an artist, a platform…).
  // (Only things people say near a phone that are clearly not music are refused here.)
  if (!verb && /^(?:que hora|cual es|como esta|borra|elimina|desinstala|cancela|configura|llama|marca|manda|envia|mensaje|alarma|recuerdame|clima|que dia|abre|apaga la luz|cuanto)/.test(what))
    return { type: "unknown" };

  const playlist = what.match(/^(?:mi |my |la )?(?:playlist|lista(?: de reproduccion)?) (?:de |llamada |que se llama )?(.+)$/);
  if (playlist) {
    const p =
      playlists.find((p) => normalize(p.title) === playlist[1]) ??
      playlists.find((p) => similarity(p.title, playlist[1]) > 0.75);
    if (p) return { type: "playlist", id: p.id };
    if (/^(?:mi|my) /.test(what)) return { type: "unknown" };
  }
  const video = what.match(/^(?:el |the |un )?(?:video|concierto|concert|en vivo|live|directo) (?:de |of |del )?(.+)$/);
  if (video) return { type: "youtube", query: video[1] + " live" };
  const album = what.match(/^(?:el |la |un |todo el )?(?:album|disco|lp|ep|albun|alboom) (?:completo |entero )?(?:que se llama |llamado )?(?:de |del )?(.+?)(?: (?:de|by|del) (.+))?$/);
  if (album)
    return { type: "album", query: [album[1], album[2]].filter(Boolean).join(" "), title: album[1], artist: album[2], platform };
  const vibe = what.match(/^(?:algo|something|una playlist|un mix|musica|ambiente) (?:para |pa |tipo |con |que sea |bien |de onda |medio )?(?!de |del )(.+)$/);
  if (vibe && !artistOnly) return { type: "vibe", query: vibe[1] };
  if (artistOnly) return { type: "artist", query: what, platform };
  // "(una rola) de Miranda que se llama Bailarina" / "la que se llama Bailarina de Miranda".
  const named = what.match(/^(?:de|del) (.+?) que se llama (.+)$/);
  if (named) return { type: "track", query: `${named[2]} ${named[1]}`, title: named[2], artist: named[1], platform, said: `${named[2]} de ${named[1]}` };
  const song = what.replace(/^(?:la |el )?que se llama /, "").match(/^(.+?) (?:de|by|del) (.+)$/);
  if (song)
    return {
      type: "track",
      query: `${song[1]} ${song[2]}`,
      title: song[1],
      artist: song[2],
      platform,
      said: what.replace(/^(?:la |el )?que se llama /, ""),
    };
  // Without a verb (or a platform), a single word is too likely to be something else.
  if (!verb && !platform && what.split(" ").length < 2) return { type: "unknown" };
  return { type: "request", query: what, platform, ...(verb || platform ? {} : { strict: true }) };
}
