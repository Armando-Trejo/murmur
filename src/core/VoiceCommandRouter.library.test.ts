import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryEntry, Playlist, QueueItem } from "./types";
import type { VoiceChoicesDetail } from "./voiceChoices";

const mock = vi.hoisted(() => ({
  state: { error: "", loading: false, playing: false },
  current: undefined as QueueItem | undefined,
  playList: vi.fn(async (_items: QueueItem[]) => {}),
  search: vi.fn(async (_query: string, _source: string) => [] as QueueItem[]),
  artist: vi.fn(async (_name: string) => [] as QueueItem[]),
  tracks: [] as QueueItem[],
  playlists: [] as Playlist[],
  history: [] as HistoryEntry[],
  log: [] as { heard: string; understood: string; answer: string }[],
}));
vi.mock("./AudioOrchestrator", () => ({
  player: {
    get current() { return mock.current; },
    get nextTrack() { return undefined; },
    getSnapshot: () => mock.state,
    playList: mock.playList,
    next: vi.fn(), previous: vi.fn(), pause: vi.fn(), toggle: vi.fn(), mixNow: vi.fn(),
  },
}));
vi.mock("./db", () => ({
  db: {
    tracks: {
      toArray: async () => mock.tracks,
      bulkGet: async (ids: string[]) => ids.map((id) => mock.tracks.find((t) => t.id === id)),
    },
    playlists: { toArray: async () => mock.playlists, get: async (id: string) => mock.playlists.find((p) => p.id === id) },
    history: {
      toArray: async () => mock.history,
      where: () => ({ between: (from: number, to: number) => ({ toArray: async () => mock.history.filter((h) => h.at >= from && h.at < to) }) }),
    },
    settings: {
      get: async () => ({ value: mock.log }),
      put: async (row: { value: typeof mock.log }) => { mock.log = row.value; },
    },
  },
  playlistTracks: async (p: Playlist) => p.trackIds.map((id) => mock.tracks.find((t) => t.id === id)).filter(Boolean),
  saveTrack: vi.fn(async () => {}),
}));
vi.mock("../native", () => ({ isNative: false, Voice: {}, Auth: {} }));
vi.mock("./DiscoveryEngine", () => ({
  searchAll: mock.search,
  generateArtistMix: mock.artist,
  buildAffinity: vi.fn(),
  hybridScore: vi.fn(),
  spotifyTrack: vi.fn(),
}));

import { routeVoiceCommand, VOICE_CONFIDENCE } from "./VoiceCommandRouter";
import { fixtureHistory, fixturePlaylists, fixtureTracks } from "./voiceLibraryFixture";

const yt = (id: string, title: string, artist: string): QueueItem => ({ id: "yt:" + id, videoId: id.padEnd(11, "x"), source: "youtube", title, artist, duration: 210, tags: [] });
const played = () => mock.playList.mock.calls.at(-1)?.[0] ?? [];
let offers: VoiceChoicesDetail[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  mock.state = { error: "", loading: false, playing: false };
  mock.current = undefined;
  mock.tracks = fixtureTracks;
  mock.playlists = fixturePlaylists;
  mock.history = fixtureHistory;
  mock.log = [];
  mock.search.mockResolvedValue([]);
  mock.artist.mockResolvedValue([]);
  offers = [];
  const target = new EventTarget();
  target.addEventListener("murmur:voice-choices", (e) => offers.push((e as CustomEvent<VoiceChoicesDetail>).detail));
  vi.stubGlobal("window", target);
});
afterEach(() => vi.unstubAllGlobals());

describe("real commands from the owner's phone", () => {
  it("«Pon misfits | Pon misfit | Pon Miss suites | Pon misfi» → the band from the library, not a song called Misfits", async () => {
    mock.search.mockResolvedValue([yt("misfitsong", "Misfits", "Some Pop Singer")]);
    const answer = await routeVoiceCommand("Pon misfits\nPon misfit\nPon Miss suites\nPon misfi");
    expect(answer).toBe("Mix de Misfits");
    expect(played().length).toBe(4);
    expect(played().every((t) => /misfits/i.test(t.artist))).toBe(true);
    expect(mock.search).not.toHaveBeenCalled(); // the library was sure: no catalogue needed
  });

  it("«Reproduce King Caesars and the leaser weaser | …» → King Gizzard & The Lizard Wizard (not the bootleg uploads)", async () => {
    const answer = await routeVoiceCommand("Reproduce King Caesars and the leaser weaser\nKing Caesars & the lasert\nKing Caesars & the laser\nKing Caesars & the lizzard weaser");
    expect(answer).toContain("King Gizzard");
    expect(played().map((t) => t.id).sort()).toEqual(["sp:people", "yt:rattle", "yt:robot"]);
  });

  it("«punkies de lizard wizard | Pon King de lizard weiser | …» → the alternative that asks and matches best", async () => {
    await routeVoiceCommand("punkies de lizard wizard\nPon King de lizard weiser\npunkies de lizard weaser");
    expect(played().length).toBeGreaterThan(0);
    expect(played().every((t) => t.artist === "King Gizzard & The Lizard Wizard")).toBe(true);
  });

  it("«Pon kanye West | con kanye West» → Kanye West", async () => {
    await routeVoiceCommand("Pon kanye West\ncon kanye West");
    expect(played().map((t) => t.id).sort()).toEqual(["sp:power", "sp:stronger"]);
  });

  it("«Don Can you West | Don kind you West»: a misheard «pon» plays only because the rest is clearly Kanye West", async () => {
    await routeVoiceCommand("Don Can you West\nDon kind you West");
    expect(played().map((t) => t.artist)).toEqual(["Kanye West", "Kanye West"]);
  });

  it("a misheard «pon» with nothing clear after it plays nothing", async () => {
    mock.search.mockResolvedValue([yt("perm", "Con Permiso", "Alguien")]);
    const answer = await routeVoiceCommand("con permiso\ncon permisos");
    expect(answer).toContain("di «pon»");
    expect(mock.playList).not.toHaveBeenCalled();
    expect(offers).toHaveLength(0);
  });

  it("«Reproduce los backs | …»: nothing sure → no guess, the closest options are offered", async () => {
    mock.search.mockResolvedValue([yt("backsxxxxxx", "Backs", "The Noisy Band"), yt("backinblack", "Back in Black", "AC/DC")]);
    const answer = await routeVoiceCommand("Reproduce los backs\nReproduce los back\nReproduce los backys\nReproduce los backy");
    expect(mock.playList).not.toHaveBeenCalled();
    expect(answer).toContain("No estoy seguro");
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ played: false, heard: "Reproduce los backs" });
    const titles = offers[0].choices.map((c) => c.title);
    expect(titles).toContain("Backs");
    expect(await offers[0].expand!(titles.indexOf("Backs"))).toEqual([expect.objectContaining({ title: "Backs" })]);
  });

  it("«okay murmuro | okay mur | Okay muro | okay murmu»: only the wake phrase → listening, nothing else", async () => {
    expect(await routeVoiceCommand("okay murmuro\nokay mur\nOkay muro\nokay murmu")).toBe("Te escucho: dime qué pongo");
    expect(mock.playList).not.toHaveBeenCalled();
  });

  it.each([
    "wizard\nwizards\ndeliciar wizard",
    "de lo de Roma\nde lo de Román\nlo de Román\ndel Pri\ndel primo",
    "te acuerdas",
    "bueno y cuál fue el personaje que más odiaste",
    "pero si tengo que separar",
    "Costa sabes\nde Costa sabes\nsabes",
    "Sí sí te escucha",
  ])("talk near the phone never plays: %s", async (text) => {
    mock.search.mockResolvedValue([yt("wizardxxxxx", "Wizard", "Someone")]);
    const answer = await routeVoiceCommand(text);
    expect(mock.playList).not.toHaveBeenCalled();
    expect(mock.search).not.toHaveBeenCalled();
    expect(answer).not.toMatch(/^Reproduciendo|^Mix/);
  });

  it("«Pon el álbum Avengers | Pon el álbum Avenger mindful | …»: unsure → options, nothing unrelated plays", async () => {
    const answer = await routeVoiceCommand("Pon el álbum Avengers\nPon el álbum Avenger mindful\nPon el álbum Avenger minfos\nPon el álbum Avenger mindfu");
    expect(mock.playList).not.toHaveBeenCalled();
    expect(answer).toMatch(/No encontré|No estoy seguro/);
  });

  it("keeps working: «pon static age de misfits en youtube» plays the YouTube version", async () => {
    const onYouTube = yt("staticagexx", "Static Age", "Misfits");
    mock.search.mockImplementation(async (_q, source) => (source === "youtube" ? [onYouTube] : []));
    await routeVoiceCommand("pon static age de misfits en youtube");
    expect(played()).toEqual([onYouTube]);
  });
});

describe("library first, by sound", () => {
  it.each([
    ["pon jolidei in cambodia", ["sp:holiday"]],
    ["ponme la de last caress", ["sp:caress"]],
    ["reproduce la canción jalouin", ["sp:halloween"]],
    ["échame afuera de caifanes", ["sp:afuera"]],
  ])("%s", async (text, ids) => {
    await routeVoiceCommand(text);
    expect(played().map((t) => t.id)).toEqual(ids);
  });

  it.each([
    ["pon dez grips", "Death Grips"],
    ["rólame algo de güin", "Ween"],
    ["aviéntate con unas de de misfits", "Misfits"],
    ["a ver ponme kin guisar porfa", "King Gizzard & The Lizard Wizard"],
  ])("%s → %s", async (text, artist) => {
    await routeVoiceCommand(text);
    expect(played().length).toBeGreaterThan(0);
    expect(played().every((t) => t.artist.replace(/^The /, "") === artist.replace(/^The /, ""))).toBe(true);
  });

  it("«pon el disco static age» → the saved album, in order", async () => {
    expect(await routeVoiceCommand("pon el disco static age")).toBe("Álbum Static Age");
    expect(played().map((t) => t.id)).toEqual(["sp:static", "sp:caress", "sp:halloween"]);
  });

  it("«pon rolas para manejar» → the playlist of that name", async () => {
    await routeVoiceCommand("pon rolas para manejar");
    expect(played().map((t) => t.id)).toEqual(["sp:afuera", "sp:psycho"]);
  });

  it("«pon mis favoritas» → the saved songs, shuffled", async () => {
    expect(await routeVoiceCommand("pon mis favoritas")).toContain("guardadas");
    expect(played().map((t) => t.id).sort()).toEqual(["sp:afuera", "sp:caress", "sp:guillotine", "sp:holiday", "sp:static", "yt:rattle"]);
  });

  it("«las mejores de dez grips» → their most played first (offline: from the library)", async () => {
    expect(await routeVoiceCommand("pon las mejores de dez grips")).toBe("Lo mejor de Death Grips");
    expect(played()[0].id).toBe("sp:guillotine");
  });

  it("«lo nuevo de misfits» falls back to their best when the catalogue cannot say", async () => {
    expect(await routeVoiceCommand("pon lo nuevo de misfits")).toBe("Lo mejor de Misfits");
    expect(played()[0].id).toBe("sp:caress");
  });

  it("«otra de misfits» never repeats the one playing", async () => {
    mock.current = fixtureTracks[1];
    expect(await routeVoiceCommand("ponme otra de misfits")).toBe("Otra de Misfits");
    expect(played().map((t) => t.id)).not.toContain("sp:caress");
  });

  it("«lo que escuché ayer» → yesterday's songs", async () => {
    await routeVoiceCommand("pon lo que escuché ayer");
    expect(played().map((t) => t.id).sort()).toEqual(["sp:caress", "sp:guillotine"]);
  });

  it("the log keeps the choice and how sure it was", async () => {
    await routeVoiceCommand("Pon misfits\nPon misfit");
    await new Promise((r) => setTimeout(r, 0));
    const understood = JSON.parse(mock.log[0].understood);
    expect(understood).toMatchObject({ type: "request", pick: "artist: Misfits", from: "library", alt: 0 });
    expect(understood.confidence).toBeGreaterThanOrEqual(VOICE_CONFIDENCE.library);
  });
});

describe("catalogue and the confidence floor", () => {
  it("medium confidence plays the best and offers the rest («¿No era esta?»)", async () => {
    mock.search.mockResolvedValue([yt("missuitexxx", "Miss Suite", "Jazz Trio")]);
    const answer = await routeVoiceCommand("Pon Miss suites");
    expect(answer).toBe("Mix de Misfits");
    expect(offers).toHaveLength(1);
    expect(offers[0].played).toBe(true);
    expect(offers[0].choices.map((c) => c.title)).toContain("Miss Suite");
  });

  it("an artist only the catalogue knows: «Pon Metallica | Pon metálica»", async () => {
    const songs = [yt("sandmanxxxx", "Enter Sandman", "Metallica"), yt("puppetsxxxx", "Master of Puppets", "Metallica"), yt("onexxxxxxxx", "One", "Metallica")];
    mock.search.mockResolvedValue(songs);
    mock.artist.mockResolvedValue([...songs, yt("otherxxxxxx", "Some Song", "Other Band")]);
    expect(await routeVoiceCommand("Pon Metallica\nPon metálica")).toBe("Mix de Metallica");
    expect(played().every((t) => t.artist === "Metallica")).toBe(true);
  });

  it("a song by a known artist from the catalogue plays (the owner listens to them)", async () => {
    mock.tracks = fixtureTracks.filter((t) => t.id !== "sp:negra");
    const negra = yt("negratomasa", "La Negra Tomasa", "Caifanes");
    mock.search.mockResolvedValue([negra, yt("negraother", "La Negra", "Otra Banda")]);
    await routeVoiceCommand("pon la negra tomasa");
    expect(played()).toEqual([negra]);
  });

  it("«X de Y» with Y in the library: Y's X, not someone else's", async () => {
    mock.tracks = [...fixtureTracks.filter((t) => t.id !== "sp:bailarina"), { ...fixtureTracks[0], id: "sp:don", title: "Don", artist: "Miranda!" }];
    const theirs = yt("bailarinami", "Bailarina", "Miranda!");
    mock.search.mockResolvedValue([yt("bailarinaot", "Bailarina", "Otro Grupo"), theirs]);
    await routeVoiceCommand("pon bailarina de miranda");
    expect(played()).toEqual([theirs]);
    expect(mock.search.mock.calls.map((c) => c[0])).toContain("bailarina Miranda!");
  });

  it("never plays something unrelated: below the floor nothing plays", async () => {
    mock.search.mockResolvedValue([yt("teenspirit1", "Smells Like Teen Spirit", "Nirvana"), yt("hotelcalifo", "Hotel California", "Eagles")]);
    const answer = await routeVoiceCommand("pon la vaca lola");
    expect(mock.playList).not.toHaveBeenCalled();
    expect(answer).toMatch(/No encontré|No estoy seguro/);
  });

  it("a one-word title by an unknown artist is a guess: offered, not played", async () => {
    mock.search.mockResolvedValue([yt("despacitoxx", "Despacito", "Luis Fonsi")]);
    await routeVoiceCommand("pon despacito");
    expect(mock.playList).not.toHaveBeenCalled();
    expect(offers[0]).toMatchObject({ played: false });
  });

  it("a choice that stands for an artist expands to their songs", async () => {
    mock.search.mockResolvedValue([yt("backsxxxxxx", "Backs", "The Noisy Band")]);
    await routeVoiceCommand("pon los backs");
    const detail = offers[0];
    const index = detail.kinds!.indexOf("Artista");
    if (index >= 0) {
      mock.artist.mockResolvedValue([yt("noisy1xxxxx", "Loud", "The Noisy Band")]);
      expect((await detail.expand!(index)).every((t) => t.artist === "The Noisy Band")).toBe(true);
    }
  });
});
