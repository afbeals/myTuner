# Independent review B — large nested custom library supplement

This supplements [the complete source-to-watch journey](journey-b.md). The owner expanded the review to large custom archives after the initial fixture had been closed. The supplemental pass used its own newly started browser/fixture on port 19232 and did not change application code, tests or baselines.

## Outcome

**The intended exact selections survived nested search, folder scoping and pagination, and the resulting channel references exactly the six chosen videos through a saved collection.** No P0/P1 task blocker or wrong-media selection was observed. Three P2 problems and one P3 improvement were found, described below. These are additional observations, not changes made during review.

## Synthetic preconditions and limits

The provided disposable fixture contained **8,338 actual temporary synthetic paths**, **137 root sibling directories**, **128 leaf directories with at least 64 videos**, and targets up to **six directory levels deep**. All paths were hardlinks to one generated 120-second test clip. The source and Living Room grant were preseeded, and the production scanner populated the index while reusing one representative technical probe to avoid 8,338 ffprobe subprocesses. The scan reported complete, 8,338 seen/updated, zero missing/errors.

The source/grant/preindex are explicit preconditions; this supplement does **not** count them as UI setup steps. The original review separately completed adding/checking/scanning a small source through the UI. No household media, live providers, Docker/Unraid, cold full-probe scan, diverse media codecs, HDD behavior or device acceptance is established here. Desktop 1440×1000 and narrow 390×844 were inspected. No installation, download, automatic PNG opening, Git change or application fix occurred.

Preconditions: [manifest](/private/tmp/mytuner-nested-b/preconditions.json). Raw snapshots/screenshots: [/private/tmp/mytuner-nested-b](/private/tmp/mytuner-nested-b). Read-only post-save evidence: [selection-verification.json](/private/tmp/mytuner-nested-b/selection-verification.json). Additional measured UI state: [observations.json](/private/tmp/mytuner-nested-b/observations.json).

## Exercised visible UI

| Check                         | Observed result                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default folder listing        | Shallow root view paged 137 directories in 50-result pages. Distinct folder names and counts appeared.                                                                                                                                                                                                  |
| Explicit search               | Typing Needle alone produced **zero requests** during the observed interval; Search applied the query.                                                                                                                                                                                                  |
| Folder versus file matching   | Folder-name Needle returned no folder matches. File-name Needle with shallow scope returned 0; recursive scope returned exactly 4 expected deep files with full source-relative breadcrumbs. The `_waiting_ignore/_SORT` result was the actual matching Needle file, not an unexplained ancestor match. |
| Restricted folder scope       | Choose search folder → Nature restricted recursive Needle search to 2 results; shallow Nature yielded 0. Travel restricted it to 1. No Nature result appeared in the Travel restriction.                                                                                                                |
| Very wide folder picker       | The inner Folder choices region initially rendered 22 virtual rows. Scrolling inside that region revealed More folders; two continuations reached Travel/Workshop after 132 Shelf folders. Earlier folders remained available. This is working bounded virtualization, not missing folders.             |
| Folder page cache             | Next → Previous → Next reused loaded pages with **zero additional catalog requests** on the repeated page visits. The initial new page requested offset 50/limit 50.                                                                                                                                    |
| File paging                   | Blank recursive filename search showed 1–50 of8,338. Page2 showed 51–100. Selected Clip 001 from page1 and Clip 051 from page2; returning to page1 required no new request and retained selection.                                                                                                      |
| Duplicate titles              | Highlight search returned 2 distinct paths, one under Nature and one under Travel. Both were selected independently. Search results distinguished them correctly by breadcrumb.                                                                                                                         |
| Cross-folder collection       | Selected the 2 Highlight files, Nature Fireflies, Travel Sunrise, and Family Clip 001/051. Create collection from tray → Nested exact six → Save worked. The saved detail view contained 6 referenced videos.                                                                                           |
| Programming                   | Saved collection → Program this whole selection in a channel → Nested selected channel → no commercials → Generate preview → Create channel worked. Later Edit programming showed Nested exact six.                                                                                                     |
| Exactness check after UI save | Read-only membership, programming and media GETs confirmed exactly the 6 expected source-relative paths and a programming group referencing only this collection. No API mutation completed a UI task.                                                                                                  |
| Narrow rendering              | Page width remained 390px, but the filename-result list had internal horizontal overflow that clipped Add actions; details below.                                                                                                                                                                       |

The six verified references were:

- `Family/2023/Set 01/Family 2023 Set 01 Clip 001.mp4`
- `Family/2023/Set 01/Family 2023 Set 01 Clip 051.mp4`
- `Nature/2026/Set 08/Highlight.mp4`
- `Travel/2026/Set 08/Highlight.mp4`
- `Nature/2026/Set 08/River/Night/Camera A/Needle - Fireflies.mp4`
- `Travel/2025/Set 03/Coast/Dawn/Camera A/Needle - Sunrise.mp4`

## Additional findings

### B09 · P2 · Breadcrumbs disappear when reviewing duplicate selected titles

Search results clearly distinguish Nature and Travel versions of Highlight.mp4. After both enter the tray, Review selected videos shows two indistinguishable `Highlight` lines and two identically named `Remove Highlight from tray` actions. Collection selected-video review and saved collection detail rows also display duplicate titles without source-relative context. The channel preview likewise shows consecutive Highlight entries without identifying which file each is.

The saved IDs are correct: this is a human verification/removal problem, not a demonstrated identity collision. Carry source name plus a compact source-relative breadcrumb into tray and collection review, and include enough context in accessible action names to distinguish duplicates. Make detail/preview context available without requiring inspection of every individual file.

Evidence: [tray snapshot](/private/tmp/mytuner-nested-b/16-tray-review-duplicates.yml), [tray screenshot](/private/tmp/mytuner-nested-b/16-tray-review-duplicates.png), [saved collection](/private/tmp/mytuner-nested-b/18-saved-collection-six.yml), [channel preview](/private/tmp/mytuner-nested-b/20-exact-six-preview.png). Source: [Library.tsx](../../web/src/Library.tsx) renders only the title for tray rows.

### B10 · P2 · Narrow filename-result actions are clipped inside their own list

At 390px, the Needle result row had client width 332px but scroll width 385px. Its Add button extended to x 413.64px; the visible viewport ended at 390px and the list's right boundary was nearer 370px. The whole page itself remained 390px wide, so a page-level overflow assertion alone misses this. The Add to selection label is cut off and the row asks the user to discover horizontal scrolling to read it fully.

Allow the metadata column to shrink and wrap and move actions beneath the path on narrow layouts, or use a grid whose action track fits. Keep controls fully visible with deep paths and long source names; do not solve this by hiding useful breadcrumbs.

Evidence: [390px viewport](/private/tmp/mytuner-nested-b/27-needle-search-narrow.png), [complete accessible snapshot](/private/tmp/mytuner-nested-b/28-needle-search-narrow.yml), [metrics](/private/tmp/mytuner-nested-b/observations.json). Source: [CatalogBrowser.tsx](../../web/src/CatalogBrowser.tsx) uses compact-row plus a separate actions child for every result.

### B11 · P2 · Reusing Open saved collection can do nothing after the collection closes

Open saved collection initially opens Nested exact six and sets its hash URL. After using that collection to create a channel and closing later programming, the page can retain the same `#library?profile=…&collection=…` hash with no collection dialog open. Clicking the persistent Open saved collection link again leaves the identical URL and opens zero dialogs. A separate card Open details action is a workaround, so the collection is not lost.

Make this action explicitly reopen/focus the known collection even when its route is already current, or clear the resource route when the detail closes. Verify the repeated-open path independently of first navigation.

Evidence: [link with no resulting modal](/private/tmp/mytuner-nested-b/29-reopen-saved-link-no-modal.png), [before/href/after state and zero-dialog count](/private/tmp/mytuner-nested-b/observations.json). Source: [Library.tsx](../../web/src/Library.tsx) is a plain hash link; the linked-selection effect depends on resource ID/profile and does not rerun for identical navigation after local closure.

### B12 · P3 · Prefilled channel programming loses the selected collection's name

Starting a channel from Nested exact six correctly preselects its collection ID, but Step 2 says only `Saved collection`. Choosing a collection through the content picker retains its actual name, and later editing the saved channel also shows Nested exact six. The initial handoff should preserve the same context so a person can verify what they are about to program.

Carry the known collection label into the wizard's initial selection descriptor, or perform the existing bounded authorized label lookup. Show the collection name and a useful item count; do not expose raw IDs as the primary label.

Evidence: [prefilled programming step](/private/tmp/mytuner-nested-b/19-exact-collection-programming.png), [later editor name](/private/tmp/mytuner-nested-b/23-programming-labels-narrow.yml). Source: [ChannelWizard.tsx](../../web/src/ChannelWizard.tsx) falls back to selectionSummary when no label has been supplied.

## Cleanup

The owned browser/fixture closed normally. Port 19232 returned `ECONNREFUSED`; `/var/folders/yy/7g1n48s13fxdt6c6dg20xvkr0000gn/T/mytuner-nested-ui-Ro5uXF` was confirmed removed. The synthetic media/database were discarded; bounded screenshots, manifest and review logs remain. This pass changes only review documentation and does not update tests or screenshot baselines.
