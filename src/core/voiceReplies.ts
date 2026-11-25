/**
 * What MURMUR says out loud after a hands-free command ("Ok MURMUR, …"). Answers whose effect you
 * already hear (music starting, the next song) stay silent; questions, confirmations, timers and
 * anything it could not do are spoken, so the phone can stay in your pocket.
 */
const AUDIBLE = /^(?:Preparando audio|Reanudando|Siguiente canción|Canción anterior|Mezclando|La música ya está en reproducción)/;

export function spokenReply(answer: string): string | undefined {
  const text = answer.trim();
  if (!text || AUDIBLE.test(text)) return undefined;
  // "Reproduciendo X" / "Mix de X": the music says it; a short confirmation is enough.
  if (/^(?:Reproduciendo|Mix de|Otra de|Lo mejor de|Lo más nuevo de|Tus guardadas|Lo que escuchaste|Lo que estabas escuchando|Álbum|Música|Mix por vibra)/.test(text)) return undefined;
  return text.replace(/^Error: /, "");
}

/**
 * The request as heard, for the "Buscando «…»" status: the recognizer's first alternative, without
 * the wake phrase or a trailing «por favor», kept short enough for one line on a phone.
 */
export function heardLabel(text: string, max = 38): string {
  const first = (text.split(/\r?\n/).find((line) => line.trim()) ?? "").trim();
  const clean = first
    .replace(/^(?:oye\s+|ok\s+|okay\s+|okey\s+)?(?:murmur\w*|mur\s*mur\w*)[,.\s]*/i, "")
    .replace(/[,.\s]*(?:por favor|porfa|please)[.!]?$/i, "")
    .trim();
  const label = clean || first || "tu petición";
  return label.length > max ? label.slice(0, max - 1).trimEnd() + "…" : label;
}
