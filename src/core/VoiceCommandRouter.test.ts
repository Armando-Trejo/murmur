import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueItem } from "./types";
const mock = vi.hoisted(() => ({
  state: { error: "", loading: false, playing: false },
  current: undefined as QueueItem | undefined,
  nextTrack: undefined as QueueItem | undefined,
  next: vi.fn(async () => {}),
  previous: vi.fn(async () => {}),
  mixNow: vi.fn(async () => {}),
  pause: vi.fn(async () => {}),
  toggle: vi.fn(async () => {}),
  playList: vi.fn(async (_items: QueueItem[]) => {}),
  search: vi.fn(async (_query: string, _source: string) => [] as QueueItem[]),
  artist: vi.fn(async () => [] as QueueItem[]),
  save: vi.fn(async () => {}),
  playlists: vi.fn(async () => []),
  tracks: vi.fn(async () => []),
  get: vi.fn(async () => undefined),
  items: vi.fn(async () => []),
}));
vi.mock("./AudioOrchestrator", () => ({
  player: {
    get current() {
      return mock.current;
    },
    get nextTrack() {
      return mock.nextTrack;
    },
    getSnapshot: () => mock.state,
    next: mock.next,
    previous: mock.previous,
    mixNow: mock.mixNow,
    pause: mock.pause,
    toggle: mock.toggle,
    playList: mock.playList,
  },
}));
vi.mock("./db", () => ({
  db: {
    playlists: { toArray: mock.playlists, get: mock.get },
    tracks: { toArray: mock.tracks },
  },
  playlistTracks: mock.items,
  saveTrack: mock.save,
}));
vi.mock("../native", () => ({ isNative: false, Voice: {} }));
vi.mock("./DiscoveryEngine", () => ({
  searchAll: mock.search,
  generateArtistMix: mock.artist,
  buildAffinity: vi.fn(),
  hybridScore: vi.fn(),
}));
import { routeVoiceCommand } from "./VoiceCommandRouter";
const track: QueueItem = {
  id: "yt:one",
  source: "youtube",
  videoId: "abcdefghijk",
  title: "Afuera",
  artist: "Caifanes",
  duration: 240,
  tags: [],
};
beforeEach(() => {
  vi.clearAllMocks();
  mock.state = { error: "", loading: false, playing: false };
  mock.current = undefined;
  mock.nextTrack = undefined;
  mock.search.mockResolvedValue([]);
  mock.artist.mockResolvedValue([]);
  mock.playList.mockImplementation(async () => {});
  mock.toggle.mockImplementation(async () => {});
  mock.playlists.mockResolvedValue([]);
});
describe("voice commands execute real player actions", () => {
  it("reports an empty queue without inventing next or resume", async () => {
    expect(await routeVoiceCommand("siguiente")).toContain("No hay otra");
    expect(await routeVoiceCommand("reanuda")).toContain("Primero");
    expect(mock.next).not.toHaveBeenCalled();
    expect(mock.toggle).not.toHaveBeenCalled();
  });
  it("executes transport without search or account access", async () => {
    mock.current = track;
    mock.nextTrack = { ...track, id: "yt:two" };
    await routeVoiceCommand("siguiente");
    await routeVoiceCommand("anterior");
    await routeVoiceCommand("pausa");
    await routeVoiceCommand("reanudar");
    await routeVoiceCommand("mezcla ahora");
    expect(mock.next).toHaveBeenCalledOnce();
    expect(mock.previous).toHaveBeenCalledOnce();
    expect(mock.pause).toHaveBeenCalledOnce();
    expect(mock.toggle).toHaveBeenCalledOnce();
    expect(mock.mixNow).toHaveBeenCalledOnce();
    expect(mock.search).not.toHaveBeenCalled();
  });
  it("saves the current track through the same UI save callback", async () => {
    mock.current = track;
    const save = vi.fn(async () => {});
    expect(await routeVoiceCommand("guarda esta canción", save)).toContain(
      "guardada",
    );
    expect(save).toHaveBeenCalledWith(track);
  });
  it("forces requested concerts to YouTube", async () => {
    mock.search.mockResolvedValue([track]);
    await routeVoiceCommand("pon el concierto de Caifanes");
    expect(mock.search).toHaveBeenCalledWith("caifanes live", "youtube");
    expect(mock.playList).toHaveBeenCalledWith([track]);
  });
  it("surfaces playback errors instead of announcing success", async () => {
    mock.artist.mockResolvedValue([track]);
    mock.playList.mockImplementation(async () => {
      mock.state.error = "Spotify necesita autorización";
    });
    await expect(routeVoiceCommand("reproduce Caifanes")).rejects.toThrow(
      "Spotify necesita autorización",
    );
  });
  it("announces buffering accurately", async () => {
    mock.artist.mockResolvedValue([track]);
    mock.playList.mockImplementation(async () => {
      mock.state.loading = true;
    });
    expect(await routeVoiceCommand("reproduce Caifanes")).toBe(
      "Preparando audio…",
    );
  });
  it("surfaces resume failures stored by the orchestrator", async () => {
    mock.current = track;
    mock.toggle.mockImplementation(async () => {
      mock.state.error = "Sin conexión";
    });
    await expect(routeVoiceCommand("resume")).rejects.toThrow("Sin conexión");
  });
  it("does not execute unsupported commands", async () => {
    expect(await routeVoiceCommand("borra mi biblioteca")).toContain("Prueba");
    expect(mock.playList).not.toHaveBeenCalled();
  });
});
