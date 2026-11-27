# Channels — archived-sidebar follow-up

Owner clarification: selecting an archived item makes the sidebar keep adding exposure headings. Investigation only, base `a67d418`, synthetic fixture port 19030. Desktop 1440×1000 and narrow 390×844 screenshots were visually inspected. No product changes.

## CHA-A01 · P2 · confirmed rendering bug (CHA-01)

Reproduction: sign in as the synthetic administrator, select After School, Archive channel, open Archived and select After School again. The sidebar begins with one “Scheduled and delivered exposure” summary. After five seconds there are **six** summaries, after another eleven seconds **17**, and the final bounded sample contains **38**. The sidebar grows from 26 descendant elements/1,147px to 139 elements/2,597px. Growth occurs while the exposure disclosure is still closed.

There were **zero statistics/readiness requests** during the first five seconds. Opening one disclosure then made **one** statistics request, which returned `404 Channel not found`; repeated headings continued appearing. This is actual DOM duplication associated with rerendering, rather than repeated API responses or repeated text in one response. The one-second clock in `web/src/Channels.tsx:126` explains the observed cadence.

The leading code-level cause is duplicate sibling React keys: `ChannelStatistics` at `Channels.tsx:320` and the administrator `ReadinessPanel` at `:336` both use `selected.id`. Archived selection removes the preceding conditional Create-from button (`:308`), changing the reconciliation path. A fix has not been applied or experimentally validated. Investigate sibling identity and state reset together; avoid masking the symptom with hidden overflow or stopping the clock.

There is also an archived-state contract mismatch: statistics stays available in the sidebar, but its route calls `visibleChannel`, which intentionally selects `archived=0` (`src/security.ts:337`, `src/foundation-routes.ts:389`). An archived sidebar should clearly identify the archived state and expose only supported actions/history. Decide whether historical exposure remains viewable through an explicitly authorized archived-history contract or is unavailable until restore. Do not broaden active-channel authorization as a shortcut.

## Future acceptance and page task

- [ ] Give sibling components distinct stable identities; preserve/reset their state correctly across active/archived and channel switching.
- [ ] Keep summary and sidebar element counts stable during at least 60 seconds, including open/closed exposure, archived selection, restore and active↔archived switching; cover admin and eligible non-admin paths.
- [ ] Present supported archived-history behavior without a misleading retryable active-channel 404; retain private-channel restrictions.
- [ ] Confirm no extra statistics requests occur merely from clock updates and no stale headings remain after switching channels.

Evidence: `/private/tmp/mytuner-ui-review/channels-archived/results.json`, `archived-repeated.png`, `archived-narrow.png`, accompanying ARIA snapshots and `browser-events.json`. Script: `/private/tmp/mytuner-review-archived.mjs`. An initial run stopped on Playwright’s strict-mode duplicate match, then the complete bounded run explicitly selected the last summary. The script’s `finally` closed browser and fixture; final process exited 0. No real media, new tools, app/test edits, commits or pushes.
