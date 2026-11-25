import { Audio, isNative } from "../native";
import { db, exportBackup } from "./db";

const LAST = "murmur.autoBackupAt";
/** At most one automatic copy every 6 h; the first one 20 s after opening, never during the first screen. */
export const AUTO_BACKUP_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_DELAY_MS = 20_000;

/** True when a new automatic copy is due: never made, or older than the interval. */
export function backupDue(last: number, now: number, every = AUTO_BACKUP_EVERY_MS) {
  return !Number.isFinite(last) || last <= 0 || now - last >= every || now < last;
}

let running = false;
async function backupNow(force = false) {
  if (!isNative || running) return;
  const last = Number(localStorage.getItem(LAST) || 0);
  if (!force && !backupDue(last, Date.now())) return;
  // An empty library (first start before any restore) must never overwrite a good copy.
  if ((await db.tracks.count().catch(() => 0)) === 0 && (await db.playlists.count().catch(() => 0)) === 0) return;
  running = true;
  try {
    const { saved } = await Audio.saveAutoBackup({ content: await exportBackup(false) });
    if (saved) localStorage.setItem(LAST, String(Date.now()));
  } catch {
    /* Silent: the manual export in Ajustes is always available. */
  } finally {
    running = false;
  }
}

/**
 * Keeps Descargas/MURMUR/murmur-respaldo.json current: shortly after start, every 6 h while open
 * and when MURMUR goes to the background. A reinstall (another signing key, a new phone) restores
 * library, playlists, history and preferences from it in the welcome screen.
 */
export function startAutoBackup() {
  if (!isNative || typeof window === "undefined") return;
  setTimeout(() => void backupNow(), FIRST_DELAY_MS);
  setInterval(() => void backupNow(), 30 * 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void backupNow();
  });
}

/** For Ajustes: make a copy right now. */
export const backupToDownloadsNow = () => backupNow(true);
