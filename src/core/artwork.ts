type Artwork = {
  artworkUrl?: string;
  videoId?: string;
};

const googleCover = /^https:\/\/(?:lh3\.googleusercontent\.com|yt3\.googleusercontent\.com|yt3\.ggpht\.com)\//;
const googleSize = /=(?:w\d+-h\d+|s\d+)[^/?#]*$/;
const videoFrame = /^https:\/\/(?:i\d?\.ytimg\.com|img\.youtube\.com)\//;
/** Spotify album art: 64 px and 300 px variants share their id with the 640 px original. */
const spotifySmall = /^(https:\/\/i\.scdn\.co\/image\/ab67616d0000)(?:4851|1e02)/;

/** Rewrites a provider thumbnail URL to the requested square size when its CDN supports it. */
export function sizedArtwork(url: string, size: number): string {
  if (googleCover.test(url) && googleSize.test(url))
    return url.replace(googleSize, `=w${size}-h${size}-l90-rj`);
  if (size > 320 && spotifySmall.test(url)) return url.replace(spotifySmall, "$1b273");
  return url;
}

/** 4:3 YouTube frames (hq/sd/default) carry black bars above and below the 16:9 picture. */
export function isLetterboxed(url: string): boolean {
  return videoFrame.test(url) && /\/(?:hq|sd|)default(?:_live)?\.jpg/.test(url);
}

export function artworkFor(item?: Artwork): string | undefined {
  return artworkOptions(item)[0];
}

/**
 * Ordered candidates for one cover, sharpest first. Each later entry is a fallback for a failed or
 * missing image, so a broken album cover still falls back to the video frame.
 */
export function artworkOptions(item?: Artwork, large = false): string[] {
  const original = item?.artworkUrl;
  const safe = original && /^(https:\/\/|data:image\/)/.test(original) ? original : undefined;
  const id = item?.videoId && /^[\w-]{11}$/.test(item.videoId) ? item.videoId : undefined;
  const size = large ? 1200 : 544;
  const frames = id
    ? large
      ? [`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${id}/hq720.jpg`,
        `https://i.ytimg.com/vi/${id}/hqdefault.jpg`]
      : [`https://i.ytimg.com/vi/${id}/mqdefault.jpg`, `https://i.ytimg.com/vi/${id}/hqdefault.jpg`]
    : [];
  if (!safe) return frames;
  if (videoFrame.test(safe)) return [...new Set([...frames, safe])];
  return [...new Set([sizedArtwork(safe, size), safe, ...frames])];
}
