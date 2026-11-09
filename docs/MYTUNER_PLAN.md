# myTuner: standalone personal TV network

Status: version 0.2.0 / schema 16 implements the core services and approved browser/native TV POC. All six selected bug fixes are implemented and regression-tested. Browser verification passes 318 backend tests and 88 browser journeys with 70 PNG baselines; Android unit/build/lint passes 23 tests. Native evidence includes a complete 19-comparison state audit and 24 enlarged-text states before the final pairing-only focus correction, plus a passing targeted enlarged-pairing regression on the final APK. The current full recovery repeat stopped after six visual comparisons when emulator hierarchy collection failed; current tracks/alias and TalkBack repeats were not completed. The owner explicitly deferred further emulator verification. See [verification](VERIFICATION.md) for evidence and [differed](differed.md) for follow-ups.

The completed [tenth-round code review](IMPLEMENTATION_REVIEW.md#tenth-round-findings-and-disposition) fixed two P1 issues. The owner then selected R10-04–R10-13; those corrections are locally regression-verified. The owner subsequently selected R10-03 and the five older deferred findings; all six are corrected. [Differed](differed.md) tracks the external acceptance steps.

The [documentation index](README.md) links the detailed architecture, database, discovery, applications, scheduling/playback, security, operational and development references.

## Goals and boundaries

Build a personal TV network over existing Unraid media with our own server, browser manager/player, and TV app. Plex and ErsatzTV are not required. Sonarr and Radarr remain optional read-only metadata sources; neither is the playback server.

First release: home-network access, continuous rotation-based channels, PC browser, Sony Bravia Android/Google TV as the primary viewing target, and Android-based Fire OS sticks as the secondary target after exact-model verification. Amazon Vega OS, public internet access, and clock-based slots are outside this release.

Original media is strictly read-only. Never move, rename, delete, edit, duplicate into an imported library, or write sidecars beside source files. Read source files directly from existing Unraid shares. No real media, generated assets, credentials, or databases belong in Git. Explicitly permitted derivatives are separate thumbnails, GIF previews, reusable compatible conversions, and disposable playback segments, stored outside sources.

Continue in afbeals/myTuner on a feature branch. Git history preserves the previous POC; no extra tag is required. Preserve legacy files for reference and label them as such.

## Components and data flow

```text
Unraid media shares (read-only)     Sonarr / Radarr (read-only API)
                 \                         /
                  myTuner server + SQLite
                  /          |           \
          Browser manager   Browser     Android/Fire OS
                            player        TV player
```

Default implementation: TypeScript/Node.js server, React browser interface, Kotlin/Media3 TV player, FFmpeg/ffprobe, and SQLite. Establish client/server contracts before implementing UI. A minimal API/media test harness is allowed before designs; production UI is now authorized by the owner-approved design handoff.

The server owns source scanning, metadata import, media availability, generation jobs, channels, schedules, permissions, and history. Clients use authenticated APIs and never access SQLite or integration credentials directly. API input validation and authorization are server responsibilities.

## Accounts, profiles, channels, subscriptions

An administrator creates accounts; no public registration. Browser management uses account authentication. Accounts have admin, permitted editor, or viewer roles. PINs protect TV profile selection; a PIN is not a replacement for device/account authorization. The intended TV journey is one-time browser-approved pairing, then profile selection and easy numeric PIN entry on each fresh app launch, followed directly by that profile’s subscribed channel guide. Switching profiles repeats PIN entry; pairing persists so account passwords are not entered with the remote.

Profiles represent people or rooms. A personal profile has an assigned owner; room profiles may be shared. The admin grants account-to-profile access, source/subtree access, and management privileges. An editor may manage only authorized profiles and their own channels. A viewer cannot edit programming.

Shared channels belong to the admin-published catalog. Each profile subscribes to available shared channels and may have custom channels. Every channel has an immutable unique ID and one live timeline. Names and optional short names are labels, not identity; duplicate names cannot overwrite another channel. Subscribing reuses the channel timeline; unsubscribing never deletes it.

Private channels are invisible to other users, including search results, guide data, counts, and subscription candidates. Only their owner and the admin may discover or subscribe to them. Only the admin can see/manage all channels. An admin subscription does not make a private channel visible to another user. Every media/preview/segment request must be authorized too; hiding UI is insufficient.

When subscription/source permissions change, prevent new unauthorized playback and invalidate access rather than exposing old links. Shared-channel publishing must not expose private sources accidentally; validate the source grants for the intended audience.

## Library and content selection

Sources are stable catalog roots with an explicit type: shows, movies, general videos, or commercials. Each root may be scanned recursively; grants can restrict a profile to a subtree. Resolve paths safely, reject escapes, and do not follow symlinks outside configured roots. Clients use catalog IDs rather than arbitrary filesystem paths.

- Sonarr: show identity, descriptions, artwork references, seasons, episode numbers, and file mappings.
- Radarr: movie identity, year, description, artwork references, and collection membership where supplied.
- Custom roots: searchable folder/video grid with filename and available local metadata; no external matching required to make a video usable.
- myTuner collections: saved references to authorized catalog items, including items from different sources. Never copies of files.

Map integration paths to container paths using component boundaries, not naive string prefixes. Read actual files to verify availability and use ffprobe durations rather than approximate catalog runtimes. An item tracked but not downloaded is not playable. Import integration metadata into SQLite so temporary integration outages do not erase the usable catalog.

Default episode ordering is numerical season/episode order; specials are opt-in and unavailable episodes excluded. One physical multi-episode file must not be scheduled repeatedly because multiple episode records reference it. General content supports natural filename/path order, shuffle without repetition, and random selection that permits repeats. Discover additions, replacements, and removals without rewriting source files. Surface errors without discarding the last successful catalog on an offline root.

The browser should show artwork cards and searchable/filterable lists. A show opens seasons and episodes; a movie is individually selectable; a collection or folder can be selected as a dynamic group. Selecting a show/folder does not freeze it to today's files unless the user explicitly creates a fixed collection.

## Scheduling and commercials

Channels follow repeating rotations of selected content groups. A rotation can alternate shows while preserving each show's episode sequence. Generate a rolling upcoming guide and persist exact program segments and commercial choices. Random decisions are made once per scheduled airing and survive restart; joining viewers do not randomize their own broadcast.

Each scheduled interval is start-inclusive and end-exclusive, using UTC instants and integer milliseconds internally. Local timezone is a display preference. No viewers means no encoding, decoding, or playback delivery. Persist schedules so a restart or long idle period does not reset the broadcast.

Edits activate after the current program and its associated breaks; retain prior schedule revisions while an active paused session references them. Missing scheduled content shows an unavailable interval and does not move other programs earlier.

A commercial is one individual file. Pools can include nested folders. Configure between-program breaks and mid-program breaks by timestamps, percentages, or bounded random positions. Configure maximum clip count or duration, appearances per clip per rotation (including 1, 2, or 3), maximum repeats in a break, and cooldown. Spread repeats apart where possible. New-channel commercial controls default to cutoff mode: an eligible longer clip may play only the remaining break time. Start another clip only when strictly more than a configurable minimum remains (six seconds by default); otherwise resume the show immediately. Whole-commercial mode remains available and is preserved for older saved configurations. If rules cannot fill a break, shorten it while generating the schedule, never silently violate rules or insert scheduled dead air. Count a shortened clip as one appearance and keep original files unchanged. A one-clip pool may repeat only when configured limits permit it. Private channels default to no commercials.

Keep scheduled assignments distinct from actual delivered playback; airings with no viewers still advance the rotation. Record commercial scheduled exposure and delivered intervals separately. Do not equate delivery with a person watching the screen.

## Playback and pause

Joining a channel resolves the current interval and source offset, including commercials. Prefer direct playback; use conversion only when needed by client capabilities. Compatible consumers may share server conversion work, but each consumes its own network bandwidth.

Pause affects one device session, even if another device uses the same profile. Resume continues behind live. Go Live resolves the current schedule again. Switching channels or reopening starts live. Stop fetching after a paused buffer fills. Use original files plus retained schedule references rather than recording another broadcast. Original-file replacement during a paused session must yield a clear unavailable/rejoin outcome rather than the wrong episode.

## Optional directory generation

An admin selects a custom directory, independently chooses recursive or shallow scope, and requests thumbnails, GIF previews, and/or compatible video conversions. Preview affected items and estimated work before running. Show progress, per-item results, cancellation, and retry. Do not run bulk conversion just because a source was added.

Write into a dedicated generated-assets root. Reuse valid existing outputs unless regeneration is requested. Key outputs by media identity, source fingerprint, and generation settings; incomplete outputs must not be served. Give derivatives the same permissions as originals. Conversion outputs are an explicitly permitted exception to the prohibition on importing copies of source media.

## Persistence and Docker

SQLite stores sources, item metadata, accounts, profiles/grants, collections, channels, subscriptions, scheduling rules/revisions, generated schedules, rotation state, jobs, and playback history. The server is the sole database owner. Keep transactions short, enable foreign keys, and use consistent backups.

| Container root | Purpose                                        |
| -------------- | ---------------------------------------------- |
| /app/data      | Local SQLite, configuration, metadata, backups |
| /media         | Existing media, read-only                      |
| /commercials   | Commercial sources, read-only                  |
| /generated     | Optional reusable derivatives                  |
| /cache         | Disposable segments and temporary job outputs  |

SQLite lives on local Unraid app storage, not SMB/NFS. Follow Tide/Finapp: build/test a versioned linux/amd64 image, publish immutable version and latest tags deliberately, update through Unraid without replacing volumes. Include health, logs, migrations, backup/restore, graceful shutdown, and compatible rollback instructions. An older image cannot automatically undo migrations.

## Delivery workstreams

1. Foundation: inspect repository, save docs, establish models/contracts and test harnesses.
2. In parallel after contract review: design browser/TV flows while non-UI scanning, persistence, integrations, scheduling, permissions, and playback services develop.
3. Validate playback with representative files on actual hardware using a non-product harness. Do not build the full UI to discover playback incompatibilities.
4. Implement browser/TV UI only after approved designs and handoff. Finish integrated behavior, accessibility, visual regression, and device testing.
5. Release only after Docker/data lifecycle, real-device playback, security, and backup/restore acceptance.

See [DESIGN_BRIEF.md](DESIGN_BRIEF.md) for the self-contained design-agent handoff and [CHECKLIST.md](CHECKLIST.md) for acceptance and current progress.

## Separate follow-ups

Router/firewall/SSID/VLAN configuration is separate infrastructure work; retain existing TV networks and later permit narrow server access. TV cleanup is an optional, model-specific optimization measured before/after. Assess hardware transcoding and throughput after measuring actual workloads. Confirm exact Bravia/Fire models, source mappings, Sonarr/Radarr versions, and representative formats before device acceptance.

## TV installation deliverable

Delivery includes an installable signed TV APK, exact-model/OS validation, launcher/remote support and documented install/update steps. Follow [TV_INSTALLATION.md](TV_INSTALLATION.md) for the Bravia/Google TV and Fire OS procedures, Unraid base-address selection, browser approval, profile/PIN startup and acceptance. A local debug-signed version 0.2.0 APK is available; physical-device acceptance remains open. [DESIGN_REVIEW.md](DESIGN_REVIEW.md) records the supplied Figma handoff and current API differences.

## Implementation checkpoint

The core backend includes account/device lifecycle, catalog/discovery, recurring programming, demand-based HLS/text tracks, external subtitle configuration, storage/recovery and schema 16 refresh diagnostics. Browser and scoped native state/font/pairing checks have passing evidence. Remaining emulator recovery/tracks/accessibility repeats are deferred at the owner’s request; hardware, Docker/Unraid and human acceptance remain separate. Read CHECKLIST.md, VERIFICATION.md and differed.md for the exact boundary.

Channel setup includes an optional short name (up to 12 characters). Blank derives up to four initials or the first four characters of a one-word name. Automatic labels follow renames; supplied labels remain. The owner selected names/short names instead of channel numbers.

## Selected improvement implementation follow-up

The owner selected twenty proposals (I01–I16, I18, I19, I21, optional I24) and ten fifth-round corrections (R5-02–R5-11). [SELECTED_IMPROVEMENTS.md](SELECTED_IMPROVEMENTS.md) is the current scope/service-status/API plan; [SELECTED_DESIGN_BRIEF.md](SELECTED_DESIGN_BRIEF.md) is the complete extension handoff. The approved Silver Signal system remains the foundation. The owner approved reusing those patterns directly for the selected extensions before the sixth review round. Implement their visual controls and verification within that approved scope, and raise material product/design mismatches. Supporting service code does not by itself mean a UI is delivered.

The subsequent sixth-round selection adds I28/I29/I30/I31/I33/I34 and corrects R6-01–R6-05. The selected delivery plan and verification record cover the implemented dependency/readiness/metadata/link/commercial browser flows and shared FFmpeg admission. Twenty-six proposals are now selected; the earlier twenty-feature screen checklist retains its own unfinished acceptance items.

The seventh review found four P2 issues; the owner selected R7-01–R7-04 (R7-01 first) and five additions I38/I39/I40/I42/I43, now implemented locally. I41 remains optional. See [the ranked findings](IMPLEMENTATION_REVIEW.md#seventh-round-findings-and-disposition), [current research](IMPROVEMENTS.md#seventh-review-research) and N53–N55 in the checklist. The 43-item catalog now contains thirty-one selected and twelve optional proposals; previous selected screen and physical-device acceptance work remains open.

## Latest selected capabilities

Backup verification runs locally without installation. Recently aired lookup is retained schedule identification only. Collection Undo/Recently deleted has configurable seven-day retention. Explicit playback-problem reports have configurable thirty-day retention and a bounded admin inbox. Atomic revision preconditions preserve stale browser drafts for deliberate review. See [selected delivery](SELECTED_IMPROVEMENTS.md#seventh-round-selected-delivery--i38-i39-i40-i42-i43), [API](BACKEND.md), [operations](OPERATIONS.md), [database](DATABASE.md) and [verification](VERIFICATION.md). Source originals remain read-only; networking remains the separate operator follow-up.

## Eighth review checkpoint

The latest six-reviewer round corrected R8-05, a protected native-dialog lifecycle issue. R8-01–R8-03 (P2) and R8-04 (P3) await owner selection. Three researchers added optional I44–I47; the 47-proposal catalog has thirty-one selected and sixteen optional. [The priority register](IMPLEMENTATION_REVIEW.md#eighth-round-findings-and-disposition) and [research](IMPROVEMENTS.md#eighth-review-research) separate corrections, new ideas and unfinished prior acceptance.

## Expanded I47 selection

The owner selected channel/content editing after the eighth review. [METADATA_EDITING.md](METADATA_EDITING.md) records the expanded plan: channel descriptions and name/short-name details modal; titles/descriptions from integration, existing adjacent/configured-directory metadata files or durable manual values; per-field choice and quick availability. This selection brings the catalog to thirty-two selected/fifteen optional. Existing channel-name editing is implemented; the new description/metadata flows are pending.

The owner subsequently removed the web URL/provider/parsing idea from I47. Use the existing NFO parser as the starting point, adding show-level and separately configured read-only metadata locations. Automatic metadata prefers Sonarr/Radarr, then local metadata, with filename fallback; manual fields remain explicitly selected and durable.

## Ninth investigation checkpoint

All eight requested reviewers completed: one feature, one UI/UX, two documentation and four bug investigations. [R9-01–R9-04](IMPLEMENTATION_REVIEW.md#ninth-round-findings-and-disposition) record three new P2 and one P3; no new P0/P1 was confirmed. Code was unchanged at that investigation checkpoint; selected corrections are recorded below. [Optional I48](IMPROVEMENTS.md#i48--temporarily-disable-a-programming-group-without-losing-its-place) preserves a temporarily disabled group's cursor/shuffle bag; two UX refinements and deferred alternatives are surfaced separately. The catalog now has 48 proposals, thirty-two selected/sixteen optional. I47 was selected and pending at that checkpoint; its outage/concurrent-save/editor recommendations are recorded in the focused metadata plan. Earlier bug decisions, unfinished selected screens and device/deployment acceptance remain open.

## Selected ninth-round delivery checkpoint

R9-01/R9-02/R9-04 are corrected locally: valid NFO number fallback, browser retained paused picture without continued delivery, and artwork shutdown draining. Separate **Edit details** and **Edit programming** now exist for current name/short-name/visibility fields; details can open above a retained programming draft and save immediately. Full I47 descriptions/source-aware content editing, R9-03, optional I48, older deferred findings and device/deployment acceptance remain open. Exact selected-change checks are in [verification](VERIFICATION.md); version/schema remain unreleased 0.2.0/13. Next scope planning follows this tested subset.

## Current implementation status correction

The earlier dated checkpoints preserve their historical scope. Expanded I47, the pilot-critical corrections and all six subsequently selected findings are implemented in 0.2.0 / schema 16. Browser verification and scoped native state/font/pairing checks pass; remaining emulator verification was stopped at the owner’s request. Follow [verification](VERIFICATION.md), [delivery phases](DELIVERY_PHASES.md) and [differed](differed.md) for open acceptance work.
