# Scenario 02: multiple users and private channels — independent pass A

Date: 2026-11-26. Current local application 0.3.0, `feature/ui-ux-overhaul`.

## Outcome

The exercised account/profile/private-channel rules behaved correctly: unrelated accounts could not discover or fetch another owner's private programming, even when an administrator subscribed a shared room to that private channel. Owners and administrators retained their intended access. Saving an actor-visible subscription list preserved the hidden private membership.

The UI has **two P2 usability/recovery findings and one P3 navigation-label finding**. No P0/P1 access bypass or newly unauthorized playback was established. The most serious human-facing gap is offering a viewer the full channel creation wizard and rejecting the task only at final preview.

## Method and preconditions

- Owned disposable `e2e/server.ts --demo` fixture on loopback port **19303**, with synthetic long episodes and the existing built browser. Installed Chromium/Playwright were reused; no build, installation, download or emulator.
- The fixture preseeded admin designer, editors sam/other, Living Room and Other Profile, a readable synthetic TV source, a commercial source, a shared channel and an unprogrammed private channel owned by other. This pass is not empty-install setup.
- Started with visible UI and accessibility snapshots. Implementation was inspected only after an observed issue, to confirm its cause. No other access-review report was read.
- Used separate browser contexts for the three seeded accounts and a UI-created Viewer account, guest. All grant, PIN, channel, subscription and account mutations were performed through application controls. Read-only GETs were used afterward to verify private filtering and denied access.
- Desktop **1440×1000** and narrow **390×844**. Screenshots were inspected with the image viewer; nothing was opened automatically in VS Code.
- Evidence directory: [/private/tmp/mytuner-scenario-02-a](/private/tmp/mytuner-scenario-02-a). The fixture/helper lifecycle log is in [/private/tmp/mytuner-ui-review/scenario-02-a](/private/tmp/mytuner-ui-review/scenario-02-a).

## Actual walkthrough

| Task                                 | Visible UI action and observed outcome                                                                                                                                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grant shared-room access             | Admin Profiles → Manage Living Room → Allow other to watch; left Manage unchecked. Watch and Manage were presented separately. Other later had no Manage/Subscriptions action for that room, while retaining management of its own profile.                             |
| Set a protected profile              | Admin chose Set PIN, entered matching new/confirmation values and saved once. Sam and other were subsequently required to enter the PIN.                                                                                                                                |
| Incorrect PIN recovery               | Sam entered a wrong PIN. The field cleared and the readable Incorrect PIN error remained. Correct PIN then unlocked the profile.                                                                                                                                        |
| Create owner-private programming     | Sam created/programmed/published Sam Secret through the four-step wizard using the whole synthetic show, retained Private, and added it to Living Room's guide.                                                                                                         |
| Check unrelated account in same room | Other selected/unlocked Living Room. Its channel list and guide omitted Sam Secret while showing the shared channel and its own private channel.                                                                                                                        |
| Check a direct private link          | Other opened Sam's channel resource URL. The page used generic unavailable/access-changed guidance and did not reveal the private name. A read-only private-programming GET returned 404.                                                                               |
| Check administrator exception        | Admin My Network showed Sam Secret. Its room subscription dialog explicitly stated that Admin view includes other accounts' private channels.                                                                                                                           |
| Preserve hidden subscriptions        | Admin also subscribed Living Room to Other private network. Sam's subscription dialog omitted that channel entirely. Sam reordered/saved its visible shared/own-private list; reopening as admin proved the hidden membership remained checked and present.             |
| Create and grant a viewer            | Admin Accounts → Create account created guest with Viewer role and matching password confirmation. Profiles granted guest Watch; the guest Manage checkbox remained disabled.                                                                                           |
| Viewer actual playback               | Guest unlocked Living Room and watched After School. The media element reached readyState 4, paused false and an advancing position. Both other accounts' private channels remained absent from its guide.                                                              |
| Revoke active access                 | While guest played, admin removed guest's Watch grant and saved. Within the observed six-second interval, video paused and guide GET returned 404. The UI's recovery state was misleading (finding S02A-02), but no continuing/new authorized delivery was established. |
| Profile-scoped selection             | Other added one exact video to the library tray in Living Room, then switched to Other Profile. The tray changed from one video to zero, and Sam's private channel remained absent.                                                                                     |

Source/profile grant changes can invalidate an existing unlock. When Sam reopened subscriptions after a profile configuration change, the modal requested the current PIN and recovered successfully after entry. This was not treated as an authorization failure.

## S02A-01 · P2 · A watch-only viewer can complete a management wizard before the UI denies it

**Reproduce:** create a Viewer account, grant Watch access to a room with media, sign in at the application root and unlock its PIN. The default main area is My Network, even though that destination is omitted from the viewer's sidebar. Create channel and Create collection are visible. Create channel accepts name, a whole-show group and all four steps; only Generate preview reports **Profile management not allowed**. The final Create channel action remains disabled.

**Human impact:** the account is described as “Viewer · watch only,” but the interface invites a long management task it cannot complete. Hiding a navigation destination while rendering that same default route makes the scope harder to understand.

**Recommendation:** route viewers to Watch TV or an explicitly read-only network view, and gate creation affordances by both role and current-profile management permission. If a user can request additional access, explain that before starting the wizard. Preserve server-side denial.

Evidence: [viewer default page](/private/tmp/mytuner-scenario-02-a/11-guest-unlocked-network.png), [final preview denial](/private/tmp/mytuner-scenario-02-a/12-guest-denied-after-wizard.png), matching `.yml` snapshots. Source confirmation: [App](../../web/src/App.tsx) omits channels from viewer navigation but renders NetworkPage for channels/library routes without the same role condition; [Network](../../web/src/Network.tsx) renders both creation buttons unconditionally.

This is a role-aware UI problem, **not a successful unauthorized channel creation**.

## S02A-02 · P2 · Revoked profile access leaves stale live controls and a poorly explained retry loop

**Reproduce:** grant a viewer access, start a shared channel and then remove that viewer's profile Watch grant as admin. After the client receives the denied profile state, inspect the player and choose Retry playback.

**Observed:** media delivery correctly stops: the element is paused, and read-only guide fetch returns 404/Profile not found. The Watch surface still presents the previous program/track information, a **LIVE** badge and **Pause** action, plus Retry playback. Retrying repeats Profile not found. At 390px the error text is also obscured behind the playback overlay/progress area, making the retained picture and live controls look more convincing than the error.

**Human impact:** the person sees a frozen picture presented as live and is directed to retry a permission problem. The UI does not clearly explain that they must choose an available profile or ask an administrator for access.

**Recommendation:** distinguish access/profile-unavailable failures from transient media failures. Pause/tear down playback as now, refresh permitted profiles, clear or visibly invalidate prior program/track/guide state, remove the live/pause presentation, and offer an actionable profile/sign-in recovery path. Keep the error visible above controls. Avoid revealing previously unknown profile details in generic denial responses.

Evidence: [revoked access state](/private/tmp/mytuner-scenario-02-a/21-viewer-after-access-revoked.png), [retry result](/private/tmp/mytuner-scenario-02-a/22-retry-revoked-access.png), [paused element plus denied GET](/private/tmp/mytuner-scenario-02-a/access-revoked-state.json). Source confirmation: [Player](../../web/src/Player.tsx) derives status/actions from the retained session while rendering a generic failure/Retry playback branch.

The retained metadata/frame had been authorized earlier. This review does **not** claim that another account gained new access, that private data was newly disclosed, or that the video continued playing after revocation.

## S02A-03 · P3 · Viewer links labelled My Network navigate to Profiles

**Observed:** the viewer's Watch guide and active player both contain a **My Network** link whose destination is `#profiles`. The sidebar itself has no My Network destination for that role. This is observable from rendered link attributes and confirmed by [Player](../../web/src/Player.tsx).

**Recommendation:** label the actual destination Profiles, or deliberately expose a read-only My Network destination and keep the label/route consistent. Coordinate with S02A-01 so both default navigation and secondary links share one role-aware contract.

Evidence: [narrow viewer guide](/private/tmp/mytuner-scenario-02-a/19-viewer-narrow-guide.png) and its `.yml` link target; [narrow playback](/private/tmp/mytuner-scenario-02-a/20-viewer-narrow-playback.png).

## Positive behavior to retain

- Watch/Manage and implicit owner/admin access are clear in the account checklist. Viewer Manage cannot be checked.
- PIN confirmation, visible 4–8 digit guidance, rejected-digit clearing and correct-entry recovery worked.
- The unrelated account never received the private channel in its list or guide; direct programming access was denied and the resource view avoided leaking its name.
- Admin and non-admin subscription dialogs explain their different private-channel scope. The latter shows no placeholder/count for a hidden private membership.
- Saving only visible subscription choices preserved hidden memberships, and profile switching cleared the tray rather than carrying selections across contexts.
- Actual viewer playback worked before revocation, and revocation paused it as intended.

## Limits, automation and cleanup

This was a synthetic local browser pass, not a comprehensive security audit, real household-data test, TV/remote verification or performance benchmark. It did not separately exercise an account switch inside a browser context while retaining a nonempty tray; separate-account contexts and a profile switch were exercised. No new provider/mount setup, device pairing, subtitle selection or large-library scan was accepted here.

An automation navigation fired immediately after an account-save click, before its asynchronous completion, and triggered the documented discard/pending-request guard. The account did save. The confirmation was explicitly resolved and subsequent steps waited for terminal UI state; this timing mistake was not counted as a product defect.

All owned browser contexts and the fixture were closed. Port 19303 and fixture cleanup were verified. Original household media was never accessed or changed. No application code, tests, baselines, dependencies, version or Git history/index were changed; only this review Markdown report was added. The existing formatter and whitespace checks were run for that documentation change.
