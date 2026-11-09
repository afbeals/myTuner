# myTuner — Figma design agent brief

Supporting context: [applications and user journeys](APPLICATIONS.md), [media discovery](MEDIA_DISCOVERY.md), [scheduling/playback](SCHEDULING_AND_PLAYBACK.md) and [API reference](BACKEND.md). The [documentation index](README.md) links the complete engineering handoff.

The supplied expanded draft is now linked in [DESIGN_REVIEW.md](DESIGN_REVIEW.md); its older backend gap statements must be reconciled before implementation. [TV_INSTALLATION.md](TV_INSTALLATION.md) defines installation and Unraid connection guidance that must accompany the client.

## Assignment and required output

Design a cohesive desktop browser manager/player and a remote-first TV application for a household personal TV network. Produce Figma designs and interactive flow prototypes; do not implement the product UI. Non-UI engineering proceeds in parallel against the product contracts. Raise missing data/actions before inventing backend behavior.

Read MYTUNER_PLAN.md for product rules and CHECKLIST.md for delivery boundaries. The brief is self-contained enough to start design without reading legacy Plex/ErsatzTV deployment docs. Those describe a superseded approach.

Deliver a Figma file link, labeled pages/frames, reusable components/variables, prototype links, a frame-to-flow index, interaction annotations, focus maps, responsive behavior, and a handoff list of unanswered questions. UI implementation starts only after the owner approves the designs.

## Product and people

myTuner creates a personal live TV network over an existing Unraid library. Sonarr supplies TV metadata and Radarr supplies movie metadata; custom directories work independently. Nothing is copied or reorganized in the source library. Viewers tune into a continuous shared schedule while no video is streamed when nobody watches.

- Admin: connects sources, creates accounts/profiles, grants access, manages all channels and jobs.
- Permitted editor: manages only assigned personal programming and authorized media.
- Viewer: watches assigned room/person profiles; cannot edit programming.
- A profile can be a person (Timmy) or a room (Living Room). A profile and an account are different concepts.

The intended experience is a polished personal TV service, not a Docker dashboard. Keep filesystem paths, IDs, codecs and integration details in setup/details where they help decisions. Do not show raw tokens or technical error dumps in ordinary flows. No Airbnb design-system requirements apply.

## Critical behavior that design must preserve

1. Channel IDs are stable; names can repeat. A subscription changes a profile guide, not the underlying broadcast.
2. Shared channels and profile-owned channels coexist. Other users cannot see that private channels exist. Admin can discover, manage, and subscribe to all channels.
3. Server permissions control media and derivatives. A hidden button is not a permission boundary.
4. Each channel has one timeline. Pause affects only the current device session, even with the same profile on two TVs. Resume is behind live; Go Live catches up. Leaving or switching returns live.
5. Sonarr/Radarr metadata may include unavailable files. Make availability clear; do not imply that tracked-but-undownloaded items can play.
6. Bulk generation is optional/admin initiated. Admin selects a directory, recursive toggle, output types, previews scope, and starts a job. Generated outputs never replace originals.
7. Network setup and TV cleanup are separate follow-ups, not onboarding blockers or automatic actions.
8. Do not promise frame-perfect synchronization or interruption-free transitions before device validation.

## Main browser flows

### A. Bootstrap and sources

Admin sign-in/bootstrap instructions -> source setup -> optional Sonarr/Radarr -> path mapping -> scan status -> catalog results. Show custom-only setup as a first-class route, not a failed integration state.

Source form: name, kind (shows/movies/videos/commercials), server folder, recursive default. Mapping form explains integration path versus server-visible path with a concrete example. Show offline root, wrong credentials, missing mapping, partial scan, unmatched metadata, and successful refresh. Preserve previous catalog when an integration is offline.

### B. Accounts and profiles

Admin account list -> create/edit account and role -> create person/room profile -> assign owners/members -> source/subtree grants -> viewer/editor permissions -> optional TV PIN. No public registration. Include disabled account and denied access states. Clearly distinguish profile PIN from browser account authentication.

### C. Browse and select content

Unified library with source/type filters and search. Artwork cards and an optional dense list. Show -> season -> episodes with availability and ordering. Movie detail includes year and collection. Custom source -> folders -> videos, with a choice to select a whole dynamic subtree or individual items. Collections reference items across permitted sources.

Include mixed aspect ratios, no artwork, filename-only entries, long titles, empty results, thousands of items/pagination, combined episodes, specials, and unavailable media. Use synthetic sample content and placeholder assets; do not import personal media.

### D. Build a channel

Create -> name/owner/shared-or-private -> content groups -> rotation/order -> commercials -> guide preview -> activate. Rotation example: one episode from Show A, one from Show B, repeat while each show advances independently. Offer ordered/shuffle/random with clear repeat explanations.

Do not make users select every episode. Whole shows, seasons, collections, and folders are selectable. Warn about empty selections or missing files. Preview scheduled times and commercial blocks. Editing active programming takes effect after the current program and its breaks; the current broadcast is not restarted silently.

### E. Commercial configuration

Choose pool(s) -> within/between program rules -> break positions -> count/duration caps -> per-rotation appearances -> within-break repeat caps -> cooldown -> preview. Explain that one/two/three appearances are configurable and small pools may require relaxed limits. If a break cannot be filled, preview the shorter break and why. Private channels start with commercials off.

### F. Subscriptions and management

Profile guide configuration -> available shared channels -> subscribe/unsubscribe -> custom channels. Owner sees their channels; admin has an explicit all-profiles management view. A different user's private channel must not appear as a locked tile, count, search hit, or suggestion.

### G. Optional generated assets

Admin source browser -> select directory -> recursive toggle -> choose thumbnail, GIF, conversion outputs -> settings/scope preview -> start. Show queue/progress, reuse versus regenerate, per-item results, failure/retry, cancellation, output storage and cleanup controls. Explain that original videos are unchanged. No automatic bulk conversion on source addition.

### H. Browser watching

Profile selection -> channel guide -> player. Show current/next program, live indicator, pause/resume, Go Live when behind, channel switching, and unavailable content interval. A pause message must not imply that the channel or other viewers paused. Closing/reopening joins live.

## Installation and first connection handoff

Prioritize Sony Bravia Android/Google TV, with Android-based Fire OS as the secondary target. Provide setup help leading from a tested signed APK install to the TV Apps tile, explicit Unraid base-address entry, browser approval and profile/PIN guide. Show the actual server-returned pairing code: the current API uses ten hexadecimal characters, so the six-character Figma sample needs reconciliation. Do not imply that `mytuner.local` resolves automatically or that every Fire stick supports Android APKs.

Include a way to edit an offline/changed server address, token expiry/re-pairing after server restore or app-data reset, and clear HTTP-policy/certificate/network errors. The written guide provides sideloading details; ordinary app screens should use short actionable help and link to the guide.

## TV flows and remote behavior

Server connection by explicit address; discovery is optional -> short pairing code approved in browser -> profile picker/PIN -> guide -> playback. Avoid passwords typed with the remote. Pairing is one-time until revoked/expired. Each fresh launch/reopen starts at profile selection, then an easy numeric PIN keypad (four digits recommended; 4–8 supported), then that profile’s subscribed guide. Switching profiles repeats PIN entry. Do not open a global catalog or restore another profile’s paused session. Configure TV profile PINs during admin setup; clearly distinguish an explicitly unprotected profile. Include expired/rejected pairing, wrong server, offline server, and locked profile.

Design a real 10-foot interface: legible from a couch, large focus targets, short labels, visible focus, high contrast, safe margins. Provide D-pad maps for every screen. Up/Down/Left/Right move predictably; OK activates; Back dismisses one layer or returns to the prior surface. Define focus restoration on returning to a guide/channel and after dialogs. No hover-only actions or mouse assumptions.

Playback overlay includes program info, pause/resume, Go Live, and channel navigation. Mark behind-live clearly without overwhelming the picture. Show unavailable/reconnecting states and avoid burn-in from persistent overlays. Provide 1920x1080 reference frames and scaling guidance for 4K displays.

## Visual direction and accessibility

Propose two lightweight visual directions early, then refine the selected one. Shared brand and components across desktop/TV, adapted to input method and viewing distance. Avoid copying Plex or presenting a generic admin template. Prioritize recognizable media, comprehensible programming, and clear permissions.

Provide variables for color, typography, spacing, radii, surfaces, motion, status colors and focus. Components need default/hover/focus/pressed/selected/disabled/loading/error states as appropriate. Web target: WCAG AA contrast, keyboard access, sensible reading order, accessible names, non-color status signals, reduced-motion behavior. TV: strong focus contrast, readable text, predictable remote control.

Browser reference widths: 1440 desktop, 1024 compact desktop/tablet, and 390 narrow viewport for essential management/viewing flows. Annotate intentional layout changes; do not merely shrink desktop. Mobile app is not a deliverable.

## Suggested Figma structure

- 00 Readme / flow map / decisions
- 01 Foundations and variables
- 02 Reusable components and states
- 03 Browser setup / accounts / sources
- 04 Library / collections
- 05 Channels / commercials / guide preview
- 06 Subscriptions / generated assets
- 07 Browser playback
- 08 TV pairing / profiles / guide / playback
- 09 Edge states / accessibility / handoff

## Prototype acceptance journeys

1. Admin adds Sonarr shows and Radarr movies, scans, and selects a show season without finding files manually.
2. Admin adds a recursive custom source; an editor builds a private shuffled channel from an authorized subtree.
3. Profile subscribes to a shared channel; a different user's private channel is absent everywhere.
4. Admin configures a small commercial pool with three appearances per clip and previews the schedule.
5. Admin runs a shallow thumbnail/GIF job, then a recursive conversion job, and cancels/retries failures.
6. Viewer pairs a TV, unlocks a profile, joins midway, pauses locally, resumes behind live, and selects Go Live.
7. Offline integration/source and unavailable video states remain understandable without losing prior setup.

## Handoff and visual regression

Each frame must identify role/profile, data state, actions, resulting state, and relevant API data. Enumerate all visible strings and validation states for implementation. Supply fixed synthetic data for repeatable visual snapshots. Approve baseline frames at the reference sizes, including TV focus states, dialogs, long titles, absent artwork, and errors. Review visual baseline changes explicitly; snapshots do not replace functional, keyboard, or real-device tests.

Open hardware validation: exact Bravia/Fire models, codecs, playback transition quality and device screenshot capture. Do not block non-UI development on choosing final colors; do block production UI implementation on design approval.
