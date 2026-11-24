import { describe, expect, it } from "vitest";
import { albumLink, fromSpotify, fromYouTube, interleave } from "./albumSearch";
import { creditedArtists, sameArtist } from "../components/ArtistProfile";

describe("album search", () => {
  const sp = fromSpotify([
    { id: "4uLU6hMCjMI75M1A2tKUQC", name: "Static Age", release_date: "1997-06-24", artists: [{ name: "Misfits" }], images: [{ url: "https://i.scdn.co/a" }] },
    { id: "bad", name: "Ignorado" },
  ]);
  const yt = fromYouTube([{ id: "MPREb_abc123", title: "Walk Among Us", artist: "Misfits", year: "1982" }, { id: "VLnope", title: "x" }]);

  it("maps both providers and drops invalid ids", () => {
    expect(sp).toHaveLength(1);
    expect(sp[0]).toMatchObject({ feedId: "spalbum-4uLU6hMCjMI75M1A2tKUQC", libraryId: "sp:album:4uLU6hMCjMI75M1A2tKUQC", year: "1997", artist: "Misfits" });
    expect(yt).toHaveLength(1);
    expect(yt[0]).toMatchObject({ feedId: "MPREb_abc123", libraryId: "ytpl:MPREb_abc123" });
  });

  it("routes album ids back to their collection links", () => {
    expect(albumLink(sp[0].feedId)).toBe("https://open.spotify.com/album/4uLU6hMCjMI75M1A2tKUQC");
    expect(albumLink("MPREb_abc123")).toBe("https://music.youtube.com/browse/MPREb_abc123");
  });

  it("alternates providers", () => {
    expect(interleave(yt, sp).map((a) => a.source)).toEqual(["youtube", "spotify"]);
  });
});

describe("artist matching", () => {
  it("splits credits and ignores Topic/VEVO and 'The'", () => {
    expect(creditedArtists("Bad Bunny feat. Drake")).toEqual(["Bad Bunny", "Drake"]);
    expect(sameArtist({ artist: "Misfits - Topic" }, "The Misfits")).toBe(true);
    expect(sameArtist({ artist: "Calle 13, Residente" }, "Residente")).toBe(true);
    expect(sameArtist({ artist: "Residentes Unidos" }, "Residente")).toBe(false);
  });
});
