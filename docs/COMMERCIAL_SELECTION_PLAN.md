# Commercial pool selection: research and proposed implementation

> Research proposal — implementation is pending owner selection. Recorded during the 0.3.1 follow-up; this document describes future behavior, not a delivered feature.

Status: plan only, 2026-11-27. No application code/tests, dependencies, media, or repository documentation were changed for this research. Findings reflect the current uncommitted working tree in `afbeals/myTuner`, not a released or fully verified build. Account/profile-scoped library reads and explicit administrator inspection are being implemented in parallel and remain pending final verification. This plan builds on those changes. Live-guide presentation is a separate workstream.

## Recommended outcome

Use one **Choose commercials** dialog in both **Create channel → Commercials** and **Edit programming → Commercials**. Offer two clear ways to build a pool:

1. **Folders — include future scanned clips:** select one or more folders, across permitted commercial sources, with an explicit **Include subfolders** choice for each selected folder.
2. **Specific clips — keep this exact list:** check individual commercial clips across folders/sources; retain the basket while navigating, searching, changing sources, and paging.

Show the pool summary beside **Change selection** and **Remove commercials**. Keep break timing, variation, cutoff, and preview controls in their existing section. Applying a picker selection changes only the programming draft; preview and publication remain the existing explicit steps.

Use the approved Silver Signal components/styles. This is a focused selection improvement, not a new general library or TV interface.

## What exists, and what is new

| Area                   | Inspected behavior today                                                                                                                                                                                                                                                | Proposed work                                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stored selection       | `Programming.commercialSelection` is one general `Selection` union. A media selection already accepts 1–5,000 IDs, including IDs in different folders/sources; a folder stores source ID, relative directory, and recursion. Saved collections are also supported.      | Expose exact multi-clip selection; add a bounded commercial-only multiple-folder variant.                                                                                                                   |
| Folder behavior        | `selectMedia` resolves a folder against current available authorized catalog rows. Recursive and shallow semantics already exist at the model/resolver level.                                                                                                           | Compose several folder scopes without freezing them to today's media IDs.                                                                                                                                   |
| Commercial controls    | `ProgrammingRules.tsx` has a pool dropdown, a general picker entry, and a folder shortcut. The shortcut selects one folder and hardcodes `recursive: true`.                                                                                                             | Replace the fragmented entry points with one seeded commercial picker and a concise readable pool summary.                                                                                                  |
| General picker         | `SelectionPicker.tsx` selects one result. Choosing another replaces it. Its path browser is explicitly `selectionMode="single"`. Commercial call sites currently do not pass the saved commercial pool into its `current` prop.                                         | Dedicated commercial picker initialized from the complete saved draft. Preserve general content-group selection behavior.                                                                                   |
| Folder primitive       | `DirectoryTree.tsx` has optional multi-selection, lazy child pages, virtualization, bounded cache, aborts, error states, and up/down focus movement. It handles one source per tree. Its inherited-selection logic assumes selected parents always include descendants. | Reuse its paging/focus infrastructure; make commercial selection recursion-aware and retain cross-source choices in the parent basket. Do not reuse the recursive-parent assumption for shallow selections. |
| Catalog primitive      | `CatalogBrowser.tsx` exposes file/folder searches, source restriction, folder navigation, search recursion, paged results, and multiple-file add callbacks.                                                                                                             | Add checkbox/toggle integration and a commercial-only filter; distinguish search recursion from pool recursion.                                                                                             |
| Indexed reads          | `/catalog/tree` and `/selection` read compact SQLite projection rows, hydrate only requested page data, and run through the bounded catalog worker for file-backed databases.                                                                                           | Extend this path, including worker protocol, cancellation, limits, and fresh-authority checks. No filesystem walk on open/search/select.                                                                    |
| Commercial eligibility | `CommercialEligibility.tsx` pages the current pool and stores per-channel exclusions in `disabledCommercialIds`; changing/removing a pool currently clears exclusions.                                                                                                  | Resolve new multiple-folder pools through the same membership rules; make exclusion reset policy explicit.                                                                                                  |
| Source validation      | `ProgrammingService.material()` rejects available commercial members whose source kind is not `commercials`. The UI currently offers some `videos`-kind pools and a general picker containing other kinds.                                                              | Offer only commercial content and validate submitted component sources before availability filtering; avoid a false impression that ordinary videos are supported ads.                                      |
| Collections            | A pool may reference a saved collection. Its exact references change only through collection editing; future schedule batches re-resolve that saved collection.                                                                                                         | Preserve saved collection references and display them accurately. Do not silently flatten them into clip IDs or discard them on opening the new picker.                                                     |

Important performance qualification: the current catalog projection has source/order indexes, but filename searches use SQL substring matching and directory browsing derives paths from projection rows. It is not a dedicated filename full-text index or a precomputed directory index. Bounded responses and off-thread execution do not by themselves guarantee bounded query work.

## Proposed interaction details

### Entry and draft lifecycle

- When empty, show **No commercials** and **Choose commercials**. Private new channels continue to start with no commercials.
- When selected, show **3 folders · includes subfolders** or **12 specific clips**, with source-relative context accessible in an expandable summary. For mixed recursion, say **3 folders · mixed subfolder settings**. Retain an accurate saved-collection summary for legacy/current collection pools.
- Opening the dialog seeds its local basket from `config.commercialSelection`. Existing folder selections become one selected folder; media IDs are hydrated in bounded selected-item pages, including unavailable retained references.
- **Use selection** applies once to the existing programming draft; **Cancel**, Escape, and Close leave that draft unchanged. The nested picker participates in the existing dirty-close/navigation protection when its basket has changed. A no-op Apply should not invalidate a current preview or reset exclusions.
- Keep separate pending baskets if the user explores the two picker modes. Clearly identify the active mode. Applying uses that mode only. Do not silently merge folder scopes with exact IDs or convert a dynamic folder into a snapshot.
- A saved collection pool opens with **Current pool: [collection]** and **Keep current pool**. Selecting a replacement mode is deliberate. Existing collection selection can remain an advanced existing-pool path if retained in this UI; a full saved-collection management redesign is outside this task.

### Folder mode

- Use a source selector listing only commercial sources permitted for the target profile; display source-relative folder paths and breadcrumbs. The source root is an explicit **Entire source** choice.
- A checkbox selects a folder independently of opening/expanding it. The selected-folders tray persists across source changes. Each selected row has **Include subfolders**, initially on for a newly added folder, and Remove.
- Explain: **New clips found by future scans join this pool.** A shallow folder includes files directly inside it only. Pool recursion cannot expose media that the source scan never indexed.
- Keep one row per `(sourceId, normalized directory)`, with an editable recursion flag. Selecting an already selected row toggles/removes it rather than duplicating it.
- Overlapping folders contribute each media ID once. A recursive parent can visually mark selected descendants as already covered, but shallow parents must never disable their descendants. Avoid silently deleting explicit child choices when toggling parent recursion.
- Show last-scan available counts that reflect each row's recursion; the total pool count must be a distinct union, not the sum of overlapping folder counts. State that these are indexed scan results. Existing offline/source inspection notices still apply.

### Specific-clip mode

- Browse folders and search filenames, with optional title search if explicitly offered by the implemented API. Filename substring search must not be mislabeled as title search or exact-token matching.
- Default to searching within the selected folder with **Search subfolders** as a separate scope control. Offer an obvious **All permitted commercial sources** search so clips can be found across folders without manually drilling every branch.
- Checkboxes remain checked on returning to a source, folder, search, or page. Use IDs as identity; same-named files show source name and relative path. Deduplicate additions by media ID.
- Show a persistent selected count and **Review selected** tray/list with Remove, Clear selection, title, relative path/source, and availability. Page this list too; do not render 5,000 selected rows at once.
- Copy: **Only these clips are included. Newly scanned clips are not added automatically.** Selecting references does not move/copy/edit media.
- Preserve selected IDs through ordinary empty results, loading, retryable errors, search resets, and mode exploration. Unavailable existing clips remain visible and retained; new unavailable choices are disabled. Resolve removed/revoked references safely and require deliberate repair before using a replacement pool.
- Do not add an ambiguous “Select all” over a paged/search result. A future bulk feature would need a separate explicit scope/limits design.

### Accessibility and narrow layouts

- Reuse `Modal`'s native dialog, labeled heading, focus containment/restoration, fixed footer, scrollable body, and dirty-close confirmation. Keep the picker one dialog deep where practical; an optional tree chooser must preserve nested Escape/focus behavior.
- Use real labeled checkboxes and fieldsets/legends or correctly implemented tabs/radios. Give repeated controls source/path context: **Include Brand X/1990s in Commercials**, **Remove Brand X/1990s**, **Include subfolders for Brand X/1990s**.
- Keep expand/open and selection as distinct keyboard controls. Space toggles a focused checkbox; Enter submits search or activates a button. Verify focus across virtualized rows, page changes, removals, and retry states. Do not label the widget an ARIA tree unless its complete tree keyboard contract is implemented.
- Announce selection counts and completed result counts in a restrained live status area. Do not move focus on each query response. Pagination should have a stable, sensible focus target.
- At 390px, stack controls and put the review tray behind an accessible disclosure if needed; keep selected count and **Use selection** reachable. Long paths wrap without horizontal page overflow, clipped labels, or footer obstruction. Desktop can place results and review side by side using existing Silver Signal panels.

## Data contract and API design

### Commercial-only extension

Keep `Selection` unchanged for ordinary content groups and collections. Introduce an explicit `CommercialSelection` schema/type that accepts existing selections for backward reading and adds a flat folder-set variant, for example:

```ts
{
  type: "folders",
  folders: [
    { sourceId: "…", directory: "Brand X", recursive: true },
    { sourceId: "…", directory: "Station IDs", recursive: false }
  ]
}
```

Use the existing `{ type: "media", ids: [...] }` for specific clips. Use the existing single-folder representation when practical for unchanged single-folder pools; no eager data rewrite is required. New UI writes only supported commercial folder/media choices, plus an explicitly retained saved-collection choice. Do not introduce arbitrarily nested unions, folder exclusion grammars, weighting, or a mixed folder-plus-file pool in this change.

Validate 1–100 folder descriptors initially, a normalized relative directory length cap consistent with the 4,096-character tree API, UUID source IDs, and booleans. Retain the existing 5,000 exact-ID bound. Reject malformed/duplicate descriptors or normalize them deterministically with documented behavior. Never accept raw host paths, `..`, escaped roots, or separator tricks. Do not require a real disk folder probe to validate a catalog-relative scope.

### Resolve membership once, consistently

Create a commercial-aware resolver shared by programming materialization, pool summary/eligibility pages, and channel draft-copy validation. It must:

- evaluate target-profile authority and current grants, including administrator-created programming;
- verify all referenced sources are commercial sources, including empty/unavailable selections, and validate exact IDs/collections without leaking hidden items;
- select available authorized rows, union/deduplicate by media ID, and apply the channel's disabled IDs afterward;
- avoid calling the current whole-source `catalog(...).filter(...)` path once for each selected folder; use one set-based SQL match over bounded folder descriptors, with component-boundary semantics;
- produce stable new folder-union ordering so checkbox/navigation order cannot add weights or arbitrarily change seeded choices;
- preserve existing saved-config behavior, unknown/unavailable semantics, and prior per-ID commercial counters/cooldowns unless a separately approved rule change is made.

The existing general `/selection` request schema should remain unchanged. Recommended new route: `POST /api/profiles/:profileId/commercials/selection`, accepting `CommercialSelection`, with bounded offset/limit/search/includeUnavailable, returning authorized compact items, distinct total, availability summary, and catalog revision. Use it for the picker review and `CommercialEligibility`. Internally reuse the catalog worker operation/predicate infrastructure rather than implementing a second unbounded reader. An alternative is extending `/selection` with the new variant; prefer the dedicated route to keep the general contract and consumers narrow.

Add a server-enforced commercial source-kind filter to catalog tree/file queries, e.g. `sourceKind=commercials`. Apply it before counts, grouping, paging, and source enumeration. Preserve existing `includeCommercials` behavior for other callers. Passing `sourceId` for a non-commercial source to the commercial path must not return its content. If title search or saved-collection suggestions are included, their predicates must be commercial-only and authorized too; filtering the first result page in the browser is insufficient.

Carry new input through `src/catalog-protocol.ts`, `catalog-service.ts`, `catalog-worker.ts`, and response publication checks. Include access mode/source-kind in request/cache identity. Use `access=profile` for all selectable content. Explicit `access=all` is administrator inspection only; disable selection and reject attempts to publish outside target grants. Do not add an inspection mode to the picker merely because the general library has one.

### Compatibility, persistence, and scheduling

- Change `commercialSelection` in `src/contracts.ts` and `web/src/types.ts`; do not widen `Programming.groups[].selection`. Export the new JSON schema through `/api/contracts` and document its contract/version capability decision.
- Update every commercial consumer, including `ProgrammingService.material`, saved config parsing, `CommercialEligibility`, `ProgrammingRules` summaries, wizard/editor copied drafts/conflict review, and `/draft-copy` validation in `foundation-routes.ts`.
- Existing folder/media/collection JSON must round-trip without forced conversion. Opening/canceling/editing unrelated rules must preserve the original pool and unavailable retained references.
- Config is already stored in revision JSON, so the folder-set feature itself need not add tables or rewrite old revisions. Any performance index/projection changes require an appended migration and migration tests.
- An older binary cannot parse new folder-set JSON. Document that rollback limitation even if no database schema number changes; choose an explicit contract/app compatibility marker before release. Do not claim transparent downgrade compatibility.
- Folder pools remain dynamic when future schedule batches resolve the scanned catalog. Exact media pools keep their IDs; saved collection pools follow explicit collection membership edits. Already materialized airings do not change just because a scan finds new clips.
- Publishing an edited pool keeps the current program and associated commercials, activates at the established boundary, preserves retained paused-session revisions, and stores exact newly scheduled commercial choices. Preview remains read-only and an exact-current-draft preview is required for publication.
- Cutoff/whole-commercial policy, six-second strict default minimum, count/duration caps, cooldown, per-break repeats, and no-dead-air early returns remain unchanged. In current code the appearance allowance is a pool accounting cycle: counts reset when all current pool clips reach the allowance; it is not a daily/lifetime cap or necessarily a content-rotation boundary. Use accurate copy.
- Preserve counters/cooldowns for retained media IDs across pool edits, as the existing state behavior does. Deduplicated overlap must not increase a clip's selection weight or appearance allowance.

## Performance, privacy, and storage requirements

- Opening/browsing/searching/selecting reads indexed catalog metadata only. No scan, ffprobe, FFmpeg, preview generation, directory walk, media copy, sidecar, or source write is triggered.
- Keep 50-row default pages / 100-row maximum, bounded search length, folder/ID limits, finite selected-item hydration, byte-bounded compact DTOs, the existing worker queue/timeouts, and cancellation on close/profile change. Do not hydrate full descriptions/technical metadata to show a selection list.
- Reuse catalog revisions, abort/request identity guards, and fresh-authority validation before sending responses. Reset profile/account-scoped baskets and caches on identity changes. On grant revocation, discard protected names/paths/counts immediately; retain only safe opaque saved state if needed for explicit repair, never display cached unauthorized labels or silently publish a reduced pool.
- Ordinary loading/network errors preserve the local basket and permit retry. Permission denial requires a clear neutral repair state and revalidation; it must not masquerade as a successful empty result.
- Store only references/selection descriptors in programming JSON. Keep picker state in memory, without localStorage persistence of private paths. No new media derivatives or source copies.
- Measure large and deeply nested synthetic catalogs through the production file-backed worker, including overlapping scopes and concurrent reads. Record query work, response size, heap behavior, and event-loop responsiveness; avoid a promise of O(page size) search.
- If repeated derived-directory queries dominate measured time, add a catalog-owned directory projection and appropriate `(generation, source_id, relative_path)` / directory membership indexes through an appended migration. Require evidence before introducing an FTS/search service or a large new indexing subsystem. Retain scan-revision consistency and source-kind/grant predicates in any optimization.

## Phased delivery

### Phase 1 — settle contracts and behavior

Confirm the owner decisions below, finalize compact desktop/narrow interaction sketches using existing components, and document `CommercialSelection`, recursion/overlap, unavailable/error, exclusion, and compatibility semantics. Re-read the now-completed parallel channel/profile changes before editing their files. List every commercial consumer and add contract/resolver regression coverage first.

### Phase 2 — commercial model and bounded reads

Implement the schema/type, shared resolver, commercial-only catalog filtering, new paged selection endpoint, worker transport, distinct union counts, and commercial-aware draft-copy validation. Keep saved single-folder/media/collection configs compatible. Add any demonstrated necessary indexes with an appended migration. Verify real SQLite/API/grant behavior before wiring the picker.

### Phase 3 — one reusable commercial picker

Implement `CommercialSelectionPicker.tsx` plus a pure basket/normalization helper where useful. Extend shared browser/tree primitives only through narrow props, keeping existing library/source/grant callers stable. Deliver folder-set tray with per-folder recursion, multi-clip checkboxes and retained review tray, seeded reopen, apply/cancel/no-op behavior, and explicit error states.

### Phase 4 — wizard/editor integration

Use the same picker in Create channel, Edit programming, and copied drafts. Replace the conflicting generic-picker/folder/dropdown entry points while preserving saved collections and existing break controls. Update eligibility paging, summaries, exact-draft preview invalidation, dirty navigation, exclusions handling, profile/account reset, conflict review, and copy round trips. No guide redesign or native toolchain work is needed.

### Phase 5 — verification and documentation

Run focused tests first, then required existing local format/typecheck/build/backend and relevant browser checks using already installed tools with npm offline mode. Review new/changed screenshots deliberately. Record actual commands/results/limitations in `docs/VERIFICATION.md`; update `CHECKLIST.md`, backend/contracts, scheduling, UI coverage, and current plan docs for delivered behavior only. Do not install/download a missing tool or resume deferred emulator work. Commit/push/deploy only under the separately authorized implementation task.

## Meaningful test coverage

### Unit/service/API (existing `node:test` + tsx patterns and real temporary SQLite)

- Folder matching matrix: root, shallow, recursive, sibling prefix boundaries, nested scopes, overlapping parent/child, duplicate descriptors, multiple sources, paths with spaces/Unicode, source scan nonrecursion, and malformed/escaping paths.
- Media union is unique and stable; same clip through two folders is one pool member. Exact IDs across folders/sources work; same filenames remain distinguishable. Limits reject overlarge requests before expensive resolution.
- Dynamic folder additions/removals affect future resolution; fixed media lists do not acquire newly scanned clips. Offline scan behavior preserves last successful catalog semantics. Authorized unavailable existing IDs remain retained; unknown/hidden IDs do not leak metadata.
- Commercial source-kind enforcement covers folders/media/collections, including mixed collections and unavailable/non-commercial inputs; non-commercial folders with zero matches cannot evade component validation.
- Admin/editor/viewer, own/other profile, subtree boundaries, explicit admin inspection, forged IDs/source IDs, source deletion, grant revocation during worker reads, role/PIN/session changes, and counts/previews all maintain current privacy rules.
- Legacy folder/media/collection config reads, no-op/unrelated-edit round trips, copied drafts, conflict recovery, restart/reopen, rollback/capability contract expectations, and any migration.
- Program preview/publication consumes the same eligible distinct pool; excludes disabled IDs; no-op retains exclusions. Test approved pool-replacement exclusion behavior, including all-disabled and retained out-of-pool IDs.
- Seeded scheduling survives append/restart; retained counters/cooldown remain effective after pool edits; overlap adds no weight. Existing cutoff/minimum/whole-fit/repeat/early-return tests remain green. Preview writes no schedule rows; edited pools activate after the current program/break boundary and retained paused revisions survive.
- Large synthetic file-backed worker regression: paged folder/file/membership reads, many nested/overlapping selections, bounded hydration/DTOs/queues, cancellation, current authority after async work, and no source disk probes. Extend existing catalog worker/hot-path tests rather than relying on an in-memory fake to establish performance.

### Browser behavior (existing Playwright synthetic fixture)

- In both creation and editing, select nested Folder A recursively and Folder B shallowly; change sources/pages; return with all selections and recursion settings intact; apply, preview, publish, reopen, and inspect the actual saved config.
- Select clip A, browse another folder, select clip B, search an unrelated filename, page, clear search, review/remove a selection, and confirm both retained checks and saved exact IDs. Cancel after edits leaves saved/draft state unchanged.
- Reopen a pool with more than 50 selections and unavailable references; hydrate/paginate safely. Cover empty, loading, error/retry, no permitted commercial sources, revoked grants, late responses, profile change, and an explicit legacy collection pool.
- Verify no-op Apply, exclusion reset warning/preservation policy, unrelated commercial-rule edits, tab switches, draft close/navigation protection, stale preview invalidation, copied-channel pools, and conflict review.
- Keyboard-only path through entry, mode choice, folder expansion/selection, recursion, search, selection tray, removal, paging, Apply and Cancel/Escape; focus stays in nested dialogs and returns correctly. Assert selection/status names and run the installed axe integration; complement automated checks with human screen-reader review.

### Visual and responsive

Capture reviewed stable synthetic states at existing 390px and 1440px sizes, plus a compact viewport if layout changes there: folder mode with mixed recursion and long paths; clips selected across searches; selected review list; empty/no-access/error/retry; saved unavailable item; exclusion warning if used. Assert geometry/no horizontal overflow and footer visibility separately from screenshots. Reuse existing font/token/panel/focus styles. Browser checks do not establish physical TV acceptance, and no TV/emulator verification is implied.

## Acceptance criteria

1. Both channel flows share the same commercial picker, and reopening faithfully reconstructs a saved pool.
2. A user can choose at least two nested commercial folders with different recursion settings and retain them while changing sources or browsing.
3. A user can choose specific clips in several folders, search/page elsewhere, and keep exactly those choices until deliberately removed.
4. Folder pools admit later scanned authorized clips; exact pools do not. Root/shallow/recursive behavior is explicit and correct.
5. Overlap and repeated selection never duplicate clips or increase scheduling weight.
6. Ordinary videos/shows/movies cannot enter a commercial pool through UI, forged requests, collections, or empty-source loopholes.
7. Only the target profile's permitted content and counts are selectable, including for administrators; inspection never grants programming authority.
8. Apply changes one draft; Cancel is lossless; no-op Apply preserves draft/preview/exclusions; actual edits require a fresh preview and existing safe publication boundary.
9. Existing folder/media/collection pools remain usable without a forced rewrite. Copy/conflict/restart paths support the new representation.
10. Existing commercial placement, variation, cutoff, and paused-revision behavior remains verified.
11. Browsing and selection perform no source writes, scans, media copies, generation, or disk probes and stay within documented request/client/worker bounds on the synthetic large-catalog case.
12. All controls work by keyboard at narrow/desktop widths with visible focus, contextual names, understandable states, and reviewed screenshot coverage.
13. Actual verification, compatibility limitations, and outstanding human acceptance are recorded; no installation, deployment, or real-media mutation is implied.

## Owner decisions for review

These are design choices for the planned implementation, not permission requests to perform research:

1. **Modes:** recommend folders OR exact clips per pool, with separate pending baskets and no mixed folder-plus-clip union. A combined mode/exclusion grammar is a larger feature. Confirm whether mixing is actually needed now.
2. **Recursion default:** recommend Include subfolders on for newly selected folders (matches existing commercial behavior), explicitly adjustable per selected folder. Search subfolder scope remains independent.
3. **Exclusions on pool edits:** recommend retain established clear-on-replacement behavior for the first delivery, warn before applying a changed pool when exclusions exist, and preserve them on a no-op. Preserving the intersection during additive edits is useful but changes today's policy and requires a deliberate decision/test change.
4. **Saved collections:** recommend preserve and accurately display existing collection references, with a secondary route to existing saved commercial collections if needed. Do not silently snapshot them. Decide whether collection selection remains visible in the simplified first-screen flow.
5. **Initial bounds and compatibility:** recommend 100 folder scopes and existing 5,000 specific-clip limit, subject to measured budgets; release notes/capability handling must state older binaries cannot consume new folder-set JSON. These are technical defaults to validate, not guarantees already supported.

## Principal inspected files

- Product/security/verification constraints: `AGENTS.md`, `docs/MYTUNER_PLAN.md`, `docs/SELECTED_DESIGN_BRIEF.md`, `docs/DESIGN_BRIEF.md`, `docs/DESIGN_REVIEW.md`, `docs/DEVELOPMENT.md`.
- Picker/UI: `web/src/ProgrammingRules.tsx`, `SelectionPicker.tsx`, `DirectoryTree.tsx`, `CatalogBrowser.tsx`, `CommercialEligibility.tsx`, `CollectionEditor.tsx`, `Channels.tsx`, `ChannelWizard.tsx`, `types.ts`, `ui.tsx`, `styles.css`.
- Contracts/resolution/security: `src/contracts.ts`, `library.ts`, `catalog-selection.ts`, `catalog-service.ts`, `catalog-protocol.ts`, `foundation-routes.ts`, `programming.ts`, `scheduler.ts`, `security.ts`, `database.ts`, `channel-lifecycle.ts`.
- Relevant test patterns: `test/catalog-worker.test.ts`, `catalog-projection.test.ts`, `catalog-request.test.ts`, `data-hotpaths.test.ts`, `programming.test.ts`, `scheduler.test.ts`, `round6.test.ts`, `round7.test.ts`, `e2e/channel-workflows.spec.ts`, `round7.spec.ts`, `ui-overhaul.spec.ts`, `client.spec.ts`, and `playwright.config.ts`.

Research used read-only source inspection only. No tests were run for this planning task, and no claim of newly verified behavior is made.
