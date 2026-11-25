import { describe, expect, it } from "vitest";
import { moodOf, nextMood, ROTATION } from "./moods";
import { parseVoiceIntent } from "./VoiceIntentParser";

describe("moods by voice", () => {
  it.each([
    ["pon algo triste", "triste"],
    ["ponme canciones tristes", "triste"],
    ["quiero música de fiesta", "fiesta"],
    ["pon algo para bailar", "fiesta"],
    ["pon rolas alegres", "alegre"],
    ["pon algo de despecho", "despecho"],
    ["ponme música tranquila en inglés", "tranquila"],
    ["pon algo romántico", "romantica"],
    ["pon música para el gym", "energia"],
  ])("«%s» → %s", (said, key) => {
    const intent = parseVoiceIntent(said);
    expect(intent.type).toBe("vibe");
    expect(intent.type === "vibe" && intent.mood).toBe(key);
  });

  it("a song or an artist is not a mood", () => {
    expect(parseVoiceIntent("pon triste de bad bunny").type).toBe("track");
    expect(parseVoiceIntent("pon algo de Miranda").type).toBe("artist");
    expect(moodOf("triste")).toBeUndefined();
    expect(moodOf("algo triste de bad bunny")).toBeUndefined();
  });

  it("the radio rotation walks through every mood and comes back", () => {
    let key: string | undefined;
    const seen: string[] = [];
    for (let i = 0; i < ROTATION.length; i++) { key = nextMood(key).key; seen.push(key); }
    expect(seen).toEqual([...ROTATION]);
    expect(nextMood(key).key).toBe(ROTATION[0]);
  });
});
