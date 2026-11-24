import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, it } from "vitest";
const page = readFileSync(
  new URL("../android/app/src/main/assets/websdk/player.html", import.meta.url),
  "utf8",
);
async function runtime(capable = true) {
  const events = [],
    tokens = [],
    scripts = [],
    handlers = {},
    volumes = [];
  let options;
  const context = {
    Map,
    Promise,
    JSON,
    document: {
      createElement: () => ({}),
      head: { appendChild: (script) => scripts.push(script.src) },
    },
    isSecureContext: true,
    navigator: {
      requestMediaKeySystemAccess: () =>
        capable ? Promise.resolve({}) : Promise.reject(Error("unsupported")),
    },
    MurmurSdk: {
      event: (value) => events.push(JSON.parse(value)),
      token: (id) => tokens.push(id),
    },
    Spotify: {
      Player: class {
        constructor(value) {
          options = value;
        }
        addListener(name, callback) {
          handlers[name] = callback;
        }
        connect() {
          return Promise.resolve(true);
        }
        setVolume(value) {
          volumes.push(value);
          return Promise.resolve();
        }
      },
    },
  };
  context.window = context;
  vm.runInNewContext(
    page.match(/<script>([\s\S]+)<\/script>/)[1].replace("__CONNECT__", "true"),
    context,
  );
  await new Promise(setImmediate);
  return {
    context,
    events,
    tokens,
    scripts,
    handlers,
    volumes,
    get options() {
      return options;
    },
  };
}
it("uses the official SDK, requests tokens on demand and keeps source state and volume", async () => {
  const r = await runtime();
  expect(r.scripts).toEqual(["https://sdk.scdn.co/spotify-player.js"]);
  r.context.onSpotifyWebPlaybackSDKReady();
  expect(r.options.enableMediaSession).toBe(false);
  let access = "";
  r.options.getOAuthToken((token) => (access = token));
  expect(r.tokens).toEqual([1]);
  r.context.receiveToken(1, "synthetic-token");
  expect(access).toBe("synthetic-token");
  r.handlers.ready({ device_id: "test-device" });
  expect(r.events.at(-1)).toEqual({ type: "ready", deviceId: "test-device" });
  r.handlers.player_state_changed({
    paused: false,
    position: 500,
    duration: 10000,
    track_window: {
      current_track: {
        uri: "spotify:track:test",
        name: "Synthetic",
        artists: [{ name: "Fixture" }],
      },
    },
  });
  expect(r.events.at(-1)).toMatchObject({
    type: "state",
    paused: false,
    position: 500,
    uri: "spotify:track:test",
  });
  await r.context.command("volume", 150);
  expect(r.volumes).toEqual([0.15]);
  expect(JSON.stringify(r.events)).not.toContain("synthetic-token");
});
it("reports absent protected-media support without requesting a token or loading the SDK", async () => {
  const r = await runtime(false);
  expect(r.events).toEqual([{ type: "error", code: "eme_unavailable" }]);
  expect(r.scripts).toEqual([]);
  expect(r.tokens).toEqual([]);
});
