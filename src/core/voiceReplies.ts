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
