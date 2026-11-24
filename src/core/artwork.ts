type Artwork = {
  artworkUrl?: string;
  videoId?: string;
  /** The user's own image wins over every provider cover. */
  customArtwork?: string;
};

const googleCover = /^https:\/\/(?:lh3\.googleusercontent\.com|yt3\.googleusercontent\.com|yt3\.ggpht\.com)\//;
const googleSize = /=(?:w\d+-h\d+|s\d+)[^/?#]*$/;
const videoFrame = /^https:\/\/(?:i\d?\.ytimg\.com|img\.youtube\.com)\//;
/** Spotify album art: 64, 300 and 640 px variants share one id (…4851, …1e02, …b273). */
const spotifyArt = /^(https:\/\/i\.scdn\.co\/image\/ab67616d0000)(?:4851|1e02|b273)/;

/**
 * Rewrites a provider thumbnail URL to the requested square size when its CDN supports it.
 * Rows ask for ~300 px (sharp at 3× for a 44–96 px thumbnail), cards ~544, the player 1200:
 * a 1 000-song list no longer downloads 640 px covers for 44 px squares.
 */
export function sizedArtwork(url: string, size: number): string {
  if (googleCover.test(url) && googleSize.test(url))
    return url.replace(googleSize, `=w${size}-h${size}-l90-rj`);
  if (spotifyArt.test(url)) return url.replace(spotifyArt, size > 320 ? "$1b273" : "$11e02");
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
export type ArtworkSize = "small" | "medium" | "large";

export function artworkOptions(item?: Artwork, large: boolean | ArtworkSize = false): string[] {
  const tier: ArtworkSize = large === true ? "large" : large === false ? "medium" : large;
  const original = item?.artworkUrl;
  const safe = original && /^(https:\/\/|data:image\/)/.test(original) ? original : undefined;
  const id = item?.videoId && /^[\w-]{11}$/.test(item.videoId) ? item.videoId : undefined;
  const size = tier === "large" ? 1200 : tier === "medium" ? 544 : 300;
  large = tier === "large";
  const custom = item?.customArtwork && /^data:image\/(?:jpeg|png|webp);base64,/.test(item.customArtwork) ? item.customArtwork : undefined;
  if (custom) return [custom, ...artworkOptions({ artworkUrl: item?.artworkUrl, videoId: item?.videoId }, tier)];
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
