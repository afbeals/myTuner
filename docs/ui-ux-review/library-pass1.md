# Library — pass 1

Route `#library`; base `a67d418cf7258e669b11fcc9cae63cdc1bcda92d`; 2026-11-26. Investigation only, synthetic fixture port 19004. Inspected rendered desktop 1440×1000 and narrow 390×844 screenshots, details/collection modals, localhost and ordinary HTTP `mytuner-review.test`.

## Evidence and current concepts

Evidence directory: `/private/tmp/mytuner-ui-review/library-p1/`. Visually reviewed `01-desktop.png`, `02-show-details-desktop.png`, `04-library-narrow.png`, `05-details-narrow.png`, `12-collection-search-preserved-subset.png`; corresponding ARIA snapshots, `collection-created.json`, `privacy-sam.json`, `privacy-channels-sam.json`, and `search-and-confirm.json` record interactions.

**LIB-01:** Library is the authorized media catalog, not a channel list. Sources are scan roots; folder cards represent catalog groups. Saved collections hold fixed media-ID references, without copying originals. Show/folder programming selectors remain dynamic after scans. Channels have one live timeline and one programming configuration containing multiple rotating groups, plus commercial rules—not one video/program. Library’s whole-selection action opens channel creation; saving channel details precedes programming publication (`web/src/App.tsx:431`, `Channels.tsx:450,723,1027`).

Collections are account-owned, filtered by current profile source/subtree grants; any hidden member hides the collection. Editor management also requires profile-management authority. Admin bypasses grants and ownership. Runtime `sam` saw the permitted episodes but neither admin-created collection; its channel API returned only shared After School, excluding the other account’s private channel and admin’s new private draft. Private-channel invisibility does not mean underlying, independently granted source media becomes private (`src/library.ts:161,654,689`, `src/security.ts:224,303,337`, `src/server.ts:1471`). The subtitle “Only media this profile is allowed to use” needs an admin-scope qualification.

## Ranked findings and owner dispositions

### L1-01 · P2 · bug / owner request — narrow details and unbounded content

**LIB-05; GLO-01,06.** Desktop Details/Edit information are already inline, touching; narrow rendering stacks them in a roughly 55px column beyond the visible table. Two videos produce 1571px dialog content inside a 758px viewport; actions sit below the fold. `.table-scroll` bounds width only; the dialog header/footer scroll away (`Library.tsx:564`, `styles.css:371,541`). Apply bounded/virtualized media rows and responsive inline actions or stacked video cards, with persistent Close/primary actions. Acceptance: 390px and long lists retain readable actions, keyboard reachability and visible completion controls. Bound selection API/DOM work too: `/selection` currently returns every resolved member (`src/foundation-routes.ts:225`); a CSS height alone does not protect shared RAM.

### L1-02 · P2 · owner request — selection is local, not a cart

**LIB-04,06.** Exact checked subsets already create collections: checked Maple Street alone, saved, then edited membership to The Last Platform alone, preserving collection ID. Collection editor retains selected items across search. Library details lack Select all and Apply; changing the selected group clears checks (`Library.tsx:226`). Whole-selection channel handoff deliberately passes the dynamic group, ignoring checks; live handoff showed All files despite one checkbox. Add explicit “Add selected videos (N)” and separate dynamic-group action; apply a persistent tray across groups/search/pages. Acceptance: collect A and B from different groups; save exactly A+B; Select all affects only stated scope, excludes unavailable rows; Cancel preserves the agreed draft behavior.

### L1-03 · P2 · owner request — search semantics obscure matches

**LIB-09,10,11; GLO-09.** Typing E01 automatically fetched results; returned Orbit Patrol and TV shows, then folder details included E02 too (`06/07` screenshots). Search matches display/stored titles, relative paths, series/collection names and source names, then returns containing groups/ancestors (`src/display-metadata.ts:213`, `src/library.ts:321,543`). This explains apparently unrelated directories; the exact `_waiting_ignore/_SORT` case was unavailable. Library has no folder drill-down/current-level mode; collection Find videos offers file rows, but no directory restriction/cart. Apply explicit Search/Enter to Library and collection search (both debounce 200ms), and the wizard picker. Offer folder-name/current-level defaults, explicit recursive scope, filename results with source/path and Add. Acceptance: folder-only search cannot match an episode title; file results identify the matched file; opening a group clearly distinguishes matching members from full membership. Retain bounded, read-only catalog queries; do not rescan disks on searches.

### L1-04 · P2 · owner request — combined page/wizard requires alignment

**LIB-02,03: missing proposal.** Library has Create collection; Channels separately has Create channel and Content/Commercials/Preview editing. Consider authorized horizontal channel cards above the catalog and both create actions. Wizard: details → content/collections → programming/optional commercials → review/save, with Back and retained draft. Preserve direct show/folder references alongside fixed collections. Acceptance: narrow layouts, private-card/count exclusion, draft restoration, final preview and explicit save boundaries. Decide whether Cancel before final save leaves any server draft; current Create & program already creates a channel. Avoid fetching every channel schedule or entire library to build the combined view. Revalidate archived targets before opening combined cards/sidebar; the owner’s archived-item repetition report needs its separate targeted reproduction.

### L1-05 · P3 · owner request — distinguish source roots

**LIB-07; GLO-04,05.** Renaming synthetic TV shows to `test:channel` reproduced a same-named **Folder** card (`11-source-name-folder-card.png`), without creating a channel. The custom-path variant was not separately reproduced. `Library.tsx:97` uses the source name when directory is empty. Apply explicit Source root/Folder/Saved collection badges and source-relative breadcrumbs; keep concise dynamic/fixed consequences visible, optional explanations in accessible information controls. Acceptance: identical source/channel names remain distinguishable.

### L1-06 · P3 · owner request — browser confirmation remains

**GLO-08.** Closing a dirty collection produced native `confirm`: “Discard unsaved collection changes?” (`search-and-confirm.json`, `CollectionEditor.tsx:60`). Apply shared in-app discard confirmation to collection/metadata/subtitle editors; keep browser-owned tab-close protection. Acceptance: Stay retains draft; Discard closes; keyboard focus returns correctly.

**LIB-08: not reproduced.** Browser creation/edit and API readback worked. LAN creation also worked with `isSecureContext=false` and `crypto.randomUUID` undefined (`08-lan-collection-success.png`). Collection IDs are server-generated; Channels’ group creation uses browser UUID separately (`CollectionEditor.tsx:87`, `src/library.ts:655`, `Channels.tsx:1065`). No blanket collection repair is justified.

## Shared work, decisions, cleanup

Global candidates: sticky modal shell, responsive selectable-media rows, selection tray, explicit search controls, accessible information/discard dialogs. Library adoption tasks remain L1-01–06. **GLO-02:** adapt a lazy catalog tree with bounded direct-child pages, branch cache until unmount, Apply/Cancel and authorization revalidation; filesystem mount browsing is a different permission boundary. **GLO-03:** Library capitalization is already correct; combined sidebar ordering awaits owner choice. **GLO-10:** no CSP violations; startup 401s and an expected referenced-source-kind-change 409 were recorded. **GLO-07,11:** player pause and programming Actual seconds are outside this Library surface.

Alignment: confirm combined navigation, tray lifetime/profile switching, fixed versus dynamic choices, Select all scope, and when final wizard save creates/publishes. Preserve collection deletion retention/dependencies and hidden-item exclusion. Browser/extra contexts and isolated fixture closed; cleanup probe recorded in `cleanup-proof.json`. No install, build, commit or source-media change.
