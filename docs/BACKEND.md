# Backend foundation and API contracts

For component/data flow, read [architecture](ARCHITECTURE.md). Detailed [discovery](MEDIA_DISCOVERY.md), [database](DATABASE.md), [playback](SCHEDULING_AND_PLAYBACK.md), [security](SECURITY.md) and [operations](OPERATIONS.md) guides complement this route reference. Browse all guides in the [documentation index](README.md).

## Current scope

The Node 24 service implements accounts, browser sessions, TV pairing/PINs, source grants, read-only scanning/metadata import, dynamic library selectors, collections, recurring channel programming, commercials, subscription guides, independent playback clocks, direct files, on-demand HLS, text subtitles, generation jobs, and backup/restore/verification, retained recent-airing lookup, deleted-collection recovery and explicit problem reports. Version 0.2.0 also serves the implemented React manager/player at `/`; the Kotlin/Media3 TV client uses these APIs. See [CLIENTS.md](CLIENTS.md).

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

| Routes                                                        | Purpose                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| GET/POST /api/sources                                         | Admin lists/registers `{name,root,kind,recursive}`                  |
| POST /api/sources/:sourceId/scan                              | Read-only scan, plus saved integration refresh if configured        |
| POST /api/sources/:sourceId/import                            | One-shot metadata import with supplied credentials                  |
| PUT/DELETE /api/sources/:sourceId/integration                 | Save/remove provider connection                                     |
| PUT /api/sources/:sourceId/refresh                            | `{intervalMs}` from 60,000 to seven days; null disables             |
| GET /api/admin/refresh                                        | Schedules, last successful imports, sanitized errors                |
| GET /api/profiles/:profileId/media                            | Authorized searchable/paged available catalog; page/limit/search    |
| GET /api/profiles/:profileId/library                          | Shows/seasons, movies, folders, Radarr collections; optional search |
| POST /api/profiles/:profileId/selection                       | Resolve a dynamic selection to authorized available media           |
| GET/POST /api/profiles/:profileId/collections                 | List/create saved reference collections                             |
| PUT/DELETE /api/profiles/:profileId/collections/:collectionId | Update/delete owned collection                                      |
| GET /api/profiles/:profileId/media/:mediaId/artwork/:index    | Authorized integration artwork proxy                                |

Kinds: shows, movies, videos, commercials. Scanning reads actual durations and video/audio/subtitle track details with bounded ffprobe calls, skips symlinks, and verifies size/mtime before committing. Files retain identity by source/path; replacements invalidate scheduled/generated fingerprints. Incomplete/offline scans preserve previous availability; complete scans mark absent files unavailable. Optional bounded NFO files and common episode filenames supply metadata without any remote match. XML external entities/DOCTYPE are rejected.

Integration shape: `{provider:"sonarr"|"radarr",url,apiKey,mappings:[{from,to}]}`. Only GET requests are sent upstream; redirects are rejected. Longest matching directory-boundary mapping wins, including Windows paths. Sonarr multi-episode files remain one item. Undownloaded entries are excluded from playable selections. Radarr collection labels support whole-collection selection. Imported associations include source identity, so duplicate upstream IDs in independent sources do not collide.

Persistent keys use AES-256-GCM; a private 32-byte integration.key stays in app data and application backups. A missing key for existing connections stops startup rather than silently replacing it. Refreshes are deduplicated per source, limited to two concurrent source jobs, and retried after failure while retaining prior imported metadata. The main server checks due jobs every 30 seconds. Artwork URLs/keys remain server-side: the proxy accepts only configured-host MediaCover paths, limits MIME/size/time, rejects redirects, and reauthorizes delivery.

Library `search` is trimmed, limited to 200 characters and matched case-insensitively against authorized titles, relative file paths, series/collection titles and source names. Parent group results retain full authorized membership/counts. Saved user collections remain a separate list. Superseded saved-integration refresh results cannot overwrite newly configured metadata or health; a scan requested for new settings waits and then performs fresh work.

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

Edits activate after the current program plus its breaks. Live sessions adopt the effective revision; paused/behind-live sessions retain their old revision until Go Live or a new join. Schedule extension uses bounded committed batches without resetting the timeline. Defaults target 48 hours; unusually dense/short content can return a shorter initial materialized window, shown by returned entries. Maintenance and guide/playback requests extend it. Extremely long catch-up can return 503 after 100 batches, retaining progress for the next attempt. Empty programming reports an explicit error; previously scheduled intervals retain their timing.

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

Channel create/PATCH accepts nullable `shortName` (1–12 characters). Null derives a label from the full name. Public channel objects include computed `shortName` and nullable `shortNameOverride`; names remain labels over stable UUIDs. The browser is served from `web-dist` at `/`; unknown API URLs remain API 404s.

## Selected improvement contracts

See [SELECTED_IMPROVEMENTS.md](SELECTED_IMPROVEMENTS.md#supporting-routes) for the complete supporting route matrix and user-facing delivery status. New interfaces remain separate from the implemented service contracts.

- Recurring groups accept optional `episodesPerTurn: 1 | 2 | 3`, omitted = one. Programming preview/publication accept optional one-time `checkpointActions`: `{groupId, action:"restart"}` or `{groupId, action:"startAt", mediaId}`. Only ordered groups are eligible; the start item must currently belong to the authorized selection. One command per group is accepted. Recurring config GET excludes those commands, so future edits/extension do not replay them. Preview and publication use the same current-program-plus-break boundary.
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

See [SELECTED_IMPROVEMENTS.md](SELECTED_IMPROVEMENTS.md#read-only-inspection-apis) for the dependency, readiness and media-details endpoint payloads, permissions and limits. These inspections do not start playback, conversion, generation or scans. `disabledCommercialIds` is an optional authorized-commercial array on programming requests. `waitingReason` on generation items exposes transient `playback-capacity` progress without changing job status. The shared encoder budget is configured per server by `MYTUNER_ENCODER_CONCURRENCY` (2–8, default 3).

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

Full generated-output reconciliation uses `POST /api/admin/assets/cleanup` with `{dryRun:true,reconcile:true}`. Review its summary and `review` SHA-256 token, then apply `{dryRun:false,reconcile:true,review}`. A changed review fails 409; repeat the dry run rather than forcing old actions. The older default `reconcile:false` cleanup remains supported. See [operations](OPERATIONS.md#storage-cleanup).

## Refresh diagnostic contract (schema16)

`GET /api/admin/status` source entries include `refreshScheduled`, `lastAttemptMs`, `lastRefreshMs`, `refreshError`, `lastImportMs`, and `nextRefreshMs`. `lastRefreshMs` is the most recent successful source check; `lastImportMs` refers specifically to metadata import. `refreshState` is `never`, `incomplete`, `failed`, `overdue`, or `ok`. Null `nextRefreshMs` means no automatic schedule; it does not imply success. Error messages are sanitized and administrator-only. The status cache can delay a changed result by up to15seconds. Persisted diagnostics survive restart and unscheduling.

Source registration re-authenticates the current session/role after asynchronous path validation, immediately before insertion. Explicit provider import likewise re-authenticates after fetching upstream metadata, before catalog writes. A demoted/disabled/revoked requester receives403/401 rather than completing an admin write. Profile lineup saves validate the viewing PIN unlock before checking membership/version conflicts: a locked profile returns403; an actually stale lineup still returns409 without disclosing hidden private channel IDs.
