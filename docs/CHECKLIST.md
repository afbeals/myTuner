# myTuner implementation checklist

This is the delivery source of truth. `[x]` means implemented and verified, `[ ]` means not complete. Do not check an entire product capability merely because its types or a unit-test mock exist. Record verification commands and known limitations in VERIFICATION.md. Add newly discovered work to the appropriate section.

The [open software audit](OPEN_SOFTWARE_AUDIT.md) distinguishes delivered implementation/local verification from intended-host and human acceptance. All six remaining findings and backend/browser verification are complete; scoped native evidence is under N98/N99 and remaining emulator work is deferred under N100; [differed](differed.md) collects external work. Older numbered review/checkpoint entries preserve the status at their original pass; the current phase and final handoff sections supersede their pending labels.

## Foundation and documentation

- [x] F01 Clone afbeals/myTuner into ~/Code/tmp/myTuner.
- [x] F02 Create feature/standalone-foundation; preserve legacy history without a tag.
- [x] F03 Document product overview, flows, boundaries, and phased implementation.
- [x] F04 Create comprehensive delivery/acceptance checklist.
- [x] F05 Create self-contained browser and TV design brief.
- [x] F06 Establish server project, reproducible dependencies, formatting/typecheck/test commands.
- [x] F07 Establish domain contracts, schema migrations, and HTTP error conventions.
- [x] F08 Label old deployment and sidecar workflow as legacy, not current instructions.
- [x] F09 Document local setup, admin bootstrap and disposable test harness.
- [x] F10 Publish documentation index, architecture/technology guide and complete current database dictionary/migration reference.
- [x] F11 Document Sonarr/Radarr/custom discovery, source mappings, dynamic membership and metadata/removal limits.
- [x] F12 Document application responsibilities, account/profile/device journeys, scheduling/playback and privacy model.
- [x] F13 Document operational budgets/runbooks, backup/restore/update, troubleshooting, development/test strategy and architecture decisions.
- [x] F14 Cross-check documentation against source, validate local documentation links/table coverage and format all project documentation.
- [x] F15 Document Bravia/Google TV and Fire OS installation, Unraid address/port setup, pairing, update/removal and diagnosis; consult official platform references.
- [x] F16 Preserve supplied Figma handoff/review links and record current API differences, including pairing-code format.

## Design workstream — no product UI before approval

Supplied draft/handoff received: see [DESIGN_REVIEW.md](DESIGN_REVIEW.md). It reports 58 canonical frames and seven journeys. The owner has explicitly approved the designs; implementation is now authorized. The checked design deliverables are present in the owner-approved handoff and retrieved screen contexts. Browser and scoped native state/font/pairing checks pass under D10/D11a/N98/N99. Remaining emulator checks are deferred under D11d/N100; human/physical acceptance remains D11b/P5.

- [x] D01 Reconcile owner-approved user flows with current contracts; record approved channel labels/pairing adaptations and the 58-frame/seven-journey mapping in DESIGN_REVIEW.md and DESIGN_COVERAGE.md. This closes reconciliation, not D10/D11 acceptance.
- [x] D02 Create Figma information architecture and reusable components/tokens.
- [x] D03 Design onboarding, accounts, profiles, permissions, and source setup.
- [x] D04 Design library cards/lists, season/episode drilldown, custom folders, collections.
- [x] D05 Design channel builder, rotations, commercials, guide preview/publish.
- [x] D06 Design profile subscriptions and owner/admin channel management.
- [x] D07 Design generation scope preview, queue/progress, retry/cancel/errors.
- [x] D08 Design browser guide/player, behind-live state, pause/Go Live.
- [x] D09 Design TV pairing, profile unlock, guide, player, remote navigation.
- [x] D10 Complete the defined browser/native state audit: top-level browser families, nested editors/inspection/approval and native connection/profile/PIN/guide/player/dialog recovery, empty/loading/error/offline/forbidden/destructive specimens. Concrete gaps corrected; per-state evidence and comparison limits are in UI_STATE_AUDIT.md and LOCAL_ACCEPTANCE.md.
- [x] D11a Browser keyboard/focus,1440/1024/390px, long text/200-percent layouts and scoped native D-pad/font scale 1.3 checks pass. Current TalkBack repeat is deferred under D11d; earlier evidence is historical.
- [ ] D11b Human spoken accessibility and actual Bravia/Fire display/remote acceptance; follow differed.md and the physical pilot. Automated focus/axe/service-binding checks do not certify narration.
- [x] D12 Obtain Figma links, component specs, prototype flows, and explicit owner design approval.

## Accounts and authorization

- [x] A01 Bootstrap first admin locally; no public registration or default password.
- [x] A02 Admin-created accounts with admin/editor/viewer roles; password hashing.
- [x] A03 Revocable expiring sessions, login throttling, safe errors, logout.
- [x] A04 Personal/room profiles, owner and account grants, management permissions.
- [x] A05 Secure TV device pairing and PIN unlock with attempt limits.
- [x] A06 Source/subtree grants and catalog filtering without leaking paths or counts.
- [x] A07 Private channels hidden from every other user; admin can inspect/subscribe.
- [x] A08 Authorize manifests, originals, previews, derivatives, segments, and history.
- [x] A09 Revoke active/new access when account, profile, subscription, or source grants change.
- [x] A10 Browser session/CSRF strategy, LAN HTTP behavior, and credential rotation.

## Catalog and integrations

- [x] L01 Sources with stable IDs, explicit kinds, configurable recursion.
- [x] L02 Read-only scan with containment checks and no symlink escape.
- [x] L03 ffprobe actual duration, audio/video metadata, bounded probe failures.
- [x] L04 Upsert files by source/path and fingerprint; detect replacements/removals.
- [x] L05 Preserve previous availability on root outage or incomplete scan.
- [x] L06 Read-only Sonarr series, seasons, episodes, files, images, path mapping.
- [x] L07 Read-only Radarr movies, files, artwork, collection metadata, path mapping.
- [x] L08 Multi-episode files, missing episodes, specials, duplicate source detection.
- [x] L09 Local metadata/NFO and filename fallback; unmatched media usable.
- [x] L10 Search/filter/page catalog; show/season drilldown and folder selection contracts.
- [x] L11 User collections referencing media; collection/source authorization.
- [x] L12 Automatic refresh jobs with concurrency limits, errors, retry, no duplicate scans.
- [x] L13 Offline integration retains previous imported metadata and usable catalog.

## Channels, schedules, and commercials

- [x] S01 Unique channel IDs, shared/private ownership, names are not keys.
- [x] S02 Profile subscriptions restricted by visibility and source permissions.
- [x] S03 Ordered/shuffle/random rotations with per-show episode sequence.
- [x] S04 Persist exact integer-millisecond UTC intervals and source in/out offsets.
- [x] S05 Mid-roll timestamp/percentage/random positions and between-program breaks.
- [x] S06 Commercial count/duration caps, repeat allowance 1/2/3+, per-break caps, cooldowns.
- [x] S07 Impossible break shortens; no unconfigured repeats or infinite loop.
- [x] S08 Persist per-channel rotation/random state across builds and restarts.
- [x] S09 Rolling schedule generation, atomic activation, schedule preview, revisions.
- [x] S10 Edit after current program+breaks; retain revisions for paused sessions.
- [x] S11 Unavailable interval preserves timing; empty sources have explicit behavior.
- [x] S12 Separate scheduled airing counts from delivered playback/exposure.
- [x] S13 Bounded multi-day/long-idle schedule catch-up preserves committed progress and timeline; returns 503 for extreme catch-up until later maintenance/retry.

## Playback services

- [x] P01 Resolve live interval/media offset, including during commercials and at boundaries.
- [x] P02 Authorized direct-file byte ranges, seeking, HEAD, MIME, disconnect cleanup.
- [x] P03 Playback sessions with device-local pause/resume/Go Live.
- [x] P04 Switching/leaving/reopening returns live; another device stays unaffected.
- [x] P05 Retain paused timeline/source fingerprints; fail safely on source replacement.
- [x] P06 Capability negotiation and on-demand conversion for supported fallback formats.
- [x] P07 Demand-based FFmpeg lifecycle, idle cleanup, limits, optional shared jobs.
- [x] P08 Browser direct/HLS delivery and Android Media3 direct-video/timeline/offset emulator harness; representative native HLS/track transitions remain N17.
- [ ] P09 Complete track delivery and mixed-format/commercial transition acceptance; embedded/external text tracks are delivered, while representative client/format acceptance remains below.
- [x] P09a Embedded alternate-audio selection via authenticated HLS and embedded supported text-subtitle extraction/delivery; browser/native menus and local source-time/failure regressions. Management Video details lists stored embedded tracks.
- [x] P09b Read-only external subtitle discovery beside videos/in subdirectories, configurable subtitle locations, manual association and management discovery status; N83–N89 below.
- [ ] P09c Complete native HLS/mixed-format/audio/caption/commercial boundary verification and browser transition/soak gaps under N10/N17/N26; synthetic browser/native direct/HLS/audio/caption/commercial and native MP4→MKV checks now pass; representative format/device and soak acceptance remains.
- [x] P10 Playback event ingestion and delivered intervals without double counting.
- [ ] P11 Real Bravia validation; exact Fire OS model validation; no claim for Vega.

## Optional generated assets

- [x] G01 Admin chooses directory, shallow/recursive, thumbnail/GIF/conversion outputs.
- [x] G02 Preview affected authorized files before starting; validate settings.
- [x] G03 Persist bounded background jobs, progress, per-item failures, cancellation/retry.
- [x] G04 ffmpeg thumbnail/GIF generation outside sources.
- [x] G05 Compatible reusable conversion outside sources, disk-space checks.
- [x] G06 Fingerprinted output reuse, explicit regenerate, atomic publication.
- [x] G07 Derived-asset permissions, original changes, retention/cleanup controls.
- [x] G08 Never trigger bulk generation automatically on adding a source.

## Persistence and operations

- [x] O01 SQLite foreign keys, migrations, WAL/transactions, persisted schedules.
- [x] O02 Consistent backup/restore, integrity checks, migration safety backup.
- [x] O03 Separate data/generated/cache roots; reject overlap with media sources.
- [x] O04 Health, structured redacted logs, graceful shutdown and job cleanup.
- [x] O05 Supply standalone Dockerfile/Compose with read-only media and linux/amd64 build target.
- [x] O06 Versioned build/test/tag/publish scripts following Tide/Finapp.
- [x] O07 No source media, secrets, databases, or generated assets in Git/image context.
- [ ] O08 Verify Docker build/runtime health, restart persistence, update and rollback.
- [ ] O09 Verify generated/cache cleanup and restored-volume reconciliation under actual Unraid pressure/interruption; software delivery is O09b/O09c and target-host rehearsal is N20.
- [x] O09a Generated/cache quotas and free-space guards, automatic managed HLS cleanup and explicit stale generated-asset dry-run/cleanup are implemented and locally tested.
- [x] O09b Bounded serialized artwork/subtitle age/LRU cache eviction with budget/free-space admission, fresh-partial preservation, old interrupted-output reclamation and symlink/authority tests.
- [x] O09c Bounded generated orphan/stale/missing/interrupted-output reconciliation, reviewed token-guarded dry run/apply, generation exclusion, interruption/retry and containment/authority tests. Missing-output regeneration stays explicit; actual restored-volume verification stays N20.

## Browser and TV implementation — approved designs

- [x] U01 Approved component library and browser navigation.
- [x] U02 Admin onboarding/accounts/profiles/source management.
- [x] U03 Library selection, collection creation/edit/deletion, rotations, commercials, preview/publish; saved membership editing verified under N27.
- [x] U04 Subscriptions, private profile channels, generation management.
- [x] U05 Browser guide/player with accessible pause and Go Live states.
- [x] U06 TV pairing/profile/guide/player, deterministic D-pad focus and Back behavior.
- [x] U07 Defined local browser/native screen-family state audit from D10 complete: retry/recovery, permission failures, destructive confirmation, retained drafts/focus and targeted functional/visual evidence. Inventory and limits are in UI_STATE_AUDIT.md; human/device acceptance stays D11b/P5.

## TV installation and Unraid connection delivery

- [x] I01 Write TV-first installation/connection guide and record the actual local APK, server/browser endpoint and remaining device acceptance.
- [ ] I02 Record exact Bravia model/OS and Fire stick model/OS; confirm Android APK compatibility and exclude Vega from this client route.
- [x] I03 Build a signed installable TV APK; document actual build/download path, package/version/min SDK/ABIs/checksum and preserve signing keys outside Git.
- [x] I04 Implement TV/Fire launcher entries/banner without touchscreen or Google-service dependencies; Android TV emulator remote/LAN HTTP flow verified. Actual Bravia/Fire OS acceptance remains I05/I06/I09.
- [ ] I05 Install/launch on the actual Bravia using its supported ADB transport and capture correct menu/port instructions for that model.
- [ ] I06 Install/launch on the actual Android-based Fire stick; validate its developer/installation settings and launcher.
- [ ] I07 Enter/save/edit the reachable Unraid base address and published host port; handle LAN HTTP/trusted HTTPS, DNS, offline and changed-address failures.
- [ ] I08 Complete real TV-to-browser pairing with the returned code, startup/profile PIN and subscription-only guide; reconcile the six-character Figma fixture with the current ten-hex-character API.
- [ ] I09 Validate authenticated direct/HLS/subtitle requests, commercial transitions, local pause/Go Live and independent second-device playback on both targets.
- [ ] I10 Verify signed APK updates preserve intended app state; clear-data/uninstall, token expiry/revocation and server restore give a working re-pair path.
- [ ] I11 Publish actual artifact/version-specific installation instructions and device acceptance evidence before calling TV delivery complete.

## Comprehensive verification

- [x] T01 Unit: ordering, millisecond arithmetic, timeline boundaries, seeded randomness.
- [x] T02 Unit: commercial constraints including one-item pools and impossible limits.
- [x] T03 Integration: real SQLite transactions, migrations, restart persistence.
- [x] T04 Integration: synthetic Sonarr/Radarr services, outage, path mapping and combined episodes.
- [x] T05 Filesystem: recursion, symlinks, outages, removal/replacement, original hash unchanged.
- [x] T06 API: roles, cross-account/private enumeration, subtree access, invalid input/ranges.
- [x] T07 Generation: cancellation, partial files, stale fingerprints, unauthorized assets.
- [x] T08 Server playback: real FFmpeg fixtures, ranges/offsets, local pause/resume, idle/shared encoders, worker cleanup; client acceptance stays in P08/P09.
- [x] T09 Browser end-to-end: seven core management/viewing/privacy/collection/label/audio journeys after design approval; broader state/soak acceptance remains U07/N26.
- [x] T10 Browser visual regression: reviewed sign-in/library/channel baselines, including 1440/1024/390px layouts; full native/frame/state review remains N25.
- [x] T11 Synthetic native visual/focus evidence:30 reviewed PNGs across 28 stable surfaces,19 accepted state comparisons,24 enlarged-text states and final-APK pairing focus regression. The final full recovery repeat is incomplete under N100.
- [x] T11a Defined local native state/pixel, D-pad and font-scale review; dynamic IDs/timestamps use semantic/screenshot specimens. Current assistive-service repeat is deferred under N100.
- [ ] T11b Physical remote/display and human spoken accessibility acceptance; model/OS details and steps are in differed.md.
- [ ] T12 Real-device compatibility and concurrent viewers; no hardware claims based on mocks.
- [x] T13 Local operations: backup/restore, failed migration/restore rollback, quota pressure and interrupted recovery; Unraid update rehearsal remains O08.
- [x] T14 Test media generated at runtime; visual placeholder content; artifacts excluded from Git.

## Separate follow-ups (outside software build)

- [ ] X01 Record router/AP models, SSIDs/VLANs, and narrow TV-to-Unraid access needs.
- [ ] X02 Configure/test cross-network routing/firewall/DNS without merging networks.
- [ ] X03 Optional model-specific TV cleanup with before/after responsiveness measurements.
- [ ] X04 Measure throughput and investigate hardware transcoding if needed.

## Newly discovered contract and hardening work

- [x] N01 Standardize public response casing and expose machine-readable programming/selection requests and core response schemas; validate them against HTTP responses.
- [x] N02 Persist integration configuration/keys securely; add periodic refresh without losing prior metadata.
- [x] N03 Dynamic show/season/folder/collection selectors above the explicit-ID scheduler; expose filtered available/special counts.
- [x] N04 Separate subscription-only guide from available-channel candidates.
- [x] N05 Add account disabling/session revocation and source/profile grant removal endpoints with immediate open-stream policy.
- [x] N06 Bound generation disk usage, queued jobs and process time; add list/retry APIs and explicit stale-output cleanup.
- [x] N07 Playback heartbeat expiration and old-revision retention/garbage collection.
- [x] N08 Pre-migration safety backup and tested full application restore; never treat image rollback as schema rollback.
- [ ] N09 Confirm runtime UID/GID and read-only share access on Unraid without changing source-library ownership.
- [ ] N10 Complete browser/native transition integration acceptance. Browser direct/HLS playback and selected commercial/paused recovery, plus native direct-video episode transitions, have local evidence. Repeatable synthetic native HLS/audio/external captions, truncated commercial return and MP4→MKV boundaries now have integrated emulator evidence. Representative files/devices and broader drift/soak acceptance remain; server timeline tests alone are insufficient.
- [ ] N11 Validate installed Sonarr/Radarr versions and successful-removal/reassociation policy on real imports. Public upstream contracts were inspected; nullable Radarr fields and source-scoped IDs are covered locally.

- [x] N12 Artwork proxy/cache for Sonarr/Radarr image references with source permissions and integration credentials kept server-side.

## Current backend pass and remaining integration gates

Core non-UI services have local implementation/test evidence. This does not close all software work: external subtitles (N83–N89) and cache/reconciliation software (O09b/O09c) are now delivered; the defined local UI/client matrix is complete; human/device D11b/N10/N17 and actual-host O09/N20 remain open. Checked server items do not certify browser/TV playback or Unraid operation. The owner-approved browser/native POC is present; local integration and target-host acceptance are tracked separately.

- [x] N13 TV fresh-launch/profile-switch API clears only that device’s unlock/playback state; pairing persists and PIN-protected profiles unlock before the subscribed guide.
- [x] N14 Owner/admin channel rename, privacy, archive and restore; archived channels stop viewing/maintenance and retain IDs/configuration.
- [x] N15 Embedded supported text streams: authenticated source-time WebVTT delivery with cancellation, cache/disk/output bounds and unchanged originals. External files also use protected source-time delivery; see N83–N89.
- [x] N16 Repeatable compiled-process smoke: bootstrap, health/auth, concurrent-owner rejection, online backup, restore/session revocation, restart and graceful shutdown.
- [ ] N17 Finish browser/Media3 HLS reload/discontinuity, mixed-format, alternate-audio and subtitle-cue/commercial transition acceptance. Browser real authenticated alternate-audio segments and pause suppression, plus native caption/control/error-recovery emulator tests, are already evidenced. Repeatable synthetic native HLS/mixed-track/commercial boundary coverage now passes; representative-file/device and broader reload/buffering/drift acceptance remain. See OPEN_SOFTWARE_AUDIT.md.
- [ ] N18 Image-subtitle burn-in and broader codec/HDR support only where representative real files/devices require them; fixed CPU HLS preset is the current fallback.
- [ ] N19 Long-duration/concurrency/disk-pressure soak on actual Unraid hardware; measure catch-up throughput and select history/active-schedule retention policy before household use.
- [ ] N20 Reconcile restored source mounts and missing generated files on actual volumes; current fingerprints reject stale media and explicit scan/regeneration repairs references.

## Client delivery details added during implementation

- [x] N21 Version 0.2.0: optional short-name override, deterministic fallback on setup/rename, browser/TV display and migration/privacy tests.
- [x] N22 Browser collection picker across permitted sources; test reference-only creation without source changes.
- [x] N23 Single-media details, admin integration-mapping reads, authenticated HLS audio propagation and browser static/CSP behavior.
- [x] N24 Signed debug APK, native unit/lint checks, emulator remote-flow proof and install/update instructions with actual artifact metadata/checksum.
- [x] N25a Defined native state/pixel/font-scale evidence:30 baselines/28 stable surfaces plus five dynamic specimens. Current TalkBack repeat remains deferred under N100.
- [ ] N25b Human spoken output, physical remotes/displays and target-TV accessibility; follow differed.md.
- [ ] N26 Browser interval/commercial/audio/subtitle soak plus decoder/HDR tests on representative household files.
- [x] N27 Saved-collection rename/membership editing, retained unavailable references, search, failed-save retry and stable-ID browser/API regressions.

- [x] N28 Local disposable mock-data demo command, separate test/demo ports, optional frontend hot reload and documented sign-in/watch/reset flow.

- [x] N29 Commercial cutoff/whole-file policy and configurable strict minimum (default six seconds); persist/reload, repeat/cooldown limits, bounded real HLS/source hashes, browser controls/visual baseline and actual program resume. Physical-device/long-duration acceptance stays under N17/N26.

- [x] N30 First six-agent review: fix confirmed security, scheduling, streaming, browser, native and operational defects; record review findings and regression coverage.
- [x] N31 Second six-agent review: rank findings P0–P3, correct/retest every confirmed P0/P1, and retain P2/P3 for owner prioritization.

- [x] N32 Owner selected R2-03–R2-08: implement expired-channel replacement, browser join Retry/pending-preview invalidation, native poll recovery/join Retry, and interrupted fresh-target restore recovery. See VERIFICATION.md for completed regression evidence.
- [x] N33 Three-agent functional/UI/UX improvement research consolidated in IMPROVEMENTS.md; fourteen proposals after deduplication, with scope/effort/design needs. No speculative enhancements implemented.
- [x] N34 Six fresh independent reviewers after the recovery fixes completed; no new P0/P1 or P3 confirmed. Nine P2 findings are recorded in IMPLEMENTATION_REVIEW.md for owner selection.
- [x] N35 R2-02 concurrent login-burst throttling corrected in the approved pilot-critical phase, with deterministic regression.
- [x] N36 R3-01 normalized source-grant deletion and R3-06 native pairing-poll recovery corrected and tested. R3-08 browser guide focus was subsequently corrected under P3b/N96.
- [x] N37 Selected third-round fixes: R3-02/R3-03/R3-04/R3-05/R3-07/R3-09; selectable fallback seasons, atomic generation admission, failed-control reconciliation in both clients with native remote-focus retention, revision-bound saved status and active-stream shutdown. Verified with 171 backend tests, 11 browser journeys/six unchanged visual baselines, seven native JVM tests, full fault-injected TV emulator flow and compiled lifecycle smoke. See VERIFICATION.md for limits.

- [x] N38 Second three-agent improvement research: browser UX, TV viewing and functional additions; six new proposals I15–I20 and refinements to existing scopes documented in IMPROVEMENTS.md. Product/design changes await selection.
- [x] N39 Fourth six-agent bug review: security, programming/discovery, delivery/generation, browser, native TV and operations. No new P0/P1; nine P2 and one P3, with source/probe evidence and priority in IMPLEMENTATION_REVIEW.md. Backend baseline 171 passed.
- [x] N40 Owner selected and implementation completed for R4-01–R4-10: consistent mixed-season ordering/cursors, pending-PIN invalidation, safe generation cancel/Retry, drained streaming setup, preserved profile owner, fullscreen captions, nonblocking/native current-request captions, configuration-bound integration refresh and actual authorized filename search. Current N35/N36 dispositions are recorded above; remaining deferred work stays under P3b.
- [x] N41 Fourth-round regression verification: 181 backend tests, 14 browser journeys/six unchanged visual baselines, nine native JVM tests, Android build/lint, real TV emulator subtitle-failure/late-response flow, type checks and compiled lifecycle smoke. Physical-device/Unraid and native pixel-baseline acceptance remain open; see VERIFICATION.md.

- [x] N42 Third three-agent feature/UI/UX research completed: all earlier twenty proposals surfaced with seven new I21–I27 and a recommended shortlist. New suggestions cover in-player browsing, sleep timer, start-over, consecutive episodes, group mid-roll policy, duration filters and browser profile memory; IMPROVEMENTS.md contains scope, effort, design needs and acceptance.
- [x] N43 Fifth six-agent bug review completed: nine new P2 and two P3, no new P0/P1 confirmed. Parent independently reproduced nine runtime findings and inspected two native source findings; full backend baseline 181 passed. IMPLEMENTATION_REVIEW.md records priorities, evidence, fixes and workarounds.
- [x] N44 Owner selected R5-02–R5-11 and twenty proposals I01–I16/I18/I19/I21/optional I24; R5-01 and selected earlier deferred findings are now corrected under P3; P3b records the subsequent correction of the remaining backlog. [Selected delivery plan](SELECTED_IMPROVEMENTS.md) and [focused design handoff](SELECTED_DESIGN_BRIEF.md) record scope and the approved reuse of the existing visual system.
- [x] N45 All ten selected fifth-round fixes verified: 209 backend tests, 16 browser journeys/six unchanged visual baselines, 14 JVM tests, Android build/lint, extended held-delivery/stale-menu/caption/numeric-PIN emulator run, type checks and compiled lifecycle smoke. Physical-device/native pixel/Unraid gates remain open.
- [x] N46 Implement selected programming foundations: stable group identity, optional 1/2/3 turns, one-time ordered checkpoint commands, commercial preview diagnostics, lineup order and private independent draft-copy API.
- [x] N47 Implement selected admin/service foundations: collection details including unavailable references, bounded picker, setup/access/mapping/status APIs, integration reports, generation preflight and playback context. Tests cover API/service behavior; full product capabilities remain below.
- [x] N48 Benchmark synthetic 10k/50k catalogs and record response/time/memory limits; grouped aggregation still visits authorized catalog.
- [x] N49 Connect selected screens using the approved Silver Signal extension direction; browser functional/axe/screenshot and native JVM/build/emulator evidence. Full visual/assistive-technology/physical acceptance stays P2g/P5.

- [x] N50 Sixth six-agent bug review completed: five P2 and three P3, no new P0/P1. Parent reproduced synthetic service/browser/helper evidence and recorded native source-only limits in IMPLEMENTATION_REVIEW.md; fresh backend baseline 209 passed. Application source remained unchanged.
- [x] N51 Fourth three-agent feature/UI/UX research completed: ten new optional I28–I37, all 37 proposals surfaced, existing-ID refinements and considered/deferred alternatives recorded with scope, effort, evidence and acceptance in IMPROVEMENTS.md. No new proposal was automatically selected.
- [x] N52 Owner selected R6-01–R6-05: browser boundary response guards, native same-entry availability recovery, retained pending starting state, publication-aware live-next context and unconditional present-key validation. R6-06/R6-07/R6-08 were deferred at that checkpoint and subsequently corrected under N96.

- [x] N53 Seventh six-agent bug review completed: four new P2, no new P0/P1/P3. Parent reproduced programming, restore and fully intercepted browser evidence, reran extracted native scheduling/backend policy checks and 39 authorization/privacy checks. Fresh full backend baseline: 222 passed. Application/test/visual files unchanged.
- [x] N54 Fifth three-agent functionality/browser/admin/TV research completed: six distinct optional I38–I43, plus existing-ID refinements and every considered/deferred category in IMPROVEMENTS.md. No new proposal automatically selected.
- [x] N55 Owner selected R7-01 (priority), R7-02–R7-04 and I38/I39/I40/I42/I43. I41 remains optional; eight older deferred findings and earlier screen/device backlog retain their status.

## Selected improvement delivery — twenty proposals

The current implementation/status is in SELECTED_IMPROVEMENTS.md. Checked items below describe locally verified software; the stated target-provider/device/scale/full visual gates remain unchecked in their dedicated entries.

- [x] E01 I01 Existing collection edit UI, retained unavailable references, failed-save/search handling and stable-ID browser journey.
- [x] E02 I02 Readable commercial preview explanations and separate scheduled/started/delivered exposure view; service/browser checks.
- [x] E03 I03 Ordered-group restart/start-at controls, confirmation and boundary-safe publication; service/browser checks.
- [x] E04 I04 Import reconciliation report UI wired to bounded retained reports; no automatic metadata detachment. Installed-provider completeness/removal acceptance remains N11.
- [ ] E05 I05 Real library scale/concurrency acceptance; assess stable database pagination from measured demand.
- [x] E06 I06 QR assistance, explicit signed-in device review/approval and manual-code fallback; local browser/native/JVM checks. Actual phone/TV/network acceptance remains P5.
- [x] E07 I07 Browser/native language preferences and caption size/background controls, with default/off fallback. Representative track/format transitions remain N17/P5.
- [x] E08 I08 Browser/native controls display episode/progress/next/commercial context and retained paused time; local tests/emulator checks.
- [x] E09 I09 Accessible Move up/down lineup controls, stored complete order and both-client guide projection; local API/browser checks. Physical remote acceptance remains P5.
- [x] E10 I10 TV connection help, compatibility/error categories, last-success state and existing recovery actions; native helper/build/emulator checks.
- [x] E11 I11 Guided setup checklist and readable mapping/scan reports for optional integrations/custom roots; local browser/API checks.
- [x] E12 I12 Target-account effective-access/readiness UI including admin exception and device/browser PIN distinction; local authorization/browser checks.
- [x] E13 I13 Generation scope/reuse preflight, progress and per-item failure UI with conservative unknown estimates; local generation/browser checks. Actual disk-pressure acceptance stays P5.
- [x] E14 I14 Read-only operational/backup visibility and no-backup/runbook states; local browser/API checks. Backups remain operator-triggered.
- [x] E15 I15 One controlled draft retains unsubmitted commercial inputs, exact preview/publication identity and dirty-close/navigation protection; browser regressions.
- [x] E16 I16 Bounded source/type picker, show/season drill-down, keyboard/loading/saved references; local browser/API regressions.
- [x] E18 I18 Numeric PIN input and explicit Enter through the native keypad; JVM/emulator evidence. Physical remotes remain P5.
- [x] E19 I19 Create-from-channel requires a new name/profile, defaults private/unpublished and cancels without leftover publication; browser/API checks.
- [x] E21 I21 In-player browse preserves session/pause until explicit Watch live; browser/emulator checks. Physical remote/accessibility acceptance stays P5.
- [x] E24 I24 Optional 1/2/3 episodes-per-turn control and preview; omitted defaults to one. Chunk/checkpoint and browser regressions.

## Sixth-round selected improvements

- [x] E28 I28 Collection dependency report, privacy-filtered counts, paging, refresh and delete confirmation; retained airings/source files remain intact.
- [x] E29 I29 Shared playback/subtitle/background encoder admission, interactive reservation/fairness, generation waiting UI, cancellation and replayable shutdown.
- [x] E30 I30 Admin stored-metadata readiness report from selections/channels, shared routing decision, bounded examples and explicit unknown/caption/hardware limits; zero playback/generation side effects.
- [x] E31 I31 Channel-local commercial eligibility controls/counts, draft preview/publication boundary, all-disabled early return and re-enable without source changes.
- [x] E33 I33 Stable channel/collection links, copy action, reload/Back/Forward, sign-in/PIN continuation, privacy/unavailable states and dirty-channel discard guard.
- [x] E34 I34 Stored video metadata and track inspector, exact duration, source-relative filename copy, focus return and desktop/narrow visual regression.
- [ ] E38 Physical Bravia/Fire, representative media and Unraid contention measurements for these additions; existing deployment/device/accessibility/soak gates remain open.

## Seventh-round selected implementation

- [x] N56 R7-01 priority: bind inspector/delete intent to collection context; browser regression.
- [x] N57 R7-02: keep retired commercial exclusions inert; clear exclusions on pool changes.
- [x] N58 R7-03: restore a validated bundle despite damaged live encryption key; preserve forensic bytes.
- [x] N59 R7-04: serialize TV profile selection, pending state and retry.
- [x] N60 I38: private scratch backup-verification CLI, validation/cleanup regressions and runbook.
- [x] N61 I39: authorized read-only two-hour recently aired lookup, browser and TV.
- [x] N62 I40: explicitly reviewed sanitized problem reports, bounded retention/idempotency, admin inbox, browser and TV.
- [x] N63 I42: seven-day configurable deleted collection retention, Undo/list/restore and expiry.
- [x] N64 I43: atomic revision precondition, draft-preserving conflict/review UI and regressions.
- [x] N65 Selected R7 documentation and local verification: 238 backend tests, 26 browser journeys/13 visual baselines, 16 JVM tests, Android build/lint, real emulator selected-feature/lifecycle regression, type checks and compiled smoke. New R8 decisions and physical/earlier screen gates remain open.

I41 is unselected. Defaults for this implementation are seven days for deleted collections and thirty days for problem reports, configurable by server environment. Selection does not close earlier unfinished screens/device acceptance.

## Eighth-round review and research

- [x] N66 Six independent bug reviews completed; one P1 corrected, three P2 and one P3 recorded separately for selection. No new P0 confirmed.
- [x] N67 Three independent functional/browser/TV research reviews completed; optional I44–I47, existing-ID refinements and considered/deferred alternatives surfaced.
- [x] N68 R8-05: clear activity-owned dialogs on native screen/stop boundaries, preserving fresh-launch profile/PIN requirements; emulator regression and Android checks.
- [x] N69 R8-01/R8-02/R8-04 are corrected and locally regression-verified under P3. R8-03 was subsequently corrected under P3b/N96; optional I44–I46 remain unselected. Expanded I47 is delivered locally; physical acceptance remains separate.

- [x] N70 Three independent documentation/readability audits completed and concrete gaps corrected; FIRST_CHANNEL.md and DOCUMENTATION_REVIEW.md record onboarding, operations and technical corrections. Source-checked handoff does not close physical deployment acceptance.

## Expanded I47: editable descriptions, titles and metadata sources

- [x] N71 Owner selected/expanded I47; record modal flow, per-field source priority/selection, quick availability, read-only originals and stable scheduling boundaries in METADATA_EDITING.md.
- [x] E47a Schema 14 channel descriptions/details revisions and source-separated display choices/manual values; migration, authority and independent identity/order regressions.
- [x] E47b Channel Edit details modal supports full/automatic-or-supplied short name/description with revision guards, guide/detail projection and retained playback.
- [x] E47c Admin show/video information modal has independent title/description source selectors, cached candidates, Save/Cancel/reset and dirty/late/conflict handling.
- [x] E47d Bounded read-only NFO show/video checks with safe basename/scope matching, adjacent/mirrored metadata root, explicit preview and stale/failure retention. No web parsing.
- [x] E47e Shared browser/native display/search resolver, refresh/import/restart/backup preservation, replacement identity, privacy and unchanged scheduling regressions. Physical display acceptance stays P5.
- [x] E47f Metadata browser modal journeys, reviewed responsive screenshots/axe, native build/display projection and current documentation. Full native/Figma/physical review stays P2g/P5.

- [x] N72 Owner replaced the proposed I47 web source with read-only metadata files: Sonarr/Radarr, manual entry or adjacent/configured-directory NFO. Implemented without web parsing.

## Ninth-round investigation and documentation

- [x] N73 Complete all eight requested independent agents: one feature, one UI/UX, two documentation and four bug investigations; inspect actual implementation and distinguish new findings from older backlog.
- [x] N74 Independently reproduce R9-01–R9-04; record three P2 and one P3 with evidence, workarounds, proposed fixes and regression scope. No new P0/P1 confirmed.
- [x] N75 Surface optional I48 group disable/re-enable, two I47 UX refinements, planning clarifications and considered/deferred alternatives; 48 total proposals, thirty-two selected/sixteen optional.
- [x] N76 Add supported existing NFO examples, move TV API mapping to a developer appendix, and document proposed stale-value/concurrent-save rules for pending I47. This was the investigation checkpoint; expanded metadata/editor protections are now implemented under E47a–E47g.
- [x] N77 Fresh 238-test backend baseline and server/browser type checks; isolated synthetic catalog/browser/artwork reproductions, formatting/link/table/catalog audit and unchanged application-file comparison recorded in VERIFICATION.md.
- [x] N78 R9-01–R9-04 and separate I47 editors are corrected and locally regression-verified (N79–N81, E47h and P3). Optional I48 remains unselected; deferred bugs stay P3b and physical/full visual acceptance stays P2g/P5.
- [x] E47g Stable cached-integration precedence, revision/fingerprint conflicts and deliberate manual draft seeding implemented; Cancel/failed-save preserves information.

## Selected ninth-round corrections and separate channel editing

- [x] N79 R9-01: reject empty/malformed NFO numbers without losing filename fallback; preserve explicit zero, selection/order and original bytes through scan/preview/publication regressions.
- [x] N80 R9-02: retain a bounded local paused frame while releasing delivery; direct/HLS visible-pixel, no-fetch, lost-response, Resume/Go Live regressions.
- [x] N81 R9-04: cancel/drain artwork fetch/body/cache work before close returns; late-fetch, stalled-body and actual HTTP shutdown regressions.
- [x] E47h Separate Edit details and Edit programming, dedicated current-fields modal, immediate saves, dirty/pending/error/late-response handling, retained programming draft/focus and unchanged paused-session checks. Owner/admin authority and responsive visual/accessibility coverage included.
- [x] N82 Complete selected-change backend/browser/type/build/smoke/format/document checks and record exact results/limits in VERIFICATION.md. R9-03 and expanded I47 are now implemented; optional I48 and current deferred/physical acceptance stay separate.

## External subtitles — implemented locally, target-host acceptance remains

The [open software audit](OPEN_SOFTWARE_AUDIT.md#external-subtitle-requirements) defines scope and acceptance. The existing source metadata-root setting is for NFO information, not subtitles.

- [x] N83 Persist per-source subtitle search settings and optional separate read-only subtitle roots; validate non-overlap with writable application roots, migrations, admin authority and backup/restore persistence.
- [x] N84 Discover supported text subtitles beside matching videos and in configured/conventional subtitle subdirectories using bounded, deterministic matching. Preserve language/forced/SDH information; flag ambiguous, missing, unsupported and failed checks without discarding last valid associations on an outage.
- [x] N85 Let admins preview/check and manually associate an authorized local subtitle file to one video within configured roots; guard stale/concurrent saves and preserve drafts/valid settings on failure. Never accept an arbitrary unrestricted filesystem path or web URL.
- [x] N86 Advertise/deliver associated external tracks through authenticated browser/native track contracts with source-time cues, fingerprint invalidation, permission rechecks, cancellation and bounded conversion outside source roots.
- [x] N87 Add admin search-location/association controls and management track discovery status/provenance, language/format/forced/SDH, last check and explicit Check/Rescan. Viewers see authorized playback labels, not server filesystem paths.
- [x] N88 Add synthetic discovery/containment/ambiguity/outage/replacement/privacy/persistence/restore regressions, unchanged video/subtitle hashes, browser management/visual checks and native playback cue/transition coverage.
- [x] N89 Update API/schema/discovery/client/operations and read-only Docker mount instructions for the delivered feature; record actual commands/results and keep unsupported image captions explicit. See SUBTITLES.md and the executed results in VERIFICATION.md.

## Approved delivery phases — current execution

- [x] P1a Source-separated display metadata schema/resolver/API, read-only NFO checks and channel details revisions.
- [x] P1b Metadata modal, source mapping and shared browser/TV display projections; focused browser/axe, backend and native build/JVM/lint evidence.
- [x] P1c Full browser regression with reviewed stable metadata/operations/conflict baselines, compiled lifecycle smoke, formatting and documentation link/table audit. Current counts/limits are in VERIFICATION.md.
- [x] P2a Existing collection edit, bounded source/type picker and show/season drill-down; retained unavailable inspection and disabled missing-file selection.
- [x] P2b Single retained draft, ordered checkpoints, optional episodes per turn, private draft copy and readable preview/exposure.
- [x] P2c Setup, mapping/import reports, target-account access, generation and operations interfaces connected to existing services.
- [x] P2d QR/device review, language/caption preferences and native connection diagnostics; local helper/browser/emulator evidence.
- [x] P2e Playback context, accessible lineup ordering and session-preserving in-player browse.
- [x] P2f Map all 58 canonical frames and seven journeys to code and actual evidence in DESIGN_COVERAGE.md; limits are explicit.
- [ ] P2g Remaining native recovery/tracks/assistive-service verification is deferred at the owner’s request. Browser state/visual work,58-reference review and scoped native state/font/pairing checks pass. See N98–N100 and differed.md; a complete final native acceptance run is not claimed.
- [x] P3 Correct R2-02/R3-01/R5-01/R3-06/R8-01/R8-02/R9-03/R8-04 with deterministic regressions.
- [x] P3b Owner selected and corrected R3-08 guide focus, R6-06 manual refresh diagnostics, R6-07 language aliases, R6-08 locked lineup responses and R8-03 report identities. R10-03 is corrected too; see N96 and the final six correction register.
- [x] P4 Windows-ready build/test/tag/push, isolated synthetic Docker harness, exact-image/source promotion checks, UID/GID and image-only RO-source Compose, Unraid/TV runbooks; local script checks only.
- [ ] P4b Run the portable acceptance harness and `docker compose config` on Windows 11; actual container build/runtime success is not yet established.
- [ ] P5 Execute actual Unraid permissions/recovery/update and signed Bravia/compatible Fire pilot on intended hosts. Follow WINDOWS_DOCKER.md and PILOT_ACCEPTANCE.md.

[DELIVERY_PHASES.md](DELIVERY_PHASES.md) records order, research decisions and external acceptance boundaries. Earlier dated pending statements describe their checkpoints; this section tracks current execution.

## Local acceptance follow-up — 2026-11-08

- [x] N90 Retrieve and visually review all 58 canonical references; retain approved labels, pairing format and selected extension adaptations. Implementation screenshots remain separate from Figma pixel certification.
- [x] N91 Add ten-surface pending/503/403/retry/empty browser journeys, expiry/offline/non-JSON recovery, guarded failed drafts, modal focus containment/restoration, long text/paths/200-percent layouts and generation progress/cancel/retry; fix the concrete gaps found.
- [x] N92 Extend reviewed native pixel coverage from three to nine surfaces, with explicit crop/mask limits and separate error/caption/control/video geometry checks.
- [x] N93 Selected R10-pass checks: 306 backend tests with coverage, 65 browser journeys/54 baseline images, 21 JVM tests/build/lint, nine native visual comparisons using ten reviewed PNGs, full native recovery and compiled lifecycle checks. Separate tracks/large-text/bound-TalkBack runs remain evidence from the prior acceptance checkpoint. Exact evidence is in VERIFICATION.md. Physical device, spoken narration, exhaustive combinations and six-hour/overnight gates remain separate.
- [x] N94 Two independent documentation reviews completed and factual/readability corrections applied, followed by six code bug reviews. Two P1 findings fixed with regressions; no P0. The subsequent owner selection covers R10-04–R10-13; R10-03 was subsequently corrected under N96. Selected verification is recorded below.

- [x] N95 Nested browser editor state/focus audit: single collection discard confirmation, subtitle Cancel guard reset, retry without unintended save, retained collection/picker/checkpoint values, narrow Close labels and readable keyboard-scrollable exposure. Nine new journeys/seven new reviewed images; final browser comparison 74/74 across 61 PNGs, typecheck/build and documentation hygiene pass. This scoped slice does not close D10/D11/U07/P2g; exact evidence is in VERIFICATION.md.

[LOCAL_ACCEPTANCE.md](LOCAL_ACCEPTANCE.md) defines the delivered local scope, completed in N98 below. Human/physical accessibility, representative-file playback and intended-host pilot gates remain in differed.md.

## Tenth-round owner decisions

The [ranked register](IMPLEMENTATION_REVIEW.md#tenth-round-findings-and-disposition) contains evidence, workarounds and proposed corrections. R10-01/R10-02 are fixed with regression coverage. The owner selected R10-04–R10-13. Their corrections passed the regression/emulator pass. The owner subsequently selected R10-03 and all five older deferred findings; they are corrected under N96:

- [x] R10-03 (P2) Re-authenticate current admin authority after awaited source/import work before writes; held demotion/disable/revocation regressions pass.
- [x] R10-04 (P2) Reject ambiguous generic episode.nfo application across multiple videos.
- [x] R10-05 (P2) Prefer the current integration association over obsolete upstream identities.
- [x] R10-06 (P2) Apply saved display metadata to folder-identified shows.
- [x] R10-07 (P2) Preserve filename title fallback for blank NFO titles.
- [x] R10-08 (P2) Avoid argument-limit failure for large dynamic programming selections.
- [x] R10-09 (P2) Clear stale resource-profile routing when choosing another profile.
- [x] R10-10 (P2) Preserve integration drafts when sibling source settings are saved.
- [x] R10-11 (P2) Skip obsolete queued native guide requests before fresh interactive work.
- [x] R10-12 (P2) Serialize native profile selection across Retry profiles screen rebuilds.
- [x] R10-13 (P3) Preserve paused cues through native Retry/audio/poll recovery.

## Final local verification and external handoff

- [x] N96 Correct all six remaining selected findings: post-await admin authorization, retained browser guide focus, persistent unscheduled refresh diagnostics/schema 16, comprehensive language aliases, locked lineup error ordering and per-review report identities/late-response guards. Focused service18/18, full backend318/318 and five browser regressions pass; native helper tests pass. Final integrated results are in VERIFICATION.md. Historical “deferred” labels in earlier review entries refer to those checkpoints.
- [x] N97 Create [differed.md](differed.md) for exact TV models/OS, the owner's existing Windows Docker Desktop acceptance, Unraid/provider/mounts, representative codecs/soak, human/physical accessibility and separate networking follow-ups. Do not install any additional host tools without explicit approval.

- [x] N98 Consolidate local results:318 backend,88 browser/70 PNGs,23 JVM/build/lint,19 native state comparisons,24 enlarged-text states and final-APK pairing focus regression. Current full smoke stops after six visual checks on a hierarchy-inspection failure; final tracks/TalkBack repeats are deferred under N100. Exact evidence is in VERIFICATION.md.

- [x] N99 Correct readable native loading/network states and enlarged-text pairing focus after QR/error layout; focused-action geometry/expired-code/browser approval regression passes. Add bounded fresh hierarchy collection; remaining emulator instability is documented under N100.

- [ ] D11d Current-APK emulator full recovery, actual track/alias transitions and TalkBack repeat: owner explicitly deferred further emulator verification after tooling stalls. This is separate from physical/human D11b.
- [ ] N100 Remaining emulator verification is deferred at the owner’s request. Preserve completed state/font/pairing results and resume only as a separate follow-up; see differed.md. No complete final full/track/accessibility pass is claimed.
