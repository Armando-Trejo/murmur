import { describe, expect, it } from "vitest";
import { parseVoiceIntent } from "./VoiceIntentParser";
import { catalogueRank, exactName } from "./voiceCatalogue";

const type = (said: string) => parseVoiceIntent(said).type;

describe("everyday instructions", () => {
  it.each([
    ["sígale", "resume"], ["pasa la canción", "next"], ["quita esa canción", "next"],
    ["repite esta canción", "restart"], ["repítela", "restart"], ["ponla otra vez", "restart"], ["desde el principio", "restart"],
    ["repite la anterior", "previous"], ["de quién es esta", "nowPlaying"], ["dame like", "save"],
    ["quita de favoritos", "unsave"], ["quítala de mis me gusta", "unsave"], ["quítale el like", "unsave"],
    ["sorpréndeme", "surprise"], ["pon algo", "surprise"], ["pon lo que sea", "surprise"],
    ["para la música", "pause"], ["siguiente", "next"], ["ok murmur súbele", "volume"],
  ])("«%s» → %s", (said, expected) => expect(type(said)).toBe(expected));

  it.each([
    ["súbele", "up"], ["sube el volumen", "up"], ["sube un poco el volumen", "up"], ["más fuerte", "up"],
    ["bájale", "down"], ["baja el volumen", "down"], ["bájale tantito", "down"], ["más bajito", "down"],
    ["volumen al máximo", 100], ["pon el volumen al 30", 30], ["volumen a la mitad", 50],
  ])("«%s» changes the volume: %s", (said, change) => expect(parseVoiceIntent(said)).toEqual({ type: "volume", change }));

  it("does not take songs for instructions", () => {
    expect(type("pon sube el telón de enjambre")).toBe("track");
    expect(type("pon algo triste")).toBe("vibe");
    expect(type("pon algo de enjambre")).toBe("artist");
    expect(parseVoiceIntent("pon la playlist de rock")).toEqual({ type: "vibe", query: "rock" });
  });
});

describe("well known artists with short names", () => {
  it.each([["ac dc", "AC/DC"], ["acdc", "AC/DC"], ["muse", "Muse"], ["queen", "Queen"], ["weeknd", "The Weeknd"], ["korn", "Korn"], ["bts", "BTS"]])(
    "«%s» is %s", (said, name) => expect(exactName(said, name)).toBe(true));
  it("a look-alike is not the name", () => {
    expect(exactName("ac dc", "CatDog")).toBe(false);
    expect(exactName("queen", "Queens of the Stone Age")).toBe(false);
  });
  it("the first search result counts as popular", () => expect(catalogueRank(0)).toBeGreaterThanOrEqual(70));
});
