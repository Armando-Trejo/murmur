import { describe, expect, it } from "vitest";
import { isNewer, parseVersion, pickDownload } from "./updates";

describe("update check", () => {
  it("reads release tags", () => {
    expect(parseVersion("v2.16.0")).toEqual([2, 16, 0]);
    expect(parseVersion("2.15.10")).toEqual([2, 15, 10]);
    expect(parseVersion("latest")).toBeUndefined();
  });
  it("compares versions numerically", () => {
    expect(isNewer("2.16.0", "2.15.9")).toBe(true);
    expect(isNewer("2.15.10", "2.15.9")).toBe(true);
    expect(isNewer("2.15.0", "2.15.0")).toBe(false);
    expect(isNewer("2.14.9", "2.15.0")).toBe(false);
    expect(isNewer("beta", "2.15.0")).toBe(false);
  });
  it("prefers the phone (arm64) APK, then any APK, then the release page", () => {
    const page = "https://github.com/Armando-Trejo/murmur/releases/tag/v2.16.0";
    const apk = (name: string) => ({ name, browser_download_url: "https://github.com/Armando-Trejo/murmur/releases/download/v2.16.0/" + name });
    expect(pickDownload({ html_url: page, assets: [apk("MURMUR-2.16.0.apk"), apk("MURMUR-2.16.0-arm64.apk")] })).toMatch(/arm64/);
    expect(pickDownload({ html_url: page, assets: [apk("MURMUR-2.16.0.apk")] })).toMatch(/MURMUR-2\.16\.0\.apk$/);
    expect(pickDownload({ html_url: page, assets: [apk("MURMUR-2.20.0-arm64.apk"), apk("MURMUR.apk")] })).toMatch(/\/MURMUR\.apk$/);
    expect(pickDownload({ html_url: page, assets: [] })).toBe(page);
  });
});
