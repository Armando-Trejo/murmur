# MURMUR
<!-- impeccable:product-schema 1 -->
## Platform
android
## Stack
User specified: React 18, TypeScript, Vite, Tailwind, Framer Motion, Dexie and Capacitor 6; Kotlin, Media3 and NewPipeExtractor.
## Users
Personal Android listening, including screen-off playback, headphones and driving. The latest user instruction renames the product MURMUR and specifies its voice invocation.
## Product Purpose
One local library and queue for Spotify Premium and public YouTube audio, with non-destructive playlist overlays, discovery and DJ transitions.
## Capabilities and Constraints
No embedded secrets or bundled .env. The user supplied a public Spotify Client ID for library OAuth PKCE at 127.0.0.1:43821/callback. Version 1.5 extends Square's Rust/librespot motor for Premium playback inside MURMUR, using separate consent and encrypted credentials at 127.0.0.1:5588/login. Spotify Connect is an explicit external-player option. A cookie, library authorization and audio authorization are separate states. Providers may refuse audio keys; An explicit Integrado·Web alternative now adapts Square's official Web Playback SDK runtime with the user's own streaming OAuth, separate from librespot. No DRM keys are extracted; whole NewTube SABR remains unported. A dataSync foreground service keeps loopback authorization alive while the browser is open, with manual native-engine callback recovery. Spotui's ANDROID_MUSIC resolution and NewPipe recovery serve public YouTube audio. Android controls background microphone access. Private local test values stay excluded from builds; no authorized personal session or connected device is available. Public search/extraction/audio bytes and simulated native control states are tested; The user confirmed both audio sources work in 1.4 on the phone. New1.5 gesture/notification behavior remains unverified on hardware; screen-off voice is still unverified.
## Brand Commitments
MURMUR, com.personal.murmur; Spanish interface; AMOLED black/neutral surfaces with a user-configurable accent (default amethyst #B69AFF, presets/custom hex) for active controls and optional ambient light. User explicitly authorized color expansion in this request; original artwork remains in color. Album artwork and video thumbnails retain their original colors, per the user's 22 November 2026 correction. Supplied white logo and spaced wordmark; four bottom tabs. Spotify/Pure Tuber structure, monochrome source badges. A synthesized 75 Hz / 140 ms pulse confirms voice listening.
## Evidence on Hand
User briefs, a real screenshot of the 1.0 phone failure, and a public Spotify Client ID. A local credentials file was supplied and excluded from source control and builds. No actual imported user library or music artwork was available on this machine. UI test fixture tracks remain confined to automated browser test contexts. The 1.1 QA request requires no horizontal scrolling, safe areas, working home logo/routes, truthful dark status notices and smaller packaged resources.

## Current mobile refinement (1.5)
User supplied SONORA/Serene references as inspiration for colored accents, artwork and clean motion, not replacement branding. Preserve MURMUR logo and four destinations. Refine gestures with axis/zone ownership, browser/Android Back and Forward without duplicate routes, native media notification, real artwork, provider popularity/local listening sort, configurable accent/glow and reduced-motion song changes. Public album covers in automated QA remain outside the product.

## Interaction correction (1.6)
User clarified in1.7 that background/screen-off playback must continue. Only task removal stops playback/service and invalidates loads; Android owns process lifetime. This supersedes the1.6 visibility-pause interpretation. Preserve functioning Spotify/YouTube engines and sessions. Fix rapid navigation/listener churn, latest selection wins during skips, true repeatable upcoming shuffle independent from Auto-Mix, draft/commit queue drag with concurrent-change reconciliation, local seek thumb and bounded loading with cancel/retry. User requests subtle entry/scroll motion using Animate UI guidance; retain React18 and existing Motion runtime, use interruptible visible-default CSS/WAAPI tween rules and reduced-motion fades. Physical latency and60FPS still require the user's Android; browser fixtures are not personal library data.


## Collections2.0

User requests link imports for Spotify/YouTube playlist/mix/album, artist and album organization, local label switching and artist relevance pages. Implement full collection URL/Spotify URI validation, paginated metadata import, local transactional writes preserving offline paths, and explicit errors. Auth is required where the provider requires it. Dynamic mixes become snapshots. Artist pages combine available local album metadata with provider search, not guaranteed full catalog or personal algorithm. Old Spotify rows gain album fields on resync; local label overrides never modify remote collections.
