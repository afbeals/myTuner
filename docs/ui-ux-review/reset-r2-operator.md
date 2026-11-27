# Reset safety review — round 2 operator, lifecycle and readability pass

Reviewed on 2026-11-27. Branch `feature/ui-ux-overhaul`, base HEAD `a67d418cf7258e669b11fcc9cae63cdc1bcda92d`, with the uncommitted reset implementation. No round 1 tests or reports, or other round 2 reports, were read before this independent executed pass completed. This pass used the personal myTuner `AGENTS.md`, reset proposal, Operations reset runbook, and implementation source. Pineapple rules do not apply here.

## Findings and corrections

1. **Exact-count Action values broke inside a word on desktop.** Reproduction: at 1440px sign in as the second administrator, open Setup & Server Health → Reset application data → Review reset options, choose Fresh start, and Review exact changes. The first `catalog_projection_rows` row showed `Remove` as `Remov` / `e`. The generic `overflow-wrap: anywhere` table-cell rule permitted the Action column to shrink too far. The original [desktop screenshot](reset-r2-operator-before-preview-1440.png) records the result. Fixed by adding a `reset-counts` class, a scoped 42rem table minimum width, and nonwrapping Action/Count headers and cells. Other tables are unaffected. The final executed desktop/narrow retest passed, as recorded below.
2. **The Operations runbook named the wrong current schema.** `docs/OPERATIONS.md:246` said “The current schema is 20” although the running schema/reset receipts are 21. This matters when choosing a matching backup/image for rollback. Reported immediately to the coordinating agent, who corrected the runbook to schema 21. This reviewer confirmed the resulting text and did not edit Operations.

No additional product defect was confirmed by this scoped pass. These findings were reported as soon as confirmed, without ranking or a deferral request.

## Executed independent fixture

The runner `/private/tmp/reset-r2-operator.mts` creates a new, random `/private/tmp/mytuner-reset-r2-operator-*` directory and a random loopback port. It launches the production `src/main.ts` through the installed `tsx`, preserving data across stop/restart. It imports the installed Playwright package directly and launches its existing Chromium. It does not use `e2e/server.ts`, the global Playwright configuration, or another reviewer's fixtures/tests.

The fixture contained four accounts (two administrators, an editor and viewer), a room profile, scanned catalog, manual/local metadata, a collection and item reference, a channel, playback event and generated-asset reference. The retained administrator was deliberately the second-created, alphabetically last `zzz_retained_admin`, while `aaa_original_admin` was created first.

Its 16 protected physical files included a real FFmpeg-generated synthetic MP4, NFO/SRT sidecars, a separate metadata root, a separate subtitle root, an unindexed synthetic neighboring video, an unrelated neighbor outside the application directories, an operator-created appdata note, unknown files in generated/cache roots, an actual generated-layout MP4, an expired managed-caption cache file and every file in an older application backup. SHA-256 values were captured before all operator actions and compared after preview, selective reset, restarts, cleanup/cache attempts, fresh reset and the historical-root rejection.

The initial completed independent journey ran at `2026-11-27T08:08:48.953Z`–`08:08:55.055Z`, port 49484. It passed all 31 recorded checkpoints. [Original evidence](reset-r2-operator-before-evidence.json) includes its receipts, file hashes, exact browser reset requests, counts and shutdown timings. The successful fixture was removed after the final hash comparison. Earlier incomplete harness fixtures were also cleaned separately; no production or household path was involved.

## Actual commands and results

```sh
npm_config_offline=true npm_config_yes=false node --import tsx /private/tmp/reset-r2-operator.mts
node_modules/.bin/prettier --write web/src/ResetData.tsx web/src/styles.css
```

The runner invokes these production entry points against its own data directory, with `MYTUNER_DATA_DIR`, `MYTUNER_GENERATED_DIR`, `MYTUNER_CACHE_DIR`, `HOST=127.0.0.1` and the random `PORT` set only for the child:

```sh
node --import tsx src/main.ts
node --import tsx src/reset-cli.ts --admin-id SYNTHETIC_ADMIN_UUID --mode selective --categories activity
node --import tsx src/reset-cli.ts --admin-id SYNTHETIC_ADMIN_UUID --mode selective --categories activity --apply --revision FULL_OFFLINE_REVISION
node --import tsx src/reset-cli.ts --admin-id SYNTHETIC_ADMIN_UUID --mode fresh
node --import tsx src/reset-cli.ts --admin-id SYNTHETIC_ADMIN_UUID --mode fresh --apply --revision FULL_OFFLINE_REVISION
```

Password and exact confirmation are supplied over private subprocess stdin, never command arguments. Assertions verify that the synthetic password is absent from stdout/stderr. This is an actual CLI execution, with piped stdin rather than an interactive TTY keyboard-echo certification.

| Executed check                                                | Observed result                                                                                                                                                                                                               |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI against running production main                           | Refused before reset because live SQLite sidecars exist; no reset.                                                                                                                                                            |
| Unauthenticated, editor and viewer GET options / POST preview | 401 or 403 for all six requests.                                                                                                                                                                                              |
| Guessed HTTP execute/apply/reset POST paths                   | All returned 404; no live destructive route.                                                                                                                                                                                  |
| Current administrator                                         | Browser showed the signed-in second administrator's username and UUID, never inferred the first account.                                                                                                                      |
| Selective source choices                                      | Source selection visibly selected and disabled catalog, metadata, custom, collections, channels and activity; Accounts remained unselected. Cancel preserved all application rows. Reopening began with clean choices.        |
| Fresh browser preview                                         | All eight checkboxes selected/disabled; retained second administrator correct; all 45 preview rows matched live database counts; the total matched 24 affected records in this fixture.                                       |
| Browser preview/Cancel                                        | Captured reset requests were GET options and POST preview only. No application reset occurred.                                                                                                                                |
| Desktop/narrow readability                                    | Screenshots inspected at 1440 and 390; no page overflow at 390, dialog stayed within the viewport. The Action wrapping defect above was found through screenshot inspection.                                                  |
| Graceful shutdown                                             | SIGTERM exited code 0 in 12ms; later SIGINT exited code 0 in 72ms; final SIGTERM exited code 0 in 6ms.                                                                                                                        |
| Wrong password                                                | Refused with `Administrator identity or password was not confirmed`; application rows unchanged.                                                                                                                              |
| Stale full revision                                           | 64-character stale revision refused; application rows unchanged.                                                                                                                                                              |
| Inexact confirmation                                          | Correct phrase plus one trailing space refused; application rows unchanged.                                                                                                                                                   |
| Input ended at final confirmation                             | Refused without reset; later valid CLI use succeeded.                                                                                                                                                                         |
| Unsafe backup directory                                       | A deliberately group/world-writable synthetic backup directory was refused; application rows unchanged. Its safe mode was restored by the harness.                                                                            |
| Selective activity execution                                  | New verified backup; activity removed and all sessions/pairings revoked. Accounts, profiles, sources, media, collections/items, channels and custom/local metadata remained byte-for-byte equal as SQL rows.                  |
| Selective restart                                             | Previous bearer session returned 401; browser sign-in with retained administrator's existing credentials succeeded.                                                                                                           |
| Post-reset physical asset cleanup                             | Ordinary cleanup and reconciliation cleanup both returned 409. All protected file hashes unchanged.                                                                                                                           |
| Expired/cache pressure/replacement                            | Expired cache read returned null without deletion; quota pressure failed without eviction; replacement of retained cache file was refused. File hashes unchanged.                                                             |
| Fresh execution                                               | Exactly the named second administrator survived; other accounts/profiles/catalog/configuration were removed; source, metadata and subtitle roots were retained in `protected_source_roots`; cleanup policy remained disabled. |
| Fresh restart                                                 | Retained administrator browser sign-in succeeded; removed first administrator login returned 401; no persisted reset replay occurred.                                                                                         |
| Reuse historical source as generated root                     | Production main exited 1 with storage overlap error before output writes. All protected hashes unchanged.                                                                                                                     |
| Filesystem boundary                                           | All 16 before/after SHA-256 values equal, including actual videos, sidecars, older backup, unknown neighbors and retained output/cache.                                                                                       |

## Unraid helper review

The documented helper was checked against `Dockerfile`, `src/main.ts`, `src/reset-cli.ts`, offline locking and reset-backup code. It obtains the stopped MyTuner container's exact image ID, uses `--pull=never`, `--network none`, an interactive terminal and only the configured appdata directory bound to `/app/data`, and overrides the entry point with `node ... dist/reset-cli.js`. The runtime image has `/app` as working directory, compiled `dist` and production dependencies, and runs as the existing `node` user. The helper does not invoke normal server startup, create generated/cache roots, mount media or require FFmpeg. The offline command reads historical root names from the database without walking source contents. Adding `--apply --revision` is consistent with the parser; fresh mode omits categories. The `--rm` flag removes the temporary container rather than the bind-mounted data.

No Docker engine is available on this Mac, so container UID/mount permissions, TTY behavior, image execution and actual Unraid storage/lifecycle semantics were not executed. The runbook explicitly retains that acceptance requirement. Nothing was installed or downloaded to make that check appear complete.

## Harness adjustments and boundaries

Initial harness attempts required corrections: use the actual `verifyApplicationBackup` export; avoid toggling an already-open disclosure closed; query native `<dialog>` in geometry inspection; use immutable SQLite inspection while the fixture is stopped so the harness does not create sidecars; and check authenticated identity rather than a desktop-only visible Sign out button on mobile. These were harness errors, not claimed product defects. Offline inspection now creates no WAL/SHM files.

This bounded local pass does not establish real Unraid/Docker behavior, real TTY password echo, physical TV pairing/playback, interrupted kernel/power-loss durability, every filesystem race, or household media compatibility. Independent other review passes cover additional adversarial database/filesystem paths. No installs, downloads, external network access, Git writes/pushes, emulator work, household data access or real reset occurred.

## Final affected retest

**PASS** after the rebuilt frozen browser bundle included the scoped table correction and schema-21 runbook, with the final backend backup publication/fingerprint corrections in place. The same complete browser/CLI fixture journey ran from `2026-11-27T08:13:23.225Z` to `2026-11-27T08:13:28.741Z`, private port 50335, and passed all 33 checkpoints. All 16 protected file hashes remained identical. The fixture was removed after completion; browser and production-main child processes were closed.

The new rendered-line assertions inspected all 90 Action/Count data cells at each width. Every cell occupied exactly one text line at both 1440 and 390px. At 1440px the region/content were both 930px wide. At 390px the 672px table scrolled within its own 318px region; document width stayed 390px, dialog width 352px and the overflow audit found no uncontrolled overflowing dialog content. The corrected [desktop preview](reset-r2-operator-preview-1440.png), [phone preview](reset-r2-operator-preview-390.png), [phone choices](reset-r2-operator-choices-390.png) and [post-fresh restart](reset-r2-operator-after-fresh-restart.png) were captured. The desktop image was visually inspected again to confirm `Remove` stayed whole.

The final [evidence](reset-r2-operator-evidence.json) records exact file hashes, source-file SHA-256 values, receipts and observations. The base commit remains `a67d418cf7258e669b11fcc9cae63cdc1bcda92d`; source hashes identify the uncommitted reviewed implementation.

### Additional independent post-fix filesystem confirmation

After this independent operator pass, the coordinating agent requested an independent execution of the other reviewer's final filesystem regression matrix. This is post-fix verification credit, not a claim that this reviewer authored or independently discovered those earlier filesystem findings.

```sh
npm_config_offline=true npm_config_yes=false ./node_modules/.bin/tsx --test test/reset-r2-filesystem.test.ts > docs/ui-ux-review/reset-r2-operator-filesystem-retest.log 2>&1
```

**48/48 passed**, zero failed/skipped/cancelled, 3407.5ms. The executed test source SHA-256 was `1fa826eced6794fafdf0dbdd5fcbf2610e18780dce95ef3196c257296ef33918`. [Full independent output](reset-r2-operator-filesystem-retest.log) is retained.

I inspected the two adapted publication-race tests before executing them. They still perform actual directory-to-source symlink swaps at remaining asynchronous boundaries; require `injected === true`; compare every previously existing non-directory protected entry using inventory containing device, inode, link count, type/mode and SHA-256; assert no manifest/key was written into the read-only source; and require reset rejection. They additionally assert that key/manifest publication never uses an asynchronous pathname `fs.open` call. These safety assertions were not removed or bypassed by this reviewer.

The executed manifest swap reported `injected: true`, `wroteToReadOnlySource: false`, `resetSucceeded: false`, `mediaRowsAfter: 1`, `advertisedDatabaseExists: false`, and `Reset backup directory changed`. The integration-key swap independently reported `injected: true`, `wroteToReadOnlySource: false`, `resetSucceeded: false`, and the same refusal. The full matrix also passed all categories, control-file/sidecar/link replacement, prior-backup protection, URL-like paths, cleanup/cache barriers and historical-root checks. Its after-hook removed its synthetic fixture directory.
