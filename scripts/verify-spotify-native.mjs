import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
const root = process.cwd();
const reader = path.join(
  root,
  ".build-sdk/ndk/28.2.13676358/toolchains/llvm/prebuilt/windows-x86_64/bin/llvm-readelf.exe",
);
const declarations = fs.readFileSync(
  "android/app/src/main/java/com/personal/murmur/spotify/SpotifyNative.kt",
  "utf8",
);
const methods = [...declarations.matchAll(/external fun (\w+)\(/g)].map(
  (m) => m[1],
);
const machines = { "arm64-v8a": 183, "armeabi-v7a": 40, x86: 3, x86_64: 62 };
const files = Object.entries(machines).map(([abi, machine]) => {
  const name = `android/app/src/main/jniLibs/${abi}/libmurmurspotify.so`;
  const bytes = fs.readFileSync(name);
  if (
    bytes.subarray(0, 4).toString("hex") !== "7f454c46" ||
    bytes.readUInt16LE(18) !== machine
  )
    throw Error(`Wrong ELF machine: ${abi}`);
  const read = (flag) =>
    execFileSync(reader, [flag, path.join(root, name)], {
      encoding: "utf8",
      windowsHide: true,
    });
  const symbols = read("--dyn-syms");
  for (const method of methods)
    if (
      !symbols.includes(
        `Java_com_personal_murmur_spotify_SpotifyNative_${method}`,
      )
    )
      throw Error(`Missing JNI export ${abi}/${method}`);
  const loads = read("--program-headers")
    .split("\n")
    .filter((line) => /^\s*LOAD\s/.test(line));
  if (
    !loads.length ||
    loads.some((line) => Number(line.trim().split(/\s+/).at(-1)) < 16384)
  )
    throw Error(`Incorrect LOAD alignment: ${abi}`);
  const dependencies = [
    ...read("--dynamic").matchAll(/Shared library: \[([^\]]+)\]/g),
  ].map((m) => m[1]);
  if (
    dependencies.some(
      (name) => !["liblog.so", "libdl.so", "libm.so", "libc.so"].includes(name),
    )
  )
    throw Error(`Unexpected dependency: ${abi}`);
  return {
    abi,
    machine,
    jniExports: methods.length,
    loadSegments: loads.length,
    minimumAlignment: 16384,
    dependencies,
    bytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
});
fs.mkdirSync("verification", { recursive: true });
fs.writeFileSync(
  "verification/spotify-native-abi.json",
  JSON.stringify({ files }, null, 2),
);
console.log(
  `Verified ${files.length} Android ABIs, ${methods.length} JNI methods each, 16 KiB LOAD alignment.`,
);
