# Accounts — owner-request review, pass 1

Route: `/#accounts`, including Create account and Manage account. Base: `a67d418cf7258e669b11fcc9cae63cdc1bcda92d`; reviewed 2026-11-26. Investigation only; no application changes or builds.

## Runtime and evidence

Used `startReview({page:'accounts',pass:'p1',port:19006})`, synthetic administrator `designer`, and a newly created **other** account `uxreview`. Exercised create, duplicate creation, role changes, disable/re-enable, password reset, discard, and revoke cancellation/confirmation. Never revoked or edited the administrator account.

Viewed screenshots at desktop **1440×1000**, narrow **390×844**, and short narrow **390×640**. Evidence directory: `/private/tmp/mytuner-ui-review/accounts-p1/`:

- `01-desktop-accounts.png`, `02-desktop-create.png`, `03-desktop-manage.png` and corresponding ARIA snapshots.
- `04-narrow-manage.png`, `05-narrow-accounts.png`, `06-narrow-password-error.png`, `07-narrow-duplicate-error.png`.
- `09-narrow-table-left.png`, `12-narrow-viewport-top.png`, `13-narrow-viewport-bottom.png`.
- `session-evidence.json`, `dialog-evidence.json`, `layout-evidence.json`, `observed-behavior.json`, `browser-events.json`.

## Ranked findings and acceptance

### ACC-P1-01 · P2 · Bug — one save silently discards the other form

Enter a different Role and New password together. **Save account** sends only PATCH role/disabled, closes Manage, and loses the password draft without confirmation. Reopen, change Role and enter a password; **Reset password** sends only PUT password, closes Manage, and loses the role change. Both directions reproduced; role persisted as editor after a pending viewer change was discarded. Source: `web/src/Management.tsx:125–168`; shared Form at `web/src/ui.tsx:114`.

Recommend retaining Manage and the sibling draft after a section save until the owner chooses the cross-field contract. Acceptance: saving either section cannot silently lose edits in another; failures retain drafts. Do not silently make two endpoints a single apparently atomic Save.

### ACC-P1-02 · P2 · Owner request — ACC-01 password confirmation missing

Manage offers one New password input and successfully changes the password without matching confirmation. Create also has one password input. This is a confirmed missing requested safeguard, not failed existing confirmation. A five-character reset is correctly blocked by native minimum-length validation.

Apply a matching Confirm new password field to reset, compare before any request, show a field-associated mismatch error, and retain the visible sign-out consequence. Acceptance: mismatch sends no mutation and revokes no sessions; matching valid input succeeds; keyboard/paste/password-manager use works. Decide separately whether confirmation also applies to initial creation.

### ACC-P1-03 · P2 · Bug — Save has undisclosed session consequences

After signing the synthetic account in separately, saving its **unchanged** account settings changed its `/api/auth/me` response from 200 to 401; the administrator remained 200. Save contains no sign-out explanation. Password reset does explain sign-out. Source: `src/identity.ts:62–105`: account updates revoke sessions **and approved device pairings**, including no-op updates; password reset uses the same revocation.

Recommend disabling unchanged Save and exposing the consequences of real role/disabled changes before submission. Acceptance: unchanged Save cannot unexpectedly revoke access; consequential updates clearly explain sign-out/re-pairing. Whether actual role updates retain unconditional revocation is a security/product decision; preserve permission invalidation.

### ACC-P1-04 · P2 · Owner request — ACC-02 and GLO-06/GLO-08 action grouping

Desktop has two equally prominent submit buttons inside separate cards, then disconnected red-outline **Revoke all sessions**. Narrow stacks the same structure. Revoke uses native `window.confirm`. Cancel sends no DELETE and leaves the other session valid; confirm sends DELETE and invalidates it, but provides no success announcement (`08-desktop-revoke-completed.png`; `session-evidence.json`). Source: `Management.tsx:170–180`.

Apply a secondary Revoke sessions action beside the settings Save, using an application confirmation naming the account and explaining sign-out/device re-pairing. Revoke remains an immediate independent action and must retain unsaved drafts. Announce completion/failure. Acceptance: Cancel changes nothing; confirm affects only the named account; Revoke never submits role/password drafts; controls wrap or stack clearly at 390px.

### ACC-P1-05 · P2 · Owner request — GLO-01/GLO-08 shared modal adoption

At 390×640, Manage has 574px client height and 652px scroll height. At bottom, Close lies above the dialog (top −25px versus dialog top 32px); Revoke starts below the initial viewport. Header/footer are not sticky. Source: `web/src/styles.css:541`; `web/src/ui.tsx:242`. Dirty Close/Escape already asks before discarding and Cancel preserves input, but uses a browser confirm.

Apply a shared scrolling-body modal with persistent header/Close and action footer; use the shared in-app discard confirmation. Acceptance: account name, Close and relevant actions remain reachable at short heights, keyboard focus stays trapped/restores, and native browser-owned tab-close protection remains intact.

### ACC-P1-06 · P3 · Owner-request refinement — GLO-06 mobile identity/action separation

The narrow table is 648px wide inside 348px: account names and Manage actions cannot be seen together. Clicking Manage automatically scrolls the table right; no whole-page horizontal overflow occurred. Source: `web/src/styles.css:1197`.

Apply compact account rows/cards or retain identity beside the action. Acceptance: at 390px users identify and manage the same account without horizontal scrolling; retain account-specific accessible button names.

## Dispositions, shared work and decisions

ACC-01/02: confirmed requests, recommendations above. GLO-01/06/08: changes needed. GLO-03: Accounts navigation is already capitalized; overall ordering belongs to Global. GLO-04/05: existing copy is brief; keep essential access consequences visible rather than hiding them in help. GLO-10: no CSP violation observed; console errors were expected initial 401, injected 503, and duplicate-name 409. Other globals concern absent picker/search/player/programming surfaces.

Global candidates: sticky Modal/action footer, accessible Confirm/discard dialog, password-confirmation field pattern, and mutation status feedback. Accounts adoption tasks: apply them to Create/Manage, password reset, Revoke and draft exit; retain page-specific mobile table work.

Real duplicate-name error and injected password-service 503 both retained input and exposed alerts. Viewer→editor, disable and re-enable→viewer persisted correctly. Last-enabled-administrator protection exists in `identity.ts:85`; self-admin removal was not exercised. Resolve combined versus separate save semantics, no-op/revocation policy, and create-password confirmation before implementation. No media/HDD work is needed.

Cleanup: browser and isolated fixture closed through `r.close()` in `finally`; runner printed `CLEANED` and exited 0 after stdin EOF; a subsequent bind confirmed port 19006 was released. Only this report was written in the repository.
