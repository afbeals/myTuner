# Functional and UI/UX improvement research

Current implementation selection: **I01–I16, I18, I19, I21, optional I24, I28, I29, I30, I31, I33, I34, I38, I39, I40, I42, I43 and expanded I47**. See [the selected plan/status](SELECTED_IMPROVEMENTS.md) and [focused design handoff](SELECTED_DESIGN_BRIEF.md). The selected interfaces and expanded I47 are implemented locally. Full UI state/design/accessibility and target-device acceptance remain open in [the software audit](OPEN_SOFTWARE_AUDIT.md). Selection alone is not verification.

Research status: six earlier rounds of three independent research agents, followed by the ninth review's feature and UI/UX researchers, inspected the standalone 0.2.0 implementation. [Ninth-round research](#ninth-review-research) adds optional I48 and two I47 UX refinements. The full catalog contains **48 proposals: thirty-two selected and sixteen optional**. Every new proposal, existing-ID refinement and considered/deferred category is surfaced below. Evidence is source/document research, without household usability studies or physical-device validation.

The [current recommendations](#ninth-review-research) explain scope and tradeoffs, and the [complete proposal catalog](#complete-proposal-catalog) lists every suggestion. Defects remain separate in [IMPLEMENTATION_REVIEW.md](IMPLEMENTATION_REVIEW.md#ninth-round-findings-and-disposition). The owner subsequently selected R7-01–R7-04 and I38/I39/I40/I42/I43. Their implemented behavior and limits are in [the delivery matrix](SELECTED_IMPROVEMENTS.md#seventh-round-selected-delivery--i38-i39-i40-i42-i43). I41 remains optional. Existing privacy, home-network, rotation and read-only-media boundaries remain unchanged.

The detailed research below records the pre-selection evidence/proposed scope. The delivery matrix and [current metadata behavior](METADATA_EDITING.md) supersede original optional, pending and default-policy wording for selected features.

## Ninth review research

One dedicated feature researcher and one dedicated UI/UX researcher compared the latest implementation and pending local-only I47 against all I01–I47. They recommend completing I47, selected screen work and device acceptance before expanding scope. One distinct optional proposal follows; the two UX suggestions refine I47 rather than creating duplicate IDs. None of this investigation implements new application behavior.

### I48 — Temporarily disable a programming group without losing its place

**Problem/evidence:** In an A/B/C rotation, temporarily omitting B currently requires removal and later re-adding it. [contracts.ts](../src/contracts.ts) has no group-enabled flag; [Channels.tsx](../web/src/Channels.tsx) removes groups and creates fresh IDs on re-add; [scheduler.ts](../src/scheduler.ts) keys episode cursors and remaining shuffle bags by group ID. Re-adding B can therefore lose its saved place.

**Smallest flow:** An Enabled checkbox in the programming draft, plus clear disabled status. Preview and Publish apply at the normal airing boundary. While B is disabled, A/C continue; enabling B resumes its saved episode cursor or remaining shuffle bag on its next normal turn. Keep group identity, selector and mode. No media move, new copy or playback interruption. All-disabled/all-unavailable configurations reject clearly; current grants are rechecked on re-enable. Existing airings and paused revisions remain intact.

**Limits/effort:** Medium server/editor work; optional after I47 and device acceptance. Do not promise restoration of a partially consumed two/three-episode turn: `remainingInTurn` currently describes the active rotation. Preserving B's bag/cursor does not guarantee the identical future random sequence after other groups advance shared random state. Distinct from I20 individual episode exclusions, I25 group mid-roll policy and I31 commercial retirement.

**Acceptance:** Ordered/shuffle disable and re-enable, restart/serialization, preview without writes, publication boundaries, no turns while disabled, all-disabled validation, revoked/unavailable selectors and paused retained airings. UI shows disabled groups and can re-enable them without recreating IDs.

### UX refinements recommended within I47

- **Use current text as manual:** Offer an explicit action for one title/description to seed its unsaved manual draft from the effective value. Keep prior saved/drafted manual text; replacing it requires deliberate intent. Switching sources retains the draft. Cancel writes nothing; only Save persists in SQLite. This makes a small synopsis edit practical without retyping a full imported description.
- **Separate Edit details from Edit programming — implemented after selection:** Direct row/preview actions open the channel-details modal for current fields; programming has its own action and can open details above its preserved draft. Details saves immediately. Local regressions cover session/pause, draft/focus, late/error responses and owner/admin authority. Descriptions and the expanded metadata sources were subsequently implemented; see [current metadata behavior](METADATA_EDITING.md).

The owner subsequently selected the separate-actions refinement; it is now implemented for existing channel fields, with retained programming drafts. Manual-text seeding remains a recommendation; expanded I47 metadata/source editing is now implemented locally. Source availability/previews, automatic precedence, source isolation and stale-response handling already belong to I47. Documentation reviewers additionally recommend a stable cached-integration outage policy and concurrent-save conflict handling; [the I47 plan](METADATA_EDITING.md#resolver-and-editor-rules) records their implemented behavior and remaining acceptance.

### Other candidates considered and disposition

| Candidate                                            | Disposition and reason                                                                                                |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Editions/encoding grouping                           | Defer pending representative library evidence; overlaps I04 association reconciliation and I44 continuity advisories. |
| Bulk metadata defaults                               | Keep future policy discussion under I47; no separate feature ID or bulk-write scope selected.                         |
| Metadata-overrides dashboard and bulk editing        | Defer until repeated household tasks justify another screen and broader edit/conflict policy.                         |
| Templates, maintenance controls and viewing handoff  | Already represented by catalog alternatives and prior deferred research; no duplicate IDs.                            |
| Source availability and per-source previews          | Already required by selected I47.                                                                                     |
| Web providers, URLs, scraping and HTML/CSS selectors | Explicitly withdrawn by the owner; local metadata files remain the third source.                                      |

## Eighth review research

Three independent researchers reviewed functionality, browser/admin UX and TV/viewer UX against all I01–I43. They recommend finishing selected screens and physical-device acceptance before expanding scope. Four distinct additions follow. The owner subsequently selected and expanded I47 as [metadata editing](METADATA_EDITING.md); I44–I46 remain optional and unimplemented. I47 now includes separate channel actions, descriptions and per-field integration/local-file/manual metadata editing. All preserve current authorization and read-only original media.

| ID  | Optional proposal                           | Smallest useful scope                                                                                                       | Effort / recommendation                                        |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| I44 | Ordered-episode continuity advisories       | Nonblocking metadata warnings for gaps, overlapping multi-episode coverage and unknown numbering in selected ordered shows. | M; useful after the existing picker/checkpoint flows.          |
| I45 | Per-TV compatible-stream preference         | Automatic or explicit existing 720p HLS output, applied on next tune for this server/device.                                | M; only after physical-network measurements show a need.       |
| I46 | Physical-source scan change summary         | Latest scan's Added/Returned/Changed/Unavailable counts with bounded examples and explicit incomplete status.               | M; useful if recurring refresh changes are hard to understand. |
| I47 | Selected: editable channel/content metadata | Implemented: separate channel actions, descriptions and per-field integration/local-file/manual information in Edit modals. | Delivered locally; full UI and device acceptance open.         |

### I44 — Ordered-episode continuity advisories

**Evidence/value:** [integrations.ts](../src/integrations.ts) imports Sonarr `episodes[]`; [local-metadata.ts](../src/local-metadata.ts) can identify a combined file's `lastEpisodeNumber`. [scheduler.ts](../src/scheduler.ts) sorts starting season/episode, while [programming.ts](../src/programming.ts) and the browser preview show scheduled intervals rather than continuity warnings. E01, E02, E04 can therefore look ordered without explaining the metadata jump.

**Flow:** For an authorized ordered show/season, normalize coverage ranges from stored metadata and show nonblocking gaps, overlaps and unknown-numbering advisories. E01–E02 followed by E03 is continuous; E01–E03 plus E02 overlaps. Do not infer leading/trailing gaps, missing seasons, cross-season gaps or proof that a file has not downloaded. Explain uncertain/incomplete numbering. No provider/filesystem requests, download, exclusion, schedule, cursor or playback changes.

**Acceptance:** Test combined files, malformed/unknown numbering, specials and selected-season filtering; remain read-only and deterministic without consuming shuffle state. Only permitted selected metadata may affect warning text/counts. Recheck revocation and discard late results after profile/selection changes. Distinct from I03 checkpoint controls, I04 provider reconciliation, I16 picker and I34 inspection. Medium effort; no design promise before selection.

### I45 — Choose the existing compatible stream on one TV

**Evidence/value:** [contracts.ts](../src/contracts.ts) negotiates codec/container support; native [MainActivity.kt](../android/app/src/main/java/tv/mytuner/app/MainActivity.kt) prefers direct unless track selection/decoder failure forces HLS. [streaming.ts](../src/streaming.ts) already provides fixed 720p H.264 with a 1.5 Mbps target and 2 Mbps maximum video rate. A high-bitrate original can overload Wi-Fi despite being decoder-compatible.

**Flow:** A local server/device setting offers Automatic (default) or 720p compatible stream. Explicit mode requests the existing HLS output while reporting truthful capabilities; apply on the next tune. Explain reduced detail and server conversion cost. Reuse existing cache/admission rules. No new bitrate ladder, adaptive streaming, automatic throughput detection or router changes. An original may already use less bandwidth, so do not promise savings for every file or resolution of blocked VLAN routing.

**Acceptance:** Automatic retains current routing. Otherwise-direct synthetic content uses HLS in explicit mode; normal live/PIN/grant checks precede capacity reservation. Identical consumers share cached work; another device/session/schedule stays unchanged. Verify pause/captions/audio/commercial cutoff/retries and revoked requests start no work. Compare representative device/network measurements before claiming improvement. Medium effort; defer until hardware use establishes need; distinct from I29 capacity and I30 readiness prediction.

### I46 — Explain what a physical-source scan changed

**Evidence/value:** [catalog.ts](../src/catalog.ts) returns seen/updated/missing/complete/errors but merges new, changed and returned files into updated. [Management.tsx](../web/src/Management.tsx) presents a transient result; recurring refresh has no equivalent review. [refresh.ts](../src/refresh.ts) performs filesystem and subsequent provider work, whose outcomes should remain distinguishable.

**Flow:** Retain the latest source scan summary with Added, Returned, Changed and Unavailable counts plus capped/paged source-relative examples. Mark incomplete/unreadable/cancelled scans explicitly. Keep completed filesystem results visible when Sonarr/Radarr import fails. Admin-only, bounded retention and no viewer exposure. Opening a report starts no work.

**Acceptance:** New/changed/returned files enter separate categories; incomplete scans confirm no removals and retain existing availability rules. Provider failure cannot conceal a completed scan. Counts/examples remain bounded and authorized. No media changes, generation, publication or playback effect. Medium effort; I04 covers provider associations and I14 health, so this is a distinct physical-file change report. Merely improving existing JSON belongs to I11/I14 rather than another feature.

### I47 — Editable channel and library information (expanded selection)

The owner selected I47 and expanded it beyond custom-video titles: channel name/short name/description in an Edit modal, plus show/episode/movie/custom-video title and description with per-field source choice. Prefer Sonarr/Radarr by default, allow durable manual overrides, and read adjacent or explicitly mapped local metadata files. Show stored availability quickly and offer an explicit file recheck. Keep local scanned fallback, stable identities/order, source media read-only and provider refresh separate from custom values.

[The complete scope and flow](METADATA_EDITING.md) defines modal behavior, source choices, authority, persistence, replacement handling and regression acceptance. Existing channel names/short names/visibility now use a dedicated details modal; descriptions and source-aware content editing are pending. The owner removed web lookup/URLs/parsing; NFO metadata and read-only directory mapping replace that source. The initial shared-catalog editing authority remains administrator-only; channel owners/admins edit their own permitted channel details.

### Existing-ID refinements and considered alternatives

- **I03/I15/I16:** Complete checkpoint, picker and draft flows before adding more controls. A schedule preview comparison remains I15 refinement.
- **I04/I11/I14/I30/I34:** Explain metadata provenance, incomplete/unknown results and readable setup/scan outcomes. New report submission does not replace I10 connection recovery.
- **I06:** Recognizable device names and revoke targets remain the pairing scope.
- **I07:** Explain that track selection saves a language preference and when missing-language fallback uses default/off; fix existing language-alias correctness separately.
- **I08/I17/I21:** Complete compact context, nested Back/focus and browsing with paused playback; the native player already has three control rows.

Programming templates and maintenance draining remain deferred until a concrete need/policy. Watch-history-driven rotation requires a separate privacy/broadcast decision. Episode exclusions, sleep/start-over, duration filters, persistent browser drafts, guide search, companion controls, last channel and reminders already have IDs or recorded dispositions. Loudness, overscan/safe area and fit/zoom need representative device evidence. TV subscription editing requires deliberately expanding device authority; retain browser management. No second distinct functional or TV idea was recommended merely to increase the proposal count.

## Seventh review research

Three independent researchers examined functionality, browser/setup/admin UX and TV/viewer UX after I28/I29/I30/I31/I33/I34 shipped locally. They found six distinct optional additions. First resolve selected correctness work and finish the earlier selected screen/device backlog; these suggestions do not replace those commitments.

| ID  | New optional proposal                  | Smallest useful scope                                                                                             | Effort / recommendation                                               |
| --- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| I38 | Verify a backup without restoring      | Local CLI validates one bundle in private scratch without installing it or disturbing live sessions.              | M; useful before a real upgrade/recovery rehearsal, after R7-03.      |
| I39 | Recently aired program lookup          | Read-only last-two-hours scheduled titles/episodes; no replay, recording or watch-history tracking.               | M browser, M–L both clients; follow I08/I21.                          |
| I40 | Explicit playback-problem reports      | Viewer confirms a sanitized report; admin sees a bounded issue inbox/reference.                                   | M; consider after I10/I14 and actual device use.                      |
| I41 | TV-approved browser companion controls | One short-lived, explicitly approved browser controller for an already unlocked TV; TV remains sole video player. | M–L; later optional work requiring a new cross-device control policy. |
| I42 | Recover recently deleted collections   | Undo/Recently deleted retains original ID/member references for an agreed grace period.                           | M; choose retention policy after I01 and the R7 delete fix.           |
| I43 | Detect externally stale channel drafts | Atomic expected-revision checks stop a stale tab overwriting another publication while preserving its draft.      | M; pair with I15, without automatic merge.                            |

### I38 — Verify an application backup without installing it

**Evidence/problem:** [restore-cli.ts](../src/restore-cli.ts) exposes restore/recover only. [recovery.ts](../src/recovery.ts), lines 111–190, has private staged integrity/migration/key checks within an eventual live restore; [operations.ts](../src/operations.ts), lines 141–171, only checks completed-bundle file/manifest presence. An operator cannot currently invoke a dedicated validator without installation before relying on a snapshot.

**Flow:** A local `db:verify -- /snapshot-directory` command stages application SQLite into private temporary scratch outside media/live data, shares actual restore validation, and reports checked schema/tool version/time plus valid/invalid/unsupported/interrupted status. Delete scratch afterward. It never installs a DB/key, creates a live restore journal/rollback, revokes sessions, contacts integrations or starts scans/encoders. CLI first; I14 may later show an exact bundle-fingerprint result separately from backup presence/age.

**Effort/design/boundaries:** M; reusable validation service, local command/result and runbook, no first-scope product screen. The operator already has local bundle access; print no keys/credentials or raw secret errors. Only temporary application DB copies are involved; media is never copied. Explicit validation uses temporary storage/time proportional to the database and cannot certify mounts, physical TV or future host recovery.

**Acceptance:** Good empty/encrypted snapshots pass; corrupt DB, missing/mismatched/malformed required keys and future schema fail clearly. Migrations affect scratch only. Compare live/backup hashes before/after; assert no lock/journal/session/media/provider/encoder change and cleanup on failure/interruption. A saved result must identify the exact bundle and validator version. This complements I14 and actual restore rehearsal; correct R7-03 separately.

### I39 — Identify recently aired programs

**Evidence/problem:** [foundation-routes.ts](../src/foundation-routes.ts), lines 492–543, accepts guide windows and returns program/time identities. [Player.tsx](../web/src/Player.tsx), lines 53–57, discards ended entries; native [MainActivity.kt](../android/app/src/main/java/tv/mytuner/app/MainActivity.kt), lines 674–692, clamps Earlier to the present. There is no explicit past-title lookup. [playback.ts](../src/playback.ts), lines 368–387, collects old unreferenced revisions, so retained history is not an indefinite archive.

**Flow:** A Recent tab initially shows up to two hours of already-retained scheduled programs for a permitted channel, one row per airing with episode/date/time and an honest partial window. Rows open read-only information. Do not generate missing history, label an airing watched, replay a past entry or create/control a session. Browser first; native may later use I21. Authoritative airing history must exclude superseded plans that never activated and paused-device-only timelines.

**Effort/design/boundaries:** M server/browser, M–L both clients. Compact date-aware list with partial/empty/unavailable states; current account/profile/PIN, channel/subscription and source grants precede titles/counts/paging. A two-hour view promises no extra retention or recording. Metadata/history may be missing or stale; longer retention needs a separate policy. It could instead be explicitly added to I21 if selected together.

**Acceptance:** Collapse mid-roll splits into one correct airing. Test midnight, pending publication, superseded revisions, partial purging and private/grant revocation. Profile changes abort old results; no hidden titles/counts survive. Opening/closing preserves existing playback/pause/focus and makes no session/control, media-fetch, encoder, scan or provider request. Distinct from I23 replay, I35 current guide search, I36 last channel and delivery statistics.

### I40 — Explicitly report a playback problem to the administrator

**Evidence/problem:** Native [MainActivity.kt](../android/app/src/main/java/tv/mytuner/app/MainActivity.kt), lines 181–199 and 1303–1340, shows local errors and records delivered intervals; browser [Player.tsx](../web/src/Player.tsx), lines 499–566, shows local recovery status. Neither offers a bounded viewer report/admin inbox. Local diagnostics I10, host status I14 and predictive readiness I30 serve different purposes.

**Flow:** From the existing overlay choose Report a problem, select Picture/Sound/Captions/Other, review the exact sanitized summary and explicitly Send. Return a reference ID. Admin gets a bounded list with acknowledge/delete. Initial payload: app version, server time, authorized current airing reference, live/paused state, delivery route and allowlisted category. No remote typing, screenshots, source files, logs or automatic telemetry/offline uploader. Choose count/age limits before implementation.

**Effort/design/boundaries:** M API/store/viewer confirmation/admin list, with keyboard/D-pad pending/offline/return-focus states. Derive references from the caller's currently authorized session; arbitrary hidden IDs and raw error strings are rejected. Only reporting account/admin may inspect the result. No tokens, PINs, cookies, integration values or absolute paths. Opening/sending does not pause/unpause, tune or start extra delivery. Offline status is honestly Not sent with explicit Retry.

**Acceptance:** Duplicate Send/retry is idempotent; Cancel issues nothing. Session ID/pause/negotiations stay unchanged. Revocation during send omits/rejects stale private context; other accounts cannot enumerate report titles/counts. Enforce size/count/age/deletion bounds and sanitizer tests. Physical remote use remains acceptance work. This adds diagnostic retention and administration; useful after actual device use reveals support needs.

### I41 — Optional browser companion controls approved on the TV

**Evidence/problem:** Browser [Player.tsx](../web/src/Player.tsx), lines 535–599, controls its own player; native [MainActivity.kt](../android/app/src/main/java/tv/mytuner/app/MainActivity.kt), lines 987–1009, uses the remote. [playback.ts](../src/playback.ts), lines 82–106, correctly binds playback to its creating authentication session. Reusing a TV session ID from a browser is not authorized by that existing contract.

**Flow:** An already paired/unlocked TV explicitly approves one same-account browser for this viewing period. A new short-lived controller lease supports Pause/Resume, Go Live, Stop and permitted subscribed-channel selection with pause-discard confirmation. Show a TV indicator/revoke action. End on expiry, app stop, profile/server change, logout/revocation or viewing-period end. No profile/PIN entry, arbitrary key injection, wake, caption menus, casting or fresh-launch auto-tune in this first scope.

**Effort/design/boundaries:** M–L; new lease/command/acknowledgement contract and native/browser approval/status/error/focus UI. Preserve session ownership; expose no TV bearer token or private URL capability. Revalidate unlock/grants/subscription and current TV generation for every command. TV overrides remain available. Browser fetches no media, creates no playback session and consumes no encoder. The physical remote remains sufficient; the app gains no required companion dependency.

**Acceptance:** No approval means no discovery/control even for another same-account browser. Exactly one controller/TV lease; second TV unaffected. Duplicate/lost/stale commands reconcile safely and cannot cross profile generations. Revocation defeats pending commands without title leaks. Disconnect is visible and does not silently stop TV. One decoder/session remains; fresh launch still selects profile/PIN. This is later optional scope after physical remote/core acceptance, distinct from I06 pairing and I21 browsing.

### I42 — Recover a recently deleted saved collection

**Evidence/problem:** [foundation-routes.ts](../src/foundation-routes.ts), lines 268–281, hard-deletes collections; [database.ts](../src/database.ts), lines 89–90, cascades member references. [library.ts](../src/library.ts), lines 249–287, cannot reconstruct a deleted ID/membership. Channel archive/restore is already reversible. I28 supplies before-delete impact, with no after-delete recovery.

**Flow:** After deletion offer Undo plus an owner/admin Recently deleted list. Retain original collection ID, name and member references for an agreed short grace period, then expire metadata only. A restored original ID lets future selectors resolve again; do not publish, rewind, revive grants/subscriptions or change materialized/paused airings. Soft-deleted collections remain absent from normal pickers/selection. An example seven-day grace period is a choice if selected, not an accepted default.

**Effort/design/boundaries:** M schema/retention plus undo/list/restore/purge states. Recheck owner/admin, profile management and source authority before exposing list/counts or restoring. Do not silently drop revoked members; block neutrally or agree a separate explicit partial restore. Missing files may retain unavailable references. No media bytes are copied. This cannot recover already hard-deleted or expired collections and never substitutes for fixing R7-01 wrong-target deletion.

**Acceptance:** Delete/reload/restart/restore preserves ID/membership and future references while existing entries remain unchanged. Test name collisions, unavailable/revoked members, foreign private counts, concurrent restore/expiry and controlled-clock expiration. Restore changes no playback or one-time checkpoint state. Choose retention/permanent-delete policy and finish I01 first if expanding scope.

### I43 — Detect a channel draft changed elsewhere

**Evidence/problem:** [foundation-routes.ts](../src/foundation-routes.ts), lines 388–402, returns `revisionId`; [Channels.tsx](../web/src/Channels.tsx), lines 432–435 and 960–975, does not use a write precondition. [contracts.ts](../src/contracts.ts) and publication have no expected revision. Current last-writer behavior can replace newer programming from another tab/admin; this is a proposed conflict policy, not a newly reproduced data-loss bug. I15 addresses local unsaved/late-response state only.

**Flow:** Capture the opened server revision, including unpublished state. Preview/publication carries it. Compare atomically before schedule mutation; when another publication won, preserve local draft and show Changed elsewhere with Reload latest/Keep reviewing. Require deliberate review against the new revision and a fresh preview before publication. No automatic merge, tab lock, presence or general undo. Channel identity/collection versioning can follow separately.

**Effort/design/boundaries:** M API/transaction/editor conflict state reusing I15/I33. A pending publication counts as changed; automatic horizon extension within the same revision does not. Check current authorization before revealing version information. Agree compatibility for older clients lacking the precondition. A report alone cannot guarantee freshness without the transaction check.

**Acceptance:** Editors open R1; first publishes R2; stale preview/publication cannot overwrite R2, mutate entries, consume checkpoint actions or claim saved. Preserve the other draft/focus. Explicit reload/review/fresh preview succeeds. Cover first publication, pending boundaries, horizon extension, reversed/lost responses and archived/revoked/private targets; preserve pause/history/source bytes. This does not add live collaboration or arbitrary historical rollback.

### Seventh-round refinements under existing IDs

- **I01/I15/I16:** Complete existing collection editing, controlled draft/picker and unapplied-commercial-input retention before multiplying management screens. Unfinished selected work is not a new proposal.
- **I07/I08/I17:** Friendly language/purpose labels, caption samples/font scaling, readable episode/behind-live/commercial timing and reveal-without-activation remain existing preferences/context/control scopes. Known R6-07 aliases remain a bug, not research.
- **I09/I18:** Channel-key repeat suppression and numeric PIN hints are refinements awaiting actual remote tests, without adding channel numbers.
- **I10/I11/I12/I14:** Actionable pending/reconnecting/last-success/help/access/mapping screens remain selected; I40 adds explicit issue delivery only, I38 adds exact non-installing validation only.
- **I13/I29:** Readable waiting/reuse/per-item failure/active-queue status belongs to existing generation/admission work. No unsupported ETA or Unraid performance promise.
- **I28/I31:** Bind impact/delete context to collection identity; filter large eligible/disabled commercial lists and support an explicit draft reset. Correct R7-01/R7-02 separately; grant-change impact remains I28 follow-up.
- **I30/I33/I34:** Show checked scope/time, readable metadata/track reasons and honest unknown/stale limits; preserve LAN copy fallback and detail-only links. No automatic probing or hardware certification.
- **I21/I35/I36/I37:** Keep playing/paused sessions unchanged while browsing; distinguish adjacency/last channel and revalidate reminders/private titles. I39's past lookup is optional additional scope.

### Other seventh-round candidates considered and disposition

| Candidate                                                                                           | Disposition and reason                                                                                                                |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Backup verify, past-title lookup, reports and companion controls across researchers                 | Combined once as I38–I41; their admin/browser presentations do not receive duplicate IDs.                                             |
| Grant-change impact; metadata/source provenance; measured device readiness                          | Existing I28 follow-up and I04/I11/I30/I34 refinements; no separate ID.                                                               |
| One-time reshuffle for non-ordered groups                                                           | Potential I03 extension, deferred until group-local random/commercial-state semantics and real demand are agreed.                     |
| Watched-history/attention tracking                                                                  | Not inferred from delivery statistics; needs explicit privacy/retention policy. I39 shows scheduled information only.                 |
| Generation presets/history/size and time estimates                                                  | I13 refinements or deferred until repeated effort/measurements justify them; no unmeasured guarantees.                                |
| Regular/off-host backups, pruning and longer history retention                                      | Existing operator policy/soak work, no authorization to change host jobs or delete application history. I38 only verifies explicitly. |
| Maintenance announcements/drain mode                                                                | Deferred: shutdown exists; multi-viewer demand and coordination policy are unmeasured.                                                |
| Full editing audit/arbitrary rollback; persistent cross-device drafts                               | Deferred beyond I43/I15; broad storage/privacy/merge/expiry policy, no generic undo of credentials/grants.                            |
| Bulk subscriptions/profile bundles/grants/remapping                                                 | Deferred until repeated household work justifies consequential multi-target preview/revalidation; I09/I11/I12 first.                  |
| Browser PIN/text entry or paused-session device handoff                                             | Deferred beyond I41; PIN stays on TV, handoff needs a separate target-unlock/retained-revision contract.                              |
| Saved-server list, richer channel description/branding                                              | Deferred until multi-server/lineup evidence; server-specific credentials/preferences must remain isolated.                            |
| Walkthrough/help legends, focused synopsis/artwork, caption language/style                          | Existing I10/I17 and I07/I08; no duplicate feature.                                                                                   |
| Favorites/saved searches/command palette, export/import templates, sleep/start-over/filter/reminder | Previously cataloged or deferred; I22/I23/I26/I35/I36/I37 and earlier alternatives retain their status.                               |
| Hardware acceleration/loudness/night mode/safe-area/fit/zoom/HDMI shortcuts                         | Existing measurement-led physical-device follow-ups; no new device claims.                                                            |
| Auto-scan/convert from readiness or details                                                         | Excluded from explicitly read-only inspection; source/encoder work stays deliberate.                                                  |
| Public sharing/cloud/voice/cast/PiP/background playback/recordings/downloads                        | Outside first-release scope or already deferred lifecycle/privacy work.                                                               |
| Global pause/watch-history-driven rotation, clock slots, source edits/deletes/moves/sidecars        | Conflicts with continuous rotation/read-only requirements or lies outside first release.                                              |

Research reports remain under `/private/tmp/mytuner-r7-research-{functional,browser,tv}.md`. They contain source analysis only, with no household study or physical/browser performance trial. Selection and implementation are separate decisions.

## Earlier suggested order

1. **I11 guided setup and I01 collection editing:** shorten the path to a useful first channel and complete an already-supported management operation.
2. **I02 commercial explanations and I10 TV diagnostics:** make scheduling outcomes and viewing failures understandable.
3. **I07 playback preferences:** reduce repeated remote-input work across episodes.
4. Select the remaining proposals from actual household use. Establish I04 metadata reconciliation policy before accepting installed Sonarr/Radarr imports; benchmark I05 before choosing a performance implementation.

Effort labels are relative: **S** is a localized change with existing services; **M** crosses contracts/state or several screens; **L** requires substantial policy/data-model work. They are not delivery dates. The owner approved implementing the selected extensions using the existing Silver Signal visual system. Unselected proposals remain optional; their scope and any material design changes need agreement before implementation. Existing hardware, accessibility, native visual-regression and Unraid acceptance gates remain in [CHECKLIST.md](CHECKLIST.md).

## Library and programming

### I01 — Edit saved collections in place

**Current evidence:** [Library.tsx](../web/src/Library.tsx) offers collection creation/selection/deletion; its editor POSTs a new collection. The authorized PUT route in [foundation-routes.ts](../src/foundation-routes.ts) and update support in [library.ts](../src/library.ts) already exist. This is the existing N27 checklist gap.

**Proposed flow:** open “Weekend mix,” choose Edit, rename or add/remove permitted items, and save against the same collection ID. Channels keep their references, future generated programming adopts the membership change, and existing airings remain stable.

**Smallest scope:** reuse the existing picker with populated name/members; add edit, empty and unavailable-member states. Define whether unavailable members are retained before implementing Save. No file operations or imported media copies.

**Effort/design:** S–M; approve a small browser edit flow. Verify stable IDs, owner/source authorization, missing members, permission changes and unchanged source files.

### I02 — Explain commercial selection and show variation

**Current evidence:** [scheduler.ts](../src/scheduler.ts) applies interacting minimum-remainder, repeat, cooldown, duration and count rules. The browser [preview](../web/src/Channels.tsx) shows resulting intervals but does not explain why a break ended early. Existing [statistics routes](../src/foundation-routes.ts) distinguish scheduled assignments from delivered milliseconds but are not surfaced in the browser.

**Proposed flow:** preview a channel and see eligible pool size, planned ad seconds, shortened clips and reasons for early return. For example, explain why a one-clip pool did not repeat even with allowance three. A per-clip exposure view can then help tune variation.

**Smallest scope:** optional scheduler diagnostics plus a preview summary; add the existing authorized statistics view afterward. Diagnostics must not consume random state or change persisted choices. Keep scheduled, started and delivered measurements distinct; do not label delivered media as a person having watched it.

**Effort/design:** M; approve preview/explanation and statistics states. Verify explanations against strict minimum boundaries and combined repeat/cooldown limits, and preserve metadata privacy.

### I03 — Explicit next-episode or group restart control

**Current evidence:** ordered groups in [scheduler.ts](../src/scheduler.ts) advance persisted cursors. [Programming contracts](../src/contracts.ts) expose selection, mode and seed, without an explicit starting episode or cursor-reset action. Normal edits correctly inherit checkpoints.

**Proposed flow:** start a show channel at season three, or explicitly restart one ordered group, without manually selecting every remaining episode. Preview the result, confirm, then activate after the current program and breaks.

**Smallest scope:** support ordered groups only with an explicit validated command. Do not interpret ordinary selection/seed changes as implicit rewinds or reset unrelated groups.

**Effort/design:** M; new checkpoint semantics and browser controls need design. Verify group independence, retained paused revisions, boundary activation, permission changes and repeatable preview/publication.

### I04 — Reconcile stale integration associations safely

**Current evidence:** [integrations.ts](../src/integrations.ts) upserts matches without reconciling associations absent from a later complete successful import. [catalog.ts](../src/catalog.ts) gives retained integration metadata priority over local metadata. Real successful-removal/reassociation behavior is already tracked under N11 and [MEDIA_DISCOVERY.md](MEDIA_DISCOVERY.md).

**Proposed flow:** an administrator reviews new matches, changed associations and associations absent from a complete successful response. Detaching obsolete imported metadata falls back to existing local metadata while the physical file remains playable.

**Smallest scope:** import-run provenance and a reviewable reconciliation report before automatic detachment. Define provider completeness/removal rules using installed Sonarr/Radarr versions first. An outage must not erase metadata or imply deletion; reassociation must not change already scheduled fingerprints silently.

**Effort/design:** M–L; provider acceptance and policy decisions precede implementation. A small admin review flow needs design. Test complete versus partial/error responses, combined episodes, reassociation and source-scoped IDs.

### I05 — Bound grouped library searches at realistic scale

**Current evidence:** after R4-10, [Library.tsx](../web/src/Library.tsx) already sends a debounced query to authorized grouped server search, including actual filenames. [library.ts](../src/library.ts) still loads and authorizes the catalog before grouped aggregation; browser pagination of rendered cards does not bound that backend work or grouped response size. Server-side filename matching is implemented and is not new scope here.

**Proposed flow:** searching one show in a large archive returns a bounded set of authorized groups, with season/episode details fetched on demand.

**Smallest scope:** first benchmark generated catalogs at representative sizes, measure server work/JSON size/browser interaction, then choose bounded aggregation, stable server pagination and detail reads if the measurements justify them. Retain permission filtering before counts and pagination.

**Effort/design:** M conditional on measurements; existing layouts can largely remain, with approved loading/search states. Verify no hidden-source counts or titles leak and pagination remains stable during refresh.

## TV and viewing

### I06 — Phone-assisted pairing

**Current evidence:** [native pairing](../android/app/src/main/java/tv/mytuner/app/MainActivity.kt) displays the server browser address, device model and ten-character approval code.

**Proposed flow:** scan a QR code on the TV, sign into the correct server on a phone, review the device and approve its prefilled public code. Keep manual code entry available. A recognizable device nickname can follow.

**Smallest scope:** QR encoding of the public approval code and browser URL plus safe browser prefill. Preserve authenticated, explicit approval; never encode private device codes or tokens, auto-approve a link, or bypass profile PINs.

**Effort/design:** S–M; QR dependency, prefill validation and pairing/approval design extension. Test expiry, wrong server, approval revocation and manual fallback.

### I07 — Remember audio and caption preferences

**Current evidence:** [native track selection](../android/app/src/main/java/tv/mytuner/app/MainActivity.kt) is per playback and resets on program changes; captions use fixed application styling.

**Proposed flow:** choose preferred audio language and caption language/style once for a device/profile, then continue through episodes with safe fallback when a track is unavailable.

**Smallest scope:** device-local preferences per profile for audio language, captions off/preferred language, and a few caption sizes/backgrounds. Match language and track properties rather than persisting file-specific stream indexes. Cross-device synchronization is a separate extension.

**Effort/design:** M; track metadata/preferences plus approved playback settings and caption examples. Test missing tracks, multi-audio files, commercial transitions, profile switching and source-time subtitle mapping. Preserve fresh-launch PIN and device-local pause semantics.

### I08 — Show episode, progress and commercial context

**Current evidence:** the [native player](../android/app/src/main/java/tv/mytuner/app/MainActivity.kt) primarily shows title/live status; the [browser player](../web/src/Player.tsx) and guide expose different amounts of context.

**Proposed flow:** a viewer opens the overlay to recognize the episode, see scheduled progress and next program, or understand when a shortened commercial returns to the show.

**Smallest scope:** episode identity, program progress, next program and a commercial countdown derived from the scheduled entry duration, including truncation. Continue joining live and preserve per-device pause/behind-live behavior.

**Effort/design:** M; descriptors/metadata/guide largely exist, but an additional authorized next-program read may be needed. Approve compact/expanded overlays and commercial states. Test paused/behind-live countdowns, interval boundaries and unavailable metadata.

### I09 — Profile-specific lineup order

**Current evidence:** the [guide](../src/foundation-routes.ts) returns channels alphabetically and native adjacent-channel navigation follows that order.

**Proposed flow:** arrange subscribed channels in a household's preferred order in the browser; TV/browser guides and previous/next channel follow the same lineup.

**Smallest scope:** explicit subscription order with accessible Move up/down controls. Favorites and guide search can follow separately. Preserve channel IDs and shared live timelines.

**Effort/design:** M; database migration, subscription contracts and both clients require changes, with approved lineup controls. Test stable order through rename/unsubscribe/archive and enforce privacy before exposing any order/count.

### I10 — Actionable TV connection and playback diagnostics

**Current evidence:** [MainActivity.kt](../android/app/src/main/java/tv/mytuner/app/MainActivity.kt) validates health service identity but presents general errors; a 401 returns immediately to pairing. Limited context distinguishes unreachable server, expired authorization, unavailable media and decoder failure.

**Proposed flow:** open connection details/help to see the saved server, compatibility, last successful reachability and a safe error category with the right recovery action. Explain why pairing must be repeated.

**Smallest scope:** structured error categories and explicit API compatibility metadata, with compact help/recovery states. Keep tokens, source paths and integration details off the viewer surface. Continue supporting manual server addresses; router/VLAN changes remain separate work.

**Effort/design:** M; server/client contract and approved error/help layouts. Test offline server, token expiry, source outage, unsupported media and successful recovery without restarting setup unnecessarily.

## Setup and operations

### I11 — Guided setup after administrator bootstrap

**Current evidence:** [Management.tsx](../web/src/Management.tsx) contains static setup guidance, JSON scan results and text mapping entry. The dependency sequence lives in [OPERATIONS.md](OPERATIONS.md).

**Proposed flow:** follow an authenticated checklist from profile → source → successful scan → grants → channel preview/publication → subscription → TV pairing. A read-only mapping check shows a few upstream paths, mapped container paths and matched catalog entries.

**Smallest scope:** link existing forms from status-based setup steps and provide bounded admin-only mapping validation. Explain absent mounts, read permission errors and unmatched mappings in ordinary language. Retain local administrator bootstrap; no public registration, write probes beside originals or automated network changes.

**Effort/design:** M; status aggregation and mapping-check API plus approved first-run, incomplete and repair states. Test empty installs, optional integrations, custom directories and already-configured installations.

### I12 — Explain effective profile access

**Current evidence:** [profile management](../web/src/Management.tsx) separates memberships, management rights and source/subtree grants without summarizing how roles, ownership, PIN and channel privacy combine.

**Proposed flow:** an administrator selects a profile and sees who can watch/manage, allowed sources/subtrees, PIN requirement and subscription readiness, including explanations for an empty library or inaccessible channel.

**Smallest scope:** admin-only effective-access summary derived from existing server policy. Evaluate the target account's actual policy rather than accidentally inheriting the inspecting administrator's exception. Do not impersonate credentials or disclose private channels to ordinary users.

**Effort/design:** M; policy-summary API and approved access/readiness states. Verify owner/member/viewer/editor/admin combinations, removed grants, room profiles and PIN state.

### I13 — Generation preflight and readable progress

**Current evidence:** [generation UI](../web/src/Management.tsx) confirms file/output counts and identifies progress by UUID. [Generation preview](../src/server.ts) already exposes durations; [storage budgeting](../src/storage.ts) exists internally.

**Proposed flow:** before converting a directory, review reusable versus new outputs, total source duration and generated-storage headroom. During work, see human-readable titles/relative paths and understandable per-item failures.

**Smallest scope:** bounded fingerprint/reuse/storage summaries and authorized item titles in job responses. Provide measured size ranges only if reliable; do not promise exact ETAs. Generation remains explicit and cleanup remains confined to managed derivatives.

**Effort/design:** M; small response additions and approved preflight/progress/error layouts. Test stale fingerprints, cancellation/retry, limited disk, reused output and permission changes.

### I14 — Admin health and backup visibility

**Current evidence:** [health](../src/server.ts) checks database connectivity; operational readiness also depends on mounts, refresh age, queues, schedule coverage, disk and backup age. The browser loads source success timestamps but shows limited status. Full application backups use [backup-cli.ts](../src/backup-cli.ts).

**Proposed flow:** an administrator checks a dashboard for last successful refresh, failed jobs, schedule readiness, storage pressure and latest completed backup, with links to the appropriate runbook.

**Smallest scope:** read-only sanitized status and bounded/cached filesystem checks. A later explicitly selected action may trigger a server-side backup. Keep restore offline and avoid exposing integration keys or credential-bearing downloadable bundles through general diagnostics. Retention/off-host backup requires a separate operator decision.

**Effort/design:** M; admin status API and approved healthy/degraded/unknown states. Test missing/unreachable roots, stale refreshes, no backup, storage pressure and bounded dashboard work.

## Latest research: fourth review round

Three fresh researchers covered browser UX, the TV viewing journey and functional additions. The parent also inspected the rendered synthetic demo at 1440 pixels on the library, channels and sources screens. No product code, Figma design, source media or demo configuration changed. These are evidence-based proposals, not new commitments or claims of user/physical-device research.

### Recommended shortlist

| Order | Proposal                                | Reason to prioritize                                                                | Smallest useful scope                                                                                        |
| ----- | --------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1     | **I11 guided setup**                    | The most direct path from Unraid shares to a first playable channel                 | A status-based checklist linking existing forms; readable scan results; bounded admin-only mapping preflight |
| 2     | **I15 programming draft clarity**       | Different content/commercial apply behavior makes it hard to know what will publish | Explicit draft/preview/published states, preserved commercial inputs and discard protection                  |
| 3     | **I17 TV overlay behavior**             | Controls remain over the picture until the viewer discovers Back                    | Predictable dismissal/reveal with pause, error and accessibility exceptions                                  |
| 4     | **I01 collection editing**              | Completes an existing API-backed management operation                               | Edit the existing collection ID and review selections across pages                                           |
| 5     | **I02 commercial/preview explanations** | Makes cutoff, early return and variation rules understandable                       | Clear interval details and preview-only reasons before an exposure dashboard                                 |

The shortlist is a recommended order, not severity. I07 preferences, I08 episode context and I10 actionable recovery remain the next TV candidates. I16 content selection becomes more valuable as the catalog grows. I18 numeric PIN input, I19 programming duplication and I20 episode exclusions are optional bounded additions. All new product UI states need an approved design extension; none is automatically included in the release.

### Refinements to existing proposals

- **I01:** include a Selected-items view across collection search/pages. The current editor maintains a cross-page selection count but only renders the current search/page ([Library.tsx](../web/src/Library.tsx), lines 503–538). Define missing/inaccessible-member retention before saving; reuse the existing PUT route and stable collection ID.
- **I02:** begin with readable Program/Commercial labels, interval duration, episode/source context, cutoff badges and midnight date boundaries. The current [schedule preview](../web/src/Channels.tsx), lines 880–893, shows clock times/title/kind and only the first 100 rows. Add explanations without consuming scheduler random state. Verify 6000/6001-ms boundaries and the 12-second clip shortened to ten seconds.
- **I07/I08:** prioritize persistent language-based preferences and episode identity alongside the overlay work. Native [track resets](../android/app/src/main/java/tv/mytuner/app/MainActivity.kt), lines 888–890 and 1207–1210, require repeat choices; lines 1144–1147 prefer only the series title. Match track properties rather than stream indexes, and label live-next separately from a paused session's next.
- **I10:** a small first step is pending/recovery feedback while retaining remote focus. [Native control guards](../android/app/src/main/java/tv/mytuner/app/MainActivity.kt), lines 1050–1099, correctly block duplicate commands, but the old Pause/LIVE label remains while the request reconciles. Show an accessible updating/reconnecting state; preserve authoritative pause and the existing recovery tests.
- **I11:** start with status links and readable scan counts, then mapping preflight. [Setup](../web/src/Management.tsx), line 1150, is static prose; scans at line 526 display JSON and mappings at line 592 use text input. Status must distinguish an absent mount, failed scan, empty grant and unpublished/unsubscribed channel. Sonarr/Radarr remain optional and read-only; network changes stay separate.

### I15 — Make programming draft and publication states clear

**Evidence:** [Channels.tsx](../web/src/Channels.tsx), lines 419, 426, 601–625 and 819–866: content changes update the draft immediately, commercial inputs apply through a separate form submission, and preview/publication are separate actions. Closing calls the modal handler directly. Corrected R3-07 already protects against stale successful publication responses; this proposal addresses comprehensibility and accidental local draft loss.

**Smallest scope:** show Unsaved draft / Preview current / Published with effective time; preserve unsubmitted commercial inputs across tabs or explicitly explain their discard. Confirm discarding changed programming on close/navigation. Start without server-persisted drafts.

**Effort/design:** S–M; approved state/copy/discard-dialog extension. Closing an untouched editor stays immediate; changed content and unapplied commercial inputs cannot silently disappear. A current preview remains required for the exact submitted draft, and late responses cannot label another draft saved.

### I16 — Search and group the programming content picker

**Evidence:** [Library.tsx](../web/src/Library.tsx), lines 55–71, creates whole-show and season options; every content group in [Channels.tsx](../web/src/Channels.tsx), lines 492–524, renders the entire list in one native select.

**Smallest scope:** a searchable picker grouped by source/type with show-to-season drill-down and clear retained Saved-selection labels. Keep the small-library select if useful. This is selection UX; I05 separately measures backend search/response scaling.

**Effort/design:** M; approved picker, keyboard, narrow-screen and empty/loading states. Verify a large synthetic catalog, same-named shows in different sources, keyboard selection, saved references and privacy. No hidden titles/counts may appear.

### I17 — Keep the TV picture clear with predictable controls

**Evidence:** [MainActivity.kt](../android/app/src/main/java/tv/mytuner/app/MainActivity.kt), lines 924–927 and 958–1003, creates visible playback controls and hides only the first-frame error. Back at lines 1392–1397 dismisses the overlay; there is no inactivity dismissal.

**Smallest scope:** dismiss controls after first playback and a short inactivity period, reveal on D-pad/OK and restore meaningful focus. Keep controls visible during pause, errors and track menus. A revealing key must not also activate a command. Respect assistive-technology needs before enabling timed dismissal.

**Effort/design:** S–M; approve watching/expanded-control states and a remote hint. Verify initial join, pause/recovery, track dialogs, repeated keys, stable focus, Back hierarchy and accessibility behavior. Physical remote trials remain required later.

### I18 — Accept PIN digits from remotes that provide them

**Evidence:** [MainActivity.kt](../android/app/src/main/java/tv/mytuner/app/MainActivity.kt), lines 592–652, only edits the PIN through keypad callbacks; key dispatch at lines 1359–1388 handles the player. Bravia remotes with digits gain no shortcut; Fire remotes still need the keypad.

**Smallest scope:** numeric, Delete and explicit Enter key events share the same validated PIN state/submission logic on the PIN screen. Keep the keypad. Do not auto-submit at four digits because valid PINs have four through eight digits.

**Effort/design:** S; minor approved hint/input extension. Verify top-row/numpad events, repeats, length bounds, deletion, wrong PIN, duplicate submission and profile/screen changes. No PIN enters logs or survives a screen change.

### I19 — Duplicate programming into a new unpublished channel draft

**Evidence:** [Channel creation](../web/src/Channels.tsx), line 306, starts from name/profile/visibility; the [authorized programming GET](../src/foundation-routes.ts), line 242, already provides configuration.

**Smallest scope:** Create from this channel opens the existing editor with copied selector/rule references, a required new name/profile and private default. Require fresh preview/publication. Create an independent channel UUID and timeline; do not copy subscriptions, history, rotation cursor or source files. Cancelling must not leave a published lineup entry.

**Effort/design:** S–M; existing endpoints can support the first scope without a migration. Approve source/copy confirmation and independent-timeline explanation. Revalidate every selector against the target profile and preserve private-channel visibility rules. The original channel remains unchanged.

### I20 — Exclude episodes while retaining dynamic selection

**Evidence:** [selection contracts](../src/contracts.ts), lines 33–61, allow positive show/folder/media/collection selectors; [programming resolution](../src/programming.ts), line 61, re-resolves dynamic groups. There is no per-group exclusion list.

**Smallest scope:** a bounded list of excluded media IDs on a group lets someone omit an episode without manually maintaining all other episodes. Newly discovered episodes still join future batches. Preserve current/materialized intervals and paused revisions.

**Effort/design:** M; programming contract/filtering and an approved exclusion/count/reset flow. Assess contract compatibility even if the current JSON storage needs no new table. Verify all-excluded groups, later scans, removed files, specials, revoked grants and cursor advancement without unintended rewind. Originals remain unchanged.

## Latest research: fifth review round

Three fresh researchers inspected browser workflows, TV/remote viewing and functional scheduling opportunities. The browser researcher used the disposable demo in isolated Chromium at 1440 and 390 pixels; other recommendations come from inspected source. The parent checked the relevant native lifecycle, contracts and scheduler paths. This is synthetic/source research, not physical-device testing or a household usability study. The seven new suggestions below are distinct from the existing twenty; refinements retain their original IDs. No product feature, Figma frame or visual baseline was changed.

### Current shortlist: fifth round

This is the recommended product order, independent of bug severity. It favors finishing useful existing flows before adding larger capabilities. Every new UI state needs a focused design extension and approval before implementation.

| Order | Suggestion                                             | Concrete benefit                                                                                                          | Effort                           |
| ----- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 1     | **I15 clear drafts and publishing**                    | Distinguish immediately saved channel details, applied commercial inputs and published programming; protect unsaved work. | S–M                              |
| 2     | **I11 guided setup**, with I12/I14 readiness           | Explain the next missing step from a scanned source to a channel this profile can watch.                                  | M                                |
| 3     | **I17 unobstructed TV viewing**                        | Dismiss controls predictably while watching; reveal them without accidentally pausing or tuning.                          | S–M                              |
| 4     | **I01 edit saved collections**                         | Rename/add/remove references in the same collection without breaking channel links.                                       | S–M                              |
| 5     | **I07 remembered language/captions**                   | Keep this profile's audio/caption choices across episodes on this TV.                                                     | M                                |
| 6     | **I25 per-group mid-roll choice — new**                | Keep a movie uninterrupted while episodes on the same channel retain mid-rolls.                                           | S–M                              |
| 7     | **I24 consecutive episodes per turn — new**            | Play A1, A2, B1, A3, A4, B2 with one continuing cursor per show.                                                          | M                                |
| 8     | **I02 readable commercial previews**, with I08 context | Show exact interval duration, cutoff, dates and why a break returned early.                                               | S for display; M for diagnostics |

I08 episode/behind-live context is a useful small TV companion to I17. I21 in-player browsing and I23 start-over offer larger viewing gains with more session-state work. I22 sleep timer, I26 duration filters and I27 browser profile memory depend on actual household habits; they remain optional.

### Refined existing proposals

- **I15:** the editor mixes three distinct behaviors. Channel identity PATCHes immediately; commercial form inputs update programming only on Apply; Preview and Publish are separate. The browser researcher changed a break field to 77 without Apply, switched tabs and observed it return to 0. Preserve unapplied fields, explain what already saved, and guard only closes that would lose work. Keep the repaired exact-draft publication safeguards.
- **I01:** add a Selected view across collection search/pages, then save to the same ID using the existing PUT. Decide unavailable/inaccessible-member retention first; never drop unseen selections silently.
- **I11/I12/I14:** begin with contextual next-step status, rather than a large new dashboard. The current channel preview offers Add to profile guide even when already subscribed and combines publication/subscription into one empty-state instruction. Derive unpublished, unsubscribed, ready and unknown states from authorized evidence. Administrator diagnostics must evaluate the target account's rights, not inherit the administrator exception; a report must not scan, publish, mutate grants or start encoding.
- **I17:** specify watching/expanded/paused/error/pending/menu states, reveal-key consumption and focus restoration. Native first-frame status hides, but the full controls stay until Back. Start with native behavior; browser fullscreen can follow. Suspend timed dismissal for relevant accessibility needs and preserve caption clearance.
- **I07:** first persist semantic audio/caption language choices per server/profile/device, not stream indexes. Reordered indexes across episodes, missing languages, commercials, profile changes and existing stale-caption guards must all work. Broad styling and cross-device sync can wait.
- **I08:** begin with series plus episode/SxxExx and readable behind-live time. Native currently favors series title and raw lag seconds. Distinguish a paused session's next item from the live guide; countdowns use persisted scheduled duration, including shortened commercials.
- **I02:** make display precise before adding a dashboard: interval duration, readable type, dates at midnight, seconds when necessary, actual preview horizon and an explicit 100-row truncation notice. Ten delivered commercial seconds must display ten, even when the original is twelve. Diagnostics must not consume randomness.
- **I05:** filename search is now server-backed. Remaining work is measured aggregation/pagination scale, not reimplementing that search.

### I21 — Browse channels while keeping the current session

**Evidence:** native [MainActivity.kt](../android/app/src/main/java/tv/mytuner/app/MainActivity.kt), lines 247–274 and 986, deliberately leaves playback when opening the full guide; rejoining creates a fresh live session at lines 1011–1024. Browser player teardown similarly deletes its session. Existing leave/reopen behavior is intentional; this is a new viewing option.

**Smallest flow:** add an in-player Browse channels panel with the current profile's subscribed now/next lineup. Moving focus changes only information; Back returns to the same session and paused position. Explicit Watch live tunes a different channel and abandons the old pause, with approved behind-live wording. Keep the full guide's existing leave semantics. No second video or automatic tune on focus.

**Effort/design:** M–L; approve panel, focus, tune action, pause warning and Back hierarchy. The current native screen transition clears player callbacks, so preserving polling and control reconciliation needs deliberate work.

**Acceptance:** browse ten channels and dismiss with unchanged session ID and zero DELETE/POST/control calls; video continues or remains intentionally paused. Tune sends one switch, joins live and revalidates grants. Profile change clears every old private title/image; revoked or archived entries cannot tune from stale data.

### I22 — Device-only sleep timer

**Evidence:** native [MainActivity.kt](../android/app/src/main/java/tv/mytuner/app/MainActivity.kt), lines 220–267, keeps the screen on and already releases playback/session on stop, but has no timer.

**Smallest flow:** Off/15/30/60 minutes in playback, an armed indicator and final Keep watching/Cancel warning. Expiry stops this device, releases delivery, clears private program UI, returns to the profile route and permits normal platform dimming by releasing the keep-screen flag. Pairing stays. It does not promise television power-off. Use monotonic time; switching profiles/relaunch cancels the timer; define whether channel switches retain it (recommended within the same viewing period).

**Effort/design:** S–M; approve picker, warning and stopped state, including paused expiry. Exact-model sleep/wake behavior needs physical testing.

**Acceptance:** injected-clock expiry stops local resources/polls once even when session DELETE fails offline. Another device on the same profile keeps playing. Cancel prevents expiry and cold launch restores no timer or protected playback. No viewer-attention inference or media copies.

### I23 — Start the displayed airing over

**Evidence:** [playback.ts](../src/playback.ts), lines 45–80 and 171–214, joins live and supports pause/resume/Go Live only. Sessions already retain a revision and local clock; schedule segments share a program ID. This is distinct from I03's editor-controlled group restart.

**Smallest flow:** while displaying a program, Start episode over moves only that session to the earliest program segment of the displayed airing in its retained revision. It follows the same persisted commercial choices and stays behind live. Initially omit the action during commercials to avoid ambiguous ownership. Missing/replaced originals or inaccessible retained material make the action unavailable. No arbitrary seek, earlier-airing archive, recording or copied media.

**Effort/design:** M–L; new bounded clock action, authorization/fingerprint checks and both clients' control/delivery/caption recovery. Approve start-over, disabled and behind-live states with Go Live visible.

**Acceptance:** starting over five minutes into an airing affects one of two sessions only, replays the same scheduled breaks and preserves old revisions across publication. Go Live returns to the actual current timeline; missing originals or revoked access never serve replacement/unauthorized bytes. Verify direct/HLS and both clients.

### I24 — Two or three episodes per group turn

**Evidence:** groups in [contracts.ts](../src/contracts.ts), lines 67–76, have one selection/mode; [scheduler.ts](../src/scheduler.ts), lines 300–304, advances the group after each clip. Repeating the show as separate groups creates separate cursors/bags.

**Smallest flow:** Episodes per turn: 1/2/3. A=2 and B=1 yields A1, A2, B1, A3, A4, B2. Omitted defaults to one; ordered/shuffle/random semantics remain per group. Keep remaining-turn progress across generation chunks/restart. Edits still activate after the current program and breaks, not after an unexpectedly extended block.

**Effort/design:** M; contract/state compatibility, scheduler checkpoints and a small approved group control/preview explanation. No clock slots or unrestricted weights.

**Acceptance:** the example sequence survives chunk boundaries, restart and matching preview/publication. Existing configs preserve seeded choices/timing. Group removal/reordering/temporary empty selection does not rewind unrelated shows; one-episode libraries retain their existing repeat semantics.

### I25 — Per-group mid-roll opt-out

**Evidence:** [contracts.ts](../src/contracts.ts), lines 79–80, supplies one channel-wide pool/rules object; [scheduler.ts](../src/scheduler.ts), lines 305–337, applies its break positions to every selected clip.

**Smallest flow:** Mid-roll: Follow channel / Off on a group. Movies can stay uninterrupted while sitcoms on the same channel retain mid-rolls. Between-program commercials keep the channel setting. Keep the same pool, repeat ledger, cooldown, caps and cutoff mode; arbitrary per-group rules/pools can wait. Missing value follows channel.

**Effort/design:** S–M; one optional setting, scheduler policy and approved explanatory copy. Explicitly state that turning off mid-rolls leaves between-program ads unchanged.

**Acceptance:** a synthetic episode has its configured mid-roll and an opted-out movie has none; both retain between-program breaks. Defaults preserve existing seeded output. Preview/publication agree at the same boundary/state, chosen ads persist once, and cutoff/repeat/cooldown tests remain valid. Private-channel commercial defaults remain off.

### I26 — Duration-filtered dynamic programming

**Evidence:** [contracts.ts](../src/contracts.ts), lines 33–61, supports fixed IDs and dynamic folder/show/collection selectors without duration predicates. [catalog.ts](../src/catalog.ts) measures duration, and [programming.ts](../src/programming.ts) re-resolves future group membership.

**Smallest flow:** optional minimum/maximum duration on an existing dynamic group, with eligible count and a few authorized examples. A Shorts channel can select a mixed folder while excluding files longer than 30 minutes. A later successful scan adds newly qualifying items to future batches. No general query language, inferred genre/rating policy or source reorganization.

**Effort/design:** M; contract/filtering/cursor behavior plus approved range, dynamic-membership and all-filtered states.

**Acceptance:** 10 and exactly 30 minutes qualify under a 30-minute maximum; 31 does not. A new 20-minute file qualifies after scan/future resolution. Existing materialized airings and paused revisions stay stable. Invalid ranges fail clearly and counts/examples are computed after source/profile authorization.

### I27 — Remember the browser's selected profile

**Evidence:** [App.tsx](../web/src/App.tsx), lines 30 and 78–79, keeps selection only in memory, then chooses the first permitted profile after reload. The researcher selected Other Profile and confirmed reload returned to Living Room.

**Smallest flow:** remember only the last profile ID for this signed-in account in this browser session, restoring it only after the authorized profile list arrives. Missing/revoked IDs fall back safely. Never auto-tune or restore a playback session. Define sign-out/account-switch behavior explicitly.

**Effort/design:** S; approve refresh/unlock behavior and a shared-browser policy. No PINs, names, library results, paths or credentials in preference storage.

**Acceptance:** reload keeps the permitted second profile; revoked membership gives a safe fallback; another account inherits no selection; a locked restored profile still requires its PIN. No behind-live playback resumes from remembered profile state.

## Latest research: sixth review round

Three new independent researchers covered functional additions, browser/setup/admin UX and TV/viewing UX after the fifth-round corrections and selected service foundations. They inspected actual source and all 27 earlier proposals. This is source-based product research, not physical-device trials, observed household performance or external user research. The owner subsequently selected I28/I29/I30/I31/I33/I34; their implementation and verification are recorded in SELECTED_IMPROVEMENTS.md. I32/I35/I36/I37 remain optional. The owner approved the existing twenty extensions using Silver Signal; that approval does not automatically select these ten new ideas.

Finish selected UI integration and chosen correctness fixes first. Among additional work, I28 prevents configuration surprises, I30 supports physical-TV preparation, I34 helps understand custom files, and I35/I36 reduce remote navigation. I29 should follow measured contention; I31 depends on commercial-pool needs; I37 is lower priority and depends on an established in-player panel.

### I28 — Show configuration dependencies before deletion

**Use case/evidence:** Before deleting a collection or narrowing grants, see which permitted channels depend on it. [Collection deletion](../src/foundation-routes.ts), lines 185–198, currently has no dependency response; recurring selectors live in [contracts.ts](../src/contracts.ts), lines 33–61. I12 explains present access, while this proposal explains a proposed change's consequences.

**Smallest flow:** Start with a bounded read-only Where used panel for an owned/admin-readable collection and its delete confirmation. Separate recurring-selector use from retained/materialized airings. Explain that existing airings remain while future generation may fail if no other group can play. Add grant-change impact later using the same policy evaluator. No cascade deletion, automatic repair or file operations.

**Effort/design:** M; dependency panel, count/pagination, confirmation and stale/unknown states. JSON-selector inspection may need measurement before a normalized dependency index. A preview is advisory, not a transactional guarantee.

**Acceptance:** Two owned dependent channels appear; unrelated channels do not. Another owner's private channel contributes neither title nor count for an editor; admin retains the cross-owner exception. Inspection/cancel changes nothing. Authorized deletion preserves retained paused revisions and source bytes; large results are bounded.

### I29 — Prioritize playback over optional generation

**Use case/evidence:** Directory conversion should wait for interactive playback capacity on a busy Unraid host. [generation.ts](../src/generation.ts), lines 179–191 and329–350, [streaming.ts](../src/streaming.ts), lines 289–316, and [subtitles.ts](../src/subtitles.ts), lines 84–93, have independent worker limits. No actual stutter or resource saturation was measured in this review.

**Smallest flow:** Share encoder admission with a configurable overall budget and reserved interactive allowance. Admit playback/subtitle work before the next optional generation task, initially allowing a running background task to finish. Show Waiting for playback capacity instead of Failed. Preserve work sharing, cancellation and shutdown draining; do not add hardware acceleration or automatic conversion.

**Effort/design:** M–L; service/lifecycle coordination plus a waiting state in existing generation UI. Process counts are not a CPU or latency guarantee; choose defaults from representative Unraid measurements and define fairness so background work eventually resumes.

**Acceptance:** Gated executors prove the budget is respected, direct playback consumes no encoder slot, matching segment work still shares conversion, unauthorized requests reserve no capacity, and queued generation resumes safely. Cancellation/shutdown drain waiting/running work without modifying originals.

### I30 — Predict playback routing before tuning a TV

**Use case/evidence:** An admin wants to know which channel files are predicted to play directly, require HLS, lack deliverable text captions or have unknown technical metadata. [catalog.ts](../src/catalog.ts), lines 109–170, stores ffprobe data; [streaming.ts](../src/streaming.ts), lines 118–177, currently decides delivery while negotiating an active session. This complements I10 recovery and I13 generated-output preflight.

**Smallest flow:** Admin-only bounded report for a source/channel selection against declared target capabilities. Share a pure decision with actual negotiation. Show predicted routing/reasons and permitted examples, including shortened-commercial routing. Read stored metadata; opening the report starts no scan, ffprobe, encoder, generation or playback session. Label unknown/stale data and target-preset assumptions.

**Effort/design:** M; compact report using setup/preflight patterns. It predicts routing and known caption limits; codec declarations omit bitrate/profile/HDR/firmware limits and cannot certify a particular Bravia/Fire model.

**Acceptance:** H.264/AAC MP4, unsupported codecs, silent files, missing metadata, text/image subtitles and shortened commercials agree with runtime routing. Filter private sources/channels before counts/examples. Requests create zero sessions/jobs/encoders and preserve source bytes. Physical-device acceptance stays separate.

### I31 — Retire and re-enable individual commercials

**Use case/evidence:** Exclude an obsolete or holiday advertisement while leaving its file in the read-only pool directory. [programming.ts](../src/programming.ts), lines 74–87, resolves all available selected ads; [scheduler.ts](../src/scheduler.ts), lines 308–335, has repeat/cooldown/duration rules but no per-channel retired state. I20 covers program exclusions and I25 program mid-roll policy.

**Smallest flow:** Channel-local disabled commercial IDs and an eligible-count summary. Apply through ordinary preview/publication boundaries; preserve existing airings and paused revisions. Re-enable using the same media ID. All-disabled pools explain early return and resume the show. Defer date windows, source-global changes and emergency immediate blackout policy.

**Effort/design:** M; pool item state, count and effective-time explanation. Already materialized ads can remain until a deliberate change takes effect; make this explicit. Future dates would need eligibility against each scheduled interval's time, not simply now.

**Acceptance:** In a two-ad pool, disabling one removes it from future matching preview/publication while preserving repeat/cooldown/cutoff/minimum semantics. Re-enable restores eligibility. Hidden ads cannot be enumerated; no source path/byte change or new media ID; no dead air or relaxed limits when the pool empties.

### I32 — Change your own account password

**Use case/evidence:** An admin-created household member should be able to choose a password without asking the admin to know it. [Management.tsx](../web/src/Management.tsx), lines 117–145, offers admin reset only; [identity.ts](../src/identity.ts), lines 107–126, requires admin authority. This is optional self-service, not a defect in the current admin-created account policy.

**Smallest flow:** Browser My account → Change password with current password, new password and confirmation. Derive the target from the authenticated account, reject paired-device credentials, verify current password and recheck credentials/authority after awaited crypto. Reuse password/CSRF policy. Warn that success signs the account out everywhere and requires TV re-pairing, preserving existing revocation policy. No signup, email recovery or profile-PIN changes.

**Effort/design:** M; password-manager-friendly form with pending, wrong-password and all-devices sign-out states. New credential-handling code needs concurrency regressions; keeping the current session would be a separate policy change.

**Acceptance:** Viewer/editor/admin can change only their own password after correct reauthentication. Wrong credentials change nothing; concurrent reset/disable/revocation defeats pending changes. Success revokes sessions/pending and approved pairings; new login uses the new password. Secrets are never logged, encoded in links or retained in UI. Verify keyboard/narrow-screen focus and errors.

### I33 — Stable links to channel and collection details

**Use case/evidence:** Bookmark a channel, return to it from a dependency/status report or intentionally share its location with an authorized admin. [pairing-link.ts](../web/src/pairing-link.ts), lines 1–11, parses top-level routes/pairing prefill only; channel/collection selections live in [Channels.tsx](../web/src/Channels.tsx), lines 46–54, and [Library.tsx](../web/src/Library.tsx), lines 128–148.

**Smallest flow:** Same-server fragment links with stable profile/resource IDs, Copy link and contextual Open actions. Restore authorized read-only details after login/profile resolution/unlock; support Back/Forward. Opening a link never edits, tunes or publishes. Reuse I15 protection if the current editor is dirty. No tokens, PINs, titles, paths, drafts or cross-server redirect in the link.

**Effort/design:** S–M; route parsing plus sign-in/locked/unavailable continuation and focus/copy feedback. Distinct from I27's remembered profile preference; a locator conveys no permission.

**Acceptance:** Reload/Back/Forward resolve the intended permitted resource. Signed-out continuation retains only safe IDs; locked profiles still require PIN. Deleted/archived/foreign-private/revoked resources yield neutral unavailable states with no hidden metadata/counts. Profile changes reconcile navigation safely; copy and detail focus work on keyboard/narrow layouts without auto-play or mutation.

### I34 — Inspect a video's metadata and tracks

**Use case/evidence:** Understand a custom file's grouping, relative filename, precise duration and audio/subtitle options before scheduling. [Library.tsx](../web/src/Library.tsx), lines 383–414, shows checkbox/title/rounded length; [foundation-routes.ts](../src/foundation-routes.ts), lines 58–70, already returns permitted source-relative path and metadata; [catalog.ts](../src/catalog.ts), lines 109–121 and158–171, stores technical tracks.

**Smallest flow:** A read-only Details panel with show/season/episode or movie/year, permitted source name/relative filename, exact duration and friendly track summaries. Keep technical fields secondary and label last-scanned/unknown data. Use authorized stored responses; no source-byte reads on opening. Exclude metadata editing, online matching, rescan, force-transcode and full provenance; link future provenance to I04.

**Effort/design:** S–M; responsive content summary with optional technical section and safe relative-filename copy. Complements I16 selection and I30 prospective routing; neither replaces this item-inspection flow.

**Acceptance:** Known/missing metadata, multiple languages and image/text subtitles render accurately without support guarantees. Never show host absolute paths to ordinary viewers. Revocation/profile change clears details and rejects late responses. Focus returns to the row; filenames fit narrow screens. Opening/closing creates no scans/jobs/sessions/derivatives and does not change selections/drafts/source bytes.

### I35 — Find a channel or current/next title in the guide

**Use case/evidence:** Find a channel in a thirty-channel lineup without traversing every row. Native [MainActivity.kt](../android/app/src/main/java/tv/mytuner/app/MainActivity.kt), lines 670–704 and719–752, renders guide rows without a query; browser [Player.tsx](../web/src/Player.tsx), lines 51–86, likewise lists returned channels. [The guide API](../src/foundation-routes.ts), lines 409–478, already filters authorized subscriptions and orders them.

**Smallest flow:** Optional Find field filtering loaded channel names, short names and visible current/next titles, preserving relative lineup order. Include match count, Clear and an honest displayed-window hint. Start with OS keyboard/D-pad; no voice, external/library search or favorites store. Extend into I21's panel after that selected feature is connected. Search never tunes.

**Effort/design:** S–M, or M across both clients/panels; search/empty/focus states. Keyboard Back dismisses keyboard before clearing/exiting; restore stable channel focus. Loaded guide search is not an archive-wide episode search.

**Acceptance:** Synthetic30-channel name/short-name/title queries yield only permitted matches in saved order. Refresh preserves query and still-present focus; revocation removes titles/counts. Profile change clears query/results. Filtering/Back does not create/delete/control playback or disturb pause; only explicit Watch live tunes. Verify long labels and eventual physical-device text entry.

### I36 — Return to the last successfully tuned channel

**Use case/evidence:** Alternate between distant lineup channels. Native [MainActivity.kt](../android/app/src/main/java/tv/mytuner/app/MainActivity.kt), lines 1007–1009 and1059–1063, uses Previous/Next for adjacent lineup rows and retains no last successful target.

**Smallest flow:** An explicit Last channel action retains one previous successful channel ID in memory per server/profile/active viewing period. A→B→Last→Last toggles A/B, always joining live with one session/decoder. Failed joins do not overwrite the last good target. Clear on profile/server change/app stop; no old buffer, paused position or fresh-launch auto-tune. Reuse I21 pause-discard confirmation. Physical remote shortcuts can follow exact-model tests.

**Effort/design:** S–M; localized tune history, disabled/pending/unavailable states and secondary action placement. Distinguish Last channel from lineup Previous; avoid crowding the player before I08/I21 layouts are connected.

**Acceptance:** Successful toggling creates one active session; repeated pending activation yields one request. Failed joins retain history. Archive/unsubscribe/revocation is checked before showing/tuning stale targets; server authority remains decisive. Back cancels without affecting current pause/focus. No cross-profile/server/launch target disclosure or other-device/schedule/source changes.

### I37 — One reminder for an upcoming program on this device

**Use case/evidence:** Browse ahead, keep watching elsewhere and receive an invitation when a particular airing starts. Native [MainActivity.kt](../android/app/src/main/java/tv/mytuner/app/MainActivity.kt), lines 689–694 and779–787, browses later but OK still tunes live. [Guide entries](../src/foundation-routes.ts), lines 448–464, contain stable program/time fields; app-stop cleanup exists at MainActivity lines 235–240.

**Smallest flow:** One in-memory reminder while this app/profile remains active. At start time revalidate the specific authorized program/channel/time, then show Starting now with Watch live/Dismiss. Never auto-switch or unpause. Profile/server change/app stop cancels, with explicit wording. No persistent/background alarms, system notifications, recording, export or cross-device service. I21 is a useful prerequisite.

**Effort/design:** M, lower priority; armed/replaced/cancelled/changed-airing/prompt states and nested remote focus. App-active scope cannot promise delivery after Android/Fire suspends the app.

**Acceptance:** Arming changes no current session. Controlled time triggers only after fresh authorization/program revalidation, without stealing an active dialog's focus. Watch live joins once; Dismiss/Back preserves paused/playing state. Edited-away/revoked/unsubscribed/unavailable airings cancel without title leakage or retargeting a same-named program. Stop clears timers/state; relaunch keeps normal profile/PIN and no reminder. Waiting creates no second encoder/media copy.

### Refinements retained under existing IDs

- **I01/I02/I15/I16:** Keep selection across search, draft/preview/effective-state clarity, readable dates/durations and commercial explanations in the existing selected scope. A preview diff is a refinement of I15, not another feature.
- **I05/I16:** Bounded JSON does not imply bounded backend aggregation. Retain the documented synthetic 50k memory/performance limits and use real-catalog/concurrency measurements before choosing indexes/pagination.
- **I06:** Recognizable device names/revoke targets belong to pairing/device review, not a new ID. QR remains explicit authenticated approval.
- **I07:** Respect platform font scale and implement selected caption samples/styles; alias matching is R6-07 correctness, not a new feature.
- **I08/I21:** Distinguish this-session context from live guide while behind live; pending next-context correctness is R6-04. Define nested Back for keyboard/panel/track menu/overlay and preserve playback/pause while browsing.
- **I09:** Actual Channel Up/Down key shortcuts may reuse saved-lineup semantics after exact-model remote testing/repeat suppression. They are distinct from optional I36 Last channel and do not add channel numbers.
- **I10/I11/I12/I14:** Use actionable recovery/next steps and honest healthy/failed/never-run/unknown states. Manual import status mismatch is R6-06; viewer help must omit source paths/secrets.
- **I13:** If I29 is later selected, explain capacity waiting separately from failure. Keep generation reuse/storage/per-item progress within current selection.
- **I19:** Copies and preflight/impact reports must remain bound to the exact draft/target profile; a report is not a publication.

### Other candidates considered and disposition

| Candidate                                                                                        | Disposition and reason                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency impact, guide quick-find                                                              | Merged once as I28/I35 across researchers; browser treatments use the same policy/result rather than adding duplicate IDs.                                                                     |
| Commercial date windows/global retirement                                                        | Deferred beyond I31's per-channel manual scope; interval-time policy and cross-owner impact need separate decisions.                                                                           |
| Export/import programming templates                                                              | Deferred; I19 covers immediate copying, while cross-install source-ID mapping and secret-free validation add scope without an observed need.                                                   |
| Favorites, saved searches, command palette                                                       | Deferred pending household navigation/scale evidence; existing I09/I16 and I35 cover immediate ordering/search. Favorites were already mentioned as future brief scope, not silently selected. |
| Recurring/off-host backups                                                                       | Operator policy already documented under I14; no cadence, copy destination or host change authorized here.                                                                                     |
| Least-played-commercial selection                                                                | Scheduler already favors least scheduled count. Delivered-weight selection changes shared-broadcast policy and needs separate agreement.                                                       |
| Loudness leveling                                                                                | Defer until representative measurements show need; direct/HLS consistency and read-only processing need design.                                                                                |
| Safe-area/larger TV mode, fit/zoom                                                               | Defer pending physical overscan/font/aspect-ratio acceptance; caption styles are selected I07. Default aspect-preserving viewing remains appropriate.                                          |
| Richer focused synopsis/artwork                                                                  | Already partly implemented; episode context is selected I08. No new duplicate proposal.                                                                                                        |
| Auto-hide, episode exclusions, sleep timer, start-over, duration filters, browser profile memory | Already I17/I20/I22/I23/I26/I27; selection unchanged. Group mid-roll policy remains existing I25.                                                                                              |
| Remember TV profile/auto-tune                                                                    | Auto-tune/PIN bypass conflicts with explicit fresh-launch profile/PIN requirements; I36 is only within an active unlocked viewing period.                                                      |
| Bulk grant editing/source remapping                                                              | Defer until a repeated task justifies broader consequential operations and preview/rollback policy.                                                                                            |
| Voice/home recommendations/cast/background playback                                              | Defer; platform/lifecycle/private-title exposure scope is much larger and no need was established.                                                                                             |
| Global broadcast pause/watch-progress-driven rotation                                            | Conflicts with continuous shared timeline; device-local pause already exists.                                                                                                                  |
| Clock slots, public streaming/cloud login/signup/email invitations, alternate TV OS              | Outside first-release home-network/rotation/administrator-account scope.                                                                                                                       |
| Downloads/source cleanup/moves/sidecars                                                          | Excluded: integrations and originals remain read-only.                                                                                                                                         |

### Complete proposal catalog

This is the full 48-item inventory: thirty-two selected under SELECTED_IMPROVEMENTS.md and sixteen optional. I48 remains unselected. I38/I39/I40/I42/I43 are now selected and implemented locally; I41 remains optional. I28/I29/I30/I31/I33/I34 are selected; I32/I35/I36/I37 remain optional. A catalog entry alone is not a delivery promise.

| ID  | Suggestion                        | What it adds                                                                                                  |
| --- | --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| I01 | Edit collections                  | Change an existing collection without breaking references.                                                    |
| I02 | Commercial explanations           | Understand cutoff, early return, variation and exposure.                                                      |
| I03 | Starting episode/group restart    | Deliberately choose where an ordered group begins.                                                            |
| I04 | Integration reconciliation        | Review stale/reassigned imported metadata safely.                                                             |
| I05 | Library scale                     | Benchmark and bound grouped aggregation/pagination.                                                           |
| I06 | Phone-assisted pairing            | QR/open approval flow with explicit authenticated consent.                                                    |
| I07 | Playback preferences              | Remember semantic audio/caption choices.                                                                      |
| I08 | Playback context                  | Episode identity, progress, lag, next program and commercial return.                                          |
| I09 | Lineup order                      | Arrange subscriptions consistently across clients.                                                            |
| I10 | TV diagnostics                    | Explain connection/playback failures and the right recovery.                                                  |
| I11 | Guided setup                      | Link the missing steps to a playable first channel.                                                           |
| I12 | Effective access                  | Explain who can watch/manage which profile/content.                                                           |
| I13 | Generation preflight              | Readable tasks, reuse/storage summaries and failures.                                                         |
| I14 | Admin health/backup visibility    | See stale refreshes, queues, coverage, storage and backup age.                                                |
| I15 | Draft clarity                     | Distinguish Apply, Preview, Publish and immediately saved details.                                            |
| I16 | Content picker                    | Search/group sources, shows and seasons.                                                                      |
| I17 | TV controls                       | Keep the picture clear with predictable reveal/focus behavior.                                                |
| I18 | Remote PIN digits                 | Accept number/Delete/Enter keys alongside the keypad.                                                         |
| I19 | Duplicate programming             | Create an independent unpublished channel from a permitted template.                                          |
| I20 | Episode exclusions                | Omit selected episodes while keeping dynamic membership.                                                      |
| I21 | In-player mini-guide              | Browse without losing playback/pause.                                                                         |
| I22 | Sleep timer                       | Stop only this device after a selected interval.                                                              |
| I23 | Start airing over                 | Replay the displayed airing from its beginning on this session.                                               |
| I24 | Episodes per turn                 | Schedule consecutive episodes before rotating groups.                                                         |
| I25 | Per-group mid-roll policy         | Keep selected content uninterrupted inside a mixed channel.                                                   |
| I26 | Duration filters                  | Dynamically include files within measured duration bounds.                                                    |
| I27 | Browser profile memory            | Restore a permitted profile selection after reload.                                                           |
| I28 | Dependency impact                 | See authorized channel dependencies before collection deletion; grant-change impact can follow.               |
| I29 | Playback-first encoder admission  | Let optional generation wait for interactive playback capacity.                                               |
| I30 | Playback-readiness report         | Predict routing/caption limitations from stored metadata without starting playback.                           |
| I31 | Retire commercials                | Disable/re-enable ads per channel without moving files.                                                       |
| I32 | Own-password change               | Reauthenticate and choose a new account password under existing session-revocation policy.                    |
| I33 | Management resource links         | Bookmark authorized channel/collection details with stable safe IDs.                                          |
| I34 | Video metadata/track inspector    | Inspect stored content, relative filename, exact duration and track information.                              |
| I35 | Guide quick-find                  | Filter authorized loaded guide channels and current/next titles.                                              |
| I36 | Last channel                      | Return live to the last successful tune target within this viewing period.                                    |
| I37 | Upcoming-program reminder         | One app-active/device-local reminder with explicit Watch live.                                                |
| I38 | Backup verification               | Validate one application bundle in private scratch without replacing live data or revoking sessions.          |
| I39 | Recently aired lookup             | Identify past scheduled programs in a bounded retained window without replay or watch tracking.               |
| I40 | Explicit playback issue reports   | Send a sanitized viewer-confirmed problem report to a bounded admin inbox.                                    |
| I41 | TV-approved browser remote        | Approve one short-lived browser controller while the TV remains the sole video player.                        |
| I42 | Deleted collection recovery       | Restore original collection ID/member references during an agreed short grace period.                         |
| I43 | Externally stale draft protection | Reject outdated expected-revision writes while preserving a local channel draft.                              |
| I44 | Ordered-episode continuity        | Nonblocking stored-metadata warnings for gaps, overlapping coverage and unknown numbering.                    |
| I45 | TV compatible-stream preference   | Explicitly request existing 720p HLS on one server/device when measured network use warrants it.              |
| I46 | Physical scan change summary      | Review bounded Added/Returned/Changed/Unavailable results separately from provider imports.                   |
| I47 | Editable channel/content metadata | Selected expanded scope: channel descriptions and integration/local-file/manual field choices in Edit modals. |
| I48 | Temporarily disable a group       | Skip a show/group while preserving its saved episode cursor or remaining shuffle bag for re-enable.           |

## Selecting the next work

Choose proposals by their smallest scope rather than treating this document as a release promise. Once selected, update the product plan/checklist and agree contract and acceptance changes. The selected thirty-two extensions have approval to reuse the existing visual system; raise material product/design mismatches rather than reopening that approval. Defect fixes and existing hardware acceptance continue to use their separate review/checklist records.
