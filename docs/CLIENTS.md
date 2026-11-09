# Browser and TV clients — 0.2.0

## Implemented surfaces

The approved Silver Signal designs are implemented with a React browser application and a native Kotlin/Media3 Android TV application. They use one server, one SQLite catalog and the existing media shares. No Plex client, desktop wrapper or separate playback service is required.

The browser is served at the server’s root URL, normally `http://UNRAID-LAN-IP:8777/`. It has account sign-in, profile selection/unlock, channel management, library browsing, collections, rotation/commercial configuration, preview/publish, subscriptions, account/profile permissions, sources/integrations, generation scope/jobs/cleanup, TV approval, device sessions and setup help. A viewer receives viewing/profile/session routes; server authorization remains authoritative for every request. Channel commercial settings include whole-file/cutoff policy and a minimum remaining time in seconds. New channels use cutoff with a six-second minimum; applying rules and publishing saves them. Existing configurations without a policy retain whole-file behavior. See [commercial timing](SCHEDULING_AND_PLAYBACK.md#cutoff-mode-and-minimum-remaining-time).

The TV application provides explicit server entry/help, one-time browser-approved pairing, profile selection, a 4–8 digit PIN keypad, a now/next guide, future guide browsing, live playback, audio/text-subtitle choices, local pause/resume/Go Live, adjacent-channel changes and Back navigation. It does not manage the media library. Android-based Fire OS uses the same APK without Google Play services. Exact Bravia and Fire OS hardware validation is a separate acceptance gate.

Channel setup asks for a full name and optional short name. Supplied short names have up to 12 characters. Blank uses up to four initials, or the first four characters of a one-word name. Supplied labels survive renames; automatic labels follow the new name. Neither label is a unique key. Internal UUIDs keep programming and subscriptions stable. Numbered Figma fixtures are superseded by this owner-approved behavior.

## Browser implementation

| File                        | Responsibility                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `web/src/App.tsx`           | Cookie sign-in/session restore, role navigation, profile selection/PIN and workspace                            |
| `web/src/api.ts`            | Same-origin fetch, in-memory CSRF refresh/retry, structured API errors/session expiration                       |
| `web/src/ui.tsx`            | Fields, asynchronous forms/actions, abortable reads, dialog focus, loading/error/empty states                   |
| `web/src/Channels.tsx`      | Channel identity, group order/modes/selectors, commercial rules, preview/publish, archive/restore               |
| `web/src/Library.tsx`       | Artwork, show/season/folder/provider/saved selections, grid/list and collection references                      |
| `web/src/Management.tsx`    | Accounts, profiles/grants/PIN, source scan/integration/refresh, subscriptions, generation, pairing and sessions |
| `web/src/Player.tsx`        | Guide, authenticated media session, direct/HLS player, controls, audio/text subtitles and delivery events       |
| `web/src/playback-utils.ts` | LAN-HTTP-compatible random event IDs and source-time WebVTT parsing                                             |
| `web/src/styles.css`        | Shared approved colors/fonts/layout/focus, 1440/1024/390px behavior and reduced motion                          |
| `web/vite.config.ts`        | Build output and optional development proxy                                                                     |

The browser stores no bearer credential in localStorage. Its HttpOnly session cookie accompanies original/range, playlist, segment, artwork and subtitle requests. Mutations send CSRF. Each fetched view has loading/error/retry behavior. Dialogs use native modal semantics and restore prior focus. The narrow channel list uses cards; wide layouts use the management table plus preview panel. Artwork remains server-authorized dynamic content. Missing artwork has an explicit placeholder rather than showing unrelated media.

IBM Plex Sans and Space Mono are bundled locally through their licensed font packages. Hls.js is loaded only when compatible HLS playback is needed. The production CSP allows same-origin code/fonts/requests and required blob media/workers; it permits no third-party scripts or media origins. Browser hash navigation avoids an API-catching SPA fallback.

Development: run `npm run dev` for the server and `npm run dev:web` for Vite, or `npm run build` then `npm start` to use the production root URL. Building a new set of hashed assets requires restarting a production server so its registered static routes match that build. Docker includes the matching assets and server in one image.

## TV implementation

The Android project is under `android/`, with application ID `tv.mytuner.app`, version name `0.2.0`, version code `2`, minimum SDK 23 and compile/target SDK 35. It is a universal managed-code APK: no application-specific native ABI libraries are packaged. Playback still depends on the TV’s platform decoders and operating system.

| File                       | Responsibility                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `MainActivity.kt`          | TV screens, remote focus/Back, lifecycle, guide and player orchestration                                                       |
| `LanApi.kt`                | Validated origin, bounded connection timeouts, authenticated API requests and encrypted token vault                            |
| `LanMediaSource.kt`        | Media3 data source authorizing every original/playlist/segment request, range support, transfer cleanup and redirect rejection |
| `CaptionRequests.kt`       | Current caption request identity and invalidation across selection, session, entry and delivery changes                        |
| `PlaybackMath.kt`          | Base/media URL validation, source/channel clock conversion and text cues                                                       |
| Android manifest/resources | TV/Fire launcher entries, banner, landscape presentation, networking and backup exclusions                                     |

Pairing stores only the saved server origin in ordinary preferences; its opaque device token is AES-GCM encrypted with an Android Keystore key. Authentication state is excluded from Android backup and device transfer. A new launch calls playback startup and asks for a profile/PIN again. Switching profiles clears only this device’s unlock/session state. Stopping the activity releases Media3 and leaves its playback session; other devices continue. An expired/revoked device token leads back to pairing.

HTTP is explicitly supported for trusted LAN deployments. HTTPS uses the system’s normal certificate verification. Every credentialed request must resolve to the saved server origin under `/api/`; redirects are rejected. No permissive TLS trust manager is installed. No hostname registration/discovery, router change or cross-VLAN rule is performed by the app.

Focus uses the approved mint fill/border against dark panels. The server address has an explicit Down-to-Connect path; OK opens the keyboard. The PIN is an on-screen numeric keypad. Guide rows focus current/next programs; OK always joins the channel live. In playback, media play/pause keys control the current session; directional keys restore hidden controls. Back first hides playback controls, then returns to the guide; guide/PIN return to profiles. Long or enlarged views scroll as you move focus with the D-pad. The OS keyboard retains its normal Back behavior.

## Playback integration and limits

Both clients create a fresh device-local playback session when tuning. They negotiate direct MP4/H.264/AAC-compatible delivery, otherwise request the server’s HLS fallback. Playback errors on a direct stream trigger a compatible-stream retry. HLS audio selection is propagated from authenticated manifests into applicable segment URLs; a different media file without that stream index uses its default audio.

Direct playback seeks to the returned source offset and switches at schedule boundaries. HLS contains timestamped intervals/discontinuities. Clients refresh session metadata, switch intervals/revisions, retain session heartbeats and stop fetching when locally paused. The native player retains its displayed frame while clearing media delivery so a pause does not leave a black screen. Resume uses the stored channel position; Go Live rejoins the live clock. Failed controls in either client reconcile against a fresh server descriptor before delivery resumes, including when the command applied but its response was lost; intentional server pause is preserved. Native controls keep remote focus while rejecting duplicate activation during reconciliation. Unavailable intervals retain their scheduled time and can recover when the next available interval begins.

Supported embedded text subtitles are fetched from the authorized server and mapped from source-media time across program/commercial intervals. External text files are discovered and advertised through the same authenticated track menu. Admins configure locations in Sources and review discovered/ambiguous/missing/unsupported tracks or check/save a manual association in Video details; viewers see authorized labels without server paths. [Subtitle setup](SUBTITLES.md) explains the flow. Stored technical metadata separately labels embedded streams. Browser fullscreen includes the video, captions and player controls in one stage. Native transient subtitle failures show “Subtitles unavailable. Select subtitles to retry.” while healthy video continues; reselect the track to retry or choose Off. Current authentication failures still return to authentication, and permission failures prompt authoritative reconciliation. Native responses apply only to the current caption request, so previous episodes, previous deliveries and repeated selections cannot replace newer cues or errors. Image subtitles/burn-in, broad HDR/codec coverage, fine-grained buffering/drift behavior and long-duration transitions need representative file/device acceptance. A successful synthetic clip does not prove every household format works.

Delivered intervals are reported only during actual client playback. Event IDs are random and idempotent; server-side overlap handling prevents inflated delivery totals. This is not proof that a person watched the screen.

## Build, checks and evidence

Browser: `npm run typecheck`, `npm run build`, `npm test`, `npm run test:smoke`, `npm run test:ui`. Browser visual baselines are under the corresponding `e2e/*.spec.ts-snapshots/` directories; generated reports/traces go to ignored `playwright-report/` and `test-results/`. Baseline review is intentional; do not update snapshots to hide a regression. The visual fixture freezes presentation dates and guide labels; functional journeys use the real server and synthetic FFmpeg files.

TV: with Java 17+ and an Android SDK, run `cd android` then `./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug`. The POC debug-signed artifact is `android/app/build/outputs/apk/debug/app-debug.apk`. Gradle/SDK/build caches, APKs and signing material are excluded from Git.

For deterministic emulator recovery smoke, start `MYTUNER_E2E_PORT=8790 MYTUNER_E2E_LONG_EPISODES=1 npx tsx e2e/server.ts`, install the APK on an Android TV emulator and run `MYTUNER_TV_TEST_SERVER=http://127.0.0.1:8790 MYTUNER_ADB=/path/to/adb npm run test:tv`. The test uses a temporary loopback fault proxy on port 8789; keep it free. See [the client test commands](DEVELOPMENT.md#client-commands). The script intentionally refuses physical-device serials, drives remote keys, approves pairing in a real browser and captures screenshots under `test-results/tv/`. Its temporary server uses a synthetic account/PIN and is never a household deployment. Stop it afterward. Use [TV_INSTALLATION.md](TV_INSTALLATION.md) for physical installation, signing/update differences and Unraid connection instructions.

[Local acceptance](LOCAL_ACCEPTANCE.md) documents the browser recovery/editor matrix, text/focus checks, scoped native state/visual/font-scale checks and real mixed-format/two-viewer browser playback. Historical native tracks/TalkBack results are distinguished from the deferred final-APK repeats. Native runtime modes use separate fresh synthetic fixtures. CI defines backend, macOS Chromium visual/functional and Android build/unit/lint jobs; no remote CI run is claimed. Results and external gates belong in [verification](VERIFICATION.md), [the checklist](CHECKLIST.md) and [differed](differed.md).

## Selected improvement foundations and UI boundaries

Existing approved layouts include fifth-round fixes: channels management refreshes Now/next in the background, editor reopen uses the latest channel identity, and native delivery/track menus reject stale results. Same-path browser refresh retains data and focus; profile/path changes clear old data. Native PIN entry now supports number/numpad buttons, Delete and explicit Enter through the existing keypad state. Pending unlock blocks duplicate submission; valid PINs still have four through eight digits and fresh launch still requires unlock.

Native and browser track menus retain preferred language per server/profile/device, match fresh indices on later delivery and fall back to default audio/off captions when unavailable. File-specific stream indices never become persistent preferences. Both clients expose caption size/background controls. Native connection help shows the saved origin, compatibility/error category and last successful health check; recovery actions use the existing connection/profile flows.

Phone approval links prefill only the public code. QR assistance leads to an authenticated device-review step and explicit Approve TV; no GET or QR scan approves a device. Playback context renders episode/progress/next/commercial timing while controls are open. The programming editor owns a single retained draft, including commercial inputs and exact preview/publication identity. The bounded source/type picker has show/season drill-down and keeps dynamic references. In-player browsing retains the session and pause until an explicit Watch live choice; leaving to the full guide retains its established leave semantics.

The selected collection editor retains unavailable references and stable identity. Library inspection can list retained missing episodes with disabled selection controls; default scheduling selections continue to exclude them. Administrator metadata modals provide independent title/description sources and cached availability with explicit file checks. Channel details include descriptions and revision guards. Setup/import/access/generation/status views connect the supporting service reports without changing source files.

See [design coverage](DESIGN_COVERAGE.md) for all 58 canonical frames/seven journeys and [the selected delivery checkpoint](SELECTED_IMPROVEMENTS.md#current-ui-delivery-checkpoint) for implementation scope. Browser and scoped native checks pass. Remaining emulator full recovery/tracks/TalkBack repeats were deferred at the owner’s request; physical-device, installed-provider, human and actual-host acceptance remain in [differed](differed.md).

## Current review limitations

The owner-selected R7-01–R7-04 are implemented locally. Collection inspector/delete dialogs are scoped to their captured resource, pool changes clear stale exclusions, valid restore handles damaged live keys, and TV profile choices serialize with pending/retry state. Older deferred findings and physical-device acceptance retain their checklist status.

## Selected seventh-round client flows

- Library deletion names the captured collection and offers Undo. Recently deleted lists expiry and Restore; normal browsing/pickers hide deleted IDs. No source files change.
- Programming captures server revision/null. Changed elsewhere preserves draft; Load latest explicitly discards, while Keep draft/review fetches a readable latest-publication summary and requires a new preview. Late responses cannot mark newer local edits saved.
- Browser guide/player and TV player → Recently aired show retained completed scheduled programs from the last two hours, episode/date/time and partial/empty wording. This is identification only; opening a dialog issues no playback control or replay.
- Browser/TV player → Report a problem → category → review exact bounded summary → explicit Send. Cancel submits nothing. Not sent/unconfirmed supports Retry with the same identity. Playback/pause continues independently; report preparation neither negotiates delivery nor changes session time.
- Browser Problem reports is the admin inbox (acknowledge/delete); Your reports is account-scoped for other roles and rechecks current access. Reports expire by configured age and count caps.

`web/src/Retained.tsx` contains these shared browser dialogs/inbox. Native `ProfileSelection.kt` owns one pending choice per profile screen; `UiTaskQueue.kt` skips obsolete pending UI work and gives startup/profile-select one process-owned serial lane across screen retries/Activity recreation; `MainActivity.kt` commits profile only after successful selection. Native dialogs use the existing Silver Signal controls and D-pad focus. Fresh launch/profile switching retains existing PIN requirements; no profile selection bypass or companion-controller policy is introduced. [TV installation](TV_INSTALLATION.md) still covers APK installation and connecting to Unraid.
