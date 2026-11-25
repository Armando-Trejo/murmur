import { APP_VERSION } from "../config";

const REPO = "Armando-Trejo/murmur";
const CHECKED = "murmur.updateCheckedAt";
const DISMISSED = "murmur.updateDismissed";
/** At most one check every 12 h; GitHub allows 60 anonymous requests per hour, far above that. */
export const UPDATE_EVERY_MS = 12 * 60 * 60 * 1000;

export interface Release { version: string; url: string; notes: string }

/** "v2.16.0" / "2.16.0" → [2, 16, 0]; anything else → undefined. */
export function parseVersion(tag: string): number[] | undefined {
  const m = tag.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return m ? m.slice(1).map(Number) : undefined;
}

/** True when `latest` is a newer version than `current`. */
export function isNewer(latest: string, current: string) {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** The APK to download from a release: the phone build (arm64) first, any APK otherwise, else the release page. */
export function pickDownload(release: { html_url: string; assets?: { name: string; browser_download_url: string }[] }) {
  const apks = (release.assets ?? []).filter((a) => /\.apk$/i.test(a.name));
  return (apks.find((a) => /arm64/i.test(a.name)) ?? apks[0])?.browser_download_url ?? release.html_url;
}

/**
 * Asks GitHub for the latest MURMUR release. Returns it only when it is newer than this install and
 * the person has not dismissed that same version. Network errors are silent (no update, no noise).
 */
export async function checkForUpdate(now = Date.now(), force = false): Promise<Release | undefined> {
  try {
    const last = Number(localStorage.getItem(CHECKED) || 0);
    if (!force && now - last < UPDATE_EVERY_MS && now >= last) return undefined;
    localStorage.setItem(CHECKED, String(now));
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) return undefined;
    const data = await response.json();
    const version = String(data.tag_name ?? "").replace(/^v/, "");
    if (!isNewer(version, APP_VERSION)) return undefined;
    if (!force && localStorage.getItem(DISMISSED) === version) return undefined;
    return { version, url: pickDownload(data), notes: String(data.body ?? "").slice(0, 400) };
  } catch {
    return undefined;
  }
}

export const dismissUpdate = (version: string) => {
  try { localStorage.setItem(DISMISSED, version); } catch { /* ignore */ }
};
