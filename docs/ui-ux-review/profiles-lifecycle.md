# Profiles — save, deletion and permission contracts

Investigation only, base `a67d418`. Root code-focused consolidation supporting the independent live profile passes. It does not count as another live pass. [Pass 1](profiles-pass1.md) records actual Watch→Manage stale-diagnostic reproduction and profile/PIN/grant interactions.

## One Save and account checklist

Current APIs separately commit profile name/owner PATCH, account grants, source grants and PIN changes (`src/server.ts:348–478`, `src/identity-routes.ts`). A single footer must own a complete staged draft; otherwise Save can persist only some sections while Cancel wrongly appears to undo them.

Recommended for alignment: validate the full draft and any PIN hash outside a short atomic transaction; reauthorize and check revisions immediately before commit. Return section/field errors, retain draft and refresh effective access after success. Explicit Remove PIN is different from untouched blank input. A changed PIN invalidates profile unlocks (`src/identity.ts:132`). An editor’s current PIN-management authority must not expand into admin-only owner/account/source editing.

Account checkboxes represent access to the profile. They do not change account role, private-channel ownership or underlying source ownership. Show effective implicit owner/admin rights separately from removable explicit grants. Watch and Manage are distinct; viewers cannot gain management through a checkbox. Source selections represent positive subtree grants: selecting a parent includes descendants; unchecking one child is not an exclusion unless a new policy is intentionally designed.

The read-only Inspect account control is an administrator diagnostic. Moving its useful summary to cards must not enumerate accounts or inaccessible source/private-channel details for ordinary users. Invalidate diagnostics when grants, owner, PIN or account enabled/role state changes; show a dated/loading state instead of stale permissions represented as current.

## Profile deletion and update scope

There is currently no profile DELETE route, and PATCH updates name/owner only; type is immutable today. Full CRUD requires an explicit deletion contract, not merely a frontend button.

Database dependencies include account access, source grants, subscriptions, unlocks, playback sessions, schedule revisions and problem reports (`src/database.ts:20,28,47,83,93,103,133`). Some are deliberately non-cascading. Channels and collections are account-owned and must not be treated as media/profile-owned data to remove automatically. Future renewal can depend on the publishing profile’s grants.

Recommended conservative first behavior: show dependencies and block deletion while active/retained schedule or playback references need the profile; allow explicit migration/reassignment only through a defined follow-up. Harmless profile-owned settings can be removed transactionally after dependency checks. Do not automatically delete channels, history, accounts or source media. If a different purge/retention policy is wanted, review it explicitly first.

After an allowed deletion, clear selected profile/unlocks and stop or safely reject its active clients; reload available profiles with an explanatory state, including an honest no-profile result. Profile deletion must not revoke all account devices by implication. Person↔room conversion is optional scope beyond existing name/owner edits and needs owner/null-owner rules if included.

## Subscriptions modal and bounded lists

A card action must bind to that profile’s ID rather than the global selector. Save visible membership/order without replacing memberships the actor cannot see; preserve private-channel invisibility. Unsubscribe currently stops profile/channel sessions, so stage removal and show consequences before commit. Keep explicit accessible ordering and current-profile guide navigation.

Apply global scrolling-body modal/footer, target-aware confirmation, bounded account/source lists, lazy catalog tree and asynchronous focus/status patterns. Retain local access copy/card hierarchy and stale-diagnostic fix tasks. Acceptance includes failed/conflicted save preserving every draft, cancellation issuing no mutation, keyboard list selection, narrow overflow, retained hidden memberships and revoked/deleted-profile client recovery. Deletion policy, type conversion and atomic-versus-partial Save remain alignment choices; no behavior was changed.
