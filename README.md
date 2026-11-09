# myTuner

A standalone personal TV network over existing read-only Unraid media. Manage programming in a browser and watch continuously scheduled channels on a browser/TV player. No Plex or ErsatzTV dependency.

**Current version: 0.2.0 POC.** The approved browser manager/player and native Android/Fire OS TV client are implemented. The server serves the browser at its root URL; a locally built, debug-signed TV APK is available under `android/app/build/outputs/apk/debug/app-debug.apk`. Browser/native verification is recorded in the checklist; actual Bravia/Fire OS and Unraid acceptance remain open. No store listing or published release is implied.

All six formerly deferred findings and backend/browser verification are complete. Native checks have partial passing evidence; remaining emulator verification was deferred at the owner’s request. [Verification](docs/VERIFICATION.md) records results, and [differed](docs/differed.md) records remaining emulator, device/model/OS, Windows Docker, Unraid, representative-media and human acceptance.

See [Windows Docker acceptance](docs/WINDOWS_DOCKER.md), [Unraid/TV pilot gates](docs/PILOT_ACCEPTANCE.md) and [the 58-frame implementation inventory](docs/DESIGN_COVERAGE.md) for the current delivery work.

## Start here

Open the [documentation index](docs/README.md) for the complete guide and recommended reading order.

- [Create your first channel](docs/FIRST_CHANNEL.md) — browser setup from an empty installation to watching
- [TV installation and Unraid connection](docs/TV_INSTALLATION.md) — Bravia/Google TV first, then Android-based Fire OS sticks
- [Supplied Figma handoff and reconciliation](docs/DESIGN_REVIEW.md)
- [Product overview and plan](docs/MYTUNER_PLAN.md) and [delivery checklist](docs/CHECKLIST.md)
- [Architecture and technology](docs/ARCHITECTURE.md) and [database reference](docs/DATABASE.md)
- [Media discovery: Sonarr, Radarr and custom directories](docs/MEDIA_DISCOVERY.md)
- [Audio and subtitle setup](docs/SUBTITLES.md) — embedded/external captions, search locations and manual associations
- [Browser/native implementation, builds and controls](docs/CLIENTS.md)
- [Applications and user journeys](docs/APPLICATIONS.md), including TV pairing/profile/PIN startup
- [Scheduling, commercials and playback](docs/SCHEDULING_AND_PLAYBACK.md)
- [Security and permissions](docs/SECURITY.md)
- [Backend/API reference](docs/BACKEND.md) and [development/testing](docs/DEVELOPMENT.md)
- [Operational runbooks](docs/OPERATIONS.md) and [Docker/Unraid setup](docs/DEPLOYMENT.md)
- [Architecture decisions](docs/DECISIONS.md), [Figma design brief](docs/DESIGN_BRIEF.md) and [verification evidence](docs/VERIFICATION.md)

## Try the local demo

With Node 24.13+ and FFmpeg/ffprobe installed:

```sh
npm ci
npm run dev:demo
```

Open `http://127.0.0.1:8788/` and sign in with **designer / synthetic-browser-password**. Choose **Living Room**, then **Watch TV → After School → Watch live**. This uses the real application with temporary SQLite and generated synthetic video; it does not require or connect to household services. Changes reset on restart, and Ctrl-C stops/cleans the demo. See [development](docs/DEVELOPMENT.md#local-demo-with-mock-data) for accounts, frontend hot reload and testing instructions.

## Local application

Requires Node 24.13+ within the Node 24 line and FFmpeg/ffprobe for scanning/generation.

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run test:smoke
```

Bootstrap an admin with `MYTUNER_ADMIN_PASSWORD` supplied through your shell environment, then run:

```sh
npm run admin:create -- your-admin-name
npm run dev
```

Open `http://127.0.0.1:8777/` for the browser manager; health is `/api/health`. No default account exists. See the backend guide for authenticated API usage. SQLite and generated outputs default to git-ignored `.data/`.

Node's built-in SQLite currently emits an experimental API warning on Node 24; the supported Node major is pinned and tests use real SQLite.

## Legacy POC

The root INVESTIGATION.md, DEPLOY_UNRAID.md, ERSATZTV_SETUP.md, sidecar-generator/, private-channel-proxy/, docker-compose.legacy.yml, and .env.legacy.example preserve the earlier Plex/ErsatzTV approach. They are historical, not standalone deployment instructions. The legacy chapter generator writes sidecars and must not be run against the standalone read-only source library.
