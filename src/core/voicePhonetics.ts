import { normalize } from "./FanUploadParser";

/**
 * How a Mexican Spanish speech recognizer writes English band and song names ("jolidei in cambodia",
 * "de misfits", "kin guisar", "dez grips", "güin"), turned into a key both spellings share. Names are
 * compared key against key, word by word in any order, with a fuzzy score (Jaro-Winkler), so the
 * owner's library can be matched before any catalogue is asked.
 */

/** Words that only glue a name together ("The Misfits", "Los Bunkers", "King Gizzard and the…"). */
const GLUE = new Set(["the", "de", "di", "del", "el", "la", "los", "las", "lo", "a", "an", "and", "y", "e", "of", "n", "feat", "ft", "featuring", "by"]);

const UNITS: Record<string, number> = {
  cero: 0, zero: 0, uno: 1, one: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5,
  seis: 6, six: 6, siete: 7, seven: 7, ocho: 8, eight: 8, nueve: 9, nine: 9,
};
const TEENS: Record<string, number> = {
  diez: 10, ten: 10, once: 11, eleven: 11, doce: 12, twelve: 12, trece: 13, thirteen: 13, catorce: 14, fourteen: 14,
  quince: 15, fifteen: 15, dieciseis: 16, sixteen: 16, diecisiete: 17, seventeen: 17, dieciocho: 18, eighteen: 18,
  diecinueve: 19, nineteen: 19, veinte: 20, veintiuno: 21, veintiun: 21, veintidos: 22, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const TENS: Record<string, number> = {
  twenty: 20, treinta: 30, thirty: 30, cuarenta: 40, forty: 40, cincuenta: 50, fifty: 50, sesenta: 60, sixty: 60,
  setenta: 70, seventy: 70, ochenta: 80, eighty: 80, noventa: 90, ninety: 90,
};
const HUNDREDS: Record<string, number> = {
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600,
  setecientos: 700, ochocientos: 800, novecientos: 900,
};
const isNumberWord = (w: string) =>
  w in UNITS || w in TEENS || w in TENS || w in HUNDREDS || w === "hundred" || w === "mil" || w === "thousand";

/**
 * Numbers said as words become digits, as titles write them: "noventa y nueve" → 99,
 * "ciento ochenta y dos" → 182, "dos mil" → 2000, "nineteen eighty four" → 1984, "twenty one" → 21.
 */
export function spokenNumbers(words: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    if (!isNumberWord(words[i])) { out.push(words[i]); i++; continue; }
    let total = 0;
    let current = 0;
    let any = false;
    const flush = () => { if (any) out.push(String(total + current)); total = 0; current = 0; any = false; };
    for (; i < words.length; i++) {
      const w = words[i];
      // "y"/"and" only joins two number words ("noventa y nueve", "one hundred and one").
      if ((w === "y" || w === "and") && any && i + 1 < words.length && isNumberWord(words[i + 1]) && !(words[i + 1] in HUNDREDS)) continue;
      if (w in UNITS || w in TEENS || w in TENS) {
        const v = UNITS[w] ?? TEENS[w] ?? TENS[w];
        const last = current % 100;
        if (any && current >= 10 && current < 100 && v >= 10 && current % 10 !== 0) {
          // "nineteen eighty": a year said in pairs.
          current = current * 100 + v;
        } else if (any && last !== 0 && (v < 10 ? last % 10 !== 0 : true)) {
          // "uno dos": two numbers, not one.
          flush();
          current = v;
          any = true;
          continue;
        } else current += v;
        any = true;
      } else if (w in HUNDREDS) {
        if (any && current % 1000 !== 0) flush();
        current += HUNDREDS[w];
        any = true;
      } else if (w === "hundred") {
        current = (current || 1) * 100;
        any = true;
      } else if (w === "mil" || w === "thousand") {
        total += (current || 1) * 1000;
        current = 0;
        any = true;
      } else break;
    }
    flush();
  }
  return out;
}

const keys = new Map<string, string>();
/** One word as it sounds, in a spelling English and Spanish writing share. */
export function wordKey(word: string): string {
  if (/^\d+$/.test(word)) return word;
  const known = keys.get(word);
  if (known !== undefined) return known;
  let s = word
    .replace(/igh/g, "ai") // night → nait
    .replace(/gh/g, "")
    .replace(/ph/g, "f")
    .replace(/ck/g, "k")
    .replace(/tion/g, "chon")
    .replace(/^th/, "d") // the → de
    .replace(/th$/, "s") // death → des
    .replace(/th/g, "d")
    .replace(/sh/g, "ch")
    .replace(/ch/g, "X") // one sound, one letter
    .replace(/qu/g, "ku")
    .replace(/c(?=[eiy])/g, "s")
    .replace(/c/g, "k")
    .replace(/gu(?=[ei])/g, "g") // guisar → gisar
    .replace(/^x/, "s")
    .replace(/x/g, "ks")
    .replace(/w/g, "u")
    .replace(/v/g, "b")
    .replace(/z/g, "s")
    .replace(/j/g, "h") // jolidei → holidei
    .replace(/h/g, "") // and both lose the h, as Spanish does
    .replace(/y/g, "i")
    .replace(/iou/g, "iu") // you → iu
    .replace(/ee/g, "i")
    .replace(/oo/g, "u")
    .replace(/ea/g, "e")
    .replace(/ae/g, "e")
    .replace(/ai$/, "ei"); // holiday → olidei
  // English silent e: like → laik, lake → leik, age → eich, home → om.
  s = s.replace(/d?ge$/, "Xe");
  if (s.length >= 3) {
    s = s
      .replace(/(^|[^aeiou])i([^aeiou])e$/, "$1ai$2")
      .replace(/(^|[^aeiou])a([^aeiou])e$/, "$1ei$2")
      .replace(/([aeiou][^aeiou])e$/, "$1");
  }
  s = s
    .replace(/^es(?=[^aeiou])/, "s") // estatic → static
    .replace(/([rnl])d$/, "$1") // gizzard → gisar
    .replace(/ng$/, "n") // king → kin
    .replace(/(.)\1+/g, "$1");
  if (!s) s = word;
  keys.set(word, s);
  return s;
}

const CONSONANT: Record<string, string> = { b: "b", p: "b", f: "f", d: "t", t: "t", g: "k", k: "k", s: "s", X: "X", m: "m", n: "n", l: "l", r: "r" };
/** The consonants only, voiced and voiceless alike (g/k, b/p, d/t), without a plural s: "kesars" and "gisar" both ksr. */
export function skeleton(key: string): string {
  if (/^\d+$/.test(key)) return key;
  let out = /^[aeiou]/.test(key) ? "a" : "";
  for (const ch of key) {
    const c = CONSONANT[ch];
    if (c && out[out.length - 1] !== c) out += c;
  }
  if (out.length > 2 && out.endsWith("s")) out = out.slice(0, -1);
  return out;
}

export interface Tok { word: string; key: string; skel: string; w: number }
const tok = (word: string, key = wordKey(word)): Tok => ({ word, key, skel: skeleton(key), w: /^\d+$/.test(key) ? 4 : Math.min(8, Math.max(2, key.length)) });

/** Words of a name as sound keys, without the glue words (unless the name is only glue, like "The The"). */
export function tokens(text: string): Tok[] {
  const words = spokenNumbers(normalize(text.replace(/gü/gi, "w").replace(/&/g, " and ").replace(/['’`´]/g, "")).split(" ").filter(Boolean));
  const content = words.filter((w) => !GLUE.has(w));
  return (content.length ? content : words).map((w) => tok(w));
}

/** "holiday in cambodia" → "olidei in kambodia": the whole key, for logs and tests. */
export function phoneticKey(text: string) {
  return tokens(text).map((t) => t.key).join(" ");
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  const la = a.length;
  const lb = b.length;
  if (!la || !lb) return 0;
  const range = Math.max(0, Math.floor(Math.max(la, lb) / 2) - 1);
  const ma = new Array<boolean>(la).fill(false);
  const mb = new Array<boolean>(lb).fill(false);
  let m = 0;
  for (let i = 0; i < la; i++) {
    const hi = Math.min(lb - 1, i + range);
    for (let j = Math.max(0, i - range); j <= hi; j++) {
      if (mb[j] || a[i] !== b[j]) continue;
      ma[i] = mb[j] = true;
      m++;
      break;
    }
  }
  if (!m) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < la; i++) {
    if (!ma[i]) continue;
    while (!mb[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (m / la + m / lb + (m - t / 2) / m) / 3;
  let p = 0;
  while (p < Math.min(4, la, lb) && a[p] === b[p]) p++;
  return jaro + p * 0.1 * (1 - jaro);
}

export function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + Number(a[i - 1] !== b[j - 1]));
    row = next;
  }
  return 1 - row[b.length] / Math.max(a.length, b.length);
}

const sims = new Map<string, number>();
/** How alike two words sound, 0..1. */
export function wordSimilarity(a: Pick<Tok, "key" | "skel">, b: Pick<Tok, "key" | "skel">): number {
  if (a.key === b.key) return 1;
  const digits = /^\d+$/;
  if (digits.test(a.key) || digits.test(b.key)) return 0;
  const id = a.key < b.key ? a.key + "|" + b.key : b.key + "|" + a.key;
  const known = sims.get(id);
  if (known !== undefined) return known;
  let s = 0;
  if (Math.min(a.key.length, b.key.length) / Math.max(a.key.length, b.key.length) >= 0.5) {
    // Jaro-Winkler alone is generous with a shared beginning ("misfits"/"misery"); edit distance keeps it honest.
    const jw = jaroWinkler(a.key, b.key);
    if (jw >= 0.44) s = (jw + levenshteinRatio(a.key, b.key)) / 2;
    if (a.skel.length >= 2 && a.skel === b.skel) s = Math.max(s, a.skel.length >= 3 ? 0.92 : 0.78);
    else if (a.skel.length >= 3 && b.skel.length >= 3) s = Math.max(s, jaroWinkler(a.skel, b.skel) * 0.85);
  }
  if (sims.size > 50_000) sims.clear();
  sims.set(id, s);
  return s;
}

/** Credit only for words that really sound alike. */
const MIN_WORD = 0.72;

interface Unit { from: number; to: number; key: string; skel: string; w: number }
function units(toks: Tok[]): Unit[] {
  const out: Unit[] = toks.map((t, i) => ({ from: i, to: i, key: t.key, skel: t.skel, w: t.w }));
  // Two words heard as one, or one heard as two: "mis fits" / "misfits", "can you" / "kanye".
  for (let i = 0; i + 1 < toks.length; i++) {
    if (/^\d+$/.test(toks[i].key) || /^\d+$/.test(toks[i + 1].key)) continue;
    const key = (toks[i].key + toks[i + 1].key).replace(/(.)\1+/g, "$1");
    out.push({ from: i, to: i + 1, key, skel: skeleton(key), w: toks[i].w + toks[i + 1].w });
  }
  return out;
}

export interface Alignment {
  /** Share of what was said that the name explains (weighted by word length). */
  said: number;
  /** Share of the name that was said. */
  name: number;
  /** Per name word: how well it was heard (0 when it was not). */
  nameHits: number[];
  /** Letters of the name that were matched. */
  chars: number;
}

/** Pairs each said word with the name word it sounds like (one to one, best pairs first). */
export function align(said: Tok[], name: Tok[]): Alignment {
  const su = units(said);
  const nu = units(name);
  const pairs: { s: Unit; n: Unit; sim: number }[] = [];
  for (const s of su)
    for (const n of nu) {
      const merged = s.to > s.from || n.to > n.from;
      const sim = wordSimilarity(s, n) * (merged ? 0.97 : 1);
      if (sim >= MIN_WORD) pairs.push({ s, n, sim });
    }
  pairs.sort((a, b) => b.sim - a.sim || b.s.to - b.s.from + (b.n.to - b.n.from) - (a.s.to - a.s.from + (a.n.to - a.n.from)));
  const usedS = new Array<boolean>(said.length).fill(false);
  const nameHits = new Array<number>(name.length).fill(0);
  const usedN = new Array<boolean>(name.length).fill(false);
  let creditS = 0;
  let creditN = 0;
  let chars = 0;
  for (const { s, n, sim } of pairs) {
    let free = true;
    for (let i = s.from; i <= s.to; i++) if (usedS[i]) free = false;
    for (let i = n.from; i <= n.to; i++) if (usedN[i]) free = false;
    if (!free) continue;
    for (let i = s.from; i <= s.to; i++) usedS[i] = true;
    for (let i = n.from; i <= n.to; i++) { usedN[i] = true; nameHits[i] = sim; }
    creditS += s.w * sim;
    creditN += n.w * sim;
    chars += n.key.length;
  }
  const totalS = said.reduce((sum, t) => sum + t.w, 0) || 1;
  const totalN = name.reduce((sum, t) => sum + t.w, 0) || 1;
  return { said: creditS / totalS, name: creditN / totalN, nameHits, chars };
}

const f1 = (a: number, b: number) => (a + b > 0 ? (2 * a * b) / (a + b) : 0);
const joined = (toks: Tok[]) => toks.map((t) => t.key).join("");

/**
 * How well the words said name something (0..1). Everything said must be explained by the name,
 * and most of the name must have been said; a clear part of a long name also counts ("King
 * Gizzard" for King Gizzard & The Lizard Wizard), a little below the whole name.
 */
export function phraseScore(said: Tok[], name: Tok[], partBase = 0.75): number {
  if (!said.length || !name.length) return 0;
  const al = align(said, name);
  let score = f1(al.said, al.name);
  if (al.chars >= 6 && al.said >= 0.85) score = Math.max(score, al.said * (partBase + (1 - partBase) * al.name));
  const a = joined(said);
  const b = joined(name);
  if (Math.min(a.length, b.length) >= 5) score = Math.max(score, levenshteinRatio(a, b) * 0.95);
  return Math.min(1, score);
}

/**
 * A song (or an album) by an artist: the title has to be heard; the artist, when said, makes it
 * surer ("static age de misfits", "misfits static age", "holiday in cambodia").
 */
export function songScore(said: Tok[], title: Tok[], artist: Tok[]): number {
  const alone = phraseScore(said, title, 0.7);
  if (!artist.length || !title.length || !said.length) return alone;
  const al = align(said, [...title, ...artist]);
  const weight = (toks: Tok[], offset: number) => {
    let hit = 0;
    let total = 0;
    let chars = 0;
    toks.forEach((t, i) => { const h = al.nameHits[offset + i]; total += t.w; hit += t.w * h; if (h) chars += t.key.length; });
    return { cov: total ? hit / total : 0, chars };
  };
  const t = weight(title, 0);
  const a = weight(artist, title.length);
  if (t.cov < 0.3) return alone;
  let both = f1(al.said, t.cov * 0.65 + a.cov * 0.35);
  if (al.said >= 0.85 && a.cov >= 0.75 && t.chars >= 4) both = Math.max(both, al.said * (0.8 + 0.2 * t.cov));
  return Math.min(1, Math.max(alone, both));
}

/** Quick text-to-text version of phraseScore. */
export function soundsLike(said: string, name: string, partBase = 0.75) {
  return phraseScore(tokens(said), tokens(name), partBase);
}
