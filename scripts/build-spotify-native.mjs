import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const windows = process.platform === "win32";
const local = path.join(root, ".native-tools", "cargo");
const env = { ...process.env };
if (fs.existsSync(local)) {
  env.CARGO_HOME = local;
  env.RUSTUP_HOME = path.join(root, ".native-tools", "rustup");
  env.PATH = path.join(local, "bin") + path.delimiter + env.PATH;
}
const cargo = fs.existsSync(local)
  ? path.join(local, "bin", windows ? "cargo.exe" : "cargo")
  : "cargo";
const rustc = fs.existsSync(local)
  ? path.join(local, "bin", windows ? "rustc.exe" : "rustc")
  : "rustc";
const rust = spawnSync(rustc, ["--version"], { env, encoding: "utf8" });
if (rust.status !== 0 || !rust.stdout.startsWith("rustc 1.100.0 "))
  throw Error(
    "Rust 1.100.0 is required for the pinned Spotify native build. See native/spotify/UPSTREAM.md.",
  );
const ndk =
  env.ANDROID_NDK_HOME || path.join(root, ".build-sdk", "ndk", "28.2.13676358");
if (!fs.existsSync(ndk))
  throw Error("Install Android NDK 28.2.13676358 or set ANDROID_NDK_HOME.");
env.ANDROID_NDK_HOME = ndk;
env.RUSTFLAGS = "-C link-arg=-Wl,-z,max-page-size=16384";
env.CARGO_BUILD_JOBS = "4";
const abis = ["arm64-v8a", "armeabi-v7a", "x86_64", "x86"];
const args = [
  "ndk",
  ...abis.flatMap((a) => ["-t", a]),
  "--platform",
  "26",
  "-o",
  path.join(root, "android/app/src/main/jniLibs"),
  "build",
  "--release",
  "--locked",
];
const log = fs.createWriteStream(path.join(root, "native-build.log"));
let pending = "",
  suppress = false;
function lines(chunk) {
  pending += chunk.toString();
  let at;
  while ((at = pending.indexOf("\n")) >= 0) {
    const line = pending.slice(0, at + 1);
    pending = pending.slice(at + 1);
    if (line.trim() === "env:") suppress = true;
    if (!suppress) {
      log.write(line);
      process.stdout.write(line);
    }
  }
}
const child = spawn(cargo, args, {
  cwd: path.join(root, "native/spotify"),
  env,
  windowsHide: true,
});
child.stdout.on("data", lines);
child.stderr.on("data", lines);
const status = await new Promise((resolve, reject) => {
  child.on("error", reject);
  child.on("close", resolve);
});
if (pending && !suppress) {
  log.write(pending);
  process.stdout.write(pending);
}
await new Promise((resolve) => log.end(resolve));
if (status !== 0)
  throw Error(
    "Native Spotify build failed; native-build.log contains sanitized compiler output.",
  );
const files = abis.map((abi) => {
  const name = path.join(
    "android/app/src/main/jniLibs",
    abi,
    "libmurmurspotify.so",
  );
  const bytes = fs.readFileSync(path.join(root, name));
  return {
    abi,
    path: name,
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
});
fs.mkdirSync(path.join(root, "verification"), { recursive: true });
fs.writeFileSync(
  path.join(root, "verification/spotify-native.json"),
  JSON.stringify(
    {
      upstream: "Lelonio/Square@139441f",
      rust: rust.stdout.trim(),
      ndk: "28.2.13676358",
      api: 26,
      pageSize: 16384,
      files,
    },
    null,
    2,
  ),
);
