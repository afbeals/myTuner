# UI/UX implementation — approved scope

Owner approval: 2026-11-26. Every item in UI_UX_REVIEW.md is required/P0 delivery scope, including previously optional recommendations. Historical reviewer severities remain evidence, not permission to defer. Implement on feature/ui-ux-overhaul; preserve original media read-only and private-channel rules. No new host software or emulator verification is authorized. Maintain UI_UX_PREVIEWS.md with curated synthetic UI PNGs. After the owner reported repeated openings, automatic opening of diagnostics/baselines was stopped; keep those out of VS Code.

## Accepted decisions

- My Network combines channel cards and library; old Channels/Library links remain valid. Watch TV stays a direct first navigation destination.
- Exact-video tray is account/profile scoped and clears on permission/context changes or sign-out. Select all selects the current loaded page; dynamic whole-show/folder groups remain explicit independent options. Collections retain fixed references.
- Source/profile/subscription settings use staged atomic batch saves with revision conflicts. Account settings/password share one save, with explicit optional password intent; no-op saves never revoke sessions. Revoke remains separate and retains drafts.
- New channel wizard uses a local draft until final submission, explicit preview and final publication. Existing-channel edits preserve group identities and effective-airing rules.
- Profile type may be edited with owner constraints. Permanent channel/profile deletion is dependency-aware and blocked for active/retained references; no implicit history purge, media deletion or automatic migration.
- Directory expansion loads bounded direct children, caches until unmount and supports per-branch continuation. Parent selection means subtree inclusion; no exclusion semantics. Offline paths may be retained only as explicit unchanged saved configuration; newly changed destinations must validate.
- Subtitle UI uses Include subfolders with bounded advanced depth. Catalog browsing never crawls disks; explicit filesystem setup browsing is confined to permitted mounted roots and excludes app storage.
- Paused display always retains frame, title, Paused and frozen elapsed/total even with optional controls hidden. Profile switching confirms discarded pause. Browser starts with a profile choice; unlocks survive browser reload within existing session policy. Native fresh launch remains protected.
- TV address uses operator-confirmed LAN origin, never loopback. Lost approval response directs the user to check TV/new code without unsafe automatic reapproval. Minimal session labels and created/last-used times live only for that session; no device fingerprinting.
- Completed setup is collapsed after initial setup, with Needs attention first. Help is bundled and version matched, links to existing release documentation/APK policy without inventing public distribution. Reports include New/Acknowledged filters.

## Delivery phases

- [x] F1 Shared modal/confirmation/help/actions/secret fields/duration/navigation and confirmed correctness fixes.
- [x] F2 Atomic configuration/account/profile/subscription endpoints, lifecycle/dependencies and bounded catalog/log/tree reads.
- [x] F3 Source/Generation/Accounts/Profiles/Subscriptions management workflows and previews.
- [x] F4 Combined My Network hub, tray/search/tree, channel wizard and library details.
- [x] F5 Watch/Pairing/Sessions/Reports/Health/Help adoption and native pause presentation.
- [x] F6 Meaningful backend/browser/accessibility/visual/performance regression verification; full checklist reconciliation.
- [x] F7 Thorough independent review round, fix findings, repeat affected verification.

Unconfirmed original reports require targeted regression evidence; approval does not authorize inventing a reproduced cause or relaxing CSP.

## Reconciliation and CI verification checkpoint

A full item-by-item static reconciliation identified twelve remaining adoption gaps after the initial page implementation. These have been implemented: generation/deletion/subtitle footer placement; reusable mapping-row validation; credential visibility/task labels; named catalog actions/saved-collection links; focus recovery; dated session/scan feedback; source-root and mount-choice wording; readable languages; named subscription-removal confirmation; and an empty-reports Watch destination.

Integrated browser verification then found and corrected same-key catalog cancellation on remount, stale-result retention during same-scope refresh, Watch guide column overflow and nested dialog Escape propagation. Targeted backend regressions cover uncancellable directory-I/O admission/deadlines/bounded shutdown and late-database guards. These corrections do not change source-media permissions, private-channel access rules or the owner-deferred device/emulator boundary.

The exact hosted workflow is `.github/workflows/backend.yml`: release-version gate; backend format/typecheck/tests/compiled smoke; macOS Chromium shards 1/3–3/3 plus their required aggregate; Android assemble/unit/lint; and Ubuntu Docker build/acceptance. Local verification must use those commands where supported, retain full browser/accessibility assertions, and review intended PNG changes. Docker acceptance remains on the already-equipped Windows host or hosted CI, since this Mac has no authorized Docker installation. A passing local subset is not a hosted CI pass.

Pre-walkthrough local checkpoint: 456 backend tests; 117 browser functional/accessibility/visual tests across all three CI shards, run in comparison mode against 93 visually reviewed macOS baselines; 24 Android JVM tests plus build/lint under installed Java 17; compiled lifecycle/catalog smokes; and version 0.3.0 newer than freshly fetched upstream dc4ee4e (0.2.2). All 119 requirements are reconciled in [the full trace](UI_UX_COVERAGE.md), including two explicitly unreproduced reports. The Docker-input build and mocked publication safeguards pass; actual Docker acceptance remains external. See [verification](VERIFICATION.md) for commands, logs and limits. These results were recorded before commit/publication; see the feature PR for current Git status.

## Additional workflow corrections and reset

The subsequent five source-to-playback/nested-library journeys and eleven scenario passes found additional issues; every confirmed item was authorized and corrected. [The complete fix matrix](UI_UX_FIX_COVERAGE.md) maps original IDs to implementation and regression evidence. Earlier counts above are historical. The final expanded suite passed 680 backend tests, 146 browser comparison cases and one separate browser/offline-CLI lifecycle check; see current verification.

The owner also authorized a database-only reset with multiple independent agents over two rounds. The browser reviews current-admin identity, selectable categories, dependency reasons and exact counts; execution requires the stopped server's exclusive offline CLI, private password, full revision, typed confirmation and verified append-only backup. Schema 21 retains readonly roots and cleanup protections across reset/restore. Both required independent reset review rounds are complete, with every confirmed finding fixed/retested; [the safety register](RESET_SAFETY_REVIEW.md) records the executed evidence and limits.
