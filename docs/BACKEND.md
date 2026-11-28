# Backend foundation and API contracts

For component/data flow, read [architecture](ARCHITECTURE.md). Detailed [discovery](MEDIA_DISCOVERY.md), [database](DATABASE.md), [playback](SCHEDULING_AND_PLAYBACK.md), [security](SECURITY.md) and [operations](OPERATIONS.md) guides complement this route reference. Browse all guides in the [documentation index](README.md).

## Current scope

The Node 24 service implements accounts, browser sessions, TV pairing/PINs, source grants, read-only scanning/metadata import, dynamic library selectors, collections, recurring channel programming, commercials, subscription guides, independent playback clocks, direct files, on-demand HLS, text subtitles, generation jobs, and backup/restore/verification, retained recent-airing lookup, deleted-collection recovery and explicit problem reports. Version 0.3.0 also serves the implemented React manager/player at `/`; the Kotlin/Media3 TV client uses these APIs. See [CLIENTS.md](CLIENTS.md).

Real FFmpeg fixtures validate server outputs. Household readiness still requires representative browser/Media3 playback acceptance, visual/accessibility testing, actual upstream services, Docker/Unraid and physical TV validation. Source media never moves or changes.

## Local setup and settings

Use Node 24.13+ within major 24 and install FFmpeg/ffprobe. Run `npm ci`, `npm run typecheck`, `npm test`, and `npm run build`. Supply `MYTUNER_ADMIN_PASSWORD` through your environment and run `npm run admin:create -- your-admin-name`. No default password or public registration exists. Start with `npm run dev` or `npm start` after building.

| Setting                           | Default         | Purpose                                                                       |
| --------------------------------- | --------------- | ----------------------------------------------------------------------------- |
| HOST                              | 127.0.0.1       | Bind address; Docker uses 0.0.0.0                                             |
| PORT                              | 8777            | API port                                                                      |
| MYTUNER_DATA_DIR                  | .data           | SQLite, private integration key, backups and process lock                     |
| MYTUNER_GENERATED_DIR             | .data/generated | Optional reusable outputs                                                     |
| MYTUNER_CACHE_DIR                 | .data/cache     | Disposable HLS, artwork and subtitle outputs                                  |
| MYTUNER_SECURE_COOKIE             | false           | Enable Secure cookies when serving through HTTPS                              |
| MYTUNER_PUBLIC_ORIGIN             | request origin  | Explicit public HTTPS origin for a reverse proxy                              |
| MYTUNER_COLLECTION_RETENTION_DAYS | 7               | New collection deletions: metadata recovery grace period, whole days 1–365    |
| MYTUNER_REPORT_RETENTION_DAYS     | 30              | Report age retention, whole days 1–365                                        |
| MYTUNER_ENCODER_CONCURRENCY       | 3               | Shared FFmpeg budget, integer 2–8; one slot reserved from optional generation |

Generated/cache defaults are independent of MYTUNER_DATA_DIR: changing only the data setting does not move `.data/generated` or `.data/cache`. Set all three explicitly for deployment. Generated/cache roots must not overlap each other or any source. Data may contain the default generated/cache subdirectories, but no application storage may overlap media roots. Startup canonicalizes paths, including existing cache subdirectories. SQLite must live on local app storage, not a network share. The data lock prevents concurrent server/bootstrap/restore owners.

## Authentication and TV startup

Browser: `POST /api/auth/browser` accepts `{username,password}`, sets an HttpOnly SameSite=Strict cookie, and returns `{account,csrfToken}`. Send `X-CSRF-Token` on cookie-authenticated mutations. Origins must match the request origin. `GET /api/auth/csrf` retrieves a replacement token after reload; refreshing it invalidates the prior CSRF token. No localStorage bearer-token flow is required. LAN HTTP is supported; use a trusted HTTPS endpoint and `MYTUNER_SECURE_COOKIE=true` when configured. Set MYTUNER_PUBLIC_ORIGIN to the exact public origin when the HTTPS proxy forwards to this HTTP server. Forwarded headers are not implicitly trusted.

Scripts: `POST /api/auth/login` returns an opaque bearer token. Send `Authorization: Bearer <token>`. Passwords/PINs use salted scrypt; only token hashes persist. Account sessions expire after 12 hours; failed login attempts are limited. Logout/revocation invalidates tokens and profile unlocks.

TV first setup: enter server address, request a pairing code, and approve it from the authenticated browser. Pairing codes expire after five minutes, are single-use, and are rate limited. The resulting device token expires after 30 days and permits viewing only, even when paired by an administrator. Store it in the platform's protected application storage. Device renewal/re-pair UX remains a client task.

Every fresh TV app launch calls `POST /api/playback/startup`, then displays available profiles. Selecting a profile calls `POST /api/playback/profiles/:profileId/select`, clearing this device's prior unlock/playback state. Enter its numeric PIN, then fetch its subscription-only guide and join a channel live. Pairing persists; passwords are not typed with the remote. Configure a PIN for TV profiles during admin setup; four digits are the recommended easy-input default, and the API accepts 4–8 digits. Unprotected profiles remain an explicit setup choice. Profile switches repeat PIN entry. Other devices remain unaffected.

PINs are additional viewing locks, not account authorization. Unlocks belong to one authentication session, last at most 12 hours, and cannot bypass profile membership. Paired administrator viewing also respects PINs; authenticated admin management and the schedule worker use management/source authorization independently, so an expired viewing PIN cannot stop a published channel.

## Identity and access routes

| Routes                                                  | Purpose                                                         |
| ------------------------------------------------------- | --------------------------------------------------------------- |
| GET /api/health                                         | Public DB/process health                                        |
| POST /api/auth/browser, /api/auth/login                 | Cookie or bearer login                                          |
| GET /api/auth/me, /api/auth/csrf                        | Current account; browser CSRF refresh                           |
| POST /api/auth/logout                                   | Revoke current authentication session                           |
| POST /api/auth/pairings                                 | `{deviceName}` -> deviceCode/userCode/expiry/poll interval      |
| POST /api/auth/pairings/approve                         | Authenticated browser approves `{userCode}`                     |
| POST /api/auth/pairings/poll                            | `{deviceCode}` -> pending or one-time device token              |
| GET /api/auth/sessions                                  | Current account's sessions and revocation IDs                   |
| DELETE /api/auth/sessions/:sessionId                    | Revoke one current-account authentication session               |
| GET/POST /api/accounts                                  | Admin list/create accounts                                      |
| PATCH /api/accounts/:accountId                          | Admin changes role/disabled; revokes sessions                   |
| PUT /api/accounts/:accountId/password                   | Admin password reset; revokes sessions                          |
| DELETE /api/accounts/:accountId/sessions                | Admin revokes an account's sessions                             |
| GET/POST /api/profiles                                  | List permitted profiles with lock state; admin creates profiles |
| PATCH /api/profiles/:profileId                          | Admin renames/reassigns owner                                   |
| GET /api/profiles/:profileId/settings                   | Admin membership and source grants                              |
| PUT/DELETE /api/profiles/:profileId/accounts/:accountId | Admin assigns/removes membership and canManage                  |
| POST/DELETE /api/profiles/:profileId/grants             | Admin adds/removes `{sourceId,subtree}`                         |
| PUT /api/profiles/:profileId/pin                        | Manager sets `{pin}` or null; clears unlocks                    |
| POST /api/profiles/:profileId/unlock, /lock             | Unlock with `{pin}`, or lock this session                       |

The last enabled administrator cannot be disabled/demoted. Viewing requests validate current account/profile/source grants. Original and derivative streams are checked after mutations and every second; revoked open sockets close. HLS/subtitle work checks access during processing and before delivery. Account disabling/password reset also removes tokens. Unsubscribing closes that profile/channel's playback sessions; independent catalog permissions remain governed by source grants.

## Library and integrations

| Routes                                                        | Purpose                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| GET/POST /api/sources                                         | Admin lists/registers `{name,root,kind,recursive}`                       |
| GET/PATCH /api/sources/:sourceId                              | Admin reads a coherent source/revision snapshot or saves guarded details |
| GET /api/sources/:sourceId/scan-status                        | Admin scan status, last attempt and per-source admission state           |
| GET /api/profiles/:profileId/source-inspections               | Batched, authorized stored source freshness; no filesystem check         |
| POST /api/sources/:sourceId/scan                              | Read-only scan, plus saved integration refresh if configured             |
| POST /api/sources/:sourceId/import                            | One-shot metadata import with supplied credentials                       |
| PUT/DELETE /api/sources/:sourceId/integration                 | Save/remove provider connection                                          |
| PUT /api/sources/:sourceId/refresh                            | `{intervalMs}` from 60,000 to seven days; null disables                  |
| GET /api/admin/refresh                                        | Schedules, last successful imports, sanitized errors                     |
| GET /api/profiles/:profileId/media                            | Authorized searchable/paged available catalog; page/limit/search         |
| GET /api/profiles/:profileId/library                          | Shows/seasons, movies, folders, Radarr collections; optional search      |
| POST /api/profiles/:profileId/selection                       | Resolve a dynamic selection to authorized available media                |
| GET/POST /api/profiles/:profileId/collections                 | List/create saved reference collections                                  |
| PUT/DELETE /api/profiles/:profileId/collections/:collectionId | Update/delete owned collection                                           |
| GET /api/profiles/:profileId/media/:mediaId/artwork/:index    | Authorized integration artwork proxy                                     |

Kinds: shows, movies, videos, commercials. Scanning reads actual durations and video/audio/subtitle track details with bounded ffprobe calls, skips symlinks, and verifies size/mtime before committing. Files retain identity by source/path; replacements invalidate scheduled/generated fingerprints. Incomplete/offline scans preserve previous availability; complete scans mark absent files unavailable. Optional bounded NFO files and common episode filenames supply metadata without any remote match. XML external entities/DOCTYPE are rejected.

Integration shape: `{provider:"sonarr"|"radarr",url,apiKey,mappings:[{from,to}]}`. Only GET requests are sent upstream; redirects are rejected. Longest matching directory-boundary mapping wins, including Windows paths. Sonarr multi-episode files remain one item. Undownloaded entries are excluded from playable selections. Radarr collection labels support whole-collection selection. Imported associations include source identity, so duplicate upstream IDs in independent sources do not collide.

Persistent keys use AES-256-GCM; a private 32-byte integration.key stays in app data and application backups. A missing key for existing connections stops startup rather than silently replacing it. Refreshes are deduplicated per source, limited to two concurrent source jobs, and retried after failure while retaining prior imported metadata. The main server checks due jobs every 30 seconds. Artwork URLs/keys remain server-side: the proxy accepts only configured-host MediaCover paths, limits MIME/size/time, rejects redirects, and reauthorizes delivery.

Library `search` is trimmed, limited to 200 characters and matched case-insensitively against authorized titles, relative file paths, series/collection titles and source names. Parent group results retain full authorized membership/counts. Legacy aggregate callers retrieve saved user collections separately; the paged browser response includes page-scoped saved collections. Superseded saved-integration refresh results cannot overwrite newly configured metadata or health; a scan requested for new settings waits and then performs fresh work.

Selections:

```json
{
  "type": "show",
  "sourceId": "<uuid>",
  "key": "series:7",
  "season": 1,
  "includeSpecials": false
}
```

Other types: `media` with ids; `folder` with sourceId/directory/recursive; `movieCollection` with sourceId/key; and `collection` with id. Use keys returned by library browsing. Whole selections remain dynamic when later files appear; personal collections are fixed references. Specials are opt-in.

### Collection creation, retry and review

`POST /api/profiles/:profileId/collections` requires `{creationId,name,mediaIds}`: a client-generated UUID, a trimmed name of 1–120 characters and 1–5,000 media UUIDs. Generate `creationId` once when opening a new draft and retain it across connection failures and retries. A successful request returns HTTP 201 with `{id,name}`, where `id` equals `creationId`.

A retry with an existing live ID returns that collection only when the creator account, current profile-management/media authority, normalized name and distinct media-ID set still match. Reordering or repeating the same media IDs does not create another collection or rewrite its membership. A different payload or retained deleted ID returns 409; another account's ID or lost media authority returns a neutral 404. POST never becomes an edit of an existing ID. Edit through `PUT /api/profiles/:profileId/collections/:collectionId`; `expectedRevision` from the compact `/membership` response guards a conflicting edit.

Retry protection lasts while the live collection or its deletion tombstone remains stored. Permanent retention cleanup removes the tombstone, so this is not an indefinite request-receipt history. After an uncertain save, keep its creation ID; open/review the saved collection or deliberately start a new draft rather than changing that ID to retry the same intent.

Collection summaries and the collection list expose `count` (available videos), `totalCount` (all retained references) and `unavailableCount`. Missing videos remain members until explicitly removed. `GET .../collections/:collectionId/dependencies?offset=0&limit=25` provides authorized channel usage, with a maximum page of 100 and `recurring`, `materialized` and `retained` flags. Its `editExplanation` explains that edits affect future generated programming; already generated airings and paused viewing retain their saved videos. Materialized matches indicate overlapping videos, not proof of the original selector. Other owners' private channel names and counts remain hidden from ordinary editors.

## Channels, guide and recurring programming

| Routes                                                       | Purpose                                                                 |
| ------------------------------------------------------------ | ----------------------------------------------------------------------- |
| POST /api/channels                                           | Create shared/admin or owner-private channel                            |
| GET /api/admin/channels                                      | Explicit admin cross-owner view                                         |
| GET /api/profiles/:profileId/channels                        | Visible/source-authorized subscription candidates                       |
| PUT/DELETE /api/profiles/:profileId/subscriptions/:channelId | Subscribe/unsubscribe without deleting channel                          |
| GET /api/profiles/:profileId/guide                           | Subscription-only guide; startMs/endMs, at most seven days              |
| POST /api/channels/:channelId/programming/preview            | Non-mutating preview                                                    |
| GET/PUT /api/channels/:channelId/programming                 | Read/save recurring configuration                                       |
| GET /api/profiles/:profileId/channels/:channelId/live        | Current interval/source offset; optional atMs harness parameter         |
| GET /api/profiles/:profileId/channels/:channelId/statistics  | Total/started scheduled assignments and own-account delivered intervals |
| POST /api/channels/:channelId/schedule                       | Legacy foundation explicit-ID one-time publish; prefer programming      |

Private channels are absent from other accounts' candidates, guides, programming, statistics and playback. The owner/admin exception is account-based even for shared room profiles. Subscriptions never bypass source grants or privacy.

Recurring configuration:

```json
{
  "profileId": "<uuid>",
  "groups": [
    {
      "id": "show-a",
      "mode": "ordered",
      "selection": {
        "type": "show",
        "sourceId": "<uuid>",
        "key": "series:7",
        "includeSpecials": false
      }
    }
  ],
  "rules": {
    "between": false,
    "positions": [],
    "maxClips": 0,
    "maxDurationMs": 0,
    "repeatAllowance": 1,
    "maxPerBreak": 1,
    "cooldownMs": 0
  },
  "seed": 42
}
```

Optional commercialSelection uses the same selectors, restricted to commercial sources. Between-program and mid-roll positions support timestamp milliseconds, percentages, or bounded random positions. Count/duration caps, within-break repeats, rotation allowances (1/2/3+), and cooldowns are enforced. Optional `rules.overflowPolicy` accepts `skip` (also the legacy omitted behavior) or `truncate`. In `truncate` mode, start another eligible clip only when remaining break time is strictly greater than `rules.minRemainingMs` (default 6000, integer range 0–3600000); schedule the lesser of its full duration and the remainder. At or below the threshold, exhausted limits or no eligible clip, return to the show with no padding. A partial clip counts as one appearance; catalog/source durations stay unchanged. New-channel browser controls select `truncate` and 6000, without enabling commercials until a pool is chosen. See [the scheduling reference](SCHEDULING_AND_PLAYBACK.md#cutoff-mode-and-minimum-remaining-time) for examples and persistence semantics.

Groups alternate; each advances independently using ordered/shuffle/random mode. Ordered cursors survive earlier insertions and removal of the prior item. Exact intervals, random state and program-end checkpoints persist. Intervals are UTC integer milliseconds, start-inclusive/end-exclusive; complete the last program/break even beyond the requested end.

Edits activate after the current program plus its breaks. Live sessions adopt the effective revision; paused/behind-live sessions retain their old revision until Go Live or a new join. Schedule extension uses bounded committed batches without resetting the timeline. Defaults target 48 hours; unusually dense/short content can return a shorter initial materialized window, shown by returned entries. Maintenance and guide/playback requests extend it. Extremely long catch-up can return 503 after 100 batches, retaining progress for the next attempt. Empty programming reports an explicit error; previously scheduled intervals retain their timing. When all content groups are empty, the 409 message starts with `No available programming`, identifies the first empty group number and its submitted relative folder path when applicable, and suggests a source scan or explicit replacement selection after a move/rename. It does not look up hidden source or collection names for the error. An empty group is still skipped when another group can play.

## Playback delivery and client obligations

| Routes                                                | Purpose                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| POST /api/playback/startup                            | Fresh app launch: clear this device's unlock/old playback state                |
| POST /api/playback/profiles/:profileId/select         | Validate membership and clear prior selection state                            |
| POST /api/playback/sessions                           | `{profileId,channelId}` joins live                                             |
| GET/DELETE /api/playback/sessions/:sessionId          | Describe/leave token-bound device session                                      |
| POST .../:sessionId/pause, /resume, /goLive           | Local clock control                                                            |
| POST .../:sessionId/negotiate                         | `{containers,videoCodecs,audioCodecs}` -> direct or HLS descriptor/tracks      |
| GET .../:sessionId/hls/index.m3u8                     | Authenticated rolling HLS playlist                                             |
| GET .../:sessionId/hls/:entryId/:start.ts             | Authorized four-second-or-shorter segment; optional audioTrack index           |
| POST .../:sessionId/events                            | `{id,entryId,startMs,endMs}` idempotent delivered interval, at most 60 seconds |
| GET .../:sessionId/history                            | Own session's unioned delivered duration                                       |
| GET/HEAD /api/profiles/:profileId/media/:mediaId/file | Original file with ranges/HEAD and current fingerprint validation              |
| GET/HEAD .../:mediaId/assets/:kind                    | Current thumbnail/gif/conversion                                               |
| GET .../:mediaId/subtitles/:index.vtt                 | Authorized text subtitle extraction/cache in original source time              |

Pause changes one session's clock. Resume stays behind live. Go Live resolves current active programming. Switch/reopen creates a fresh live join. Sessions are isolated by authentication token as well as account. A heartbeat is a descriptor/manifest/control request; sessions idle for 24 hours expire during maintenance. Unreferenced superseded revisions older than seven days are collected; paused active references survive until session expiry.

Direct delivery reports sourceOffsetMs and intervalEndMs; clients seek/switch at those boundaries. Shortened commercial entries always negotiate HLS, even for a direct-capable client, to bound the delivered source prefix on the server. HLS creates normalized 1280x720 H.264/AAC MPEG-TS segments only when requested. Playlists contain authenticated relative URLs with no URL tokens. Discontinuities separate independently encoded segments and commercial transitions. Identical authorized segment work can share one job/cache entry. Limits: two HLS jobs, 60 seconds per conversion, under 8 MiB per segment, ten-minute/512 MiB HLS cache. Disconnected/revoked consumers cancel unused work; shutdown aborts and awaits workers. Idle channels do not encode.

Text subtitle extraction accepts supported text codecs, preserves source timestamps, and is limited to one job, 60 seconds, 10 MiB per output and 64 MiB cache. Artwork has its own 64 MiB budget. Embedded/external supported text tracks and alternate embedded audio are implemented; client source-time mapping is exercised by synthetic playback tests. Image subtitles/burn-in, hardware acceleration, adaptive bitrate and representative-file/device/soak acceptance remain open. HLS and direct video still require browser/Media3 transition/buffering tests; server outputs alone do not prove seamless television playback.

Clients must stop fetching after pause buffers fill, use source/interval timing, reload HLS after Go Live/revision changes, handle 429/503 with bounded retries, recover from unavailable intervals, and map text tracks to the relevant program segment. Both clients implement these flows; representative codec/transition/long-duration acceptance remains open. Delivered events are self-reported transport telemetry, never proof someone watched. Overlapping/retried events do not inflate delivered milliseconds, and scheduled assignments remain separate.

## Generation and cleanup

`POST /api/generation/preview` and `/api/generation/jobs` take `{sourceId,directory,recursive,kinds,regenerate}`. Scope is independently shallow/recursive. Kinds: thumbnail, gif, conversion. Preview creates no work. Jobs contain at most 5000 files and execute one item at a time; no bulk generation occurs when registering sources.

Use `GET /api/generation/jobs/:jobId`, `POST .../:jobId/cancel`, `GET /api/admin/generation`, and `POST /api/admin/generation/:jobId/retry`. Retry requeues failed/cancelled items and keeps completed results. It returns 409 while the cancelled job still owns an active worker; retry after settlement. A completed job requires every item to have completed. Queue limit: 25 pending jobs. Defaults bound output to 50 GiB total, reserve 512 MiB free space, and cap each output at 5 GiB and each process at one hour. Low space/quota produces a per-item error, never a partial published asset.

Job detail and admin generation-list rows also return `admission: "waiting" | "active" | null` and `waitingReason: "playback" | "queue" | "playback-capacity" | null`. These describe this job's current task, independently of its persisted job status or completed-output count. `playback` means optional work is waiting because of playback policy, `queue` means it is waiting its turn, and `playback-capacity` means it is waiting for an encoder slot. Idle/finished work has null admission/reason. `GET /api/sources/:sourceId/scan-status` returns the same per-source fields; scans use `playback` or `queue`, not encoder capacity. A running task may finish or reach its next checkpoint before pausing; the global background pause flag alone does not establish an individual task's state.

Fixed versioned presets generate 320px JPEGs, three-second/8fps/320px GIFs, or at-most-1280px-wide H.264/AAC MP4. Fingerprints include source identity/size/mtime and preset; atomic rename publishes completed outputs, cancellation removes partial files, and restart requeues interrupted tasks. Outputs share source permissions. `POST /api/admin/assets/cleanup` with `{dryRun:true}` previews stale-fingerprint/unavailable-media assets; false removes those managed outputs and references only. Source files are never deleted.

## Contracts and recovery

JSON uses camelCase; metadata is an object, not an encoded JSON string. `GET /api/contracts` returns versioned JSON Schemas for selections, programming, rules and core account/profile/media/channel/schedule/playback responses. IDs are UUIDs, apart from opaque authentication-session revocation IDs. Requests use catalog IDs instead of arbitrary playback paths. Errors contain safe messages; hidden/unauthorized private resources return 404.

`npm run db:backup` creates a private snapshot directory containing a consistent SQLite backup, integration.key when present, and manifest.json. It verifies integrity/foreign keys. Run `npm run db:restore -- /path/to/snapshot-directory` with the server stopped. Restore acquires the data lock, rejects corrupt/future schemas, takes a validated pre-restore application snapshot when the target is healthy, stages migrations, validates encrypted credentials, revokes authentication/pairing/playback sessions, and replaces app data. If current DB/key damage prevents a validated rollback snapshot, preserve damaged application bytes privately and install only the independently validated input; genuine I/O/permission/future-schema failures still reject. It does not copy/delete/edit source or generated media.

A pending restore journal blocks server startup after interruption; `npm run db:restore -- --recover` reinstalls a validated prior recovery snapshot when one exists; for fresh/damaged targets without one, it retries the validated input recorded in the journal. Preserve that input and the journal until recovery succeeds. Existing databases receive a separate consistent pre-migration DB snapshot before schema changes. Preserve the integration key with those DB snapshots. Image rollback does not reverse schema migrations. After restore, rescan sources and regenerate missing derivatives explicitly; fingerprints prevent serving replaced originals or stale outputs. In production images use compiled dist/backup-cli.js and dist/restore-cli.js, since development tsx is absent.

## Channel lifecycle and compiled smoke

Owners/admins can `PATCH /api/channels/:channelId` with name, visibility, or archived. Publishing shared visibility is admin-only. `DELETE /api/channels/:channelId` archives it, closes playback and removes subscriptions while retaining its ID/config/schedules. Restore with `{archived:false}` and resubscribe explicitly. Archived channels are absent from viewing and automatic schedule maintenance; the admin management list includes their archive state.

`npm run test:smoke` builds and runs the compiled bootstrap/server/backup/restore CLIs in disposable app directories. It checks authentication, single-owner locking, online backup, restore-driven session revocation, restart persistence, and graceful shutdown. It does not use source media or start a TV UI.

Scheduled statistics distinguish assignments already started from future materialized entries. Counts/history are permission-filtered, including retained past revisions after a source grant changes.

## Version 0.2.0 client integration additions

`GET /api/profiles/:profileId/media/:mediaId` returns authorized metadata without source fingerprints; it is available to scoped viewing devices. `GET /api/sources/:sourceId/integration` is admin-only and returns provider, URL and saved mappings, never the API key. HLS manifest `audioTrack` selection propagates only to intervals containing that audio stream.

Channel create/PATCH accepts nullable `shortName` (1–12 characters). Null derives a label from the full name. Public channel objects include computed `shortName` and nullable `shortNameOverride`; names remain labels over stable UUIDs. Subscription-configuration `items` and `order` retain the same explicit override rather than deriving a different label. The browser is served from `web-dist` at `/`; unknown API URLs remain API 404s.

## Selected improvement contracts

See [SELECTED_IMPROVEMENTS.md](SELECTED_IMPROVEMENTS.md#supporting-routes) for the complete supporting route matrix and user-facing delivery status. New interfaces remain separate from the implemented service contracts.

- Recurring groups accept optional `episodesPerTurn: 1 | 2 | 3`, omitted = one. Programming preview/publication accept optional one-time `checkpointActions`: `{groupId, action:"restart"}` or `{groupId, action:"startAt", mediaId}`. Only ordered groups are eligible; the start item must currently belong to the authorized selection. One command per group is accepted. Recurring config GET excludes those commands, so future edits/extension do not replay them. Preview and publication use the same current-program-plus-break boundary.
- New-channel draft preview and existing-channel programming preview return optional `sourceId` and `relativePath` on each entry whose media remains authorized. These distinguish duplicate display titles using the existing batched catalog read; no per-entry request or filesystem lookup is added. Redacted/ungranted entries include no source/path context, and absolute source roots are not returned.
- Preview adds `diagnostics[]`: `startMs`, `endMs`, `requestedDurationMs`, `poolSize`, `clips`, `shortenedClips` and `reason`. Reasons are `filled`, `minimum-remaining`, `clip-limit`, `no-commercials`, `duration-fit` or `variation-limits`. These describe scheduling, consume no extra random state and do not imply viewer attention. `entries` remain the actual authoritative planned durations.
- `PUT /api/profiles/:profileId/lineup` takes `{channelIds:[…]}`. Require management permission and the exact current permitted visible subscription set, with no duplicates. Stale/incomplete sets return 409; duplicates return 400. It does not subscribe, create channels or grant access. Guides use saved order; newly subscribed channels append.
- `GET /api/channels/:channelId/draft-copy?profileId=…` requires owned/admin-readable source programming and management of the target profile. It revalidates selectors, returns `{suggestedName,visibility:"private",config}`, and writes nothing. The browser copy flow requires a new name and fresh preview/publication; no cursor/history/subscription is copied.
- `GET /api/profiles/:profileId/collections/:collectionId` requires profile management and collection ownership/admin exception. It includes unavailable authorized references for editing, with `id`, `title`, `sourceId`, `available`. PUT retains the same ID and explicitly retained unavailable references. Changed grants make the collection unavailable instead of leaking hidden members.
- `GET /api/profiles/:profileId/library/options` accepts `search` ≤200 chars, `offset` 0–1,000,000, `limit` 1–100 (default 50), optional `sourceId` and `showKey`. Return `{items,total,offset,limit,sources}`. Each option has title/source/type and a stable `selection`; show-key detail adds seasons. Authorization precedes group/count construction. Aggregation still visits the authorized catalog; this bounds the response, not all server memory/work.
- Generation preview adds `totalOutputs`, `reusableOutputs`, `newOutputs`, `totalDurationMs`, `availableBytes`, `fingerprintBasis:"catalog"`, `estimatedBytes:null`, `estimatedDurationMs:null`. Reuse checks the current preset fingerprint and managed output location, with no encoders. Source fingerprint validation remains mandatory when work runs. Job item responses add title and relative path and remain admin-only.
- Playback descriptors add nullable `context`: current title/show/season/episode, `kind`, `entryDurationMs`, `remainingMs`, owning `program`, `airing` (start/end/content-duration/content-elapsed) and nullable next title/start. During a commercial, `program` identifies its owning episode while the current title describes the clip. Timing uses the session position, so local pause freezes countdowns. Lookups use the retained revision and recheck profile media permission. This adds no seek/start-over action.
- Pairing start adds `approvalPath`, a relative `/#connect-tv?code=…` containing only the public ten-character code. Browser prefill validates route/code; sign-in and explicit POST approval remain required. Device tokens/private pairing codes do not enter links. The native pairing screen renders QR assistance for that approval path; scanning it still requires signed-in device review and explicit approval.
- Health adds `apiVersion:1` and application version. The native client rejects unsupported API versions before replacing its connection settings. Existing servers without that additive field are treated as version 1.

Admin-only operations:

| Route                                                  | Response / limits                                                                                                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/admin/setup`                                 | Counts profiles, sources, available media, grants, published channels, subscriptions and paired devices; integrations remain optional                                                                        |
| `POST /api/admin/sources/:sourceId/mapping-check`      | `{paths:[…]}` ≤20, each ≤4096 chars; configured mapping to catalog only, no source writes or upstream call                                                                                                   |
| `GET /api/admin/profiles/:profileId/access/:accountId` | Evaluates target enabled role/membership/manage rights, PIN/device state, grants and visible subscription media readiness; never inherits inspecting-admin rights                                            |
| `GET /api/admin/status`                                | Database/mount/refresh/import/job/schedule/storage/full-backup status; 15-second cache; filesystem deadlines 2 seconds; up to 32 mounts, 1,000 schedules and 200 manifests; truncated/unknown flags retained |
| `GET /api/admin/sources/:sourceId/imports`             | Last 20 successful provider-read reports; an incomplete scan is flagged separately                                                                                                                           |
| `GET /api/admin/imports/:runId`                        | Counts and detail pagination, default 50 / max100 rows; absent/reassociated entries are review candidates; removals remain false                                                                             |

Status never reads integration key contents, returns credential bundles or restores application data. Backup visibility means bundle files and a completed manifest exist, not a newly executed integrity/decryption audit. Keep off-host retention and any periodic trigger an explicit operator decision. Source/network filesystem checks may finish after the API deadline at OS level; the response is bounded and cached.

## Selected sixth-round APIs and contracts

See [SELECTED_IMPROVEMENTS.md](SELECTED_IMPROVEMENTS.md#read-only-inspection-apis) for the dependency, readiness and media-details endpoint payloads, permissions and limits. These inspections do not start playback, conversion, generation or scans. Playback-readiness responses additionally include `sourceIds`, deduplicated from the existing media items on the returned report page and capped at 100, so clients can request one authorized source-freshness batch. This adds no source lookup and does not summarize off-page sources. Readiness remains administrator-only. `disabledCommercialIds` is an optional authorized-commercial array on programming requests. `waitingReason` on generation items exposes transient `playback-capacity` progress without changing job status. The shared encoder budget is configured per server by `MYTUNER_ENCODER_CONCURRENCY` (2–8, default 3).

## Retained metadata and explicit reports — selected seventh round

| Method/path                                                               | Contract and authority                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/profiles/:profileId/deleted-collections`                        | Profile management; owned/admin unexpired collections with current grants for every member. `{items:[{id,name,ownerAccountId,deletedMs,expiresMs,count}]}`. Hidden/inaccessible collections contribute no names/counts.                                                                                                                                                              |
| `POST /api/profiles/:profileId/deleted-collections/:collectionId/restore` | Same authority, rechecked transactionally; `{id,name}`. Missing/expired/revoked target: neutral 404. No partial recovery or implicit publication.                                                                                                                                                                                                                                    |
| `DELETE /api/profiles/:profileId/collections/:collectionId`               | Existing owned/admin/profile-management checks; 204 now marks metadata deleted with recorded expiry. No media mutation. Normal GET/selection/edit/picker treats deleted IDs absent.                                                                                                                                                                                                  |
| `GET /api/profiles/:profileId/channels/:channelId/recent`                 | Current profile/PIN, subscription, channel and source grants. Two-hour completed scheduled programs from active revision's retained prefix, collapsed by program ID. `{checkedMs,startMs,endMs,retention,truncated,items:[{programId,title,startMs,endMs,seriesTitle,seasonNumber,episodeNumber}]}`; maximum 200 after authorization. Does not generate schedules or touch sessions. |
| `POST /api/playback/sessions/:sessionId/report-preview`                   | Caller-bound currently authorized playback; strict category (picture, sound, captions or other) and client (browser or tv). Returns `{draftId,expiresMs,summary}`. Prepares only; no submitted report or playback mutation.                                                                                                                                                          |
| `POST /api/problem-reports`                                               | Strict `{draftId,requestId}` UUIDs; exact actor/auth session and current context recheck. Returns `{id,createdMs,acknowledgedMs,summary}`. Same reporting account/request ID returns previously accepted report after rechecking access. 409 requires renewed review when preparation expires/context changes. New submissions: ten/account/ten minutes; 429 on limit.               |
| `GET /api/problem-reports?offset=0&limit=25`                              | Current account's currently permitted reports; admin sees all. Current-access filtering precedes counts/paging. Limit 1–100. Returns `{total,offset,limit,retentionDays,items}`.                                                                                                                                                                                                     |
| `GET /api/admin/problem-reports?offset=0&limit=25`                        | Admin-only global inbox, same bounded response.                                                                                                                                                                                                                                                                                                                                      |
| `PATCH /api/admin/problem-reports/:reportId`                              | Admin; strict `{acknowledged:true}`, 204.                                                                                                                                                                                                                                                                                                                                            |
| `DELETE /api/admin/problem-reports/:reportId`                             | Admin; 204, report metadata only.                                                                                                                                                                                                                                                                                                                                                    |

Report categories/client family are allowlisted; arbitrary error text/hidden references/uploads are rejected. Server summary uses only category/client, current application version, server preview time, caller-authorized channel/entry references, pause/live state and matching last negotiation route. Preparation does not call playback describe, negotiate, scan, encode or providers. Max 1,000 durable reports; five-minute bounded preparations; configurable default thirty-day age expiry. Send idempotency lasts only while the report remains retained.

Programming GET already returns `revisionId` or null. Preview/PUT now optionally accept `expectedRevisionId` UUID/null. The managed browser always sends it; legacy callers may omit it. Authorization/material validation precede conflict details. A stale explicit precondition yields 409 `Channel changed elsewhere. Review the latest programming before publishing.` No checkpoint/action/schedule state is consumed. Publication comparison and writes share one immediate transaction. A future-effective pending revision counts as a change; extending coverage within the same revision does not. One-time precondition/checkpoint commands are excluded from recurring saved config.

Local `db:verify` is a CLI operation, not an HTTP endpoint; see [operations](OPERATIONS.md). No new route grants subscriptions, source access or companion control.

## Display metadata and library inspection

Schema14 provides independent show/video title and description choices, manual drafts, cached integration/local candidates and protected metadata-root mapping. [The metadata API contract](METADATA_EDITING.md#api-and-storage) describes inspect/check/save, revision/fingerprint conflicts, authority and read-only semantics. Channel PATCH supports `description` and `expectedDetailsRevision` independently of programming revisions.

POST `/api/profiles/:profileId/selection?includeUnavailable=true` is an authorized library-inspection view of a normal selection, including retained unavailable files. Each item reports `available`. Without that explicit query, results remain available-only; programming/checkpoint resolution always uses that default. Known missing rows stay visible in library details with disabled file selectors. This does not import never-downloaded provider-only rows or make missing files playable.

## External subtitle configuration and discovery

[Subtitle setup](SUBTITLES.md) explains matching, supported formats, limits and management controls. All routes require authentication/current profile and media access; configuration, preview and check mutations require an administrator and browser CSRF when using cookies. Device tokens remain viewing-only.

| Route                                                              | Contract                                                                                                                                                                                              |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/api/sources/:sourceId/subtitles`                             | Admin settings `{enabled,root,subdirectories,maxDepth,revision}`                                                                                                                                      |
| PUT same                                                           | Same shape, integer `revision` compare-and-swap; 409 retains the current settings on conflict. Root is existing canonical read-only directory or null; up to eight relative subdirectories, depth 0–4 |
| GET `/api/profiles/:profileId/media/:mediaId/subtitles`            | `{checkedMs,lastSuccessMs,error,automatic,tracks}`; admin also receives opaque 64-character `revision`, `sourceId` and per-track relative root/path                                                   |
| POST same + `/preview`                                             | `{revision,manual:{rootKind,relativePath}}`, with rootKind `media` or `subtitles`, returns read-only `{fingerprint,format,size,supported}`                                                            |
| POST same + `/check`                                               | `{revision,manual?,fingerprint?}`; optional manual association requires a current supported preview/fingerprint. Returns updated inspection; stale request fails 409                                  |
| GET `/api/profiles/:profileId/media/:mediaId/subtitles/:index.vtt` | Existing delivery route supports embedded and external text, source-time authenticated WebVTT; external indices begin above 1,000,000,000                                                             |

A successful check atomically upserts candidates/reconciles missing associations and increments the check revision. An ordinary failed check returns retained associations plus check-error status; a failed manual save returns an error and retains the prior set. Permission/configuration/video revisions are rechecked after asynchronous filesystem work. Track advertisements include origin/format/language/forced/SDH and stable index but no external raw filesystem path. Conversion rechecks video/subtitle fingerprints before cache publication; work is aborted/drained on shutdown.

For admin manual-subtitle preview/check, a missing candidate file returns 404 with filename/location recovery guidance. Invalid or traversing relative input remains 400, and a symlink escaping the selected root remains 403. This does not turn a discovery-depth limit into a missing-file claim or bypass current media/source authorization. See [subtitle setup](SUBTITLES.md).

Full generated-output reconciliation uses `POST /api/admin/assets/cleanup` with `{dryRun:true,reconcile:true}`. Review its summary and `review` SHA-256 token, then apply `{dryRun:false,reconcile:true,review}`. A changed review fails 409; repeat the dry run rather than forcing old actions. The older default `reconcile:false` cleanup remains supported. See [operations](OPERATIONS.md#storage-cleanup).

## Refresh diagnostic contract (schema16)

`GET /api/admin/status` source entries include `refreshScheduled`, `lastAttemptMs`, `lastRefreshMs`, `refreshError`, `lastImportMs`, and `nextRefreshMs`. `lastRefreshMs` is the most recent successful source check; `lastImportMs` refers specifically to metadata import. `refreshState` is `never`, `incomplete`, `failed`, `overdue`, or `ok`. Null `nextRefreshMs` means no automatic schedule; it does not imply success. Error messages are sanitized and administrator-only. The status cache can delay a changed result by up to15seconds. Persisted diagnostics survive restart and unscheduling.

Source registration re-authenticates the current session/role after asynchronous path validation, immediately before insertion. Explicit provider import likewise re-authenticates after fetching upstream metadata, before catalog writes. A demoted/disabled/revoked requester receives403/401 rather than completing an admin write. Profile lineup saves validate the viewing PIN unlock before checking membership/version conflicts: a locked profile returns403; an actually stale lineup still returns409 without disclosing hidden private channel IDs.

Profile-scoped freshness is available without the admin status cache: `GET /api/profiles/:profileId/source-inspections?ids=<uuid>,<uuid>` accepts at most 100 UUIDs, deduplicates them and returns `{items:[{sourceId,lastAttemptMs,lastCompletedMs,lastSuccessMs,status}]}`. Timestamps are nullable milliseconds; status is `never`, `checking`, `current` or `incomplete`. An omitted/empty list returns no items. The route checks current profile access and reads requested sources/refresh attempts in one database query; non-admin results include only sources covered by the profile's grants. It exposes no absolute roots or raw error details, performs no filesystem/provider/probe work, and describes stored refresh history rather than present playability. A failed check can retain previously available catalog rows; label them as last known rather than freshly checked.

## Source management and bounded library responses — 0.2.2

Before editing, an administrator calls `GET /api/sources/:sourceId`. It returns a flat source object, including `rootPath` and a 64-character `revision` required when saving. The source fields and revision come from the same stored snapshot. The revision covers the source, saved integration and refresh interval, and is shared with `GET /api/sources/:sourceId/configuration`. The source list stays a simple list; opening an editor fetches this individual snapshot instead of adding per-source configuration queries to every list read.

`PATCH /api/sources/:sourceId` requires that `revision` and accepts optional `name`, `root`, `kind`, and `recursive`, with the same kinds as creation. An actual canonical directory/type change additionally requires `resetConfirmed: true`; this acknowledges the catalog/access reset and does not bypass dependency checks. A stale revision returns 409 before filesystem validation, and the server checks it again inside the final write transaction after awaited validation and renewed authorization. A newer integration, interval or source save therefore cannot be silently overwritten/reset by an older details form. Missing revision or missing reset confirmation for an actual reset returns 400.

The response is the updated flat source plus `revision` and `catalogReset`. Name/scope edits preserve IDs. A directory/type change resets that source’s catalog, integrations, grants and local-file settings so replacement content cannot inherit stale authority. Active scans or queued/running generation return 409. Destructive changes also reject channel configuration, retained schedule, collection and playback-report references.

`DELETE /api/sources/:sourceId` removes an unused source and its application-owned database references after those same guards. It does not delete or modify source files. Existing derivative files may become orphans; normal generated-output reconciliation can review them. No force-delete option is provided. Retained references can intentionally block deletion until normal retention/dependency cleanup releases them.

`GET /api/sources/:sourceId/integration` returns `hasApiKey: true` for a configured integration, never the stored key or ciphertext. `PUT` may omit `apiKey` to retain the encrypted key only when provider and normalized application URL still match. A first connection, changed provider or changed URL requires an explicit key; no saved credential is forwarded to a new destination implicitly.

`GET /api/profiles/:profileId/library` additionally accepts `limit` (1–100), `offset`, `kind` (`all`, `shows`, `movies`, `videos`, `collections`) and optional `sourceId`. Supplying `limit` returns page-scoped category arrays, page-scoped `savedCollections`, authorized `sources`, and `pagination: {offset,limit,total}`. The 24-entry browser page shares its filters with the server. Counts exclude unauthorized content. Existing callers omitting `limit` retain the aggregate contract. Search still matches filenames and preserves full authorized parent-group membership. Custom folder results include ancestors, allowing two channels to select separate nested categories in one source.

Sources displays per-source scan pending/success/incomplete/error messages alongside the detailed last result. A partial scan is not shown as full success, and provider matched/unmatched counts remain distinct from file scan completeness.

`GET /api/sources/:sourceId/directories` is admin-only and supports `search` (up to 300 characters), `offset` (0–1,000,000), and `limit` (1–100, default 50). It returns `{items,hasMore,offset,limit}` with distinct relative parent paths from available catalog entries. It performs no filesystem traversal, metadata projection or media probing. Empty/unscanned folders require a normal source scan or manual path entry. A delayed ad-hoc `/import` response rechecks source existence/settings before applying metadata, preventing a removed/reset source from receiving stale results.

## Performance/setup APIs and operator diagnostics

All setup/background routes require a current administrator and normal cookie CSRF for mutations. GET choices read cached process/SQLite state; they do not enumerate media directories or contact providers.

| Route                                             | Contract                                                                                                                                                 |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/api/admin/background`                       | Memory queue snapshot, pause state and policy; no media reads                                                                                            |
| GET `/api/admin/setup/path-suggestions`           | `purpose` is source, metadata or subtitles; optional `sourceId`. Cached process-visible mount candidates and saved paths, with provenance/unknown state. |
| GET `/api/admin/setup/provider-connections`       | At most 100 saved source/provider/URL references; no credential/ciphertext                                                                               |
| GET `/api/sources/:sourceId/provider-suggestions` | Cached observed roots, revisions and stale/error state                                                                                                   |
| POST same + `/refresh`                            | Explicit lightweight provider inventory; strict provider/URL, optional key/reuseSourceId and configRevision                                              |
| POST same + `/mapping-preview`                    | Draft mappings plus source/config/inventory revisions, optional at most 20 example paths; catalog/inventory-only preview                                 |

Integration PUT additionally accepts explicit `reuseSourceId` for a saved connection with identical provider/normalized full URL. Typed keys take precedence. Referenced configuration, source identity and admin authority are rechecked across asynchronous work. Metadata remains read-only upstream. Shared caching never sends retained credentials to a different destination.

Raw media responses preserve page/limit/search and now avoid projecting every row on empty search. Grouped library remains page-scoped; the main writer maintains the persisted index in bounded yielded batches and production grouping/search uses the read-only worker. Compact cache/input admission and memory caveats are documented in [the performance plan](PERFORMANCE_PLAN.md). `node dist/diagnose.js` supplies the read-only storage/health diagnostic; [Unraid checks](UNRAID_CHECKS.md) defines its limitations.

## Explicit setup directory check and catalog reader

`POST /api/admin/setup/check-directory` accepts `{ path, purpose, recursive, sourceId? }`, where purpose is `source`, `metadata` or `subtitles`. It requires current admin/CSRF authority; source-specific metadata/subtitle checks require a source ID. Returns a structured existence/readability/canonical-path/extension-sample result with `complete`, `reason` and bounded-check information. Invalid paths and incomplete sampling do not imply a playable library. Only explicit button use invokes this bounded read-only operation; a busy underlying check returns 429.

Paged `/api/profiles/:profileId/library`, `/media` and `/library/options` requests use the bounded production catalog reader. Existing paged response shapes and substring/grouping semantics remain. Omitting a production HTTP library limit defaults to 24 entries; use offset/limit to traverse the catalog. Queue pressure, continued catalog change, worker failure or indexing limits return retryable 503 errors; authority failures retain existing authentication/hidden-resource responses. Client disconnects cancel their waiter and final response publication rechecks current identity/profile/catalog state. See [large-library behavior](LARGE_LIBRARY.md).

## Composed management, catalog trees and channel drafts — 0.3.0

New management saves require current account/profile authority and normal cookie CSRF protection. Opaque 64-character revisions reject stale drafts with 409. Validation/hashing/filesystem awaits precede the final short transaction; actor and relevant saved state are rechecked before writes. Legacy endpoints above remain available, but the browser’s unified dialogs use these composed contracts.

| Route                                                                                    | Contract                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET/PUT `/api/sources/:sourceId/configuration`                                           | Admin snapshot/save of `{revision,subtitles,metadataRoot,integration,intervalMs}`. Integration is null or `{provider,url,apiKey?,reuseSourceId?,mappings:[{from,to}]}`; saved responses expose `hasApiKey`, not a key. Save validates newly changed directory destinations, respects protected storage roots, and rejects an active source scan. Disconnect is `integration:null`; changing configuration starts no scan.                     |
| GET/PUT `/api/accounts/:accountId/configuration`                                         | Admin snapshot/save `{revision,role,disabled,password?}`. Password omission preserves it; unchanged role/status without a password is a no-op and preserves sessions. Actual account/password changes retain last-admin protection and revoke affected credentials.                                                                                                                                                                           |
| GET/PUT `/api/profiles/:profileId/configuration`                                         | Manageable-profile snapshot; PUT `{revision,name?,kind?,ownerAccountId?,accounts?,grants?,pin?}`. Identity/access/grants changes are admin-only; permitted editors may update PIN. Account entries are `{accountId,canManage}`, grants are `{sourceId,subtree}`; pin omitted keeps, null removes, 4–8 digits sets. Admin-only lists are not disclosed to editors.                                                                             |
| GET `/api/profiles/:profileId/dependencies`; DELETE `/api/profiles/:profileId`           | Admin inspection and revision-guarded deletion. Retained schedules/playback/reports block deletion. Permitted deletion removes only profile-related settings/unlocks/subscriptions, not media. DELETE body is `{revision}`.                                                                                                                                                                                                                   |
| GET/PUT `/api/profiles/:profileId/subscription-configuration`                            | Manageable unlocked profile; GET `search`, `offset`, `limit` (default 50, maximum 100) returns eligible page, selected order and revision. PUT `{revision,channelIds}` (maximum 1,000) atomically saves visible subscriptions/order; unknown, duplicate, stale or now-ineligible choices reject. Hidden subscriptions are not disclosed or accidentally removed. Removed visible subscriptions close their profile/channel playback sessions. |
| GET `/api/profiles/:profileId/catalog/tree`                                              | Stored-catalog direct-child/search page: optional `sourceId`, relative `parent`, `search`, `recursive` (false), `mode` (folders/files), `offset`, `limit` (50, max 100), `includeCommercials`. Counts follow authorization; reading this route never enumerates source disks.                                                                                                                                                                 |
| POST `/api/profiles/:profileId/selection`                                                | Existing selector body; bounded query `offset`, `limit` (50, max 100), `search`, `includeUnavailable`. Returns only the selected page and totals through the catalog reader. Missing references may be inspected but are not selectable as playable media.                                                                                                                                                                                    |
| GET `/api/profiles/:profileId/collections/:collectionId/membership`                      | Owned/admin collection in manageable profile; compact `{id,name,ids,revision}`, at most 5,000 members, with full member authority checks. Collection PUT optionally accepts `expectedRevision` to prevent stale membership replacement.                                                                                                                                                                                                       |
| POST `/api/channels/drafts/preview`                                                      | `{draftId,details,config}` validates authority and produces a non-mutating preview with revision. Details contain name, nullable shortName, description and visibility; config is recurring programming. No channel is inserted.                                                                                                                                                                                                              |
| POST `/api/channels/drafts/publish`                                                      | Same draft plus `previewRevision`; atomic details/initial-programming creation. Identical successful retry returns the existing ID (200); new creation returns 201. Changed preview/catalog/draft returns 409. It does not subscribe a profile.                                                                                                                                                                                               |
| GET `/api/channels/:channelId/dependencies`; DELETE `/api/channels/:channelId/permanent` | Owner/editor or admin inspection. DELETE `{revision}` requires archived state and a current impact revision. It transactionally removes channel-specific groups/config, schedules/entries/checkpoints, rotation, subscriptions, playback sessions/history and reports. Counts are deletion impact, not blockers. Sources, media, collections and all files are preserved.                                                                     |
| GET `/api/admin/setup/directories`                                                       | Explicit admin filesystem folder page: `{root,parent?,offset?,purpose,sourceId?}` query. Purpose is source/metadata/subtitles. Permitted mounted/configured roots only, direct child directories, no symlinks/app storage/video inspection. Bounded cached listings can expire; 409 requires refreshing the choices.                                                                                                                          |
| GET `/api/auth/sessions`; PATCH `/api/auth/sessions/:sessionId`                          | Own-session list adds nullable `label`, `createdMs`, `lastUsedMs`; PATCH `{label}` trims 1–120 characters and renames only the caller’s session. No device fingerprinting or raw token is returned.                                                                                                                                                                                                                                           |

Library and programming-option GETs accept `titleOnly=true` for title-focused matching; compatibility callers retain the broader default search behavior. Tree filename search compares file basenames rather than treating an ancestor/source name as a file match. Browser title/tree searches are explicitly submitted, and mounted catalog page/branch caches are bounded; server-side permission checks still apply to selection, save and media requests.

Report list GETs accept `status=all|new|acknowledged` with existing pagination. Generation item reads accept bounded `offset`/`limit` and expose a total so completed-result lists need not load the entire queue. The generation scope’s reuse/overwrite policy remains explicit and source files remain read-only. [My Network](MY_NETWORK.md), [database](DATABASE.md) and [performance](PERFORMANCE_PLAN.md) describe UI semantics and limits.

## Database reset review and offline executor

The browser can review a reset; HTTP cannot execute or queue one. Both review routes require the current active administrator, with the existing browser CSRF policy on POST. Viewer/editor/device access receives the normal authorization denial.

| Route                           | Contract                                                                                                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET `/api/admin/reset/options`  | `{execution:'offline-only',retainedAdmin:{id,username},categories:[{id,label,description,requires:[{category,reason}]}],instructions}`. The retained identity is the current authenticated administrator. |
| POST `/api/admin/reset/preview` | Strict `{mode:'selective'                                                                                                                                                                                 | 'fresh',categories,retainedAdminId}`. Selective requires distinct nonempty categories; fresh requires an empty list and expands to all categories. Retaining a different administrator is refused. Returns requested/effective categories, dependency reasons, per-table action/count/reason, total affected records, retained identity, revision/scope, confirmation phrase, offline preview/apply commands and file-safety instructions. No reset mutations or filesystem cleanup occur. |

Category IDs are `metadata`, `custom`, `catalog`, `sources`, `collections`, `channels`, `activity`, `accounts`. Dependency closure is authoritative server-side. Every reset ends auth/device sessions, unlocks, pending pairings and playback; those consequences appear even for a narrow category. `revisionScope:'live-summary'` identifies browser review; the stopped executor computes `offline-full` from all recognized application rows. A browser summary revision must not be substituted for the required offline full revision.

`/api/admin/reset/execute` and `/apply` do not exist. There is no persistent reset job or startup replay. Execution is `node dist/reset-cli.js --admin-id UUID --mode selective --categories activity`; fresh mode omits categories. The preview prints the apply command, which adds `--apply --revision OFFLINE_SHA256`. Password and exact typed confirmation are stdin prompts, never CLI arguments or HTTP payloads. No skip-password/backup/dependency flags exist.

The offline command only opens the configured fixed `MYTUNER_DATA_DIR/mytuner.db`. It refuses a running owner, pending restore, unrecognized/future/old schema, linked control files, storage overlap, unknown SQLite extensions and pre-existing WAL/SHM/journal files before a writable database operation. It does not start server jobs or touch provider APIs/source content. A verified append-only recovery bundle precedes the transaction; partial failures retain diagnostic files. Stale state, failed password/confirmation, backup failure and integrity failures do not apply a partial reset. Successful JSON contains `reset:true`, retained administrator, effective categories, ended-session state, cleanup-disabled state and verified backup details.

Persistent schema-21 guards preserve old source roots and prevent later cleanup from deleting retained files; conservative quotas may refuse new output instead. [Operations](OPERATIONS.md#reset-application-data-offline) documents the Unraid helper, private prompts, refusal recovery, restart and storage limits. [The safety register](RESET_SAFETY_REVIEW.md) distinguishes implemented behavior from executed independent review evidence.

Channel-list responses also include boolean `hasProgramming`, derived from a saved nonempty programming configuration (or a legacy schedule) in the same authorized list query. An intentionally empty `groups: []` revision reports false. The browser can show publication state without fetching full programming during a separate channel-details edit. This flag does not expand channel visibility.

The recurring programming and new-channel draft contracts accept an empty `groups` array. Empty previews contain no new entries; publication keeps the channel and settings but stops future programming at the usual current-airing boundary. No standalone commercials or empty-schedule catch-up work is generated. Existing stale-revision/authorization checks still apply. Admin status reports an intentionally empty schedule as `empty` once any retained prefix finishes. Nonempty groups whose files are unavailable still fail explicitly.

The library GET accepts optional `topLevel=true` for the main My Network title cards. Default false preserves other callers. It filters parent cards before pagination/counts in the authorized catalog worker, omits raw typed TV/movie folders and nested folder-derived shows under an existing show, and aggregates custom video folders into direct source children. A custom source-root card exists only for videos directly at that root and retains recursive counts. Media/detail/tree/programming APIs and stored show identities are unchanged. Selecting a season or an indexed Featurettes folder uses the same existing selection API. No filesystem walk, source write, catalog migration or rescan is performed by this view.

### Profile-scoped library and explicit admin inspection — 0.3.1

Library GET, programming-options GET and catalog-tree GET default to `access=profile`, including for an administrator. Both account/profile/PIN authority and the profile’s source/subtree grants apply before counts, filtering, grouping and pagination. An empty grant list produces no profile library. Source/grant settings are never changed by a read.

An authenticated administrator may explicitly request `access=all` on these read paths to inspect the wider catalog. Library groups and saved-collection summaries can include `profileAllowed`; false means at least one member is outside the profile’s grants. `POST .../selection?access=all` and `GET .../collections/:collectionId/membership?access=all` support authorized detail inspection, with per-item or whole-collection annotations. Nonadministrators cannot request all-source inspection. Selection/membership also accept explicit `access=profile`; omitted access retains their existing compatibility behavior. The browser always supplies its selected scope, including `access=profile` when validating its tray.

The read actor preserves the authenticated account identity, administrator role and viewing-session/PIN context; source scope is a separate internal constraint. Profile-scoped and administrator-inspection results cannot reuse one another’s cache or coalesced-worker result. Workers recheck current account/grant authority before delivery. All access modes keep normal private collection/channel ownership rules, including the administrator’s existing cross-owner inspection exception.

Admin-authored programming and collection creation/update enforce the target profile’s grants independently of read inspection. In the browser, restricted videos and whole groups are disabled, the all-source folder/file browser is read-only, and profile/scope changes clear stale detail/edit state and abort old requests. These controls supplement server enforcement. No migration, filesystem search, source import, implicit grant or new media copy is involved.

### Playback schedule-update contract — 0.3.1 / schema 22

Playback descriptors add `stateVersion` and `scheduleUpdate`, which is null, `{atMs:<integer>,rejoinRequired:false}` for a compatible pending handover, or `{atMs:null,rejoinRequired:true}` for an already-diverged legacy session requiring explicit recovery. The current playback/offset and numeric position/behindLiveMs remain unchanged until the full-airing boundary. Next uses the staged authoritative target and remains source-authorized. Go Live clears the pending state; pause/resume preserve it.

Negotiation adds `revisionId` and `entryId`. Consumers must verify these match their current descriptor before attaching its URL, offsets, tracks or metadata; otherwise fetch a fresh descriptor. The browser orders descriptor responses by session `stateVersion`, then nondecreasing position within that version. Existing clients can ignore additive fields, but the new mismatch/recovery handling requires an updated browser/TV build. HLS manifests/segment authorization are bounded at complete-airing ends to prevent obsolete next-airing prefetch.

Pending-aware authorization bounds the old schedule at the handover timestamp. The target still requires current profile/source authority on adoption. Problem-report context and background playback admission resolve due pending references consistently. The sixty-second final-event grace accepts only an exact copied-prefix interval in the session’s current revision, same channel/program/media/timing/offset/fingerprint, current media authority and normal idempotent event validation. It cannot authorize abandoned future intervals.
