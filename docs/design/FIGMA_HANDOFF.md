> Preserved supplied design reference. Its backend status/gap statements may describe an older checkpoint; read [current reconciliation](../DESIGN_REVIEW.md) and [current API contracts](../BACKEND.md). Design review is not production UI approval.

# myTuner — Silver Signal design handoff

Status: private POC draft for owner review. The visual direction and two base layouts are selected. Expanded screens, interactions and baselines still need Allan’s approval before production UI implementation. Preserve previous concepts; do not publish, invite collaborators or change sharing.

Start with the [Figma review index](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=40-241). [Open the seven review journeys](https://www.figma.com/proto/lAXmTA1teK8MqqogAqvRlr?node-id=36-9412&starting-point-node-id=36%3A9412). [Find every canonical screen](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=40-277).

## Instructions for the implementation agent

Use this handoff with:

- /Users/allan_bealsgibson/Code/tmp/myTuner/docs/DESIGN_BRIEF.md
- /Users/allan_bealsgibson/Code/tmp/myTuner/docs/MYTUNER_PLAN.md
- /Users/allan_bealsgibson/Code/tmp/myTuner/docs/BACKEND.md
- /Users/allan_bealsgibson/Code/tmp/myTuner/docs/CHECKLIST.md
- /Users/allan_bealsgibson/Code/tmp/myTuner/src/contracts.ts

Continue non-UI engineering as authorized. Do not treat this handoff as approval to implement production UI. After design approval, reconcile the current API contracts before wiring controls. Do not invent endpoints or infer that a scripted Figma state is implemented.

Use Silver Signal’s silver/charcoal/mint palette, IBM Plex Sans and Space Mono. Keep the early-2000s receiver character, readable media, clear permissions and schedule-first workflow. This personal project has no Airbnb design-system requirement.

## Selected layouts

| Layout     | Decision                                                                         | Figma                                                                                  |
| ---------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| TV         | Option 1 now/next guide                                                          | [Selected guide](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=22-241)   |
| Management | Option 2 Schedule First sidebar/table plus Option 1’s right-side channel preview | [Selected manager](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=22-352) |

The selected guide and management originals remain unchanged. Expansion pages reuse their design language. Canonical screens contain role, profile, data state, action/result and API notes directly beneath each frame.

## Review pages

| Page                                            | What to review                                                                                                                    | Link                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 07 · Product — Setup, accounts & sources        | Administrator sign-in, custom sources, Sonarr/Radarr mapping, scan results, accounts, profile grants/PIN and browser TV approval. | [Open](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=25-236) |
| 08 · Product — Library & collections            | Library grid/list, show → season → episodes, dynamic folders, collections, movie details and availability.                        | [Open](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=26-236) |
| 09 · Product — Channels & commercials           | Private/shared identity, content-group rotation, commercial limits, shortened-break preview and edit timing.                      | [Open](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=27-236) |
| 10 · Product — Subscriptions & generated assets | Profile subscriptions; generation scope, shallow/recursive jobs, progress, retry, cancellation and storage concepts.              | [Open](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=28-236) |
| 11 · Product — Browser watching                 | Browser profile selection, now/next guide, live/local pause/behind-live playback and missing-file interval.                       | [Open](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=29-236) |
| 12 · Product — TV pairing, profiles & playback  | Server address, pairing code, profiles/PIN, selected Option 1 guide, playback and per-screen remote focus maps.                   | [Open](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=30-236) |
| 13 · Product — Responsive browser layouts       | 1024px compact manager/library; 390px browser guide, lineup, editor and player with intentional scrolling.                        | [Open](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=31-236) |
| 14 · Product — Recovery, empty & denied states  | Empty/loading results, source/integration outages, validation, permissions, reconnecting, expired pairing and locked profiles.    | [Open](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=32-236) |
| 15 · System — Foundations & component states    | Silver Signal palette/type/spacing/motion; local browser-button, field and TV-action state families.                              | [Open](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=33-245) |
| Review index                                    | Selected layouts, page descriptions and main entry points                                                                         | [Open](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=40-241) |
| Frame-to-flow index                             | All 58 canonical frames                                                                                                           | [Open](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=40-277) |
| Implementation decisions/API gaps               | Product rules and missing contracts                                                                                               | [Open](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=40-365) |
| Validation/open questions                       | Accessibility, synthetic fixtures, approval and hardware checks                                                                   | [Open](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=40-389) |
| Visible copy inventory                          | 804 unique canonical strings, grouped into 12 cards                                                                               | [Open](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=41-236) |

## Prototype journeys

These are scripted, fixed-data review flows on one Figma page. Follow their linked primary actions; the final screen has a Review journeys button. The flow menu also switches journeys. D-pad behavior and focus restoration are documented beneath canonical TV frames; the prototype does not fully emulate a physical remote, real playback or authorization.

| Journey | Scope                                                                    | Presentation link                                                                                             |
| ------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| J1      | Sources → metadata → season selection (8 screens)                        | [Play](https://www.figma.com/proto/lAXmTA1teK8MqqogAqvRlr?node-id=36-9429&starting-point-node-id=36%3A9429)   |
| J2      | Custom subtree → private shuffled channel (7 screens)                    | [Play](https://www.figma.com/proto/lAXmTA1teK8MqqogAqvRlr?node-id=36-10187&starting-point-node-id=36%3A10187) |
| J3      | Subscribe → personal guide → live (4 screens)                            | [Play](https://www.figma.com/proto/lAXmTA1teK8MqqogAqvRlr?node-id=36-10734&starting-point-node-id=36%3A10734) |
| J4      | Small commercial pool → three appearances → preview (3 screens)          | [Play](https://www.figma.com/proto/lAXmTA1teK8MqqogAqvRlr?node-id=36-11032&starting-point-node-id=36%3A11032) |
| J5      | Shallow previews → retry → recursive conversion → cancel (9 screens)     | [Play](https://www.figma.com/proto/lAXmTA1teK8MqqogAqvRlr?node-id=36-12949&starting-point-node-id=36%3A12949) |
| J6      | TV pairing → PIN → local pause → resume → Go Live (10 screens)           | [Play](https://www.figma.com/proto/lAXmTA1teK8MqqogAqvRlr?node-id=36-13534&starting-point-node-id=36%3A13534) |
| J7      | Integration failure → source recovery → unavailable interval (6 screens) | [Play](https://www.figma.com/proto/lAXmTA1teK8MqqogAqvRlr?node-id=36-14109&starting-point-node-id=36%3A14109) |

J6: choose Sam at the profile picker to exercise PIN unlock; Living Room is the no-PIN alternate.

## Product behavior to preserve

- Accounts authenticate; person and room profiles are separate. Administrators create accounts; no public registration.
- Private channels are invisible to other accounts in search, counts, suggestions and derivatives. Administrators have an explicit all-profiles exception. UI visibility never replaces server authorization.
- Channel IDs remain stable; duplicate names are allowed. Subscriptions change a profile guide without creating or restarting a broadcast.
- Pause affects one device session. Resume continues behind live. Go Live catches up. Switching channels or reopening joins live.
- Missing scheduled media holds its interval; later entries do not move earlier. Tracked metadata is not an available file.
- Whole shows, seasons, folders/subtrees and collections can be selected dynamically. Ordered keeps source order; shuffle avoids repetition until exhaustion; random allows immediate repeats. Content groups advance independently.
- Active edits take effect after the current program and its associated breaks. Do not recreate a channel or silently reset its clock.
- Commercial rules explicitly configure pools, positions, clip/duration caps, 1/2/3 appearances per rotation, within-break repeats and cooldown. Impossible breaks shorten without padding or silent rule relaxation. Private channels default commercials off.
- Sources are read-only and custom-only setup is first class. Source/integration outages preserve the last catalog and programming.
- Generation is optional and admin initiated. Choose directory, shallow/recursive scope, output types and reuse/regenerate; preview before start. Originals remain unchanged. Cancellation and derivative cleanup are separate.
- Network setup/TV cleanup remain separate follow-ups. Do not promise frame-perfect synchronization, transition quality or device performance.

## API mapping and open contracts

| Area                 | Current backend                                                                         | Must be resolved before production UI                                                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication       | auth/login, logout, me; API bearer sessions                                             | Browser cookie/session/CSRF contract; native/browser session lifecycle; avoid undocumented persistent browser tokens                                                |
| Accounts/profiles    | Account create; profile list/create; membership canManage; source/subtree grants        | Account list/edit/disable/reset; profile edits; PIN storage/unlock/throttling/lockout; TV profile grants                                                            |
| Sources/integrations | Source list/register/scan and one-shot Sonarr/Radarr import                             | Final progress/summary schema, persistent credentials/refresh and integration configuration                                                                         |
| Library              | Authorized media search/page/limit and availability                                     | Aggregate show/season/folder browsing; dynamic selectors; tracked-only metadata representation; collection CRUD and selection                                       |
| Channels/schedule    | Channel create; explicit-ID initial schedule publish                                    | Channel listing/edit lifecycle; preview API; dynamic selection resolution; boundary edits, extension, revisions and paused-session retention                        |
| Subscriptions/guide  | PUT/DELETE subscriptions; candidate channel list; live lookup                           | Subscription-only guide, order/current-next/time data and consistent profile context                                                                                |
| Playback             | Join/describe/leave/pause/resume/goLive; authorized byte ranges; missing-file reporting | HLS/client delivery, on-demand conversion, capability negotiation, reconnect/heartbeat/GC, buffering, permission revocation during streams and real-device behavior |
| Generation           | Explicit scope preview/start/status/cancel; fingerprinted derivative delivery           | Job history/list/pagination; storage usage/limits/cleanup; configurable presets; dedicated retry if needed                                                          |

Use UUIDs, profile/channel/media IDs and integer milliseconds where the contracts specify them. The current initial publish rejects a second publish; do not implement the designed boundary edit by republishing/resetting. Some responses use snake_case: freeze a consistent public response and safe field-error schema.

Source import API keys are masked, not logged, not placed in URLs and not persisted by the current endpoint. A refresh currently requires supplying credentials again.

Retrying generation currently creates a new same-scope job with valid outputs reused. Stored MP4 conversion is optional bulk output, not demand-based live streaming.

## Responsive and accessibility requirements

- Browser references: 1440×1024 desktop, 1024×1024 compact and 390×844 narrow. Narrow forms/pages scroll intentionally. At 1024, secondary table columns collapse into summaries and channel preview moves below the selected row. At 390, navigation becomes Menu and core actions stack.
- TV references: 1920×1080; 96px horizontal and 56px vertical safe margins, large type and 72px actions. 4K guidance is ×2 design units followed by device validation.
- Web: sensible reading/Tab order, accessible names, 44px targets, inline errors plus error summary, non-color status, reduced motion, modal focus trap/Escape/return.
- TV: per-screen D-pad/OK/Back maps and restoration are in annotations. Focus is visible without hover. Live overlays are on demand and should not remain permanently on screen.
- Checked token-pair ratios: text/web 11.94:1; muted/web 5.16:1; accent/surface 6.01:1; TV text/background 16.62:1; TV muted/background 10.53:1; focus/TV panel 9.50:1. These checks do not replace runtime accessibility testing.

## Validation and implementation limits

The design deliverable contains 58 canonical screen/system frames, seven scripted journeys with 47 review copies, reusable local component states, tokens/styles, a full frame index and visible-copy inventory. All UI is native editable Figma text, vector artwork, frames and instances.

Structural checks found 126 valid prototype navigation edges and no invalid destinations. Representative desktop, narrow, TV and handoff compositions were visually reviewed; text/control fit issues found during review were repaired. The four original Silver Signal concept fingerprints are unchanged.

No product UI code was implemented. No baseline is owner-approved yet. Hardware questions remain: exact Bravia/Fire models, codecs, delivery support, transitions, paused-session behavior and screenshot capture. Validate functional behavior, keyboard navigation and real devices after implementation; visual snapshots alone are insufficient.

## Copy and fixed synthetic fixtures

Figma: [Visible copy and validation inventory](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=41-236).

Local files:

- /private/tmp/myTuner-design-copy-inventory.json — every canonical frame’s visible strings with node IDs and role/state/API annotations; 804 unique strings
- /private/tmp/myTuner-design-links.json — machine-readable page/frame/prototype links
- /private/tmp/myTuner-design-handoff.md — this document

Use synthetic Orbit Patrol, Maple Street, The Long Way Home and Weekend videos examples. No personal media was imported. Large library totals are pagination fixtures; sample schedule previews and current broadcasts represent separate proposed/current states, not a synchronized real server. Actual times and availability come from server contracts.

## Every canonical frame

### 07 · Product — Setup, accounts & sources

- [A0 · Administrator sign-in & first-run instructions](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=25-241)
- [A1 · Add a source](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=25-268)
- [A2 · Sonarr / Radarr metadata & path mapping](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=25-333)
- [A3 · Scan and metadata results](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=25-408)
- [A4 · Accounts & roles](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=25-472)
- [A5 · Profile access, grants & TV PIN](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=25-552)
- [A6 · Approve a TV connection](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=25-638)

### 08 · Product — Library & collections

- [B0 · Unified library · artwork grid](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=26-241)
- [B1 · Show → season → episodes](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=26-425)
- [B2 · Custom folders · dynamic subtree selection](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=26-536)
- [B3 · Cross-source collection](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=26-611)
- [B4 · Library · dense list & unavailable file](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=26-678)
- [B5 · Movie detail & metadata collection](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=26-751)

### 09 · Product — Channels & commercials

- [C0 · Create private channel · identity](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=27-241)
- [C1 · Content groups & independent rotation](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=27-296)
- [C2 · Commercial pools, positions & limits](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=27-405)
- [C3 · Schedule preview · shortened break](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=27-495)
- [C4 · Confirm edit timing · active channel](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=27-598)
- [C5 · Programming needs attention](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=27-652)

### 10 · Product — Subscriptions & generated assets

- [F1 · Profile guide & subscriptions](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=28-241)
- [F2 · Subscription saved](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=28-314)
- [G0 · Optional generation · scope preview](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=28-378)
- [G1 · Confirm generation scope](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=28-458)
- [G2 · Queue & per-item progress](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=28-514)
- [G3 · Partial failure & safe retry](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=28-576)
- [G4 · Recursive conversion & cancellation](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=28-636)
- [G5 · Output storage & cleanup review](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=28-702)

### 11 · Product — Browser watching

- [H0 · Choose a viewing profile](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=29-241)
- [H1 · Browser channel guide · now & next](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=29-277)
- [H2 · Browser playback · live](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=29-363)
- [H3 · Browser playback · local pause](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=29-428)
- [H4 · Browser playback · resumed behind live](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=29-495)
- [H5 · Unavailable scheduled interval](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=29-562)

### 12 · Product — TV pairing, profiles & playback

- [T0 · Connect to your server](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=30-241)
- [T1 · Approve this TV in your browser](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=30-272)
- [T2 · Choose a profile](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=30-302)
- [T3 · Unlock Sam’s profile](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=30-342)
- [T4 · Selected Option 1 TV guide](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=30-399)
- [T5 · TV playback · live midway](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=30-504)
- [T6 · TV playback · paused locally](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=30-567)
- [T7 · TV playback · resumed behind live](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=30-630)
- [T8 · Unavailable program](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=30-693)

### 13 · Product — Responsive browser layouts

- [R0 · Compact channel manager · 1024](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=31-241)
- [R1 · Compact library · 1024](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=31-344)
- [R2 · Narrow channel list](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=31-466)
- [R3 · Narrow subscriptions](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=31-500)
- [R4 · Narrow channel programming](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=31-534)
- [R5 · Narrow browser playback](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=31-572)

### 14 · Product — Recovery, empty & denied states

- [E0 · Library loading & empty results](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=32-241)
- [E1 · Offline source · preserve catalog](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=32-299)
- [E2 · Source & integration validation](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=32-356)
- [E3 · Permission, session & unsubscribe confirmation](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=32-420)
- [E4 · Browser reconnecting](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=32-472)
- [T9 · Server unavailable](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=32-495)
- [T10 · Pairing needs another try](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=32-524)
- [T11 · Profile locked / PIN error](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=32-554)

### 15 · System — Foundations & component states

- [S0 · Palette, type, spacing & focus](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=33-267)
- [S1 · Component state specimens](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=33-373)

## Preserved earlier concepts

- [Original concept comparison](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=9-2)
- [Cable Blue](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=2-2)
- [Original Silver Signal](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=2-3)
- [Broadcast Club](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=2-4)
- [Original concept components](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=2-5)
- [Silver Signal layout alternatives](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=15-236)
- [Selected combined direction](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=22-236)
