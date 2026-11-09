# Development and verification guide

## Repository boundaries

Work in this standalone checkout on `feature/standalone-foundation`. Its `AGENTS.md` excludes Pineapple/Airbnb conventions. Follow this project's npm/Node tooling. The earlier Python sidecar/proxy directories and legacy deployment files are preserved historical work; do not run their media-writing tools on the read-only standalone sources.

All current work remains local unless explicitly committed/published. Never add actual media, credentials, live database/key material, generated outputs or temporary test artifacts to Git. The owner approved Figma designs; version 0.2.0 implements browser and native TV clients.

## Setup and scripts

Use Node 24.13+ within major 24, npm and FFmpeg/ffprobe. Install dependencies with `npm ci`; the lockfile is authoritative. Node's built-in SQLite warning is expected on the supported runtime.

| Command                                                             | Purpose                                                                     |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `npm run dev`                                                       | Run server/API with built browser assets                                    |
| `npm run build`                                                     | Compile server to `dist/` and browser to `web-dist/`                        |
| `npm start`                                                         | Run compiled server; requires build first                                   |
| `npm run admin:create -- <username>`                                | Bootstrap first admin while server stopped; password comes from environment |
| `npm run typecheck`                                                 | Strict server/test and browser type checking                                |
| `npm run typecheck:server -- --noUnusedLocals --noUnusedParameters` | Additional unused-symbol checks used in foundation verification             |
| `npm test`                                                          | All node:test TypeScript backend tests                                      |
| `npm run test:coverage`                                             | Backend line/branch/function coverage through Node test runner              |
| `npm run test:smoke`                                                | Build and exercise compiled CLI/server lifecycle in disposable directories  |
| `npm run format:check`                                              | Prettier validation for configured code/docs/scripts/CI paths               |
| `npm run format`                                                    | Format configured paths; review its diff                                    |
| `npm run db:verify -- <snapshot-directory> [--json]`                | Validate a backup in private scratch without installing it                  |
| `npm run db:backup`                                                 | Consistent application snapshot                                             |
| `npm run db:restore -- <snapshot-directory>`                        | Offline application restore                                                 |
| `npm run docker:build`                                              | Build/load linux/amd64 package-version image                                |
| `npm run docker:test`                                               | Foreground disposable container harness with local appdata                  |
| `npm run docker:tag`                                                | Tag current version as latest; local mutation                               |
| `npm run docker:push`                                               | Publish version and latest; deliberate external action                      |

There is no separate ESLint/lint script in the current package; checks are strict TypeScript, formatting and behavioral tests. Browser functional/visual tests use Playwright; Android checks use Gradle. Before the first browser test run from the repository root:

```sh
npm run build
npx playwright install chromium
npm run test:ui
```

`npm ci` installs the test library but does not guarantee the Chromium executable is present. On Linux, use `npx playwright install --with-deps chromium` when system browser dependencies are also needed. Browser download/system package installation needs network access. See [CLIENTS.md](CLIENTS.md) for commands, modules and current limits.

## Local demo with mock data

Run from `~/Code/tmp/myTuner` with the normal Node 24/FFmpeg/ffprobe prerequisites:

```sh
npm ci
npm run dev:demo
```

This command builds the matching server/browser and runs the existing real-server synthetic fixture in demo mode, listening only on `127.0.0.1:8788`. Open `http://127.0.0.1:8788/`. It needs no Docker, Unraid, Plex or actual Sonarr/Radarr service. To choose another port, use `MYTUNER_E2E_PORT=8789 npm run dev:demo`.

| Account    | Password                     | Role / use                                                                          |
| ---------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| `designer` | `synthetic-browser-password` | Admin; explore setup, account/profile/source management and all channels            |
| `sam`      | `synthetic-viewer-password`  | Editor assigned to Living Room; verify another owner's private channel stays hidden |
| `other`    | `synthetic-other-password`   | Editor owning Other Profile and its private channel                                 |

Seed data includes Living Room and Other Profile, a TV source with two short synthetic H.264/AAC episodes with two language-tagged audio tracks, the ordered After School channel subscribed to Living Room, and a separate private channel without programming. The video is a generated test pattern/color with tones. Artwork placeholders are expected. No profile PIN is set initially; configure one in Profiles to try unlocking. A separate Synthetic commercials source contains one twelve-second generated ad and is granted to Living Room; commercials remain off until explicitly configured. No movie catalog or live integration is seeded in this small fixture.

Useful manual journeys:

1. Sign in as designer, choose Living Room and open Watch TV → After School → Watch live. Try pause/resume/Go Live and selecting the other audio track.
2. Open Library, inspect Orbit Patrol/seasons/episodes and use the whole show in a channel. Configure its name/short name and rotation, preview/publish, and subscribe Living Room.
3. Create a reference collection, use **Edit collection** to change its members, inspect unavailable references and use it in programming. Its identity remains stable when membership changes.
4. Explore accounts, profiles/PINs, source scanning, generation preview/jobs and TV approval. Scanning the temporary source restores filename-derived metadata, so the hand-seeded show/title labels can change; generated outputs stay temporary.
5. Sign out and use sam to inspect permitted-profile and private-channel behavior.

The demo uses a newly created OS temporary directory for its database, media, generated assets and cache on each start. Normal Ctrl-C/SIGTERM closes the server and removes that directory. A forced kill can leave that particular temporary directory behind. All edits disappear when restarted; this is intentionally separate from the persistent `npm run dev` application and its `.data` roots. The shared fixture is also used by automated browser tests, which run on 8787 with isolated browser sessions. Keep the demo's default 8788 when running tests alongside it.

For frontend hot reload, keep the demo running and start a second terminal:

```sh
MYTUNER_API_TARGET=http://127.0.0.1:8788 npm run dev:web -- --port 5173 --strictPort
```

Open `http://127.0.0.1:5173/`. Vite serves the frontend source and proxies `/api` to the same temporary backend. Its normal target remains 8777 when `MYTUNER_API_TARGET` is unset. Changes to frontend files reload here; backend fixture/service edits require restarting the demo. The built browser on 8788 requires rebuilding/restarting for frontend changes.

For automated checks run `npm test`, `npm run typecheck` and `npm run test:ui`. The UI suite owns a separate synthetic fixture on 8787 and includes screenshot comparisons. See [CLIENTS.md](CLIENTS.md) for the native emulator checks. Physical TV access requires the separately documented reachable server/device setup; this loopback-only demo is for local browser/emulator use.

## Source navigation

Read [architecture](ARCHITECTURE.md) for the complete module map. Start with `src/main.ts` for runtime lifecycle, `src/server.ts` for composition/major routes, `src/identity-routes.ts` for login/PIN/pairing and `src/foundation-routes.ts` for library/programming/guide. `src/contracts.ts` supplies validated request shapes and core JSON Schemas.

Services receive a Store and explicit roots/dependencies. Several tests inject fetch/probe/clock/encoder dependencies; production uses actual Node/FFmpeg implementations. Do not add a second database owner or long async work inside a synchronous Store transaction.

## Meaningful test layers

| Tests                                                        | Behavior covered                                                                                                  |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `scheduler.test.ts`, `programming.test.ts`                   | Ordering, deterministic state, commercial limits, dynamic selectors, revisions, edits and catch-up                |
| `catalog.test.ts`, `integrations.test.ts`, `refresh.test.ts` | Real temporary filesystem/catalog, metadata schemas, path maps, refresh/outages and encrypted persistence         |
| `security.test.ts`, `identity.test.ts`                       | Credentials, scope, membership, PIN/pairing, CSRF and revocation                                                  |
| `server.test.ts`, `lifecycle.test.ts`                        | Real HTTP route journeys, setup, authorization and management lifecycle                                           |
| `playback.test.ts`, `ranges.test.ts`                         | Per-device clocks, event accounting, range boundaries and historical permissions                                  |
| `streaming.test.ts`, `artwork.test.ts`                       | Actual synthetic media/HLS/text tracks and restricted upstream artwork behavior                                   |
| `generation.test.ts`                                         | Real outputs, fingerprints, queue/restart, cancellation, quota and cleanup                                        |
| `backup.test.ts`, `recovery.test.ts`                         | Real SQLite backup, migrations, integrity, locking, rollback and interrupted restore                              |
| `display-metadata.test.ts`                                   | Source choices, NFO safety/availability, identity/revisions, outage policy and backup persistence                 |
| `docker.test.ts`                                             | Shell-free process/argument boundaries, timeout/cancellation, source/image identity and cleanup; no Docker engine |
| `scripts/smoke.mjs`                                          | Compiled bootstrap/server/backup/restore, session revocation, restart and SIGTERM                                 |

Tests use temporary directories and runtime-generated synthetic media. They do not download or commit a personal library. Loopback upstream fixtures establish request behavior; they do not certify the user's installed Sonarr/Radarr versions. Server output inspection does not establish actual browser/TV buffering or transition quality.

Use boundary tests for UTC intervals/source offsets, seeded state across appends/restarts, cross-account privacy and replacements/revocation. New database behavior should exercise real migrations/transactions. New media behavior should verify source hashes remain unchanged and worker cleanup does not leak child processes.

### Try a cutoff commercial in the demo

The demo registers a separate **Synthetic commercials** source containing a twelve-second generated clip and grants Living Room access. Commercials remain off on After School until explicitly configured. Open Channels → After School → Edit programming → Commercials, select the synthetic commercial source, use a 50-percent fixed mid-roll position, set maximum clips to one and maximum duration to ten seconds, choose cutoff mode with minimum six seconds, apply rules, review the preview and publish. Edits activate after the current airing. Watching the channel then plays only ten seconds of that twelve-second commercial and resumes the original episode. A break budget of six seconds skips the commercial completely at that minimum. Preview intervals make these outcomes easy to inspect without waiting for playback. Restarting the disposable demo restores the original no-commercial channel.

## Contracts and changes

`GET /api/contracts` returns version 1 with JSON Schemas for selections, programming/break rules and core account/profile/media/channel/schedule/playback responses. It requires authentication and is not a comprehensive OpenAPI route/security/error specification. Route descriptions and examples live in [BACKEND.md](BACKEND.md).

Public JSON is camelCase, metadata is an object, and artwork references are authorized server URLs. Preserve IDs rather than using labels as keys. Requests use catalog IDs for media, with explicit admin source-root configuration. If a contract changes, update runtime validation, implementation, meaningful tests, client-facing documentation and version/compatibility decisions together.

Append schema migrations; never change a released migration to redefine old data. Test upgrade from older snapshots, failure rollback and future-schema rejection. Keep network/filesystem/encoding outside short synchronous DB transactions. Preserve retained revision behavior and the separation of management authority from a viewing PIN.

## Before considering a change verified

Run relevant behavioral tests, strict type checking, formatting and build as appropriate. Use compiled smoke for runtime/CLI/recovery changes. `git diff --check` catches whitespace issues. For dependency changes, inspect the lockfile and run the production audit. Update the checklist and verification record with what actually ran and what remains untested.

The supplied GitHub Actions workflow defines backend install/format/typecheck/tests/compiled smoke, macOS Chromium functional/visual checks and Android build/unit/lint jobs. Coverage and audit are available local checks. The workflow does not publish images or certify Docker/hardware. No remote CI result is implied before a push.

## Client verification and remaining hardware acceptance

Maintain browser functional end-to-end journeys, keyboard/screen-reader review, component/page visual baselines at approved viewports and TV screenshot/focus regressions using fixed synthetic content. Exercise pairing, profile/PIN launch, subscriptions, private-channel absence, source outage, local pause/Go Live and commercial transitions.

Use a real browser player and Media3 harness for authenticated dependent requests, buffering/reloads, audio choice, subtitle timing, commercial return offsets, drift and unavailable intervals. Validate exact Bravia/Fire OS models; Vega is outside the supported target. Measure concurrent viewers, server CPU/network/disk and long-duration behavior. These are acceptance gates, not coverage-percentage goals.

Current actual evidence is recorded in [VERIFICATION.md](VERIFICATION.md); remaining work is in [CHECKLIST.md](CHECKLIST.md).

## Client commands

- `npm run dev:web`: Vite development server with same-origin API proxy.
- `npm run test:ui`: real-server Chromium journeys, accessibility and reviewed visual baselines.
- `npm run test:ui:update`: intentionally regenerate visual baselines for review.
- `cd android && ./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug`: signed POC APK, JVM tests and Android lint.
- `npm run test:tv`: remote-input emulator smoke; requires the disposable synthetic server and an installed emulator APK. For deterministic same-program recovery, start the fixture with `MYTUNER_E2E_PORT=8790 MYTUNER_E2E_LONG_EPISODES=1 npx tsx e2e/server.ts`, then run `MYTUNER_TV_TEST_SERVER=http://127.0.0.1:8790 MYTUNER_ADB=/path/to/adb npm run test:tv`. The script binds a temporary loopback fault proxy at 8789, enters `http://10.0.2.2:8789` on the emulator and forwards to the selected server. Keep 8789 free. It injects an initial join failure and polling outages, checks remote Retry, actual advancing delivery within the same entry, and preservation of intentional pause, then closes the proxy. The longer episodes are generated only in this explicitly selected disposable fixture. Stop that fixture afterward; normal browser/demo episodes stay short.

## Selected improvement regression coverage

`test/improvements.test.ts` exercises real SQLite and HTTP/service behavior for checkpoint commands, diagnostics, lineup ordering/migration, copy drafts, admin setup/status/access/mapping, integration reports, bounded private search, playback context, generation reuse, collection edits, safe phone prefill and session-preserving guide reads. It also verifies draft request identity against late preview/publication responses. These service tests do not substitute for complete UI state, visual and accessibility acceptance.

The browser suite adds real saved-identity reopen and controlled-time idle-guide regressions with the current browser baselines listed in [CLIENTS.md](CLIENTS.md#build-checks-and-evidence). Native JVM guards cover delivery/menu identity, numeric PIN bounds/duplicate submission, language fallback and API compatibility. The emulator harness additionally holds actual delivery/caption responses and exercises open-menu interval changes. Ten reviewed native baseline images cover nine surfaces: connection, profiles, PIN, guide, join error, playing/paused controls and paused browse/caption dialogs. [Local acceptance](LOCAL_ACCEPTANCE.md) describes crops, masks and accessibility limits. Physical TV/Fire acceptance is separate.

Run `node --import tsx scripts/benchmark-library.mjs` to generate isolated 10k/50k in-memory catalogs. Optional integer arguments choose sizes up to 200,000 rows. This creates synthetic database references, not media files or copies of household catalogs. Record timings, JSON size and RSS alongside dataset/query; do not treat local measurements as throughput/Unraid guarantees.

### Sixth-round browser fixture isolation

The original browser journeys use the synthetic API at 8787. `e2e/round6.spec.ts` uses an independently started synthetic API at 8786 so earlier scan/search/edit journeys cannot change metadata used by its inspector/readiness snapshots. Playwright starts and stops these fixtures plus the isolated mixed-format acceptance fixture on 8791. The manual demo remains on 8788. Native fault tests use their own long-episode fixture on 8790 plus the loopback fault proxy on 8789; install the current debug APK before running them. No test fixture is a household source or production server.

For a focused native R6 check after building/installing the current APK, start a separate fixture with `MYTUNER_E2E_PORT=8790 MYTUNER_E2E_LONG_EPISODES=1 node --import tsx e2e/server.ts`, then run `MYTUNER_TV_TEST_SERVER=http://127.0.0.1:8790 MYTUNER_TV_AVAILABILITY_ONLY=1 npm run test:tv` with `MYTUNER_ADB` pointing to the SDK adb when it is not on PATH. This mode verifies source availability, pause, initially unavailable joins and fresh-launch PIN; omit the availability flag for the longer poll/control/late-caption flow. Both modes target disposable emulators only. Stop the fixture/emulator after completion; physical-device acceptance remains separate.

## Prepare a disposable TV emulator

Use Android Studio Device Manager to create a **Television** virtual device with an Android TV system image supported by your host CPU (ARM64 on Apple Silicon, x86_64 on typical Intel hosts). Install that image and the SDK platform-tools/emulator components, then start the AVD and finish its first boot. These downloads require network access; first setup is not an offline operation. Build the current debug APK with the commands in [TV installation](TV_INSTALLATION.md#build-the-installable-poc-apk).

Run these commands from the repository root with SDK platform-tools on PATH:

```sh
adb devices -l
adb -s emulator-5554 shell getprop sys.boot_completed
adb -s emulator-5554 install -r android/app/build/outputs/apk/debug/app-debug.apk
```

Wait for boot status `1` and a ready `device` entry. If your serial differs, replace `emulator-5554` above and pass `MYTUNER_TV_SERIAL=emulator-XXXX` to the harness. `MYTUNER_ADB=/absolute/path/to/adb` selects the tool when it is not on PATH. The harness accepts emulator serials only, clears the app's synthetic pairing state, and never targets physical TVs.

Build server/browser before starting the fixture. In one terminal start a **fresh** fixture:

```sh
MYTUNER_E2E_PORT=8790 MYTUNER_E2E_LONG_EPISODES=1 node --import tsx e2e/server.ts
```

In a second terminal run the selected-profile/recent/report/lifecycle regression:

```sh
MYTUNER_TV_TEST_SERVER=http://127.0.0.1:8790 MYTUNER_TV_SERIAL=emulator-5554 node e2e/tv-round7.mjs
```

The harness owns fault proxy8789; the emulator uses `10.0.2.2` to reach the host. Keep both fixture/proxy ports free and leave demo8788/Vite5173 alone. Restart the fixture between independent harness runs because tests mutate their disposable accounts/reports. Do not rebuild hashed browser assets while the fixture is running; rebuild first, then restart it. After testing, stop the fixture with Ctrl-C and shut down the owned AVD using Device Manager or `adb -s emulator-5554 emu kill`. Screenshots/results are git-ignored under `test-results/`; only the reviewed images explicitly compared by `nativeVisual` are native regression baselines.

## Docker script tests and native visual subset

`npm test` includes Docker command/identity/cleanup regressions with a stub process boundary. They require no Docker engine and do not establish image build/runtime behavior. Actual packaging follows [the Windows guide](WINDOWS_DOCKER.md).

The API34 ARM64 1920×1080 Android TV emulator has ten synthetic native baseline PNGs for nine surfaces under `e2e/tv-baselines/android-tv-api34-arm64`. Set `MYTUNER_TV_VISUAL=1` during the full native smoke to compare the nine surfaces. Paused browsing selects the reviewed specimen for its exact synthetic Now/Next pair; both episode orders have a baseline. `MYTUNER_TV_VISUAL_ONLY=1` stops at PIN and compares only the first three; it explicitly does not exercise playback. `MYTUNER_UPDATE_TV_BASELINES=1` deliberately rewrites images; inspect the results before normal comparisons. Clock/live-status masks remove volatile presentation; control/dialog crops exclude moving video and leave the surrounding frame to separate functional/geometry checks. The tolerance remains 0.5% of pixels beyond a 20/255 channel difference. [Local acceptance](LOCAL_ACCEPTANCE.md) details the covered regions, independent video/caption checks and physical limits.

For a separate large-text/service check, restart the disposable fixture, install the current APK, then run:

```sh
MYTUNER_ADB=/path/to/adb MYTUNER_TV_TEST_SERVER=http://127.0.0.1:8790 MYTUNER_TV_ACCESSIBILITY_ONLY=1 node e2e/tv-smoke.mjs
```

This requires the installed TalkBack package on the disposable emulator. It uses font scale 1.3 and a long synthetic profile name, verifies the accessibility hierarchy and bound TalkBack service, then checks D-pad focus. Previous emulator font/service settings are restored even on failure. It does not human-review audible speech. Do not combine it with tracks/visual-update modes. Stop and restart the synthetic fixture between runs and shut down only the owned emulator afterward.

## External caption and mixed-format native integration

Build the server/browser and Android APK first; install the APK only on the disposable emulator. With no other fixture on 8790/proxy on 8789, start a fresh synthetic server:

```sh
MYTUNER_E2E_PORT=8790 MYTUNER_E2E_LONG_EPISODES=1 MYTUNER_E2E_MIXED_FORMATS=1 node --import tsx e2e/server.ts
```

Then run:

```sh
MYTUNER_ADB=/path/to/adb MYTUNER_TV_TEST_SERVER=http://127.0.0.1:8790 MYTUNER_TV_TRACKS_ONLY=1 node e2e/tv-smoke.mjs
```

The script retains its emulator-only serial guard and resets only the emulator app plus disposable fixture state. It pairs through the browser, sets/enters a profile PIN, creates an isolated channel through normal APIs and checks real external captions, measured caption bounds above opaque controls, pause without delivery, audio2 authenticated HLS segments, Go Live, actual program→truncated-commercial→source-offset-program and MP4→MKV/HLS playback. It writes ignored `test-results/tv/tracks-result.json` and a native screenshot; this is a functional/geometry check, not a new approved pixel baseline. The standard full native recovery mode remains separate and still uses label-based synthetic fault-track selection. Restart the synthetic server between modes; keep demo8788/Vite5173 untouched.

`e2e/subtitles.spec.ts` covers responsive search settings/manual association, dirty/failed-save recovery, real external-caption/audio/commercial playback and reviewed cleanup recovery. Snapshot timestamps are normalized only in test responses; the real discovery/conversion paths still execute. Review new/changed screenshots before accepting baselines.

## Native state and font-scale audit

`e2e/tv-states.mjs` extends the native smoke with connection failures/offline/unreadable/incompatible responses, pairing pending/expiry/retry, profile failure/empty/retry, wrong PIN, denied/empty guide, recent-airing states, report preparation/send/retry, browse failure/empty, connection check, track menus and cancelled forget-pairing confirmation. It sends actual D-pad/OK/Back/number key events to the guarded disposable API34 emulator, using a loopback-only synthetic fault proxy. It never targets a physical device. Install the current cached-toolchain build first and use a fresh8790 fixture between independent modes.

```sh
MYTUNER_ADB=/private/tmp/mytuner-android-tools/sdk/platform-tools/adb \
MYTUNER_TV_TEST_SERVER=http://127.0.0.1:8790 \
node e2e/tv-states.mjs

MYTUNER_ADB=/private/tmp/mytuner-android-tools/sdk/platform-tools/adb \
MYTUNER_TV_TEST_SERVER=http://127.0.0.1:8790 \
MYTUNER_TV_STATES_LARGE=1 node e2e/tv-states.mjs
```

Normal mode compares reviewed synthetic pixel baselines. `MYTUNER_UPDATE_TV_BASELINES=1` intentionally replaces them; inspect captures and repeat normal comparisons afterward. Dialog comparisons use their measured native panel bounds to exclude moving background video. Changing pairing codes/QR, report IDs/times and last-health timestamps are full semantic/screenshot review specimens, not stable pixel baselines. The large-text mode sets only the disposable emulator font scale to1.3 and restores the previous value in `finally`; it runs the same semantic/remote journeys and saves separate captures without replacing normal-size baselines. The dedicated TalkBack smoke still checks the installed service binding and focus; audible narration remains human acceptance. Never run two ADB/Uiautomator harnesses concurrently on the same emulator.

Native tracks mode alternates delivered caption language metadata between equivalent `eng` and `en` labels while retaining real authenticated caption bodies. It verifies preference continuity through renegotiation, commercial return and the MP4→MKV/HLS transition. JVM checks cover the complete platform ISO mapping, bibliographic/deprecated aliases and fallback/locale behavior.

The existing demo8788 and Vite5173 are preserved. Tests use their own disposable8786/8787/8789/8790/8791 ports; never rebuild hashed browser assets during a fixture run or reset a demo to run tests. New host software/toolchain components still require explicit owner approval. [Differed](differed.md) records the remaining external acceptance.

### Focused enlarged pairing regression

Use `MYTUNER_TV_PAIRING_ONLY=1 MYTUNER_TV_STATES_LARGE=1` with the documented `e2e/tv-states.mjs` command and a fresh loopback fixture. It checks QR completion, expanded errors, expired-code Retry and real browser approval, including the complete visible height of the focused action. It stops at profiles and restores the previous font setting. This is a targeted regression, not a replacement for the full state/recovery modes. Hierarchy collection uses the emulator’s existing `timeout` utility: a finished XML dump is accepted after its lingering VM is reaped; a timed-out read without a completed dump retries once. Mutating remote input is not automatically repeated.
