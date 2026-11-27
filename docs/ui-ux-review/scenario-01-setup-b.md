# Scenario 01: empty household setup — independent pass B

Date: 2026-11-26. Current local application 0.3.0, branch `feature/ui-ux-overhaul`. Review only; no application, test, snapshot, dependency or version change.

**The complete empty-household setup succeeded through visible UI, including playback by a newly created non-admin viewer after PIN entry.** Two P2 correctness/recovery issues and one P3 navigation inconsistency were confirmed. No P0/P1 task blocker was observed. This was an independent agent walkthrough, not a recruited-human usability study; the other setup review was not read.

## Preconditions and method

- Owned fixture/server on `127.0.0.1:19302`; browser controller on `127.0.0.1:19322`. Installed Chromium/Playwright/Node/FFmpeg and existing `web-dist` only.
- The initial database contained only the bootstrap administrator. **No sources, household accounts, profiles, channels, collections or subscriptions existed.** The [fixture manifest](/private/tmp/mytuner-scenario-01-b/preconditions.json) records the unregistered synthetic directories.
- The source used for this journey contained two generated H.264/AAC clips under `custom/Nature/River`. No household media or provider was accessed.
- All application mutations used rendered controls. No API or SQL mutation replaced a setup step. Read-only API checks were used only after the completed journey to verify the inconsistent channel label.
- Desktop 1440×1000 and narrow 390×844 screenshots were inspected directly with the image viewer; no OS/VS Code automatic opening. Implementation was read only after observing/completing the UI journey.
- The first administrator was precreated as the documented bootstrap prerequisite; administrator bootstrap and Unraid installation themselves were not performed through the UI.

## Actual journey

| Step                            | Observed result                                                                                                                                                                                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign in to empty installation   | My Network showed Create your first profile with a short explanation and Set up profiles link. Sources and Accounts remained reachable before any profile existed.                                                               |
| Add source                      | Sources → Add source; named Family videos, entered the manifest's synthetic directory, selected Custom videos, kept Include subfolders. Check directory succeeded with honest limited-inspection feedback. Add succeeded.        |
| Configure and scan              | Reviewed subtitle/metadata/manual-scan defaults and saved configuration. Scan and refresh → Start scan completed with 2 found, 2 updated, zero missing/errors. No asset generation started.                                      |
| Create household login          | Accounts → Create account; created jordan with default Viewer role. A deliberately mismatched password confirmation was rejected locally; correcting it retained the other form values and saved successfully.                   |
| Create first profile            | Profiles → Create profile; named Family Room and chose Shared room. The first profile became the current context.                                                                                                                |
| Grant viewer and library access | Manage Family Room showed separate Account access and Allowed library sections. Checked jordan Watch; Manage correctly remained unavailable to a viewer. Chose Family videos → Choose folders → Entire source → Apply selection. |
| Set PIN and save                | Set PIN with matching 4-digit values. One Save profile committed identity/access/library/PIN; the card then reported PIN protected, one assigned account and one library grant.                                                  |
| Create exact collection         | My Network → Nature/River → Select all on this page → Add 2 videos to tray → Create collection from tray. Saved Family nature picks with named success/open feedback.                                                            |
| Create shared channel           | Create channel → Family Nature TV, supplied short name FN, description and **Shared** visibility. Programming selected Family nature picks in episode order; commercials were left disabled.                                     |
| Preview and publish             | Generate preview showed the two intended videos; final Create channel succeeded with the created/published confirmation.                                                                                                         |
| Subscribe profile               | Profiles → Subscriptions for Family Room → selected Family Nature TV → Save subscriptions. The supplied short name was displayed inconsistently here (S01B-01).                                                                  |
| Sign in as household viewer     | Signed out, signed in as newly created jordan. Watch TV required Unlock Family Room. Incorrect PIN was rejected and cleared digits; focus recovery failed (S01B-02). Correct PIN unlocked the guide.                             |
| Watch actual media              | Watch live played the shared channel: video `readyState=4`, `paused=false`, advancing `currentTime`, and no media error. Narrow rendering retained the expected playback/audio/caption controls.                                 |
| Confirm viewer navigation       | My Network in the Watch header led to the read-only Profiles page instead (S01B-03). The normal viewer sidebar correctly omitted management routes.                                                                              |

Evidence: [empty workspace](/private/tmp/mytuner-scenario-01-b/02-empty-admin-workspace.png), [source check](/private/tmp/mytuner-scenario-01-b/05-source-check.png), [scan complete](/private/tmp/mytuner-scenario-01-b/09-scan-complete.png), [staged profile permissions/PIN](/private/tmp/mytuner-scenario-01-b/18-staged-profile-settings.png), [created shared channel](/private/tmp/mytuner-scenario-01-b/27-shared-channel-created.png), [viewer guide](/private/tmp/mytuner-scenario-01-b/33-viewer-guide.yml), [actual viewer playback](/private/tmp/mytuner-scenario-01-b/34-household-viewer-playing.png), [narrow playback](/private/tmp/mytuner-scenario-01-b/35-viewer-playing-narrow.png).

## Findings

### S01B-01 · P2 · Subscription configuration replaces a supplied channel short name with derived initials

**Reproduce:** create Family Nature TV with explicit short name FN → Profiles → Subscriptions for Family Room. Both the available-channel row and its checkbox say **FNT · Shared**. The Watch guide/player correctly say **FN**.

Read-only post-journey verification confirmed the same saved channel ID has `shortName: "FN", shortNameOverride: "FN"` in the admin channel response, while subscription configuration returns `shortName: "FNT", shortNameOverride: null`. The actual channel override is preserved; this is inconsistent projection/presentation rather than a failed channel save or identity collision.

**Human impact:** the user is shown a different label while selecting the channel for a profile, undermining confidence that their provided label saved and making channel identification inconsistent across setup and viewing.

**Recommendation:** preserve the explicit override through the subscription DTO/public serialization and use the same resolved label as other channel surfaces. Validate the displayed label as well as the underlying channel ID when saving/reopening subscriptions.

Source confirmation after observation: [subscription-configuration.ts](../../src/subscription-configuration.ts) selects `c.short_name`, then maps it to `shortName` without `shortNameOverride`; [public-json.ts](../../src/public-json.ts) recognizes channel-like objects and recomputes from `short_name` or `shortNameOverride`, ignoring a supplied `shortName` as an override. The snapshot filter can therefore search the saved override while its public response displays derived initials.

Evidence: [subscription screenshot](/private/tmp/mytuner-scenario-01-b/39-custom-short-name-mismatch.png), [before subscription snapshot](/private/tmp/mytuner-scenario-01-b/28-first-subscriptions.yml), [correct viewer label](/private/tmp/mytuner-scenario-01-b/33-viewer-guide.yml), [read-only response comparison](/private/tmp/mytuner-scenario-01-b/verification.json).

### S01B-02 · P2 · Incorrect-PIN recovery clears digits but loses input focus

**Reproduce:** sign in as jordan → Watch TV → enter an incorrect 4-digit PIN → Unlock profile. Incorrect PIN appears and the field clears, but typing does not immediately replace the PIN because focus is on BODY. Repeated after signing out/in; focus remained BODY after 600ms.

**Human impact:** keyboard users must find and focus the field again before retrying. The visible instructions suggest correcting the PIN, so the failed focus recovery adds avoidable navigation at a primary viewing gate. Correct PIN submission still unlocks successfully; this is not a lockout or access bypass.

**Recommendation:** restore focus only after the pending/disabled state has finished, while keeping the error announced and digits cleared. Verify the real DOM active element after a rejected asynchronous response, rather than only asserting the field's value.

Source confirmation: [App.tsx](../../web/src/App.tsx) calls `input.focus()` inside the API failure handler. At that time, [ui.tsx](../../web/src/ui.tsx) still has the surrounding Form fieldset disabled until its `finally` clears busy, so the focus attempt cannot take effect.

Evidence: [error state](/private/tmp/mytuner-scenario-01-b/38-pin-error-focus.png), [first failure snapshot](/private/tmp/mytuner-scenario-01-b/32-wrong-pin-recovery.yml), [two focus observations](/private/tmp/mytuner-scenario-01-b/verification.json).

### S01B-03 · P3 · A viewer's My Network link actually opens Profiles

**Reproduce:** as the household Viewer, open the Watch guide or player and activate My Network. The URL becomes `#profiles`, and the page heading is Profiles. This page is read-only for the viewer; it is not the channel/library network surface named by the link.

**Human impact:** a household user cannot predict the destination from the label. The normal sidebar correctly calls the same destination Profiles, making the inconsistency more apparent.

**Recommendation:** give the viewer the actual destination name, or choose an appropriate viewing destination/action. Preserve role filtering; do not expose management just to satisfy the existing label.

Source confirmation: [Player.tsx](../../web/src/Player.tsx) sends viewers to `#profiles` while retaining the literal My Network label in both guide/player headers.

Evidence: [viewer destination](/private/tmp/mytuner-scenario-01-b/36-viewer-my-network-destination.png), [viewer menu](/private/tmp/mytuner-scenario-01-b/37-viewer-menu.png), [URL/heading observation](/private/tmp/mytuner-scenario-01-b/verification.json).

## Additional observations and strengths

- The no-profile empty state provides a clear initial direction instead of failing or showing a misleading empty library. Management routes needed for setup remain usable.
- Viewer is a sensible default account role, password confirmation is enforced, and the account/profile/source-grant concepts are visibly separated. One profile Save retained all staged changes across nested folder selection.
- Shared versus Private visibility is explicit. Using Shared plus the intended profile grant/subscription allowed the real non-admin viewer to watch; successful admin playback alone was not used as proof of household readiness.
- Source check and scan feedback were understandable without reading raw JSON. Custom scanning did still offer a checked Sonarr/Radarr-refresh option despite no connection; this repeats the earlier review's relevance issue.
- Named collection-save feedback was clear. One automation wait initially assumed the shorter link name Open saved collection, but the actual accessible name includes the collection title; the success was verified and the locator corrected. This was not a product failure.
- Newly published channel guidance again said Publish programming and subscribe this profile even though the created/published success was visible. This independently reconfirms the earlier state-specific guidance finding; it is not a new publication failure.
- Creating a profile, granting access, programming and subscribing remain separate tasks on separate pages. The workflow can be completed, but a first-time user still has to infer the cross-page sequence. A short readiness/next-step sequence would help while keeping grants deliberate.

## Limits and cleanup

This pass covered the empty **application** after administrator bootstrap, not Docker/Unraid installation or TV pairing. It used two synthetic custom videos and a shared-room profile, with one created viewer. No live provider, external subtitle, large catalog, private-channel cross-account audit, physical TV/remote, codec variety, HDD/resource benchmark or soak acceptance is claimed. Those are separate authorized scenarios or external acceptance gates.

All owned browser/server/controller processes were closed; fixture media/database were removed. Screenshots and read-only observations remain under `/private/tmp/mytuner-scenario-01-b`. No application/test/baseline changes, host installation/download, emulator run, commit, push or deployment occurred. Only this review Markdown document was added to the repository. Local document formatting/link checks and whitespace checks were performed; no full regression suite rerun is implied.
