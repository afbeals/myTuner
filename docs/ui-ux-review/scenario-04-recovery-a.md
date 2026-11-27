# Scenario 04 — mistakes, interruptions and conflicting saves — pass A

Review only, myTuner 0.3.0. Independent walkthrough; no peer scenario-04 report was read. Read personal `AGENTS.md` and `docs/MYTUNER_PLAN.md`. Used existing `web-dist`, installed Playwright/Chromium, own `e2e/server.ts --demo` fixture on port **19306**, administrator designer, Living Room. Desktop 1440×1000; narrow 390×844. No build, installation, download, emulator, application/test/baseline change, Git mutation, or real-media access.

Evidence directory: `/private/tmp/mytuner-scenario-04-a/`. Screenshots were inspected with `view_image`, including the source reset, collection duplicates, profile conflict desktop/narrow and real generation desktop/narrow. Paired `.yml` files accompany captures made through the capture helper. `recovery-evidence.json` records mutation requests, explicit injections, read-only final verification and job timing. Product code was inspected only after the corresponding behavior was observed.

## Findings

### S04-A-01 — P1 — a stale name-only source save silently reverts its directory and resets newer configuration and grants

This is an actual two-tab concurrency case, with no network injection. Simple stale source renames also overwrite newer names. The destructive consequence below makes this more than a preference about last-writer-wins naming.

Exact UI reproduction:

1. Create an unused Custom videos source **Disposable recovery source**, directory `/private/tmp/mytuner-scenario-04-a/root-a`, Include subfolders enabled. Both root-a and root-b are owned disposable empty directories. Source ID is `3ee4104f-d4a0-4e27-8702-58f8e6eba3d3`.
2. In tab B, open **Edit Disposable recovery source**. Change only Source name to **Stale renamed recovery source**. Keep this dialog open with its old root-a value.
3. In tab A, edit the same source directory to `/private/tmp/mytuner-scenario-04-a/root-b`. Save. A correctly receives **Reset Disposable recovery source’s catalog?**, explaining the catalog/connection/profile-grant reset; choose **Save and reset catalog**.
4. In A, Configure this source, change Subtitle folder names from **Subs, Subtitles** to **RecoverySubs**, and Save configuration. Run its actual empty-directory scan.
5. In Profiles → Manage Living Room, choose this source under Allowed library → Choose folders → Entire source → Apply selection → Save profile. The profile now has three grants. The saved request contains `{sourceId:"3ee4104f-d4a0-4e27-8702-58f8e6eba3d3",subtree:""}` alongside its original two grants.
6. Back in B, click **Save source** once. B receives **no reset confirmation and no revision conflict**. The dialog closes successfully.
7. Reopen configuration and profile management to verify the outcome.

Observed before/after, same immutable source ID:

| Value                             | A’s newer saved state                    | After B’s name-only save                                                                        |
| --------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Directory                         | root-b                                   | **root-a**                                                                                      |
| Subtitle folder names             | RecoverySubs                             | **Subs, Subtitles**                                                                             |
| Living Room grant for this source | Entire source, saved; three total grants | **Removed; two original grants remain**                                                         |
| UI acknowledgement                | A explicitly confirmed reset             | B only sees “Source saved. Configure metadata and profile access, then scan the new directory.” |

Evidence: `08-before-stale-root-grant.png/.yml`, `09-stale-root-silent-reset.png`, `10-after-stale-root-config-reset.png`, `11-after-stale-root-grant-reset.png/.yml`, and `recovery-evidence.json`. Final read-only GETs for sources, source configuration and profile configuration all returned 200 and confirm root-a, default subtitle subdirectories and the missing grant. The JSON includes A’s root-b PATCH, RecoverySubs configuration PUT and three-grant profile PUT. B’s separate tab was not attached to the mutation recorder; its outcome is captured visually and by final GETs.

Impact is loss of newer configuration/access, an unexpected catalog reset and a return to the older source directory. The empty test source had no catalog items to lose. No claim of source-file deletion: **original/source files are untouched**. Existing in-use source checks still exist; this reproduction deliberately uses a source not referenced by channel programming or collections.

Explanation after observation: `web/src/Sources.tsx:249` compares directory/type with the object captured when the dialog opened, then PATCHes name, root, kind and recursive together without a browser-baseline revision. `src/server.ts:542` accepts that payload without a revision. `src/source-management.ts` checks for changes occurring during that one request, then computes reset against current server state. That check cannot detect the older browser baseline. Reset deletes source grants and resets subtitle configuration. A source-configuration revision does not protect this separate identity PATCH.

Recommendation: require an atomic expected source revision for this editor; return a conflict while retaining B’s draft. Send only intentionally changed fields for an ordinary rename. Make a destructive root/type reset require an explicit confirmation tied to the current server revision, so a stale full payload cannot authorize it accidentally. Offer review-latest with a preserved local draft.

### S04-A-02 — P2 — retrying collection creation after a lost success acknowledgement creates an indistinguishable duplicate

This case uses **targeted response-loss injection**, not an actual server failure. The server successfully creates the first collection and returns 201; Playwright discards only its acknowledgement.

1. My Network → Create collection. Name **Recovery collection**; include **The Last Platform**, exactly one video.
2. Route only the collection creation POST. Execute `const upstream = await route.fetch()`; record its **201**; then `await route.abort("failed")` instead of delivering the response. Do not mutate with an API helper.
3. Click Save collection. UI retains the name and selected video and displays **“Unable to reach the server. Check your connection and try again.”** Save collection remains available.
4. Remove the interception and click Save collection again.
5. Select the Collections filter. Two identical **Recovery collection · 1 videos** cards appear.

Read-only GET confirms separate IDs `225ee266-5269-4bd8-8640-98c4724a249b` and `7ad50480-8edb-4d95-a345-dbdf2580ceb6`, same owner/name/count. Evidence: `14-collection-ack-lost.png/.yml`, `15-collection-retry-duplicates.png/.yml`, JSON injection record and final collections GET.

Keeping the draft is good. The misleading part is treating an uncertain write as a safe fresh creation. Users can accumulate duplicates by following the recovery message. Duplicate names may be intentional, so uniqueness by name is not the proposed correction.

Explanation after observation: `web/src/CollectionEditor.tsx:163` creates with name/mediaIds and no retained creation key; `src/foundation-routes.ts:310` creates a new collection for each valid POST. Recommendation: give each creation draft a stable idempotency key retained through retry, return the original result for the same request, and explain uncertain-save status while checking whether that draft already saved.

### S04-A-03 — P2 — profile conflict protection retains the draft but gives a weak recovery path and offscreen feedback

Actual two-tab same-object conflict, no interception:

1. Open Manage Living Room in A and B at the same revision. In A change name to **Living Room A saved**; in B change it to **Living Room B draft**.
2. Save A, then Save B. B correctly rejects with **“Profile changed elsewhere; reload and review your draft”**, retaining B’s draft and other fields. A’s saved name is not overwritten.
3. At the default top scroll position, the footer remains visible but the conflict alert is below the long profile form. Desktop and 390px captures show the editable fields and active Save without a visible explanation. The dialog exposes Save, Cancel and Delete, but no Reload latest/review-latest control. Repeating Save cannot resolve a stale revision.
4. Cancel opens **Discard unsaved changes?**. Cancel there preserves the local draft; Discard changes closes it. Reopening is how a user can load current values, at the expense of that unsaved local draft.

Evidence: `05-profile-conflict-desktop.png`, `06-profile-conflict-narrow.png`; the captured accessibility snapshot recorded the exact alert. This is a recovery usability issue, not a failed revision guard or automatic draft loss. No manual merge or browser-reload draft persistence was demonstrated.

Recommendation: show conflict status at the dialog top/near the sticky Save action, focus or scroll to it, and add **Review latest** that preserves a copy of local fields while showing the newer revision. Require an explicit decision before replacing the retained draft. The generic Form catch only sets an error and renders it after form children (`web/src/ui.tsx:170–192`), explaining the below-fold placement.

## Walkthrough outcomes and positives

| Task and condition                                                                       | Observed outcome                                                                                                                                                                                                                                                  | Evidence                                                                                                                                 |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Source save with injected 4-second response delay after upstream 200                     | All dialog fields, Save, Close and Cancel disabled during request. No premature success.                                                                                                                                                                          | 01-source-saving                                                                                                                         |
| Source rename with acknowledgement dropped after upstream 200, then restored-route retry | Local values retained with connection error; retry succeeds on the same existing source. No duplicate source. Does not establish general safe replay for destructive operations.                                                                                  | 02-source-ack-lost, 03-source-retry-conflict (filename anticipated a conflict; actual result is successful source save)                  |
| Account sam role Editor → Viewer with browser context offline                            | Failure leaves Viewer selected, account checkbox states and password-change choice intact. Reconnect and retry succeeds.                                                                                                                                          | 12-account-offline-draft                                                                                                                 |
| Same account retry with injected 4-second response delay                                 | Repeated second Save click is disabled; only one PUT was observed in that delayed interval. All dialog controls disabled until acknowledgement.                                                                                                                   | 13-account-saving; JSON request list                                                                                                     |
| Existing collection whitespace-only name validation                                      | Server rejects “Invalid request”; exact whitespace draft and The Last Platform membership remain. Saved original name remains Recovery collection in final GET. Error is generic, with no useful field correction.                                                | 16-collection-validation-preserved                                                                                                       |
| Collection cancel/discard choices                                                        | Cancel → confirmation Cancel preserves the exact draft; choosing Discard closes editor back to the collection detail. Closing detail allows intended next navigation. No accidental save.                                                                         | JSON validationName/kept both three spaces                                                                                               |
| After School programming edit                                                            | Set Episodes per turn 1 → 2, advance Commercials → Preview, generate real two-hour preview, attempt Publish offline. Draft and current preview remain, connection alert appears. Reconnect → Publish succeeds with explicit effective-after-current-program time. | 17-channel-offline-preserved, 18-channel-offline-error-position                                                                          |
| Actual short source scan + reload                                                        | Reload initiated 12 ms after start click/request observation. Reopen Scan shows Last started/Last completed and **Finished**, Start scan enabled. This small scan did not remain running long enough to claim a captured pending state.                           | 19-scan-reopened-after-reload; scanTrace                                                                                                 |
| Actual JPEG + GIF generation of two synthetic fixture videos                             | Before reload: **running, 0/4**, Processing Orbit.S01E01.mp4. Reload at 160 ms retains active queue, Running 0/4. Reopen later: completed 4/4, zero failed, four individual results.                                                                              | 20-generation-before-reload, 21-generation-after-reload, 22-generation-reopened-finished                                                 |
| Generation cancel completion race                                                        | If work finishes while confirmation is open, confirming cancellation leaves truthful completed 4/4 status.                                                                                                                                                        | 23-generation-cancel-race                                                                                                                |
| Actual prompt cancellation and Retry unfinished outputs                                  | Immediate cancel/Continue produced cancelled 0/4, four cancelled output rows, Retry unfinished outputs. Retry became running, then completed 4/4 with zero failures; narrow results remain legible.                                                               | 24-generation-real-cancelled, 25-generation-retry-result (running at capture), 26-generation-retry-completed, 27-generation-retry-narrow |

## Conditions, boundaries and cleanup

- Browser offline means Playwright `context.setOffline(true)`, a simulated client connection outage. The local server stayed healthy; do not interpret these as backend failures. Targeted delayed/lost acknowledgements are explicitly recorded in the JSON. Two-tab source/profile conflicts and all job state changes used actual server behavior.
- All mutations were initiated through visible UI. The API helper was used only for final GET verification. No response body was changed to manufacture success, failure, pending or conflict. No source, job or collection was completed through direct API mutation.
- Source configuration itself saved through its staged revision-bearing dialog; the P1 bypass is the separate source identity editor. Account permissions were changed only inside this disposable admin fixture. Living Room’s temporary name was restored through UI before later tasks.
- The two video files and generated outputs were synthetic fixture content. No host service restart, actual LAN outage, production storage, large library, arbitrary long-running scan, physical device, emulator or original media was tested. No claim that small-fixture timing predicts HDD/Unraid behavior.
- No P0 was observed. Findings are bounded to this pass; there was no exhaustive keyboard, assistive-technology or every-editor validation audit. The generic whitespace validation message is a minor refinement, not elevated to a separate finding.
- Cleanup complete: awaited browser close and fixture SIGTERM/exit, then exited the driver. Final connection check reports **fixture port19306 closed**. Verified the owned `mytuner-ui-PbkuiM` fixture directory no longer exists. Removed the two empty root directories and own runtime/driver files. Evidence screenshots, JSON, browser events and server log remain under the named artifact directory. No shared runtime, peer server or peer artifacts were removed.
