# Problem reports / Your reports — pass 1

Route `#reports`, plus playback’s **Report a problem** dialog. Base commit `a67d418cf7258e669b11fcc9cae63cdc1bcda92d`. Isolated synthetic fixture port 19012; 1440×1000 and 390×844. Admin and nonadmin editor reviewed. Desktop/narrow inbox and modal screenshots were visually inspected. No product changes.

## Current behavior and owner coverage

Admin sees authorized viewer submissions across accounts; nonadmin sees only its own, with no acknowledge/delete controls. Synthetic admin and editor each submitted one report through preview/send APIs. Editor received one report, admin two; editor admin-list request returned 403. Acknowledge changed New to Acknowledged and disabled that action. Cancellation preserved reports. Retention is currently 30 days. A report is an explicit minimal structured playback snapshot, not logs, media, screenshots or a free-text support conversation.

- **GLO-01:** submission uses the shared dialog, but its Close/header and Send action scroll with content; narrow screenshot shows Send below the initial modal viewport. Apply sticky modal header/footer.
- **GLO-03:** navigation has capitalized Problem reports / Your reports. The page headings add “Playback” / “problem”; standardize wording locally. Global ordering remains a shared decision.
- **GLO-04/GLO-05:** essential privacy disclosure should stay visible. Replace “permitted reports” with a plain report count; present technical UUIDs/delivery details in an optional, keyboard-accessible disclosure while retaining them in the explicit pre-send review.
- **GLO-06:** Refresh and acknowledge/delete actions wrap without document overflow at 390px. Improve destructive hierarchy and compact scanning (below).
- **GLO-08:** Delete invokes browser `confirm`; apply the shared application confirmation modal. It must retain permanent-deletion wording and identify the selected reference. No browser tab-close change is implied.
- **GLO-10:** no CSP violations reproduced. Observed 401/403 are authentication/authorization/CSRF checks; 503 is injected and 429 is fixture-seeding interference.
- **GLO-02/07/09/11:** no directory selector/search/programming duration here; playback’s paused-frame review belongs to Watch TV.

## Ranked findings

### REP-P1-01 · P2 · bug — deletion strands the last pagination page

**Reproduce:** seed 26 synthetic reports, open Next reports (one item), delete it. Page then says **25 permitted reports** and **No reports**. Previous restores the remaining 25. This is actual UI/backend behavior with 24 explicitly seeded clones, not a mocked response. Evidence `narrow-last-page-deleted.png`, `evidence-partial.json`; `web/src/Retained.tsx:265–277,324–353` reloads without correcting offset.

**Recommend/accept:** after deletion or refresh reduces total below offset, fetch the nearest valid page. Deleting the 26th of 26 shows the first 25; No reports appears only when total is zero. Announce the deletion and updated range.

### REP-P1-02 · P2 · bug — Delete report text has 1.23:1 contrast

**Evidence:** computed 14px/700 text `rgb(154,40,38)` on `rgb(7,108,98)`; desktop and narrow screenshots confirm the red-on-teal label. `web/src/styles.css:33–46,67–69` changes danger text without its primary background; `web/src/Retained.tsx:324–335` uses danger without secondary.

**Recommend/accept:** define an accessible shared destructive button treatment and apply it here. Normal/hover/focus labels meet at least 4.5:1 contrast and deletion remains visually secondary to processing a report.

### REP-P1-03 · P2 · bug — report version is inaccurate

**Evidence:** fresh browser API reports and live pre-send dialog show **Version 0.2.0**, while the browser sidebar identifies **v0.2.2**. `src/retained.ts:248` hard-codes the version. This weakens the report’s diagnostic purpose.

**Recommend/accept:** record the real submitting-client version; distinguish server version if useful. A 0.2.2 browser report shows 0.2.2; native versions remain independently accurate. Preserve existing stored snapshots rather than rewriting history.

### REP-P1-04 · P2 · owner request — adopt accessible modal actions

**Evidence:** Delete confirmation is “Permanently delete this problem report?” without target. Submission’s 390×844 dialog needs internal scrolling to reach Send, losing the top Close control (`narrow-submit-modal.png`). `web/src/Retained.tsx:180–259,324–335`; `web/src/ui.tsx:244–338`; `web/src/styles.css:541–567`.

**Recommend/accept:** apply shared sticky header/footer to submission and target-aware confirmation to deletion. Keyboard users can review all fields and always reach Close/Cancel and the primary action; cancellation issues no delete and returns focus to the invoking target. Keep explicit summary review before submission.

### REP-P1-05 · P3 · additional UX — make the inbox scannable and the empty state useful

Two reports already occupy more than a desktop screen; each repeats eight technical rows and a long UUID without a human-readable channel/program label. Nonadmin empty state gives no route to report a problem. `web/src/Retained.tsx:134–166,283–309`.

**Recommend/accept:** compact rows/cards show category, status, sent time and safely authorized channel/program context; expand technical details on demand. Explain that reports start from Watch TV → Report a problem. Preserve redaction when access changes; adding context needs an explicit snapshot/privacy contract, not unrestricted metadata lookup.

## Evidence, limitations and cleanup

Evidence directory `/private/tmp/mytuner-ui-review/reports-p1/`: `desktop-empty`, `desktop-two-reports`, `narrow-two-reports`, `nonadmin-desktop`, `nonadmin-narrow`, `desktop-submit-modal`, `narrow-submit-modal`, `narrow-last-page-deleted` PNGs; ARIA snapshots, `evidence-partial.json`, browser/network events and server log. Narrow document width was 390px. Injected 503 displayed an alert and Try again recovered. API preview/send succeeded; UI modal preview worked, but final UI send hit the deliberate recent-report clones’ ten-minute rate limit (429), so UI send-success/focus-return was not verified.

Shared creation: destructive-button treatment, sticky modal shell, target-aware confirmation. **Page adoption:** apply them to report deletion/submission; pagination and compact report presentation remain local. Keep retention/deletion policy unchanged pending owner decision. All attempts closed through `r.close()`; browser and isolated fixture terminated. No builds, installs, real media, application/test/version edits, commits or pushes.
