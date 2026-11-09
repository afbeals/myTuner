# I47: channel details and editable library information

Status: implemented locally in unreleased 0.2.0, introduced in schema 14 and retained in current schema16. Channel details include descriptions and revision checks. Administrator library editors offer per-field Automatic, Sonarr/Radarr, local NFO and manual choices, cached previews, explicit checks and guarded saves. Native channel information and shared display/search projections use these values. Physical Bravia/Fire display acceptance remains pending. No web enrichment is included.

## Edit modal

An **Edit** action opens a modal over the current channel or library view. Save and Cancel are explicit. Switching items/profiles or closing an unsaved edit preserves the draft or requires confirming discard. Delayed results cannot populate another item's fields. Reuse approved Silver Signal fields and accessible modal behavior; no full editing page is needed.

### Implemented separate editors

Choose **Edit details** from a channel row or its preview to change the existing name, automatic/supplied short name and visibility. **Save channel details** takes effect immediately; it does not publish programming. Cancel/Close/Escape confirm discarding unsaved edits. A pending save warns that closing cannot undo a request the server already received. Failed saves retain the draft for retry; a closed editor's delayed completion cannot alter another editor.

Choose **Edit programming** for content groups, commercials, preview and publication. Its **Edit details** action opens the details modal above the current programming draft. Closing details restores focus and the unchanged unpublished programming draft. Both editors have distinct component identities. Existing owner/admin authority applies; a non-admin owner can retain existing shared visibility while renaming a shared channel. Making a channel shared still requires admin permission.

The sections below describe the implemented metadata contract.

### Channel details

Edit the channel's name, optional short name and description together. Blank short name derives from the full name; blank description clears it. Existing channel owner/admin authority applies. Preserve channel ID, owner, subscriptions, broadcast timeline and paused playback. Name/description saves are separate from programming publication and cannot restart an episode, move an airing or reset rotation. Display descriptions in appropriate browser/TV channel information surfaces, with wrapping and an empty state. Store plain text only in the application database.

### Content information: three sources

Identify the scope being edited: whole show, episode/combined physical episode file, movie or custom video. Show and episode titles/descriptions are distinct; editing a show cannot overwrite every episode's title or synopsis. Provide a source selector for each display field so a Sonarr title can be combined with a manual description.

| Source              | Behavior                                                                                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sonarr / Radarr     | Select the linked imported field. Store provider/item reference and selection; retain the last imported value for offline use. Refresh updates this source candidate without overwriting manual information.          |
| Manual              | Enter a title or description stored in SQLite. Keep it through scans/imports/restarts. An intentionally empty manual description stays empty.                                                                         |
| Local metadata file | Read a supported existing metadata file next to the video or under an administrator-configured read-only metadata directory. Store its file reference, parsed values and last successful check. Never write the file. |

**Automatic** is a selection policy, not another source: prefer a usable Sonarr/Radarr field, then valid local metadata, then a filename-derived title. Missing descriptions remain empty. Explicit manual selection overrides that policy. Use Automatic resets a field's selection without deleting its saved manual text; preview the result before Save. Explicit unavailable integration/file choices remain visibly unavailable or stale rather than silently changing their selected source.

## Local metadata discovery

Start with NFO XML, building on the existing parser rather than introducing arbitrary formats. A later format would need a documented schema and tests.

- Match a movie/episode/custom video's basename first, for example `Episode 01.mkv` with `Episode 01.nfo`.
- Support `movie.nfo` for a movie directory and add `tvshow.nfo` for show-level title/description. Show metadata must not replace episode-specific fields. Generic directory-level files need an unambiguous scope; never apply one episode synopsis to unrelated videos merely because they share a directory.
- Configure metadata location per media source: adjacent files by default, or a separately mounted metadata root using the media source's relative directory/file structure. An explicit configured root is selected deliberately; do not guess across unrelated folders.
- For example, `/media/shows/Orbit/Season 01/Orbit S01E01.mkv` can map to `/metadata/shows/Orbit/Season 01/Orbit S01E01.nfo` when those media/metadata roots are paired. Show-level information can come from the corresponding `Orbit/tvshow.nfo`.
- Choose roots in server/container terms, not the browser computer's filesystem. Mount any separate metadata directory read-only and keep it separate from writable application/generated/cache roots. Files and symlinks must remain inside the configured roots.

Record file provenance, supported fields, observed modification/fingerprint and last successful parse in SQLite. Missing/unreadable/invalid metadata does not make a valid video unplayable. Retain the last successful snapshot as stale, expose the failure and allow a deliberate source change; do not silently erase manual values. A removed file is different from an explicitly empty field in valid metadata. Metadata file links/URLs are descriptive data only; never follow them for web enrichment.

### Reader responsibilities

`src/local-metadata.ts` supplies optional adjacent-file scan snapshots. `src/display-metadata.ts` adds explicit bounded, validated show/video NFO checks, mirrored metadata roots and separate display choices. Opening the editor uses stored data. Files are checked only through the explicit action; Save rereads the selected file and checks its fingerprint. A source rescan updates its scan snapshot without altering manual choices.

## Quick availability check

Opening Edit reads stored integration/local/manual candidates and shows **Available**, **Not linked**, **Not imported**, **No file found**, **Not configured**, **Read failed** or **Stale**, with the path's safe source-relative label and last check time. Availability is per field and scope: a file may contain a title without a description.

Provide **Check metadata files** to recheck the mapped local files explicitly and preview parsed values before Save. Opening the modal itself does not rescan media, fetch Sonarr/Radarr, start playback or generate assets. Cancel or a failed check preserves current selection, text and playback. The earlier web-provider selection question is withdrawn by the owner's local-files decision; no provider choice or new credential is required.

## Persistence, identity and authority

Keep source snapshots, selected source/file reference and manual display values separate. Do not overwrite catalog/group identity, file paths, season/episode numbers, ordering keys, duration, technical tracks or rotation checkpoints when editing display text. Local show keys currently depend on scanned title metadata; display overrides must remain outside those inputs.

Shared catalog metadata editing starts administrator-only. Channel owners/admins retain existing channel-details rights. Catalog labels are visible only to profiles already authorized for the content. Viewing tokens cannot administer metadata. Recheck authority before saving and after pending file checks; hidden names, file candidates and counts stay hidden. Metadata-root configuration is an admin operation with path containment and source privacy checks.

SQLite snapshots/choices/manual values are covered by application backup/restore; external NFO files remain operator-managed and read-only. A restored metadata reference can be unavailable on another host, so cached values and honest status matter. Scans/imports update their own candidate only. Retain overrides only for the same logical item; ambiguous replacement files need review instead of inheriting unrelated labels silently.

Resolve effective values consistently across library/search, selector labels, browser/native guide and playback context. Preserve filename matching, scheduling order, identities, timing and historical facts. Presentation changes need no programming republish; define how open views refresh and share the resolver across clients.

## Resolver and editor rules

The ninth review recommends these implementation rules within the selected scope. These rules are implemented and covered by local regressions.

### Cached integration values during an outage

Automatic should continue using the last successful usable Sonarr/Radarr field during a transient outage, with an honest stale indicator. A newer local-file check alone should not make titles alternate with network availability. If there is no usable imported field, try local metadata, then the title's filename fallback; missing descriptions stay empty. After provider recovery, update its candidate and recompute Automatic while keeping all manual values/selections unchanged.

Treat a successful authoritative field clear or deliberate unlink separately from a failed refresh: only a deliberately defined clear/unlink operation may remove that integration candidate and expose the fallback. Current imports do not sweep every missing association; I47 must not silently introduce sweeping removal. Explicit integration/local selection retains its chosen source and stale/unavailable status until a deliberate change. Cover stale integration plus fresh local values, first import failure, recovery, partial fields and deliberate clear/unlink in resolver tests.

### Concurrent edits

Use an item/channel-details revision checked atomically on Save. If another administrator/authorized channel owner saves first, return a conflict and keep the local draft visible; offer reload/review rather than silently overwriting. This extends beyond current I43 programming-draft preconditions: the channel-details PATCH accepts expectedDetailsRevision. A metadata refresh should update its own candidate without replacing a manual draft; define whether candidate refresh requires reviewing a changed effective preview before Save. Cover two editors, source refresh during editing, permission revocation and retry after an uncertain response.

### Editor conveniences

Distinct **Edit details** and **Edit programming** entry points and immediate-effect wording are implemented for current channel fields. **Use current text as manual** seeds an unsaved field: seed a single unsaved field only, preserve prior manual information and require deliberate replacement. Cancel leaves storage unchanged. The content modal retains drafts on conflicts and requires deliberate reload/review.

## Acceptance

- Channel descriptions/name/short-name persistence, clear/reset, authority and private visibility, with unchanged subscriptions/playback.
- Independent source selection per field, stable cached-integration outage/recovery precedence, explicit missing/stale states, empty manual descriptions and accurate reset preview.
- Basename, movie-level and show-level NFO matching; combined episodes, multi-video directories, partial fields and separate mirrored roots.
- Read-only source/metadata hashes, path/symlink containment, malformed/oversized XML and no network enrichment from local file contents.
- Scan/import/restart/backup/restore preserving manual text, source choice, independent cached candidates and replacement identity.
- Explicit file check failure/retry, stale/late/revoked responses and resource/profile changes; no unnecessary playback, scan or generation work.
- Browser/TV display/search parity, unchanged episode order/cursors/airings/paused sessions, concurrent-editor conflicts preserving drafts, accessible modal focus/dirty close and visual regression.

The [checklist](CHECKLIST.md) tracks remaining browser/native/physical acceptance. See [VERIFICATION.md](VERIFICATION.md) for exact executed evidence.

## API and storage

Administrator POST `/api/profiles/:profileId/metadata/inspect`, `/check` and `/save` use a target of `{kind:"media",mediaId}` or `{kind:"show",sourceId,key}`. Save includes the inspect revision and independent `{source,manual?}` choices for title/description. If a file was previewed, send its fingerprint (or null for a failed/missing check). A changed candidate, file, root or competing save returns 409. Title input is limited to 500 characters and description to 20,000. An intentionally empty manual description stays empty.

PUT `/api/sources/:sourceId/metadata-location` accepts `{root:string|null}`. Null means adjacent files. An explicit root must exist, be a directory and not overlap writable storage. Checks retain their last valid cached fields with no-file/read-failed/stale-location status when a later check or mapping fails. Automatic preserves cached integration priority during outages.

Schema 14 adds channels.description/details_revision, sources.metadata_root and display_metadata. The latter stores a stable target key, source foreign key, identity, monotonically increasing revision, independent choices/manual text, optional local candidate JSON and last check time. Full SQLite snapshots include these rows. Overrides are presentation only; raw show keys, numbers, ordering, fingerprints and schedule entries remain unchanged. An ambiguous local-file identity replacement stops applying old choices; accepting the new identity clears the former local snapshot. Integration item references retain manual choices across provider refreshes.
