# Connect TV — pass 1

Route: `#connect-tv[?code=…]`. Base commit: `a67d418cf7258e669b11fcc9cae63cdc1bcda92d`. Investigation only; no application changes.

## Runtime and coverage

Separate synthetic fixture, port **19010**, `designer`, Living Room; desktop **1440×1000**, narrow **390×844**. Visually inspected default, long-device review, success/error, lost-response and narrow LAN screenshots. Exercised manual/grouped/lowercase codes, blank/invalid/unavailable input, review/edit/cancel/approval, actual device polling, public-link prefill before/after authentication, same-page link changes, help navigation, pending/offline/expired states and keyboard focus. Review is inline, not a modal. No native/emulator/device run.

Evidence: `/private/tmp/mytuner-ui-review/pairing-p1/`: screenshots with matching ARIA `.yml`, `observations.json`, `browser-events.json`, `server.log`. Key captures: `desktop-stale-approval-link.png`, `desktop-success-and-error.png`, `narrow-review.png`, `desktop-lost-approval-response-injected.png`, `narrow-lan-review.png`. Delays, expired API responses/timestamps and transport failures were **injected**; lost-response reproduction performed a genuine successful approval before aborting its browser response. Long names fit 390px without horizontal scrolling.

Real review/approval/poll succeeded on both localhost and ordinary insecure `http://mytuner-review.test:19010` (`isSecureContext=false`), with CSP intact. Blank input gets native validation. Lowercase/hyphenated codes normalize. Pending disables input/actions. Cancel closes local review and leaves the device request pending. Authentication preserves valid link prefill; opening a link never approves automatically. Approval follows the account, with profile selection afterward; the browser’s Current profile does not restrict pairing to that one profile.

## Owner disposition

- **GLO-01/08:** Shared application confirmation needed if leaving typed-code input still warrants a warning (PAIR1-05). Current approval itself already requires explicit review. Browser tab-close prompts remain browser-owned.
- **GLO-03:** Connect TV navigation is already capitalized; page heading is sentence case. Changed preference: apply the agreed title convention locally and retain Connect TV in shared navigation ordering work.
- **GLO-04:** Invalid input says only “Invalid request”; unavailable/expired/wrong-server recovery lacks next steps (PAIR1-02).
- **GLO-05:** Current recognition/account-permission warnings are short and essential; keep visible. Optional installation detail already lives behind help.
- **GLO-06:** Changed preference: place secondary Cancel and primary Approve in one wrapping action row inside the review; currently Cancel sits inside the notice and Approve below it.
- **GLO-10:** **Not reproduced**: no CSP violations or page exceptions. Network errors correspond to startup authentication, exercised validation, helper-induced CSRF refresh/retry and explicitly injected failures.
- **GLO-02/07/09/11:** No directory selector, playback, search or programming-duration control here. No page-specific owner IDs.

## Ranked findings

### PAIR1-01 — P2 · bug · New approval link retains the previous TV

Review Kitchen TV from link A; change only the hash to pending Bedroom TV link B. URL contains B while the input, reviewed identity and Approve action still target A. Confirmed with two genuine requests. `Management.tsx:974–1018` uses an uncontrolled default value; `App.tsx:100–112,427` keys by page/profile, not pairing code.

**Change/check:** Treat valid public-code changes as new intent: clear review/success/error, update input, require fresh explicit review. Link A→B must never approve A under B’s URL. Preserve authentication and code validation.

### PAIR1-02 — P2 · bug/additional UX · Approval state and recovery can contradict reality

After successful approval, unchanged code remains actionable; Review yields “Pairing code is unavailable” beside “TV approved”. More seriously, aborting the response **after server 204** left an error; device poll returned approved, but Retry produced unavailable and retained the old review. Injected expired responses likewise leave Approve enabled; an injected past expiry never changes the button. Invalid non-hex input gives generic “Invalid request”. `Management.tsx:990–1049`, `identity.ts:222–244`.

**Change/check:** Make success terminal until “Connect another TV”; show honest uncertain-outcome guidance after transport failure and reconcile safely or explicitly direct users to check TV/request a new code. Expired/unavailable states need same-server/fresh-code recovery; invalid input needs a ten-character format hint. Verify successful, lost-response, already-used, expired and wrong-server journeys without weakening single-use approval or leaking code existence.

### PAIR1-03 — P2 · bug · TV address instruction recommends loopback

When browser uses loopback, the prominent “On your TV, enter” value is `http://127.0.0.1:19010`; that resolves to the TV itself. Smaller localhost caveat conflicts with the instruction (`Management.tsx:1053–1059`).

**Change/check:** Detect loopback, explicitly say this address cannot connect another device, and guide to an operator-confirmed LAN/published address. LAN-origin visits continue showing their usable current origin. No host/network scanning or Docker access.

### PAIR1-04 — P3 · bug · Review loses keyboard focus

Pressing Enter in the code input leaves `document.activeElement=BODY` after pending completes; the review region has no announcement/focus transfer. Next Tab reaches Cancel, then Approve. `ui.tsx:126–170` disables the fieldset; `Management.tsx:1025` inserts the review.

**Change/check:** Focus the review heading/region and announce its arrival; ensure keyboard/screen-reader users encounter the identity before approval and regain sensible focus after cancel/failure. No keyboard trap was observed.

### PAIR1-05 — P3 · owner request · Browser confirmation guards public-code entry

Type a code, choose installation help: native `confirm` says “Discard unsaved form changes? A request already received by the server may still finish.” Dismiss retains code; accept reaches help (`navigation.ts:9`, `ui.tsx:134`).

**Change/check:** Decide whether unsent public-code entry needs guarding. Remove unnecessary guard or adopt shared application confirmation with accurate consequences. Do not replace browser tab-close confirmation.

## Shared adoption, decisions and cleanup

Global creation candidates: application navigation confirmation, async focus restoration, wrapping action row and actionable error-state patterns. **Apply here:** navigation guard decision; focus review/error recovery; group Cancel/Approve; adopt human validation and lifecycle states; apply agreed heading capitalization. Preserve Silver Signal styling and explicit authenticated approval.

Decisions: whether to guard unsent codes; trusted advertised-address source; safe reconciliation versus check-TV/new-code recovery. Cancel currently means local review cancellation, not remote request revocation; avoid implying otherwise. No retention/deletion changes proposed.

Cleanup: all contexts/Chromium closed; helper awaited isolated-server termination. SIGTERM cleanup removes synthetic root (`e2e/server.ts:285–293`); final process exited 0. An earlier helper attempt timed out because Sign out is hidden in narrow navigation, then cleaned up; rerun logged in wide before narrowing. Temporary evidence only; no app/tests/versions/builds/installations/production media changed.
