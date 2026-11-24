type Artwork = {
  artworkUrl?: string;
  videoId?: string;
};

export function artworkFor(item?: Artwork): string | undefined {
  return artworkOptions(item)[0];
}

export function artworkOptions(item?: Artwork, large = false): string[] {
  const original = item?.artworkUrl;
  const safe = original && /^(https:\/\/|data:image\/)/.test(original) ? original : undefined;
  const id = item?.videoId;
  if (!id || !/^[\w-]{11}$/.test(id)) return safe ? [safe] : [];
  // A Music cover can be square album artwork rather than a video frame.
  const isMusicCover = safe && /^https:\/\/(?:lh3\.googleusercontent\.com|yt3\.googleusercontent\.com)\//.test(safe);
  if (isMusicCover || safe && !/^https:\/\/(?:i\d?\.ytimg\.com|img\.youtube\.com)\//.test(safe)) return [safe!];
  const base = `https://i.ytimg.com/vi/${id}/`;
  const candidates = large ? [base + "maxresdefault.jpg", base + "sddefault.jpg"] : [];
  const highResolution = safe && /\/(?:maxres|sd|hq)default(?:_live)?\.jpg/.test(safe) ? [safe] : [];
  return [...new Set([...candidates, ...highResolution, base + "hqdefault.jpg", ...(safe ? [safe] : [])])];
}
