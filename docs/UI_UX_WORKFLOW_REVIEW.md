# Human workflow review: sources through live channels

Date: 2026-11-26. Application: 0.3.0, local `feature/ui-ux-overhaul`.

**The complete workflow works, including targeted programming from a large nested custom library. It is usable for a home-server administrator, but several selection, completion and mobile states still require too much inference.** Three independent reviewers completed the initial source-to-watch journey. Two of those reviewers then independently exercised a new 8,338-video nested fixture after the owner expanded the request. These are agent-led usability walkthroughs, not a study with recruited human participants.

No P0/P1 task blocker or wrong-media identity collision was established in these passes. The consolidated follow-up list below contains **11 P2 and four P3 items**. They were recorded during investigation; the owner subsequently authorized fixing every confirmed issue, together with the additional scenario-review findings. Application fixes begin after the unchanged-build reviews finish.

## Review coverage and evidence

| Pass                 | Visible UI coverage                                                                                                                                                                                               | Outcome                                                                              | Detailed report                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------- |
| A                    | Add/check/configure/scan custom source; exact selection; collection; private channel; ordering/commercials; preview/create; subscribe; Watch; edit/republish; inspect profile grants                              | Completed, including actual advancing browser playback                               | [Review A](ui-ux-review/journey-a.md)               |
| B                    | Add/scan/rename custom source; two-folder selection; collection; two programming groups; commercials; preview/create; subscribe/play; edit, invalid input and discard recovery                                    | Completed; invalid schedule publication remained blocked                             | [Review B](ui-ux-review/journey-b.md)               |
| C                    | Mobile-first source setup; scan; exact collection; named/described channel; commercial triggers/cutoff; subscription/playback; add another group/republish; invalid path/discard recovery                         | Completed, with desktop follow-up                                                    | [Review C](ui-ux-review/journey-c.md)               |
| A, nested supplement | Wide folder continuation; six-level drilling; leaf with more than 50 videos; exact cross-branch selections; duplicate filenames; channel from tray; single-file selection inside programming picker               | Targeted selections and programming exercised separately from source preconditioning | [Nested review A](ui-ux-review/journey-a-nested.md) |
| B, nested supplement | Recursive/shallow folder/file search; Nature/Travel restrictions; wide folder paging; cached Previous/Next; selections across file pages; duplicate names; collection-to-channel; repeated detail-link navigation | Exact six selected references verified after save; no unintended media included      | [Nested review B](ui-ux-review/journey-b-nested.md) |

All original source additions/scans and all collection/channel/programming/subscription mutations were performed through visible UI. The larger supplement deliberately preseeded its source, profile grant and index; it does not count those setup steps as UI achievements. Read-only post-save API inspection verified identities rather than replacing a UI task.

The larger fixture contained:

- **8,338 actual temporary video paths**, linked to one generated 120-second synthetic clip.
- **137 top-level directories** and **128 leaf directories with at least 64 videos**.
- Targets up to **six directory levels deep**, duplicate `Highlight.mp4` files in different branches, and four `Needle` files across deep Nature/Travel branches and `_waiting_ignore/_SORT`.
- A production-scanner preindex that reused the technical probe of the identical synthetic clip, avoiding 8,338 redundant ffprobe processes. This is a catalog/UI exercise, not a cold full-probe scan or Unraid HDD benchmark.

Desktop 1440×1000 and narrow 390×844 were inspected. The actual fixture manifests and exact saved references are linked from the individual reports. Screenshots remain local and temporary; none open automatically.

## What worked at large-library scale

- Recursive filename search for Needle returned exactly four intended files; shallow search returned zero. Folder-name search did not return unrelated ancestor folders just because a descendant filename matched.
- Restricting the query to Nature returned its two matching files; Travel returned its one. Full result breadcrumbs distinguished duplicate Highlight filenames.
- All 137 root folders were reachable through the inner folder scroller and More/Earlier controls. The initial 22 DOM rows are intentional virtualization, not lost folders. Both reviewers investigated and withdrew that initial suspicion.
- File pages remained bounded at 50. Selections from page one and page two survived paging and joined selections from other branches.
- Revisited result pages reused cached data with zero additional catalog requests in the observed sequences. Typing alone did not trigger catalog search requests.
- A saved six-video collection and its channel contained exactly the intended references, including both distinct Highlight videos. The tray-to-channel route also supported exact nested selections.

## Consolidated findings

Priority meanings here: P1 blocks a primary task without a reasonable workaround; P2 is a material usability, feedback or recovery problem; P3 is consistency/polish. The owner subsequently authorized all confirmed fixes, so severity does not determine selection. These labels preserve the original investigation triage.

| ID   | Priority | Surface                         | Finding and recommended outcome                                                                                                                                                                                                                                                                                                 | Independent evidence                                       |
| ---- | -------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| WF01 | P2       | Channel → profile guide         | Subscription succeeds but Add remains unchanged and no named success appears. Published-but-unsubscribed guidance also tells the user to publish again. Show published/membership state separately, confirm “Added to Living Room,” and offer Watch/Manage guide.                                                               | A02/A04, B04, C-02                                         |
| WF02 | P2       | Source → profile access         | Admin source/scan/channel success can conceal missing household-profile grants. Offer an explicit next step to choose permitted profiles, without silently granting access.                                                                                                                                                     | A01 and its Profiles UI inspection                         |
| WF03 | P2       | Existing programming preview    | Up to 50 break explanations precede a 100-row schedule. Short clips produced approximately 16,700px of inner scrolling on mobile. Lead with a compact review, collapse repeated diagnostics and make continued program portions clear. This is bounded rendering, not an unbounded-work finding.                                | A03, B03                                                   |
| WF04 | P2       | New channel commercial summary  | Selecting a pool with every break trigger off still says Commercial breaks configured, while preview contains no ads. Distinguish a selected pool from enabled break placement.                                                                                                                                                 | C-01                                                       |
| WF05 | P2       | Create/edit commercial settings | Later editing uses a substantially denser form, different units and an extra Apply action; some pools share the indistinguishable label All files. Reuse consistent controls/disclosures, qualify every pool by source, and preserve existing saved-pool capabilities.                                                          | B01/B05; A/C terminology observations                      |
| WF06 | P2       | Commercial position validation  | Nonnumeric text can be applied locally and fails later at preview with Invalid request. Validate beside the input with unit/range guidance and retain the entered text. Server validation correctly prevents publication.                                                                                                       | B02                                                        |
| WF07 | P2       | Mobile My Network               | The first media card began about 2,089px down; an empty tray occupied 351px. Collapse empty selection state, add Channels/Library jumps and compact optional filters. Preserve explicit search and bounded loading.                                                                                                             | C-03                                                       |
| WF08 | P2       | Selected-video review           | Search results disambiguate duplicate filenames, but tray/collection rows drop the path and repeat identical Remove labels. Preserve source-relative context and distinct accessible names throughout selection review. IDs remained correct.                                                                                   | Both nested passes; B09                                    |
| WF09 | P2       | Mobile filename results         | A deep-path search row clips its Add action inside the result list even though the overall page fits 390px. Stack or constrain row actions while keeping useful breadcrumbs readable.                                                                                                                                           | B10, measured internal overflow                            |
| WF10 | P2       | Reopen saved collection         | A persistent Open saved collection link can become a no-op after the dialog closes because its hash is already current. Reopen/focus the known collection or synchronize closing with the resource route. Card Open details is a workaround.                                                                                    | B11                                                        |
| WF11 | P2       | Programming file picker         | Add to selection suggests accumulating files, but this picker stages one file: choosing a second replaces the first. The selected-file status exists above the result controls and can be out of view. Use explicit single-choice wording/state, or deliberately support multiple selection. Keep the library tray route clear. | Nested A, with the existing status explicitly acknowledged |
| WF12 | P3       | Programming publication         | Successful save still offers Cancel and draft-preview instructions. Switch to Done/Close with the effective-time summary; return to draft wording on another edit.                                                                                                                                                              | A06, B06, C-04                                             |
| WF13 | P3       | Custom source scan              | A source with no provider shows checked Sonarr/Radarr-refresh controls. Show only relevant integration options or a concise optional-connection state.                                                                                                                                                                          | A05, B07                                                   |
| WF14 | P3       | Programming/collection wording  | Creation/edit use different names for the same order/turn controls, custom videos are called episodes, and singular/plural copy is inconsistent. Use content-neutral labels and one concrete alternation example.                                                                                                               | A07, B08, C-05                                             |
| WF15 | P3       | Collection → channel handoff    | A prefilled wizard shows only Saved collection instead of its known name. Carry the authorized collection label and useful item count into the review.                                                                                                                                                                          | B12                                                        |

Individual reports contain exact reproduction steps, screenshot paths, measured states and source references. A single-choice picker replacing its selection is not inherently incorrect; WF11 concerns misleading additive language and offscreen feedback. Likewise, private channels remaining invisible to other accounts is intended, not an access defect.

## Suggested work grouped by ownership

All confirmed follow-ups below are now approved for implementation after the scenario reviews. Shared work is listed once; page adoption remains explicit.

- **Global/shared components**
  - Consolidate the existing commercial-settings controls for creation and editing; retain support for saved collections/exact-file pools and source-qualified labels (WF05).
  - Give reusable selected-video rows optional source/path context and distinct action names, without requiring unbounded lookups (WF08).
  - Standardize content-neutral playback-order and turn labels (WF14).
- **Sources / Profiles**
  - Add the source-to-profile-grant next step (WF02).
  - Hide irrelevant provider-refresh options (WF13).
- **My Network / Library / Collections**
  - Apply the shared contextual selected-video rows to tray and collection review (WF08).
  - Improve narrow library entry density and filename-result actions (WF07/WF09).
  - Make repeated saved-collection opening reliable (WF10).
  - Preserve the collection name through channel creation (WF15).
- **Channels / Programming**
  - Separate publication, membership and readiness feedback; confirm subscription completion (WF01).
  - Make commercial-enabled summary accurate (WF04).
  - Apply the shared commercial form and consistent wording to both editors (WF05/WF14).
  - Give invalid positions field-level recovery guidance (WF06).
  - Put a usable schedule review before collapsed diagnostics (WF03).
  - Make single-file picker semantics visible beside the results (WF11).
  - End saved edits with Done/Close (WF12).

## Recommended future walkthrough rounds

The highest-value next round is **empty-install setup, multiple-user access, and interrupted/conflicting saves**. The owner subsequently authorized all eight numbered scenarios, with two independent passes each for scenarios 1, 2 and 4. The [scenario review register](UI_UX_SCENARIO_REVIEW.md) tracks that separate 11-pass investigation; the original five-pass results above remain unchanged.

| Scenario                            | What the agent should actually try                                                                                                                                 | Why it matters                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Empty household setup               | Begin with no sources/profiles/channels; create accounts and a profile, add/scan media, explicitly grant it, publish/subscribe, then sign in as a non-admin viewer | Tests the handoffs that seeded admin demos can mask                                                   |
| Multiple users/private channels     | Use owner, unrelated editor/viewer and admin across personal/shared-room profiles; try grants, PINs, subscriptions, profile switches and direct links              | Tests whether access rules are both enforced and understandable                                       |
| Interruptions and conflicting saves | Delay/drop a Save response, lose connection, reload during a job, edit the same object in two tabs, then recover/retry/cancel                                      | Exposes lost drafts, duplicate actions and misleading uncertainty                                     |
| Modify a working broadcast          | Edit group order, collections and commercials while two browser sessions watch, with one paused; inspect preview and effective-time messages                       | Tests continuity and the explanation of when changes apply                                            |
| Library maintenance                 | Add/remove/replace synthetic files, refresh metadata, edit a referenced collection and recover missing entries                                                     | Tests stale/removed-media guidance and fixed versus dynamic selections                                |
| Large background jobs               | Browse/watch while scanning or generating outputs; reuse existing assets, cancel, retry and reopen progress                                                        | Tests responsiveness, workload feedback and job recovery; real HDD resource acceptance stays separate |
| Audio/subtitle discovery            | Try embedded and adjacent/nested subtitle files, explicit roots, alternate audio, unavailable tracks and saved preferences                                         | Tests discovery, fallback wording and playback controls                                               |
| TV remote-only use                  | Pair, choose profile/PIN, navigate guide and tracks, pause/resume and recover from a server outage using only a remote                                             | Needs authorized physical-device access; emulator verification remains owner-deferred                 |
| Keyboard and enlarged text          | Complete the critical journey without a mouse; use long labels/paths, 200% text, short viewports and nested dialogs                                                | Complements automated axe checks with practical navigation and fit checks                             |

## Boundaries and verification

All sources and videos in this review were disposable synthetic fixtures. Existing installed Chromium/Playwright/Node/FFmpeg were reused. No product code, test case, snapshot baseline, dependency or version changed; no host software was installed/downloaded and no PNG auto-open process was created. No commit, push or deployment occurred.

The large catalog used many real paths to identical synthetic content; it does not establish cold-probe scan cost, varied-media compatibility, shared Unraid HDD performance, live Sonarr/Radarr behavior, physical-TV decoding/remote behavior, accessibility certification or long-duration stability. Profile accounts/initial data were preseeded in the first fixtures too; only the stated source-to-watch actions were exercised through UI.

Reviewers closed their browsers/servers and removed temporary media/databases. Evidence artifacts remain temporary local files. Documentation formatting, link checks and whitespace checks are appropriate for this documentation-only round; prior application regression evidence remains in [Verification](VERIFICATION.md), without claiming a new full test-suite run.
