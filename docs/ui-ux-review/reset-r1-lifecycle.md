# Reset safety review — round 1, lifecycle/operator workflow

Independent pass C. Completed 2026-11-26 (America/Los_Angeles; execution after UTC midnight). No product code changes. No confirmed product finding in this pass.

The reviewer read AGENTS.md, docs/MYTUNER_PLAN.md, and docs/RESET_DATA_PROPOSAL.md, then inspected the production reset, runtime-lock, server lifecycle, output and recovery implementations. Other reset review reports were not read before this independent pass completed. The test was authored independently as test/reset-browser-lifecycle.check.ts, without reusing author reset-test fixtures.

## Executed commands and result

```sh
npm_config_offline=true node_modules/.bin/prettier --write test/reset-browser-lifecycle.check.ts
npm_config_offline=true node --import tsx --test test/reset-browser-lifecycle.check.ts
npm_config_offline=true node_modules/.bin/tsc --noEmit
```

Final lifecycle run: **1 passed, 0 failed**, 5.25 seconds total / 4.68 seconds test body. Node v24.13.0; installed Chromium through @playwright/test. Installed TypeScript check passed with no diagnostics. No downloads, installs, network service access, commits, pushes, household data, FFmpeg execution, TV or emulator use. Loopback HTTP is used only for the isolated fixture.

The test spawns the real production src/main.ts with its own random loopback port and file-backed data/generated/cache directories under a canonical private temporary root. It invokes the actual backup-cli.ts, reset-cli.ts and restore-cli.ts as separate installed Node/tsx processes. Server stops retain the database and physical fixtures; teardown removes only this test's unique temporary root.

## Real outcomes

1. Seeded an alphabetically first, earlier administrator, a second current administrator, and a viewer. The browser and reset options retained the signed-in second administrator by exact UUID, rather than inferring identity from account order.
2. Browser tested selective source removal: catalog, metadata, custom information, collections, channels and activity dependencies became checked and disabled with their explanatory content present. Accounts remained unselected. Review exact changes, Change choices, fresh start (all checked/disabled), Done, reopening, and explicit Cancel were exercised. All three accounts remained; browser review did not apply reset. The viewer had no reset UI and received 403 from both reset APIs. Guessed HTTP execute/apply endpoints returned 404.
3. Created a real API playback session. Started a real source-scan request while playback paused background admission. Snapshot showed paused=true and waiting=1. The offline CLI refused while the production server held the data directory: existing SQLite WAL/SHM/journal files require normal recovery and clean shutdown. No reset happened. This is a queued scan waiting for playback admission, not an encoding or probe workload.
4. Sent SIGTERM to production main. It drained/aborted pending work and exited code 0. Application WAL/SHM and owner-lock journal were absent after shutdown. Source/unknown-file hashes remained unchanged.
5. Actual CLI rejected a wrong administrator password. A valid offline preview printed a full SHA256 revision. After an independent database-only title update, apply with that prior revision failed with “Database changed since the offline preview.” A fresh preview produced a different revision. Wrong typed confirmation also failed. Only the fresh full revision, retained administrator password via stdin, and exact confirmation completed reset after reporting a verified backup. The successful fresh plan affected 127 database records.
6. Restarted production main. A pre-reset token returned 401. Retained administrator sign-in with the unchanged password succeeded; the other administrator and viewer could no longer sign in. Exactly one account and its original password hash remained. Sources were cleared. The source, metadata and subtitle roots were preserved in the safety records.
7. Normal restart ran auto-maintenance. Cleanup dry-run succeeded; destructive cleanup and reconciliation each returned 409 with the permanent cleanup-disabled explanation. An expired old managed subtitle cache file was retained and replacement refused. A distinct new cache file published successfully. A deliberately tiny cache budget rejected further writes without reclaiming retained files.
8. Re-added the synthetic source through production catalog helpers using a synthetic probe. New thumbnail generation completed through GenerationRunner using an installed-Node descriptor-writing stub (no FFmpeg). A second generation job under a one-byte quota failed before invoking that writer. Existing physical media and output hashes stayed unchanged.
9. Ran the real restore CLI against the pre-reset application backup, then restarted production main again. Sources returned and retained administrator sign-in worked. Destructive reconciliation still returned 409; the safety policy remained cleanupDisabled=true. All original sentinel bytes and both previously created backup bundles were unchanged.

## Preservation evidence

The test compares size and full SHA256 after live-server refusal, clean shutdown, offline reset, output/cache pressure, and old-backup restore/restart. All **13** sentinels matched. Backup bundles are separately hashed before/after subsequent reset and restore. Machine-readable details: [reset-r1-lifecycle-evidence.json](reset-r1-lifecycle-evidence.json).

| Relative synthetic path                                                                                                          | Bytes | Before SHA256                                                      | After final restore/restart |
| -------------------------------------------------------------------------------------------------------------------------------- | ----: | ------------------------------------------------------------------ | --------------------------- |
| `source/episode.mp4`                                                                                                             |    34 | `3915d502c27894cf2ce0ef0e4d9536cbc42839e74ce17c28d38bf5cdeb573b62` | Same                        |
| `source/episode.nfo`                                                                                                             |    47 | `697c07c8d6897a3bf91bae7491bb3d351eb112c7db7388ebf8227379c43f5e1f` | Same                        |
| `source/episode.en.srt`                                                                                                          |    50 | `0e9cadb40366a37457f078b33ab9ed1308a1ace1af3d460023b376caa3ed9ec0` | Same                        |
| `metadata/operator.nfo`                                                                                                          |    26 | `9616a4b0422ecdc751e15f1efd2af09516ad0e86ad2133f9096c1a66c8580ba6` | Same                        |
| `subtitles/operator.srt`                                                                                                         |    26 | `7490b916990c9535aec4b24c3fdb92425a26890e5825bfc1b6411de3dba0c11c` | Same                        |
| `neighbor/unrelated-video.mkv`                                                                                                   |    37 | `27ca0d6a1073397f30bca926db4ed9c68ab5fcdbd4012448efc5cf1abe6c1dc5` | Same                        |
| `data/operator-video.mp4`                                                                                                        |    34 | `829ea9fb2d8d2101a430cded84f85a32a276137d65a875da131148796e85d8ba` | Same                        |
| `data/operator-note.txt`                                                                                                         |    33 | `d898938350e05f4462d57738338e80164b33986aec2e5c8c07cd2987653045e4` | Same                        |
| `generated/operator-video.mp4`                                                                                                   |    36 | `95dbaca352a096a641096051777eb9795afe6ba18188857bbde0d9cee8fa3973` | Same                        |
| `generated/operator-note.txt`                                                                                                    |    32 | `0159f4f87671092a61ad5f0487b2312b882a1e79b251bca1660e5f3cc92e2c39` | Same                        |
| `cache/operator-video.mp4`                                                                                                       |    32 | `cf20fe53c1b4a14aa330211efa01c7803480a7f2934e1395df6d3e1c7dcc3bc4` | Same                        |
| `cache/subtitles/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.vtt`                                           |    52 | `9678076831a74c3364803df29cc784fb6096ffbdc1a12cf0325a7b45240bc2b8` | Same                        |
| `generated/5b4c268f-9d03-401e-ae65-19ea32741fab/6e144efde684beaf437cf9cbc0fce353bb11b7b5380587ea118459bb88991953/conversion.mp4` |    29 | `50d0748f700e56a6e2e1bc900d90152b95080c6a7bcaa013d2f024c415506006` | Same                        |

## Boundaries and cleanup

Two initial harness iterations failed before applying reset: the app's first-sign-in profile picker intercepted navigation, then macOS's /var alias was correctly refused because reset requires canonical directories. The harness now selects the viewing profile and creates fixtures under realpath(tmpdir()). These were setup corrections, not product findings.

This pass does not establish physical playback/codec compatibility, host crash durability, Unraid/container behavior, or adversarial auxiliary-file replacement. It exercises actual API playback state and background admission rather than decoding synthetic video. It does not prove safety against an adversary replacing SQLite WAL/SHM/journal files during reset; root coordinates that independent filesystem review and the required post-fix lifecycle rerun. No other review's finding is adopted as an independently discovered result here.

Teardown verified the unique fixture directory no longer exists. Main child processes exited cleanly, and Playwright was closed. The test, report and sanitized JSON evidence remain; temporary local runner logs were removed after evidence extraction. Root owns shared CHECKLIST.md/VERIFICATION.md updates and the complete review register.

## Post-fix affected lifecycle rerun

After the backend fix was frozen, reran the unchanged independent test against the current production sources:

```sh
npm_config_offline=true node --import tsx --test test/reset-browser-lifecycle.check.ts
```

Result: **1 passed, 0 failed**, 4.84 seconds total / 4.42 seconds test body. The complete real browser/CLI/operator journey passed again, including clean production shutdown, fresh offline preview, wrong-password/stale-revision/wrong-confirmation refusal, successful verified-backup apply, restart/sign-in, cache/generation quota checks, and pre-reset restore/restart with cleanup still disabled. All **13** physical sentinel hashes and both backup bundles remained unchanged. No new product finding was confirmed.

[Post-fix evidence](reset-r1-lifecycle-postfix-evidence.json) preserves the separate rerun outcomes and SHA256 hashes of the tested reset/restore/runtime-lock source files. The unique temporary fixture was confirmed absent after teardown, all main child processes exited cleanly, Chromium closed, and the local runner log was removed after extraction. No installs, downloads, external service access, household data, commits, pushes, emulator or FFmpeg execution occurred. This is the affected lifecycle regression; adversarial SQLite auxiliary replacement remains the independent filesystem review's scope.
