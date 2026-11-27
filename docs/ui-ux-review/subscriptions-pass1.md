# Subscriptions — owner review, pass 1

Route: `/#subscriptions`; nested entry inspected: `/#profiles` → Manage Living Room. Base: `a67d418cf7258e669b11fcc9cae63cdc1bcda92d`. Live synthetic fixture: `127.0.0.1:19007`; admin designer and editor sam; desktop 1440×1000, narrow 390×844. No application changes.

Evidence: `/private/tmp/mytuner-ui-review/subscriptions-p1/`: visually inspected `desktop-initial.png`, `narrow-two-subscribed.png`, `profile-manage-no-subscriptions.png` (captured during modal loading); saved ARIA companions, `findings.json`, `editor-private-hidden.png`, `browser-events.json`, `server.log`. The final events file contains only expected pre-login `/api/auth/me` 401; no CSP violations. An earlier investigative request to nonexistent GET `/api/channels` returned 404; it was not a product interaction.

## Current behavior and owner coverage

**SUB-01 — proposed feature/change in navigation.** Profiles have Manage only; subscriptions are a separate page controlled by the global Current profile selector. Each Subscribe saves immediately. Unsubscribe uses browser confirmation, then removes membership and invalidates that profile/channel’s playback sessions. Guide order is a second list with accessible, channel-named Move up/down actions; disabled first/last boundaries work and changes survive reload. Switching to Other Profile updates candidates and shows an empty order. The available-channel list remains alphabetical rather than following guide order: these are different concepts.

Admin can see another account’s private channel by design. After admin subscribed Living Room to Other private network, sam still saw only After School in candidates and order. Do not interpret an admin subscription as granting other accounts private-channel visibility. Permissions are enforced by account plus profile/source grants; management requires admin or an authorized editor. A profile-card modal must use the card’s profile ID, not whichever global profile happens to be selected.

Applicable globals: **GLO-01** use shared sticky-header/footer modal for the proposal; **GLO-03** retain access to lineup editing from Watch TV and resolve whether the separate sidebar entry remains; retain page-specific capitalization tasks for Generated assets, Devices & sessions, Problem reports, Setup & server health. **GLO-04/05** current copy is concise, but the blanket private-channel assurance is inaccurate for admin; keep consequences visible and move only optional ordering detail into accessible information. **GLO-06** narrow wrapping needs correction. **GLO-08** replace the reproduced subscription-removal browser confirm. **GLO-10** not reproduced on these flows. GLO-02/07/09/11 have no filesystem, player, search or programming-duration surface here.

## Ranked findings and acceptance

### SUB-P1-01 · P2 · owner request · Profile-scoped subscriptions modal

Repro: Profiles → Living Room offers only Manage; managing subscriptions requires leaving Profiles and setting the global profile. Apply a shared modal beside Manage: title “Subscriptions for Living Room”, bounded channel checklist, visible selected count, private/shared labels, ordered selected lineup, Cancel and Save footer. Preserve Move up/down rather than relying on drag. Keep a clear Open guide action and a discoverable entry from Watch TV.

Acceptance: opening another profile’s modal edits that profile only; Cancel writes nothing; order survives save/reload and agrees with guide/previous-next tuning; hidden channel names/counts stay absent for ordinary accounts; revoked/unavailable items get safe recovery. Read-only accounts do not receive enabled management controls. No whole-library/media loading is needed.

### SUB-P1-02 · P2 · bug · Keyboard reorder loses focus

Repro: with two subscriptions, focus “Move After School up” and press Enter. The order changes, then `document.activeElement` is BODY (`findings.json`). Reloading remote lists removes the focused row. Preserve focus on the moved channel’s remaining enabled ordering control and announce its new position.

Acceptance: consecutive keyboard moves need no traversal from page start; first/last positions have predictable focus; failure retains order and offers retry without losing the user’s place.

### SUB-P1-03 · P2 · bug/owner request · Confirmation and narrow actions

Repro: Unsubscribe opens native `confirm`: “Remove After School from this profile’s guide? Current playback will stop.” At 390px both cards break “Unsubscribe” into “Unsubscri / be”; ordering labels consume large stacked buttons. Use app-owned confirmation naming channel/profile and playback consequence; use wrapping rows with full-width narrow actions and concise visible Up/Down labels plus channel-specific accessible names.

Acceptance: cancel preserves membership/session; confirm removes exactly the selected subscription, never the channel; dialog traps/restores focus; 390px has readable whole-word labels and no horizontal overflow (current document width is already 390px).

### SUB-P1-04 · P3 · owner request · Clarify admin visibility

Repro: admin sees “Other users’ private channels stay hidden” above Other private network. Explain the admin exception briefly and keep private visibility distinct from profile membership. Acceptance: no copy promises that subscribing makes private content available to other accounts.

## Shared work, adoption and decisions

Global creates modal/confirmation, bounded checklist, focus-preserving async list feedback and responsive action-row primitives. Subscriptions adopts each in its profile modal and order controls; Profiles adds the card action; Watch TV updates Edit profile lineup to open the correct target.

Decide before implementation: retain or redirect the existing route/sidebar link; one atomic membership+order Save versus multiple operations with explicit partial-failure recovery; conflict handling when another manager edits; confirmation timing for removals that stop playback. Current APIs save one membership at a time and order separately, so a checklist must not imply atomic saving without a new contract. Preserve retained private memberships invisible to the acting account when saving; never replace the full server membership with only the visible checklist. Unsubscribe currently invalidates every session for that profile/channel, not just this browser.

Code: `web/src/Management.tsx:200,855`; `web/src/ui.tsx:72,177,242`; `src/server.ts:1471–1529`; `src/foundation-routes.ts:520,622`; `src/security.ts:224,355`; `web/src/styles.css:1179`.

Cleanup: final bounded script reached `finally`, closed browser and isolated fixture, and printed `CLOSED subscriptions browser and fixture`. Earlier input-driver instances and their exact browser/server process trees were explicitly terminated before restarting; no shared demo was touched. No build, install, media access, test, version or product edits.
