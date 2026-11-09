# Selected improvement design handoff

The owner approved implementing these selected extensions using the existing Silver Signal visual system before the sixth review round. Additional Figma frames may document the result, but are not a prerequisite for this authorized work. Material product/design mismatches should still be raised.

## Assignment and approved foundation

Extend the approved **Silver Signal** browser manager and TV client. Preserve [the approved reference links and journeys](DESIGN_REVIEW.md). This assignment covers selected proposals in [SELECTED_IMPROVEMENTS.md](SELECTED_IMPROVEMENTS.md), not a redesign or implementation of every suggestion in the expanding proposal catalog. The Sony Bravia Android/Google TV app remains the primary viewing target; Android-based Fire sticks are secondary. Router/VLAN configuration remains an operator follow-up.

Provide linked Figma frames, component variants, copy, responsive behavior and interaction/focus notes. Reuse the approved tokens and components. Clearly label every new state, each action's scope and when it changes an active schedule/session. Do not put source files, local absolute paths, integration keys, tokens or developer diagnostics into viewer flows. Admin-only mapping/report screens may show relevant source-relative or upstream mapping paths.

## 1. Collection editing and content selection — I01, I05, I16

From an existing collection, Edit opens the same collection ID with its name/members preselected. Let the user rename, add and remove authorized references. Unavailable existing members remain visible and retained unless explicitly removed; explain that they cannot play until available. Show selected items across search/page changes. Cancel must leave the saved collection and channels unchanged. Never imply a file will move or be duplicated.

Replace the long programming select with a searchable picker grouped by source and type. Whole show, individual season, movie, movie collection, custom directory and saved collection are distinct choices. Drill from a show to its seasons. Same-named shows in different sources must remain distinguishable. Include a saved-selection summary when it falls outside the current query/page. Preserve the draft selection while searching. Empty/loading/offline/forbidden states must not silently clear it.

Deliver desktop/compact/narrow frames, keyboard navigation, visible selection count, pagination/loading-more state and unavailable-member confirmation. Use bounded results from `library/options`; do not imply the first 50 results are the entire archive. Avoid exposing hidden-source names or counts.

## 2. Programming draft, checkpoints, copies and preview — I02, I03, I15, I19, I24

The editor has one draft. Content and commercial changes survive tab switches. Distinguish **Unsaved draft**, **Preview current** and **Published — effective at …**. Either remove the separate commercial Apply step or make unapplied inputs and their effect unambiguous. Never allow a stale response to mark a newer draft saved. Closing/navigating away prompts only when current draft or unapplied commercial inputs would be lost; untouched close stays immediate. A current exact-draft preview remains required before publication.

On an ordered group add Restart group / Choose next episode, with a compact current/next description and confirmation. A restart affects only that group and takes effect after the current program and breaks. It does not restart the television's current airing or another group. Shuffle/random groups do not offer an ordered start point.

Each group may optionally choose **Episodes per turn: 1 / 2 / 3**, default one. Show a short example such as A1, A2, B1. This controls rotation turns, not clock slots or arbitrary weights. Current-program publication boundaries remain unchanged.

Create from this channel copies rules/selections into a **new private unpublished draft**. Require a new channel name and target profile; optional short name follows existing rules. Explain independent live timeline. No copied subscriptions, history, cursor or media. Cancel cannot leave a published channel. Reuse existing creation/editor patterns where possible.

Preview intervals show readable program/commercial type, actual interval duration, date at midnight, seconds when necessary, effective time and actual generated horizon. Disclose any row truncation. A twelve-second original truncated to ten displays ten seconds. Summarize pool size, ads/seconds, shortened ads and early-return reasons. Distinguish pool-repeat allowance, per-break cap and cooldown. Exposure statistics distinguish scheduled, started and delivered time; do not call this human viewing.

Deliver: draft/preview/publication state strip; commercial tab; picker entry; checkpoint confirmation; start-episode selector; episodes-per-turn control; copy flow; cutoff/minimum/cooldown/no-pool explanations; dirty-close/navigation dialog; pending/failure/retry states. Annotate when all buttons disable or retain focus during requests.

## 3. Setup and administration — I04, I10, I11, I12, I13, I14

After local administrator bootstrap, guide the admin through profile → media source → scan → grants → preview/publication → subscription → TV pairing. Show completed/incomplete/actionable steps with links to existing forms. Sonarr/Radarr are optional; custom directories must have a complete path. Never enable public signup or write probes into media shares.

Mapping checks show a bounded set of upstream path → mapped container path → matched/unmatched catalog item. Explain missing mounts, denied reads and unmatched mappings plainly. Import reports show new/unchanged/unmatched/reassociated/absent associations and successful provider-read/source-scan completeness. An absent association is a **review candidate**, not proof a file was deleted. No automatic metadata-removal action is included until installed-provider behavior is accepted.

On a profile's Access panel, select a target account and show its actual can-watch/can-manage status, allowed sources/subtrees, PIN/device state and subscription readiness. An inspecting administrator's privileges must never make the target appear authorized. Show room owner/member/viewer/editor/admin distinctions with concise explanations. Ordinary users cannot see another user's private channels.

Generation preflight shows files, total source duration, requested/reusable/new outputs and storage headroom. Size/ETA estimates are unknown unless measured reliably. Progress identifies title/relative path, output type and readable failure with Retry/Cancel. No bulk conversion starts from merely adding a source or opening a preview.

The operational overview shows source reachability, refresh/import timestamps, failed jobs, schedule coverage, storage and last completed application backup. Include healthy/degraded/unknown/no-backup states and links to runbooks. It is read-only in the first scope. Explain operator-triggered full backups, pre-restore recovery and separate database-only pre-migration safety snapshots. There is no automatic backup cadence yet. Keep restore offline; never offer a credential-bundle download through a general status view.

Deliver first-run/incomplete/repair status; mapping samples; import-run list/details; effective-access states; generation preflight/progress/errors; operational dashboard. Use readable names instead of UUIDs. Admin details may be dense; viewer recovery stays compact.

## 4. Pairing, PIN and playback preferences — I06, I07, I10, I18

TV pairing retains server address, recognizable device and the ten-character public approval code. Add a QR code linking to the **same server's authenticated approval form** with only that public code prefilled. Preserve manual entry. No tokens/private device codes in the QR; scanning never approves automatically or bypasses a profile PIN. Include phone not signed in, expired code, wrong server, revoked authorization and manual fallback.

PIN accepts four through eight digits via keypad, number buttons or numpad; Delete edits and Enter explicitly submits. Fire remotes keep the keypad. Never auto-submit on the fourth digit. Pending requests block duplicate activation while keeping sensible focus. Wrong PIN clears submitted digits and allows retry. Profile/screen change discards digits. Include a small numeric-key hint only if it helps.

Audio/subtitle preference controls apply to this device/server/profile. Prefer languages and track properties, never file-specific index numbers. Missing preferred audio falls back to default; missing subtitles fall back to off. Captions include a few approved size/background variants and readable previews. Choosing Off persists. Describe whether the existing track menu saves a preference; avoid a surprising hidden setting. Cross-device synchronization is outside this first scope.

Connection help shows saved server, API compatibility, last successful check and a safe error category with a direct recovery action. Distinguish unreachable server, expired pairing, denied access, unavailable source and unsupported media. Explain re-pairing. Never expose integration credentials or private source paths.

Deliver TV pairing + phone approval, remote/PIN pending/error variants, track/preference menu and caption examples, connection/help states. Specify D-pad focus, OK/Back behavior and accessibility semantics.

## 5. Viewing context, lineup and browse-in-player — I08, I09, I21

Opening the playback overlay displays title/show/season/episode, current progress, next program, live/behind-live status and scheduled commercial remaining time. Dismissed controls leave the picture unobstructed. Paused/behind-live displays derive from session position, not wall-clock time. Ten scheduled commercial seconds display ten even if the file is twelve. Provide fallback when metadata/next program is absent. A short tuning display is optional. **Automatic inactivity hide (I17) was not selected**; do not add it by assumption.

In browser profile settings allow accessible Move up/down lineup ordering. Browser/TV guide and previous/next tune use the same saved order; names and short names are labels, not keys. Include first/last, pending/failure and removed/revoked channel states. Favorites/search may be separate future enhancements.

Browse channels opens a panel over the current player without leaving its playback session. Moving focus only inspects now/next. Back dismisses to the same paused/playing position. Explicit **Watch live** changes channel and discards the old pause with clear wording. No second video and no automatic tune on focus. Keep the full guide's existing leave/reopen behavior. Define nested Back behavior for browser panel, track dialog and overlay. Profile changes clear old private information immediately.

Deliver unobstructed/compact/expanded context; commercial/paused/behind-live/unavailable states; lineup controls; in-player channel panel; tuning/pause-discard states; focus map and screen-reader labels. Validate 1080p and 4K scaling, large subtitles, long names and a small television-safe text density.

## Prototype journeys and design acceptance

1. Edit a collection with an unavailable member; cancel, then save without changing collection identity.
2. Find one show by filename in a large archive, select a season and retain that selection across a different search.
3. Set two episodes per turn, choose a group's next episode, tune commercial cutoff rules, preview and publish after the current program/breaks.
4. Change unsubmitted commercial inputs, switch tabs and close/navigation; preserve or explicitly discard the same draft.
5. Copy an owned channel into a new private draft; choose another permitted profile; cancel without creating a published lineup entry.
6. Start with custom directories and no integrations, complete setup, then inspect denied target-account access and repair grants.
7. Review an absent integration association after a complete provider response while leaving local playable media untouched.
8. Preview generation with reusable outputs; cancel/retry an item; inspect degraded operational status and no-backup guidance.
9. Pair from a phone QR with authenticated explicit approval; use numeric and keypad PIN input on TV.
10. Set language/caption preferences, transition to an episode with missing tracks and show the fallback.
11. Open context during a truncated commercial, pause, browse ten channels and return to the same session; explicitly tune another channel live.
12. Recover expired authorization/offline server/unsupported media without exposing credentials or another user's private channels.

Acceptance needs linked frames and prototypes, token/component specs, copy, all loading/empty/error/offline/forbidden states, keyboard and D-pad focus/Back maps, narrow/compact/desktop browser variants, caption/accessibility examples and the recorded owner approval to extend the existing visual system. Implementation tests then need stable screenshots and behavioral journeys against these states. Figma delivery alone does not validate playback or physical TV installation.

## Sixth-round selected additions — I28/I29/I30/I31/I33/I34

The owner selected these six additions using the same approved visual system. Implemented browser patterns are: a paged dependency report in collection delete confirmation; a capacity-waiting explanation in generation progress; a bounded stored-metadata readiness panel in library/channel details; per-channel commercial eligibility checkboxes with publication-boundary copy; stable detail links and copy feedback; and a responsive read-only video inspector with optional technical tracks. [SELECTED_IMPROVEMENTS.md](SELECTED_IMPROVEMENTS.md) records the exact flow and limits. New desktop/narrow inspector and readiness screenshot baselines supplement existing approved baselines. No redesign or unselected feature is implied.

## Seventh-round extensions — I38, I39, I40, I42, I43

These selected additions reuse the approved fields, buttons, panels, modal semantics and mint TV focus. I38 is CLI-first with no new product screen. Collection deletion names its captured target; navigation closes resource-owned child dialogs. Undo follows deletion and Recently deleted lists accessible metadata with exact expiry/Restore. Revoked/expired items remain neutral; restored IDs never imply republished airings.

Recently aired is a date-aware read-only list in the browser guide/player and TV player. Describe two hours of retained completed airings, possible partial retention and no replay/watch-history claim. Opening/closing does not change playback. On TV long lists scroll and Close returns focus to the originating player action.

Report a problem presents four categories, exact sanitized summary, explicit Send, pending, unconfirmed/not-sent Retry and reference acknowledgement. Opening/preparing is not submission. Native uses remote selection and no text entry. The admin inbox offers acknowledge/delete; viewers see their currently permitted own reports. No raw logs or media-upload controls. Channel/airing references are support context with wrapping; display no secret/local paths.

Changed elsewhere retains the local draft. Offer explicit discard/load latest or retain/review against latest. Show readable latest group/rotation and commercial-rule summary; fresh preview is required before publishing. Preserve existing late-response/unpublished-input protections. New browser dialogs have narrow visual regression coverage; physical TV/Fire focus, large text and screen-reader acceptance remain separate gates.

## Expanded I47 editing flow

[METADATA_EDITING.md](METADATA_EDITING.md) defines the selected extension. Reuse existing Silver Signal modal/field patterns for channel details and scoped library title/description editing. Show per-field source, actual available candidates, effective preview and explicit custom/reset actions. Local metadata can come from adjacent NFO files or a configured read-only metadata directory. Check metadata files explicitly rechecks/previews that mapping; merely opening Edit reads cached availability. No web URL/search/parser controls. Provide keyboard focus/close/dirty/error/pending states and narrow/long-text variants. Separate channel details/programming actions are implemented for existing name, short name and visibility fields, using the approved modal system. Description fields, source selectors and local metadata-directory mapping remain pending. Preserve the programming draft when details opens above it.
