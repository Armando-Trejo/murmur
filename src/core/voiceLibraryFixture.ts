import type { HistoryEntry, Playlist, QueueItem } from "./types";

/** A small copy of the owner's library, for the voice tests. */
const song = (id: string, title: string, artist: string, extra: Partial<QueueItem> = {}): QueueItem => ({
  id, title, artist, source: "spotify", duration: 200, tags: [], ...extra,
});

export const fixtureTracks: QueueItem[] = [
  song("sp:static", "Static Age", "Misfits", { album: "Static Age", saved: true }),
  song("sp:caress", "Last Caress", "Misfits", { album: "Static Age", saved: true }),
  song("sp:halloween", "Halloween", "The Misfits", { album: "Static Age" }),
  song("sp:skulls", "Skulls", "Misfits", { album: "Walk Among Us" }),
  song("yt:robot", "Robot Stop", "King Gizzard & The Lizard Wizard", { source: "youtube", videoId: "robotstop01", album: "Nonagon Infinity" }),
  song("yt:rattle", "Rattlesnake", "King Gizzard & The Lizard Wizard", { source: "youtube", videoId: "rattlesnak1", saved: true }),
  song("sp:people", "People-Vultures", "King Gizzard & The Lizard Wizard"),
  song("yt:bootleg", "Rattlesnake (Live in Paris)", "bootleg gizzard - Topic", { source: "youtube", videoId: "bootlegrat1", duration: 900 }),
  song("sp:guillotine", "Guillotine", "Death Grips", { saved: true }),
  song("sp:hacker", "Hacker", "Death Grips"),
  song("sp:holiday", "Holiday in Cambodia", "Dead Kennedys", { saved: true }),
  song("sp:california", "California Über Alles", "Dead Kennedys"),
  song("sp:daisies", "Push th' Little Daisies", "Ween"),
  song("sp:voodoo", "Voodoo Lady", "Ween"),
  song("sp:psycho", "Psychobilly Freakout", "The Reverend Horton Heat"),
  song("sp:afuera", "Afuera", "Caifanes", { saved: true }),
  song("sp:negra", "La Negra Tomasa", "Caifanes"),
  song("sp:stronger", "Stronger", "Kanye West"),
  song("sp:power", "POWER", "Kanye West"),
  song("sp:bailarina", "Bailarina", "Miranda!"),
  song("sp:manos", "Vida en el espejo", "Enjambre"),
  song("sp:avenger", "Avenger", "Some Metal Band"),
];

export const fixturePlaylists: Playlist[] = [
  { id: "pl:manejar", title: "Rolas para manejar", source: "hybrid", trackIds: ["sp:afuera", "sp:psycho"] },
  { id: "pl:noche", title: "Holiday", source: "hybrid", trackIds: ["sp:holiday"] },
  { id: "sp:album:static", kind: "album", title: "Static Age", artist: "Misfits", source: "spotify", trackIds: ["sp:static", "sp:caress", "sp:halloween"] },
];

const DAY = 86_400_000;
export const fixtureHistory: HistoryEntry[] = [
  ...Array.from({ length: 12 }, (_, i): HistoryEntry => ({ trackId: "sp:caress", at: Date.now() - (i + 1) * DAY, seconds: 180, skipped: false })),
  ...Array.from({ length: 4 }, (_, i): HistoryEntry => ({ trackId: "sp:guillotine", at: Date.now() - (i + 1) * DAY, seconds: 200, skipped: false })),
];
