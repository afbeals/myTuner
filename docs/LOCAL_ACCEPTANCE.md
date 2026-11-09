# Local UI and playback acceptance

This record covers the unreleased 0.2.0 / schema 16 POC on the developer Mac, Chromium and an API 34 ARM64 Android TV emulator. [Verification](VERIFICATION.md) records complete executed runs. [Pilot acceptance](PILOT_ACCEPTANCE.md) remains the checklist for actual Unraid, Bravia and compatible Fire OS devices. Synthetic files do not establish household format, HDR, throughput or overnight reliability.

## Approved design review

All 58 canonical Figma references were retrieved and reviewed against the implemented screen families and their state specimens. [Design coverage](DESIGN_COVERAGE.md) maps those frames and seven journeys. Names/short names, ten-hex pairing codes, separate editors and the previously approved extensions remain intentional adaptations. Browser and native screenshots are regression baselines for the implementation; they are not 58 independent pixel matches to Figma.

This acceptance pass corrected profile lookup being mistaken for an empty account, unsafe blank integration forms after failed loads, missing account/session empty states, generic network/HTML errors, dialog keyboard escape, discarded ordinary form drafts, cramped narrow tabs/account tables, missing clear-filter/refresh recovery, generation cancellation/progress/focus, and native error placement/large-text button sizing. Source files, metadata sidecars and original captions remain read-only.

## Browser state and interaction coverage

`e2e/acceptance.spec.ts` uses an independent mixed-format synthetic server at 8791. Ordinary application APIs remain unchanged. Browser-only request interception holds or fails selected requests; it does not add application test endpoints.

| Surface              | Acceptance exercised                                                                                                                                 | Additional existing regressions                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Channels             | Loading,503,403, retry and successful empty results; an error does not claim the network is empty                                                    | Independent details/programming drafts, stale saves, preview/publication conflict, archived visibility, private access                     |
| Library              | Loading,503,403, retry, empty search, Clear filters, retained catalog during refresh/outage; explicit permission loss clears retained results        | Show/season/filename lookup, unavailable selections, collection edits/Undo/dependencies, metadata choices, subtitle inspection/association |
| Accounts             | Loading,503,403, retry, empty list, failed account draft, close confirmation, Tab/Shift+Tab containment and focus restoration                        | Roles, owner lookup, permitted profiles and concurrent duplicate-account API creation                                                      |
| Profiles             | Pending/failed lookup never offers first-profile creation; retry and 401 return to sign-in                                                           | Profile access/PIN, delayed owner choices, effective access and long-name layouts                                                          |
| Sources/integrations | Loading,503,403, retry, empty source list; failed settings lookup exposes no blank integration save form; failed edits retain entered values         | Scans/import reports/mapping, subtitle location drafts, invalid metadata checks and read-only discovery                                    |
| Subscriptions        | Loading,503,403, retry and no available candidates                                                                                                   | Independent guide ordering, private catalog boundaries, unsubscribe and paused-session consequences                                        |
| Generation/storage   | Loading,503,403, retry, empty jobs, completed-output count, progress, retained keyboard focus across polling, explicit cancellation and failed retry | Measured scope/reuse, actual FFmpeg cancellation/retry/admission and reviewed storage cleanup/stale-review rejection                       |
| Devices/sessions     | Loading,503,403, retry, empty list and readable offline/non-JSON gateway errors                                                                      | Explicit revocation and account/device lifecycle                                                                                           |
| Reports/operations   | Loading,503,403 and retry; empty report inbox                                                                                                        | Preview/submit idempotence, cancellation, retention, setup/backup/access help                                                              |
| Guide/player         | Guide loading,503,403, retry and empty lineup                                                                                                        | Real media/captions, fullscreen, independent pause, lost control replies, source failure/retry and unavailable intervals                   |

Every matrix surface includes a narrow screenshot and axe WCAG2A/AA/2.1AA audit for its error state; applicable successful empty states have their own screenshot/axe checks. Existing suites cover desktop/compact/narrow happy paths and editor variants. Long-name tests use valid bounded strings; account tables intentionally scroll horizontally inside a labelled keyboard-focusable region. Browser text is enlarged to200% without bypassing the application's Content Security Policy. These automated checks do not certify spoken screen-reader narration or every browser/assistive-technology combination.

Shared dialogs trap keyboard traversal within the active modal, guard dirty or pending ordinary forms, and restore opener focus. Editors with their own revision/navigation guard retain that guard. Confirmations explain whether completed generation outputs remain or an in-flight save may still finish. Loading/failure does not silently replace saved integration values.

The follow-up code review added logout/expiry regressions for private library drafts and confirmed that explicit resource links still pass through sign-in/PIN under current grants. Delayed interrupted-restore recovery now has three journal-race regressions. The [ranked review register](IMPLEMENTATION_REVIEW.md#tenth-round-findings-and-disposition) records the subsequent selection of R10-04–R10-13 and the subsequently corrected R10-03. New service/browser/executor tests and held-request/paused-cue native assertions cover those selected corrections; final executed results are in VERIFICATION.md.

## Nested editor recovery and narrow layouts

The follow-up `e2e/editor-states.spec.ts` adds nine journeys and seven reviewed narrow screenshot baselines. [The state inventory](UI_STATE_AUDIT.md#nested-browser-editor-follow-up) records each surface and its limits. Collection dismissals now ask once and retain rejected drafts; subtitle Cancel clears the actual draft guard; retrying a video lookup cannot submit an unfinished collection. Existing collection loads, programming selection and next-episode lookup exercise held/error/permission/empty recovery while preserving their current values or parent checkpoint. Tests verify focus containment and return, absence of unintended writes and axe results.

Narrow dialog Close buttons retain a readable single line. Exposure history explains an empty result and provides readable columns in a labelled keyboard-scrollable region. Its synthetic populated row verifies scheduled/started counts and delivered seconds independently; arrow-key traversal reaches the delivered-time cell. The screenshot is captured before keyboard scrolling starts. The surrounding channel list is restricted to this test’s synthetic channel to keep the capture independent of earlier tests. Three older narrow baselines were reviewed and refreshed for the shared header correction, with unchanged comparison tolerance. Full-run counts and diagnostic details belong in VERIFICATION.md.

These checks extend the matrix above. The final nested/native additions below complete the defined local scope; human/device acceptance remains D11b/P5 and differed.md.

## Playback acceptance

`e2e/playback-acceptance.spec.ts` creates an isolated private channel through ordinary APIs using synthetic MP4 and MKV episodes plus an oversized commercial. Its two independent authenticated browser contexts verify:

- Real authenticated selected-audio HLS segments; a held segment is released after three seconds and playback advances again.
- Real external caption bodies/cues, independent audio and pause state, a retained paused picture/time, and Go Live on only the selected viewer.
- A bounded90-second repeated mixed-format/commercial run, with a browser reload/rejoin during that run, advancing video at the end, both program identities and commercial intervals observed, and explicit session deletion when leaving.

Existing suites additionally check truncated midroll duration and exact resumed source offset, caption clearing/restoration across breaks, direct/HLS pause pixels, fullscreen cues, failed/lost controls, late descriptors, source recovery, generation/playback admission and shutdown. Native tracks mode independently exercises Media3 MP4→MKV/HLS, selected audio, external captions, pause/Go Live and truncated commercial return with measured caption/control bounds and video pixels.

This is bounded local concurrency/endurance evidence. The90-second check is not a six-hour soak or a decoder/HDR matrix. Actual media, network delay, server load and physical-device behavior remain pilot work.

## Native visual and accessibility checks

`e2e/native-visual.mjs` compares reviewed synthetic API 34 ARM64 emulator baselines at 960×540. The tolerance remains 0.5% changed pixels with a20/255 per-channel threshold. Baselines cover connection, profiles, PIN, guide, readable join failure, playing controls, paused controls, paused channel browsing and caption appearance.

The original ten PNG baselines cover these nine surfaces: paused browsing has two visually reviewed specimens for the synthetic episodes swapping Now/Next. The harness selects the specimen from that exact displayed pair; it does not mask the titles or relax comparison tolerance. The selected R10 smoke also holds profile selection before server delivery, retries the profile screen and checks that new startup waits; paused cues must survive poll recovery, Retry and audio changes without media negotiation. The production queue has JVM regressions for obsolete request backlogs and cross-screen mutation ordering.

Masks cover header clocks, guide timestamp glyphs and the changing live/behind-live status strip in the playing-controls capture. Playing/paused comparisons crop the opaque control panel; browse/caption comparisons crop their dialogs so moving video cannot create false changes. Separate assertions inspect the unmodified frame/hierarchy for actual video, cues and error/control geometry. A cropped control baseline does not verify video pixels or the full surrounding layout by itself.

`MYTUNER_TV_VISUAL=1` enables these comparisons in the full recovery smoke. `MYTUNER_TV_VISUAL_ONLY=1` deliberately stops at the initial PIN screen and therefore compares only the first three baselines. `MYTUNER_UPDATE_TV_BASELINES=1` deliberately updates images; review them before running normal comparisons.

The separate `MYTUNER_TV_ACCESSIBILITY_ONLY=1` smoke mode changes only the disposable emulator's font scale to 1.3, uses a long synthetic profile name, verifies that name in the accessibility hierarchy, enables the installed TalkBack service and checks remote focus with the service bound. It restores previous font/service settings in a finally block. Its result explicitly records that audible narration has not been human-reviewed. Do not combine this mode with pixel-update or tracks-only mode. Build/install the current APK and restart the disposable fixture between modes.

Physical display/text readability, actual spoken feedback, Fire accessibility behavior, all remote models and representative fonts/scripts require the owner/device acceptance in D11/N25/P5. No Mac accessibility settings, physical device or household network is changed by these emulator checks.

## Repeating the checks

From the repository root, run `npm run build` before starting fixtures. Then use `npm run test:coverage` and `npm run test:ui`; the latter starts/stops ports 8787, 8786, 8791 and 8792. Port 8792 is the isolated long-program external subtitle fixture; other browser fixtures keep their original durations. Keep demo 8788 and Vite 5173 alone. Never regenerate hashed browser assets while a fixture is serving its cached HTML.

Native build/preparation, exact emulator commands, isolated fixture8790/fault proxy8789 and cleanup are in [Development](DEVELOPMENT.md). Native full, tracks and accessibility modes each need a fresh synthetic fixture and the current installed APK. Stop owned fixtures and the emulator after the checks. No runtime media/database, APK, debug signing key or test report belongs in Git; reviewed screenshot baselines are synthetic PNG files only.

## Final nested and native state completion

[The final state inventory](UI_STATE_AUDIT.md#final-local-browser-and-native-inventory) is the authoritative per-family scope. Nine additional browser journeys cover nested inspection/editing/access/import/report views, exact TV approval and the schema 16 manual-refresh health states; five deferred-finding browser regressions cover retained guide focus and report identities/late replies. The complete browser comparison suite passes88 journeys against 70 reviewed PNG baselines.

The expanded native state audit adds 24 captured states and 20 stable PNG baselines across 19 surfaces. Existing ten PNGs cover nine earlier surfaces, yielding 30 PNGs across 28 stable surfaces. Five dynamic specimens—pairing, report review/retry/success and connection details—retain full screenshots/hierarchies and semantic assertions rather than baselining changing codes, IDs or check times. Stable dialogs are cropped using measured `parentPanel` bounds and normalized to 960×540; whole startup screens retain the existing clock mask. No new text masks or relaxed tolerances are introduced.

The subtitle-menu variant follows the actual paused program and exact available tracks. Complete normal and enlarged-text state journeys passed before the final pairing-only focus fix. The affected pairing flow then passed on the final APK with visible-action geometry assertions and real browser approval. The current full recovery repeat passed six visual comparisons before the UiAutomator inspector failed; final tracks/alias and TalkBack repeats were not completed. The owner deferred further emulator verification. Full screenshots remain separate from normal-font pixel baselines, and previous emulator settings were restored.

The local gaps found in this final pass were missing explicit profile/guide loading messages and technical native transport/JSON failure text. They now have readable pending/network/unreadable-response states. An uncertain report test sends a real committed report, suppresses its reply and verifies Retry produces exactly one inbox record. A test navigation correction follows the app's intended Back hierarchy: close dialog, hide controls, then return to guide. No production navigation change was needed.

All six corrections and backend/browser verification are complete in 0.2.0 / schema 16; native verification is partial, with remaining emulator work deferred at the owner’s request. Actual narration, physical TV models/OS/displays/remotes, representative media, Windows Docker/Unraid/providers and longer endurance remain [external follow-ups](differed.md). This is bounded local evidence, not certification of every frame/state permutation.
