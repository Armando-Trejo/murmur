import { normalize } from "./FanUploadParser";

/**
 * How well known a catalogue result is, by its place in the search. Spotify no longer sends
 * `popularity` (it arrives empty), which made every short name ("AC/DC", "Muse", "Korn") look
 * unknown and lose to a stranger that only sounded alike.
 */
export const catalogueRank = (index: number) => (index === 0 ? 75 : index === 1 ? 55 : index === 2 ? 40 : 20);

const squash = (text: string) => normalize(text).replace(/^(?:the|los|las|el|la) /, "").replace(/ /g, "");

/** The words said are the name itself, whatever the spaces or a leading article: "acdc" = "AC/DC". */
export function exactName(said: string, name: string) {
  const a = squash(said);
  return a.length >= 2 && a === squash(name);
}
