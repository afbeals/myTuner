# My Network: channels, library and collections

Version 0.3.0 combines channel management and library browsing in **My Network**. The previous Channels and Library links remain valid entry points. **Watch TV** remains the direct place to watch subscribed channels; setup pages remain under Network Settings.

## How the parts fit together

| Item           | Purpose                                                            | Example                                       |
| -------------- | ------------------------------------------------------------------ | --------------------------------------------- |
| Source         | Indexes an existing read-only directory mounted in the server      | `/tv` or `/movies`                            |
| Library        | Shows the current profile’s authorized catalog                     | Shows, movies, custom folders and collections |
| Selection tray | Temporarily holds exact selected video references                  | Three episodes chosen across searches         |
| Collection     | Saves a fixed set of references for reuse                          | A selected movie night or holiday set         |
| Programming    | Defines one channel’s ordered/shuffled groups and commercial rules | Alternate a show and a collection             |
| Channel        | Publishes programming as one continuously advancing timeline       | After School                                  |
| Subscription   | Includes an eligible channel in a profile’s guide                  | Living Room subscribes to After School        |

One channel can contain zero or more programming groups. An empty channel keeps its identity and settings so programming can be added later. A collection does not have a broadcast clock or commercial schedule. A whole-show or recursive-folder selection is dynamic: newly scanned matching files can enter later schedule batches. A saved collection or explicit tray selection contains fixed media references. Editing a collection does not rewrite already-materialized airings or another viewer’s paused revision.

## Browse and search

The channel section opens channel information, editing and viewing actions. Its horizontally scrollable cards stay above the library. The top-level **Create channel** starts a draft wizard. **Create collection** opens the collection editor; tray actions can prefill exact selections.

The library offers two ways to find media:

- **Shows, movies and collections** shows parent cards by default. Raw TV/movie directory cards and folder-derived extras beneath an existing show are omitted. Custom sources show only their first folder level; a source-root card is kept when videos also exist directly at the root. Named collections remain cards. This changes the main page only: the existing details modal, season controls and media selections are unchanged. **Folders and file names** retains every indexed directory level for direct browsing/search. No source settings or rescan are needed. This view searches catalog titles and supports source/type filters and grid/list presentation. Enter a term and choose **Search**; typing does not issue a search for every keystroke. A matching source label alone is not intended to satisfy title-only search.
- **Folders and file names** searches indexed folder names or file names. Choose **Folder names only** or **File names only**, select an optional source/folder scope, choose whether to **Search subfolders**, then **Search**. The default folder scope is shallow. Expanding a folder fetches its direct children rather than crawling the physical share.

The folder tree is reusable in programming, source-subfolder grants and related catalog selections. It loads bounded pages, caches branches while mounted and requires explicit confirmation to apply the selected directories. Selecting a parent represents its subtree; there is no exclusion-within-parent rule. The filesystem setup picker in Sources is separate: it explicitly reads only permitted mounted/configured folders, skips links and excludes app storage.

Library artwork pages contain 24 entries. Detail and folder/file pages use bounded 50-item views. Previous/Next are deliberate actions; there is no automatic request for every remaining page. Mounted catalog views keep at most 24 response pages in memory, scoped to profile/view revision. A cached Previous page may render without another request. Refresh, identity/context changes, recognized access failures and newly observed catalog revisions clear relevant caches. Unmounting discards them. This presentation cache does not grant permission to play, edit or save stale content; the server checks those requests again.

## Profile library and administrator inspection

By default, **Your library** follows the selected profile’s **Allowed library**, including for an administrator. A profile with no grants has an empty library. Add the intended source or subfolder in **Profiles → Manage → Allowed library** before selecting it for that profile’s programming.

An administrator can check **Show all sources** to inspect the wider catalog. Cards with any ungranted videos say **Includes videos outside [profile]’s allowed library**. Opening one shows which exact videos are allowed; restricted videos cannot be selected, and an ungranted whole group cannot be programmed or used to edit a collection. The folder/file view is inspection-only while this toggle is on. Uncheck it to select permitted folders or files. Switching profiles resets the toggle and clears the previous detail view.

Inspection never changes a grant, subscription or channel. Any needed grant is an explicit, separate profile-management change. Admin-authored programming and collection saves also enforce the intended profile’s source grants on the server, so the toggle cannot bypass validation. Existing channels authored by an administrator may require the profile’s intended library grants to be configured before further scheduling/saving; no grants are added automatically.

## Select exact videos

Open a show, folder, movie or collection. Its bounded scrollable list lets you choose available videos individually. **Select all on this page** selects the current loaded page. Confirm with the **Add … videos to tray** footer button. Other pages and unopened folders are not silently selected.

The **Selection tray** remains available while browsing within the current profile. Review/remove entries, clear it, create a collection, or start a channel from its exact IDs. It holds at most 5,000 videos. It is in-memory UI state rather than a server-stored shopping cart; changing profile/signing out or leaving its mounted context can clear it. Recognized permission changes clear unsafe selections instead of retaining another context’s media. No video is moved, copied or uploaded.

Choose a whole show, season, folder or existing collection explicitly in the programming picker when a rule-based selection is desired instead. The picker stages the selected result until **Use selection** is chosen; Cancel preserves the prior group.

## Create a channel

The wizard keeps a local draft through four steps:

1. **Channel details:** name, optional short name, description and permitted visibility.
2. **Programming:** zero or more content groups, order modes, turn sizes and relevant options. Leave the list empty to create an idle channel.
3. **Commercials (optional):** source pool and timing/repeat/cutoff configuration.
4. **Preview and create:** generate an explicit preview, review it, then submit **Create channel**.

Back preserves the draft. Cancel confirms discarded changes. A preview writes no channel. The final request creates channel details and initial programming in one transaction, with a draft ID and revision guard to prevent duplicate or stale publication. Editing input after preview requires a fresh preview. A successful create does not automatically subscribe a profile.

Existing channels retain separate **Edit details** and **Edit programming** actions. Details save immediately without changing a timeline. Programming requires preview/publication; the current program and its breaks finish before the new revision activates. Archive hides a channel and removes its subscriptions/playback sessions while preserving identity/history. Restoring requires explicit resubscription. After archiving, **Delete permanently** reviews the channel’s programming, schedules/history, sessions, reports and subscriptions before removing those database records together. A stale review must be refreshed. Source media, collections, catalog entries, generated/cache files, unknown files, backups and other channels are preserved. Active channels must be archived first.

## Profiles, subscriptions and privacy

Profiles are people/rooms with account access, library grants, optional PIN and channel subscriptions. Administrators manage profile identity/access/grants; permitted editors can manage the operations authorized for their profiles. A profile owner with the viewer role remains unable to edit programming.

On a profile card, **Subscriptions for …** opens the channel checklist and lineup order. Changes remain staged until **Save subscriptions**. The list includes only eligible channels visible to the current account. A locked viewing profile may require its PIN. Changing subscriptions grants no source access.

Private channels are visible only to their owning account and administrators, including inside subscription dialogs for shared room profiles. Another account does not see a placeholder, title or private-channel count. If an administrator subscribes a room to someone’s private channel, unauthorized room members still cannot discover or watch it. The server enforces this on library/channel results, previews, guides and media delivery.

## Watch and maintain

**Watch TV** joins a subscribed channel live. The layout places the player/current program and playback information beside profile/channel choices and related actions. Pause/Resume, Go Live, volume/mute, alternate embedded audio, supported subtitles and caption appearance remain available. The frozen picture, program title, Paused label and frozen timing identify a paused session even when optional controls are hidden. A missing track is a format/availability issue rather than a removal of its menu. [Client controls](CLIENTS.md) and [subtitle setup](SUBTITLES.md) describe the supported formats.

Metadata editing is independent of programming: **Edit information** selects provider/local/manual title and description candidates without changing file paths or episode order. Source and subtitle configuration save in their own management dialog. See [first channel](FIRST_CHANNEL.md), [metadata editing](METADATA_EDITING.md), [large-library behavior](LARGE_LIBRARY.md) and [security](SECURITY.md).

## Empty programming and permanent channel deletion

You can create a channel without content or remove its last content group in **Edit programming**. Continue to review, choose **Review empty programming**, then **Save empty programming**. The current program and associated breaks finish before the empty configuration takes effect. No later programs or standalone commercials are scheduled. Existing paused sessions retain their earlier timeline; new viewers see no scheduled programming after the boundary. Adding content later starts a new schedule. Health status identifies an intentionally empty channel as `empty`, rather than expired.

Archiving remains reversible and ends channel playback/subscriptions. To remove a channel completely, select **Archived**, open the channel and choose **Delete permanently**. The in-app confirmation names the channel and lists its retained schedule, playback, report and subscription counts. Confirming removes that channel's content groups, settings, schedule revisions/entries/checkpoints, rotation state, playback sessions/history, reports and subscriptions together. A changed review is refused; refresh and review the updated channel before retrying. Cancelling changes nothing. Permanent deletion cannot be undone through Restore channel.

This deletion changes database records only. Sources, the library catalog, collections, original videos, subtitles, local metadata, generated/cache files, unknown files and backups remain intact. Other channels using the same videos remain intact. Owner/editors may delete their own archived channels; administrators may delete any archived channel. Another account's private channel remains invisible.

## Programming edits while someone is behind live

An edit finishes the current broadcast airing before new settings become effective. Paused/delayed viewers finish their own current airing and original breaks, then automatically follow the shared updated timeline while retaining their delay. They do not need to press Go Live for normal updates. A viewer thirty minutes behind reaches a 9:00 broadcast change around 9:30. Earlier historical airings keep their original commercials.

An old session whose timeline already diverged may show a Go Live recovery message instead of an unsafe jump. That exception needs Go Live, switching channels or reopening playback. Archive/restore preserves a channel’s schedule and progress; it does not restart the show. See [playback behavior](SCHEDULING_AND_PLAYBACK.md#delayed-viewing-handovers-and-compatibility--schema-22).
