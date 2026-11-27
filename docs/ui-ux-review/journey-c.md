# Independent human-usability journey C — 2026-11-26

Reviewer C independently used the current 0.3.0 browser build, starting at **390 × 844** and then **1440 × 1000**. The core source → scan → collection → channel → programming → publish → subscribe → watch journey completed through visible UI. This is an expert usability walkthrough using synthetic data, not a study of actual first-time users. No P0/P1 blocker was observed in this journey. Three P2 usability issues and two P3 consistency issues remain worth improving.

## Scope and method

- Owned disposable fixture: `e2e/server.ts --demo`, loopback port **19233**, existing built `web-dist`, installed Playwright/Chromium. No rebuild, download, installation, emulator or production access.
- Logged in as the synthetic admin `designer` and selected Living Room. The existing login helper eventually timed out waiting for the hidden mobile Sign out button; login itself had succeeded. Continued using the visible mobile menu. This was a helper limitation, not an application login defect.
- Began with UI labels and screenshots rather than source/test click instructions. Consulted implementation only after observing the issues below. Did not read the other journey reports.
- Filesystem preconditioning only: created `spare/Weekend/Season 1` **inside this fixture's temporary root**, copying its two already-synthetic clips to `Weekend.S01E01.mp4` and `Weekend.S01E02.mp4`. These copies are test fixtures, not household media. No API bypass created sources, collections, channels, programming, subscriptions or playback.
- Source named Weekend cartoons; collection Saturday picks; private channel Weekend Club, short name WEEK, description “Our family weekend playlist.” Renamed source to Weekend favourites at the end.
- Screenshots were saved without opening anything in VS Code. Representative images were inspected directly with the image viewer. Full-page modal captures include background document space due scroll position; viewport captures are explicitly named.

## Actual task outcomes

| Task                     | UI actions and observed result                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add source               | Menu → Sources → Add source; enter name/path, choose Custom videos and Include subfolders. Check directory correctly reported two supported filenames and explained that playback had not yet been inspected. Add source succeeded.                                                                                                                                                           |
| Configure source         | Configure → review subtitle defaults, separate metadata directory and Manual only scan schedule → Save configuration. Named success message appeared. Optional sections were understandable without opening advanced limits.                                                                                                                                                                  |
| Scan                     | Scan and refresh → Start scan. Finished result: **2 found, 2 updated, 0 missing, 0 errors**, with source name and completion time.                                                                                                                                                                                                                                                            |
| Find/select videos       | My Network → Your library → Season 1 → Select all on this page → Add 2 videos to tray. Both exact references appeared in the collection flow.                                                                                                                                                                                                                                                 |
| Create collection        | Create collection from tray → Saturday picks → Save collection. Named saved message and Open saved collection link appeared.                                                                                                                                                                                                                                                                  |
| Create channel           | Create channel → details/short name/description → Next → Add content group → search Saturday → select collection → Use selection. Chose Shuffle. Back retained configuration.                                                                                                                                                                                                                 |
| Configure commercials    | Selected Synthetic commercials. First deliberately left break triggers off and generated a preview: no commercials appeared, although summary said “Commercial breaks configured” (C-01). Went Back, enabled Breaks between programs, set 10-second maximum and one clip. Preview then showed ten-second Synthetic-ad intervals, demonstrating cutoff from the twelve-second test commercial. |
| Publish/create           | Final Create channel succeeded; named success said channel created and published and advised adding it to a profile guide.                                                                                                                                                                                                                                                                    |
| Subscribe/watch          | Add to profile guide succeeded. Watch live opened the new channel in Living Room, with synthetic picture/audio playback and browser playhead advancement. Audio/caption choices and pause were visible. Leaving pause required the appropriate explicit confirmation. Membership feedback itself was unclear (C-02).                                                                          |
| Edit saved programming   | Edit programming → Add content group → choose whole Orbit Patrol show → Next/Next → Generate two-hour preview → Publish programming. Named saved/effective-time state appeared. The original collection and new dynamic whole-show group both remained configured.                                                                                                                            |
| Search exact filename    | Library Folders and file names → Weekend cartoons → File names only → Search subfolders → E01 → Search. One matching file appeared with its source-relative path. Add to selection updated tray count and showed named success.                                                                                                                                                               |
| Error/cancel/source edit | Edited source path to a nonexistent child and ran Check directory: readable “Directory not found” guidance appeared. Cancel opened an in-app discard confirmation. Discard restored original saved path; source rename then saved successfully.                                                                                                                                               |

## Ranked findings

### C-01 · P2 · A selected commercial pool is presented as configured breaks even when no breaks can run

**Reproduce:** Create channel with one content group → Commercials → choose Synthetic commercials → leave Breaks between programs unchecked and Break positions empty → Next → Generate preview.

**Observed:** Final review says **“Commercial breaks configured.”** All preview rows are programs; no commercial interval exists. Selecting a pool is valid configuration but is not an enabled break schedule. A human can reasonably believe choosing the commercial source enabled ads, and the affirmative final summary reinforces that belief.

**Improve:** Distinguish “Commercial source selected · no breaks enabled” from actual break configuration. Offer a visible “Add breaks between programs” action or an explicit No breaks choice. Keep the ability to retain a pool without enabling it. Summarize enabled placement and maximum length in plain language before creation.

Evidence: [commercial controls](/private/tmp/mytuner-journey-c/11-commercials-narrow.png), [misleading final summary and ad-free preview](/private/tmp/mytuner-journey-c/12-preview-no-breaks-narrow.png), matching `.yml` snapshots in the same directory. Source confirmation: [ChannelWizard.tsx](../../web/src/ChannelWizard.tsx) checks only `commercialSelection`; [ProgrammingRules.tsx](../../web/src/ProgrammingRules.tsx) changes the pool independently of break triggers.

### C-02 · P2 · Add to profile guide gives no completed or already-added state

**Reproduce:** Create/publish channel → Add to profile guide → wait until the operation completes. After successful Watch playback, return to the channel and click the same button again.

**Observed:** The action remains **“Add to profile guide”**, with no named completion status or “In Living Room guide” indicator. It silently accepts repeated adds. Watch and the coming-up list prove the subscription worked, but users should not need to infer this from secondary changes or navigate away to check.

**Improve:** Show “Added to Living Room guide” and persist an “In this profile's guide” state; replace Add with Manage guide or a deliberate Remove action. Include the profile name at this action so changes in the global profile selector remain clear. Preserve idempotent request handling.

Evidence: [post-add channel](/private/tmp/mytuner-journey-c/14-subscription-attempt-narrow.png), [already-added button still offers Add](/private/tmp/mytuner-journey-c/22-add-guide-already-added-desktop.png), [watch journey](/private/tmp/mytuner-journey-c/15-watch-attempt-narrow.png). After a completed repeat Add, the only status region contained unrelated “Selection cleared.” Source confirmation: [Channels.tsx](../../web/src/Channels.tsx) subscribes and refreshes without recording a membership/completion UI state; shared Action reports failures but has no default success status.

### C-03 · P2 · Narrow-screen library access requires too much control-heavy scrolling

**Reproduce:** Open My Network at 390 × 844 with two/three channels, no selected preview and an empty selection tray. Scroll to the first catalog result.

**Observed:** First catalog card begins at approximately **2,089 px**, about **2.5 viewport heights** below document top. The empty tray alone is **351 px** high; it presents three disabled actions before any videos have been encountered. The long channel/filter/tray/search stack makes the combined page feel much larger than its small catalog. This is a density/discoverability issue, not clipped controls or a broken task.

**Improve:** Collapse empty tray to a one-line hint, expand only after selection; add Channels/Library section jumps on narrow layouts; consolidate optional filters behind a compact disclosure while keeping Search and current scope visible. Preserve explicit search and bounded requests.

Evidence: [full-page library before extra channel](/private/tmp/mytuner-journey-c/08-folder-detail-narrow.png), [narrow entry viewport](/private/tmp/mytuner-journey-c/21-library-entry-narrow-viewport.png). Measurement was taken from actual DOM positions with window scroll reset, not inferred from a full-page PNG. Source: [Library.tsx](../../web/src/Library.tsx) renders full tray actions even when empty.

### C-04 · P3 · Published programming still presents Cancel and draft instructions

**Reproduce:** Edit programming → Preview → Generate two-hour preview → Publish programming → observe saved state without closing the modal.

**Observed:** Top status correctly reports “Programming saved — effective …”, while footer still says Cancel and body says “Preview this draft before publishing.” A new user may wonder whether Cancel will undo the saved operation.

**Improve:** After publication, use Done/Close, and replace the draft instruction with the effective-time explanation. Editing again can restore draft actions. This does not require auto-closing and hiding the valuable saved-time confirmation.

Evidence: [saved programming with Cancel](/private/tmp/mytuner-journey-c/23-saved-with-cancel-desktop.png); [Channels.tsx](../../web/src/Channels.tsx) renders the same ModalCancel across saved/draft states.

### C-05 · P3 · Creation and editing use different names for the same ordering controls

**Observed:** Channel creation uses “Group 1 order,” “Episode order,” and “Group 1 videos per turn.” Editing the same custom-video collection uses “Rotation,” “Ordered · keep episode sequence,” and “Episodes per turn.” The choices are functional, but switching names makes users relearn the same setting and calls arbitrary videos episodes.

**Improve:** Reuse human labels such as “Play order” and “Videos per turn” in both flows, with an example of group alternation. Preserve show-specific explanation where it adds meaning. The edit flow already provides a useful A1/A2/B1/B2 example that creation could share.

Evidence: [creation controls](/private/tmp/mytuner-journey-c/10-programming-narrow.png), [editing controls](/private/tmp/mytuner-journey-c/18-edit-programming-desktop.png); [Channels.tsx](../../web/src/Channels.tsx).

## What worked well

- Source addition, validation and scans report human-readable outcomes without requiring raw JSON interpretation. The distinction between directory-name sampling and actual media inspection is honest.
- Sticky dialog actions remained reachable on narrow and desktop layouts. Scope/step titles made Next/Back understandable, and the source discard confirmation protected mistakes.
- The collection dialog explains exact references versus future additions to whole-show/folder programming, and its named success/open link is a strong feedback pattern to reuse.
- Private is the channel default and its owner/admin scope is visible. This admin walkthrough did not test another account's access or claim a new privacy audit.
- The preview-before-create model is clear; published programming shows its effective time. Program and commercial entries can be inspected before actual playback.
- Explicit filename search returned the requested nested file, with an identifiable path and successful tray feedback. No source traversal was needed as part of the visible browse/search task.
- Browser viewing successfully followed the complete newly-created content path. Pause, track controls and the leave-paused confirmation remained available.

## Limits and cleanup

This fixture already had an admin, profiles, one show/channel and a synthetic commercial source. It is not a completely empty installation. No real Sonarr/Radarr server, Docker mount suggestions, household filesystem, non-admin setup, physical remote/TV, external subtitle file or large-library load was exercised. Automatic mount choices correctly explained that they require the Linux container; the synthetic source path was entered manually.

Browser telemetry recorded only the expected initial signed-out `/api/auth/me` 401; no page error or later failed request was captured. Short synthetic clips and automation are not a transition-quality or accessibility certification. Some initial locator assumptions timed out; the resulting snapshots were read and selectors adjusted rather than counted as product bugs.

The owned browser and server were closed through the helper's cleanup, and port **19233** was verified released. The fixture's temporary media/database were removed by normal server shutdown. Evidence is in `/private/tmp/mytuner-journey-c/`; server/browser logs are in `/private/tmp/mytuner-ui-review/journey-c/`. Only this review Markdown file was added to the repository. Product code, tests, snapshots and user media were not changed.

**Verdict:** The main task can now be completed through the interface without hidden API steps. It is usable for a home-server administrator. It still asks humans to infer a few completed/configured states, and narrow catalog discovery is too control-heavy. Address C-01/C-02 before calling setup self-explanatory; improve C-03 for comfortable phone management.
