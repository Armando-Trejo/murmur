import { describe, expect, it } from "vitest";
import { interpret, type Candidate } from "./requestResolver";

const track = (title: string, artist: string, popularity = 50): Candidate => ({ kind: "track", title, artist, popularity, ref: title });
const artist = (name: string, popularity = 60): Candidate => ({ kind: "artist", name, popularity, ref: name });
const album = (title: string, by: string): Candidate => ({ kind: "album", title, artist: by, ref: title });

describe("free-form requests are understood through the catalogues", () => {
  const catalogue = [
    track("Bailarina", "Miranda!"), track("Don", "Miranda!"), artist("Miranda!"),
    album("Sin Restricciones", "Miranda!"), track("Bailarina", "Otro Grupo", 10),
  ];
  it("a song and its artist → that song", () =>
    expect(interpret(catalogue, "bailarina miranda")?.ref).toBe("Bailarina"));
  it("just the artist → the artist", () =>
    expect(interpret(catalogue, "miranda")).toMatchObject({ kind: "artist" }));
  it("an album title → the album", () =>
    expect(interpret(catalogue, "sin restricciones de miranda")).toMatchObject({ kind: "album" }));
  it("a typo still lands", () =>
    expect(interpret([artist("Enjambre"), track("Vida en el espejo", "Enjambre")], "enjambres")).toMatchObject({ kind: "artist" }));
  it("words that explain nothing → no guess (the top hit plays instead)", () =>
    expect(interpret(catalogue, "algo tranquilo para dormir")).toBeUndefined());
});
