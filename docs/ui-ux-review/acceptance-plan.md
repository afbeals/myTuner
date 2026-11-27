# UI/UX changes — verification plan

The owner approved the full scope on 2026-11-26. The implementation and adapted regression tests are in the feature branch; local backend/browser/accessibility/visual/native-build verification is complete. Docker engine, physical-device and shared Unraid acceptance remain external gates. The current results and remaining checks are recorded in [VERIFICATION.md](../VERIFICATION.md) and [the implementation phases](../UI_UX_IMPLEMENTATION.md). Reuse the repository’s installed backend and Playwright harnesses; obtain owner approval before any new tool/browser/SDK install. No production media or household-container disruption.

## Functional and regression checks

| Area                          | Meaningful checks after implementation                                                                                                                                                                                                                                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared modal                  | Long body scrolls independently; title/Close/footer remain visible at 1440px, 390px and short height; keyboard focus traps/restores through nested confirmation; pending/dirty cancel never loses edits silently. Browser-owned tab-close prompt remains separate.                                                      |
| Shared directory/catalog tree | Initial root-only load; bounded direct-child pages; branch expansion cancellation; cache reuse until unmount; invalidation on revision/authority change; wide/deep names; Apply/Cancel; parent subtree semantics; inaccessible path/ancestor/symlink protection; no video opens or filesystem scan on catalog browsing. |
| Search and tray               | Explicit Search/Enter only; folder-only versus filename and current-level versus recursive results; matching breadcrumb/reason; no fetch while just typing; cross-group/page exact selection, dedupe, Select all’s stated scope, unavailable media, profile/account changes and private metadata exclusion.             |
| Sources                       | Paired mappings and namespace-specific validation; missing/offline destination policy; key preservation/destination change; single-save rollback/conflicts/field errors; no unintended refresh scheduling or scan; explicit progress/results; partial/superseded scan semantics.                                        |
| Generation                    | Reuse/regenerate with synthetic outputs; canonical aliases/escaped paths; finite counts and each terminal state; single-flight polling under slow/error responses; no frequent terminal polling; bounded task logs; cancel/retry and current work.                                                                      |
| Accounts/Profiles             | Password/PIN mismatch sends no mutation; existing PIN preserved unless explicit removal; no cross-form draft loss; role/disabled/implicit access; diagnostics refresh; atomic or explicitly partial save; safe delete dependency handling/client recovery; no-op session policy.                                        |
| Subscriptions                 | Correct card profile ID; visible membership+order draft and Cancel; hidden private memberships preserved; ordering focus/announcement; failed/conflicted Save; unsubscribe playback consequences.                                                                                                                       |
| Channels                      | Ordinary LAN HTTP new/replace selection; archived sidebar DOM stays bounded for 60s; active↔archived/restore transitions; wizard Back/Cancel retains draft; preview/publish boundary; dynamic refs remain dynamic; readable durations and safe hard-delete policy.                                                      |
| Watch TV                      | Reachable narrow controls; same-channel Go Live actually resumes live; last paused frame and stable numeric position; hidden controls; selection versus tune; profile switching clears old data; caption/audio/report dialogs remain usable.                                                                            |
| Connect TV                    | Link A→B clears old review; normalized/invalid/expired/unavailable codes; explicit authenticated review; approved terminal state; lost-success-response recovery; LAN versus loopback address; keyboard focus and one approval per intent.                                                                              |
| Sessions/Reports/Health       | Named revoke/cancel/self-sign-out; report delete last page, correct client version/contrast, clean Send; admin/nonadmin filtering; dated previous health during refresh/failure and bounded checks.                                                                                                                     |

## Visual regression coverage

Capture deterministic representative states with the existing Playwright screenshot mechanism, using the accepted layouts and CI’s three-shard arrangement. Cover shared modal/tree/confirmation/help patterns once in depth, then retain page screenshots that catch incorrect adoption. Baselines need human review, not bulk acceptance of changed PNGs.

- Desktop/narrow combined catalog hub, tray with exact selections and channel wizard review.
- Sources Add/Edit/Configure, paired mappings with field errors, Scan progress/result.
- Generation active/terminal compact logs with finite progress and history.
- Profiles/access checklist/subscriptions modal, Accounts confirmation/mismatch/revocation state.
- Watch playing/paused with retained frame/time, narrow controls and nested selectors/report modal.
- Archived sidebar at two elapsed points to detect growth, reports compact/delete confirmation, pairing review/success/unavailable, health attention/refresh.

Assert geometry/visibility and semantic state alongside snapshots. A single screenshot cannot prove sticky behavior, absence of repeated requests, bounded DOM growth, preserved data, permissions or exact playback position. Use viewport captures/DOM bounds when diagnosing clipping; full-page captures may include off-viewport content.

## Performance and privacy gates

Retain the existing file-backed 8k+ mixed-catalog checks and compare bounded cold/warm browse/search/detail responses, rows transferred, DOM count and memory. Test a wide directory and maximum legal generation task count without loading everything into one response. Verify active playback/API responsiveness while background work is admitted; preserve worker cancellation, shared-RAM limits and no automatic HDD traversal.

Privacy checks cover editor/viewer/admin, another account’s private channel, grants narrowed while a modal/tray is open, deleted/unavailable selections and cached thumbnails/labels/counts. Revalidate at save/preview and each delivery endpoint, not only in the UI. No Docker socket, CSP relaxation or automatic original-media modification is part of a UI improvement.

Native layout/pause changes need Kotlin/build checks plus later owner-authorized physical TV/Fire validation with regular remote, tracks and frame/time behavior. Emulator/device acceptance stays explicitly deferred unless the owner changes that scope. Synthetic Mac evidence cannot establish Unraid HDD timing, VLAN reachability or physical-device decoding.
