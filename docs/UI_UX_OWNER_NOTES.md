# Owner UI/UX review intake — 2026-11-26

This is a lightly normalized tracking intake of the owner’s supplied issues and proposals, not a verbatim transcript and not authorization to implement product changes. Review every application page twice: first against applicable owner items, then an independent page-focused UI/UX assessment. Complex pages receive additional focused investigation. Preserve page-specific repetition. Shared component creation belongs in Global, with explicit adoption tasks retained per page.

## Generation

- GEN-01 Check whether requested assets already exist; expose an overwrite checkbox for fresh generation.
- GEN-02 Progress modal: replace individual cards with the current directory and an updating filename subline. Results should be a collapsible text log listing filenames and success/failure.
- GEN-03 Reported bug: completed generation remains in the queue, the modal’s top bar keeps moving and work appears to continue. Investigate queue/history semantics and active versus completed indicators.

## Sources

- SRC-01 Can the container media path be derived from Docker configuration? Investigate existing mount suggestions and their limits without giving the app Docker-daemon access.
- SRC-02 “Choose media directory” opens content below unrelated buttons. Place its disclosure directly beside/below its trigger; make its purpose clear. Investigate why directory information appears before the choice action is opened.
- SRC-03 Mapping/import review is confusing, nested and hard to navigate. Explain its actual role. Consider a dedicated Scan & refresh modal containing run configuration, start action, progress and previous results.
- SRC-04 Subtitle configuration is hard to follow: stacked buttons, weak grouping and verbose technical language. Explain why nested folder depth exists; investigate selecting a parent and including its subfolders instead.
- SRC-05 Apply the same clarity/grouping simplification to descriptive metadata configuration.
- SRC-06 Sonarr/Radarr mappings should be repeatable paired inputs, left path → right path, with Add mapping. Investigate path-existence validation when saving, distinguishing upstream provider paths from local container paths.
- SRC-07 One Save action in the configuration modal footer instead of independently saved cards. Keep Disconnect with its integration section, styled secondary. Investigate atomic saves, independently failing operations and scan side effects before recommending contracts.
- SRC-08 Replace the bottom’s uneven long vertical columns with horizontal sections/cards and clear titles.

## Accounts

- ACC-01 Require matching confirmation when changing a password.
- ACC-02 Place secondary Revoke sessions beside Save rather than as a separate disconnected action.

## Profiles

- PRO-01 Move useful “Explain account access” information to the profile’s main card; move generic explanations into an information tooltip/popover beside the page title.
- PRO-02 Support full create/read/update/delete lifecycle; investigate deletion dependencies and active device/session behavior.
- PRO-03 Explain the purpose of Inspect account and whether this diagnostic should remain visible in the proposed layout.
- PRO-04 Use the new shared directory picker for Allowed library.
- PRO-05 One Save in the management modal footer rather than a save button for every section.
- PRO-06 Require confirmation when entering/changing a TV PIN.
- PRO-07 Clarify what account access controls. Prefer a scrollable checklist showing account names and account types rather than the account dropdown; distinguish watching from managing and profile ownership.
- PRO-08 Bound long Allowed library lists with scrolling and investigate a checkbox-based selection workflow.

## Watch TV

- WAT-01 Simplify the header to relevant channel/program context. Use a two-column layout: player with information/current settings beneath it; profile/channel selection and related controls in the other column.

## Subscriptions

- SUB-01 Move profile subscriptions into a modal opened beside Manage on profile cards, using a channel checklist. Investigate how guide ordering, private channels, permissions and existing navigation are retained.

## Channels

- CHA-01 Reported bug: “scheduled and delivered exposure…” repeats endlessly in the side panel. Owner clarification: select an archived item; its sidebar keeps loading and adding new lines. Reproduce archived selection and active/archived switching; distinguish repeated fetching, duplicated text and layout artifacts.
- CHA-02 Programming search is confusing: top-level/directory behavior and results whose displayed directory doesn’t match (e.g. search “test” returns “_waiting”). Add explicit recursive versus current-level scope and folder names versus file/folder names. Investigate current matching/grouping before calling results incorrect.
- CHA-03 Replace the confusing programming sections with a focused step-by-step flow, optional steps, Back navigation, retained draft and final review/preview with Cancel/Submit.
- CHA-04 Add confirmed permanent deletion for archived test channels; investigate retained schedules, history, subscriptions and current playback dependencies.
- CHA-05 Reported error selecting programming content: “Uncaught TypeError: crypto.randomUUID is not a function”. Reproduce on ordinary LAN HTTP as well as localhost.

## Library and the combined channel/library proposal

- LIB-01 Explain Library versus Channels, collections versus programming, and their visibility/permission behavior. Investigate the owner’s assumption that a channel has one program; distinguish a single programming configuration from its groups/timeline.
- LIB-02 Propose one page with horizontal channel cards above the current library layout and top-right Create channel/Create collection actions.
- LIB-03 Channel wizard: channel details → collections/content selection → programming/commercial configuration → final preview/review/save. Investigate whether direct show/folder references remain available alongside saved collections.
- LIB-04 Add a cart/selection tray: collect library items, then create a collection. Support selecting only specific videos rather than an ambiguous “Use whole selection”.
- LIB-05 Bound the selected-card video list with a maximum height and scrolling; place Details and Edit information inline rather than stacked.
- LIB-06 Library details selection should offer Select all and an explicit Apply/Submit action.
- LIB-07 Explain source/folder cards that appear channel-like: the owner created “test:channel” for a custom path and sees a similarly named library card. Reproduce if possible; distinguish sources, folders, collections and actual channels.
- LIB-08 Reported bug: collection creation does not work. Investigate browser and API paths, selections and ordinary LAN HTTP.
- LIB-09 Folder search: titles/directories only, top level by default, explicit recursive choice, drill-down into a directory/modal. Preserve bounded, read-only, HDD-efficient behavior.
- LIB-10 File search: matching filename rows with Add to cart and optional directory restriction.
- LIB-11 Apply searches only with an explicit Search action rather than on every input change. Review all relevant page searches.

## Global/shared

- GLO-01 Shared modal with sticky header/footer, Close and primary actions.
- GLO-02 Shared directory selector: expandable tree, checkbox selection by clicking the row, explicit Apply/Cancel. Load only top level initially and direct children on expansion; replace Previous/More navigation with expansion loading. Cache fetched branches in component memory until unmount; refresh/invalidate on new fetch. Investigate pagination limits for wide folders, source/grant containment, permissions, cancellation and HDD cost. Clarify filesystem browse versus catalog/media selection trees.
- GLO-03 Improve sidebar ordering with primary/frequent actions first and capitalized titles.
- GLO-04 Use plain human language; avoid terms such as “server-visible mount targets”.
- GLO-05 Move lengthy optional explanations to information controls supporting hover, click and keyboard access. Keep essential errors, safety implications and action consequences visible.
- GLO-06 Group related actions horizontally with clear concise labels and primary/secondary hierarchy; preserve narrow-screen usability.
- GLO-07 Paused video should show “Paused”, show title and current time, with its last frame visible instead of a black background. Investigate browser playback; native review is code-only because further emulator/device verification remains deferred.
- GLO-08 Replace browser confirmation dialogs with application-owned confirmation modals; distinguish in-app actions from browser-controlled tab-close prompts.
- GLO-09 Investigate irrelevant-looking search matches such as “test” returning “_waiting_ignore/_SORT”, using actual matched fields and group membership as evidence.
- GLO-10 Reported CSP errors: style-src-elem and style-src-attr blocks. Owner follow-up locates these on the Channels page; the exact console error/source has not been supplied. Capture actual browser console violations and inline-style sources; do not recommend blanket policy relaxation without evidence.
- GLO-11 Programming preview “Actual seconds” is hard to interpret (e.g. 1338); use readable minutes or duration formatting with precise values where useful.

## Coverage boundary

Inventory includes Channels, Library, Subscriptions, Watch TV, Profiles, Accounts, Sources, Generated Assets, Setup & server health, Connect TV, Devices & sessions, Problem reports, Sign-in/startup/profile unlock, and Setup & TV help. Each requires two independent subagent passes in the running synthetic application, with code inspection supporting findings. Extra focused reviews cover complex source configuration and the combined catalog/channel/search/privacy proposal. No production server, real media, new host programs or emulator is part of this review.
