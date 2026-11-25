import { normalize } from "./FanUploadParser";

/**
 * Moods MURMUR understands by voice ("pon algo triste", "música para la fiesta", "rolas alegres")
 * and the ones the radio rotates through in blocks. `query` is what the catalogue is searched for
 * (YouTube Music knows moods by its playlists); `spoken` is how the presenter names it.
 */
export interface Mood {
  key: string;
  spoken: string;
  query: string;
  /** Words that name the mood (normalized: no accents, lowercase). */
  words: RegExp;
  /** The chip on YouTube Music's Inicio for it ("Triste", "Fiesta", "Relajarse"…), normalized; Spanish or English. */
  chip: RegExp;
}

export const MOODS: Mood[] = [
  { key: "triste", spoken: "algo triste", query: "canciones tristes en español", words: /^(?:triste|tristes|tristona|melancolic[ao]s?|para llorar|de llorar|bajon|de bajon|depre|deprimente|sad)$/, chip: /(?:trist|sad|melancol)/ },
  { key: "despecho", spoken: "algo de despecho", query: "canciones de despecho", words: /^(?:despecho|de despecho|desamor|de desamor|para olvidar|corazon roto|ardid[ao]s?|de ardidos?)$/, chip: /(?:desamor|corazon roto|despecho|trist|sad)/ },
  { key: "nostalgia", spoken: "algo nostálgico", query: "clásicos nostálgicos en español", words: /^(?:nostalgic[ao]s?|nostalgia|de nostalgia|de recuerdo|recuerdos|del recuerdo|viejitas|de las viejitas|ochenteras?|noventeras?)$/, chip: /(?:nostalg|throwback|recuerdo|clasic)/ },
  { key: "alegre", spoken: "algo alegre", query: "canciones alegres para levantar el ánimo", words: /^(?:alegre|alegres|feliz|felices|happy|animad[ao]s?|para animarme|para animar|buena vibra|de buena vibra|buena onda|positiv[ao]s?|optimista|para sonreir)$/, chip: /(?:buen humor|sentirse bien|animo|alegr|feel good|happy|positiv)/ },
  { key: "fiesta", spoken: "algo de fiesta", query: "éxitos para fiesta", words: /^(?:fiesta|de fiesta|la fiesta|para la fiesta|para fiesta|fiester[ao]s?|party|reventon|de reventon|peda|para la peda|antro|de antro|para el antro|para bailar|pa bailar|bailable|bailables|de perreo|perreo|para perrear)$/, chip: /(?:fiesta|party|bailar|dance)/ },
  { key: "energia", spoken: "algo con energía", query: "música con energía para entrenar", words: /^(?:energia|con energia|energetic[ao]s?|para el gym|para el gimnasio|de gym|para entrenar|para correr|para hacer ejercicio|de ejercicio|motivacion|para motivarme|motivador[ae]?s?|intens[ao]s?|pesad[ao]s?|power)$/, chip: /(?:energ|ejercicio|entren|workout|gym|motiva)/ },
  { key: "tranquila", spoken: "algo tranquilo", query: "música tranquila para relajarse", words: /^(?:tranquil[ao]s?|tranqui|relajad[ao]s?|relajante|para relajarme|para relajarse|chill|chido y tranquilo|calmad[ao]s?|suave|suaves|lenta|lentas|para descansar|zen)$/, chip: /(?:relaj|relax|calma|chill|tranquil)/ },
  { key: "concentrar", spoken: "algo para concentrarte", query: "música para concentrarse y estudiar", words: /^(?:para concentrarme|para concentrarse|para estudiar|para trabajar|de fondo|para leer|para programar|focus)$/, chip: /(?:concentr|focus|enfoque|estudi|trabaj)/ },
  { key: "dormir", spoken: "algo para dormir", query: "música suave para dormir", words: /^(?:para dormir|de dormir|para dormirme|de cuna|arrullo)$/, chip: /(?:dormir|sleep|descans)/ },
  { key: "romantica", spoken: "algo romántico", query: "canciones románticas en español", words: /^(?:romantic[ao]s?|de amor|para enamorar|cursi|cursis|para dedicar|de enamorados|amorosas?)$/, chip: /(?:romance|romant|amor|love)/ },
];

/** The radio's block rotation: a gentle walk through moods that follow each other naturally. */
export const ROTATION = ["alegre", "fiesta", "energia", "nostalgia", "romantica", "tranquila"] as const;

export const moodByKey = (key: string | undefined) => MOODS.find((m) => m.key === key);

/** The mood after `key` in the radio rotation. */
export function nextMood(key: string | undefined): Mood {
  const at = ROTATION.indexOf(key as (typeof ROTATION)[number]);
  return moodByKey(ROTATION[(at + 1) % ROTATION.length])!;
}

/** Leading words that only say "music" ("algo", "canciones", "una playlist", "música bien"). */
const LEAD = /^(?:(?:algo|alguna|algunas|unas|unos|una|un) )?(?:(?:de )?(?:musica|cancion(?:es|cita)?|rolas?|rolitas|temas|playlist|mix|lista|ambiente|onda|vibra)\s*)?(?:(?:bien|medio|muy|mas|super|re) )?/;

/**
 * The mood a request names, if the whole request is a mood ("algo triste", "canciones de fiesta",
 * "música para bailar", "rolas alegres en inglés"); undefined for anything that names an artist or a
 * song ("Triste de Bad Bunny" is a song). A bare mood word without "algo/música/canciones…" counts
 * only when it can't be a title on its own ("para bailar", "de despecho").
 */
export function moodOf(text: string): { mood: Mood; extra: string } | undefined {
  const n = normalize(text);
  const lead = n.match(LEAD)?.[0] ?? "";
  const rest = n.slice(lead.length).trim().replace(/^(?:que sea|que sean|tipo|estilo|para que|pa que) /, "");
  if (!rest) return undefined;
  const words = rest.split(" ");
  // The mood is the first 1–4 words; up to three more may refine it ("en ingles", "de los 80").
  for (let size = Math.min(4, words.length); size >= 1; size--) {
    const head = words.slice(0, size).join(" ");
    const mood = MOODS.find((m) => m.words.test(head));
    if (!mood) continue;
    const extra = words.slice(size).join(" ");
    if (extra && !/^(?:en (?:espanol|ingles)|de los \d0s?|de los (?:ochenta|noventa|setenta|dosmil)|en vivo|actual(?:es)?|nuev[ao]s|viej[ao]s|para (?:hoy|ahorita|la noche|la manana|la tarde)|por favor)$/.test(extra)) return undefined;
    const named = lead.trim().length > 0 || /^(?:para|pa|de|con) /.test(head);
    if (!named) return undefined;
    return { mood, extra };
  }
  return undefined;
}
