import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { ConnectionsPanel } from "./ConnectionsPanel";

afterEach(() => vi.unstubAllGlobals());
it.each(["spotifyEngineAuthorized", "spotifyEngineAuthorizing"])(
  "offers logout for %s without a library session",
  (state) => {
    vi.stubGlobal("localStorage", { getItem: (key: string) => (key === "murmur.spotifyVia" ? "spotify" : null) });
    const html = renderToStaticMarkup(
      <ConnectionsPanel
        status={{ spotify: false, youtube: false, oauth: false, [state]: true }}
        onStatus={() => {}}
        notify={() => {}}
        onSearch={() => {}}
      />,
    );
    expect(html).toContain('aria-label="Cerrar sesión Spotify"');
  },
);
it("explains the Web alternative using the app owner's OAuth instead of native engine consent", () => {
  vi.stubGlobal("localStorage", { getItem: (key: string) => (key === "murmur.spotifyVia" ? "spotify" : null) });
  const html = renderToStaticMarkup(
    <ConnectionsPanel
      status={{
        spotify: false,
        youtube: false,
        oauth: false,
        spotifyPlaybackMode: "web",
      }}
      onStatus={() => {}}
      notify={() => {}}
      onSearch={() => {}}
    />,
  );
  expect(html).toContain("Web Playback SDK");
  expect(html).toContain("Pendiente de renovar Autorizar Spotify");
  expect(html).not.toContain("Activa el motor integrado");
});
