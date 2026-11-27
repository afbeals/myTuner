# Sources — configuration, scanning and picker contract investigation

Investigation only, base `a67d418`. Code-focused follow-up supporting the separate live Sources passes; not counted as a live page pass. No app changes or real providers/media.

## SRC-03/07 — one Save needs a server contract

The current Configure modal contains independently committed subtitle, metadata-location, integration and automatic-refresh forms (`web/src/Management.tsx:780–850`). Provider-suggestion refresh and mapping/import reports are read/check operations; Scan & refresh performs real catalog/provider work. They are not interchangeable saves.

Integration PUT/DELETE and refresh PUT are separate routes (`src/server.ts:584–641`). Subtitle PUT has optimistic `revision` checking and asynchronous path validation (`src/subtitle-routes.ts:34–71`); metadata-location PUT canonicalizes and checks the root asynchronously before committing (`src/metadata-routes.ts:58`). Simply calling these from one footer would allow partially persisted drafts.

Recommended alignment baseline, still proposed:

- One staged Configure draft with sections and one Save/Cancel. Preserve saved API keys when untouched, require explicit credentials/reuse for changed connection destinations, and make Disconnect explicit.
- Prefer a short atomic commit after all validation, I/O and encryption preparation completes outside the transaction. Reauthorize and check source/config/subtitle revisions immediately before commit; return section/field errors without discarding drafts. Define disconnect/reconnect intent rather than using empty API-key input as deletion.
- Scan starts only from an explicit run action, after saved configuration is established. Automatic refresh scheduling is consequential: `RefreshService.schedule` sets `next_run_ms` to now (`src/refresh.ts:195`), making the source due on the next scheduler tick. A new Save must not accidentally enable work or reset an unchanged interval.
- Review a conflict rather than overwriting a concurrent settings change. Existing subtitle revisions and provider-suggestion signatures should survive UI consolidation.

## SRC-03 — scan modal versus prior import diagnostics

A source scan inspects source files, then optionally reads/imports Sonarr/Radarr metadata. Same-source requests with the same connection signature coalesce; a changed signature waits then starts a fresh run; at most two refreshes run concurrently (`src/refresh.ts:392`). Background admission still controls actual heavy work. The current scan endpoint stays open until completion; changing this to a navigable progress dialog may require persistent run/status/cancellation contracts, not only moving existing JSON into a modal.

Proposed flow: scope/options → explicit Start → compact progress → human summary with expandable errors and previous-run details. Distinguish files found, inspected/unchanged, unavailable, provider matches/unmatched, incomplete traversal and a superseded connection. Source directory/recursion changes are persistent source edits today; a per-run option must say whether it changes that source. Do not mark missing files from an incomplete scan or silently invent a “reuse previous scan” action.

## SRC-01/02/06 — three different path capabilities

1. **Mounted-directory suggestions:** own Linux mount targets from `/proc/self/mountinfo`, already cached; not the original host mapping or Docker configuration. Mac cannot validate the Linux runtime display. No Docker socket/daemon access.
2. **Source setup checks:** explicit `/api/admin/setup/check-directory`; bounded samples, read-only, cancellation and source-snapshot reauthorization (`src/setup-routes.ts:26`). “Readable directory” and sampled supported extensions are evidence, not full playback certification or guaranteed continued availability.
3. **Scanned subfolders:** `src/source-directories.ts:8` derives catalog ancestors without walking disks. It excludes empty/unscanned folders and currently recomputes a recursive CTE for every page/search. The proposed tree needs bounded direct-child queries, a revision-aware compact directory projection if measurement warrants it, and branch cache until unmount.

Mapping rows are provider-path → myTuner-path. Only the local destination can be checked directly; checking `/anime_tv` in myTuner cannot validate Sonarr’s namespace. Validate local existence/readability/containment and stale drafts at save without opening media. Distinguish invalid versus temporarily offline destinations, with an explicit policy for saving known offline configuration. A check result must bind to the exact edited values and not persist as timeless “valid”.

## SRC-04/05 — simplify wording without removing work bounds

Subtitle discovery currently has a bounded nested-folder depth, max 4 (`src/subtitle-catalog.ts:24`). “Check directory” sampling has a separate bounded traversal. Mirrored NFO roots have another lookup contract. A user-facing Include subfolders toggle can replace the confusing numeric depth, but unlimited recursive playback-time traversal would harm HDD latency. Prefer indexed/background discovery with internal depth/entry/time bounds, honest incomplete results and an advanced override only if justified. Preserve adjacent/mirrored/manual subtitle locations and indicate what was found.

## Future acceptance/adoption tasks

- [ ] One failed/conflicted section cannot leave an apparently successful atomic Save; draft and section errors remain available.
- [ ] Saving unchanged refresh settings does not reset due times/start extra work; Scan is always explicit.
- [ ] Mapping checks distinguish provider/local namespaces, cancellation, unavailable storage and stale results.
- [ ] Lazy directory trees never probe media, expand whole disks or silently turn parent grants into exclusions; wide folders keep bounded pagination.
- [ ] Apply global sticky modal/footer, tree adapters, information controls, action grouping and confirmation on Sources; retain local section headings/copy/layout work here.

Evidence is supporting source inspection plus [live pass 1](sources-pass1.md). Single-save atomicity, offline-save policy, per-run scope and subtitle recursion remain alignment decisions. No new behavior was implemented.
