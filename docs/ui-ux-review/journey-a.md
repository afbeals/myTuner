# Independent workflow review A — 2026-11-26

## Verdict

The small-library workflow is usable for a technically comfortable home-server administrator. I completed source creation, scan, exact-video selection, collection creation, channel programming with a shortened commercial, publication, profile subscription and actual browser playback through the visible interface. I also edited and republished the programming. The source form and step-by-step channel creation are substantially easier to follow than a configuration page with many unrelated save buttons.

I would improve completion feedback and the final schedule review before describing the experience as friendly to a first-time household administrator. Successful admin playback also masks the separate work required to grant a new media source to a household profile. No P0/P1 blocker was reproduced in this journey.

**Scope limit:** this first pass added one synthetic video under one nested folder. It does not establish large/deep custom-library usability. The completed 8,338-video supplemental nested-catalog pass is recorded separately below; its boundaries differ from this small source-creation journey.

## Method and environment

- Current local 0.3.0 browser/server assets on `feature/ui-ux-overhaul`; no rebuild or baseline changes.
- Independent disposable fixture on `http://127.0.0.1:19231`, existing installed Chromium/Playwright, desktop 1440×1000 and narrow 390×844.
- Started with rendered controls and accessibility snapshots. Source inspection occurred only after completing the journey, to explain observed findings.
- Logged in as synthetic `designer`, selected Living Room, and used a synthetic twenty-second H.264/AAC file generated inside this fixture's temporary `spare/Journey A/Nature` directory. No household files or live providers were accessed.
- No application-state API calls preconditioned or replaced the UI steps below. The only preparation outside the UI was generating the disposable test video/directory.
- This is an agent-led walkthrough, not a study with recruited human participants. Screenshots were inspected locally without OS/VS Code auto-opening.

## Visible-UI journey

| Step                                      | Observed result                                                                                                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in and select Living Room            | Completed; explicit profile choice made the viewing context clear.                                                                                                                |
| Sources → Add source                      | Named `Weekend videos`, entered the fixture media directory, selected Custom videos and kept Include subfolders.                                                                  |
| Check directory                           | Reported readable directory and one supported file name, while honestly saying playback had not been inspected.                                                                   |
| Add source                                | Saved successfully and advised scanning; no automatic expensive generation occurred.                                                                                              |
| Configure                                 | Opened the new source's subtitle, metadata-file and scan-schedule settings. The single footer Save configuration is understandable; defaults could be retained.                   |
| Scan and refresh → Start scan             | Completed: one video found, one updated, zero missing/errors; timestamps and terminal status were visible.                                                                        |
| My Network → Nature → select Evening Walk | Selected the exact video and used Add 1 video to tray. Dynamic whole-folder programming remained a separate action.                                                               |
| Create collection from tray               | Saved `Weekend Picks`; named feedback and Open saved collection appeared, and the tray cleared.                                                                                   |
| Create channel                            | Created local draft `Weekend Nature`, kept Private and entered a description. The four visible steps communicated where I was.                                                    |
| Programming                               | Added the saved collection, selected Shuffle and one video per turn.                                                                                                              |
| Commercials                               | Chose the synthetic commercial source, a 50% break, ten-second limit and the default cutoff behavior.                                                                             |
| Preview and create                        | Preview showed ten seconds of program, ten seconds of commercial and ten seconds of program. Created/published successfully.                                                      |
| Add to profile guide                      | Mutation succeeded; the channel became available in Living Room's Watch selector. The control did not acknowledge completion clearly.                                             |
| Watch live                                | Actual video played: `paused=false`, `readyState=4`, advancing current time and no media-element error. The guide contained the new channel.                                      |
| Pause, then leave Watch                   | Last frame and Paused/time presentation worked. Leaving required a clear discard-paused-position confirmation.                                                                    |
| Edit programming                          | Changed Shuffle to Ordered, advanced through Content/Commercials/Preview, generated the new preview and published. Saved status showed the effective time.                        |
| Mistyped source recovery                  | A separate unsaved source with a nonexistent path returned Directory not found, preserving values. Cancel then showed an in-app discard confirmation.                             |
| Supplemental profile-access inspection    | Living Room's Allowed library still contained only the two seeded sources. Weekend videos was available to add but was not granted. Admin playback had bypassed this distinction. |

## Findings

### A01 · P2 · A new source's completion path omits household-profile access

**Observed:** after saving a new source the success message was “Source saved. Scan when you are ready.” Scan completion then reported success. An admin could discover, program and play that media, but Living Room → Manage → Allowed library still lacked the new source. None of these completion states linked to the required profile-grant step.

**Human impact:** an administrator can reasonably conclude that a successful scan/channel means setup is complete, then encounter different behavior for household viewers. This is a discoverability gap, not evidence of an authorization bypass. The test channel was intentionally Private; its absence for a different account would be correct.

**Improve:** after creating/scanning a source, show “Choose which profiles may use this source” and a targeted profile-access action. A short readiness checklist could separate scanned, profile access configured, channel published and added to guide. Keep grants explicit.

Evidence: [source saved](/private/tmp/mytuner-journey-a/05-source-added.png), [scan completed](/private/tmp/mytuner-journey-a/08-scan-complete.png), [Allowed library](/private/tmp/mytuner-journey-a/37-profile-access-viewport.png). Source: [Sources](../../web/src/Sources.tsx), especially the new-source success message around line 188.

### A02 · P2 · Add to profile guide does not confirm its result

**Reproduce:** create/publish a channel, click Add to profile guide, then inspect the selected-channel panel. The guide updates, but the button remains Add to profile guide and the existing creation banner still says to add it. No channel/profile-specific success message appeared. Going to Watch proved that subscription succeeded.

**Human impact:** a user cannot tell whether the click worked and is encouraged to repeat it or troubleshoot a successful operation.

**Improve:** use “Added to Living Room” status, change the action to “In Living Room's guide”/“Manage subscriptions,” and provide a clear Watch action. Preserve retry feedback for failures.

Evidence: [after subscription](/private/tmp/mytuner-journey-a/24-guide-result.png), [working Watch selection](/private/tmp/mytuner-journey-a/26-watch-playing-mobile.png). Source: [Channels](../../web/src/Channels.tsx), subscription action around lines 552–566 awaits PUT and refreshes but provides no success state.

### A03 · P2 · The programming review is bounded but too long for a human to assess easily

**Reproduce:** program a twenty-second custom clip with a ten-second mid-roll, edit its rotation and generate the two-hour preview at 390×844. The dialog body measured **16,721 px scroll height / 510 px visible height**, containing **61 total paragraphs and 100 schedule rows**. Code inspection confirmed that individual break explanations are capped at **50**, and schedule rows at **100**; this is not unbounded rendering.

**Human impact:** many screens of commercial explanations precede the actual schedule. Sticky publication controls remain usable, but a user is likely to publish without understanding the schedule. The short synthetic video amplifies the valid repeated-break case; this does not measure household/HDD performance.

**Improve:** lead with a compact program/commercial summary and the first few complete programs; collapse detailed break explanations by default. Group split program intervals and label resumed segments, then offer bounded/paged details. Distinguish program/commercial rows in the new-channel preview too, whose current columns are Start/Video/Length.

Evidence: [edit preview](/private/tmp/mytuner-journey-a/30-edit-preview-result-mobile.png), [new-channel preview](/private/tmp/mytuner-journey-a/21-preview-mobile.png). Sources: [BreakDiagnostics](../../web/src/ChannelStatistics.tsx) and [Schedule](../../web/src/Channels.tsx).

### A04 · P2 · Published-channel empty guidance tells the user to publish again

**Observed:** immediately after final channel creation the banner said “Channel created and published,” while Coming up said “Publish programming and subscribe this profile to see its guide.” The schedule appeared after subscription. It was not evidence that publication had failed.

**Human impact:** two statements disagree about the completed task. A user may reopen programming and publish again instead of adding the channel to the profile guide.

**Improve:** distinguish loading, unpublished programming, published-but-unsubscribed and unavailable schedule states. For the observed state, say “Published. Add this channel to Living Room's guide to see its upcoming shows.”

Evidence: [published with contradictory guidance](/private/tmp/mytuner-journey-a/22-channel-created-mobile.png). Source: [Channels](../../web/src/Channels.tsx), generic empty-entry message around lines 531–535.

### A05 · P3 · Scan options mention a provider the custom source does not use

**Observed:** a newly created Custom videos source, with no Sonarr/Radarr connection, showed the checked “Refresh connected Sonarr or Radarr metadata” option and the metadata import/mapping-history disclosure.

**Human impact:** the user may wonder whether an external application is a prerequisite or whether custom scanning is configured incorrectly.

**Improve:** render connected-provider controls only when relevant, or show a concise “No metadata service connected” state with an optional setup action.

Evidence: [custom-source scan options](/private/tmp/mytuner-journey-a/07-scan-options.png). Source: [Sources](../../web/src/Sources.tsx), checkbox around line 380.

### A06 · P3 · A saved programming edit still ends with Cancel

**Observed:** after successful Publish programming the editor stayed open with “Programming saved — effective …,” disabled Publish programming and a Cancel footer. Its body again said to preview the draft before publishing.

**Human impact:** Cancel can imply that the saved update will be abandoned, while the generic draft instruction obscures the terminal state.

**Improve:** after success show Done/Close and a concise saved/effective-time summary. Use Edit again for another change.

Evidence: [saved editor](/private/tmp/mytuner-journey-a/32-published-editor-viewport.png). Source: [Channels](../../web/src/Channels.tsx), editor footer around lines 1000–1048.

### A07 · P3 · Creation/edit terminology changes for the same programming fields

**Observed:** creation uses “Group 1 order” and “Group 1 videos per turn”; editing uses “Rotation” and “Episodes per turn,” even for a custom-video collection. The collection dialog also displayed “1 selected videos,” and its resulting card “1 videos.”

**Improve:** use consistent “Playback order” and “Videos per turn” labels across both flows, with the existing concrete turn example. Fix singular/plural copy. This is polish rather than a completion blocker.

Evidence: [create programming](/private/tmp/mytuner-journey-a/16-programming-group.png), [edit programming](/private/tmp/mytuner-journey-a/28-edit-programming-mobile.png), [collection](/private/tmp/mytuner-journey-a/11-create-collection.png). Sources: [ChannelWizard](../../web/src/ChannelWizard.tsx), [Channels](../../web/src/Channels.tsx), [CollectionEditor](../../web/src/CollectionEditor.tsx).

## What already works well

- The media path is explicitly described as inside myTuner; sample directory checks do not pretend to prove playback.
- Success/error messages retain form values and distinguish scan/derivative generation. Scan completion is finite and dated.
- Exact-video tray selection and the collection explanation make fixed membership understandable; whole-folder programming is a separate visible action.
- The four-step channel wizard preserves context, makes commercials optional and prevents creating a channel before previewing.
- Primary/secondary actions and sticky dialog footers remain accessible at the narrow viewport.
- Actual browser playback and pause/leave confirmation worked in this journey.
- Profile account-access checklists and Allowed library are readable once the administrator finds the management dialog.

## Limitations and cleanup

No live Sonarr/Radarr service, Docker mounts, Unraid HDD, physical TV/remote, subtitles or new account provisioning were accepted by this pass. The Linux mount chooser was unavailable on the Mac fixture and honestly offered manual path entry/checking. The console included the expected unauthenticated startup 401; no page exception or media error was observed in the completed journey.

One automation locator used an assumed accessible name instead of the actual button name. It was corrected using the rendered accessibility tree; this is not counted as a product failure. An independent controller continued the same fixture/browser journey with explicit bounded action timeouts. Both browsers were closed, the original fixture printed CLOSED and its disposable source data was removed. No application/test/baseline files changed; only this review report is added.

## Supplemental deep/nested custom-library review

Completed separately: [independent 8,338-video nested-directory walkthrough](journey-a-nested.md). It verifies deep tree browsing, all 137 root folders, a 64-video leaf’s second page, five exact cross-branch references and the programming picker’s single-choice behavior. The supplement adds A08/A09, both P2 usability findings; it does not change the first pass’s source-creation or playback boundaries.
