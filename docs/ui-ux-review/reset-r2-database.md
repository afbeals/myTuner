# Reset safety review — round 2, independent database pass B

Status: completed after independent reproduction and coordinated fixes. The final focused suite passes **25/25 tests**. No production or household reset was run.

## Independence and scope

This pass read `AGENTS.md`, `docs/MYTUNER_PLAN.md`, `docs/RESET_DATA_PROPOSAL.md`, and the reset, database, metadata, storage-safety and recovery implementation before writing its own fixtures. It did not read other reset review reports or copy existing test fixtures before reaching its findings. Pineapple rules do not apply to this personal repository.

The independent regression artifact is `test/reset-r2-database.test.ts`. Fixtures populate every relevant application table, with three accounts (including a separately named earlier-sorting administrator), profile/source grants, indexed media, manual/imported/local metadata, retained collections, private channels, programming and active schedules, generation records, subtitle references, refresh/import diagnostics, account/device/playback sessions, playback events and problem reports. Generated-asset, subtitle and job path values intentionally include traversal-looking strings; reset treats them only as database values.

The reviewed branch was `feature/ui-ux-overhaul`, based on HEAD `a67d418cf7258e669b11fcc9cae63cdc1bcda92d`. Reset work is uncommitted, so HEAD alone does not identify it. Final tested SHA-256 digests:

| File                             | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `src/reset-data.ts`              | `28810ac4f35f4d832d3c6c4a2b34793767715c2979f96ce22df15cc622f4fcca` |
| `src/reset-offline.ts`           | `7981f20cbe5dd43d0855ecb63bb7fb147bbe52e80c899065fa5b7ecceaca3b18` |
| `src/reset-backup.ts`            | `59eada6061140b5f318f77c8daebfb34205ffe07975b163f3614fc9252c63de7` |
| `src/recovery.ts`                | `ce0b08f6af603d1d06d8652c3e5a7bd7ab4f8a4a28b42d308284d06b672d91cd` |
| `test/reset-r2-database.test.ts` | `1e1a1449c673c72d9f5093f293ebcedb11da29bfc5fe551feb4bac690d05f9d4` |

## Confirmed findings and fixes

### Verified backup could change before destructive SQL

Original reproduction:

1. Create and close the populated temporary database.
2. Obtain a real full offline preview revision and exact typed confirmation.
3. Call `executeOfflineReset`; in its asynchronous `backupCreated` observation boundary, open the newly verified backup database independently and update the retained administrator's username without changing any table count.
4. The original executor returned success and deleted the selected live records even though the backup no longer matched its recorded fingerprint.

The independent regression `fingerprinted reset backup cannot be silently changed after verification` originally failed with `Missing expected rejection`. Command:

```sh
npm_config_offline=true npm_config_yes=false ./node_modules/.bin/tsx --test --test-name-pattern='fault after SQL|fingerprinted reset' test/reset-r2-database.test.ts
```

The coordinated backend fix now pins the verified bundle privately and performs synchronous inode/content/manifest checks immediately before the reset transaction. The regression now passes.

### Verification and restore ignored the recorded reset fingerprint

Original reproduction:

1. Complete a real offline fresh reset and retain its valid generated reset snapshot.
2. Independently update one backup account username, leaving the snapshot healthy and every row count unchanged; retain the original manifest fingerprint.
3. Both `verifyApplicationBackup` and `restoreApplication` originally accepted the changed bundle.

The two independent `recorded reset fingerprint ... on verify/restore` regressions originally failed with `Missing expected rejection`. Command:

```sh
npm_config_offline=true npm_config_yes=false ./node_modules/.bin/tsx --test --test-name-pattern='recorded reset fingerprint' test/reset-r2-database.test.ts
```

This reviewer fixed `src/recovery.ts`. Reset manifests now require their complete recognized shape and a lowercase 64-character SHA-256 fingerprint. A manifest containing either reset-specific field must satisfy the reset format. Verification and restore enforce the recorded database-plus-integration-key hash, including a second check after asynchronous staging/key reads before installation. Existing non-reset format-1 snapshots remain compatible. Invalid bundles are retained.

Both original regressions pass. Nine malformed-manifest variants and changed encryption-key bytes also refuse both verification and restore; live database and integration-key bytes remain identical throughout those refusals.

## Executed coverage and results

- All eight selective categories and fresh start execute through the real offline authentication, exclusive ownership, backup and SQL transaction path. Dependency selections match an independent expected graph.
- Every one of the 255 nonempty category combinations executes the actual SQL primitive against a fully populated synthetic database inside a rollback-protected test transaction. Expected deletion counts, unselected rows, the current administrator and foreign-key integrity are checked; the original fixture is verified intact after each rollback.
- Unselected table rows remain byte-for-byte equal when serialized. Metadata reset retains catalog identity, grouping/order and technical values, and retained manual media/show metadata remains reachable through the real metadata resolver. Custom-only reset retains local/imported snapshots and catalog rows.
- Current administrator identity, username, password hash and credentials survive. Actual sign-in succeeds after every successful offline matrix case. The earlier-sorting administrator is never inferred as retained.
- Wrong/empty/oversized passwords, viewer identity, another retained-admin choice, malformed/duplicate/unknown categories and mismatched typed confirmation refuse. No backup is created for authentication/confirmation refusal.
- A same-count edit to an unselected profile during the backup await is rejected by the full revision check. A retained administrator disabled at that boundary also prevents deletion.
- An injected fault after media and other-account rows were actually deleted rolls back the entire transaction, including source protections. Metadata parse failure likewise leaves all records unchanged.
- Unknown tables, views and triggers, plus legacy/future schema versions, refuse before backup. Nonabsolute and storage-overlapping source/metadata paths refuse.
- A normal runtime owner blocks offline reset. A held offline context blocks a second context and normal runtime ownership.
- Invalid encrypted backup content and an injected post-backup failure retain application records, source files and the incomplete/verified backup bundle.
- Restoring an older compatible backup preserves post-reset source protections and cleanup disablement. Interrupted recovery unions current and journal protection roots and preserves stricter output-write disablement.

Physical sentinel bytes are checked after successes, refusals and fixture cleanup: source `.mp4`, adjacent `.nfo`/`.srt`, separate read-only metadata/subtitle files, an output-directory file, an unrelated neighboring video and an operator-created appdata notes file. All remained unchanged. No source, subtitle, metadata, generated-output, neighboring-media or operator file was removed, renamed or overwritten by tested reset execution.

Final command and result:

```sh
npm_config_offline=true npm_config_yes=false ./node_modules/.bin/tsx --test test/reset-r2-database.test.ts
# tests 25; pass 25; fail 0; duration_ms 4344.971417
```

Formatting used only the installed local tool:

```sh
npm_config_offline=true npm_config_yes=false ./node_modules/.bin/prettier --write src/recovery.ts test/reset-r2-database.test.ts
```

## Limits and cleanup

These checks use synthetic local temporary databases and byte sentinels, not household media, production storage, power-loss injection, or target-host Docker/Unraid behavior. They establish the tested database/backup boundaries; they are not a proof against an operating-system-level attacker changing files concurrently with synchronous filesystem calls. The historical non-reset format-1 backup format has no recorded expected content fingerprint and retains its prior compatibility behavior.

An initial harness run used macOS's aliased temporary path and correctly hit the linked-directory refusal before execution; fixtures were changed to `realpath`-canonical temporary paths. A separate exploratory embedded-NUL SQLite text variant was removed from the OS-path refusal test because Node's SQLite string retrieval truncates that stored text; no source-file operation or source-file safety failure was demonstrated by that exploration.

All fixture directories and synthetic databases are removed by their fixture cleanup after verifying sentinels. Only the requested regression source and review document remain, alongside the coordinated recovery source fix. No installer, download, network request, Git write, push, emulator, browser build or production reset was used in this pass. Root coordination owns global checks and shared release documentation.
