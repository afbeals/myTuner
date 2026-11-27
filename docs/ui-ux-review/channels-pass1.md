# Channels — owner-request review, pass 1

Investigation only. Base `a67d418`, application/browser 0.2.2, branch `review/ui-ux-page-audit`. Reviewed Channels and nested programming/content picker at 1440×1000 and 390×844 with isolated synthetic media. Screenshots were visually inspected, including narrow programming editor and LAN selection failure. No product code, tests or baselines changed.

Evidence: `/private/tmp/mytuner-ui-review/channels-p1/` and `/private/tmp/mytuner-ui-review/channels-p1search/`, especially `results.json`, `desktop-selected.png`, `narrow-program-editor.png`, `lan-select-error.png`, `search-test-folder-results.png`, and `archived-channel-actions.png`. Scripts: `/private/tmp/mytuner-review-channels-p1.mjs` and `/private/tmp/mytuner-review-channels-search.mjs`.

## Owner-item coverage

| Item                     | Disposition                                                                                                                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CHA-01                   | Initial active-channel checks did not reproduce it. After owner clarification, the separate [archived follow-up](channels-archived.md) confirmed repeated DOM headings at roughly one per second.        |
| CHA-02; GLO-09           | Misleading grouped search reproduced. Current search intentionally matches descendant filenames and other metadata; displayed folder names need not match. Missing explicit search scopes are confirmed. |
| CHA-03; LIB-03           | Requested wizard is a UX change. Preserve direct dynamic show/folder selection alongside fixed collections and retain draft on Back.                                                                     |
| CHA-04                   | Requested permanent deletion is absent. Current DELETE endpoint soft-archives; archived UI offers Restore. Retention needs an explicit decision.                                                         |
| CHA-05                   | Confirmed P1 failure on ordinary LAN HTTP when adding a new programming group; localhost succeeds.                                                                                                       |
| LIB-02                   | Combined Channels/Library view is a cross-page navigation proposal requiring alignment, not an established duplicate-concept bug.                                                                        |
| GLO-01/02/04/05/06/08/11 | Apply shared modal/catalog selection, clearer wording, accessible information controls, action grouping, in-app confirmation and readable duration formatting. Details below.                            |
| GLO-03/07                | Sidebar and paused-player behavior belong to global/Watch TV reviews.                                                                                                                                    |
| GLO-10                   | No CSP style violations observed on tested Channels paths; this does not resolve the application-wide report.                                                                                            |

## Ranked findings and acceptance

### CHA-R1-01 — P1 bug: new programming group cannot be selected over LAN HTTP

Open the app through an ordinary HTTP hostname, edit programming, add a content group, then click Select. The picker remains open and no group is added; console reports `crypto.randomUUID is not a function`. On localhost the same flow adds the group. LAN context has `isSecureContext=false`, no `crypto.randomUUID`, and working `crypto.getRandomValues`.

`web/src/Channels.tsx:1065` directly calls `crypto.randomUUID()` only for a **new** group; replacement follows another branch. Reuse/extract the LAN-compatible UUID logic already in `web/src/playback-utils.ts:1` (`eventId`). Acceptance: add and replace work on HTTP LAN and localhost; error handling retains drafts. HTTPS must not be required merely to conceal this crash.

### CHA-R1-02 — P2 owner request: search scope and result presentation are ambiguous

Synthetic `_waiting_ignore/_SORT/test-clip.mp4` makes search `test` return `_waiting_ignore`, `_waiting_ignore/_SORT`, and All files. The filename matches, while displayed folder names do not. `src/display-metadata.ts:195` builds matching fields including title/path/source; `src/library.ts:330` matches these before grouping. `web/src/SelectionPicker.tsx:48` applies input after 200 ms; there are no folder/file or current-level/recursive controls.

Apply shared catalog selection/search with explicit Search, directory-name/file-name modes and recursive scope. Show why grouped results matched or show file rows in file mode. Acceptance: directory-only search cannot match solely on descendant filename; file mode returns matching file rows; authorized indexed queries stay bounded. Do not recursively traverse HDDs per input.

### CHA-R1-03 — P2 owner request: programming editor needs a coherent step flow

Current Content/Commercials/Preview tabs, nested selection and separate Apply commercial rules/preview/publish actions split the task. Apply a wizard: details → content → optional commercial/settings → review/preview → save, with Back and preserved draft. Acceptance must cover both fixed collections and dynamic direct show/folder references. Decide draft-save versus schedule-publish semantics explicitly.

### CHA-R1-04 — P2 owner request: archived test channels cannot be permanently deleted

Archived selection offers Edit details, Edit programming, Add to profile guide, Watch live and Restore, but no permanent deletion. UI archive/restore is `web/src/Channels.tsx:395`; `DELETE /api/channels/:id` soft-archives at `src/server.ts:1453`. Schedules, revisions, rotation state, reports and historical playback IDs complicate real deletion (`src/database.ts:43`). Add an in-app confirmed delete only after deciding history retention and active-playback behavior. Acceptance: authorized archived channel removal, explicit consequences and no orphaned active schedules. Review relevance of other archived actions separately; they were not exercised here.

### CHA-R1-05 — P2 owner request: modal and action hierarchy

Narrow editor scrollHeight is 2041 against clientHeight 758; header is static. Apply shared sticky-header/footer modal to programming and nested selection, and shared confirmation to archive/discard. Group related actions horizontally where width permits. Acceptance: title/Close and primary actions remain reachable while body scrolls, keyboard focus is managed and narrow layout remains usable. No page-wide horizontal overflow was observed. Screenshots alone are not treated as proof of clipping.

### CHA-R1-06 — P3 owner request: durations and optional explanations

Preview uses Actual seconds (`web/src/Channels.tsx:1445`, values at 1472). Apply shared duration formatting: 1,338 seconds → 22m 18s, header Duration, precise seconds available in detail. Move optional exposure/readiness prose into keyboard/click-accessible information controls; keep action consequences visible. Preview generation itself was not exercised.

## Shared creation and decisions

Create reusable modal, confirmation, catalog tree/search, information control, duration formatter and action-group primitives globally. Channels retains explicit adoption tasks for each surface above. Filesystem browsing and indexed catalog selection have different I/O/permission contracts.

A channel currently has one configuration containing multiple content groups, rotation/order rules and many scheduled programs. Collections store fixed media IDs; dynamic show/folder references admit newly scanned files. Combining pages or requiring collections must not silently remove this behavior. Permanent-delete retention and unified-page navigation remain owner decisions.

Both scripts closed browser and isolated server in `finally`; port 19002 has no listener. Synthetic fixture/media were removed. Real Unraid/media, providers and native devices were not accessed.
