# Scenario 05 — Library maintenance

Review date: 2026-11-26 (browser fixture clock crossed into late evening Pacific). Version 0.3.0 / schema 20. Review only: no product, test or baseline changes. All confirmed issues below are intended for correction after the walkthrough series; this is not a selection or ranking exercise.

## Environment and evidence

- Read repository `AGENTS.md` and `docs/MYTUNER_PLAN.md` before beginning.
- Existing `web-dist`, existing Playwright/Chromium and `e2e/server.ts --demo`; isolated server at `http://127.0.0.1:19308`.
- Admin `designer`, profile **Living Room**. Credentials are synthetic fixture credentials; no real accounts or media were used.
- Desktop 1440 × 1000 and narrow 390 × 844. Screenshots were inspected using `view_image`, never an OS viewer. The full-page captures include the page behind a viewport-fixed dialog; the viewport-only deletion/offline captures show its actual narrow-screen presentation.
- Evidence directory: `/private/tmp/mytuner-scenario-05`. Numbered `.png` files have matching `.yml` accessibility snapshots unless the name ends in `viewport`. Additional files: `collection-channel-readback.json`, `browser-events.json`, `server.log`, `cleanup.json`.
- Browser actions performed all app mutations: scans, metadata choices/saves, tray selection, collection creation/edit/delete/Undo, channel creation and previews. Read-only API requests supplied source paths and a programming readback after the UI actions. No API writes were used to bypass the UI.
- Explicit filesystem preconditioning was confined to the fixture-owned temporary root `.../T/mytuner-ui-1g5QUc`: synthetic copies/additions, temporary removal, replacement, directory rename and restoration. A restarted preliminary owned fixture used `.../T/mytuner-ui-l5N6xr`; both roots were removed on shutdown.

## Walkthrough and outcomes

| Step | Visible UI action and fixture precondition                                                                                                                                      | Observed result                                                                                                                                                                                                                                                                               | Evidence                                                                               |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1    | Open Sources, then My Network → Orbit Patrol                                                                                                                                    | Two original synthetic episodes; source paths and scan action visible. Library explains exact videos versus whole shows/folders.                                                                                                                                                              | `01-sources-desktop`, `02-metadata-manual-desktop`                                     |
| 2    | Edit The Last Platform: Title source Manual → `Keeper title`; Description source Local metadata; Save information                                                               | Explicit success status; editor remains open. Manual and local choices independently save.                                                                                                                                                                                                    | `02`, `06`                                                                             |
| 3    | Select Keeper title → Add 1 video to tray → Create collection from tray → `Fixed favorites`                                                                                     | Collection saves one exact member; tray clears. Intro explicitly says future files require editing the collection.                                                                                                                                                                            | `03`, `04`, `08`                                                                       |
| 4    | Program the saved collection in new private channel `Maintenance fixed`; complete preview/create                                                                                | Channel created with a collection selector. Wizard Step 2 labels it only “Saved collection,” omitting its name.                                                                                                                                                                               | `03-collection-programming-unnamed`, programming readback JSON                         |
| 5    | Edit this already-programmed collection; add Maple Street; save                                                                                                                 | Detail now lists both members. Reopening the channel and generating preview includes Maple Street and Keeper title. The collection edit itself gives no channel impact/timing explanation.                                                                                                    | `04-edit-in-use-collection-before-save`, `09-edited-collection-channel-preview`        |
| 6    | Add synthetic `Orbit.S01E03.mp4`/NFO (`New arrival`), create `Bonus/Bonus01.mp4`, change original E01 NFO title/description; Sources → TV shows → Scan and refresh → Start scan | “4 videos found · 2 updated · 0 missing · 0 errors.” Show has three episodes; fixed collection still two. Manual title remains Keeper title; explicitly local description changes to “Changed local description.”                                                                             | `05`, `06`, `07`, `08`                                                                 |
| 7    | Preview existing whole-show channel After School                                                                                                                                | New arrival appears. Contrast: saved-collection channel preview contains its two explicitly selected members, not E03.                                                                                                                                                                        | `09`, `10-whole-show-includes-arrival`                                                 |
| 8    | Temporarily move only synthetic E02 into fixture spare directory; scan                                                                                                          | “3 videos found · 0 updated · 1 missing · 0 errors.” Collection retains Maple Street as unavailable, disabled for new tray selection. Detail can inspect it; editor can explicitly remove it.                                                                                                 | `11`–`15`                                                                              |
| 9    | Delete Fixed favorites while used by Maintenance fixed                                                                                                                          | Confirmation identifies both direct future programming and overlapping scheduled matches, names linked channels, states originals remain in place. Delete succeeds; visible Undo restores the collection including its unavailable E02 reference. Recently deleted opens normally after Undo. | `16`, `17-delete-used-collection-narrow-viewport`, `18`                                |
| 10   | Folders and file names → Choose folder Bonus → Program this whole folder; create `Maintenance folder`                                                                           | Folder selection is dynamic, with include-subfolders control.                                                                                                                                                                                                                                 | `19-folder-programming-choice`                                                         |
| 11   | Restore E02; replace synthetic E01 at same path with different synthetic bytes/duration (12 sec → 8 sec); add Bonus02; scan                                                     | “5 videos found · 3 updated · 0 missing · 0 errors.” Existing collection references remain; replacement duration becomes 8 sec. Original manual metadata is intentionally held for review rather than applied to replacement.                                                                 | `20`, `22`–`24`                                                                        |
| 12   | Generate Maintenance folder preview                                                                                                                                             | Bonus01 and newly scanned Bonus02 both appear without editing the saved folder selector.                                                                                                                                                                                                      | `21-whole-folder-includes-addition`                                                    |
| 13   | Rename synthetic Bonus directory to Bonus-renamed; scan; preview existing Maintenance folder                                                                                    | Scan finds new paths and marks old paths missing. Preview blocks with “No available programming; channel schedule cannot advance.” Old Bonus remains selectable with 0 available; Bonus-renamed separately shows 2 available.                                                                 | `25`–`28`                                                                              |
| 14   | Temporarily rename entire synthetic source root media → media-offline; scan                                                                                                     | Bounded scan completes with issues: 0 found, 0 updated, 0 missing, 1 error. Explicitly says previous availability retained; expanded error says “Directory could not be read.” Catalog is preserved.                                                                                          | `29`, `30-offline-error-details-viewport`                                              |
| 15   | Open Orbit Patrol while root offline, then Watch TV → After School → Watch live                                                                                                 | Library still shows three available episodes. Actual playback correctly reports “This scheduled video is unavailable. The channel will continue at the next interval.” Retained catalog availability is not actual playability.                                                               | `31-offline-library-retained-available`, `32-offline-playback-outcome`                 |
| 16   | Restore original root, original E01 bytes, original Bonus name; scan; inspect collection and folder preview                                                                     | Original manual title Keeper title returns automatically with original fingerprint. Original Bonus selection produces preview again.                                                                                                                                                          | `33`, `34-original-restored-metadata-reapplied`, `35-original-folder-restored-preview` |
| 17   | Restore E01 NFO; remove owned additions E03/Bonus; final UI scan; shut down                                                                                                     | Final scan: “2 videos found · 0 updated · 3 missing · 0 errors.” Removed synthetic additions remain catalog history until fixture teardown; originals are back. Teardown removes entire synthetic data/media root.                                                                            | `36-final-fixture-restored-scan`, `cleanup.json`                                       |

## Confirmed issues and friction

### M05-01 — Replacement says previous custom metadata is retained for review, but cannot show or reuse it

**Reproduce:** Set E01 title to Manual `Keeper title`, description to Local metadata, save. Replace its synthetic file at the same path with different bytes and rescan. Open Edit information. Notice reads: “The media identity changed. Previous custom information has been retained for review and is not applied to this replacement.” Both sources now show Automatic. Select Manual for Title: the input is empty. No previous value, comparison, copy, or reapply control appears. “Use current title as manual” copies the replacement’s current NFO title, not the retained custom value.

**Evidence:** `06-manual-after-rescan.yml` shows Manual/Keeper title surviving an ordinary NFO rescan. `23-replacement-lost-manual-metadata.yml` shows the replacement notice and Automatic choices; `24-replacement-review-manual-empty.yml` shows the empty Manual input. `34` proves original metadata was retained: restoring original bytes restores Keeper title.

**Impact:** The identity safeguard is appropriate, but its promised review is inaccessible. A user cannot inspect/reapply custom work to a legitimate replacement without remembering it. This is not a claim that the old data was destroyed.

**Recommendation:** Present the retained title/description and source choices with the old identity context, and offer deliberate per-field copy/reapply after review. Keep the replacement safeguard. If that recovery is unavailable, accurately explain what is retained and how to recover it.

**Observed-code explanation only:** `web/src/MetadataEditor.tsx` renders `requiresReview` as a notice and renders only current `choices`; it exposes no retained-values comparison/action.

### M05-02 — Collection summary silently changes its membership count when one file is missing

**Exact before/after:** Before E02 removal, Fixed favorites says **“Saved collection · 2 videos”** and lists two. After removal/rescan it says **“Saved collection · 1 videos”** while the same dialog lists **Keeper title — Available** and **Maple Street — Unavailable · retained**, with **“1–2 of 2”** pagination. Edit collection says **“2 selected videos”** and retains both. Restoring E02 brings the summary back to **“2 videos.”**

**Reproduce:** Put two available videos in a saved collection, temporarily remove one synthetic file, scan, open collection and then Edit collection.

**Evidence:** `08` before; `12`/`14` missing detail; `15` editor; `22` restored references. Desktop and narrow observations agree.

**Impact:** The unqualified total looks like a member vanished, even though retention is working correctly. Singular grammar also fails.

**Recommendation:** Show total membership and availability explicitly, for example “2 referenced videos · 1 available · 1 unavailable.” Use consistent counts in cards, details, editor and programming choices.

**Observed-code explanation only:** `src/library.ts:collectionSummaries` sums only `m.available=1`; `web/src/Library.tsx` labels that count simply “videos.”

### M05-03 — Editing an in-use collection omits its channel consequences and effective timing

**Reproduce:** Create Fixed favorites and program Maintenance fixed from the collection. Edit Fixed favorites and add Maple Street. Neither the collection editor nor its save confirmation identifies Maintenance fixed, offers an impact view, or explains whether existing generated airings, future generated batches or a separate publish action are affected. Generating the channel preview later resolves the updated collection.

**Evidence:** `04-edit-in-use-collection-before-save.yml`, `09-edited-collection-channel-preview.yml`; compare the much more informative deletion impact dialog in `16`.

**Impact:** The user must leave the edit flow and inspect channel programming to understand the effect. Preview proves selector resolution changes; this review did not prove the precise automatic live-schedule cutoff after a collection save.

**Recommendation:** Before save, show affected channels and a plain-language statement of the implemented activation semantics. Reuse an appropriately scoped dependency view. After save, link to affected channels/preview. Do not imply immediate replacement of already materialized airings.

### M05-04 — Channel-creation programming summary omits the chosen collection’s identity

**Reproduce:** From Fixed favorites details, select Program this whole selection in a channel; proceed to wizard Step 2. Content group 1 says only **“Saved collection.”** The final step says only **“1 content group.”** The preview lists videos, but does not establish which saved collection the channel continues to reference.

**Evidence:** `03-collection-programming-unnamed.yml`/`.png`. Later existing-channel programming correctly displays Fixed favorites, so the distinction is visible within the same workflow family.

**Impact:** With several saved collections, the user cannot verify the chosen ongoing selector from its summary. This is ambiguous labeling, not observed wrong selection.

**Recommendation:** Retain/resolve authorized selector titles through the wizard and final review, with source and fixed/dynamic context where relevant. Apply the same identity principle to whole shows and movie collections.

**Observed-code explanation only:** `web/src/SelectionPicker.tsx:selectionSummary` returns the literal “Saved collection” for any saved collection.

### M05-05 — Renamed-folder failure has no targeted recovery, and the missing folder remains a normal selectable result

**Reproduce:** Program Bonus as a whole folder, externally rename the owned synthetic folder to Bonus-renamed, scan, then preview the existing channel. Error is only **“No available programming; channel schedule cannot advance.”** On Content, the old Bonus selector remains with no missing-folder callout. Change content selection shows **Bonus · folder · 0 available** with an enabled Select action beside **Bonus-renamed · folder · 2 available**.

**Evidence:** `25` scan, `26-renamed-folder-preview-error-narrow`, `27-renamed-folder-old-selection`, `28-renamed-folder-choice-zero-available`. Restoring Bonus and rescanning resolves the original selection (`35`).

**Impact:** No destructive behavior occurred, and blocking an empty preview is correct. Recovery still requires the user to infer which group failed, navigate backward, and distinguish a retained missing folder from an intentionally empty selectable folder. A rename cannot safely be inferred solely from names.

**Recommendation:** Identify the affected group, source and relative folder in the error. Offer Change selection and Rescan source actions. Clearly label retained unavailable folders, and explain the consequence of deliberately selecting one. Offer explicit user-confirmed replacement; do not silently remap renamed directories.

### M05-06 — Offline scan freshness is lost when returning to the library

**Reproduce:** Temporarily make the owned source root unreadable by renaming it. Run scan; read the explicit retention/incomplete result. Return to library details. Orbit Patrol says **“3 available / 0 missing”** and all three rows say **“Available”**, with no retained/stale/source-offline context or scan-recovery link. A live attempt at the same time correctly reports the scheduled video unavailable.

**Evidence:** `29`/`30` retained scan result; `31` library; `32` actual playback outcome.

**Impact:** Keeping last known availability avoids erasing a useful catalog during an outage. The problem is the presentation: an unqualified Available label can be mistaken for a fresh disk/playability check after the app already knows the source scan could not complete.

**Recommendation:** Preserve catalog state, but propagate source inspection freshness to library, selection and readiness surfaces: e.g. “Last known available — source could not be checked,” with last successful check and source retry/configuration link. Keep the stored-metadata readiness disclaimer and runtime unavailable behavior.

## Positive behavior to preserve

- Exact selection/tray and dynamic whole-show/folder choices are visibly separated. Collection editor explains that saved membership changes only through editing; channel programming explains future discovered videos.
- Ordinary rescans preserve explicit manual/source choices, refresh changed NFO values, discover new files and measured durations, and avoid generating artwork/copying media.
- Missing collection members remain named, inspectable and removable by explicit user choice. Their new-selection checkboxes are disabled; an unrelated edit need not silently discard them.
- Deletion has a dependency review, linked channel identities, original-file protection and Undo. It distinguishes “Future programming” from overlapping “Scheduled matching videos.” Its technical paragraph could be shortened for household users, especially “materialized airings,” “paused revisions” and “recurring selectors.”
- Replacement metadata is fingerprint-bound. Different bytes do not receive old custom information without review; original bytes recover it. Existing collection references remain intact.
- Offline scanning explicitly preserves prior availability and reports issues rather than wiping the catalog. Runtime playback independently detects missing files and communicates an unavailable interval.
- Restoration plus rescan recovers the original folder selector and metadata. No source-media operation is exposed as part of these UI actions.
- Narrow deletion and scan dialogs retain reachable footer actions and legible controls. No independent dialog-overflow defect was confirmed from the inspected viewport images; wide tables require their existing horizontal/vertical scrolling.

## Unconfirmed hypotheses and limits

- **No wrong-selection bug confirmed.** The ambiguous wizard labels still produced the intended saved-collection selector in readback and expected preview members.
- **No manual-data destruction confirmed.** The replacement loses the applied choice on purpose; restoration proved retained values still exist. The confirmed issue is unavailable review/reapply UI.
- **No automatic rename matching expected/proved.** Old and new relative paths are distinct catalog references. The confirmed issue is missing status and actionable recovery, not failure to guess the rename.
- Collection edit preview was verified, but the precise live automatic regeneration boundary was not time-controlled or asserted. Do not convert this into a claim of broken schedule propagation.
- Actual playback was exercised only to distinguish offline retained catalog state from runtime availability. Segment requests during that deliberate outage included 404/500 responses; the UI showed the unavailable interval. No continuous playback quality or pause/replacement acceptance claim is made.
- No Sonarr/Radarr service was connected; integration outages, provider changes, configured external NFO roots, remote mounts, permission loss and concurrent-editor conflicts were not independently exercised here. Adjacent synthetic NFO and per-field Manual/Local choices were exercised.
- Existing short synthetic media makes many schedule intervals; this is not a scale, host-HDD, real-media or hardware-device result. No emulators, installs, downloads, shared rebuilds, source originals or Git writes were used.

## Cleanup and verification

Original fixture file bytes and folder/root names were restored and rescanned before removing the owned additions. Final UI scan returned two original videos and marked removed additions as missing, without errors. `r.close()` shut down the owned browser/server and removed the temporary fixture root; `cleanup.json` records `rootRemoved: true` and `previousOwnedRootRemoved: true`. A process check found no remaining owned runner/browser/server PIDs, and `lsof -nP -iTCP:19308 -sTCP:LISTEN` found no listener. Only this report was added to the repository; review artifacts remain under `/private/tmp/mytuner-scenario-05`.
