# Selected improvements: implementation plan and status

The owner selected **I01–I16, I18, I19, I21, optional I24, I28, I29, I30, I31, I33, I34, I38, I39, I40, I42, I43 and expanded I47**: thirty-two of forty-eight proposals. The previous selection added five features and R7-01–R7-04, with R7-01 prioritized. Expanded I47 is now selected as documented below. I17, I20, I22, I23, I25, I26, I27, I32, I35, I36, I37, I41 and I44–I46/I48 remain optional. Selection authorizes implementation; it does not close earlier unfinished screens/device acceptance.

The earlier fifth-round selection corrected R5-02–R5-11. The approved delivery phases now also correct R5-01, R2-02, R3-01, R3-06, R8-01, R8-02, R9-03 and R8-04. R3-08/R6-06/R6-07/R6-08/R8-03 remain deferred in [the review register](IMPLEMENTATION_REVIEW.md). This work remains local on the existing feature branch, under unreleased version 0.2.0. Media is read-only, and media files are never copied into Git or duplicated by these features.

The approved Silver Signal layouts remain the visual foundation. New proposal screens and control layouts are described in [the focused design brief](SELECTED_DESIGN_BRIEF.md). The owner approved reusing that visual system for the selected extensions before the sixth review round. Implementation may proceed without another design-approval gate; raise material product/design mismatches as they arise. The sixth-round implementation below follows the owner’s subsequent selection.

The owner subsequently selected all four [seventh-review findings](IMPLEMENTATION_REVIEW.md#seventh-round-findings-and-disposition) and five of its six proposals. The following delivery section describes the implemented local behavior; I41 companion controls remains unselected.

## Current UI delivery checkpoint

The approved phases now connect the selected collection editor, bounded picker/season controls, ordered checkpoints, optional turn counts, copy flow, retained programming/commercial draft, readable preview/exposure, setup/import/access/generation/status, QR/device review, browser/native preferences/context/lineup/browse/help and I47 metadata surfaces. The earlier matrix below preserves the original service-versus-UI gap assessment; use [current design coverage](DESIGN_COVERAGE.md), CHECKLIST.md and VERIFICATION.md for current implementation/evidence. Real provider performance, complete native/full-frame visual/accessibility and physical playback acceptance remain open.

## Historical foundation delivery matrix

This matrix preserves the original planning checkpoint; its “Remaining delivery” column is historical and superseded by the current UI checkpoint above. “Service implemented” below means the supporting code exists and has service/API regression coverage. It does not mean a new browser or TV interface is connected to it. [VERIFICATION.md](VERIFICATION.md) records final executed checks and limitations.

| ID  | Selected behavior                                   | Current foundation                                                                                                                                   | Remaining delivery                                                                                                                   |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| I01 | Edit an existing saved collection                   | Authorized detail GET includes unavailable members; existing PUT retains collection ID and references                                                | Populate existing editor, retain unavailable selections explicitly, approve edit states, browser journey                             |
| I02 | Explain commercials and variation                   | Preview diagnostics report actual time, pool size, cutoff count and stop reason without using extra randomness; authorized statistics already exist  | Readable preview intervals/reasons and exposure view; keep scheduled/started/delivered measurements separate                         |
| I03 | Restart an ordered group or choose its next episode | One-time validated checkpoint actions in preview/publication; unrelated groups retain state; commands are excluded from recurring saved config       | Group controls, next-episode selection and confirmation; test through browser                                                        |
| I04 | Reconcile stale integration associations            | Bounded admin import reports record new/unchanged/unmatched/reassociated/absent associations and source-scan completeness; twenty reports per source | Review UI and installed Sonarr/Radarr completeness acceptance before any future automatic detachment; reports do not remove metadata |
| I05 | Keep large-library search useful                    | SQL permission filtering, bounded programming-options response, source/show drill-down, synthetic 10k/50k benchmark                                  | Real archive measurements; grouping still scans authorized catalog and is not constant-memory database pagination                    |
| I06 | Phone-assisted TV pairing                           | Public-code approval path, validated browser prefill and authenticated explicit approval remain intact                                               | QR rendering and approval-device review layout; manual code input remains available                                                  |
| I07 | Remember audio/caption preferences                  | Native device/server/profile language preferences; matching fresh track indices with default/off fallback; no file index persistence                 | Approved caption size/background controls and browser preference handling; native transition acceptance                              |
| I08 | Episode/progress/next/commercial context            | Authorized playback descriptors contain entry timing, content/airing progress, episode metadata and next program; pause uses retained session time   | Compact and expanded overlays in TV/browser; display on opening controls, hidden during ordinary unobstructed viewing                |
| I09 | Profile lineup order                                | Persisted subscription positions, complete authorized reorder API and guide ordering; new subscriptions append                                       | Accessible Move up/down controls; rename/unsubscribe/profile tests through both clients                                              |
| I10 | Actionable TV diagnostics                           | API/version health metadata, native compatibility validation and error-category mapping                                                              | Connection-details/help/recovery presentation; last-success/device details and exact recovery actions                                |
| I11 | Guided setup                                        | Admin setup-state aggregation and bounded read-only integration mapping check                                                                        | Status-based checklist linking existing forms; optional integrations and repair states                                               |
| I12 | Explain effective access                            | Admin-only target-account policy summary; target role, membership, management, PIN and source grants                                                 | Readable explanation and subscription-readiness UI; device/browser PIN distinction                                                   |
| I13 | Generation preflight and readable progress          | Reusable/new output counts, source-duration sum, generated headroom and item titles/relative paths; no encoder starts during preview                 | Readable confirmation/progress/errors; no unsupported size/ETA promise                                                               |
| I14 | Admin health and backup visibility                  | Cached, bounded admin status for mounts, refresh/import status, generation, schedule coverage, free storage and completed backup manifests           | Healthy/degraded/unknown dashboard with runbook links; periodic backup scheduler is not included yet                                 |
| I15 | Clear draft/preview/publication state               | Draft identity/state helper rejects late results; existing request-revision protection remains                                                       | Integrate one controlled draft including unsubmitted commercial inputs; close/navigation discard protection; effective-time labels   |
| I16 | Searchable grouped programming picker               | Authorized, bounded source/type options and per-show season details; saved selections remain stable IDs/rules                                        | Picker, keyboard/drill-down/loading/empty/saved-selection UI; preserve old selection during a new query                              |
| I18 | Numeric remote PIN keys                             | Top-row/numpad digits, Delete and explicit Enter share keypad state; no four-digit auto-submit or duplicate pending request                          | Emulator numeric-key regression and physical remote acceptance; keypad remains unchanged                                             |
| I19 | Duplicate programming into a new draft              | Authorized copy endpoint returns private default and selector/rule references; creates no channel/subscription/history/session                       | New name/profile confirmation, existing editor and fresh preview/publication; no copied rotation cursor                              |
| I21 | Browse other channels during playback               | Existing authorized guide API can be read without changing a playback session                                                                        | In-player panel, retained playback/polls/focus, explicit Watch live and pause-discard handling on both clients                       |
| I24 | Optional 1/2/3 episodes per turn                    | Optional contract field, persisted remaining turn state and default-one compatibility; chunk/restart/preview coverage                                | Approved per-group selector and preview wording; UI omission keeps one episode per turn                                              |

## Sixth-round selected delivery — I28, I29, I30, I31, I33, I34

These six additions are implemented in the existing Silver Signal visual system. The earlier twenty-item matrix still tracks its own remaining work; completing these additions does not close every previous screen or physical-device acceptance item.

| ID  | Delivered behavior                                                                                                                                                                         | Limits and acceptance                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I28 | Collection deletion opens an authorized dependency report with paging, refresh, future selectors, scheduled matching videos and retained playback. Channel links open read-only details.   | Advisory snapshot; counts exclude other owners’ private channels for editors. Deletion does not cascade into airings or media. Grant-change impact remains future scope.                                        |
| I29 | One shared FFmpeg admission queue covers HLS, subtitle extraction and optional generation. Generation progress says “Waiting for playback capacity.”                                       | Configurable total 2–8, default 3; reserve one slot from background work. Running tasks finish; this is process admission, not a CPU/latency guarantee. Existing per-service limits remain.                     |
| I30 | Admins can check stored-metadata playback readiness from library selections and channel details, with routing/caption counts and paged examples.                                           | Reports analyze at most 5,000 selected files or upcoming materialized intervals, returning at most 100 examples per page. No scan, session or conversion starts. Declared capabilities do not certify hardware. |
| I31 | The Commercials tab lists eligible clips with per-channel enable/disable controls and an eligible count. Preview and publish apply changes after the current program and breaks.           | Existing airings and paused revisions keep their choices. All-disabled pools resume programming without scheduled dead air. No dates, source-global retirement or emergency blackout.                           |
| I33 | Channel/collection details offer safe fragment links and Copy link; reload, Back/Forward, sign-in and profile PIN (where required by the existing role/device policy) preserve the target. | UUID locators carry no permissions. Missing/archived/private/revoked resources show a neutral unavailable state. Opening never tunes, edits or publishes; dirty channel drafts retain discard protection.       |
| I34 | Library video rows open stored details with episode/movie identity, source name, relative filename, exact duration and optional technical track summaries.                                 | No absolute host path, source read or probe occurs. Last scan time is explicitly unknown; catalog metadata can be stale. Close restores row focus.                                                              |

### Encoder admission and waiting

`MYTUNER_ENCODER_CONCURRENCY` controls the shared process budget. Background tasks may occupy at most total minus one slots. Interactive playback/subtitle requests are preferred; after eight interactive admissions, a queued background task can receive the next eligible slot to prevent starvation. Running encoders are never preempted. Direct playback and reusable cache hits consume no slot. Queue length is bounded at 100; existing streaming/subtitle limits still bound their work.

Authority and stopping state are checked before queuing and again on admission. HLS callers retain work sharing and authorization checks while waiting. Cancellation removes waiting tasks, shutdown drains their owning services, and interrupted generation returns to queued state for replay. `waitingReason: "playback-capacity"` is temporary progress on a running generation item, not a failed job or an ETA. Measure actual Unraid contention before tuning the default.

### Read-only inspection APIs

- `GET /api/profiles/:profileId/collections/:collectionId/dependencies?offset=0&limit=25`: requires owned/admin collection access and management authority; channel ownership filtering precedes counts. Reports recurring selectors, overlapping future materialized items and retained playback references separately.
- `POST /api/admin/playback-readiness`: browser/API admin only, with `{profileId, selection}` or `{profileId, channelId}`, declared `{containers,videoCodecs,audioCodecs}` capabilities and optional offset/limit. Shares its pure routing decision with actual negotiation; shortened commercials require HLS. Missing technical/video metadata is unknown. Counts distinguish direct, HLS, unknown, unavailable and unsupported caption tracks.
- `GET /api/profiles/:profileId/media/:mediaId/details`: rechecks profile/source access, returning stored relative metadata and tracks only. It starts no filesystem scan/probe, playback, job or derivative.

Channel-local `disabledCommercialIds` is an optional bounded array on the normal programming contract. IDs must identify authorized commercial media; duplicate, hidden and non-commercial IDs are rejected. Eligibility is evaluated while generating each revision, leaving older persisted choices intact. Removing an ID restores that clip’s eligibility without changing its media ID or source.

Links use `#channels?profile=<UUID>&channel=<UUID>` and `#library?profile=<UUID>&collection=<UUID>`. Parsing rejects malformed IDs, duplicate locator fields and unrelated query fields. Tokens, PINs, titles, filesystem paths and drafts never enter the link. The link is relative to the current server; it is not an external redirect.

## Seventh-round selected delivery — I38, I39, I40, I42, I43

| ID  | Delivered behavior                                                                                                                                                                                                                                                       | Limits                                                                                                                                                                                                                                                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| I38 | `npm run db:verify -- /snapshot-directory [--json]` shares restore integrity, foreign-key, supported-schema, migration and integration-key checks in private OS temporary scratch. Reports validator/schema/time/SHA-256 identity and removes scratch.                   | No live lock, journal, rollback, session change, provider, scan or encoder. Database/key/manifest files only; no media copies. Verification cannot certify physical recovery/mounts. Keep any result tied to its exact fingerprint.                                                                                                      |
| I39 | Browser guide/player and TV player offer Recently aired: up to 200 retained completed scheduled programs in the last two hours, episode identity and date/time, one row per program including split mid-rolls.                                                           | Current active revision's authoritative prefix only. Rechecks profile/PIN, subscription, channel and source access before results/limits. Read-only, no generation, replay, recording or watched claim; partial/empty retention is explicit.                                                                                             |
| I40 | Browser and TV choose Picture/Sound/Captions/Other, review exact sanitized summary and explicitly Send. Admin inbox acknowledges/deletes; account-scoped browser reports show only currently permitted own submissions.                                                  | Five-minute bounded in-memory preparations; no automatic/offline uploader. Send retry is idempotent. Default 30-day retention, maximum 1,000 reports, ten new reports/account/ten minutes. No raw logs/errors/paths/tokens/PINs/screenshots/media.                                                                                       |
| I42 | Deleting collections retains original ID/name/member IDs. Browser Undo and Recently deleted restore the original metadata. Default seven-day grace period; expiry purges metadata/references only.                                                                       | Normal selectors treat deleted collections absent. Owner/admin, profile management and all current member grants required; revoked-member restores fail neutrally. Unavailable files stay referenced. No schedule publication/rewind/session/grant/subscription change. Previously hard-deleted/expired collections cannot be recovered. |
| I43 | Browser captures server revision/null for preview/publication. Atomic publication transaction rejects stale preconditions with 409. Conflict preserves draft and offers Load latest or Keep draft and review against latest, with readable comparison and fresh preview. | No automatic merge, presence or general undo. Automatic horizon extension does not change revision. Legacy API callers omitting precondition retain last-writer behavior; browser always sends it. Late own success updates base without marking a newer local draft saved.                                                              |

R7-01 captures collection delete intent by original ID/name and closes resource-owned inspectors/confirmations across history/selection changes. R7-02 clears exclusions when a pool changes and treats saved, out-of-pool exclusions as inert while rejecting newly forged hidden/non-commercial IDs. R7-03 accepts validated recovery despite missing/malformed/mismatched live encryption keys, preserving private forensic bytes without claiming a valid rollback. R7-04 serializes TV profile choices with visible pending/retry state and commits the selected profile only on success.

Retention settings are `MYTUNER_COLLECTION_RETENTION_DAYS=7` and `MYTUNER_REPORT_RETENTION_DAYS=30`, whole days 1–365. Expiration is hidden immediately by reads; the production maintenance pass removes expired records. Changing collection retention affects subsequent deletions; each deletion has a recorded expiry. Report retention applies to existing reports on reads/maintenance. Name collisions are allowed because collection identity is the UUID. Neither feature deletes source files.

Report summary fields are category, client family, application build version (current server/client POC 0.2.0), server preview time, channel/entry references, live/paused/behind-live state and last negotiated delivery route for that entry (`unknown` if no matching negotiation). These describe advertised context, not proven picture/sound quality. Server derives references from the caller-bound session without polling/extending/touching playback. If context changes before Send, review a new summary. Successful retries after a lost response return the existing report; after expiry/deletion, idempotency history is no longer promised.

## Programming API additions

Recurring group configuration may include `episodesPerTurn: 1`, `2` or `3`. Omission means one. With ordered A=2 and B=1 the sequence is A1, A2, B1, A3, A4, B2. Progress through a turn is checkpointed across schedule batches and restart. Unavailable groups are skipped by stable ID without renumbering other groups; returning groups retain their episode state. Publications activate after the current program and its breaks, even in the middle of a multi-episode turn.

Preview/publication may include an optional bounded `checkpointActions` array:

```json
{
  "checkpointActions": [
    { "groupId": "show-a", "action": "restart" },
    {
      "groupId": "show-b",
      "action": "startAt",
      "mediaId": "<authorized episode UUID>"
    }
  ]
}
```

These are additional fields on the normal programming request, not a standalone complete payload. Actions require an ordered group, one command per group, and an available selected start item. They execute once. Save only the recurring configuration; GET does not replay commands. Plain edits never imply an explicit rewind. Replacing a different show resets that group's obsolete cursor; editing season/special filtering on the same show retains ordered continuation.

Preview diagnostics describe the **scheduled** commercial intervals: start/end, requested time, authorized pool size, count of clips and shortened clips, and filled/minimum-remaining/clip-limit/no-pool/duration-fit/variation-limit outcome. They do not add padding, alter random choices or report that a human watched an advertisement. The existing six-second strict threshold remains: start another commercial only when remaining time is greater than the configured minimum in truncation mode.

## Supporting routes

All normal authentication, CSRF, profile/PIN, source and channel checks remain in force. Admin endpoints reject ordinary viewers. Full route details belong in [BACKEND.md](BACKEND.md).

| Route                                                    | Purpose                                                                                                    |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /api/profiles/:profileId/collections/:collectionId` | Authorized existing members, including unavailable references, for editing                                 |
| `GET /api/profiles/:profileId/library/options`           | Bounded picker search, `search`, `offset`, `limit` (1–100), optional `sourceId`/`showKey`                  |
| `PUT /api/profiles/:profileId/lineup`                    | Complete authorized visible subscription list in desired `channelIds` order                                |
| `GET /api/channels/:channelId/draft-copy?profileId=…`    | Copy owned/admin-readable recurring rules to a permitted target profile without creating anything          |
| `GET /api/admin/setup`                                   | Configuration counts for guided setup; integrations optional                                               |
| `POST /api/admin/sources/:sourceId/mapping-check`        | Up to twenty upstream paths against configured mappings/catalog, without write probes                      |
| `GET /api/admin/profiles/:profileId/access/:accountId`   | Effective access of the target account, not the inspecting admin                                           |
| `GET /api/admin/status`                                  | Status cached for fifteen seconds; two-second filesystem deadlines, at most 32 mounts/200 backup manifests |
| `GET /api/admin/sources/:sourceId/imports`               | Latest twenty completed provider-read reports                                                              |
| `GET /api/admin/imports/:runId`                          | Report summary and at most 100 detail rows per page                                                        |

Existing generation preview/job responses gain explanatory fields. Playback descriptors gain `context` without changing live join, local pause, delivery offsets or captions. Pairing start gains a relative approval path containing only the public user code. Scanning a link never approves a device or unlocks a profile.

## What I08 displays and when

With playback controls dismissed, the picture stays unobstructed. Opening playback controls shows the current episode identity, progress, next program, live/behind-live state and commercial timing when applicable. A commercial countdown uses the scheduled delivered interval: a twelve-second file truncated to ten seconds displays a ten-second interval. Pausing freezes the session-derived countdown. Unavailable metadata has a simple title fallback. A brief tune-in display may be included in the design; permanent overlay display is not required.

I17, automatic inactivity dismissal, remains unselected. I08 must work with the existing explicit overlay visibility behavior and cannot silently add auto-hide or alter remote key semantics.

## What I14 backs up and how it starts

I14 is **visibility**, using existing backup mechanisms:

1. An operator runs `npm run db:backup` in a source checkout, or `node dist/backup-cli.js` in the production container. SQLite's online backup API creates a private application snapshot containing `mytuner.db`, the matching `integration.key` when present, and `manifest.json`.
2. Offline restore validates the selected input and creates a full pre-restore recovery snapshot of healthy existing application data before replacement. Interrupted restore recovery keeps its journal until successful recovery.
3. Schema upgrades create a private **database-only** pre-migration safety snapshot. This is separate from a full application bundle and must be preserved with the matching integration key.

There is no built-in recurring backup schedule. An operator can later choose an Unraid User Scripts/cron job and off-host retention; choosing I14 does not select a cadence or authorize host changes. The status API reports completed full-bundle manifests, not pre-migration database-only files. It does not trigger backups, download credential bundles or restore a running server.

Backups include configuration, catalog references, account/password hashes, subscriptions, scheduling, progress and application history present in SQLite. They contain no original videos/commercials, derivatives, cache, Compose file or mount configuration. Restore invalidates sessions and pairings. An overlapping backup/restore may finish with a consistent database/key pair or fail clearly with a retry message; a mismatched pair is removed before a completed manifest is published. Same-disk snapshots still need a separately chosen off-host copy policy.

## Performance evidence and limits

The generated 10,000- and 50,000-item catalogs use synthetic references only, twenty episodes per show, and repeated targeted search for “Show 12.” The benchmark script is `node --import tsx scripts/benchmark-library.mjs`. Initial local measurements were 21/26 ms median/95th sample at 10k and 137/156 ms at 50k. Bounded responses were 3.5/8.3 KB versus approximately 94/477 KB for a full unfiltered library. These are local diagnostic samples, not latency guarantees or concurrency/physical-Unraid results.

Aggregation still visits the authorized catalog. Process RSS reached approximately 496 MiB after repeated 50k searches and includes V8 allocation/high-water behavior and synthetic fixture memory. Stable database-level grouped cursors/indexing remain a follow-up if the real archive or concurrent household usage warrants them. The response limit is not represented as a bound on all backend work. No hidden-source title or count contributes to the returned groups.

## Acceptance and follow-through

- Fix and regress R5-02–R5-11; keep unselected findings visible.
- Verify programming state, explicit commands, seeded choices, exact boundaries and source hashes.
- Verify new endpoints under admin/editor/viewer roles, hidden sources, locked profiles and changed memberships.
- Verify failed/partial providers preserve metadata and do not produce false “removed” actions.
- Implement selected browser/TV surfaces using the approved visual system; add visual baselines and behavioral journeys.
- Exercise native delayed delivery, stale menus, numeric input and language fallback; validate actual Bravia/Fire hardware separately.
- Run type checking, complete backend/browser suites, compiled lifecycle smoke and native build/lint/tests; audit docs and local links.
- Keep the synthetic demo current. Commit/push/PR/release and Unraid/network changes remain separate actions.

## Expanded I47 selection — editable channel and content information

The owner selected expanded I47 after the eighth review. [METADATA_EDITING.md](METADATA_EDITING.md) is the source of truth for its pending implementation: dedicated channel-details modal including description; show/episode/movie/custom-video title/description with independent integration, local metadata file or manual choices; quick stored availability and an explicit metadata-file recheck. Existing names/short names/visibility now have a separate Edit details modal and immediate Save, accessible directly or above a retained programming draft. Edit programming remains distinct. Expanded descriptions and source-aware metadata controls remain pending. The owner replaced web lookup/URLs/parsing with existing adjacent NFO files or a configured read-only metadata directory. No web provider choice is pending. Custom catalog metadata starts admin-only, while channel details retain owner/admin authority. The selected separate-actions portion is implemented and locally verified; the remaining expanded metadata scope has no new API/migration yet. Version/schema remain 0.2.0/13.
