# Independent human-journey review B — 2026-11-26

## Verdict

The principal journey works and the new-channel wizard is understandable: I added and scanned a custom source, selected videos from two folders, saved a collection, created and published a two-group channel with commercials, added it to Living Room, and watched actual synthetic playback. No P0/P1 failure or primary-task blocker was observed. This is an independent agent assessment, not a usability study with recruited users.

The main remaining human-friendliness problems are the transition from creation to later editing, ambiguous commercial-pool labels, late generic validation, and incomplete success-state guidance. A household administrator who understands mounted paths can complete setup; the existing programming editor still assumes more technical knowledge than the creation wizard.

## Method and boundaries

- Reviewed current local 0.3.0 build on an owned disposable fixture at `http://127.0.0.1:19232` using installed Chromium/Playwright; desktop 1440×1000 and narrow 390×844.
- Began from rendered UI and accessible labels, without reading product implementation, other reviewers' reports or automated test click instructions. Source inspection happened only after completing the principal creation and editing journeys, to explain observed findings.
- Signed in as the fixture administrator, selected Living Room, and used visible UI for every catalog/source/collection/channel/programming/subscription mutation. No API bypass completed a task.
- Preconditioning only: created two folders under the fixture's unregistered `spare` directory, and copied the fixture's own generated synthetic videos to `Nature/Forest.mp4` and `Animation/Moon.mp4`. These were temporary test patterns, not household media. Source configuration was entered manually because native macOS has no Linux container mount suggestions.
- One fixture restart recovered an automation wait caused by an outdated button locator: selecting a video changes `Add selected videos to tray` into `Add 1 video to tray`. This was an automation mistake, not an application failure. The source setup was repeated through the UI; initial and repeated captures contain different disposable paths.
- No application, test, baseline, dependency, version, credential or Git changes. No installation/download, Docker access, real Sonarr/Radarr, production library or emulator.
- Evidence: [/private/tmp/mytuner-journey-b](/private/tmp/mytuner-journey-b). PNGs were inspected directly with the image-viewing tool; none were opened through the OS or VS Code. Full-page captures include background content behind fixed dialogs; `37`–`42` are actual viewport captures and should be used to judge narrow dialog placement.

## Journey outcomes

| Task                       | Actual visible UI steps and result                                                                                                                                                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in and select profile | Sign in → Living Room → My Network. Role/current profile are visible. Completed.                                                                                                                                                                                                                                                            |
| Add custom source          | Sources → Add source → name and media path → Custom videos → Check directory → Add source. Readability/supported-name feedback is explicit and does not promise playback inspection. Completed.                                                                                                                                             |
| Scan                       | Source card → Scan and refresh → Start scan. Finished with `2 videos found · 2 updated · 0 missing · 0 errors` and completion time. Completed.                                                                                                                                                                                              |
| Configure/edit source      | Configure exposes subtitles, metadata files and manual/automatic scan settings; Cancel leaves configuration alone. Edit allows the source name/path/type to change; renamed the source successfully. Completed.                                                                                                                             |
| Find and select content    | My Network → Nature → select Forest → Add 1 video to tray; Animation → select Moon → Add 1 video to tray. The tray holds both exact selections. Completed.                                                                                                                                                                                  |
| Save collection            | Create collection from tray → Family favourites → Save collection. Named success feedback and Open saved collection link appear; tray clears. Completed.                                                                                                                                                                                    |
| Create programming         | Create channel → Family Evening/private/details → Programming → select Family favourites → Shuffle; add Orbit Patrol → move it above the collection. Completed.                                                                                                                                                                             |
| Add commercial rules       | Commercials → Synthetic commercials → between-program breaks, 50% mid-roll, 10-second maximum; cutoff/default minimum retained. Completed.                                                                                                                                                                                                  |
| Preview and create         | Final review → Generate preview → Create channel. Preview generated without creating a channel first; success explicitly says created and published. Completed.                                                                                                                                                                             |
| Subscribe and watch        | Add to profile guide → Watch live. Living Room guide includes Family Evening; video playback and audio/caption controls are available. Completed.                                                                                                                                                                                           |
| Pause/leave recovery       | Pause → My Network raises Leave paused playback confirmation; Leave playback proceeds. Clear consequence wording. Completed.                                                                                                                                                                                                                |
| Edit/publish programming   | Edit programming → change collection to ordered/two per turn → Commercials change maximum to 20 seconds → Apply commercial rules → Preview → Generate two-hour preview → Publish programming. Effective-time success appears. Completed.                                                                                                    |
| Invalid input/recovery     | Edit fixed positions to `banana` → Apply commercial rules accepts local input → Next → Generate preview gives generic Invalid request; publication remains disabled. Cancel → cancel discard confirmation preserves `banana`; confirm discard closes the draft. Safe rejection and cancellation work, but field guidance needs improvement. |

## Findings

### B01 · P2 · Commercial-pool options cannot be distinguished by source

In the existing-channel editor, Commercials → Commercial pool contained two separate options both labelled `All files` while the source-picker view had identified their sources correctly. The selected value was the synthetic-commercial root, but a person cannot tell which similarly named root they are about to select from this control. This can result in choosing ordinary videos as commercials.

Use `Synthetic commercials / Entire source` and `Family media / Entire source` (and source-qualified subfolder/collection labels), consistently with the creation wizard. Do not change pool eligibility rules merely to conceal ambiguous labels.

Evidence: [editor inputs viewport](/private/tmp/mytuner-journey-b/39-commercial-inputs-viewport.png), [full accessible snapshot](/private/tmp/mytuner-journey-b/32-edit-commercials-narrow.yml). Source: [Channels.tsx](../../web/src/Channels.tsx) renders only `o.label` for pool options.

### B02 · P2 · Invalid break positions fail late with no correction guidance

Entering `banana` in Fixed positions and choosing Apply commercial rules clears the unapplied-input warning and enables Next. Only Generate two-hour preview rejects it, with `Invalid request` and no field name or corrective instruction. Publication remains disabled, so an invalid schedule was not saved. This is a validation/recovery usability defect, not a demonstrated server-validation bypass.

Validate numeric tokens and the selected unit/range beside the input before applying or leaving the step; preserve the entered text and explain, for example, `Enter percentages separated by commas, such as 25, 50, 75.` Make server rejection identify the relevant field if a stale client still submits it.

Evidence: `browser-events.json` records the failed preview request; the visible result was `alert: Invalid request`. [41 viewport](/private/tmp/mytuner-journey-b/41-invalid-preview-feedback.png) was captured while the request was still pending and is **not** evidence of the final error text. Source: [Channels.tsx](../../web/src/Channels.tsx) converts arbitrary tokens with `Number(v)` and accepts them into the local draft before server preview validation.

### B03 · P2 · Detailed break explanations bury the schedule being reviewed

For the one-commercial fixture, a 20-second requested break yields a valid 12-second break with repeat-limit explanation. The existing editor renders the first 50 explanations consecutively before the schedule table. At 390px, the table started around 4390px below the viewport top, inside a 510px-high scrolling dialog body; the body scroll height was 16697px including its bounded schedule rows. The summary and sticky Publish control stay visible, but a person can publish without ever finding the useful schedule preview.

This is bounded rendering, **not** evidence of unbounded processing or a performance failure. Keep a concise commercial summary and perhaps the first distinct warning, put repeated explanations into a collapsed `Break details (50 shown)` section, and show the actual schedule before diagnostic detail.

Evidence: [preview accessible snapshot](/private/tmp/mytuner-journey-b/35-edit-preview-generated-narrow.yml), [preview capture](/private/tmp/mytuner-journey-b/35-edit-preview-generated-narrow.png). Source: [ChannelStatistics.tsx](../../web/src/ChannelStatistics.tsx) emits up to 50 separate paragraphs; [Channels.tsx](../../web/src/Channels.tsx) places diagnostics before Schedule.

### B04 · P2 · Guide subscription succeeds without updating its action or instructions

After creating/publishing Family Evening, the side panel says `Publish programming and subscribe this profile to see its guide`, although publication just succeeded. Choosing Add to profile guide works: Coming up fills, Watch live becomes enabled, and actual playback succeeds. However, the Add action remains unchanged and enabled and the creation-success banner still says `Add it to a profile guide when ready.` No named subscription-success status replaces it.

Distinguish `Published, not in Living Room's guide` from `In Living Room's guide`. On success, show named confirmation and change the action to `In guide` or `Manage guide`; retain a clear Watch live next step. Avoid recommending publication again when only subscription is missing.

Evidence: [before subscription](/private/tmp/mytuner-journey-b/24-channel-created-or-error.yml), [after subscription](/private/tmp/mytuner-journey-b/25-subscription-outcome.yml), [after subscription screenshot](/private/tmp/mytuner-journey-b/25-subscription-outcome.png). Source: [Channels.tsx](../../web/src/Channels.tsx), [subscription action](../../web/src/Channels.tsx).

### B05 · P2 · Later commercial editing is substantially harder than first-time setup

The new-channel wizard uses Commercial source, human-readable seconds, a small main form and collapsed Advanced variation and random breaks. Editing the same saved channel switches to Commercial pool, `Milliseconds into source program`, a second Apply commercial rules action, and always-visible random-count/min/max/repeat/cooldown fields, including min/max percentages when random count is zero. At narrow width, the commercial choices are shown before the principal rules.

The safety gate is good: changing a field disables Next and explains that inputs must be applied. Nevertheless, the user has to learn a different editor to do the same task. Reuse the creation form's units/wording/progressive disclosure in the existing editor, retain saved non-folder pool support, and make any Apply transition an explicit footer action rather than a distant extra form button.

Evidence: [creation commercial form](/private/tmp/mytuner-journey-b/21-commercial-controls.png), [edit inputs viewport](/private/tmp/mytuner-journey-b/39-commercial-inputs-viewport.png), [unapplied safety state](/private/tmp/mytuner-journey-b/33-unapplied-commercial-state.yml). Source: [ProgrammingRules.tsx](../../web/src/ProgrammingRules.tsx) versus [Channels.tsx](../../web/src/Channels.tsx).

### B06 · P3 · Successful publication still looks like a cancellable unsaved task

After Publish programming succeeds, the modal correctly says `Programming saved — effective …`, but its footer still says Cancel, publication is disabled, and its body says `Preview this draft before publishing`. It is unclear whether Cancel will undo the successful publication.

Use Done/Close after a successful save and replace unsaved-draft guidance with a brief published/effective-state summary. A new edit can return the modal to draft language.

Evidence: [published viewport](/private/tmp/mytuner-journey-b/37-published-viewport.png). Source: [Channels.tsx](../../web/src/Channels.tsx) renders draft guidance regardless of saved outcome.

### B07 · P3 · Scan options offer irrelevant provider refresh

A brand-new Custom videos source with no connection offers a checked `Refresh connected Sonarr or Radarr metadata` checkbox. The wording is technically conditional and the scan works, but a first-time user can reasonably wonder whether they have missed mandatory setup.

Hide the control when no relevant integration is connected, or show a noninteractive `No metadata connection` line with a Configure link only where useful. Do not make Sonarr/Radarr mandatory.

Evidence: [scan options](/private/tmp/mytuner-journey-b/06-scan-options.yml), [completed scan](/private/tmp/mytuner-journey-b/07-scan-finished.png). Source: [Sources.tsx](../../web/src/Sources.tsx) renders the option for every source.

### B08 · P3 · New-channel rotation terminology needs one concrete example

The wizard says `Groups rotate independently` and asks for `Group 1 videos per turn`, but does not show the useful `A1, A2, B1, B2` explanation already present in later editing. `Episode order` also appears for a collection of custom videos with no episode numbers. The preview splits videos around commercials, so repeated program names can be mistaken for repeated full videos without a continuation hint.

Reuse the editing example in the wizard, use a content-neutral `In order` label with episode/filename detail where relevant, and identify continued program portions in preview rather than making users infer that repeated names are two parts of the same airing.

Evidence: [wizard selected group](/private/tmp/mytuner-journey-b/19-group-selected.yml), [wizard generated preview](/private/tmp/mytuner-journey-b/23-generated-preview.yml), [later editor example](/private/tmp/mytuner-journey-b/31-edit-programming-narrow.yml). Source: [ChannelWizard.tsx](../../web/src/ChannelWizard.tsx), [order label](../../web/src/ChannelWizard.tsx).

## Positive observations to preserve

- The four-step channel creation flow has a clear beginning/end, preserves choices across steps and explicitly states that preview creates no channel or saved schedule.
- Source directory checking separates supported filenames/readability from actual playback inspection. Source-save and scan-complete messages identify what happened.
- Collection copy clearly distinguishes fixed exact selections from dynamic whole-show/folder programming. Tray selection across folders and named collection success both worked.
- Explicit Search/Enter avoids requesting catalog work for every keystroke. This small-fixture review does not quantify large-library performance.
- Sticky modal header/footer remain visible on narrow screens; captions/audio controls and retained paused title/time remain available.
- Invalid preview publication is blocked. Cancelling the discard dialog preserves the edited text; confirming discard removes only the draft. The pause-leave warning clearly states that returning joins live.

## Cleanup and limits

Browser and fixture were closed normally. Port 19232 returned `ECONNREFUSED`, and the repeated fixture root `mytuner-ui-ZERmPU` was confirmed removed. The first fixture also received Ctrl-C during automation recovery. Evidence screenshots and bounded server/browser logs remain under the review artifact directory; no auto-open watcher was created.

No complete regression suite was rerun because this pass changed only this review document. This is not Docker/Unraid HDD, live-provider, large-library, physical-TV, remote, emulator, soak or recruited-human acceptance. The application and its existing tests/baselines were left unchanged.

## Large nested-library follow-up

After the owner expanded the review, [the independent nested-library supplement](journey-b-nested.md) exercised 8,338 synthetic paths, explicit search/scoping, wide-folder and file pagination/cache, cross-folder exact collection/programming, and narrow layout. It records four additional findings and exact saved-reference verification; it does not turn this initial small-source scan into a large HDD benchmark.
