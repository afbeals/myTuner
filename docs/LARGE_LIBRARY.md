# Large-library browsing and explicit directory checks

This describes the current 0.3.0/schema 20 implementation for libraries with thousands of episodes, movies and custom videos. It retains the compact catalog introduced in 0.2.2. Follow [verification](VERIFICATION.md) for executed results and [performance](PERFORMANCE_PLAN.md) for measurements and target-host limits. The application never copies or changes source media to build this index.

## What happens when you open the library

The browser requests one page of 24 entries. The production HTTP library endpoint also defaults to 24 when a caller omits a limit, so omission cannot bypass reader/page bounds. Previous and Next choose the requested page; there is no infinite scroll or automatic next-page fetch. Mounted catalog views cache up to 24 response pages in memory, so revisiting a cached page can avoid a request. Profile/view revision changes, observed new catalog revisions and recognized access failures invalidate relevant cached presentation; Refresh explicitly reloads and unmount clears it. Artwork loads lazily. A show or folder is a group, so its episode/video count can exceed the page size.

For a file-backed production database, the server first brings a compact persisted search index up to the current catalog revision. It then sends the request to one read-only SQLite worker. The worker applies grants, searches and groups compact records, and loads full stored metadata only for the requested media page. Only the response page crosses back to the main server. Opening a library page does not enumerate media directories, invoke ffprobe or contact Sonarr/Radarr.

The main connection remains the only SQLite writer. Backfill and subsequent updates use short transactions, at most 64 media records and a 4 MiB combined media/provider/display-metadata input budget per batch, and yield between batches. An individual oversized metadata record receives an explicit error rather than silently disappearing. This still performs database I/O and some bounded work on the main thread; a worker does not make storage free or eliminate every possible native SQLite stall.

## Stored source freshness

Catalog availability is the last known scan result, not a new disk check whenever a card opens. After an incomplete/offline scan, retained available rows can still be listed while playback correctly finds the source unavailable. The browser can show this distinction using `GET /api/profiles/:profileId/source-inspections?ids=<uuid>,<uuid>` separately from cached catalog pages.

Send at most 100 source UUIDs per request, rather than fetching status per media row. The endpoint batches requested sources and refresh attempts into one database read after current profile authorization. Non-admin results include only requested sources granted to that profile; responses contain no absolute paths, provider credentials or raw OS errors. It performs no source traversal, file stats, ffprobe or upstream calls.

Each item has `sourceId`, nullable `lastAttemptMs`, `lastCompletedMs`, `lastSuccessMs`, and `status` (`never`, `checking`, `current` or `incomplete`). A failed check preserves the prior last-success time. Show retained information as last known when the latest check is incomplete. Even `current` describes the stored refresh snapshot, not a guarantee that the file or mount remains available now. See [the API reference](BACKEND.md#refresh-diagnostic-contract-schema16).

## First run, subsequent runs and restart

Migration 19 creates compact rows, group memberships, dirty queues and publication state. The initial backfill walks the stored catalog once, with a durable cursor. A stop or cancellation can resume from committed progress. It does not rescan videos. A partial or obsolete revision is never served as a completed index.

Relevant media, source, provider and display-metadata changes queue affected items or sources. Duplicate dirty entries coalesce. Deletions remove indexed rows; source/show changes can update multiple affected items. When the queues are empty, publication records the current catalog revision atomically. Reopening an unchanged library reuses persisted rows; no-op preparation does not rewrite them. The worker still reads and searches the compact authorized catalog, so a fresh search has a cost, but it does not reparse every full provider description and technical record.

Source refresh jobs have different costs. A later unchanged refresh skips unnecessary media/track rewrites and reuses bounded per-scan observations, but still needs relevant directory names and file stats to detect additions, replacements or removals. It is cheaper than a first probe/import, not a zero-cost filesystem watcher. Generation reuses valid existing outputs unless regeneration is selected.

## Permission and ordering guarantees

- Grants are applied before counts, group representatives and search results. Private or denied media cannot contribute titles, artwork, counts or collections.
- Matching one episode can return its show with complete authorized counts, preserving whole-show selection. Season/special ordering, missing-item inspection, manual/local/provider titles, custom ancestor folders and existing substring-search behavior are retained.
- Sessions, account status, device/PIN scope, profile access and catalog revision are checked around awaited work. Immediately before sending the page, the route reauthenticates and validates the completed page's recorded revision. A changed catalog is retried once by the service; continuing changes return a retryable error.
- Each worker query uses a read-only snapshot. It does not construct a second writable Store, run migrations, fetch credentials or write source files.

## Resource and failure limits

There is one active reader, eight queued requests and 64 total waiting callers by default. Identical authorized requests share work. Disconnection cancels that caller; other callers sharing the request can continue. Requests have a 15-second processing deadline; an unresponsive worker is terminated and restarted with a short backoff. Native filesystem/SQLite operations cannot be promised an absolute interruption deadline.

The worker has a 256 MiB old-generation and 16 MiB young-generation V8 heap setting. These are not a total process/container memory limit: SQLite/native allocations, the main server, structured cloning and FFmpeg add memory. Returned pages are limited to 8 MiB. The compact authorized read model has a 64 MiB working budget; this replaces the old total-raw-metadata admission guard. Very large individual records and compact catalogs can still exceed deliberate limits. Small in-memory test stores retain a bounded reference path; production and large-library acceptance use file-backed SQLite.

No full-text search service, FTS index, extra database or new host program is required. FTS would need to preserve the existing substring behavior and justify its write/index cost before selection. Measure actual Unraid HDD latency, peak shared-memory use and playback interference before selecting container resource limits.

## Waiting during playback and other background work

The generation-job detail/list and source scan-status APIs expose `admission` and `waitingReason` for the individual task. `waiting` with reason `playback` means policy is holding optional work for playback; `queue` means the task is awaiting admission. Generation can additionally wait for `playback-capacity` at encoder admission. `active` means admitted work, and null admission identifies idle/finished work. Persisted job status and output counts remain separate: a job can be marked running with zero outputs while its next task waits.

Use these task fields for progress labels instead of inferring a particular scan/job from the global background snapshot. A task already running can finish or reach its checkpoint before pausing, so a global playback pause does not claim every current operation stopped immediately. These progress reads do not start work or increase scan/encoder concurrency. See [generation API details](BACKEND.md#generation-and-cleanup).

## Check a manually entered directory

Source, separate metadata and subtitle directory fields provide an explicit **Check directory** action. Typing, choosing a mount suggestion or opening the form does not start filesystem sampling. The check uses the server/container path, such as `/tv`, rather than the Unraid host path.

The admin-only CSRF-protected request is `POST /api/admin/setup/check-directory` with `path`, `purpose` (`source`, `metadata` or `subtitles`), `recursive` and optional `sourceId`. A source ID is required for source-specific metadata/subtitle checks and allows validating an existing source's own root during editing. Blank metadata/subtitle roots mean beside the source's videos.

The response reports existence, directory readability, canonical container path, a small extension-based sample and whether checking completed. Default limits are 256 entries, 32 directories, five supported names, up to two subfolder levels and a two-second response deadline. It distinguishes missing, non-directory, inaccessible, invalid and incomplete results. Supported extensions indicate candidates, not verified decodability or guaranteed subtitle compatibility. Run the ordinary scan to inspect media and refresh metadata.

Checks are read-only: no video opening, ffprobe, provider calls, file writes or automatic full scans. They skip symlinks and stop after useful samples or the configured small entry/directory/depth/time limits. A shallow empty result covers only that directory; a bounded recursive result can be incomplete. One underlying check is admitted at a time, with no queue. If an underlying disk call stalls past the response deadline, admission remains occupied until it finishes, preventing repeated clicks from piling up HDD work.

Changing the path or scope invalidates old feedback. Authority and source settings are rechecked after awaits. A successful check is advice about that moment, not a reservation: saving and scanning validate again.

## Operational follow-ups

Run [read-only Unraid checks](UNRAID_CHECKS.md) first. Then record cold and warm library latency, search/page timings, container peak RAM, disk latency and other-container responsiveness during representative direct/HLS playback and optional jobs. Linux image acceptance, the owner's Windows Docker workflow and physical TV checks remain separate gates in [differed](differed.md).

Optional off-peak background windows, unrestricted filesystem browsing and a durable generated-output accounting ledger remain future choices. Version 0.3.0 adds a shared indexed directory tree for show/channel/grant selections and a separate explicit bounded setup tree confined to permitted mounted/configured folders. It does not crawl all shares on form opening. The typed-path resolver remains a separate bounded sample check. See [performance limits](PERFORMANCE_PLAN.md) for setup listing/cache bounds.
