import { beforeEach, describe, expect, it, vi } from "vitest";

/* The catalogue exactly as the owner's phone gets it (26 nov 2026): no `popularity` anywhere. */
const mock = vi.hoisted(() => ({ playList: vi.fn(async () => {}), request: vi.fn() }));
vi.mock("./AudioOrchestrator", () => ({ player: { current: undefined, getSnapshot: () => ({ error: "", loading: false }), playList: mock.playList } }));
vi.mock("./db", () => ({
  db: {
    tracks: { count: async () => 0, toArray: async () => [], bulkGet: async () => [] },
    playlists: { count: async () => 0, toArray: async () => [] },
    history: { count: async () => 0, toArray: async () => [] },
    settings: { get: async () => undefined, put: async () => {} },
  },
  playlistTracks: async () => [], saveTrack: async () => {},
}));
vi.mock("../native", () => ({
  isNative: true, Voice: {},
  Auth: { spotifyRequest: mock.request, youtubeSongs: async () => ({ songs: [] }), youtubeAlbums: async () => ({ albums: [] }) },
}));

import { routeVoiceCommand } from "./VoiceCommandRouter";

const track = (name: string, artist: string, i: number) => ({ id: artist + i, name, uri: "spotify:track:" + i, duration_ms: 200_000, artists: [{ name: artist }], album: { name: "A", images: [] } });
const catalogue = (artists: string[]) => async ({ path }: { path: string }) => {
  const onlyArtist = /artist%3A|artist:/.exec(decodeURIComponent(path));
  const wanted = decodeURIComponent(path).match(/artist:"([^"]+)"/)?.[1];
  const names = wanted ? [wanted] : artists;
  return { data: { artists: { items: onlyArtist ? [] : artists.map((name) => ({ name })) }, tracks: { items: names.flatMap((a, n) => [1, 2, 3, 4].map((i) => track(`Song ${n}${i}`, a, n * 10 + i))) } } };
};
const playedArtists = () => [...new Set((mock.playList.mock.calls.at(-1) as unknown as [{ artist: string }[]])?.[0].map((t) => t.artist))];

beforeEach(() => { mock.playList.mockClear(); });

describe("popular artists are recognised without Spotify popularity", () => {
  it.each([
    ["Pon AC DC", ["AC/DC", "Metallica", "CatDog"], "AC/DC"],
    ["pon muse", ["Muse", "The Strokes"], "Muse"],
    ["pon queen", ["Queens of the Stone Age", "Queen", "Ivy Queen"], "Queen"],
    ["pon korn", ["Korn", "Coldplay"], "Korn"],
    ["toca algo de ac dc", ["AC/DC", "CatDog"], "AC/DC"],
  ])("«%s»", async (said, found, artist) => {
    mock.request.mockImplementation(catalogue(found));
    await routeVoiceCommand(said);
    expect(playedArtists()).toEqual([artist]);
  });
});

describe("a look-alike never plays on its own", () => {
  it("«pon ac dc» with only CatDog in the catalogue offers options instead of playing it", async () => {
    mock.request.mockImplementation(catalogue(["CatDog", "Catarsis"]));
    const answer = await routeVoiceCommand("Pon AC DC");
    expect(mock.playList).not.toHaveBeenCalled();
    expect(answer).toMatch(/No estoy seguro|No encontr/);
  });
  it("but the artist that was named does play, even with a look-alike beside it", async () => {
    mock.request.mockImplementation(catalogue(["CatDog", "AC/DC"]));
    await routeVoiceCommand("Pon AC DC");
    expect(playedArtists()).toEqual(["AC/DC"]);
  });
});
