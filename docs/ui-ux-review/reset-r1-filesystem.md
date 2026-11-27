# Reset safety review — round 1 filesystem boundary

Independent pass A, 2026-11-26. Reviewed the repository instructions, reset proposal and implementation directly. No other review report was read. No product code was changed by this reviewer.

## Result

**Two confirmed must-fix findings were identified:** foreign main-database WAL/SHM files were deleted on rejected-reset close, and foreign backup-destination WAL/journal files were deleted by `VACUUM INTO`. Both corrections have now passed the complete independent expanded matrix: **73/73 test entries pass**, with no known filesystem finding remaining open in this pass. The independent permanent regression file is `test/reset-r1-filesystem.test.ts`.

The original pre-correction full matrix reported **48 test entries: 45 pass, 3 fail**. The failures are the `-shm` and `-wal` regression subtests and their containing parent test. The `-journal` counterpart passes. Node counts parent tests in these totals. All ordinary successful/failure-path and preexisting-file cases pass.

## Confirmed finding: foreign video unlinked on rejected reset

Affected behavior: `executeOfflineReset` calls `context.assertCurrent()` after its backup-created observation/await boundary, then always calls `context.close()` in `finally`. `openOfflineReset` implements close with `database.close()` and also closes in its setup failure path. SQLite performs implicit auxiliary-file cleanup independently of the module having no explicit unlink/remove calls.

Exact reproduction:

1. Create a synthetic myTuner store, administrator, source and catalog in a private temporary fixture; shut its SQLite handle cleanly.
2. Preview an offline fresh reset and execute it with the correct password, revision and exact confirmation.
3. After the verified backup exists, atomically rename the existing `mytuner.db-shm` (or `mytuner.db-wal`) into another location within this same owned fixture.
4. Atomically rename a new **real FFmpeg-generated MP4** into the vacated auxiliary filename. Record its inode, link count and SHA-256.
5. The reset detects the unexpected/replaced sidecar and rejects before applying its reset transaction.
6. The `finally` close nevertheless removes the foreign MP4 directory entry. The post-operation manifest has no entry at the path where the recorded foreign inode existed.

The injection uses the existing `backupCreated` observer only to make timing deterministic. It performs real filesystem renames and exercises the production SQLite open/assert/close code. It models a same-owner external process changing appdata during an asynchronous reset preparation step. The exclusive myTuner owner lock does not prevent that process from renaming files.

Observed sentinel SHA-256: `67e92b3d27b7f7ea06bd34dd999c7c298eb66a133e2b6094dd17e1017d09d531`. Last full execution recorded missing foreign inodes `168618353` (`-shm`) and `168618407` (`-wal`). Actual manifest entry was `undefined`; expected was the original regular file with this hash and link count 1.

Required outcome: an unsafe sidecar rejection and subsequent cleanup must preserve foreign files, including SQLite's implicit cleanup. Retain the regression assertions; a passing error-message check alone does not establish preservation. No severity ranking is used: this violates the owner's required boundary and must be addressed before approval.

## Correction retest and second confirmed finding

This remains round 1 follow-up, not an independent second review round.

After the backend correction normalized the main and owner-lock databases to rollback `DELETE` mode synchronously before the first asynchronous wait, and added synchronous inode/header/no-auxiliary checks before SQLite reads, the unchanged original **48-entry matrix passed 48/48**. The exact two original foreign WAL/SHM deletion assertions pass. Source inspection confirmed the defensive mode is established before either normal close or the setup catch can follow an asynchronous wait.

Additional independent challenges then passed for all six auxiliary names (`mytuner.db` and `runtime-lock.db`, each with `-wal`, `-shm`, `-journal`):

- Direct context close with foreign regular-video, symlink and hardlink entries.
- Successful-password and incorrect-password scrypt awaits with those same three entry types injected before completion; actual authentication rejects the unsafe sidecars and close retains their full manifests.
- The setup-failure catch: a Node `async_hooks` callback observes both normalized headers and injects all six videos before `openOfflineReset` returns; setup rejects and both SQLite handles close without removing any sentinel. No SQLite behavior is mocked.
- Actual cryptographic backup-verification failure with all six video/symlink/hardlink auxiliaries injected in a microtask when the real backup target `fsync` yields. The actual immutable verification reaches the invalid-ciphertext error, and subsequent close preserves all entries.

The same extension exposed a **second confirmed deletion boundary at the backup destination**. After the second real `context.assertCurrent()` inside `createVerifiedResetBackup` succeeds, the new bundle and empty backup target already exist; further filesystem awaits occur before `VACUUM INTO`. The independent test writes a foreign video into the bundle at `mytuner.db-wal`, `mytuner.db-shm` or `mytuner.db-journal` during that boundary, then permits the real SQLite code to run. Before the second correction, the backup operation succeeded, but **`-wal` and `-journal` entries disappeared**. `-shm` remained.

The initial three-case execution reported 19 entries across all new shutdown challenges: 16 pass and 3 fail (the two removed backup auxiliaries plus their parent). The expanded destination test confirms the same deletion for symbolic links and hardlinks as well as regular videos: six physical-preservation failures across WAL/journal × three entry types. Hardlink removal reduces the synthetic source video's link count from 4 to 3. SHM entries survive, but a strengthened test now also requires refusing every unexpected auxiliary before invoking SQLite on the target.

Focused reproduction (permanent final test in the same file):

```sh
npm_config_offline=true npm_config_yes=false ./node_modules/.bin/tsx --test --test-name-pattern='beside a new backup' test/reset-r1-filesystem.test.ts
```

That expanded pre-correction execution reports 10 failed entries (9 cases plus parent): 6 demonstrate physical removal, and 3 demonstrate missing refusal of retained SHM entries. The test checks physical manifest preservation before checking the intended refusal. The required correction is to validate target/bundle identities and synchronously refuse backup-destination WAL/SHM/journal entries immediately before `VACUUM INTO`, with appropriate subsequent boundary checks. The backend author was notified immediately and implemented the correction. No product edits were made by this reviewer.

### Final independent correction verification

After inspecting the frozen target-safety patch, this reviewer independently reran the **entire expanded matrix: 73 entries, 73 pass, zero failures/cancellations/skips/todos, approximately 6.68 seconds**. This remains the correction phase of round 1.

The target guard now synchronously checks the directory chain, backup-root/bundle identities and permissions, destination file type/link count/inode and absence of all three destination auxiliaries before `VACUUM INTO`. It repeats the relevant checks after the SQLite operation, after target `fsync`, before immutable verification open and before manifest publication. No remove/rename operation was introduced. All nine destination suffix × video/symlink/hardlink combinations now reject before SQLite touches the foreign entry, retaining every original manifest hash, inode, link target and link count.

Both previously confirmed findings are corrected in the tested source. The original main WAL/SHM rejection assertions, setup-catch and password/verification-failure close challenges all pass alongside both normal reset/restart cases. No known finding from this filesystem pass is deferred.

The final tested source SHA-256 values are:

- `src/reset-backup.ts`: `b0104f07c452c2ac7a3f7b3c86e374d35037d8e5696eb230a074faabc250ace7`.
- `src/reset-offline.ts`: `ed8b2ecd696ee5948364c7edc7f741c2e48e4a4b507d37410c1e0a4b042dedd0`.
- `test/reset-r1-filesystem.test.ts`: `4affcac4d0f4d31b2fc89689173e26c017a001ea1e06d9fdeb2a727a394f0402`.

## Independently executed coverage

Every case creates its own private synthetic fixture. FFmpeg generates a 16×16 blue, 0.12-second MPEG-4 video. Fixtures include the video, subtitle and NFO sidecars, separately configured subtitle/metadata roots, neighbor video, unknown appdata video and a valid foreign SQLite database, existing backups and backup symlink/hardlink entries, a source hardlink and appdata symlink, valid-layout generated conversion and old managed cache files. Source/file names include spaces, `#`, `%`, `?`, Unicode and a newline. A recursive `lstat` manifest records types, device/inode, link counts, symbolic-link targets and SHA-256 of regular files; it never follows symlinks.

- All 18 preexisting SQLite auxiliary combinations pass: `mytuner.db` and `runtime-lock.db`, each with `-wal`, `-shm`, `-journal`, each containing a real video, symbolic link or hardlink. Refusal leaves the entire fixture manifest identical. Thus the current **preopen** guard prevents SQLite from consuming or deleting these existing foreign auxiliary files.
- Existing database/owner-control/key symlinks and hardlinks, plus a symlink backup root, are refused without changing any manifest entry: 7 cases.
- Foreign regular videos at the main database, owner-lock, integration-key and backup-root names are refused unchanged: 4 cases.
- Misleading valid SQLite databases containing a foreign table and schema version 21 at either main-database or owner-lock paths are refused unchanged: 2 cases.
- Source root equal to data directory, enclosing data directory, or inside data directory is refused before any writable database open: 3 cases.
- Both successful fresh reset and metadata-selective reset create a verified recoverable backup and preserve **34 original manifest entries** outside mutable SQLite control paths. Existing backup manifests, hashes, inodes, symlinks and hardlinks survive.
- Both success cases then acquire the normal owner lock, reopen `Store`, validate storage, and run actual `createServer().ready()`/`.close()` with every root confined to the fixture. Historical media, subtitle and metadata roots remain protected. No browser server listener is started, and automatic maintenance is disabled.
- After restart, `cleanupAssets` apply and reconciliation apply are blocked; reconciliation dry-run is allowed; streaming TTL/budget cleanup preserves old HLS outputs; managed-cache expiration, quota pressure and replacement preserve old files; generated publication refuses to overwrite an existing conversion. Direct output roots overlapping historical media/subtitle/metadata directories are rejected.
- A separate postreset stage-close test atomically replaces an app-owned temporary stage with a foreign video. `OutputPaths.close()` correctly preserves the foreign inode, confirming its explicit inode guard works.
- Invalid integration ciphertext causes backup verification failure. Original files and old backups remain; the source and both accounts remain; the storage cleanup flag remains unset. The app-owned partial backup bundle is left inside the disposable fixture, as designed.
- The late auxiliary replacement cases described above reproduce the confirmed failure twice and show the rollback-journal counterpart survives.

## Commands and actual results

All commands ran in `/Users/allan_bealsgibson/Code/tmp/myTuner` with explicit escalation for authorized test execution/edits outside the Pineapple writable root. Existing local binaries only; npm remained offline and disallowed installer fallback.

```sh
npm_config_offline=true npm_config_yes=false ./node_modules/.bin/tsx --test test/reset-r1-filesystem.test.ts
# Initial expanded execution: 48 entries, 45 pass, 3 fail; ~4.04 seconds.
# After both corrections and shutdown coverage expansion: 73/73 pass; ~6.68 seconds.

npm_config_offline=true npm_config_yes=false ./node_modules/.bin/tsx --test --test-name-pattern='regular video|stage cleanup' test/reset-r1-filesystem.test.ts
# Targeted execution before final fixture expansion: 6 entries, all pass.

npm_config_offline=true npm_config_yes=false ./node_modules/.bin/tsc --noEmit
# Exit 0, no TypeScript errors at the checked revision.

npm_config_offline=true npm_config_yes=false ./node_modules/.bin/prettier --write test/reset-r1-filesystem.test.ts
# Existing local formatter completed.
```

Focused reproduction command:

```sh
npm_config_offline=true npm_config_yes=false ./node_modules/.bin/tsx --test --test-name-pattern='late SQLite' test/reset-r1-filesystem.test.ts
```

The first execution exposed an incorrect reviewer-fixture lock-release call (`lock.close` versus the API's returned asynchronous release function). That test-only mistake was corrected before the reported full results. Both subsequent fresh/selective lifecycle tests pass. It is not a product finding.

## Limits and cleanup

Tested on the existing macOS/Node 24.13.0 SQLite runtime and installed FFmpeg. No Linux/Windows/filesystem-mount acceptance or arbitrary external-process race proof is claimed. The deterministic auxiliary replacement tests cover several explicit asynchronous boundaries and close paths, not every instruction-level interleaving. No crash/power-loss or disk-full simulation was performed by this pass. Browser/CLI interaction, recovery merge logic and schema-category correctness are assigned separately; this report makes no claim for them.

No household data, production reset, real media, network calls, package installs/downloads, emulator, commit, push, browser build, web-dist modification or global Playwright runner was used. Synthetic sources were read only by reset/server code; test construction and teardown touched only each newly owned temporary fixture. Each test's `finally` removes its own fixture recursively, including synthetic sources and intentionally retained partial backups. No fixture is deliberately left behind. Only the permanent regression test and this report remain as reviewer changes.
