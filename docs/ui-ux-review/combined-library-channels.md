# Combined Library/Channels — selection, privacy and performance contracts

Investigation only, base `a67d418`. Code-focused architecture review supporting the independent live Library/Channels passes and owner LIB-01–11/CHA-02–04/GLO-02/09. No product changes. Existing live evidence is linked from [Library pass 1](library-pass1.md) and [Channels pass 1](channels-pass1.md).

## Current model and proposed flow

A channel has one timeline and a configuration with multiple content groups, episode ordering/rotation and commercial rules. A fixed collection stores media IDs; a dynamic show/folder reference discovers newly indexed files. Library is the permission-filtered media catalog, not a channel. Combining navigation does not require combining these domain identities or copying source media.

Proposed flow for alignment: channel cards above the catalog; Create channel/Create collection; a selection tray across catalog groups; channel wizard details → content → optional commercials/rules → preview/review → save/publish. Retain a direct dynamic-group choice as well as exact fixed-video selection. Do not silently freeze a show when placing it in a tray or make every channel depend on a saved collection.

Current Create & program already persists channel details before programming publication. A final-only Save requires either a client-only draft until final creation or an explicitly named persisted Draft state. Back must retain fields and selection; Cancel must clearly discard or retain. Preview must not publish or start conversion. Editing must preserve stable group identities/checkpoints and apply changes at the established airing boundary.

## Selection/tray contract

- Store deduplicated IDs and small labels, not media files/full technical metadata. Name the tray’s type: exact videos versus dynamic groups. Mixed dynamic/fixed content must remain understandable.
- Scope cache/tray to account and profile authority. On profile switch, sign-out, changed grants or media removal, clear or revalidate before showing/using entries. Avoid retaining another profile’s hidden titles, counts or thumbnails in a global tray.
- Select all must state visible page, all loaded rows or all matches. All-matching selection needs a bounded server-side query/token tied to filters, catalog revision and authority; do not fetch 8,000+ items into the browser merely to check them.
- Current `Library.tsx:226` clears checks when changing groups and resolves every member through `/selection` (`src/foundation-routes.ts:225`). Add paging for detail browsing; exact saved selection can be maintained separately from visible rows.
- Reauthorize at preview/save and every delivery endpoint. A stale authorized selection is not durable permission. Surface safe unavailable-item recovery without revealing hidden source names or counts.

## Search/tree contract

Directory-title search defaults to current level, optional recursive; filename mode returns matching file rows with source-relative breadcrumbs and Add. Apply only on Search/Enter. Opening a matching group must say whether it shows matching members or all members. Keep program/library/collection search labels consistent.

Use existing catalog projection/read-worker behavior and bounded queries; do not browse HDD directories or parse provider metadata for each query. A shared tree visual can have two adapters: catalog ancestors/media versus explicitly allowed mounted filesystem directories. Neither can interpret lexical prefixes as path containment, follow escaped links or leak inaccessible ancestors.

Load only direct child pages on expansion; cancel stale requests; cache loaded branches until unmount with a revision/authority key. A folder can have thousands of direct children, so expansion still requires bounded continuation even if Previous/More disappear from the primary UI. Define result limits without silently hiding the rest. Measure directory aggregation before deciding on another projection/index; preserve recent 8k+ worker responsiveness and shared-RAM limits.

## Privacy and deletion

Collections are account-owned and profile-grant filtered (`src/library.ts:654,689`). Non-admin collections with any hidden member are omitted. Private channels are owner/admin only; admin-visible private subscriptions do not grant another account visibility. Combined card counts, search, cart summaries, preview/error messages and links must preserve these rules.

Archived channel permanent deletion needs dependency/history policy; collection deletion already has retention/recovery behavior. Do not merge these destructive actions or delete originals. Profile deletion may affect future schedule renewal; separate this from deleting an account or its channels.

## Future page/global tasks and acceptance

- [ ] Global: build selection tray, explicit scoped search, bounded tree/selectable rows and shared wizard/modal/confirmation primitives; page-specific application stays on both Library and Channels.
- [ ] Library: apply tray/search/tree, bounded details and collection Apply/Cancel; Channels: apply wizard/content selection, archived behavior and readable preview durations.
- [ ] Verify exact subsets across pages; dynamic references pick up new scans; unauthorized items vanish safely; narrow controls/keyboard steps work; large result requests and rendered rows stay bounded.
- [ ] Verify cancelling before final save does not leave an unexplained active channel; no preview starts playback/encoding; late responses cannot overwrite newer drafts.

Decisions pending: combined page name/sidebar, dynamic versus fixed tray behavior, tray lifetime, Select all scope, draft persistence/final publication and deletion retention. This report supplies contracts for later implementation, not approval of these choices.
