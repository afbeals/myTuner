# Setup & server health — pass 1

Route: `#operations`. Base: `a67d418cf7258e669b11fcc9cae63cdc1bcda92d`. Investigation only; application unchanged.

## Live scope and evidence

Independent synthetic helper fixture on port **19009**, admin `designer`, Living Room. Reviewed desktop **1440×1000** and narrow **390×844** screenshots, setup links, refresh/loading/failure/retry, empty overview and degraded/long-content variants. This page has **no local dialogs or expandable subflows**. Every distinct outgoing checklist/runbook/job link resolved to the expected page heading; destination editors belong to their own reviews.

Evidence: `/private/tmp/mytuner-ui-review/operations-p1/`: `desktop-default.png`, `narrow-default.png`, `narrow-degraded-injected.png` (all visually inspected), desktop empty/error/loading/degraded captures, matching ARIA `.yml`, `observations.json`, `browser-events.json`, `server.log`. Degraded, empty, delayed and 503 responses were **browser-injected**, not real storage/provider faults. Default fixture produced readable sources, unknown generated/cache storage, no backup, one ready and one unpublished channel. Normal and long names stayed within 390px (document scroll/client widths both 390).

Sources: `web/src/Administration.tsx:48–203`, `src/operations.ts:43–214`, `web/src/ui.tsx:171–239`, navigation `web/src/App.tsx:223–253`.

## Owner coverage and current behavior

- **GLO-01:** Not applicable locally: no modal. Retain shared modal adoption if future details dialogs are added.
- **GLO-02:** Not applicable: no filesystem/catalog selector.
- **GLO-03:** Changed UX preference. Sidebar already uses readable labels, but title casing is mixed. Apply the agreed capitalization to this page’s heading/nav label and retain an explicit health entry in any reordered administration navigation. Frequency ordering needs owner agreement; it is not a confirmed functional bug.
- **GLO-04:** Applicable; technical status copy remains (raw `generated`, `cache`, `ok`, `unpublished`, “materialized intervals”, “backup CLI”). See OPS1-02.
- **GLO-05:** Applicable; backup explanation occupies about 250px on narrow screens. Move optional bundle detail into accessible information controls, preserving no-backup/unknown state, no automatic schedule and offline-restore consequences visibly. See OPS1-02.
- **GLO-06:** Existing refresh and section links fit narrow screens. Improve health/action hierarchy and grouping (OPS1-01). No stacked destructive actions here.
- **GLO-10:** **Not reproduced**: no CSP style-src violations or runtime exception in captured console. Recorded errors were expected unauthenticated startup 401 and explicitly injected status 503.
- **GLO-07/08/09/11:** No playback, in-app confirmation, search or programming-duration controls on this page.

There are no page-specific owner IDs. Existing setup completion is explicitly **server-wide existence counts**, not an end-to-end readiness verdict for the selected profile. An already scanned source can truthfully show “Not yet checked” for the separate refresh-attempt history. Sources/integrations are optional/custom-folder compatible. Status is cached up to 15 seconds; Refresh does not bypass this and says so. Storage checks are bounded; backup visibility neither creates backups nor verifies offline restoration.

## Ranked findings and acceptance

### OPS1-01 — P2 · additional UX · Health problems are visually subordinate to completed setup

**Evidence:** Six completed steps remain fully expanded above health. At 390px the first health section starts below roughly 1,100px; low/unknown storage and no-backup warnings are farther down. Injected failed-source/expired-channel states get ordinary body text, and an expired channel has no nearby channel-repair link (`Administration.tsx:80–105,151–198`). This is a hierarchy/recovery improvement, not a false status result.

**Recommend:** Show a compact “Needs attention” summary first with links to Sources, channel programming, generation jobs and recovery help; collapse completed setup behind an explicit disclosure while preserving incomplete next steps. Keep read-only behavior.

**Acceptance:** A narrow-screen operator can identify failure/no-backup/expired coverage and reach the appropriate existing tool without scrolling through completed setup. Healthy and first-run states remain clear; no probing, scans or generation starts automatically.

### OPS1-02 — P3 · owner request · Translate status terms and shorten optional explanation

**Evidence:** Default and injected screenshots show raw storage/schedule state words and long backup prose (`Administration.tsx:151–197`).

**Recommend:** “Generated files”, “Temporary playback cache”, “Available”, “Not published”, and “Guide prepared through …”; format low free space sensibly instead of 1KiB becoming `0.00 GiB`. Apply an accessible information control for bundle details. Keep the distinction between guide coverage and actual TV playback visible.

**Acceptance:** Healthy/degraded/unknown/no-backup conditions use human labels, small positive storage values remain distinguishable from zero, and information controls work with click, keyboard and hover.

### OPS1-03 — P3 · additional UX · Refresh removes the last known health snapshot

**Evidence:** Delayed refresh reduced the entire status area to “Loading…”; the refresh button remained enabled. A subsequent injected 503 removed all prior source/storage/coverage context. Retry recovered correctly (`ui.tsx:185–220`, `Administration.tsx:70–77`).

**Recommend:** Retain the previous snapshot with its timestamp and a visible refreshing/stale/error status; suppress duplicate refresh activation while pending.

**Acceptance:** Pending/failure keeps prior readings explicitly dated, never labels them current, offers retry and announces completion/errors without repeated requests.

## Shared work, decisions and cleanup

Global candidates: accessible information control, common human-status/duration formatting, navigation order/casing, and retained-data refresh feedback. **Page adoption:** apply information/status formatting to storage/backups/schedules; apply refresh feedback to this overview; apply agreed heading/nav casing here. No new general directory tree or modal is needed for current flows.

Owner decisions: navigation priority/casing and whether completed setup collapses automatically after first run. No deletion/retention or cross-field-save changes proposed. Preserve Silver Signal panels, read-only source access and bounded checks; do not add continuous health polling or eager library loading.

Cleanup: helper `finally` closed Chromium, sent SIGTERM and awaited isolated-server exit; `e2e/server.ts:285–293` removes its temporary synthetic root on that signal. Process completed exit 0. Evidence retained only under `/private/tmp`; no production/media/credentials used and no app/test/version/build changes.
