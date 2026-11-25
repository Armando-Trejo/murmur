import type { QueueItem } from "./types";

/** «¿No era esta?»: what MURMUR heard and the closest things it found, offered for one tap. */
export const VOICE_CHOICES_EVENT = "murmur:voice-choices";

export interface VoiceChoicesDetail {
  /** The words as heard. */
  heard: string;
  /** Up to three options, best first. Songs are themselves; an artist, album or playlist is a stand-in with its name and cover. */
  choices: QueueItem[];
  /** True when MURMUR already plays its best guess (these are the other options); false when it played nothing. */
  played: boolean;
  /** What each option is ("Canción", "Artista", "Álbum", "Playlist"); songs when absent. */
  kinds?: string[];
  /** The songs to play for an option (an artist's mix, a whole album); without it the option plays alone. */
  expand?: (index: number) => Promise<QueueItem[]>;
}

export function offerVoiceChoices(detail: VoiceChoicesDetail) {
  if (typeof window === "undefined" || !detail.choices.length) return;
  window.dispatchEvent(new CustomEvent<VoiceChoicesDetail>(VOICE_CHOICES_EVENT, { detail: { ...detail, choices: detail.choices.slice(0, 3) } }));
}
