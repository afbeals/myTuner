# Scenario 01 — first-time household setup, independent pass A

Date: 2026-11-26. Current local application 0.3.0 on `feature/ui-ux-overhaul`.

## Result

**The complete empty-install setup worked through the visible interface, including playback by a newly created non-admin viewer.** I started with only the bootstrap administrator, added/scanned a custom media source, created a viewer and PIN-protected room profile, granted source/account access, saved a collection, published a shared channel, subscribed the profile and watched as that viewer. No source/profile/channel/subscription mutation was substituted with an API call.

No P0/P1 task blocker was observed. Three P2 findings and one P3 finding concern owner selection, setup handoffs and misleading navigation/status text. The most concrete new defect is that the profile Owner field selected the first asynchronously loaded account rather than its intended signed-in-account default.

This is an independent agent-led expert walkthrough, not a recruited-human study. I did not read the other scenario-01 review.

## Preconditions and boundaries

- Owned fixture on loopback **19301** using `/private/tmp/mytuner-empty-fixture.mts`, current built browser assets and existing installed Chromium/Playwright. No rebuild, dependency install/download, emulator, host application installation or production access.
- Initially there was **one bootstrap admin only**: no household accounts, profiles, sources, collections, channels or subscriptions. The fixture provided unregistered synthetic directories with valid generated media. This models post-bootstrap setup; the initial administrator CLI was not exercised through a browser.
- Selected the synthetic custom directory with two videos under `Nature/River`. Both source addition and its initial normal scan were performed through UI. The fixture's unused TV/movie/commercial directories were not added.
- Desktop **1440×1000** and narrow **390×844** were inspected. Screenshots were viewed directly with the image tool and were never automatically opened in VS Code.
- All actions used rendered controls and accessibility snapshots. Product source was inspected only after the completed journey to confirm observed findings.
- [Fixture manifest](/private/tmp/mytuner-scenario-01-a/preconditions.json), [browser events](/private/tmp/mytuner-scenario-01-a/browser-events.json), [server lifecycle log](/private/tmp/mytuner-scenario-01-a/server.log).

## Visible-UI walkthrough

| Step                     | Actions and observed outcome                                                                                                                                                                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First sign-in            | Signed in as the bootstrap admin. My Network clearly showed Create your first profile and Set up profiles. Sources and Accounts remained usable before any profile existed.                                                                                                                                            |
| Add media                | Sources → Add source; named it Family videos, entered the fixture's custom media path, chose Custom videos and Include subfolders. Check directory reported two supported names and explicitly distinguished that sample from playback inspection.                                                                     |
| Initial scan             | Saved the source, opened Scan and refresh and started the scan. Normal scanner completed with **2 found, 2 updated, 0 missing/errors**. No generation was started.                                                                                                                                                     |
| Create viewer            | Accounts → Create account; created alex with Viewer/watch-only role, matching password/confirmation and successful Save account.                                                                                                                                                                                       |
| Create room              | Profiles → Create profile; named Living Room and selected Shared room. The Owner dropdown had picked alex without an explicit owner selection; this persisted and is examined in S01-A01 below.                                                                                                                        |
| PIN and source grant     | Manage Living Room → Set PIN; entered matching 4-digit PIN/confirmation. Allowed library → Family videos → Choose folders → Entire source → Apply selection. One Save profile persisted the staged changes.                                                                                                            |
| Exact collection         | My Network → Nature/River → Select all on this page → Add 2 videos to tray → Create collection from tray. Saved Family nature picks, receiving named success feedback.                                                                                                                                                 |
| Shared channel           | Create channel → named Family Nature TV and entered a description. Deliberately selected **Shared**, since a private admin-owned channel should not be visible to alex. Added the saved collection through the programming picker; kept ordered playback and no commercials.                                           |
| Preview/create           | Generated preview and used final Create channel. The server created/published it successfully. The empty Coming up instructions still misleadingly advised publication as well as subscription (S01-A03).                                                                                                              |
| Subscribe room           | Profiles → Subscriptions for Living Room → checked Family Nature TV → Save subscriptions. The checklist and selected guide order made the intended subscription explicit.                                                                                                                                              |
| Viewer sign-in           | Signed out and signed in as alex. The browser retained the previous Profiles route and showed Living Room as PIN protected/Locked. Watch TV opened the actual PIN gate.                                                                                                                                                |
| Wrong PIN recovery       | Deliberately submitted an incorrect PIN. The UI showed Incorrect PIN and cleared the input. A correct retry unlocked the profile. **I did not inspect `activeElement`; this pass does not establish focus return after rejection.**                                                                                    |
| Actual viewer playback   | Watch live played the shared channel. Recorded `paused=false`, `readyState=4`, no media error, and playhead advancing from **71.473653 to 71.980708 seconds**. Audio/caption controls and mobile player were visible.                                                                                                  |
| Explicit non-owner grant | Returned as admin, changed the room Owner to No owner and explicitly checked Allow alex to watch Living Room while retaining the source grant/PIN. Saved once, signed out/in as alex, unlocked again and successfully played. Thus the final household outcome did not rely on admin or profile-owner implicit access. |
| Recheck owner default    | As designer, reopened fresh Create profile and waited for account options. Untouched Personal profile Owner again selected alex; switching to Shared room retained alex. Captured selected option/FormData and current authenticated account without saving another profile.                                           |

Proof: [first-login guidance](/private/tmp/mytuner-scenario-01-a/02-first-signin.png), [source check](/private/tmp/mytuner-scenario-01-a/04-source-directory-check.png), [scan complete](/private/tmp/mytuner-scenario-01-a/06-scan-complete.png), [staged profile grant/PIN](/private/tmp/mytuner-scenario-01-a/10-profile-grant-pin-staged.png), [channel creation](/private/tmp/mytuner-scenario-01-a/15-shared-channel-created.png), [PIN rejection](/private/tmp/mytuner-scenario-01-a/19-wrong-pin-feedback.png), [playback observation](/private/tmp/mytuner-scenario-01-a/playback-proof.json), [explicit non-owner access](/private/tmp/mytuner-scenario-01-a/24-explicit-room-access-staged.png), [second successful viewer playback](/private/tmp/mytuner-scenario-01-a/25-explicit-viewer-grant-playback.png).

## Findings

### S01-A01 · P2 · New-profile Owner can default to an unrelated first account

**Reproduce:** sign in as designer after creating viewer alex. Open Create profile, wait for the accounts to load and leave Owner untouched. The dropdown selects **alex · viewer**, including on the untouched Personal type. Changing the type to Shared room retains alex. In the original room creation this actually saved alex as owner, despite no explicit owner selection.

Read-only identity verification recorded signed-in account designer and a different selected owner ID belonging to alex. The field is visible, so this is not an invisible permission bypass; however, ownership grants implicit access and should not be assigned by arrival/order of options. An administrator following defaults can assign a profile to the wrong household member.

After observing this, source inspection found `CreateProfile` supplies an uncontrolled Owner select with `defaultValue={props.account.id}` while its account options arrive asynchronously. The intended current-account default is not reflected by the eventual rendered selection.

**Recommendation:** initialize a controlled owner value after the accounts are available, or require explicit owner selection. Define the room default deliberately, such as No owner, and retain an intentional selection when appropriate. Keep the visible owner/access summary.

Evidence: [untouched Personal owner](/private/tmp/mytuner-scenario-01-a/26-personal-owner-defaults-to-viewer.png), [Shared room retains it](/private/tmp/mytuner-scenario-01-a/27-room-keeps-viewer-owner.png), [authenticated account versus selected owner](/private/tmp/mytuner-scenario-01-a/owner-default-proof.json). Source: [Profiles.tsx](../../web/src/Profiles.tsx), CreateProfile Owner select.

### S01-A02 · P2 · Source completion does not lead a new administrator into household access setup

The source-save state advised only “Source saved. Scan when you are ready.” Scan completion reported its two videos. The source/account/profile/grant/subscription steps all worked once located, but there was no task-oriented handoff from the completed source to choosing which profile can use it. Initial sign-in's first-profile link is helpful but does not provide a full readiness sequence after scanning.

This pass deliberately entered Allowed library and selected Entire source; it does not demonstrate that a new household user would know that step. Administrator browsing/playback cannot serve as proof of another account's permissions. This repeats the earlier review's source-to-profile handoff concern with an otherwise empty household.

**Recommendation:** provide a short post-scan next step such as Choose profiles for this source, and a readiness summary that distinguishes account access, source grant, published channel and subscription. Keep grants explicit; do not silently grant every new source.

Evidence: [source/scan state](/private/tmp/mytuner-scenario-01-a/06-scan-complete.png), [empty profile page](/private/tmp/mytuner-scenario-01-a/08-first-profile-page.png), [explicit grant stage](/private/tmp/mytuner-scenario-01-a/10-profile-grant-pin-staged.png). Source: [Sources.tsx](../../web/src/Sources.tsx), new-source success feedback.

### S01-A03 · P2 · Successfully published first channel still tells the administrator to publish it

Immediately after final Create channel, one status said “Channel created and published: Family Nature TV,” while Coming up said “Publish programming and subscribe this profile to see its guide.” Watch live was correctly disabled until the profile was subscribed. Following the subscription checklist then allowed alex to watch.

**Recommendation:** distinguish unpublished from published-but-unsubscribed states. In this state say “Published. Add this channel to Living Room's guide,” with a targeted action. Do not imply the successful publication must be repeated. This confirms an already-known status problem in the fresh-install journey, not a new failed-publication defect.

Evidence: [conflicting completed/publish instructions](/private/tmp/mytuner-scenario-01-a/15-shared-channel-created.png). Source: [Channels.tsx](../../web/src/Channels.tsx), generic empty Coming up text.

### S01-A04 · P3 · Viewer Watch link says My Network but opens Profiles

After alex unlocked the room, the Watch guide and player offered **My Network**. Clicking it navigated to `#profiles`, showing a read-only profile card rather than the My Network hub. The role-specific destination may be intentional, but the label does not describe it. On mobile this destination provides no direct Watch/unlock action on the card; the viewer has to use the Menu → Watch TV path to resume.

**Recommendation:** use Profiles/Choose profile for the viewer destination, or offer a direct return to the guide. Keep manager-only channel/catalog editing hidden as intended.

Evidence: [viewer guide and link target](/private/tmp/mytuner-scenario-01-a/20-viewer-unlocked-guide.yml), [clicked destination](/private/tmp/mytuner-scenario-01-a/23-viewer-network-link-destination.png), [mobile Watch](/private/tmp/mytuner-scenario-01-a/22-viewer-playing-mobile-viewport.png). Source: [Player.tsx](../../web/src/Player.tsx) renders the same label with `#profiles` for viewers and `#channels` for managers.

## Positive behavior to preserve

- The genuine empty state gives a clear first-profile destination while retaining access to Sources/Accounts; a missing profile is not a dead end.
- Source-directory checks and normal scans report understandable, bounded outcomes without raw JSON or automatic asset generation.
- Account password confirmation and profile PIN confirmation fit the creation tasks. Incorrect PIN reporting and cleared digits supported a successful retry; focus recovery was not measured.
- Profile grants are visibly staged and saved once. Explicit non-owner Watch access, the source grant and shared-channel subscription together produced working viewer playback.
- Exact collection selection, preview-before-create and explicit subscriptions worked without hidden API setup.
- Shared versus Private was described on the channel form. The review selected Shared deliberately rather than counting intentional private-channel invisibility as a bug.
- The mobile player showed the synthetic picture, track controls, live context and accessible playback actions.

## Limits and cleanup

This pass does not establish physical-TV/remote, pairing, Docker mounts, Unraid HDD, live Sonarr/Radarr, alternate subtitle tracks, a large library, screen-reader certification or long-duration playback. The initial bootstrap admin and synthetic directories are fixture preconditions. Local directory paths are not Unraid path examples.

A controller setup attempt initially had closed stdin and was restarted before any UI journey. A later overlong PTY command was discarded/reissued as shorter commands before executing it. These were harness issues, not product failures; only the actual visible outcomes above are claimed.

The browser captured only the expected signed-out identity 401 and deliberately incorrect PIN 403; no page exception or playback error occurred. The owned browser/fixture closed normally, the server logged CLOSED, its temporary media/database root was verified removed and port **19301** had no remaining listener. Only this report was added to the repository; product code, tests, baselines, dependencies and versions were unchanged. Existing local formatter and whitespace/link checks were used for this documentation-only addition.
