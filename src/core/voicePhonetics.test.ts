import { describe, expect, it } from "vitest";
import { jaroWinkler, phoneticKey, soundsLike, songScore, spokenNumbers, tokens, wordKey } from "./voicePhonetics";

describe("how Spanish speech recognition writes English names", () => {
  it.each([
    ["jolidei in cambodia", "Holiday in Cambodia"],
    ["de misfits", "The Misfits"],
    ["kin guisar", "King Gizzard"],
    ["king guizar", "King Gizzard"],
    ["dez grips", "Death Grips"],
    ["güin", "Ween"],
    ["jalogüin", "Halloween"],
    ["jalouin", "Halloween"],
    ["metálica", "Metallica"],
    ["estatic eich", "Static Age"],
    ["dead kenedis", "Dead Kennedys"],
    ["noventa y nueve luftbalons", "99 Luftballons"],
    ["blink ciento ochenta y dos", "blink-182"],
    ["alejandro sans", "Alejandro Sanz"],
    ["los vaguens", "Los Vaguens"],
  ])("«%s» has the same key as «%s»", (said, name) => expect(phoneticKey(said)).toBe(phoneticKey(name)));

  it.each([
    ["the", "de"], ["holiday", "olidei"], ["king", "kin"], ["gizzard", "gisar"], ["guisar", "gisar"], ["death", "des"],
    ["ween", "uin"], ["shake", "Xeik"], ["phone", "fon"], ["night", "nait"], ["lizard", "lisar"], ["vida", "bida"], ["cielo", "sielo"],
    ["queen", "kuin"], ["jack", "ak"], ["kennedys", "kenedis"], ["static", "statik"], ["estatic", "statik"],
  ])("wordKey(%s) = %s", (word, key) => expect(wordKey(word)).toBe(key));

  it("glue words go: the/de/el/los/las/and/y", () => {
    expect(phoneticKey("King Gizzard and the Lizard Wizard")).toBe(phoneticKey("king gizzard y el lizard wizard"));
    expect(phoneticKey("Los Bunkers")).toBe(phoneticKey("the bunkers"));
    expect(phoneticKey("The The")).toBe("de de"); // only glue: kept
  });

  it.each([
    [["noventa", "y", "nueve"], ["99"]],
    [["ciento", "ochenta", "y", "dos"], ["182"]],
    [["dos", "mil"], ["2000"]],
    [["mil", "novecientos", "ochenta", "y", "cuatro"], ["1984"]],
    [["nineteen", "eighty", "four"], ["1984"]],
    [["twenty", "one", "pilots"], ["21", "pilots"]],
    [["one", "hundred", "and", "one"], ["101"]],
    [["uno", "dos", "tres"], ["1", "2", "3"]],
    [["uno", "y", "otro"], ["1", "y", "otro"]],
  ])("numbers said as words: %j → %j", (words, digits) => expect(spokenNumbers(words)).toEqual(digits));

  it("Jaro-Winkler basics", () => {
    expect(jaroWinkler("martha", "marhta")).toBeCloseTo(0.961, 2);
    expect(jaroWinkler("abc", "abc")).toBe(1);
    expect(jaroWinkler("abc", "xyz")).toBe(0);
  });
});

describe("soundsLike: names heard through the recognizer", () => {
  it.each([
    ["misfits", "Misfits", 0.99],
    ["misfit", "The Misfits", 0.88],
    ["misfi", "Misfits", 0.8],
    ["miss suites", "The Misfits", 0.75],
    ["King Caesars and the leaser weaser", "King Gizzard & The Lizard Wizard", 0.88],
    ["King Caesars & the lizzard weaser", "King Gizzard & The Lizard Wizard", 0.88],
    ["King Caesars & the laser", "King Gizzard & The Lizard Wizard", 0.8],
    ["king de lizard weiser", "King Gizzard & The Lizard Wizard", 0.85],
    ["king gizzard", "King Gizzard & The Lizard Wizard", 0.85],
    ["lizard wizard", "King Gizzard & The Lizard Wizard", 0.85],
    ["kanye west", "Kanye West", 0.99],
    ["can you west", "Kanye West", 0.85],
    ["reverend horton jit", "Reverend Horton Heat", 0.9],
    ["ded quenedis", "Dead Kennedys", 0.9],
    ["mis fits", "Misfits", 0.9],
  ])("«%s» ≈ «%s» (≥ %s)", (said, name, min) => expect(soundsLike(said, name)).toBeGreaterThanOrEqual(min));

  it.each([
    ["los backs", "The Black Keys"],
    ["king", "King Gizzard & The Lizard Wizard"],
    ["wizard", "King Gizzard & The Lizard Wizard"],
    ["la casa de mi mama", "Caifanes"],
    ["misfits", "Misery"],
    ["death grips", "Dead Kennedys"],
    ["punkies de lizard wizard", "King Gizzard & The Lizard Wizard"],
    ["avenger mindful", "Avengers"],
    ["de lo de roma", "Romeo Santos"],
    ["costa sabes", "Caifanes"],
  ])("«%s» is not «%s» (< 0.72)", (said, name) => expect(soundsLike(said, name)).toBeLessThan(0.72));

  it("any word order", () => expect(soundsLike("wizard lizard gizzard king", "King Gizzard & The Lizard Wizard")).toBeGreaterThan(0.95));
});

describe("songScore: a title, with or without its artist", () => {
  const score = (said: string, title: string, artist: string) => songScore(tokens(said), tokens(title), tokens(artist));
  it("title and artist in any order", () => {
    expect(score("static age de misfits", "Static Age", "Misfits")).toBeGreaterThan(0.95);
    expect(score("misfits static age", "Static Age", "Misfits")).toBeGreaterThan(0.95);
    expect(score("jolidei in cambodia", "Holiday in Cambodia", "Dead Kennedys")).toBeGreaterThan(0.95);
  });
  it("the artist alone is not one of their songs", () => expect(score("dead kennedys", "Holiday in Cambodia", "Dead Kennedys")).toBeLessThan(0.5));
  it("part of a title with the artist still lands", () => expect(score("holiday dead kennedys", "Holiday in Cambodia", "Dead Kennedys")).toBeGreaterThan(0.82));
  it("a different song by the same artist does not", () => expect(score("last caress misfits", "Static Age", "Misfits")).toBeLessThan(0.6));
});

describe("una unión de palabras no inventa un nombre", () => {
  // De la prueba real en el teléfono: «CatDog» está en la biblioteca y sonaba como «AC DC».
  it("«ac dc» no es «CatDog»", () => expect(soundsLike("ac dc", "CatDog")).toBeLessThan(0.7));
  it("«ac dc» sí es «AC/DC»", () => expect(soundsLike("ac dc", "AC/DC")).toBeGreaterThan(0.95));
  it("sigue uniendo lo que de verdad suena igual", () => {
    expect(soundsLike("miss suites", "The Misfits")).toBeGreaterThanOrEqual(0.75);
    expect(soundsLike("can you west", "Kanye West")).toBeGreaterThanOrEqual(0.85);
    expect(soundsLike("mis fits", "Misfits")).toBeGreaterThan(0.95);
  });
});

describe("el esqueleto de consonantes no junta palabras de distinto largo", () => {
  it("«ac dc» no es «Canción Acuática»", () =>
    expect(songScore(tokens("ac dc"), tokens("Canción Acuática"), tokens("Daniel, Me Estás Matando"))).toBeLessThan(0.7));
  it("«king caesars» sigue siendo King Gizzard", () =>
    expect(soundsLike("king caesars and the leaser weaser", "King Gizzard & The Lizard Wizard")).toBeGreaterThan(0.8));
});
