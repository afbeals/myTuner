# Independent nested-library workflow review A — 2026-11-26

Completed after the initial fixture closed, in a new independent fixture on port 19231. This supplement tests the owner's large, deeply nested custom-directory use case, rather than extrapolating from the single-video journey.

### Preconditions and boundaries

- **8,338 actual synthetic video paths**, **137 top-level directories**, **128 leaf folders with at least 64 videos**, and up to **six directory levels** under the source root.
- Hardlinks to one generated 120-second H.264/AAC clip; duplicate `Highlight.mp4` basenames deliberately live in different branches. No household files were linked or copied.
- The source, admin/editor accounts, Living Room profile and its source grant were deliberately provisioned before the UI walkthrough. The production scanner traversed real temporary directories and populated the catalog, reusing one representative technical probe to avoid 8,338 FFprobe processes. Preparation scan reported 8,338 seen/updated, complete, zero errors; approximately 6.9 seconds on this Mac.
- **This is not a cold full-probe scan, an Unraid/HDD benchmark, codec-diversity test or an end-to-end source-add test for 8k media.** Source creation/scan UI was exercised separately in the first pass. Large-catalog selections/programming below were performed through visible controls.
- Existing built assets and installed browser were reused. No application/test/baseline edits, download or installation.

Evidence: [fixture manifest](/private/tmp/mytuner-nested-a/preconditions.json), [all generated relative paths](/private/tmp/mytuner-nested-a/paths.json), [request log](/private/tmp/mytuner-nested-a/requests.json).

### Observed nested-library outcomes

| Task                                                         | Result                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Open Folders and file names                                  | Top-level folder-only mode showed 1–50 of 137 rather than loading all videos. The description correctly explained current-level versus recursive matching.                                                                                                                                         |
| Browse a wide folder-picker root                             | Scrolling inside Folder choices revealed the virtualized later rows and More folders. Two forward pages reached Shelf 132, Travel and Workshop; Earlier folders returned toward the first page.                                                                                                    |
| Verify bounded virtualization                                | About 22 folder rows existed in the DOM at one position; scrolling changed the rendered range. This is intended bounded virtualization, **not missing folders**. An initial suspicion was explicitly withdrawn after scrolling verification.                                                       |
| Drill deeply                                                 | Expanded Nature → 2026 → Set 08 → River → Night and selected Camera A. Apply selection scoped file results to the single Fireflies video six levels below the source.                                                                                                                              |
| Select across branches                                       | Added Fireflies, then searched filenames recursively and added the Travel/2025/Set 03/Coast/Dawn/Camera A Sunrise file. The existing tray selection survived the changed search/scope.                                                                                                             |
| Distinguish duplicate filenames in results                   | Recursive Highlight search returned exactly the Nature and Travel Highlight files with full relative paths. Both could be added as separate references.                                                                                                                                            |
| Reach the second page of a leaf                              | Chose Nature/2026/Set 01, searched current-level file names with an empty query, received 1–50 of 64, then 51–64. Added Clip 064 successfully.                                                                                                                                                     |
| Create programming from the five-video tray                  | Create channel from tray produced one exact-media group. Preview used only the intended five titles, and final Create channel succeeded.                                                                                                                                                           |
| Verify stored result after UI publication                    | Read-only API/SQLite verification confirmed exactly the five intended media IDs/paths, including both distinct Highlight files and the page-two Clip 064. No ancestor-folder expansion or additional videos were included.                                                                         |
| Test two file clicks inside the channel's programming picker | In a separate channel, Choose programming content → Folders and file names → File names only + Search subfolders, clicking Fireflies and then Sunrise replaced the staged choice. Use selection yielded Sunrise only; preview and saved programming both confirmed the single last-selected video. |

The five exact paths verified after UI publication were:

1. `Nature/2026/Set 08/River/Night/Camera A/Needle - Fireflies.mp4`
2. `Travel/2025/Set 03/Coast/Dawn/Camera A/Needle - Sunrise.mp4`
3. `Nature/2026/Set 08/Highlight.mp4`
4. `Travel/2026/Set 08/Highlight.mp4`
5. `Nature/2026/Set 01/Nature 2026 Set 01 Clip 064.mp4`

Evidence: [deep tree selection](/private/tmp/mytuner-nested-a/08-deep-folder-selected.png), [duplicate filename results](/private/tmp/mytuner-nested-a/11-duplicate-filenames.png), [leaf page two](/private/tmp/mytuner-nested-a/13-leaf-page2.png), [five-video programming](/private/tmp/mytuner-nested-a/16-five-exact-programming.png), [read-only saved-programming verification](/private/tmp/mytuner-nested-a/verified-programming.json).

### A08 · P2 · The selection tray loses the path needed to distinguish duplicate titles

**Reproduce:** search recursively for Highlight, add the Nature and Travel results, then open Review selected videos in the tray. Search results show the different relative paths, but the tray shows two identical `Highlight` rows, each with Remove. Both accessible names are exactly “Remove Highlight from tray.”

**Human impact:** the user can select the right videos initially but cannot review or remove the correct duplicate once it is in the tray. The stored IDs remain correct; this is a usability/accessibility identification problem, not reference corruption.

**Improve:** retain source and relative path as a readable secondary line, and include that distinction in removal labels. Carry the same disambiguation into fixed-selection review/preview where repeated titles appear.

Evidence: [duplicate-title tray closeup](/private/tmp/mytuner-nested-a/15-duplicate-tray-closeup.png). The read-only verification proves the two rows refer to different files.

### A09 · P2 · The same Add to selection wording means accumulation in the library and replacement in programming

**Reproduce:** in the channel's Choose programming content picker, use File names only and recursive Needle search. Click Add to selection on Fireflies, then on Sunrise. Rows retain Add to selection. Use selection creates a group containing Sunrise only; preview and saved config confirm that replacement.

**Existing behavior to preserve accurately:** the picker **does render** a status above the result/search area: “Selected: Needle - Sunrise. Choose Use selection to apply.” It can be outside the current scrolled result viewport after a row is clicked. The problem is not a missing DOM summary, and a single-choice content picker is not inherently incorrect.

**Human impact:** an identical-looking Add to selection action accumulates multiple files in the library but replaces a single choice inside programming. A user collecting several deep files can mistakenly think all clicked rows will be included, especially when the chosen-status line is above the scrolled results. Returning to programming reveals only a title, after the user has left the selection context.

**Improve:** either support explicit multi-file checkboxes/count in this picker, or label rows Select this video, show a radio/selected state, and keep the single staged selection beside the sticky Use selection action. Explain that the library tray is the route for combining exact videos across folders.

Evidence: [two file clicks, with the selected status captured in the accessibility snapshot](/private/tmp/mytuner-nested-a/22-picker-two-file-clicks.yml), [resulting one-video group](/private/tmp/mytuner-nested-a/23-picker-result-one-video.png), [single-video preview](/private/tmp/mytuner-nested-a/24-picker-single-preview.png), [saved config verification](/private/tmp/mytuner-nested-a/verified-programming.json).

### Supplemental assessment and cleanup

Deep and wide browsing, second-page selection and exact cross-branch programming work in the tested synthetic 8k catalog. The strongest human-usability gaps are identifying duplicate files after selection and understanding the different selection semantics between library and programming. Folder continuation works, although users need to scroll inside the bounded folder region to reach its pagination.

The review recorded 71 API requests across the entire multi-step journey, including 23 catalog-tree requests; this is descriptive evidence, not a latency/throughput benchmark. No page exception was observed; the only captured console error was the expected unauthenticated startup 401. Browser controls were exercised at desktop width, with final preview checked at 390×844.

The browser controller exited successfully. The owned fixture received SIGTERM, printed CLOSED, removed its disposable data and exited 0. Listener/process cleanup was verified. Only review documentation was changed in the repository. No fixes were made during either pass.
