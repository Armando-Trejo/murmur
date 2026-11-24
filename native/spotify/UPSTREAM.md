# Spotify engine provenance

Adapted from Lelonio/Square revision 139441f (2026-11-16), native/ directory.
Upstream: https://github.com/Lelonio/Square/tree/139441f/native
Square license: GPL-3.0; complete license retained at third_party/square/LICENSE.
Vendored librespot dependencies retain their own MIT licenses and patch descriptions.

MURMUR changes: crate/library renamed murmurspotify; JNI export namespace changed to
com.personal.murmur.spotify.SpotifyNative. Android output, authorization, service,
metadata and UI integration are implemented in the MURMUR Kotlin/TypeScript layers.
Builds target all four existing Android ABIs, API26, with 16KiB ELF page alignment.

## Rebuilding

Pinned tools: Rust 1.100.0, cargo-ndk 4.1.2, Android NDK 28.2.13676358,
Node.js, JDK 21 (Android sources target Java17). On Windows install Visual Studio
Build Tools with the C++ toolchain and Windows SDK for Rust host dependencies.
Install Rust targets aarch64-linux-android, armv7-linux-androideabi,
x86_64-linux-android and i686-linux-android with rustup. Install cargo-ndk with
`cargo install cargo-ndk --version 4.1.2 --locked`.

From the project root run `node scripts/build-spotify-native.mjs`.
The script uses the ignored .native-tools/cargo and .native-tools/rustup when
present, otherwise the installed toolchain. Set ANDROID_NDK_HOME if the pinned
NDK is not in .build-sdk/ndk. Gradle preBuild invokes the same script and tracks
the Rust inputs and four outputs. Cargo.lock is retained and --locked enforced.
`node scripts/verify-spotify-native.mjs` checks ELF machines, JNI exports,
system-only dependencies and 16 KiB LOAD alignment against the installed NDK.

The source and vendored patches under this directory accompany the APK. Keep
this source, its build instructions and third_party license notices with any
redistribution; the adapted Square code remains GPL-3.0. APK assets/licenses
also retains the upstream notices. This is not the complete Square app and covers only the native engine. The app separately adapts Square WebSdkEngine and
its page to use the official Web Playback SDK; it does not extract DRM keys.
NewTube's full SABR module remains outside this integration.
