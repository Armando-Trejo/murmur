import { describe, expect, it } from "vitest";
import { buildVoiceLibrary, byArtist, correctQuery, hintNames, knowsArtist, librarySongsBy, matchLibrary, titleVariants } from "./voiceLibrary";
import { fixtureHistory, fixturePlaylists, fixtureTracks } from "./voiceLibraryFixture";

const lib = buildVoiceLibrary(fixtureTracks, fixturePlaylists, fixtureHistory);
const best = (said: string, want?: Parameters<typeof matchLibrary>[2]) => matchLibrary(lib, said, want)[0];

describe("the library is matched by sound, before any catalogue", () => {
  it.each([
    ["misfits", "Misfits"],
    ["misfit", "Misfits"],
    ["de misfits", "Misfits"],
    ["miss suites", "Misfits"],
    ["misfi", "Misfits"],
    ["King Caesars and the leaser weaser", "King Gizzard & The Lizard Wizard"],
    ["King Caesars & the lizzard weaser", "King Gizzard & The Lizard Wizard"],
    ["king de lizard weiser", "King Gizzard & The Lizard Wizard"],
    ["kin guisar", "King Gizzard & The Lizard Wizard"],
    ["dez grips", "Death Grips"],
    ["güin", "Ween"],
    ["reverend horton jit", "The Reverend Horton Heat"],
    ["kanye west", "Kanye West"],
    ["can you west", "Kanye West"],
    ["metálica", undefined],
  ])("artist: «%s» → %s", (said, name) => {
    const hit = best(said);
    if (!name) return expect(hit === undefined || hit.score < 0.72).toBe(true);
    expect(hit).toMatchObject({ kind: "artist", name });
    expect(hit.score).toBeGreaterThanOrEqual(0.72);
  });

  it("«pon misfits» is the band, not a song: an artist wins a tie against a song or album", () => {
    expect(best("misfits")?.kind).toBe("artist");
    expect(best("misfits")!.score).toBeGreaterThanOrEqual(0.85);
  });

  it.each([
    ["jolidei in cambodia", "sp:holiday"],
    ["holiday in cambodia dead kennedys", "sp:holiday"],
    ["last caress", "sp:caress"],
    ["last cares de misfits", "sp:caress"],
    ["jalouin", "sp:halloween"],
    ["static age de misfits", "sp:static"],
    ["guillotine death grips", "sp:guillotine"],
    ["afuera de caifanes", "sp:afuera"],
  ])("song: «%s» → %s", (said, id) => {
    const hit = best(said, "song");
    expect(hit).toMatchObject({ kind: "track" });
    expect(hit.kind === "track" && hit.track.id).toBe(id);
    expect(hit.score).toBeGreaterThanOrEqual(0.85);
  });

  it("a song is preferred to an album with the same name when nothing says «disco»", () => {
    expect(best("static age")).toMatchObject({ kind: "track" });
    expect(best("static age", "album")).toMatchObject({ kind: "album", playlistId: "sp:album:static" });
  });

  it("playlists, by sound too", () => {
    expect(best("rolas para manejar", "playlist")).toMatchObject({ kind: "playlist", id: "pl:manejar" });
    expect(best("jolidei", "playlist")).toMatchObject({ kind: "playlist", id: "pl:noche" });
  });

  it("plays break ties: the most played version first", () => {
    const twin = buildVoiceLibrary([...fixtureTracks, { ...fixtureTracks[1], id: "yt:caress2", source: "youtube" }], [], fixtureHistory);
    const hit = matchLibrary(twin, "last caress", "song")[0];
    expect(hit.kind === "track" && hit.track.id).toBe("sp:caress");
  });

  it.each(["los backs", "king", "wizard", "la casa de mi mama", "de lo de roma", "costa sabes", "te acuerdas", "avenger mindful"])(
    "nothing confident for «%s»",
    (said) => {
      const hit = best(said);
      expect(hit === undefined || hit.score < 0.85).toBe(true);
    },
  );

  it("artist helpers", () => {
    expect(librarySongsBy(lib, "Misfits").map((t) => t.id)).toEqual(expect.arrayContaining(["sp:static", "sp:caress", "sp:halloween", "sp:skulls"]));
    expect(librarySongsBy(lib, "Misfits")[0].id).toBe("sp:caress"); // most played first
    expect(librarySongsBy(lib, "King Gizzard & The Lizard Wizard").map((t) => t.id)).not.toContain("yt:bootleg");
    expect(byArtist({ artist: "Kanye West, Jay-Z" }, "Kanye West")).toBe(true);
    expect(byArtist({ artist: "MisfitsVEVO" }, "The Misfits")).toBe(true);
    expect(byArtist({ artist: "Paul Simon" }, "Simon & Garfunkel")).toBe(false);
    expect(knowsArtist(lib, "The Misfits")).toBe(true);
    expect(knowsArtist(lib, "Kanye West, Jay-Z")).toBe(true);
    expect(knowsArtist(lib, "Metallica")).toBe(false);
  });

  it("corrects a query to the library's spelling for the catalogues", () => {
    expect(correctQuery(lib, "kin guisar")).toBe("king gizzard");
    expect(correctQuery(lib, "dez grips")).toBe("death grips");
    expect(correctQuery(lib, "death grips")).toBeUndefined();
  });

  it("titles without upload noise", () => {
    expect(titleVariants("Last Caress (Remastered 2011)")).toEqual(["Last Caress"]);
    expect(titleVariants("Misfits - Last Caress [Official Audio]")).toEqual(["Misfits - Last Caress", "Last Caress"]);
    expect(titleVariants("Static Age - Live")).toEqual(["Static Age"]);
  });

  it("names for the recognizer: artists, songs, albums and playlists", () => {
    const names = hintNames(lib);
    expect(names.artists).toEqual(expect.arrayContaining(["Misfits", "King Gizzard & The Lizard Wizard", "Death Grips", "Ween"]));
    expect(names.songs[0]).toBe("Last Caress");
    expect(names.albums).toContain("Static Age");
    expect(names.playlists).toContain("Rolas para manejar");
    const all = Object.values(hintNames(lib, { artists: 2, songs: 2, albums: 1, playlists: 1 })).flat();
    expect(all.length).toBeLessThanOrEqual(6);
  });
});
