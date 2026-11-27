# UI/UX investigation and page backlog — 2026-11-26

Status: **local implementation and verification complete. Every backlog item is required/P0 delivery scope; 117 implementation entries and two investigated/unreproduced reports are reconciled in [the full requirement trace](UI_UX_COVERAGE.md). Checked investigation entries do not claim an unobserved defect was fixed. Target-host/device acceptance remains in [differed](differed.md).** See [accepted decisions and phase tracking](UI_UX_IMPLEMENTATION.md). Completed **28 live page passes** (two distinct reviewers for each of 14 surfaces), **two shared-component passes** and five focused follow-ups. Those investigation passes made no application changes. Implementation is now on `feature/ui-ux-overhaul`, version 0.3.0/schema 20. Owner intake: [all supplied requests](UI_UX_OWNER_NOTES.md). Base application: server/browser 0.2.2, schema 19, commit a67d418. Review notes are isolated on `review/ui-ux-page-audit`.

## Review contract

Each page received two independent subagent reviews in the running synthetic application: pass 1 verifies owner items; pass 2 assesses the page’s complete UI/UX. Complex workflows received extra focused investigation. The archived-sidebar and slow-generation follow-ups used isolated live fixtures; source configuration, combined catalog/channel and profile lifecycle follow-ups were code-focused contract reviews and are not counted as extra live page passes. Local synthetic writes are only for exercising behavior. No production access, media changes, new host tools or native emulator runs.

Shared component creation/update belongs in Global. Every affected page retains an explicit “Apply component X to behavior Y” task. Repeated page fixes such as capitalization remain per page. Priorities: P0 critical exposure/data loss, P1 blocks a core task or safe operation, P2 substantial usability/functionality problem, P3 polish or lower-impact improvement. Consolidated priorities below are the final triage; individual reports retain their reviewer’s original rank. For example, stale access diagnostics are P2 because the actual grant works; endlessly growing archived DOM is P1 because the selected-channel workspace keeps degrading without further input. The checkboxes below track delivery against the agreed requirements. Implementation and verification status are reconciled in [the implementation record](UI_UX_IMPLEMENTATION.md); an unchecked item is not accepted as complete. Historical findings describe the investigation baseline.

## Main findings

- **P1 — Channels:** ordinary LAN HTTP cannot add a new programming group because the browser UUID call is unavailable. Two independent reviews reproduced it; localhost masks the problem.
- **P1 — Archived channels:** the sidebar adds exposure headings roughly once per second without statistics requests. The bounded follow-up grew from one to 38 headings; an independent reviewer reproduced it and saw old headings remain after switching channels.
- **Other confirmed problems:** invalid/missing generation totals and slow-response polling starvation; silent account-draft loss and unexpected no-op sign-out; stale profile-access diagnostics; clipped narrow playback controls and ineffective same-channel Watch live; stale TV approval intent/recovery; report pagination, contrast and version errors.
- **Requested UX work:** shared sticky dialogs, lazy directory selection, explicit search, one-save forms, profile subscription checklist, compact generation log, two-column Watch layout, combined catalog/channel hub, cart and creation wizard. These require the flow/data decisions below, rather than being treated as isolated visual edits.
- **Existing behavior to preserve:** derivative reuse/explicit regeneration, collection create/edit on localhost and LAN HTTP, browser paused-frame retention, profile/PIN authorization, private-channel filtering, last-admin protection and explicit report submission/idempotent retry worked in the exercised flows.
- **Not reproduced as reported:** collection creation failure, exact perpetual back-and-forth progress animation and Channels style-CSP blocks. Separate related problems were confirmed; that does not establish these exact reports. Physical TV paused-frame behavior is not verified by browser screenshots.

## Coverage matrix

| Page/surface                        | Owner-request pass                               | Independent UI/UX pass                           | Extra investigation                                                            |
| ----------------------------------- | ------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Sources                             | [Complete](ui-ux-review/sources-pass1.md)        | [Complete](ui-ux-review/sources-pass2.md)        | [Configuration/save/scan contracts](ui-ux-review/sources-configuration.md)     |
| Generated Assets                    | [Complete](ui-ux-review/generation-pass1.md)     | [Complete](ui-ux-review/generation-pass2.md)     | [Slow polling/contract reviewed](ui-ux-review/generation-polling.md)           |
| Channels                            | [Complete](ui-ux-review/channels-pass1.md)       | [Complete](ui-ux-review/channels-pass2.md)       | [Archived reproduction](ui-ux-review/channels-archived.md); LAN HTTP confirmed |
| Library                             | [Complete](ui-ux-review/library-pass1.md)        | [Complete](ui-ux-review/library-pass2.md)        | [Combined workflow contracts](ui-ux-review/combined-library-channels.md)       |
| Accounts                            | [Complete](ui-ux-review/accounts-pass1.md)       | [Complete](ui-ux-review/accounts-pass2.md)       | —                                                                              |
| Profiles                            | [Complete](ui-ux-review/profiles-pass1.md)       | [Complete](ui-ux-review/profiles-pass2.md)       | [Lifecycle/save contracts](ui-ux-review/profiles-lifecycle.md)                 |
| Subscriptions                       | [Complete](ui-ux-review/subscriptions-pass1.md)  | [Complete](ui-ux-review/subscriptions-pass2.md)  | Profile-modal migration proposal                                               |
| Watch TV                            | [Complete](ui-ux-review/watch-pass1.md)          | [Complete](ui-ux-review/watch-pass2.md)          | Native code-only pause review; emulator deferred                               |
| Setup & server health               | [Complete](ui-ux-review/operations-pass1.md)     | [Complete](ui-ux-review/operations-pass2.md)     | —                                                                              |
| Connect TV                          | [Complete](ui-ux-review/pairing-pass1.md)        | [Complete](ui-ux-review/pairing-pass2.md)        | —                                                                              |
| Devices & sessions                  | [Complete](ui-ux-review/sessions-pass1.md)       | [Complete](ui-ux-review/sessions-pass2.md)       | —                                                                              |
| Problem reports / Your reports      | [Complete](ui-ux-review/reports-pass1.md)        | [Complete](ui-ux-review/reports-pass2.md)        | —                                                                              |
| Sign-in, startup and profile unlock | [Complete](ui-ux-review/authentication-pass1.md) | [Complete](ui-ux-review/authentication-pass2.md) | —                                                                              |
| Setup & TV help                     | [Complete](ui-ux-review/help-pass1.md)           | [Complete](ui-ux-review/help-pass2.md)           | —                                                                              |
| Global/shared shell/components      | [Complete](ui-ux-review/global-pass1.md)         | [Complete](ui-ux-review/global-pass2.md)         | Explicit Channels CSP capture; still unconfirmed                               |

## Global/shared component checklist

These are shared construction/update tasks. Each page below retains its own adoption line; page-local wording, layout and capitalization remain on that page. Evidence: [shared review 1](ui-ux-review/global-pass1.md), [shared review 2](ui-ux-review/global-pass2.md). Existing dialog focus trapping/return and Skip to content passed; extend those behaviors rather than replacing them blindly.

- [x] **P2 · GLO-01 · Extend the existing Modal shell.**
  - [x] Define header, scrolling body and persistent footer/Close/primary action slots; support long/narrow/short-height and nested dialogs.
  - [x] Preserve focus trap/return, pending/error state, labelled controls and dirty-draft protection; do not let one section save silently close another section’s draft.
- [x] **P2 · GLO-02 · Shared lazy tree and selection primitives.**
  - [x] One expandable/checkbox-row UI with explicit Apply/Cancel; initial top level only; direct children on expansion; loading/error/retry beside that branch.
  - [x] Distinct catalog and permitted-filesystem adapters; catalog browsing must never walk HDDs/probe videos. Mount suggestions describe myTuner container paths, not original Docker host mappings.
  - [x] Bound wide-folder pages and rendered rows; cache loaded branches until unmount using source/catalog revision and permissions; abort stale work and clear private state on identity changes.
  - [x] Define parent/subtree and Select all scope, root/symlink containment, removed/offline content and a discoverable continuation for huge sibling lists. No Docker socket or unbounded recursive traversal.
- [x] **P2 · Shared secret-confirmation fields.** Reusable matching/field-error behavior with page-supplied password/PIN rules and safe autocomplete; optional visibility control must be labelled and preserve values. No repeat confirmation when merely signing in or unlocking.
- [x] **P2 · shared paired-path rows.** Reusable Add/remove/edit mapping rows with labelled left/right inputs, per-row errors and separate asynchronous validation state; Sources supplies provider/local namespace semantics.
- [x] **P2 · Shared long-token/command presentation.** Wrap long paths/environment names safely in prose and code; preserve exact copyable text and whole-word button labels.
- [x] **P2 · GLO-05 · Accessible optional-information control.** Support hover, click/touch, keyboard, meaningful labels and focus. Keep errors, privacy/access effects and destructive consequences visible.
- [x] **P2 · GLO-06 · Shared responsive action groups and destructive styling.** Primary/secondary/danger hierarchy, target-aware accessible names, sensible wrapping and readable whole-word labels. Fix the shared red-on-teal danger combination; page adoption remains explicit.
- [x] **P2 · GLO-08 · Application confirmation and correct draft guarding.**
  - [x] Target-aware confirmations with Cancel/confirm, consequences, pending/error/retry and focus return for in-app destructive/discard/revoke/tune actions.
  - [x] Support asynchronous navigation/discard without losing original intent or firing actions twice. Exempt ordinary credential/public-code entry where a configuration-draft warning is misleading.
  - [x] Keep browser-owned tab-close protection separate; application code cannot replace that browser UI.
- [x] **P2 · GLO-09 / LIB-11 · Explicit scoped search controls.** Separate draft input from committed query, Search/Enter, folder/file matching and current-level/recursive scope where applicable; preserve paging/selection and clear-filter recovery. Use indexed bounded queries.
- [x] **P2 · shared async feedback.** Retain dated previous data during same-permission-scope refresh/failure, show stale/loading/error states accurately, prevent overlapping polling/duplicate mutations, preserve row focus and announce meaningful outcomes. Never retain protected data after account/profile/permission changes.
- [x] **P3 · GLO-11 / GLO-07 · Duration/time presentation.** Shared browser formatting for elapsed/total, minutes/seconds and long durations; distinguish playhead, airing clock and behind-live time. Native uses equivalent platform rendering rather than importing browser components.
- [x] **P2 · shared keyboard navigation:** Escape closes the mobile Menu and returns focus to its trigger; activating a destination focuses/announces its heading/main after loading. Preserve the working Skip to content and dialog focus behavior.
- [x] **P3 · GLO-03/04 · Navigation and language conventions.** Group frequent viewing/channel work before administration, align route labels and plain terminology; preserve role filtering, manager return and mobile menu. Clarify network-wide versus current-profile settings. Each page keeps its local title/copy fixes.
- [x] **P1 · Shared browser-compatible identifiers.** Reuse compatible existing collision-resistant identifiers for ordinary HTTP LAN; Channels retains its explicit adoption task.
- [x] **Unconfirmed · GLO-10 · Channels style-CSP report.** Capture event/source/header evidence for the reported style blocks before selecting a fix; do not weaken CSP speculatively. Both shared reviews found no style violation; [explicit event capture](ui-ux-review/global-pass1.md) covers active/archived Channels, programming, preview and ordinary HTTP LAN.

## Page implementation checklists

These sections consolidate reviewed evidence, with owner requests and additional agent recommendations labeled separately. Component adoption stays on the page even when component construction is global.

### Sources

Evidence: [owner-request pass](ui-ux-review/sources-pass1.md), [independent UI/UX pass](ui-ux-review/sources-pass2.md); [configuration contract review](ui-ux-review/sources-configuration.md) complete (code-focused).

- [x] **P2 · SRC-01/02:** Clarify that cached mount suggestions are container paths; place the opened directory choices immediately with their trigger and distinguish them from always-visible Check directory controls. Choices are currently collapsed initially.
- [x] **P2 · SRC-03:** Propose a dedicated Scan & refresh flow with explicit run options, start/progress/results and clearly identified prior reports. Current mapping review is not a saved scan preset.
- [x] **P2 · SRC-04/05/08:** Replace uneven columns and nested technical forms with titled sequential sections for provider connection, subtitles, descriptive metadata and refresh settings. Simplify copy and move optional details to accessible help.
- [x] **P2 · SRC-06:** Use paired mapping inputs with Add mapping and validate the local destination at save; distinguish provider-side path checks and inaccessible/offline storage rather than statting upstream paths locally.
- [x] **P2 · SRC-07:** Design one modal-footer Save with a defined draft/validation/partial-failure contract; keep Disconnect with the integration section as secondary. Review save versus scan side effects first.
- [x] **P2 · additional:** Make Manage source entry points predictable: consolidate or clearly distinguish Source details from connection/caption/metadata/refresh settings.
- [x] **P3 · additional:** Hide or disable Disconnect when no connection exists; unsupported mount suggestions should not also show a misleading No matches search state.
- [x] **P3 · additional:** Keep source-named scan summaries and completion time; put raw JSON in expandable technical details.
- [x] Apply the shared modal/footer, directory tree, information popovers, confirmation and action-group components to Add/Edit/Configure and scan flows. Keep local headings/copy fixes here.
- Alignment: recursive subtitle scope and safe work limits; transaction boundaries for one Save; exact scan options. No Sources CSP violation was captured; keep global investigation open.

### Generated Assets

Evidence: [owner-request pass](ui-ux-review/generation-pass1.md), [independent UI/UX pass](ui-ux-review/generation-pass2.md).

- [x] **P2 · GEN-01/03:** Fix the job-detail count contract and terminal progress display; completed/failed/cancelled/reused output states must show finite totals and settle visibly. The exact moving-bar animation remains unconfirmed.
- [x] **P2 · GEN-01:** Correct reusable-output preflight counts for canonical path aliases; preserve existing safe reuse and linked-output rejection. Actual generation reused the tested file correctly.
- [x] **P2 · GEN-02/03:** Separate active work from retained history, stop terminal polling and show current directory/file with a bounded collapsible result log. Avoid loading/rendering all 15,000 possible task entries per refresh.
- [x] **P2 · additional:** Include source, folder, output kinds, recursion and reuse/replacement mode in Confirm generation scope; users must verify expensive work without recalling another screen.
- [x] **P3 · GEN-01:** Clarify the existing unchecked regenerate option as “Replace existing outputs”; do not add a second overwrite mechanism.
- [x] Apply the shared sticky modal/footer to scope and progress, shared confirmation to cancellation/cleanup, shared tree picker to scope, and concise help/action groups to the page. Keep title capitalization local.
- Alignment: choose history retention/clear behavior and compact-log details. [Controlled slow-response investigation](ui-ux-review/generation-polling.md) confirmed repeated abort/restart can leave a completed job looking running; use single-flight completion-driven polling with cancellation for changed targets.

### Channels

Evidence: [owner-request pass](ui-ux-review/channels-pass1.md), [confirmed archived-sidebar follow-up](ui-ux-review/channels-archived.md); [independent pass complete](ui-ux-review/channels-pass2.md); [combined contract review](ui-ux-review/combined-library-channels.md) complete (code-focused).

- [x] **P1 · CHA-05:** Make adding a new programming group work on ordinary LAN HTTP. The picker currently calls unavailable `crypto.randomUUID`; selecting on localhost works, and replacing an existing group follows a different path. Reuse a compatible shared identifier utility and keep a page adoption task.
- [x] **P2 · CHA-02 / GLO-09:** Add explicit current-folder/recursive scope and folder-name versus filename matching. A live `_waiting_ignore/_SORT/test-clip.mp4` fixture shows why `test` currently returns ancestor folders: descendant matching is intentional, but invisible matching reasons are confusing.
- [x] **P2 · CHA-03 / LIB-03:** Propose a retained-draft channel wizard with focused steps, Back/Cancel, optional commercial configuration and final review/preview/publication; preserve whole-show/folder dynamic selections alongside exact collection selections until a product decision changes that model.
- [x] **P2 · CHA-04:** Design confirmed permanent removal for archived channels with visible retained-history/playback dependencies; current Delete archives and Archived offers Restore. Do not delete media or silently select a history policy.
- [x] **P1 · CHA-01 · confirmed:** Fix archived-sidebar DOM duplication: one exposure heading became six in five seconds with zero statistics requests, then 38 in the bounded run. Investigate duplicate sibling React keys and one-second rerenders; define archived-history behavior instead of presenting an active-only 404. [Archived follow-up](ui-ux-review/channels-archived.md).
- [x] **P2 · additional:** Gate unsupported archived subscription/publication actions; show archived state and Restore guidance instead of offering Add to profile guide that returns Channel not found.
- [x] **P2 · additional:** Distinguish No matching channels from true first-use onboarding and provide Clear search/filters.
- [x] **P2 · additional:** On narrow card selection, announce/focus the selected preview and provide Return to channels instead of leaving it below the full card list.
- [x] Apply the shared sticky modal/footer to details/programming/picker, confirmation to archive/delete/discard, search controls to picker, and readable-duration formatting to preview/exposure. Keep local headings/copy fixes here.
- Alignment: combined Channels/Library navigation and collection semantics, optional wizard steps, and archive/permanent-delete retention. No Channels style-CSP violation was captured.

### Library

Evidence: [owner-request pass](ui-ux-review/library-pass1.md), [independent UI/UX pass](ui-ux-review/library-pass2.md); [combined workflow/contracts](ui-ux-review/combined-library-channels.md) reviewed (code-focused).

- [x] **P2 · LIB-02/03:** Align on combined channel cards/catalog navigation and a retained-draft creation wizard. Preserve direct dynamic show/folder references alongside fixed collections, private-card/count filtering and bounded requests.
- [x] **P2 · LIB-04/06:** Apply a shared selection tray across groups/search/pages; distinguish Add selected videos from dynamic whole-group selection. Add Select all with stated scope and Apply/Cancel. Existing exact-subset collection creation/editing works.
- [x] **P2 · LIB-05:** Bound video-list height, API/DOM work and narrow-screen actions. Keep Details/Edit information inline or use readable responsive rows/cards. A two-video dialog was already 1,571px tall with offscreen Inspect actions.
- [x] **P2 · LIB-09 / LIB-10 / LIB-11 / GLO-09:** Apply explicit Search/Enter with folder/file modes, current-level/recursive scope, optional source-relative restriction, matching file rows and breadcrumbs. Query the indexed catalog; avoid HDD traversal while typing.
- [x] **P3 · LIB-01/07:** Explain Library, programming and fixed collections concisely; identify Source root/Folder/Saved collection cards so a source named test:channel is not mistaken for a channel.
- [x] **P3 · additional:** Give each catalog Open details action an item-specific accessible name; announce the saved collection by name with an Open saved collection action. Clarify intentional commercial-media visibility differences where relevant.
- [x] **Unconfirmed · LIB-08:** Retain collection-failure report for additional reproduction. Create/edit and ordinary HTTP creation succeeded; do not invent a blanket repair.
- [x] Apply shared modal/footer to details/collection/metadata/subtitle flows, confirmation to discard/removal, directory/catalog picker to browsing, information controls to optional concepts, and shared responsive selectable rows/search/tray to selection.
- Alignment: tray lifetime and profile/account changes; visible-page versus all-matching Select all; direct dynamic programming; combined navigation; final wizard save/publication boundary.

### Accounts

Evidence: [owner-request pass](ui-ux-review/accounts-pass1.md), [independent UI/UX pass](ui-ux-review/accounts-pass2.md).

- [x] **P2 · additional bug:** Prevent silent cross-form draft loss: Save account currently drops an entered password; Reset password drops pending role/enabled changes. Agree combined Save or explicitly independent drafts with protection.
- [x] **P2 · ACC-01:** Apply shared matching-secret fields to new-password confirmation with clear field errors; decide whether the same confirmation applies during account creation.
- [x] **P2 · additional:** Make session-revocation consequences visible. Unchanged Save currently invalidates that account’s sessions; decide no-op versus real-change policy before altering security behavior.
- [x] **P2 · ACC-02:** Place secondary Revoke sessions with account actions; name the target and show success/failure. Keep intentional self-revocation/sign-out recovery.
- [x] **P3 · additional:** Apply named success feedback to account Save, password reset and revocation; show the existing password-length requirement before submission errors.
- [x] **P3 · additional:** Preserve account identity beside Manage on narrow screens; current horizontal table separates the two.
- [x] Apply shared modal/footer to Create/Manage, confirmation to revoke/discard, grouped actions to Save/Revoke/Reset and accessible status feedback to completed changes. Keep local wording/capitalization tasks here.

### Profiles

Evidence: [owner-request pass](ui-ux-review/profiles-pass1.md), [independent UI/UX pass](ui-ux-review/profiles-pass2.md), [save/delete/permission contract review](ui-ux-review/profiles-lifecycle.md).

- [x] **P2 · confirmed bug · PRO-03/07:** Refresh effective-access diagnostics after grant/owner/PIN/account changes. Watch→Manage persisted but still said Management denied; removing access still said viewing allowed; setting a PIN still said Not required. Fresh API checks reflected the correct state.
- [x] **P2 · PRO-01/03:** Put useful owner/access summaries on cards and move generic explanation into accessible information controls; retain Inspect account as clearly labeled read-only troubleshooting.
- [x] **P2 · PRO-02:** Design authorized deletion with dependency preview, explicit confirmation and active-client recovery; determine retention/migration for schedules, reports and playback. Type conversion is also currently unsupported; decide whether Update includes it.
- [x] **P2 · PRO-05:** Stage one complete management draft and one footer Save; Cancel must discard staged changes. Define atomic batch versus explicit partial outcomes instead of sequencing independent commits silently.
- [x] **P2 · PRO-06:** Apply shared matching-secret fields to confirm new/changed TV PIN; preserve an untouched existing PIN and make Remove PIN explicit. Explain required re-unlock after change.
- [x] **P2 · PRO-07:** Apply bounded account/role checklists with Watch/Manage, implicit owner/admin access and disabled states. Do not expose account directories to unauthorized users or imply a grant changes ownership/private-channel access.
- [x] **P2 · PRO-04 / PRO-08:** Apply shared catalog directory tree to Allowed library and bound long grants with scrolling/checkbox selection; retain subtree semantics and authorization revalidation.
- [x] **P3 · additional bugs:** Refresh the open management title after a successful profile rename and name every Remove access action with its account; preserve sibling drafts/focus.
- [x] Apply shared modal/footer and confirmation to Create/Manage/remove/discard, accessible information controls to help and shared grouped actions to management. Keep page-specific copy tasks here.
- [x] **SUB-01:** Add Subscriptions beside Manage on each card; target that card’s profile ID and apply shared checklist modal. Preserve ordering, authorization, hidden subscriptions and explicit unsubscribe effects.
- Alignment: profile deletion/type conversion; save atomicity; subscription draft boundary; owner/admin implicit grants. Source grants do not reveal another account’s private channels.

### Subscriptions

Evidence: [owner-request pass](ui-ux-review/subscriptions-pass1.md), [independent UI/UX pass](ui-ux-review/subscriptions-pass2.md).

- [x] **P2 · SUB-01:** Move subscriptions into a correctly targeted profile-card modal with bounded channel checklist and ordered selected lineup; retain a clear Watch/guide entry and accessible Move up/down controls.
- [x] **P2 · confirmed error-state bug:** Show Subscription status unavailable when guide/membership loading fails; missing data currently labels an existing subscription Available to add, though mutation buttons are safely disabled.
- [x] **P2 · confirmed bug:** Preserve keyboard focus after reorder and announce position; current successful list refresh drops focus to BODY.
- [x] **P2 · GLO-06/08:** Apply shared responsive actions and application confirmation to unsubscribe; narrow labels currently split mid-word. Name channel/profile and the effect on active playback.
- [x] **P3 · additional:** Distinguish empty lineup, no eligible channels, loading and failure; announce added/removed/moved channel and target profile.
- [x] **P3 · additional:** Clarify the admin exception in private-channel copy. Preserve hidden membership when saving only the actor-visible checklist; never leak names/counts or implicitly unsubscribe hidden private entries.
- [x] Apply shared sticky modal/footer/checklist and focus-preserving asynchronous list feedback. Profiles retains Add Subscriptions button; Watch TV retains correct-profile lineup entry.
- Alignment: route/sidebar retention or redirect; atomic membership+order Save/conflicts; confirmation timing for playback-stopping removals; hidden memberships.

### Watch TV

Evidence: [owner-request pass](ui-ux-review/watch-pass1.md), [independent UI/UX pass](ui-ux-review/watch-pass2.md). Native behavior is code-inspected only, not device-verified.

- [x] **P2 · confirmed bug:** Fix narrow-player clipping: Go Live and previous/next fall outside the stage’s overflow-hidden boundary at 390×844. Constrain picture independently and let controls determine height.
- [x] **P2 · confirmed bug:** Make Browse → Watch current channel live actually leave pause after confirmation; current same-ID tuning preserves the paused Player.
- [x] **P2 · WAT-01:** Implement the aligned two-column layout: picture/program/current settings in the main column, profile/ordered channel selectors beside it; simplify header and duplicate guide actions. Stack clearly on narrow screens.
- [x] **P2 · GLO-07:** Add readable elapsed/total playhead time with distinct live/behind-live context; keep title, pause indicator and last-frame retention. Browser frame retention already works; decide persistent indicator when controls are hidden.
- [x] **P3 · additional:** Use one navigation/context row, put optional caption customization under Settings, show readable language names where available, and apply the corrected submitting-client version contract to Watch’s report preview.
- [x] Apply shared modal/footer to Browse/Profile/Recently aired/Report, confirmation to pause-discard actions, readable durations to pause, information controls to optional captions/audio explanations, and responsive action groups to playback. Adopt correct-profile subscriptions-modal entry.
- Alignment: hidden-controls pause treatment, elapsed versus airing labels, profile-switch discard consistency, persistent selector versus Browse modal. Native/physical-device acceptance stays deferred.

### Setup & server health

Evidence: [owner-request pass](ui-ux-review/operations-pass1.md), [independent UI/UX pass](ui-ux-review/operations-pass2.md).

- [x] **P2 · additional:** Put Needs attention and repair links ahead of completed setup steps; distinguish server-wide setup existence from selected-profile playback readiness. Keep checks read-only/bounded.
- [x] **P3 · GLO-04/05:** Apply human status/storage labels and readable low-space units; move optional backup bundle detail into accessible help while keeping no-backup/unknown/offline-restore consequences visible.
- [x] **P3 · additional:** Apply retained-data refresh feedback with snapshot timestamp, refreshing/stale/error state and duplicate-refresh suppression; current delay/failure removes all previous context.
- [x] Apply shared information/status/refresh patterns and agreed local heading/nav capitalization. Current page needs no new modal or directory picker.
- Alignment: navigation priority, completed-setup disclosure behavior. Cached health is not a real playback or backup-restore guarantee.

### Connect TV

Evidence: [owner-request pass](ui-ux-review/pairing-pass1.md), [independent UI/UX pass](ui-ux-review/pairing-pass2.md).

- [x] **P2 · confirmed bug:** Treat a changed same-page approval-link code as new intent: update input, clear prior review/success/error and require fresh review. Link B currently retains TV A’s approval action.
- [x] **P2 · confirmed bug:** Make approved state terminal until Connect another TV; handle response-lost-after-success, expired/unavailable and invalid code states with honest recovery. Never silently retry approval against an unreviewed device.
- [x] **P2 · confirmed bug:** Stop recommending loopback as a usable TV address; guide to operator-confirmed LAN/published address without scanning the host/network or accessing Docker.
- [x] **P3 · confirmed bug:** Focus/announce review and restore input focus after cancel/failure; pending completion currently drops focus to BODY.
- [x] **P3 · additional:** Use a valid code example and clear format validation; retain lowercase/space/hyphen paste normalization and never auto-approve.
- [x] Apply shared wrapping Cancel/Approve row and actionable errors; apply application navigation confirmation only if unsent public-code input still warrants guarding. Keep recognition/account-permission warnings visible and local heading capitalization here.
- Alignment: trusted advertised address, uncertain-approval reconciliation versus check-TV/new-code recovery, whether unsent public codes need a dirty guard.

### Devices & sessions

Evidence: [owner-request pass](ui-ux-review/sessions-pass1.md), [independent UI/UX pass](ui-ux-review/sessions-pass2.md).

- [x] **P2 · additional:** Make this-account sessions distinguishable: preserve approved TV display name/reference and minimal browser identity/created/last-active data where available; name accessible actions with their targets.
- [x] **P2 · GLO-08:** Apply shared target-aware confirmation to revoke, explicitly distinguishing this-browser sign-out and TV re-pairing. Preserve cancellation/error/retry behavior.
- [x] Apply shared responsive action rows and named completion/focus feedback so narrow Revoke labels fit; retain concise scope/consequence copy. No household-wide inventory or tracking retention is implied.
- Alignment: minimal stored device/browser metadata and retention. Revocation worked in live checks; no session defect was confirmed in pass 1.

### Problem reports / Your reports

Evidence: [owner-request pass](ui-ux-review/reports-pass1.md), [independent UI/UX pass](ui-ux-review/reports-pass2.md).

- [x] **P2 · confirmed bug:** Clamp/refetch pagination after deleting the only last-page report; 25 remaining reports currently show No reports until Previous.
- [x] **P2 · confirmed bug:** Apply global accessible destructive-button treatment to Delete report; current red-on-teal label measures 1.23:1 contrast.
- [x] **P2 · confirmed bug:** Record actual submitting-client version; new browser reports currently say 0.2.0 while browser is 0.2.2. Preserve historical snapshots and independent native versioning.
- [x] **P3 · additional:** Use compact category/status/time rows with optional technical details and a useful empty-state route to Watch → Report a problem. Any added channel/program context needs authorized snapshot/redaction rules.
- [x] Apply shared sticky modal/footer to pre-send review, target-aware app confirmation to permanent deletion and responsive action/status patterns to inbox actions; preserve explicit privacy disclosure and summary review.
- Verified: the fresh independent second pass completed UI Send and idempotent retry after a deliberately lost acknowledgement. The first-pass seeded-data rate limit is not an unresolved Send-success gap.
- [x] **Optional P3 · additional:** Consider New/Acknowledged filtering if inbox volume warrants it; keep bounded pagination and explicit retention.

### Sign-in, startup and profile unlock

Evidence: [owner-request pass](ui-ux-review/authentication-pass1.md), [independent UI/UX pass](ui-ux-review/authentication-pass2.md).

- [x] **P2 · confirmed UX bug:** Exempt ordinary sign-in/unlock input from configuration-draft discard guards; the first pass reproduced a misleading browser prompt when opening setup help after typed/rejected credentials; the second pass did not reproduce it with username-only entry. Preserve that evidence distinction while auditing the guard.
- [x] **P2 · additional:** Show the 4–8 digit PIN requirement and owner/admin recovery guidance; preserve protected profile name and Switch profile. This is confirmation for PIN changes elsewhere, not repeated entry to unlock.
- [x] **P2 · confirmed recovery bug:** If login succeeds but playback startup fails, show authenticated recovery and Retry startup; current UI returns to Sign in even though a browser session exists. Keep startup safety before playback.
- [x] **P3 · additional:** Clear rejected PIN digits and refocus entry while retaining error/rate-limit guidance; distinguish wrong PIN from uncertain network outcome. Use Signing in/Unlocking task labels and accessible optional visibility.
- [x] **P3 · additional:** Present startup connection failure with Retry connection/setup help and preserve an existing session when retry succeeds; do not disguise identity-loading failure as bad credentials.
- [x] Apply shared connection/error/help patterns and correctly scoped draft guarding; apply modal/focus behavior to profile picker. Keep permission-aware no-profile wording local.
- Alignment: initial browser profile choice versus first permitted profile; browser reload unlock lifetime. Native fresh-launch policy and intentional browser-admin bypass must remain explicit, not silently conflated.

### Setup & TV help

Evidence: [owner-request pass](ui-ux-review/help-pass1.md), [independent UI/UX pass](ui-ux-review/help-pass2.md).

- [x] **P2 · confirmed instruction gap:** State the full keep-stopped → bootstrap admin → clear bootstrap password → start/check sequence. Detailed runbooks require the shared data lock, but the short help omits the stopped/start steps. Commands were reviewed, not executed.
- [x] **P2 · confirmed accessibility bug:** Apply shared safe technical-token wrapping to enlarged 320/390px prose; an environment-variable name made a 320px layout 403px wide. Preserve exact command text.
- [x] **P2 · confirmed help gap:** Replace inert checkout paths with curated version-matched installation/recovery links or bundled help; a Docker user must be able to reach detailed TV/APK instructions without a local repository.
- [x] **P2 · GLO-04/05/06:** Add task jump links and a short TV-user path before long operator deployment/recovery detail. Keep prerequisites, read-only storage and restore/session consequences visible.
- [x] **P3 · confirmed navigation issue:** Preserve safe in-app return location; Sources → Help → Back currently returns to Channels. Direct signed-out help still needs a clear sign-in destination.
- [x] **P3 · additional:** Add direct Connect TV/setup-health links with authentication handoff; distinguish ADB install pairing from myTuner approval and state unavailable Vega-client support accurately.
- [x] **P3 · additional:** Explain technical terms and provide command location/success checks with manual-copy fallback on HTTP LAN; no automatic host commands or software installation.
- [x] Apply shared information/disclosure, task navigation, safe internal return and command/status patterns. Keep local TV/server/recovery wording and version-matched links on this page.
- Alignment: bundled versus release-hosted canonical help and approved APK distribution. Do not invent a new public download channel or arbitrary file serving.

## Representative local screenshots

These are temporary synthetic review captures on this Mac, not committed media or permanent release assets. Detailed reports link their complete evidence directories.

- [Archived sidebar adding repeated headings](/private/tmp/mytuner-ui-review/channels-archived/archived-repeated.png)
- [Narrow archived sidebar](/private/tmp/mytuner-ui-review/channels-archived/archived-narrow.png)
- [Generation modal stuck on running under simulated slow responses](/private/tmp/mytuner-ui-review/generation-slow/slow-desktop.png)
- [Narrow source configuration](/private/tmp/mytuner-ui-review/sources-p2/narrow-config.png)
- [Narrow library details](/private/tmp/mytuner-ui-review/library-p2/narrow-details-loaded.png)

## Proposed verification coverage

[Acceptance and visual-regression plan](ui-ux-review/acceptance-plan.md) covers shared components, page adoption, exact bug regressions, privacy and 8k+ performance. Tests/baselines have not been changed during investigation.

## Proposed implementation sequence after alignment

1. **Align flow and data semantics.** Confirm the decisions below and review changed layouts/wizard states before product edits. Keep the approved visual language.
2. **Correct independently reproducible defects.** Prioritize HTTP group selection and archived DOM growth; then progress/polling, lost drafts, diagnostics, pairing, player controls and report defects. These fixes can proceed alongside design work once implementation is authorized.
3. **Extend shared foundations.** Modal/footer, confirmations, scoped tree/search/selection, accessible help/actions and async feedback; establish backend contracts for atomic saves and bounded detail/log reads.
4. **Apply page updates.** Sources/Generation, Accounts/Profiles/Subscriptions, Watch/Connect TV, Sessions/Reports/Health/Help; retain explicit adoption and local copy tasks.
5. **Deliver combined catalog/channel workflow.** Hub, tray, exact/dynamic selections, creation wizard and dependency-aware archive/delete behavior after its product choices are settled.
6. **Run agreed acceptance.** Functional/accessibility and visual regression plus 8k+ performance/privacy checks. Keep real Unraid/TV/native acceptance separate and clearly recorded; do not install tooling or disrupt other containers implicitly.

## Decisions for alignment

The owner accepted these recommendations on 2026-11-26. The [accepted implementation decisions](UI_UX_IMPLEMENTATION.md#accepted-decisions) define the current behavior; this table preserves the original alignment discussion.

| Decision                          | Proposed direction                                                                                                                                     | What needs agreement                                                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Combined Channels/Library         | One hub with channel cards above catalog and both creation actions; retain a direct Watch TV route.                                                    | Page/sidebar name, horizontal-card behavior and existing route redirects.                                                                                     |
| Collections, tray and programming | Tray holds exact video references; collections stay fixed; wizard also accepts dynamic whole-show/folder groups.                                       | Tray lifetime/profile switching, visible-page versus all-matching Select all, mixed group presentation.                                                       |
| One Save                          | Stage full source/profile drafts and save all changes together or none after validation; keep explicit Scan and consequential Revoke actions separate. | New batch endpoints/conflicts; subscription membership+order transaction; whether Accounts combines password/settings or preserves independent drafts safely. |
| Wizard persistence                | Clearly distinguish draft creation, preview, final Save and publication/effective airing.                                                              | Client-only draft until Submit versus explicitly retained server Draft; Cancel and reopen behavior.                                                           |
| Permanent deletion                | Show dependencies; conservatively block archived-channel/profile deletion while retained schedules/playback require them; never delete original media. | History/report retention, migration/reassignment and whether a separate deliberate purge is wanted; profile type conversion scope.                            |
| Recursive browsing/subtitles      | Simple user-facing scope with bounded/indexed internals, lazy direct-child pages, cached branches and honest incomplete feedback.                      | Offline path-save policy, advanced depth controls, parent/subtree checkbox semantics and wide-folder continuation.                                            |
| Pause and startup                 | Retain last frame/title, add readable playhead time and separate live/airing context.                                                                  | Always-visible pause label with controls hidden; initial browser profile choice and reload unlock lifetime.                                                   |
| TV/session identity               | Use operator-confirmed LAN address and minimal distinguishable device/browser metadata.                                                                | Trusted advertised address source, uncertain approval recovery, metadata retention and route/sidebar placement.                                               |

Remaining evidence gaps include the exact Channels style-CSP error, the reported collection-creation failure and native/physical-device acceptance. Preserve reports as unconfirmed where local reproduction does not establish them; do not weaken CSP, expand filesystem work or install software to bypass an evidence gap.
