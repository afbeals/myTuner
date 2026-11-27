# Global/shared — independent pass 2

Commit `a67d418cf7258e669b11fcc9cae63cdc1bcda92d`; isolated port **19033**; desktop **1440×1000**, narrow **390×844**. No other global report was read. Fresh observations: `/private/tmp/mytuner-ui-review/global-p2/independent-notes.md`. Visually viewed desktop shell, settled narrow Menu, keyboard modal and generated-preview screenshots. Evidence also includes programming/content-picker/dirty-modal screenshots, ARIA snapshots in that directory. The other global helper initially reused this evidence directory and overwrote the generic browser/server log files; its distinct captures/logs were moved to global-p1. This pass’s unique screenshots and independent notes remain intact; the explicit CSP-event evidence is in the independent global-pass1 report. Initial menu animation frames were excluded from visual findings; the settled drawer has its correct opaque dark background.

## Confirmed behavior and ranked work

- **GLOB2-01 — P2, owner request, GLO-01/06:** Shared dialogs have a visible Close, accessible name and real modal behavior, but the whole dialog scrolls and no persistent footer exists (`web/src/ui.tsx:245`, `web/src/styles.css:541–565`). Long profile management and the 100-row programming preview move Close/actions away. Build a header/body/footer structure with independently scrollable body, wrapped narrow actions and page-supplied primary action. **Accept:** title/Close and relevant Save/Apply/Cancel remain reachable at 390×844 and with zoom; the existing focus behavior survives nested dialogs. Passed live checks: initial focus Close, Shift+Tab to last action, Tab wrap, Escape dismissal and focus return to Manage trigger.
- **GLOB2-02 — P2, owner request, GLO-08:** Closing a changed Create profile form opens native `window.confirm`; dismissing retains the dialog. Shared Form/navigation and Modal each own discard checks (`web/src/ui.tsx:134,263`, `web/src/navigation.ts:4`). Create one app confirmation system with explicit destructive action text, pending-request messaging and a single guard authority. **Accept:** one prompt per in-app discard/destructive action; Cancel preserves exact draft/focus; accepted server work is never falsely described as cancelled. Keep browser-owned tab-close prompts browser-controlled.
- **GLOB2-A01 — P2, additional UX:** Narrow keyboard navigation loses position: focus Profiles in the open Menu, press Enter; the drawer closes and focus becomes BODY rather than the new page heading/main. Escape leaves Menu expanded (`web/src/App.tsx:108–120,297–312`). Define nonmodal-navigation behavior or a proper dismissible drawer: Escape closes/returns focus to Menu, navigation focuses the destination main/heading after content loads. **Accept:** keyboard/screen-reader users can determine the new page and continue without re-traversing the shell. Existing Skip to content correctly focuses `main` and should remain.
- **GLOB2-03 — P2, owner request, GLO-02:** Build the shared picker as a permission-aware lazy branch model with explicit Apply/Cancel and row checkbox interaction separate from expand controls. Current mount suggestions (`SourcePathField`), scanned directory choices (`SourceDirectory`) and programming catalog selection (`SelectionPicker`) represent different data/authority; one visual component must not erase that distinction. **Accept:** first load fetches direct top level only, expansion direct children only, wide branches retain bounded continuation, loaded branches cache until unmount, explicit refresh invalidates affected branches, aborted/outdated responses cannot change selection, and source/grant boundaries remain server-enforced. No Docker socket or recursive disk crawl.
- **GLOB2-04 — P2, owner request, GLO-04/05/09:** Standardize short labels, optional information controls and search-result match explanations. An information control must support click/keyboard as well as hover; essential errors, permission consequences and deletion effects stay visible. Group-membership matching can legitimately return a different-looking parent label; show the matching child/field before declaring results incorrect. **Accept:** explicit filename/directory/recursive search scope and Search/Enter submission are consistent where catalog search requires them; no eager entire-library loading.
- **GLOB2-05 — P3, owner request, GLO-11:** Generated programming preview confirmed “Actual seconds” with bare 12/8 values (`web/src/Channels.tsx:1445`). Use shared exact readable duration formatting: 12 sec; 22 min 18 sec for 1338 seconds, with precise value available when useful. **Accept:** durations remain accurate and compact across program/commercial rows; do not round short clips to “1 min”.

## Navigation, styling and CSP disposition

**GLO-03:** The twelve admin destinations are legible, have current-page indication, and the rail scrolls to account/help/sign-out at narrow height. Prefer explicit Watch/Program/Manage grouping based on approved frequent tasks; ordering and capitalization remain page-adoption decisions. Do not infer every administrator primarily watches. Current profile appears even on global admin pages; clarify that Accounts/Sources/server settings are network-wide rather than profile-scoped.

**GLO-06:** Retain Silver Signal teal primary, pale secondary, red danger text, 48px controls, visible focus and reduced-motion support (`styles.css:31–76,928`). Standardize loading/success/error and action placement; dangerous actions need a named consequence, not color alone. Preserve compact HDD/shared-RAM behavior.

**GLO-10, not reproduced:** Channels list, Edit programming, nested content selection and generated two-hour preview produced no style-src-elem/style-src-attr violations. Console contained only initial unauthenticated 401. Runtime `[style]` attributes were empty strings; code search found no authored inline style assignments. Policy remains `style-src 'self'` (`src/server.ts:259–260`). Request the original blocked URI/source/route/browser evidence before targeted correction; do not relax CSP globally.

**GLO-07:** No playback/media/native runtime was run in this shared pass. Paused last-frame/title/time/status acceptance belongs to the separate playback reviews; emulator remains deferred.

## Construction versus page adoption

Global creation: sticky modal, app confirmation/guard, accessible information control, selectable lazy branch/list model, explicit search/match feedback, precise duration/status formatting.

- **Channels/Library/Subscriptions:** apply modal/confirmation, bounded selection/search and explicit programming/collection/guide scope.
- **Profiles/Accounts:** apply modal/save contract, account checklist, PIN/password confirmation and named destructive actions.
- **Sources/Generated assets:** apply authorized picker adapters, mapping rows, directory/progress/results feedback; never scan or generate merely by opening UI.
- **Setup/server health, Connect TV, Devices/sessions, Problem reports:** apply modal/action/status/help patterns to their own management flows.
- **Sign-in/startup/unlock and Help:** apply credential-specific draft guarding, connection retry and accessible contextual help.
- **Watch TV:** apply pause presentation and concise controls while preserving independent device-session playback.

Atomic cross-field saves, profile/channel deletion retention and dynamic-versus-fixed selection require product decisions before implementation.

## Cleanup

Helper `finally` closed browser and isolated fixture; **CLEANED** printed. Nothing published or implemented. No app/test/baseline/version changes, builds, installs/downloads, real providers/media or emulator work.
