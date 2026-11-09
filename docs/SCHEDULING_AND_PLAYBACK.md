# Scheduling and playback

This reference describes the implemented rotation, commercial, revision and device-session behavior in unreleased 0.2.0/schema 16. [Architecture](ARCHITECTURE.md) covers server composition; [database](DATABASE.md), [API](BACKEND.md), [clients](CLIENTS.md) and [verification](VERIFICATION.md) cover their detailed contracts and limits. Original media stays read-only throughout.

## Channel time and device time

A channel is one continuous shared timeline. Its programs advance with wall-clock time even when no device watches. Joining resolves the current scheduled interval and source offset; it does not restart an episode or choose another random sequence for that viewer. Scheduling reads stored catalog metadata and writes SQLite; it does not encode or play media merely to keep a channel running. Explicit generation jobs are separate deliberate work.

| Concept          | Meaning                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| Channel          | Stable ID with continuous broadcast time and recurring programming. Names/short names are labels.    |
| Revision         | One persisted programming configuration, generated and saved timeline and rotation/checkpoint state. |
| Program/airing   | One chosen program plus all its program segments and associated mid-roll/between-program breaks.     |
| Entry            | One uninterrupted program or commercial interval with its own start/end/source offset.               |
| Playback session | One authenticated device's revision, position, pause and delivery context.                           |

Timestamps and durations use safe integer milliseconds. Intervals include their start and exclude their end: an entry ending at time T no longer owns T; the following entry starts there. Client timezone formatting does not change UTC scheduling. Server clock accuracy remains an operational concern, and this POC does not provide clock-based weekly slots.

## Discover and select content

[Media discovery](MEDIA_DISCOVERY.md) explains Sonarr TV metadata, Radarr movies/collections, custom directories, grouping, source grants and scan fingerprints. Programming selectors identify whole shows, seasons, folders, saved collections or explicit media IDs. Dynamic selections are resolved against the current authorized catalog for future generation; existing materialized airings retain their chosen files/offsets.

Unavailable files are excluded from new selections. An empty group can be skipped while another group remains usable, keeping stable group identity rather than reinterpreting its old index against a shorter list. If no group can play, generation reports a conflict instead of inventing content. Losing source authority is different from a merely missing file: current profile/channel/source authorization still applies.

Show order uses normalized season and episode metadata, then natural title/ID tie-breaking. Missing show-season metadata uses the same Season 1 convention in display and selection; specials are an explicit choice. Multi-episode physical files are selected once rather than repeated for every imported association. Custom videos do not require Sonarr/Radarr to become playable.

## Rotation modes and state

[scheduler.ts](../src/scheduler.ts) builds contiguous entries and returns state/checkpoints. [programming.ts](../src/programming.ts) resolves authorized selections, persists revisions and extends coverage.

- **Ordered:** retain the last selected clip cursor, choose the next numerical season/episode/natural-title item, and wrap at the end. If that clip disappears, continue by its ordering position rather than blindly resetting to the first file.
- **Shuffle:** consume a persisted shuffled bag without repeats until exhausted. Remove missing IDs from the bag; refill when empty. Adjacent repeats across bag boundaries are not a universal no-repeat guarantee.
- **Random:** choose independently and permit repeats. Random and shuffle use persisted generator state; viewers do not reroll decisions.

Stable group IDs retain each group's cursor/bag across ordinary edits and temporary availability changes. Replacing a different selector clears only that group's obsolete progress. Same-show season/special filtering retains ordered continuation; changing a group does not reset unrelated groups or already materialized airings.

Optional `episodesPerTurn` accepts 1, 2 or 3; omitted means 1. With A=2 and B=1, the order is A1, A2, B1, A3, A4, B2. Remaining turn state survives generation chunks/restart. The programming editor exposes **Episodes per turn** for each group and saves it in the same programming draft.

## Preview, publication and activation

Preview and publish share the intended activation boundary and state reconciliation. For an existing running channel, edits activate after the current complete airing, including its associated breaks. An editor cannot cut the currently airing program merely by changing the next selection. A new channel without a schedule starts at the current time.

Preview computes in memory without writing schedules or consuming saved random/checkpoint state. It may catch up an idle recurring configuration in memory to discover the boundary. Preview results include proposed intervals, diagnostics and effective time; new entry UUIDs are not a promise that a later publication will reuse those exact IDs. The draft must still be current when the browser enables publication.

Publication persists the new revision, its exact entries, source fingerprints, configuration and checkpoints transactionally. Before the effective boundary, the new timeline retains required old intervals; live clients adopt the replacement at its effective time. Older revisions remain available to active paused/behind-live sessions rather than silently remapping them to new content.

Schema 12 stores `boundary_state_json`, the new revision's state before generating its pending airings. Republishing an unchanged or further-edited pending configuration reconciles from that state, preserving deliberate replacement/restart/start-at choices. A legacy pending revision without this field retains its first pending airing/checkpoint before applying the later edit; it does not silently reconstruct a different one-time starting episode.

Ordered-group checkpoint commands explicitly request Restart or Start at an authorized selected item. They apply once; saved recurring configuration excludes commands so extension does not replay them. Ordinary seed/selector edits must not be interpreted as an implicit global restart.

A valid deliberate replacement can repair an expired channel whose former content/author/source authority is unavailable. Validate the replacement first; keep historical revisions and paused references. This recovery does not authorize previously hidden media. R7-02 is corrected: stale out-of-pool exclusions do not block a valid replacement.

Browser publication responses are bound to the submitted local draft. If A is submitted and the user edits B while its response is delayed, successful A does not label B saved. The browser sends I43 expected-revision preconditions: a stale preview/publication returns a conflict while preserving the local draft for deliberate review. Legacy API callers that omit the precondition retain last-writer behavior.

## Rolling coverage and restart

The programming service defaults to a 48-hour desired horizon, generated in bounded chunks. Chunk duration accounts for short content and potential commercial segments; individual schedule builds are limited to 20,000 entries, and catch-up limits batches per call. A request exceeding the catch-up bound receives a retryable error rather than resetting the broadcast. Complete airings can extend beyond a requested horizon so publication does not leave half a program.

Server maintenance, guide requests and playback can extend recurring coverage. Future materialization resolves the stored author's current authority and current selection. Persisted state records exact random decisions, ordered cursors, group turn, commercial counts and checkpoints. Restart resumes this state. Legacy explicit-ID schedules without a recurring configuration are not automatically expanded as if they had one.

No viewers means no playback delivery/encoding. The channel still advances because its persisted entries are interpreted against time; the service need not keep a hidden player running.

## Commercial files and eligible pools

Each commercial is one independent video file under a configured read-only commercial source. Folder/collection/media selection builds a pool; users need not hand-place the file at each break. Source files are never renamed, duplicated into an imported library, edited or cut on disk.

`disabledCommercialIds` is channel-local eligibility. The Commercials tab shows the current pool and enabled/disabled choices. Preview and publication use those choices at the normal airing boundary. Old airings and paused revisions retain their exact commercials. Disabling every eligible clip produces no new ad intervals and returns directly to programming; it does not schedule blank padding. Re-enabling retains the original media ID.

The contract rejects duplicate, newly supplied hidden and non-commercial disabled IDs. Previously validated exclusions outside the current usable pool are inert, including after their old source grant is revoked. The browser clears exclusions when changing/removing the pool. Preview, extension and publication retain these R7-02 protections; see [the correction record](IMPLEMENTATION_REVIEW.md#seventh-round-selected-correction-disposition).

## Break placement and variation

Breaks can occur between programs, at explicit source timestamps/percentages, and at bounded random source positions. Random positions are distributed across the configured percentage range; duplicate/out-of-range points are removed before generation. Program source offsets continue across breaks rather than restarting the episode.

A break uses configured maximum clip count/duration, per-clip repeat allowance, per-break repeat cap and cooldown. Selection prefers eligible alternatives to the last commercial when possible, then the lowest scheduled count, then seeded random choice. When every commercial reaches its configured allowance, the pool count cycle can reset; cooldown and per-break limits still constrain selection. Allowance 2 or 3 is supported for small pools, without pretending it overrides the other rules.

Counts describe scheduling decisions, not people watching. No viewer is required for a scheduled airing to advance. Commercial selection and persisted counts survive restart rather than starting afresh on every tune.

## Cutoff mode and minimum remaining time

New browser channel rules default to `overflowPolicy: truncate` and `minRemainingMs: 6000`. In cutoff mode, a commercial longer than the remaining break may play only that remaining time. Another commercial starts only when the remaining budget is **strictly greater** than the minimum. Exactly six seconds with the default minimum is insufficient; more than six seconds permits a clip, which can be cut short at the planned boundary.

| Remaining break budget       | Available clip       | Cutoff result with six-second minimum                    |
| ---------------------------- | -------------------- | -------------------------------------------------------- |
| 10 seconds                   | 12-second commercial | Play 10 seconds, then resume programming.                |
| 6 seconds                    | 12-second commercial | Start no new commercial; resume programming immediately. |
| 5 seconds after a prior clip | Any clip             | End the break early; insert no scheduled dead air.       |

The scheduled entry contains the shortened duration. A shortened commercial counts as one scheduled appearance. Bounded HLS delivers the shortened commercial; clients return to the program's correct source offset. The commercial original remains unchanged. The minimum is a scheduling threshold for starting another clip, not a requirement to play a fixed six-second bumper.

Whole-commercial mode uses `overflowPolicy: skip`, the compatibility behavior for older saved configurations without a policy. It only chooses clips fitting the remaining budget; the cutoff minimum does not apply in this mode. When nothing fits or eligibility/repeat/cooldown/count rules stop selection, generation shortens the break and places the next program segment immediately afterward. These are duration caps, not fixed clock slots that must be padded to a wall-clock deadline.

Preview diagnostics report requested/actual break bounds, pool size, selected clip count, shortened clips and reasons such as filled, minimum remaining, clip limit, no commercials, duration fit or variation limits. They do not draw additional randomness or change persisted assignments. The programming preview presents readable break diagnostics, and channel statistics show scheduled/delivered exposure separately.

## Join, pause, resume and Go Live

Playback sessions belong to the authenticated account/session that created them, plus an authorized profile/channel. Another browser or device cannot control a TV simply by knowing its playback ID. The same profile on two devices still has independent position/pause state.

Join resolves current channel time and creates a fresh device session. The source offset is entry offset plus elapsed time within that entry. Pause stores the session position and freezes its countdown while the channel continues. Resume advances from the stored position, leaving it behind live. Go Live explicitly reselects current broadcast time/revision. Switching channels or reopening joins live; start-over and companion remote remain optional proposals.

Live descriptors follow a pending effective revision when the next airing will actually use it. Paused/behind-live descriptors retain their timeline for both playback and next-program context. Metadata includes owning episode, source/content progress, airing bounds, remaining scheduled interval time and next program where authorized. The browser/native playback-context interfaces now use those fields; complete state/design/physical acceptance remains in the checklist.

Clients stop media delivery while controlling Pause/Resume/Go Live. Before releasing browser delivery, the player captures a still frame as an in-memory poster, capped at 1920 pixels wide. It keeps that image while paused and clears it when playback resumes or the entry changes. No source or derivative file is written. A platform that cannot read video frames still pauses safely, with target-browser acceptance required. Failed controls reconcile a fresh server descriptor: an unapplied Pause resumes playback, an applied Pause with a lost response stays paused, an unapplied Resume stays paused, and an applied Go Live with a lost response follows current live playback. Stale polling, boundary, delivery and caption completions must not override newer controls/session lifecycle. Browser and native implementations have specific regression evidence in [VERIFICATION.md](VERIFICATION.md).

## Direct playback, HLS and shared encoder capacity

Negotiation uses declared container/video/audio capabilities and stored technical metadata. Compatible media prefers authorized direct/range playback; selected alternate audio or incompatible/shortened content can require HLS. The shared pure routing decision also powers the admin's stored-metadata readiness report, which starts no session, scan or encoder and is not a real-device certification.

HLS uses bounded four-second segments, source offsets and discontinuities across intervals. Compatible callers can share cached segment work, but each has independent authorization and network bandwidth. Cache output is disposable and separate from originals. Explicit reusable generation remains optional; a direct stream or reusable cache hit consumes no encoder-admission slot.

One shared `EncoderAdmission` queue serves interactive HLS/subtitle extraction and background generation. `MYTUNER_ENCODER_CONCURRENCY` accepts 2–8, default 3. Background work may occupy at most total minus one slots. Interactive tasks are preferred; after eight interactive admissions a waiting background task can receive an eligible slot to avoid starvation. Running tasks finish without preemption. The queue caps at 100; service-specific concurrency/time/storage limits still apply.

Queued work rechecks stopping state/authority before execution. Cancel removes waiting optional work, progress exposes playback-capacity waiting, and shutdown drains owners without admitting new encoders. The budget limits process admission; it is not a measured promise of CPU use, encoding latency or Unraid throughput.

## Captions and track preferences

Supported embedded and external text tracks are converted to authenticated WebVTT outside source directories. External `.srt`, `.vtt`, `.ass` and `.ssa` files are discovered beside matching videos, in conventional/configured subfolders or a mirrored read-only subtitle root. Administrators configure locations and inspect origin/status or preview/save a manual association. See [audio and subtitle setup](SUBTITLES.md) for matching, location and management steps. Text codecs include SubRip, ASS/SSA, WebVTT, mov_text and text; image subtitles/burn-in are not implemented. Extraction validates source fingerprints, is bounded by cache/time/concurrency limits, and shares interactive encoder admission. Opening the stored inspector itself does not extract subtitles.

Caption time maps source cues across program segments and commercials. Browser fullscreen includes captions and controls. Native transient caption errors keep healthy video playing and offer track reselect/Off; stale previous-entry/delivery/selection responses cannot replace current cues. Track menus verify current delivery identity before changing playback. Browser/native semantic language preferences and caption size/background controls are implemented locally per server/profile/device. R6-07 language aliases and full transition/design/accessibility acceptance remain deferred/open as recorded in the checklist.

## Source changes, unavailable intervals and authorization

Persisted entries record source size/mtime fingerprints. If a file is missing or changes, clients must not play a different replacement through the old identity. The scheduled interval retains its clock bounds and shows unavailable rather than pulling later programs earlier. A rescan updates catalog availability/fingerprints; unchanged-entry availability transitions are meaningful delivery decisions.

Native polling stops unavailable delivery and automatically recovers the same entry after source return without Retry, while preserving intentional pause. A join that starts unavailable can recover similarly. Authentication/profile/source revocation remains enforced on descriptors and media/segments. Selected R5-01 setup-time revocation is now corrected locally with open/setup authority rechecks and regressions; this does not replace target-host outage and concurrency acceptance.

Current source revocation can also stop future generation if no authorized programming remains. Manual schedule repair, UI recovery and physical outage behavior need the documented acceptance tests; do not treat an unavailable share as authority to move/copy/delete household media.

## Scheduled exposure and delivered intervals

Persisted entries represent scheduled exposure. Clients separately report bounded delivered intervals tied to an authorized session/entry, with stable event IDs for retry deduplication. The server validates entry/time bounds, retains kind/media/program identity, and merges overlapping intervals for delivered totals rather than treating duplicate reports as extra watching.

Statistics must distinguish planned assignments, started/delivered intervals and delivered milliseconds. A schedule with no viewers can contain many airings and zero delivery. Delivery reports do not establish viewer attention, completion or watched status; the scheduler does not choose a different episode based on one device's reports.

## Retention, testing and open acceptance

Playback maintenance expires old sessions/unlocks/pairings and removes revisions older than seven days only when neither active nor referenced by a playback session. This is not a promised guide archive or a complete telemetry/history/backup retention policy. I39 provides a bounded two-hour lookup over retained authoritative past airings, with explicit empty/partial states and no recording or replay.

Implemented regression coverage spans ordering, shuffle/random state, source selection, commercial rules/cutoff boundaries, pending publication/start-at state, live-versus-paused next context, control/poll recovery, privacy, fingerprint checks, shared admission, captions and shutdown. Current server/browser/native/emulator evidence and test counts are in [VERIFICATION.md](VERIFICATION.md); historical review checkpoints do not replace that latest evidence.

The seventh review's four P2 issues were selected and corrected locally; five earlier deferred findings remain open (R3-08/R6-06/R6-07/R6-08/R8-03). Physical Bravia/Fire, representative codecs/HDR, exact remote behavior, real Unraid/Docker concurrency, installed Sonarr/Radarr, native visual/accessibility and long-duration outage/soak testing remain open in [CHECKLIST.md](CHECKLIST.md). A successful synthetic local stream does not certify every household file/device.

## Retained airings, collection recovery and publication conflicts

Recently aired reads only already retained entries from the current active revision, whose prefix carries authoritative earlier airings across publication boundaries. Group by program ID to collapse mid-roll splits and associated breaks. Include completed airings ending in the last two hours; never query paused-only/superseded revisions as authoritative history or extend a missing schedule. Current permissions/subscription are checked first, titles/member grants filtered before the 200-row limit. Empty/partial retention is explicit and conveys no watched/replay claim.

Soft-deleting/restoring a saved collection changes metadata selector availability only. Existing scheduled IDs/paused timelines remain intact; restore retains original collection identity so future generation can resolve it again without a rewind/publication command. Expiry removes reference metadata, never media files. Previously validated commercial exclusions outside the current usable pool remain inert even if that old source grant disappears; newly supplied hidden/non-commercial IDs still fail validation.

The managed browser sends `expectedRevisionId` (UUID or explicit null) to preview/publication. Publish checks active revision and writes within one immediate transaction. Stale requests fail 409 without advancing cursors/checkpoints or replacing entries. Pending future revisions count as changed; horizon extension alone does not. Conflict keeps the local draft for explicit latest-version review and fresh preview. Omitted preconditions remain backward-compatible last-writer API behavior.

## External captions across playback intervals

Embedded and associated external text tracks share authenticated source-time WebVTT delivery. Source offsets are applied after mid-program commercial intervals; captions clear during commercial delivery and are resolved against the resumed program's fresh track list. Pause retains the source-time cue without continued delivery, and Go Live recomputes current schedule time. External discovery/configuration and manual association never change a schedule or media file. [Subtitle setup](SUBTITLES.md) covers formats, naming, settings and stale-file errors. [Verification](VERIFICATION.md) distinguishes actual synthetic browser/native execution from representative household/device/soak acceptance.
