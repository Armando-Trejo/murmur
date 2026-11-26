import { moodOf } from "./moods";
import { normalize } from "./FanUploadParser";
import { similarity } from "./SourceResolver";
import { soundsLike } from "./voicePhonetics";
export type Platform = "spotify" | "youtube";
export type VoiceIntent =
  | { type: "mix" | "next" | "previous" | "save" | "unsave" | "restart" | "surprise" | "pause" | "resume" | "nowPlaying" | "moreLikeThis" | "shuffle" }
  /** The phone's media volume: a few steps up or down, or a percentage. */
  | { type: "volume"; change: "up" | "down" | number }
  | { type: "playlist"; id: string }
  /** Sleep timer: minutes from now, "track" (when this song ends) or 0 (cancel). */
  | { type: "sleep"; minutes: number | "track" }
  | { type: "youtube"; query: string }
  | { type: "vibe"; query: string; mood?: string; extra?: string }
  /** `another`: "otra de X", a song by them other than the one playing. */
  | { type: "artist"; query: string; platform?: Platform; another?: boolean }
  /** "Las mejores de X" (their top songs) and "lo nuevo de X" (their latest release). */
  | { type: "top" | "latest"; query: string; platform?: Platform }
  /** "Mis favoritas", "mi música": the saved songs, shuffled. */
  | { type: "saved" }
  /** "Lo que escuché ayer": what played then, from the history. */
  | { type: "history"; when: "yesterday" | "today" | "recent" }
  | { type: "album"; query: string; title: string; artist?: string; platform?: Platform }
  /** `said` keeps the words as spoken ("vamonos de viaje"): the catalogue decides if "de" splits title and artist. */
  | { type: "track"; query: string; title: string; artist: string; platform?: Platform; said?: string; exact?: boolean }
  /** Anything else that sounds like music: resolved against the catalogues (song, artist or album). */
  /** `strict`: said without a verb; plays only if the catalogue clearly confirms it. */
  /** `want: "song"`: said as a song ("la canción X", "la de X"), never an artist or an album. */
  | { type: "request"; query: string; platform?: Platform; strict?: boolean; want?: "song" }
  | { type: "unknown" };

/**
 * The wake phrase as recognizers write it: "Ok MURMUR", "okay murmuro", "okay mur", "Okay muro",
 * "oye mur mur". After "ok"/"oye" any "mur…" is the name; alone, only clear spellings of it are.
 */
const WAKE = /^(?:(?:oye|ok|okey|okay|oki|hey|o que|o k)\s+(?:mur\s+mur\w*|murmu\w*|mor\s*mur\w*|mormor\w*|murmullo|muro|mur)|(?:murmur\w*|mur\s+mur\w*|mormor\w*|mor\s+mur\w*))(?:\s+|$)/;
export function stripInvocation(text: string) {
  return normalize(text).replace(WAKE, "").trim();
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
const FILLER = /^(?:(?:por favor|porfa|please|oye|bueno|a ver si|a ver|ahora|mejor|y|ya|ok|okay|okey|oki|orale|andale|sale|va|hey|entonces|pues)\s+)+/;
const ASK = /^(?:(?:me |nos )?(?:puedes|podrias|quieres|quisiera|quiero|queremos|deseo|me gustaria|necesito|vamos a|hay que|me late|me laten|se me antoja|tengo ganas de|ando con ganas de|me apetece|me dan ganas de|antojo de)\s+)+/;
/** Every way of saying "play" (with the pronouns Spanish glues to it). */
const PLAY = /^(?:(?:me |nos )?(?:pones|pondrias|pondras|pon(?:me|nos|le|la|lo)?|ponga|poner(?:me)?|reproduc(?:e|eme|ir|elo|ela)|toca(?:me|r)?|escuchar|oir|play|dale play a|dale play|busca(?:me|r)?|encuentra(?:me)?|suena|que suene|mete(?:me)?|agrega(?:me)?|manda(?:me)?|ponte(?: con)?|oir|escuche|escuchemos|reproduzcas|toques|echa(?:me|nos|le)?|echate(?: con)?|echale|echas|rola(?:me|nos)|rolate(?: con)?|avienta(?:me|nos)|avientate(?: con)?|lanzate(?: con)?|rifate(?: con)?|arrancate(?: con)?|da(?:me|nos)|regala(?:me|nos)|suelta(?:me|nos)?|tira(?:me|nos)))\s+/;

/** What a control can act on, optional: "la música", "esta canción", "la reproducción". */
const MUSIC_OBJECT = "(?: (?:(?:la|el|esta|esa|este|ese) )?(?:musica|cancion|rola|reproduccion|audio|tema|rolita))?";
const A_MOMENT = "(?: (?:tantito|un momento|un rato|un segundo|ahorita|por ahora))?";

/** "Súbele", "baja un poco el volumen", "más fuerte", "volumen al 50", "volumen al máximo". */
export function parseVolume(n: string): "up" | "down" | number | undefined {
  const t = n.replace(/\b(?:un poco|un poquito|tantito|mas bien|a la musica|a la cancion|la musica)\b/g, " ").replace(/\s+/g, " ").trim();
  if (/^(?:sube(?:le)?|subir|aumenta(?:le)?)(?: (?:el|al))?(?: volumen)?(?: mas)?$|^(?:mas (?:fuerte|alto|recio|volumen)|volumen arriba|no se oye|no se escucha)$/.test(t)) return "up";
  if (/^(?:baja(?:le)?|bajar|reduce)(?: (?:el|al))?(?: volumen)?(?: mas)?$|^(?:mas (?:bajo|bajito|quedito|suave)|menos volumen|volumen abajo|muy (?:fuerte|alto|recio))$/.test(t)) return "down";
  const set = t.match(/^(?:(?:pon(?:le)?|sube(?:le)?|baja(?:le)?) )?(?:el )?volumen (?:al?|en) (?:(\d{1,3})(?: por ciento)?|(maximo|tope|todo lo que da|la mitad|minimo))$|^(?:sube(?:le)?) (?:todo|al maximo|a todo lo que da)$/);
  if (!set) return undefined;
  if (set[1]) return Math.min(100, Number(set[1]));
  return set[2] === "la mitad" ? 50 : set[2] === "minimo" ? 10 : 100;
}

const TRANSPORT: [RegExp, VoiceIntent["type"]][] = [
  [/^(?:mezcla ahora|mezclar ahora|mezclala|mix now|haz la mezcla|cruzala)$/, "mix"],
  // "Repite esta canción", "ponla otra vez", "desde el principio".
  [/^(?:repite(?:la)?(?: (?:esta|esa))?|reinicia(?:la)?|(?:pon(?:la|le)? )?(?:otra vez|de nuevo)|(?:pon(?:la)? )?desde el (?:principio|inicio|comienzo)|empieza(?:la)? de nuevo|vuelve a empezar(?:la)?)(?: (?:la |esta |esa )?(?:cancion|rola|tema))?(?: (?:otra vez|de nuevo|desde el principio))?$/, "restart"],
  [/^(?:quita(?:la|r)?|saca(?:la)?|elimina(?:la)?|borra(?:la)?)(?: (?:esta|esa))?(?: (?:cancion|rola))? de (?:mis )?(?:favoritas|favoritos|guardadas|guardados|me gusta|likes)$|^quita(?:le)? (?:el |mi )?(?:like|me gusta|corazon)$/, "unsave"],
  [/^(?:sorprendeme|pon(?:me)? (?:algo|lo que sea|cualquier cosa|lo que quieras|musica aleatoria)|(?:pon(?:me)? )?algo de (?:mi musica|lo mio))$/, "surprise"],
  [/^(?:sigale|siguele|dale que siga|que siga(?: la musica)?)$/, "resume"],
  [/^(?:dame like|ponle (?:like|me gusta|corazon)|dale (?:me gusta|corazon)|ponla en (?:mis )?(?:favoritas|favoritos|me gusta))$/, "save"],
  [/^de quien es(?: (?:esta|esa))?(?: (?:cancion|rola))?$/, "nowPlaying"],
  [/^(?:pasa(?:le)?|cambia(?:le)?|salta(?:te)?|quita|siguiente) (?:a )?(?:la |esta |esa |de )?(?:cancion|track|rola|tema)$/, "next"],
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
  const n = spokenContent(text);
  if (ASK.test(n)) return true;
  const rest = n.replace(ASK, "");
  return PLAY.test(rest + " ") || splitPlatform(rest).platform !== undefined;
}

/** What was said once the wake phrase and the filler are gone ("" when it was only "Ok MURMUR"). */
export function spokenContent(text: string) {
  return stripInvocation(text).replace(FILLER, "").replace(/^(?:por favor|porfa|please|oye|ok|okay|bueno|hey)$/, "").trim();
}

/**
 * "Pon" misheard as "don", "con" or "bon" ("Don Can you West"): the rest, to be played only if it
 * clearly names something (the router checks); undefined otherwise.
 */
export function misheardPlay(text: string): string | undefined {
  const m = spokenContent(text).match(/^(?:don|con|bon)\s+(.+)$/);
  return m && m[1].split(" ").length <= 8 ? m[1] : undefined;
}

const NUMBERS: Record<string, number> = {
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  doce: 12, quince: 15, veinte: 20, veinticinco: 25, treinta: 30, cuarenta: 40, "cuarenta y cinco": 45, cincuenta: 50,
  sesenta: 60, noventa: 90, cien: 100, "ciento veinte": 120,
};
const STOP_VERB = "(?:apaga(?:la|lo|r)?|para(?:la|lo|r)?|detente|deten(?:la|er)?|pausa(?:la|r)?|duermete|quita(?:la)?|corta(?:la)?|termina)";
/**
 * "Apaga la música en 20 minutos", "para en media hora", "duérmete en una hora y media",
 * "pon un temporizador de 45 minutos", "al terminar esta canción", "cancela el temporizador".
 */
export function parseSleep(n: string): number | "track" | undefined {
  if (/^(?:cancela(?:r)?|quita(?:r)?|apaga(?:r)?|desactiva(?:r)?|sin) (?:el )?(?:temporizador|timer|apagado automatico)$/.test(n)) return 0;
  if (new RegExp(`^(?:${STOP_VERB} )?(?:(?:la )?musica |todo )?(?:al|cuando) (?:terminar|acabar|termine|acabe) (?:esta|la|esa) (?:cancion|rola|tema)$`).test(n))
    return "track";
  const timed = n.match(new RegExp(
    `^(?:(?:${STOP_VERB})(?: (?:la musica|todo|la reproduccion))? (?:en|dentro de|despues de|en unos?)|(?:pon(?:me|le)? |activa |programa )?(?:un |el )?(?:temporizador|timer|apagado automatico)(?: de| en| para)?) (.+)$`));
  if (!timed) return undefined;
  return minutesIn(timed[1]);
}
function minutesIn(text: string): number | undefined {
  const t = text.replace(/^(?:unos|unas) /, "").trim();
  if (/^media hora$/.test(t)) return 30;
  if (/^(?:un|una) cuarto de hora$/.test(t)) return 15;
  const m = t.match(/^(\d{1,3}|[a-z]+(?: y cinco| veinte)?) (minutos?|mins?|horas?)(?: y media)?$/);
  if (!m) return undefined;
  const value = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBERS[m[1]];
  if (!value) return undefined;
  const minutes = m[2].startsWith("hora") ? value * 60 + (/ y media$/.test(t) ? 30 : 0) : value;
  return minutes > 0 && minutes <= 600 ? minutes : undefined;
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

/** The owner's own music, by what it is rather than by name: saved songs, what played yesterday. */
function ownMusic(rest: string): VoiceIntent | undefined {
  if (/^(?:(?:todas )?(?:mis|my) (?:favoritas|favoritos|guardadas|guardados|canciones|rolas|temas|me gusta|likes|liked songs)(?: (?:guardadas|favoritas|favoritos))?|mi (?:musica|biblioteca|libreria|coleccion)|(?:lo|las|los) que me gusta(?:n)?|(?:canciones|musica|rolas) que me gusta(?:n)?)$/.test(rest))
    return { type: "saved" };
  const heard = rest.match(/^(?:lo|la|las|los) (?:ultimo |ultima )?que (?:estaba |estuve |estabamos |andaba )?(?:escuchando|oyendo|escuche|oi|puse|sonaba|sono|ponia)(?: (ayer|anoche|antier|hoy|hace rato|antes|en la manana|en la tarde|en la noche|esta manana|esta tarde))?$/);
  if (heard) {
    const when = heard[1] ?? "";
    return { type: "history", when: /^(?:ayer|anoche|antier)$/.test(when) ? "yesterday" : /^(?:hoy|esta |en la )/.test(when) ? "today" : "recent" };
  }
  return undefined;
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
  // Before the controls: "para la música en 20 minutos" is a timer, not a pause.
  const sleep = parseSleep(n);
  if (sleep !== undefined) return { type: "sleep", minutes: sleep };
  const volume = parseVolume(n);
  if (volume !== undefined) return { type: "volume", change: volume };
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
  const rest = (verb ? n.slice(verb[0].length) : n).trim();
  // "Dame un momento" is not a song.
  if (verb && /^da(?:me|nos)/.test(verb[0]) && /^(?:un |una )?(?:momento|segundo|minuto|chance|permiso|tiempo|break|oportunidad)$/.test(rest))
    return { type: "unknown" };
  const special = ownMusic(rest);
  if (special) return special;
  // "Algo triste", "canciones de fiesta", "música para bailar": a mood, played from the catalogue.
  const mood = moodOf(rest);
  if (mood) return { type: "vibe", query: [mood.mood.query, mood.extra].filter(Boolean).join(" "), mood: mood.mood.key, ...(mood.extra ? { extra: mood.extra } : {}) };
  // "La canción X", "la de X": a song, not an artist or an album.
  const songWanted = /^(?:(?:la|una|esa|esta) )?(?:cancion(?:cita)?|rola|rolita|tema|song|track)\b/.test(rest) || /^la de \S/.test(rest);
  // "Algo de Miranda", "música de Enjambre", "otra de Misfits": the artist, not one song.
  let what = musicQuery(rest).replace(/^la de (?=\S)/, "");
  const ranked = what.match(/^(?:(?:las|los|lo|sus|puros|puras|los grandes|grandes|el) )?(?:mejores|exitos|mejor|grandes exitos|top|hits|clasicos|mas (?:famosas|famosos|conocidas|conocidos|escuchadas|escuchados|populares|sonadas|tocadas))(?: (?:canciones|rolas|temas|exitos))? (?:de|del) (.+)$/);
  if (ranked) return { type: "top", query: ranked[1], platform };
  const latest = what.match(/^(?:(?:lo|la|el|las|los|su) )?(?:mas )?(?:nuevo|nueva|nuevos|nuevas|ultimo|ultima|ultimos|ultimas|reciente|recientes|mas reciente|estreno)(?: (?:disco|album|cancion|rola|sencillo|single|lanzamiento|estreno|ep))? (?:de|del) (.+)$/) ??
    what.match(/^(?:el|la|su) (?:disco|album|sencillo|single|lanzamiento|cancion|rola) (?:mas )?(?:nuevo|nueva|ultimo|ultima|reciente) (?:de|del) (.+)$/);
  if (latest) return { type: "latest", query: latest[1], platform };
  const artistOnly = /^(?:algo|musica|canciones|rolas|temas|lo que sea|cualquier cosa|puro|pura|puras|puros|una|unas|unos|otra|otras|otro|alguna|algunas|un poco|algo mas) (?:de|del)\s+/.test(what);
  const another = /^otr[ao]s? /.test(what);
  if (artistOnly) what = what.replace(/^\S+(?: \S+)? (?:de|del)\s+/, "").replace(/^(?:lo que sea|cualquier cosa) (?:de|del)\s+/, "");
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
      playlists.find((p) => similarity(p.title, playlist[1]) > 0.75) ??
      // Said the way the recognizer writes English ("mi playlist jolidei" → "Holiday").
      playlists.map((p) => ({ p, s: soundsLike(playlist[1], p.title, 0.7) })).filter((x) => x.s >= 0.8).sort((a, b) => b.s - a.s)[0]?.p;
    if (p) return { type: "playlist", id: p.id };
    if (/^(?:mi|my) /.test(what)) return { type: "unknown" };
    // Not one of the owner's: the catalogue's playlists for those words.
    return { type: "vibe", query: playlist[1] };
  }
  const video = what.match(/^(?:el |the |un )?(?:video|concierto|concert|en vivo|live|directo) (?:de |of |del )?(.+)$/);
  if (video) return { type: "youtube", query: video[1] + " live" };
  const album = what.match(/^(?:el |la |un |todo el )?(?:album|disco|lp|ep|albun|alboom) (?:completo |entero )?(?:que se llama |llamado )?(?:de |del )?(.+?)(?: (?:de|by|del) (.+))?$/);
  if (album)
    return { type: "album", query: [album[1], album[2]].filter(Boolean).join(" "), title: album[1], artist: album[2], platform };
  const vibe = what.match(/^(?:algo|something|una playlist|un mix|musica|ambiente) (?:para |pa |tipo |con |que sea |bien |de onda |medio )?(?!de |del )(.+)$/);
  if (vibe && !artistOnly) return { type: "vibe", query: vibe[1] };
  if (artistOnly) return { type: "artist", query: what, platform, ...(another ? { another } : {}) };
  // "(una rola) de Miranda que se llama Bailarina" / "la que se llama Bailarina de Miranda".
  const named = what.match(/^(?:de|del) (.+?) que se llama (.+)$/);
  if (named) return { type: "track", query: `${named[2]} ${named[1]}`, title: named[2], artist: named[1], platform, said: `${named[2]} de ${named[1]}` };
  // "Una canción de Misfits": a song by them.
  const by = what.match(/^(?:de|del) (.+)$/);
  if (by) return { type: "artist", query: by[1], platform };
  if (songWanted && !/ (?:de|by|del) /.test(what)) return { type: "request", query: what, platform, want: "song" };
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
