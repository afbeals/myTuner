# myTuner documentation

This is the entry point for the standalone personal TV project. Version 0.2.0 / schema 16 includes the server, approved browser manager/player, native Android/Fire OS TV POC and subtitle/storage/recovery services. All six selected remaining bugs are fixed. Browser checks pass; native state/font/pairing checks have partial passing evidence. The owner deferred remaining emulator verification. Read [verification](VERIFICATION.md) for exact results and [differed](differed.md) for emulator, Windows Docker/Unraid, physical-device and human follow-ups.

See [Windows Docker acceptance](WINDOWS_DOCKER.md), [Unraid/TV pilot gates](PILOT_ACCEPTANCE.md) and [the 58-frame implementation inventory](DESIGN_COVERAGE.md) for the current delivery work.

[Differed: remaining device and deployment steps](differed.md) collects model/OS details, testing with the already-installed Windows Docker Desktop, actual Unraid/integrations, physical remote/display/spoken accessibility and longer representative-media checks.

## Choose a starting point

| Document                                              | What it explains                                                                                           | Primary reader                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| [Create your first channel](FIRST_CHANNEL.md)         | Browser steps from an empty server to a subscribed playable channel                                        | Household administrator               |
| [TV installation and connection](TV_INSTALLATION.md)  | Install the Bravia/Google TV or Fire OS client and pair it to Unraid; artifact availability and acceptance | Household setup and delivery owner    |
| [Supplied Figma handoff](DESIGN_REVIEW.md)            | Private review links, received design references and reconciliation with current APIs                      | Design and client developers          |
| [Overview and plan](MYTUNER_PLAN.md)                  | Product goals, boundaries, workstreams and follow-ups                                                      | Everyone                              |
| [Architecture and technology](ARCHITECTURE.md)        | Components, dependencies, startup, data flow and scaling                                                   | Engineering and technical reviewers   |
| [Database reference](DATABASE.md)                     | Every application table, relationships, migrations, persistence and retention                              | Backend developers and operators      |
| [Media discovery](MEDIA_DISCOVERY.md)                 | Sonarr, Radarr, custom directories, metadata, ordering and automatic additions                             | Product, backend and administrators   |
| [Audio and subtitle setup](SUBTITLES.md)              | Embedded/external tracks, naming, search locations, manual association and read-only mounts                | Administrators and viewers            |
| [Applications and user flows](APPLICATIONS.md)        | Server, browser manager/player, TV application and account/profile journeys                                | Product, design and client developers |
| [Scheduling and playback](SCHEDULING_AND_PLAYBACK.md) | Rotation state, commercials, revisions, clocks, delivery and subtitles                                     | Backend and player developers         |
| [Security and permissions](SECURITY.md)               | Roles, privacy, PINs, device scope, secrets and revocation                                                 | Engineering and administrators        |
| [Backend/API reference](BACKEND.md)                   | Setup, environment variables, route catalog, payloads and errors                                           | Client and API developers             |
| [Operational runbooks](OPERATIONS.md)                 | Startup, onboarding, refresh, storage, backups, restore and diagnosis                                      | Operators                             |
| [Docker and Unraid](DEPLOYMENT.md)                    | Image workflow, volumes, runtime identity and network boundary                                             | Deployment owners                     |
| [Development and testing](DEVELOPMENT.md)             | Source map, scripts, test strategy and contribution workflow                                               | Contributors                          |
| [Architecture decisions](DECISIONS.md)                | Accepted choices, tradeoffs and decisions still open                                                       | Technical reviewers                   |
| [Delivery checklist](CHECKLIST.md)                    | Implemented items and remaining acceptance gates                                                           | Delivery owner                        |
| [Design brief](DESIGN_BRIEF.md)                       | Figma assignment, screens, flows, focus and visual regression                                              | Design agent                          |
| [UI state evidence audit](UI_STATE_AUDIT.md)          | Executed browser/native screen, recovery, visual and accessibility scope                                   | Design and delivery reviewers         |
| [Verification record](VERIFICATION.md)                | Actual executed checks, evidence and limits                                                                | Reviewers                             |

- [Local UI and playback acceptance](LOCAL_ACCEPTANCE.md): concrete state/focus/visual and two-viewer media coverage, native baseline regions, reproducible modes and remaining human/device gates.
- [Open software and playback audit](OPEN_SOFTWARE_AUDIT.md): delivered audio/external subtitles/storage behavior, scoped local UI/client results and deferred emulator/target-host gates.
- [Documentation review and handoff readiness](DOCUMENTATION_REVIEW.md): three original audits plus the ninth round’s two focused reviewers, corrected onboarding/runbook gaps and remaining validation limits.
- [Selected improvement plan and status](SELECTED_IMPROVEMENTS.md): thirty-two selected proposals, implemented service/API/client work and remaining target-host/performance acceptance.
- [Expanded I47 metadata editing plan](METADATA_EDITING.md): channel details, source-aware show/movie/custom information and modal acceptance; implemented separate editors, descriptions, per-field choices, NFO mapping and guarded saves.
- [Selected improvement design handoff](SELECTED_DESIGN_BRIEF.md): self-contained Figma extension assignment and acceptance journeys.
- [Improvement research](IMPROVEMENTS.md): six earlier research rounds plus the ninth round’s feature/UI/UX pass, all 48 proposals, refinements, scope, effort and design needs.
- [Implementation review and priority register](IMPLEMENTATION_REVIEW.md): nine investigation rounds and P0–P3 decisions; the selected pilot-critical corrections are implemented; all six remaining findings are now selected and corrected under the final correction register.

## Read in sequence

For a team review, read the overview, architecture, applications, discovery, and architecture decisions. For implementation, continue with the database, scheduling/playback, security, and API reference. For setup, start with the TV installation guide, then read deployment and operational runbooks before touching real volumes. The Sony Bravia Android/Google TV experience is the primary target; Android-based Fire OS sticks are secondary.

The checklist records delivery status. The verification record records evidence. A design requirement or deployment command in these guides does not mean it has been exercised on a physical TV or Unraid system.

## Shared vocabulary

| Term                   | Meaning                                                                           |
| ---------------------- | --------------------------------------------------------------------------------- |
| Account                | Authenticated identity with admin, editor or viewer role                          |
| Profile                | Person or room with memberships, source grants, subscriptions and an optional PIN |
| Source                 | Existing read-only directory root with a declared media kind                      |
| Media item             | Database reference to one physical file; never an imported media copy             |
| Selection              | Rule identifying a whole show, season, folder, collection or explicit items       |
| Channel                | Stable ID and one continuous broadcast timeline shared by its viewers             |
| Subscription           | A profile's reference to a channel; grants no extra permissions                   |
| Programming            | Repeating groups, ordering and commercial rules for a channel                     |
| Revision               | Persisted version of a channel's programming/timeline                             |
| Program                | One scheduled airing, including its split content intervals and related breaks    |
| Entry                  | One uninterrupted program or commercial interval in a revision                    |
| Playback session       | One authenticated device's position and pause state                               |
| Authentication session | Browser, script or paired-device credential; separate from playback state         |
| Derivative             | Explicitly generated thumbnail, GIF or compatible conversion outside sources      |
| Cache                  | Disposable HLS, artwork and text subtitle outputs outside sources                 |

## Documentation boundaries and maintenance

These guides document the standalone implementation under `src/`. Root legacy investigation/deployment documents, `sidecar-generator/`, `private-channel-proxy/` and legacy Compose files preserve the earlier Plex/ErsatzTV POC. Do not use their sidecar-writing workflow for the read-only standalone library.

When changing behavior, update the relevant reference, checklist and verification evidence together. Keep runtime limits and route details tied to source; describe client or hardware work as pending until accepted. Never put credentials, personal paths, media or live database dumps into documentation examples.

[Browser and TV implementation, controls and build reference](CLIENTS.md) covers the delivered clients.
