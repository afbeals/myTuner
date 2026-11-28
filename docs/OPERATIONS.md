# Operational runbooks

## Operating status and prerequisites

The server foundation is locally verified; Docker/Unraid, installed Sonarr/Radarr and physical clients remain acceptance work. These procedures make deployment/recovery reviewable without claiming they ran on the user's server. Version 0.3.0 includes the approved browser manager/player overhaul and native Android/Fire OS TV POC; full household/device acceptance remains open.

Use Node 24.13+ within major 24, npm and FFmpeg/ffprobe on a local development host, or the supplied container on a Docker-capable host. The process needs read access to original shares and write access only to app data/generated/cache. Keep SQLite on local appdata storage. One server owns a data directory; do not start multiple replicas/containers against it.

## First local startup

From the repository root:

```sh
npm ci
npm run build
npm run typecheck
npm test
```

Choose all writable locations explicitly when deviating from defaults:

```sh
export MYTUNER_DATA_DIR=/path/to/local-appdata/mytuner/data
export MYTUNER_GENERATED_DIR=/path/to/local-appdata/mytuner/generated
export MYTUNER_CACHE_DIR=/path/to/local-appdata/mytuner/cache
```

Supply `MYTUNER_ADMIN_PASSWORD` privately through the process environment, then run `npm run admin:create -- your-admin-name` **before starting the server**. Unset the bootstrap password afterward. The bootstrap acquires the same data lock and only works before an admin exists; later account administration uses the authenticated API.

Start development with `npm run dev`, or compiled operation with `npm start`. Defaults bind `127.0.0.1:8777`. Set HOST deliberately for LAN service; Docker sets it to 0.0.0.0. Health is `GET /api/health`; success verifies a basic DB/process response, not actual source access or a physical TV stream.

Changing `MYTUNER_DATA_DIR` alone does not relocate the generated/cache defaults: those default independently to `.data/generated` and `.data/cache` relative to working directory. Always configure all three for a real deployment. Full settings are in [BACKEND.md](BACKEND.md).

For the browser click-through, use [Create your first channel](FIRST_CHANNEL.md). For exact container commands and host/container paths, use [deployment backup/recovery](DEPLOYMENT.md#container-backup-verification-and-recovery-commands).

If an account password is forgotten, another authenticated administrator can reset it in Accounts. The first-admin bootstrap deliberately rejects an existing administrator; there is currently no supported offline sole-admin reset. Preserve administrator credentials securely and keep a separately authorized recovery administrator if appropriate. Do not edit database password fields manually.

## Initial API setup sequence

Use an authenticated admin browser/script context. The route catalog is [BACKEND.md](BACKEND.md); this order prevents trying to program an empty or ungranted library:

1. Create accounts and person/room profiles; set membership, management and optional PINs.
2. Register non-overlapping existing source roots and kinds using server/container paths.
3. Scan each root and inspect `complete`, `errors`, `seen`, `updated` and `missing`.
4. Save Sonarr/Radarr provider, URL, API key and mappings where needed, then scan again to import metadata. One-shot import assumes the files have already been scanned.
5. Enable periodic refresh if desired; inspect sanitized refresh status and last success.
6. Grant each profile the appropriate sources/subtrees.
7. Browse that profile's library; use returned source/show/collection keys to preview selections.
8. Create a channel, preview/publish recurring programming and subscribe the profile.
9. Join through the browser or paired TV client, negotiate delivery and inspect real output.

Do not put live API keys, passwords, cookies or bearer tokens in committed examples. There is no anonymous account or default password.

## Routine health and refresh checks

Check process/container health, structured stdout logs, source mount visibility, refresh errors/last success, schedule coverage, generated queue status, free disk and backup age. `/api/admin/refresh` and `/api/admin/generation` require admin credentials. Normal API health can coexist with an offline share or failed upstream connection.

A refresh interval of one minute to seven days is supported; null disables it. Maintenance checks every 30 seconds. Concurrent requests for one source share the same task; two source tasks can run at once. Temporary upstream failures preserve metadata and retry within five minutes or the shorter interval. Inspect mapping/availability before changing a refresh interval to mask an error.

Adding a source does not start a bulk conversion. Review generation scope via preview; enqueue only the selected directory/kinds and observe item progress. Cancel/retry via APIs; completed outputs remain reusable.

## Current budgets and retention

These are implementation defaults/guards, not a capacity guarantee. Most are constructor constants, not environment-variable settings. Tune code and retest if a workload requires changes.

| Area                             | Current limit or behavior                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| HTTP request body                | 1 MiB                                                                                           |
| Probe per file                   | 30 seconds, 4 MiB captured output                                                               |
| Upstream API request             | 20 seconds, redirects rejected                                                                  |
| Refresh execution                | Two simultaneous source jobs; duplicate source request shares existing task                     |
| Rolling schedule                 | Default 48-hour target; bounded batches and 100-batch catch-up per attempt                      |
| Preview/publish input            | Up to 100 programming groups; explicit selection/collection inputs bounded at 5,000 media IDs   |
| Generation scope                 | At most 5,000 files per job, bounded requested kinds                                            |
| Generation queue                 | 25 pending jobs, enforced atomically on insertion; one item executing at a time                 |
| Generated storage                | 50 GiB budget, 512 MiB free-space reserve; each output under 5 GiB and process at most one hour |
| HLS work                         | Two distinct conversions at once; identical authorized work can share                           |
| HLS segment                      | Up to four seconds, under 8 MiB output, 60-second conversion timeout                            |
| HLS cache                        | 512 MiB target budget, ten-minute age cleanup and free-space guards                             |
| Text extraction                  | One job, 60 seconds, output under 10 MiB; supported text codecs only                            |
| Text/artwork cache               | Separate 64 MiB budgets with 32 MiB reserve checks                                              |
| Artwork response                 | At most 2 MiB, supported image MIME, restricted host/path                                       |
| Playback session                 | Collected after 24 hours without activity or invalid authentication session                     |
| Superseded revision              | Eligible for collection after seven days when neither active nor playback-referenced            |
| Active history/telemetry/backups | No complete automatic archival/retention policy yet; measure and decide before household use    |

Generation quotas are not automatically filled/evicted to make every new job succeed. Low space produces a safe per-item error. HLS cleans managed segments automatically. Artwork/subtitle caches independently expire files after one day and evict least-recently-used managed entries to remain within their 64 MiB budgets and 32 MiB free reserve. Fresh conversion partials are protected; recognized interrupted partials older than one hour can be reclaimed. Cleanup scans are bounded to 4,096 entries and refuse links/unexpected entry types. Admission may still return 507 if safe reclamation cannot provide the required space.

## Storage cleanup

In **Generated assets → Output storage**, review generated outputs before applying. The browser sends `POST /api/admin/assets/cleanup` with `{"dryRun":true,"reconcile":true}`. The report counts stale assets, missing references, managed orphan files, old interrupted outputs, preserved unknown files and reclaimable bytes, plus a `review` SHA-256 token. Apply with `{"dryRun":false,"reconcile":true,"review":"<returned-token>"}`. A changed filesystem/reference set rejects the old review with 409: review again before applying.

Reconciliation visits only the configured generated root, at most 10,000 entries and 10,000 reference rows. It recognizes the application's UUID/hash thumbnail/GIF/conversion layout, preserves unknown files/current outputs and refuses symbolic links or unexpected nesting. It removes stale/missing database references, orphan managed outputs and recognized interrupted partials older than one hour. It never touches original media/NFO/subtitles. Generation admission/work is excluded while review/apply runs; shutdown waits for maintenance to settle. Permission and file/reference identity are checked again before each change. An interrupted apply may be partially complete; another dry run safely reviews the remaining work. Empty directories are not automatically removed.

Missing outputs are surfaced by removing unusable references. Regeneration remains an explicit directory-generation action, not an automatic bulk job after cleanup/restore. The older `{dryRun:true}` contract still reviews only stale referenced assets unless `reconcile:true` is provided. Actual restored-volume/disk-pressure rehearsal on Unraid remains separate acceptance.

Cache is disposable. If manual cache reclamation is necessary, stop the server, verify the exact configured cache path and its HLS/artwork/subtitle subdirectories, clear only those disposable outputs, then restart. Do not treat app data, `integration.key`, generated assets or any media root as cache. No broad deletion command is supplied because path mistakes would be destructive.

Generation cancellation removes its partial work. Missing generated files after a volume restore are repaired by explicit regeneration, not by modifying original media.

## Application backup

While the server is running or stopped, run:

```sh
npm run db:backup
```

For a production image without dev dependencies use `node dist/backup-cli.js`. The CLI prints the snapshot directory. It uses SQLite's backup API, validates integrity/foreign keys/schema and writes a private application bundle:

```text
snapshot-<timestamp>-<uuid>/
  mytuner.db
  integration.key    # when present
  manifest.json
```

This captures DB/application credentials, not original media, generated files, cache, Compose settings or host mounts. Preserve deployment settings separately and keep the bundle private. Copy only completed snapshot bundles into an external backup process; a backup on the same disk is not protection from disk failure.

Pre-migration `.db` snapshots are a separate safety mechanism and must be preserved with the matching integration key. Do not copy only a running `mytuner.db` and assume WAL writes were included.

## Offline restore and rollback

1. Stop the server/container; ensure no other owner uses the same data volume.
2. Preserve the current data directory and identify a known application snapshot and matching runtime version.
3. Run `npm run db:restore -- /absolute/path/to/snapshot-directory`, or `node dist/restore-cli.js /absolute/path/to/snapshot-directory` in the compiled image with the snapshot mounted.
4. Restore validates the input database, migrations and credential decryption before replacing live data. A healthy current database receives a validated pre-restore snapshot for rollback. If the current database fails SQLite integrity checks, has a corrupt/not-a-database error, or its live integration key is missing/malformed/mismatched for the current encrypted configuration, preserve its database/WAL/SHM and encryption-key bytes in a private `backups/damaged-*` directory, record that no validated rollback exists, then install the validated input. These forensic copies are never treated as valid restore snapshots. Filesystem/permission/I/O errors and unsupported future schemas abort rather than being treated as corruption. Sessions are revoked during installation.
5. Start the server, sign in again, re-pair TVs as needed, inspect settings/mounts, rescan sources and explicitly regenerate missing outputs.
6. Validate schedule continuity, current permissions and playback on actual mounted files.

R7-03 is corrected: a damaged current integration key no longer prevents installing an independently validated bundle. The key damage path preserves DB/WAL/SHM/key privately with an accurate damage reason and no claimed validated rollback, then uses the original validated source for interrupted recovery. Malformed present unused keys also follow this path; absent unused keys remain valid. Invalid input bundles still fail before live replacement/journaling. Genuine I/O/permission/future-schema errors still abort. Never invent a replacement key for encrypted rows.

An interrupted restore leaves `restore.pending.json`, blocking startup. With the server stopped, run `npm run db:restore -- --recover` or compiled equivalent. With a healthy prior snapshot, recovery reinstalls that snapshot. For a corrupt-live-database restore, the journal instead records the preserved `damaged-*` directory and the originally validated input; recovery revalidates and retries that input, leaving damaged bytes untouched. Keep the input bundle mounted at its original path until success. If neither supported recovery path is available, automatic recovery rejects the operation; preserve the journal and inspect the known bundle instead of deleting the protection blindly.

The process holds an exclusive SQLite transaction in a separate `runtime-lock.db` for its entire lifetime. Stop an active owner before bootstrap/restore. The OS releases ownership when the connection closes or the process crashes; PID reuse and leftover PID files do not determine ownership. Keep the lock database at its stable path and never delete or replace it while any owner may be active. Older PID-file-based versions must be stopped before switching implementations; obsolete `server.lock` files are not used by this version. The lock database contains no application state and is excluded from application snapshots. Use local appdata storage with working SQLite filesystem locks, not SMB/NFS or a distributed ownership scheme.

## Image update procedure

Build/test an explicit version on a Docker-capable host, record its image identity and take an application backup. Stop the running container, update the image while retaining the same volumes, start and check health/migrations/logs, then validate library/schedule/playback. Keep the prior image and pre-update application backup until acceptance.

An older image may reject a newer schema. Rolling back the image alone does not roll back SQLite; use a compatible database/key snapshot through the supported offline restore procedure. The current scripts use package-version and latest tags, but a tag can be overwritten; retain a verified digest or enforce unique release versions operationally.

## Diagnosis guide

| Symptom                                | Check and next action                                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| API healthy but TV cannot connect      | Server bind/host port, address/DNS, routing/firewall and TV network; router work is separate                 |
| Empty profile library                  | Profile membership/unlock, source/subtree grants, completed scan and actual files                            |
| Sonarr/Radarr metadata unmatched       | Upstream path versus container path, source root/kind, mappings and prior scan                               |
| Entire source appears offline          | Host mount/read permissions; repeat complete scan after recovery, preserve prior state                       |
| Video changed or old pause unavailable | External replacement fingerprint; rescan and rejoin current programming                                      |
| HLS returns 429                        | Conversion concurrency; bounded retry, inspect CPU and avoid unnecessary paused fetches                      |
| HLS/refresh/schedule returns 503       | Service stopping or bounded catch-up; retry with delay and inspect maintenance progress                      |
| Request returns 507                    | Free space/reserve/cache budget/generated quota; reclaim only verified application output                    |
| Browser mutation returns 403           | Current CSRF token, same origin/public origin, role and profile lock                                         |
| A channel returns 404                  | Missing/archived/hidden resource or insufficient source/profile rights; do not infer existence across users  |
| Startup missing integration key        | Restore original matching key/application snapshot; do not create an unrelated key                           |
| Startup locked or pending restore      | Stop active owner or use supported recovery; inspect before changing lock/journal files                      |
| No thumbnail/artwork                   | Optional generation not requested, restricted/missing upstream image or unavailable source; use placeholders |

## Acceptance still required

Test read-only mounts, runtime UID/GID, host reboot/restart, deployed backup/restore and image rollback on Unraid. Measure long-duration/concurrent playback, disk pressure, source outages, real Sonarr/Radarr changes and browser/Media3 behavior. Cross-network firewall/DNS setup and optional TV cleanup remain separate tasks; see [deployment](DEPLOYMENT.md) and [checklist](CHECKLIST.md).

## Interrupted fresh-target restores

Restore validates backup integrity, schema migration and encrypted integration settings before creating a pending journal, including when the target directory is empty. An invalid integration key therefore leaves no new live database or blocking restore journal.

A crash after journaling still requires `npm run db:restore -- --recover` before normal startup. Recovery uses the previous validated snapshot when one exists. A fresh target has no previous snapshot; recovery retries the original validated source bundle recorded in the journal. A damaged target uses the same retry path while retaining its quarantined forensic files. Keep the source bundle available until restore and recovery complete. If input is missing/corrupt, recovery fails with the journal intact; repair/restore access to that known bundle and retry. Do not remove a pending journal merely to bypass startup protection.

## Shutdown with active viewers and pending generation

SIGTERM/SIGINT ends active HTTP playback connections rather than waiting for a long video or stalled viewer to finish. Tracked streams are aborted in Fastify's `preClose` phase and remaining HTTP connections are force-closed. The server then stops and awaits generation, refresh and delivery workers, closes SQLite, and releases the data-directory ownership lock. Clients may reconnect after the server returns. No source media is changed.

Generation admission checks the pending-job cap both before expensive validation and inside the final synchronous insertion transaction. Concurrent requests cannot both claim the final slot. Capacity rejection returns 429; cancellation or completion releases capacity. A request still validating when worker shutdown begins is rejected with 503 rather than inserting work after stop.

## Cancellation, delivery setup and integration changes

Cancel marks a generation job cancelled and aborts its worker. Retry can return 409 with “Cancellation is still finishing; retry shortly” until the previous worker settles; retry afterward. This prevents a previous attempt from finalizing the replacement attempt. Retry also respects pending capacity and shutdown, retains completed items, and requeues failed/cancelled work. Completion requires every item to have completed successfully.

Artwork shutdown also aborts/drains pending image fetch/body/cache work before application close resolves, preventing late cache publication. Streaming shutdown drains pending segment setup as well as active encoders. Filesystem validation cannot admit new conversion after stop begins; the encoder checks cancellation before starting. The database and ownership lock remain available until tracked setup/work has settled.

Changing a saved Sonarr/Radarr connection invalidates the previous refresh's metadata and status result. A superseded response is discarded, including old failures, and cannot mark the new settings successful. A new scan request waits for prior work to settle and then uses the current connection. Configuration identity includes provider, URL, mappings and the freshly sealed API key; saving identical values still creates a new identity. No database migration or new plaintext credential storage is introduced.

## Selected operational status and reconciliation support

`GET /api/admin/status` adds read-only operational visibility for administrators. It caches results for fifteen seconds, checks at most 32 mounts and 200 completed-bundle manifests, and gives filesystem probes a two-second response deadline. It returns unknown/truncated states instead of pretending to inspect everything. Mount checks test read access only. Free storage is filesystem headroom, not a new quota promise. Completed-backup detection checks manifest/database/key-file presence without loading secrets or executing a full integrity audit.

A full application backup is operator-triggered with `npm run db:backup` in a checkout or `node dist/backup-cli.js` in the production container. There is no automatic recurring schedule. A healthy offline restore also creates a pre-restore recovery bundle, while migrations create a separate database-only safety snapshot. The dashboard will distinguish no completed bundle from a completed one; it must not represent a pre-migration DB alone as a full application backup. Choose Unraid User Scripts/cron cadence and off-host retention separately; nothing here changes the host configuration.

Backups validate the copied database with the copied/current root key before writing a completion manifest. If an offline restore replaces the root/key while a CLI still holds the old database connection, backup either produces a decryptable consistent bundle or removes its incomplete snapshot and tells the operator to retry after restore. Live media remains untouched.

`GET /api/admin/setup` supports status-driven onboarding. Mapping preflight accepts at most twenty example upstream paths and compares the saved mapping to the current catalog; it does not call Sonarr/Radarr or create probes in media directories. `GET /api/admin/profiles/:profileId/access/:accountId` evaluates the named target's real role/membership/grants; it is not credential impersonation or proof a session is PIN-unlocked.

Successful provider reads record import-run reports and retain twenty per source. Reports distinguish source-scan completeness from provider-read success and show missing associations as review candidates. Failed/partial upstream requests retain prior metadata. No automatic detachment/deletion was added; accept installed Sonarr/Radarr completeness/removal semantics before defining that policy. Reports may contain many item rows even with a bounded report-count retention; monitor database growth on the real archive.

## Playback-first optional generation

Set `MYTUNER_ENCODER_CONCURRENCY=3` initially (allowed 2–8); Compose forwards it to the server. Optional generation can use at most total minus one slots, while HLS/subtitle extraction uses interactive admission. Existing running tasks finish, and one background admission is allowed after eight interactive admissions when eligible. This avoids indefinite starvation without a claim about host CPU, throughput or playback latency. Per-service limits still apply. Direct playback and existing derivatives/cache hits need no FFmpeg slot.

“Waiting for playback capacity” on a generation item is progress, not failure. Leave it queued, cancel it normally, or wait for interactive work to finish. Shutdown cancels waiting work and returns interrupted generation to queued for replay. Do not restart the server merely to clear the waiting label. Measure real Unraid load before increasing the budget; hardware acceleration remains separate work.

## Read-only preflight and commercial retirement

Use Playback readiness on library/channel details to inspect predicted routing from stored scan metadata and declared capabilities. It starts no scan or encoder and does not certify a particular TV. Unknown/stale metadata needs a deliberate source scan; image-caption limitations still require separate implementation/acceptance.

Collection Delete first shows an advisory dependency report. Refresh before deciding; other authorized edits can change the result. Deletion leaves source bytes, materialized schedules and retained paused revisions intact. It does not repair dependent recurring selectors.

To retire an ad on one channel, edit Commercials → Commercial eligibility, disable the clip, preview and publish. Existing current airings/paused revisions keep the previous choices until normal publication boundaries. Re-enable by checking the same clip. An empty eligible pool returns to programming without scheduled dead air. No file move, global retirement, automatic date window or emergency blackout is performed.

Every present integration encryption key must be exactly 32 bytes, including installations with no encrypted integrations. Backup rejects malformed unused keys without publishing a completed bundle; restore validates a present snapshot key before replacing the target. An absent unused key remains valid. Startup, backup and restore now agree on this rule; neither operation silently repairs or replaces an encrypted integration’s key.

## Verify a backup without installing it — I38

Run from a checkout:

```sh
npm run db:verify -- /absolute/path/to/snapshot-directory
npm run db:verify -- /absolute/path/to/snapshot-directory --json
```

In the compiled container use `node dist/verify-cli.js /mounted/snapshot-directory --json` with the bundle mounted read-only. Verification does not need the live data directory or its lock; it can run while the server owns live data. It creates private OS temporary scratch, stages only the application database there and shares restore checks: manifest format/database schema/key-presence agreement; SQLite integrity/foreign keys; supported source schema; migrations in scratch; present 32-byte key and successful decryption of every encrypted integration setting. Old schema pre-migration safety files remain inside scratch and are removed with it. No media/source or generated/cache file is copied or probed.

Success reports `valid`, source/checked schema versions, the validator build version, check time and SHA-256 fingerprint across named manifest/DB/key bytes. Before/after fingerprint comparison rejects bundles changed during verification. Print no keys or decrypted values. `--json` returns one result object (npm itself may print its script banner; compiled Node invocation is suitable for machine parsing). Failure reports safe `invalid` or `unsupported`; interruption reports `interrupted`. Exit 0 is valid, 1 invalid/unsupported and 130 interrupted. SIGINT/SIGTERM abort streaming fingerprint reads and clean scratch; synchronous SQLite validation/migration must return before JavaScript handles a signal. SIGKILL/host failure cannot run cleanup: remove only clearly owned stale `mytuner-verify-*` temporary directories after confirming no validator uses them.

The validator never installs a DB/key, creates a live rollback/journal, revokes a session, contacts integrations, scans media or starts encoding. It uses temporary space/time proportional to application database size. A successful result identifies the exact bundle at that check time; changing the bundle invalidates the result. The health dashboard still reports completed-bundle presence/age, not this full verification result. Verification does not certify host mounts, physical clients, backup destination durability or future recovery. Continue periodic offline restore rehearsals separately.

## Collection recovery and report retention

`MYTUNER_COLLECTION_RETENTION_DAYS` defaults to 7 and `MYTUNER_REPORT_RETENTION_DAYS` to 30, whole days 1–365. Compose passes both settings; configure them in the Unraid container environment if not using Compose. Production maintenance runs every thirty seconds; expiry is hidden immediately by reads, with bounded collection purge (200/pass). Collection changes apply to new recorded deletion expiries; report age policy applies to existing reports. Backup bundle retention remains operator-controlled and unrelated.

Browser My Network → Your library → Recently deleted lists only currently accessible owned/admin collections. Undo or Restore retains the exact original collection ID/name/member references, including unavailable files. Missing grants block recovery rather than silently dropping members. A restored reference can resolve in future schedule batches; restoring never explicitly publishes/rewinds a channel or changes existing/paused airings, subscriptions, grants or files. Expired and previously hard-deleted collections are unrecoverable through this feature; consider an appropriate application backup only as a full offline restore operation.

Viewer reports are explicit, bounded support metadata. Browser/TV choose a category, review and Send; cancel/preparation alone submits nothing. An uncertain response supports explicit idempotent Retry. A changed airing/pause/route or expired preparation requires a fresh review. Admin browser → Problem reports lists/acknowledges/deletes; the reporting account may inspect currently permitted own reports. Default retention is thirty days, max 1,000 rows, ten newly accepted reports/account/ten minutes. No automatic telemetry/uploader or offline queue is added. Reports, including references, are included in application DB backups; operator backup retention is a separate privacy/retention decision.

## Known recovery review limits

The approved phase-3 corrections now reject nonempty WAL-bearing backup input before verification/restore/recovery and validate the canonical target against source roots in the validated bundle and current application before target writes. The original [R8-01/R8-02 findings](IMPLEMENTATION_REVIEW.md#eighth-round-findings-and-disposition) remain as historical evidence. Use complete immutable application-generated bundles with the matching key; independently confirm the intended host mounts. Actual Unraid recovery remains a target-host gate in [pilot acceptance](PILOT_ACCEPTANCE.md).

Node may print its SQLite experimental warning on stderr. For machine parsing of compiled verification output, parse stdout; npm script banners are another reason to use the compiled entry point directly. A successful validation does not replace a recovery rehearsal on the intended host.

## Interpreting manual refresh diagnostics

Setup & server health distinguishes Not yet checked, In progress or interrupted, Failed, Overdue and Last check succeeded. A source can be readable even when its Sonarr/Radarr refresh failed. “Not scheduled · manual checks only” describes scheduling, not health. Review the last check, last successful check and sanitized error; the previous successful catalog remains available after a failed provider request. Retry Scan & refresh metadata in Sources, then refresh the overview after its short cache expires. Disabling automatic refresh preserves these diagnostics; a restart cannot turn a recorded failed attempt into success.

The current schema is 22; use a matching backup/image for rollback. Physical Windows Docker/Unraid/device follow-ups are collected in [differed](differed.md).

## Container stop, exit 137 and Unraid statistics

The application has no Docker-daemon client or socket mount and does not call host reboot, Docker restart or broad process-kill commands. It signals only its own tracked FFmpeg/ffprobe children. Keep its PID namespace private and do not grant privileged access or mount the Docker socket.

Docker exit 137 indicates SIGKILL; it does not by itself establish OOM. Check `OOMKilled` and host logs. The owner’s reported other-container uptimes remained hours/weeks, establishing that they did not restart at that checkpoint. The brief all-zero Unraid statistics display remains unexplained; it is not evidence of daemon restart.

The prior scanner could wait up to 30 seconds for an active ffprobe even after cancellation, exceeding Docker’s usual ten-second stop grace. Version 0.2.2 passes cancellation to ffprobe and stops refresh work in preClose. A real blocked-probe regression verifies prompt abort. Actual Unraid lifecycle timing still needs confirmation after deployment; no host stop/restart was executed from the implementation environment.

Read-only checks in the Unraid terminal (substitute your actual case-sensitive container name):

```bash
docker ps -a --format 'table {{.Names}}\t{{.Status}}'
docker inspect MyTuner --format 'Exit={{.State.ExitCode}} OOMKilled={{.State.OOMKilled}} Started={{.State.StartedAt}} Finished={{.State.FinishedAt}}'
docker stats --no-stream MyTuner
```

Keep the owner’s preferred Extra Parameters blank and Unraid Autostart off. A single-container Start/Stop is distinct from starting/stopping Unraid’s Docker service. Recreating the container must preserve the existing appdata mounts. Before an upgrade to schema 22, create a consistent application backup while the existing server runs.

## HDD efficiency investigation and proposed next work

The owner prioritizes low disk interference and responsive playback/UI over maximum background throughput. The table below records the research baseline. The owner subsequently selected performance/setup implementation; [the current performance plan](PERFORMANCE_PLAN.md) now records implemented changes and remaining limits. Original media remains read-only. SQLite remains suitable; moving to a separate database server is not an established requirement.

| Order | Area and observed cost                                                                                                                                                                                                                                       | Proposed improvement and acceptance                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Raw `/media` search loads available rows, checks access, projects metadata and filters before slicing. `/selection`, checkpoint choices, collection details and guide titles also retain per-item metadata reads (`server.ts`, `foundation-routes.ts`).      | Reuse batched projection and narrow SQL reads; page large detail/collection views and fetch only requested fields. Preserve whole-group scheduling membership, manual display overrides, filename matches and permission-filtered totals. Measure endpoint duration, response bytes and query count at 5k/50k/100k items.                                                                                                                                      |
| 2     | The optional-source predicate in `catalog()` produces `SCAN m` in SQLite even when a source is supplied. An explicit source/availability predicate uses `media_by_source`. Channel statistics currently produce `SCAN playback_events` and a temporary sort. | Build specific query variants and add only indexes supported by query-plan/timing evidence. Avoid blindly indexing every column; indexes add write cost and storage. Test grants, subtrees and private counts before measuring speed.                                                                                                                                                                                                                          |
| 3     | Unchanged scans skip ffprobe, but still read local metadata, check subtitles, update per-video JSON/title and commit subtitle diagnostics.                                                                                                                   | Separate quick inventory from explicit full metadata/caption refresh; compare relevant fingerprints and skip unchanged writes. Share bounded directory/NFO caches, reuse prepared statements and commit short bounded batches after filesystem work. An unchanged pass must still detect supported sidecar additions/changes and incomplete scans must retain prior availability. Never hold a write transaction across filesystem/network awaits.             |
| 4     | Current limits allow two simultaneous source refreshes. Encoder admission prioritizes interactive work and reserves a slot, but is not a physical-disk I/O governor and does not include every probe/directory walk.                                         | Introduce an HDD-oriented background budget, initially one scan/probe stream, with separate configurable generation limits, cancellation, scheduling windows and a pause-optional-work-during-playback choice. Account for overlapping shares that can map to the same disk; source IDs do not identify physical drives. Do not add unbounded parallel probes to shorten the scan timer. Validate playback and other-app latency under active scan/generation. |
| 5     | The new bounded aggregate cache invalidates after every SQLite write. Playback telemetry, sessions or unrelated diagnostics can discard otherwise useful catalog results.                                                                                    | Use explicit content/access revisions for selective invalidation, preserving immediate revocation/PIN checks and changed-metadata visibility. Test active playback while paging and all role/grant/metadata changes; a longer TTL alone is insufficient.                                                                                                                                                                                                       |
| 6     | Each configured source may independently request the same Sonarr/Radarr inventory, and automatic refresh currently couples source inventory with provider import.                                                                                            | Reuse a short-lived, connection/configuration-scoped inventory across applicable sources; split file inventory and provider refresh schedules, deduplicate requests and apply backoff. Invalidate on URL/provider/key changes and retain source-specific mappings/error status.                                                                                                                                                                                |
| 7     | Channel statistics load delivery events and authorize individual event media repeatedly. Active schedule/history growth remains open acceptance work.                                                                                                        | Batch permission/media lookup, add measured channel/account/time indexes, then consider interval-aware rollups and an explicit retention policy. Preserve overlapping-event deduplication, current-account scope and source revocation. Do not replace interval accounting with a naive SUM.                                                                                                                                                                   |
| 8     | Group search still visits authorized catalog rows; directory suggestions derive ancestors from paths each query.                                                                                                                                             | Consider a maintained folder/search index and FTS5/trigram search after the preceding changes. Installed SQLite reports FTS5 enabled, but migration/rebuild and existing substring/override semantics need design. Compare single-writer maintenance cost with search benefit. Authorization must precede exposed results/counts.                                                                                                                              |
| 9     | Managed generated/cache cleanup can enumerate/stat application-owned outputs; cache hits touch mtimes. SQLite and CPU aggregation execute synchronously in the server.                                                                                       | Measure cleanup frequency/accounting and event-loop delay, throttle optional bookkeeping if warranted and consider worker isolation for costly aggregation. Preserve quotas, reserve checks, active-output protection and current authorization when a worker result returns. Do not promise that asynchronous filesystem calls or a reserved encoder slot eliminate HDD contention.                                                                           |

Local evidence: `EXPLAIN QUERY PLAN` confirms the two full-scan cases above; the explicit source alternative uses the existing index. Catalog-only directory lookup returned fifty paths in 13ms for 5,000 synthetic files and 164ms for 50,000 (search: 12/150ms), without mounting or opening a media directory. These are in-memory SQLite/Mac measurements, not HDD/Unraid performance claims. Temporary evidence: `/private/tmp/mytuner-query-plan.log` and `/private/tmp/mytuner-directory-benchmark.log`.

Before setting performance targets, record Unraid CPU/RAM, library/source sizes, disk/share layout and current scan time. Compare idle versus active viewing versus scan versus generation; record p50/p95 API latency, event-loop delay, CPU/RSS, scan throughput and host disk latency/queue depth. Use cold and warm catalog cases. Container CPU/memory/I/O controls and host disk policy are deployment settings; any recommendation must account for Unraid/kernel/storage-driver support. Optional jobs should have bounded queues, visible progress and prompt cancellation. No source-file write or host tool installation is part of this investigation.

## Selector and prefill feasibility

The current patch adds database-backed folder pickers for grants and generation and extends custom channel parent-folder selection. The table below records the initial feasibility research. The owner subsequently selected cached setup controls; [the current performance plan](PERFORMANCE_PLAN.md) records the implemented choices and deliberate limits:

| Form                                      | Proposed choices/prefill                                                                                                               | Data source and cost boundary                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Add/Edit source                           | Choose mounted container directories such as `/tv`, `/anime_tv`, `/movies`, `/commercials`; optionally suggest a name/type for review. | Read the current Linux process’s `/proc/self/mountinfo` once, keep directory targets only, exclude system/application data/generated/cache roots and existing-source overlap. This lists mounts, not their contents. Handle escapes/nested mounts and unsupported/restricted platforms; retain manual entry or optional operator-provided hints. Mount names alone do not prove media type.            |
| Choose a nested source root               | Expand one directory level explicitly when needed.                                                                                     | Admin-only, bounded/cancellable browse below selected approved media mounts; cache listings and never recurse across the share on modal opening. Distinguish an empty result from inaccessible/unavailable storage.                                                                                                                                                                                    |
| Sonarr/Radarr path mappings               | Select provider root plus myTuner source root; display the resulting mapping and preview match counts.                                 | Prefer saved roots and values collected during normal metadata refresh. Existing provider APIs can supply root folders, but upstream implementations may enumerate unmapped directories and query disk space; root-folder refresh must be explicit, cached and bounded, not polled on each form open. Keep credentials server-side and do not fetch from a new destination using retained credentials. |
| Separate metadata/subtitle root           | Beside videos/default or a mounted read-only directory, then optional relative-path browse.                                            | Reuse the mount candidates and existing location validation. Do not confuse NFO roots, video-relative caption subdirectories and mirrored separate roots.                                                                                                                                                                                                                                              |
| Caption subdirectories/manual association | Conventional folder presets plus previously discovered paths/tracks.                                                                   | Cached subtitle provenance/associations, not a fresh recursive search for every keystroke. Unknown/manual paths remain available and are checked explicitly.                                                                                                                                                                                                                                           |
| Repeat settings and connections           | Suggested source labels, existing provider URLs, refresh presets and reusable selections.                                              | Current application settings and catalog data. Preserve explicit manual values and avoid selecting the first available owner/source when reopening a saved record. Password/PINs are never prefilled and saved API keys remain masked.                                                                                                                                                                 |

Direct Docker configuration inspection normally requires Docker-daemon access or an operator-exported configuration; the application currently has neither. A mounted Docker socket grants container-management capabilities and is unnecessary for a source picker, even if its filesystem mount is marked read-only. Reading the application’s own mount namespace can provide **container targets** without that access. Its mount-root/source fields are filesystem-specific and must not be treated as a reliable original Unraid host path or another container’s mapping. Full host-to-container display can instead use an explicitly provided, sanitized hints file/export if the owner later wants it. Never mount Docker’s internal configuration directory or the Unraid flash/system configuration to gain autocomplete.

Research references: [Docker bind-mount source/destination semantics](https://docs.docker.com/engine/storage/bind-mounts/), [Linux process mount information](https://man7.org/linux/man-pages/man5/proc_pid_mountinfo.5.html), [Docker-daemon access](https://docs.docker.com/engine/security/protect-access/), [Sonarr root-folder API implementation](https://github.com/Sonarr/Sonarr/blob/develop/src/Sonarr.Api.V3/RootFolders/RootFolderController.cs), [Sonarr root-folder service](https://github.com/Sonarr/Sonarr/blob/develop/src/NzbDrone.Core/RootFolders/RootFolderService.cs), [Radarr root-folder service](https://github.com/Radarr/Radarr/blob/develop/src/NzbDrone.Core/RootFolders/RootFolderService.cs). These upstream develop sources establish feasibility and possible I/O; validate behavior against the owner’s installed versions. No Docker runtime or household provider was accessed during this research.

## Current management saves and diagnostics — 0.3.0

Source identity editing, source configuration and source scanning are separate actions. Configure stages subtitles/metadata/provider mappings/scan schedule until **Save configuration**; it validates changed destinations without crawling videos or starting a scan. Disconnect is staged too. **Scan & refresh metadata** opens options/results, and **Start scan** performs the explicit job. Closing the progress dialog leaves the server job running. Inspect `complete` and scan errors separately from provider matches/unmatched records.

Profiles save identity/account access/library grants/PIN together. Newly entered PIN/password values require confirmation in the browser. Account saves without an actual change preserve credentials; explicit Revoke sessions remains separate. Subscription checklists on profile cards save selected eligible channels and order together. Stale settings return a conflict instead of overwriting another administrator’s changes; reopen/review rather than blindly retrying old data.

My Network’s tray stores temporary references, not files or a durable server draft. New-channel preview does not insert a channel; final creation and initial programming commit together. Permanent profile/channel deletion is blocked by retained references and does not clean history automatically. Read [My Network](MY_NETWORK.md) and [first channel](FIRST_CHANNEL.md) for the current walkthrough.

Use **Devices & sessions** to label/revoke an identifiable session. Older migrated sessions may show unknown created/last-used times. Labels are session metadata rather than proof of a particular physical device. Last-used writes are throttled; zero/temporary Docker statistics still do not prove a restart. Bundled **Setup & TV help** is accessible before sign-in and includes Docker-tab, TV, Windows and recovery instructions; referenced additional documents can open GitHub separately.

## Reset application data offline

Reset is a separate, administrator-confirmed database operation. It never deletes physical videos, subtitles, NFO files, generated assets, playback-cache files, unknown appdata files or existing backups. It does not wipe appdata or unlink the live database. The browser only reviews the plan; it cannot execute or queue a reset.

1. Sign in as the administrator whose account and existing password must survive. Open **Setup & Server Health → Reset application data → Review reset options**. Confirm the displayed username and immutable account ID. A fresh start retains this explicitly named administrator, not whichever account appears first in a list.
2. Choose **Selective reset** and the desired checkboxes, or **Fresh start**. Read automatically included dependent categories and exact record counts. Every reset ends browser/device sessions, profile unlocks, pending pairing codes and current playback. Removing source records removes references only.
3. Stop only the **MyTuner** server/container completely. Do not stop Unraid's Docker service. Keep it stopped through preview and execution. Live execution is refused: the offline tool requires exclusive ownership so a scan, player or delayed request cannot repopulate cleared records.
4. Run the offline preview against the same image/version and configured data directory. Enter the named administrator's password at the private prompt. The tool validates the recognized current schema and storage paths, then prints the stopped database's full revision, exact counts and apply command. Browser counts are advisory; use the **offline** revision for execution.
5. Review the offline plan, run its apply command, re-enter the administrator password and type the exact displayed confirmation. The tool creates and verifies a new append-only recovery bundle before one transactional database reset. There is no skip-backup, skip-password or force-delete option. A success result includes `reset: true`, the retained account and verified backup location. Preserve the receipt and backup.
6. Restart MyTuner, sign in with the retained administrator's existing credentials and repeat setup for cleared categories. Fresh start removes profiles, so recreate them, source grants, collections, channels and subscriptions as needed. Other preserved accounts can sign in again after a selective reset; TVs need pairing/unlocking again.

In a local checkout, use the displayed `node dist/reset-cli.js ...` command after building, or `npm run db:reset -- ...` with the installed development dependencies. The production image uses compiled Node code and does not need `tsx`.

For the owner's Unraid Docker-tab installation, the stopped container is named **MyTuner** and its database host directory is **/mnt/user/appdata/mytuner/data**. A temporary network-isolated helper can run the same image with only that database directory mounted. It does not need media, generated-output or cache mounts. First obtain the retained administrator's actual UUID from the browser review. The following example previews activity reset; replace the quoted UUID placeholder with that exact value:

```sh
mytuner_reset_image=$(docker inspect MyTuner --format '{{.Image}}')
docker run --rm -it --pull=never --network none \
  --mount type=bind,src=/mnt/user/appdata/mytuner/data,dst=/app/data \
  --env MYTUNER_DATA_DIR=/app/data \
  --entrypoint node "$mytuner_reset_image" dist/reset-cli.js \
  --admin-id "RETAINED_ADMIN_UUID" --mode selective --categories activity
```

For execution, repeat the same helper invocation with the **exact scope from the offline preview**, adding `--apply --revision "OFFLINE_REVISION_FROM_PREVIEW"`. For fresh start use `--mode fresh` and omit `--categories`. Do not put passwords in arguments, shell history, screenshots, Git or logs. Keep the terminal interactive for private password and exact confirmation prompts. The helper container's `--rm` removes that temporary container; it does not remove the mounted database or backups. Match your actual host mapping if it differs from the path above. This container command still needs the existing Windows/Unraid or hosted Docker acceptance; local Node tests do not establish engine behavior.

The offline tool normalizes the recognized application database and empty owner-lock database to rollback journal mode before asynchronous work. This can update SQLite control/header bytes during offline preview or a refused authentication attempt; application rows and credentials remain unchanged until confirmed execution. It avoids retaining a WAL handle that could unlink a later foreign replacement on close. Browser review remains database-read-only.

Reset requires a clean shutdown and the current recognized schema. Unknown schema extensions, linked/aliased control files, pre-existing SQLite WAL/SHM/journal files, pending restore or an active runtime lock are refused. Do not manually remove suspected sidecars to bypass the check: restart normally and stop cleanly, or finish backup/recovery first. If a backup fails, the database reset is not applied; an incomplete new bundle is retained for diagnosis. No completion manifest means no completed reset backup. A changed revision requires another explicit review; no reset command is persisted for automatic replay.

Historical media/metadata/subtitle roots remain protected after their source records are cleared. Reset also persistently disables physical output expiry/quota/orphan cleanup, including after restart, so lost catalog ownership is never interpreted as permission to remove old outputs. Existing files still count toward output limits; new work can return storage-limit errors instead of reclaiming them. New files may be created within the normal bounded configured output roots, and only an inode-verified temporary file created by the same current operation may be removed on its own failure. Reset does not provide an automatic cleanup re-enable switch. Plan storage recovery separately, using known ownership and a verified backup; do not delete whole output directories by assumption.

Restoring an earlier backup must retain the union of known historical root protections and the stricter cleanup policy. If a damaged live database makes its historical protections unreadable, recovery must not silently guess them: output writes and cleanup remain blocked pending recovery of a known valid safety state. Direct read-only playback and database recovery have a separate boundary from output generation.

Implementation and independent destructive-test evidence are tracked in [reset safety](RESET_SAFETY_REVIEW.md). Never run the development fixture tests on household appdata/media.
