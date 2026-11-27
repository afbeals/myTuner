# Reset safety round 2 — independent filesystem findings and retest

This report consolidates the independent filesystem reviewer's executed records and the final independently repeated regression. The coordinator wrote this consolidation; the original reviewer created `test/reset-r2-filesystem.test.ts` and reported both failures before implementation changes. The round-2 operator reviewer independently inspected and ran the final matrix, as recorded in [its report](reset-r2-operator.md). These are three distinct roles, not a claim that the original reviewer performed the final rerun.

## Independent observations

The original reviewer generated a tiny synthetic FFmpeg video and built independent temporary fixtures containing video, NFO/SRT, operator files, old backups, generated/cache files, linked control files and unusual path names. It compared file contents, types, modes, link targets/counts, device and inode identities. It did not read first-round reports before its own inspection/tests and changed no product code.

The expanded original run executed **48 cases: 46 passed, two failed**. Both failures involved the asynchronous pathname open used to append a reset backup's key/manifest. During that operation the test renamed the newly created bundle and replaced its former path with a symlink into the configured synthetic source:

- The key variant created `source/integration.key`; a later check rejected reset.
- The manifest variant created `source/manifest.json` and reported successful reset with an advertised backup path that no longer contained the snapshot database.

Existing synthetic MP4 content remained unchanged; writing anything into the source and accepting an unusable backup were confirmed failures. The passing cases included late main/owner-lock auxiliary replacement, header changes, aliases, quoted/newline data paths, cleanup/cache barriers and protected-root reopening.

## Correction

The backend author changed backup database allocation and key/manifest publication to exclusive synchronous operations with adjacent directory, inode, link and descriptor checks. Publication has no intervening promise-based file open. The executor also checks its privately pinned backup identities, complete DB/key hash and exact manifest immediately before beginning the destructive transaction. Refusal retains incomplete bundles and does not remove the changed directory or any source file.

The original promise-open timing hook no longer represented an executable boundary. The backend author adapted only that timing: the manifest swap now occurs during the final awaited directory-stat preparation; the key swap occurs during the preceding awaited source-key read. The tests still require an actual swap, unchanged protected-file inventory, no source write, reset refusal and retained media. They also assert that publication does not call promise-based file open. The coordinator changed only temporary-directory/FFmpeg paths to portable system APIs for CI.

## Independent final result

The round-2 operator reviewer inspected those assertions and executed:

```sh
npm_config_offline=true npm_config_yes=false ./node_modules/.bin/tsx --test test/reset-r2-filesystem.test.ts
```

**48/48 passed**, zero skipped/failed/cancelled. [The retained independent output](reset-r2-operator-filesystem-retest.log) and [reviewer's detailed interpretation](reset-r2-operator.md) record the exact execution/source identity.

Both publication variants reported `injected: true`, `wroteToReadOnlySource: false`, `resetSucceeded: false`, and the directory-change refusal. The manifest case retained its media row. Synthetic fixtures were removed after testing. No household data, Docker engine, installation, network, Git write or production reset was involved.

## Limits

These deterministic Node/macOS tests exercise selected asynchronous interleavings; they are not proof against a privileged host process racing every system instruction. Appdata must remain exclusively controlled by myTuner/its offline tool. The production Unraid helper mounts only appdata with networking disabled and does not mount media. Linux/Windows Docker, actual Unraid storage and physical-device acceptance retain their separate documented boundary. There is no unresolved confirmed finding in this pass after the independent final retest.
