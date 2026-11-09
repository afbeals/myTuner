# Open software and playback audit

Current audit: 2026-11-08, unreleased 0.2.0 / schema 16. External subtitles, storage/reconciliation, refresh diagnostics and all six selected remaining findings are delivered. Backend/browser and scoped native state/font/pairing checks pass. The owner stopped remaining emulator verification after tooling failures. [Verification](VERIFICATION.md) distinguishes passed results from incomplete repeats, and [differed](differed.md) contains the remaining emulator, intended-host/device, representative-media and human work.

## What audio and subtitle support exists

| Capability                   | Current behavior                                                                                                     | Evidence or limit                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Embedded alternate audio     | Browser/native menus; alternate selection uses authenticated HLS                                                     | Actual selected-audio browser and native segments plus advancing playback                                             |
| Embedded text subtitles      | Supported streams convert to authenticated cached source-time WebVTT                                                 | Embedded server/client and native stale-response/recovery regressions                                                 |
| External text subtitles      | `.srt`, `.vtt`, `.ass`, `.ssa` beside matching videos, in configured/conventional folders or mirrored read-only root | Discovery, real conversion, privacy, persistence, browser/native playback tests; ASS styling is not preserved in full |
| Admin subtitle configuration | Source settings and revision-guarded manual preview/association                                                      | Responsive reviewed settings/discovery/manual screenshots, retry/draft guards and API tests                           |
| Management inspection        | Embedded labels plus external origin, language/format/forced/SDH/status and last check                               | Raw root-relative paths are admin-only; viewers receive authorized track labels                                       |
| Image subtitles              | PGS/VobSub/burn-in unsupported                                                                                       | Recognized external image formats are marked unsupported; N18 remains conditional                                     |

[Audio and subtitle setup](SUBTITLES.md) is the operator guide. Audio choices refer to streams embedded in the video; separate audio files are outside this feature. Language-alias matching R6-07 is now corrected and regression-tested.

## Implemented software and remaining acceptance

| Checklist        | Delivered/evidenced                                                                                                                                                                           | What remains                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N83–N89 / P09b   | Schema 15 settings/checks/associations; bounded discovery; protected text conversion; admin UI and read-only mount documentation; synthetic browser/native tests                              | Representative household captions, actual mounts and physical TV acceptance remain under N17/N20/P5                                                                         |
| O09b / O09c      | Serialized age/LRU cache reclamation, active-partial protection; bounded token-guarded generated-output/reference reconciliation with generation exclusion                                    | Actual restored-volume, pressure and interruption rehearsal on Unraid remains N20/O09                                                                                       |
| N10 / N17 / N26  | Browser/native real external captions, pause, selected-audio HLS, actual program/commercial/program source offsets; native MP4→MKV/HLS transition; caption/control/stale-response regressions | Representative formats/HDR/devices, measured drift/load and six-hour/overnight soak; local two-viewer buffering/reload and 90-second mixed-format endurance are now covered |
| D10 / U07 / P2g  | All 58 references reviewed; browser top-level/nested/approval recovery matrix, retained drafts/focus and native remote/state/visual verification in LOCAL_ACCEPTANCE.md                       | The named state matrix passes; remaining emulator recovery/tracks/accessibility verification is deferred at the owner’s request.                                            |
| D11 / N25 / T11b | Browser axe/dialog focus/long text/200-percent layouts;30 native PNGs/28 stable surfaces, font scale 1.3; prior TalkBack binding/focus is historical                                          | Current TalkBack repeat, human spoken output and target-display/remote accessibility remain in differed.md.                                                                 |
| D01 / N69 / N78  | Contract reconciliation, all selected prior fixes and all six formerly deferred findings verified                                                                                             | Optional features remain unselected; external acceptance remains separate.                                                                                                  |

The current implementation found and corrected two additional problems during verification: empty output from malformed SRT now fails clearly instead of caching unusable captions; TV captions are positioned above visible opaque controls and return to the normal lower position when controls close. The native check verifies measured caption/control bounds as well as cue text and video pixels.

The nested browser-editor follow-up adds collection single-confirmation dismissal, subtitle Cancel guard reset, safe retry buttons, retained picker/checkpoint drafts, narrow Close labels and readable keyboard-scrollable exposure history. Its nine journeys/seven new reviewed baselines are scoped evidence in [the state inventory](UI_STATE_AUDIT.md#nested-browser-editor-follow-up); the rows above distinguish the completed browser/state checks from the deferred final native repeats.

## External subtitle requirements

The requested implementation is delivered within these boundaries:

- Match video basenames deterministically; generic names require manual admin choice. Read originals only. Support adjacent/conventional/configured nested folders and an optional mirrored root.
- Persist source settings, stable associations, check/error history and video/subtitle fingerprints. Offline/failed checks preserve prior results; successful checks reconcile missing candidates. Settings/video changes require revalidation.
- Offer admin read-only candidate preview then guarded Save/Cancel; reject stale settings/revisions/fingerprints, traversal, source/storage overlap and symlink escape. Failed UI saves retain the draft.
- Advertise stable authenticated tracks with source-time cues and current permission/fingerprint checks. Conversion uses bounded shared encoder admission and managed cache outside sources; shutdown aborts/drains work.
- Keep admin locations distinct from viewer labels. No webpage parsing, arbitrary file URL, source editing or imported source copy. Backup contains association/configuration state, not original captions.

Search and storage limits, naming examples, supported formats and recovery behavior are detailed in [subtitle setup](SUBTITLES.md), [API contracts](BACKEND.md), [database](DATABASE.md) and [operations](OPERATIONS.md). There is no saved-manual-association removal/reset control yet; configuration changes or video replacement require a fresh association. Missing-output recovery removes unusable references and leaves regeneration explicit.

## Newly confirmed code findings

The completed [tenth-round review](IMPLEMENTATION_REVIEW.md#tenth-round-findings-and-disposition) found two P1 issues, both corrected with regressions: cross-account retained private-folder drafts and delayed recovery overwriting a newer restore. The owner selected **R10-04–R10-13**, now implemented and regression/native-verified. **R10-03** (post-revocation in-flight source/import writes) was subsequently selected and corrected with held-request regressions. The register preserves original findings and details each correction; external/human acceptance remains separate; the executed local matrix is explicit.

## Separate target-host and deferred work

Windows Docker build/runtime/Compose/restart/update/rollback remains P4b/O08; scripts alone are not a container test. Actual Unraid UID/GID/mounts, installed Sonarr/Radarr versions and removal policy, restored volumes, disk pressure, concurrent viewing and soak remain N09/N11/N19/N20/E05/P5. Exact-model Bravia/compatible Fire installation, signing, remote/display/assistive technology and representative codec/HDR acceptance remain the TV/pilot gates. Router/SSID/VLAN changes are X01/X02 and remain a separate infrastructure follow-up.

R3-08/R6-06/R6-07/R6-08/R8-03 and R10-03 are now selected and corrected in [the review register](IMPLEMENTATION_REVIEW.md). External follow-ups are collected in [differed](differed.md). Optional I44–I46/I48 remain unselected; the historical catalog still contains 48 proposals. No publication/deployment or physical-device acceptance is inferred from this local implementation.
