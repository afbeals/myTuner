# Household scenario walkthroughs — approved review plan

Owner approval: 2026-11-26, after the [three-reviewer source-to-watch and nested-library investigation](UI_UX_WORKFLOW_REVIEW.md). The owner subsequently authorized fixing every confirmed issue from these walkthroughs, without severity-based selection or another approval step. Finish all reviews against the unchanged build, then implement and verify all confirmed fixes. No new software, emulator resumption, commits or pushes are authorized.

## Scope and independence

Run all eight scenarios below. Scenarios **1, 2 and 4 each receive two independent reviewers**; the other five receive one each: **11 passes total**. Numbering preserves the list presented to the owner. Separate fixtures/browser identities prevent reviewers from altering one another's data. Each reviewer starts from the UI and inspects code only to validate an observed issue; paired reviewers do not read one another's reports.

All use disposable synthetic data, installed tools and the current built 0.3.0 assets. No shared rebuild while fixtures run. Preserve source-media read-only, private-channel owner/admin restrictions, explicit grants and session/PIN policies. Keyboard, narrow-screen and relevant error-state checks are included throughout.

## Pass register

| Pass | Scenario                                      | Reviewer task           | Status                                              | Report                                                 |
| ---- | --------------------------------------------- | ----------------------- | --------------------------------------------------- | ------------------------------------------------------ |
| 1A   | Empty household setup                         | scenario_01_setup_a     | Complete                                            | [Setup A](ui-ux-review/scenario-01-setup-a.md)         |
| 1B   | Empty household setup                         | scenario_01_setup_b     | Complete                                            | [Setup B](ui-ux-review/scenario-01-setup-b.md)         |
| 2A   | Multiple users/private channels               | scenario_02_access_a    | Complete                                            | [Access A](ui-ux-review/scenario-02-access-a.md)       |
| 2B   | Multiple users/private channels               | scenario_02_access_b    | Complete                                            | [Access B](ui-ux-review/scenario-02-access-b.md)       |
| 3    | Edit an active/paused broadcast               | scenario_03_broadcast   | Complete                                            | [Broadcast](ui-ux-review/scenario-03-broadcast.md)     |
| 4A   | Mistakes, interruptions and conflicting saves | scenario_04_recovery_a  | Complete                                            | [Recovery A](ui-ux-review/scenario-04-recovery-a.md)   |
| 4B   | Mistakes, interruptions and conflicting saves | scenario_04_recovery_b  | Complete                                            | [Recovery B](ui-ux-review/scenario-04-recovery-b.md)   |
| 5    | Library maintenance                           | scenario_05_maintenance | Complete                                            | [Maintenance](ui-ux-review/scenario-05-maintenance.md) |
| 6    | Large background jobs                         | scenario_06_jobs        | Complete                                            | [Background jobs](ui-ux-review/scenario-06-jobs.md)    |
| 7    | Subtitles and alternate audio                 | scenario_07_tracks      | Complete                                            | [Tracks](ui-ux-review/scenario-07-tracks.md)           |
| 8    | TV remote navigation                          | scenario_08_remote      | Review complete; native physical runtime unverified | [Remote](ui-ux-review/scenario-08-remote.md)           |

## Required journeys

1. **Empty household setup:** start with only the bootstrap administrator and unregistered synthetic media. Add/check/configure/scan a source, create household accounts/profiles and PIN, grant library/account rights, create/program/publish/subscribe a shared channel, then watch as the intended non-admin. Identify missing handoffs honestly rather than using an API to complete the UI task.
2. **Multiple users/private channels:** use distinct owner, unrelated viewer/editor and admin contexts across personal/shared-room profiles. Exercise Watch/Manage, PINs, grants, subscriptions, direct links and identity/profile switching. Preserve the admin exception without interpreting a subscription as media access. Review both enforcement and the explanation presented to people.
3. **Editing a working channel:** modify groups, collections/order and commercial rules while two sessions watch, with one paused. Review preview/publication/effective-time feedback and whether the active/paused experiences remain understandable.
4. **Mistakes and interruptions:** delay/drop responses, lose and restore a local synthetic connection, reload during work, edit one object in two tabs, and retry/cancel uncertain actions. Check draft retention, duplicate mutations, conflict recovery and whether successful-but-unacknowledged work is described honestly.
5. **Library maintenance:** add/remove/replace only temporary synthetic files, rescan, edit metadata and collections already used by programming, and inspect missing/recovered entries and fixed/dynamic selection behavior.
6. **Large background jobs:** exercise a large indexed source and bounded actual job samples while browsing/watching; cancel/retry/reopen, reuse outputs and inspect feedback. Do not run thousands of encoders or stress the work laptop unnecessarily. Label simulated delay/probe/encoder preconditioning and distinguish UI behavior from target-HDD throughput.
7. **Subtitles and alternate audio:** embedded tracks, adjacent/nested external subtitles, configured search roots, missing/failed tracks and saved preferences. Observe actual browser behavior where supported and explain native/device limits.
8. **TV remote navigation:** inspect the current TV flow, DPAD/focus, pairing/PIN, guide, tracks and recovery with existing approved tools. Physical-device behavior cannot be claimed without access to the owner's TV. No emulator resumption, toolchain download or host installation. Record a partial/blocked runtime result if that is the actual boundary; static code/tests are not a live remote walkthrough.

## Evidence and completion

Each pass must record observed steps, successful/blocked outcomes, exact P0–P3 findings, reproducible evidence, concrete recommendations, positive patterns and cleanup. Read-only verification after UI actions may inspect saved references; it does not substitute for a successful visible-UI mutation. API/fixture preconditioning must be labelled.

Root will reconcile duplicate findings, compare independent paired outcomes, link the reports and record actual limits, then implement every confirmed fix and run meaningful regression/CI-equivalent checks. Completion means the requested investigation was performed and its constraints disclosed; a partial physical-TV runtime pass is not converted into a test pass. This document will be updated as each pass finishes.
