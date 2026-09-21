# myTuner — Feasibility Investigation

Personal "TV network" simulator for home/coworker use. This file tracks the investigation
(problem definition, research findings, open decisions) before any implementation starts.
The **Plan** section below is the current, actionable summary; everything after it is the
research trail/evidence that plan is built on — kept for reference, not superseded.

## Plan (as of 2026-09-20)

### Architecture summary

Adopt **ErsatzTV** (open source, self-hosted "fake IPTV" engine) as the core of the
system instead of building a custom playout/streaming engine or a custom HDHomeRun tuner
emulator. It already natively provides: local-folder library scanning (no reorganizing
needed), multiple independent channels with independent schedules, filler/commercial
insertion (between and, via a small trick below, within episodes), random/shuffle
content ordering, movie support, and Plex Live TV & DVR tuner-emulated integration. The
only custom pieces are a small sidecar-file generator script and a small reverse-proxy
config for the one private channel — everything else is configuration inside ErsatzTV's
and Plex's existing UIs.

```
                    ┌─────────────────────────┐
  Existing library  │        ErsatzTV          │        Plex Live TV & DVR
  (untouched,       │  - local libraries        │───────▶ (shared channels,
  read-only mount)  │  - channels + schedules    │         watched via Plex app
  ─────────────────▶│  - filler presets          │         on the TV device)
                    │  - HDHomeRun tuner emulation│
  chapter sidecar   │  - direct per-channel URLs  │
  generator script  └─────────────┬────────────┘
  (writes .xml       ▲             │
   next to files,     │             │ direct URL (private channel only)
   custom code)       │             ▼
                       │      ┌─────────────────────┐
              "commercials" &  │  small reverse proxy │──▶ TiviMate/VLC on the
              "private" pools  │  (token-gated path)  │    same TV device
                               └─────────────────────┘
```

### Components — custom code (small)

1. **Chapter-sidecar generator script** — walks the shared-content directories
   (read-only; never modifies/moves/renames anything existing), runs `ffprobe` per file
   to get real duration, computes one or more split points (config: fixed percentage,
   random-within-a-range percentage, or an explicit list), and writes a Matroska-style
   chapter XML sidecar (`<basename>.xml`) next to each file describing contiguous
   segments (e.g. `0→split1`, `split1→end`). Idempotent — skips files that already have
   a sidecar unless a `--regenerate` flag is passed. Ends with one HTTP call to
   ErsatzTV's API to trigger a library rescan, since chapters are only read at scan
   time. This is the only real "application" being written.
   - **Effort**: small — a few hours including testing. No database/state needed
     beyond "does the sidecar file already exist."
   - **Storage**: negligible. Each sidecar is roughly a few hundred bytes to ~1–2 KB.
     Even across a library of thousands of episodes, total added storage is
     single-digit MB — nothing next to the video files themselves.
2. **(Optional) scheduled regeneration job** — a cron-style wrapper around the generator
   if per-*play* (not just per-episode) variety in break timing is wanted later (see
   open item below). Genuinely optional — every episode already gets its own
   independently-chosen break point from the base generator with no extra job; this
   only addresses the same episode re-airing at the identical spot every time it
   repeats in a channel's rotation. Whether that matters depends on how often content
   repeats relative to library size.
   - **Effort**: small, on top of the generator that already exists — reuses the same
     script, run on a schedule (cron / Unraid User Scripts) with `--regenerate`,
     followed by the same rescan API call.
   - **Nuance**: if ErsatzTV has already built a playout for the near future before
     regeneration runs, that pre-built slot keeps its old break point — new chapter
     data only affects the *next* time that file gets scheduled, not instantly.
3. **Private-channel reverse proxy** — nginx or Caddy container/config that only
   forwards requests carrying a long random token in the URL path to ErsatzTV's direct
   per-channel stream endpoint; everything else gets rejected. Config, not really code
   (~20 lines).

### Components — configuration only (existing tools, no code)

1. **ErsatzTV**: local libraries pointed at the existing Shows/Movies directories and at
   the separate private-content directory; channels; Classic schedules; Filler Presets
   (Pre-Roll/Post-Roll for between-episode commercials, Mid-Roll for within-episode,
   both with Count/Duration caps); a "commercials" collection set to Random or Shuffle
   order; the private channel's schedule set to Random/Shuffle with no filler.
2. **Plex**: one-time Live TV & DVR setup pointing at ErsatzTV's emulated tuner + XMLTV
   guide URL — this is what makes the shared channels show up in Plex's own grid.
3. **TiviMate or VLC** on the Fire TV/Shield/Chromecast-with-Google-TV device: add the
   private channel's token URL once, as a second app alongside Plex.

### Disabling commercials

Config-only, no code/deploy change: detach a schedule item's Pre-Roll/Post-Roll Filler
Preset to disable between-episode commercials, or detach the Mid-Roll Filler Preset to
disable within-episode breaks (chapter sidecars can stay in place harmlessly — a
Mid-Roll preset is what actually triggers a break, not the chapter data alone). Takes
effect on next playout build. Could keep two schedule variants (with/without
commercials) and swap which one a channel uses at will.

### Unraid Community Applications / WebUI integration

ErsatzTV has an **official Unraid Community Applications template** — one-click install
from Unraid's Apps tab, shows up as a tile on Unraid's Docker page with a clickable
WebUI icon opening ErsatzTV's own config UI (port 8409), same as Plex or any other
installed app. Includes hardware-transcode branch options (vaapi/nvidia).
Source: https://ca.unraid.net/apps/ersatztv-1xab4v601e6jv2, https://ersatztv.org/docs/installation/advanced/unraid/

This CA/WebUI convenience is specific to ErsatzTV. The sidecar-generator script (no UI —
a batch job) and the private-channel reverse proxy (no admin UI — just the token URL)
have no official templates and would be added as manual Docker containers on Unraid.

### Unraid mount strategy

Unraid mounts each array disk individually (`/mnt/disk1`, `/mnt/disk2`, ...) — each shows
only what's physically on that disk. A **User Share** (`/mnt/user/<share>/...`) is a FUSE
overlay that merges a share's files across every disk *and* the cache pool into one
stable view, and is the only path that stays correct as Unraid's mover relocates files
between disks over time.

- **All bind mounts target `/mnt/user/<share>/...`** — never `/mnt/diskN/...` or
  `/mnt/user0` (which deliberately excludes cache). Targeting a specific disk would
  silently miss files that live elsewhere and break whenever the mover shuffles things.
- **Split read/write access by component**:
  - ErsatzTV's container: media share mounted **read-only** (`:ro`) — it only ever
    reads video files + sidecar XMLs, never writes into the library.
  - The sidecar-generator script/container: same share mounted **read-write**, since
    it's the only thing that writes the small `.xml` sidecars.
  - The private-channel reverse proxy: no media mount at all — HTTP-only, proxies to
    ErsatzTV.

### Step-by-step implementation plan

1. Deploy ErsatzTV in Docker (locally first if Docker gets installed, to iterate faster;
   otherwise directly on the Unraid box) — mount the existing media directories
   read-only.
2. Add local libraries in ErsatzTV pointed at the existing Shows/Movies directories.
3. **Live functional test** (still outstanding from investigation): hand-write one
   chapter XML sidecar for a real sample file, confirm ErsatzTV's scanner picks it up
   and a Mid-Roll filler preset cuts at the expected point. Do this *before* writing the
   generator script, to validate the mechanism end-to-end on real data.
4. Build the chapter-sidecar generator script; dry-run it (print planned split points
   without writing files) across the real library first, review, then let it write.
5. Assemble a "commercials" pool (short clips) as its own ErsatzTV collection.
6. Configure the shared channel(s): schedule, Filler Presets (pre/post-roll and
   mid-roll), and count/duration caps.
7. Set up Plex Live TV & DVR pointing at ErsatzTV; verify a shared channel plays
   correctly through the Plex app on the actual TV device.
8. Set up the private library + channel (Random/Shuffle schedule, no filler).
9. Deploy the reverse-proxy container with the token-gated path for the private
   channel's direct stream URL.
10. Install TiviMate (or VLC) on the TV device, add the private channel's token URL
    once, verify playback.
11. (Optional, later) add scheduled sidecar regeneration if per-play break variety is
    wanted.

### Testing / verification plan

- Step 3's hand-written sidecar test is the load-bearing validation — confirms the core
  mechanism before any generator code exists.
- Spot-check a sample of generator-written sidecars (valid XML, split points match the
  configured percentage/randomization rule) after step 4.
- End-to-end on the real TV: a shared channel shows a mid-show break near the expected
  point and resumes cleanly; between-episode commercials play and respect the
  configured cap; two channels run independently/simultaneously without interfering.
- Private channel: token URL works in TiviMate/VLC; a wrong or missing token is
  rejected by the reverse proxy.

### Rollout plan

- Start with one shared channel and a small content sample before pointing the
  generator at the whole library.
- Add remaining channels/schedules incrementally once the first one is verified
  end-to-end on the TV.
- Build the private channel last — it's independent of the shared setup and has no
  dependency on the sidecar generator at all.

### Open items carried into implementation

- [x] **Sidecar files landing in the existing media folders** — Allan confirmed fine
      (addition alongside each source video, nothing existing modified).
- [ ] **Live functional test is still unverified** (step 3) — everything to date is
      based on reading ErsatzTV's source, not watching it run. **Deferred — Allan will
      test this later**, not abandoned; needs Docker locally, direct access on the
      Unraid box, or another environment with Docker/dotnet.
- [ ] **Per-play break-time variety vs. per-episode variety**: default plan gives each
      episode its own fixed (but possibly randomized-at-generation-time) break point,
      which stays the same on every replay of that episode. The optional scheduled
      regeneration job (component 2 above) addresses this — still undecided whether to
      include it for MVP or add later; low effort either way since it reuses the base
      generator.

## Implementation progress

Repo now has a real structure — see `README.md` for layout/deploy steps. Built so far
(autonomous session, 2026-09-20):

- **Chapter-sidecar generator** (`sidecar-generator/generate_chapters.py` +
  `test_generate_chapters.py`, 24 tests, all passing). Covers: fixed-percent and
  random-percent split-point selection, multi-break spacing, contiguous chapter-segment
  construction, Matroska chapter XML shape (matched against what ErsatzTV's
  `LocalChaptersProvider` actually parses), sidecar idempotency (skip/regenerate),
  `ffprobe` failure handling, and now the rescan-trigger HTTP call to ErsatzTV's API
  after a run — confirmed the real endpoint (`POST /api/libraries/{id}/scan`) and API
  key header (`X-Etv-Api-Key`) directly from ErsatzTV's source
  (`ErsatzTV/Controllers/Api/LibrariesController.cs`,
  `ErsatzTV.Core/Security/ApiHelper.cs`), not guessed. Rescan only fires when something
  was actually written and it's not a dry run.
  - Still unverified: real `ffprobe` behavior against actual video files — this Mac has
    no `ffmpeg` installed, so tests mock it. Deferred, per Allan, to testing later on
    Unraid (or with `ffmpeg` installed locally).
- **`sidecar-generator/Dockerfile`** — `python:3.12-slim` + `ffmpeg` (for `ffprobe`);
  the script itself has no dependencies beyond the stdlib.
- **`private-channel-proxy/Caddyfile`** — token-gated reverse proxy for the private
  channel, proxying ErsatzTV's whole `/iptv/` path space (not just the single `.m3u8`
  entry point) under the secret-token prefix.
  - **Open risk, explicitly flagged in the file itself**: HLS playlists reference
    further segment files, and it's unverified whether ErsatzTV's manifest ever emits
    fully-qualified URLs pointing directly at itself (which would let a player bypass
    this proxy). Confirm during the live functional test.
- **`docker-compose.yml`** / **`.env.example`** / **`.gitignore`** — deployment
  scaffold wiring ErsatzTV + the proxy + the (on-demand, not always-running) generator
  together, following the documented Unraid mount strategy (ro for ErsatzTV, rw for the
  generator, `/mnt/user/...` paths). Confirmed the actual published ErsatzTV image
  (`ghcr.io/ersatztv/legacy`) from its own `.github/workflows/docker.yml` rather than
  guessing — an earlier draft had the wrong image name (a Docker Hub guess) before
  checking.
- **`README.md`** — deploy steps and repo layout, separate from this file's
  research/rationale trail.

### What's still genuinely manual (can't be automated from this machine)

- ErsatzTV's own library/channel/schedule/filler-preset configuration — done through
  its web UI once it's actually running. **Step-by-step walkthrough now written up in
  `ERSATZTV_SETUP.md`**, with real page routes confirmed from ErsatzTV's own source
  (`ErsatzTV/Pages/*.razor`) rather than guessed — initially left undocumented (just
  "configure it in the UI"), which wasn't good enough; fixed after Allan called it out.
  Exact field labels inside each page are still unverified (no running instance to look
  at), flagged as such in that file.
  - Also corrected in this pass: `.env.example` originally guessed the API key lived in
    a Settings page — actually verified from source it's auto-generated on first run
    into `api-secrets.json` in ErsatzTV's config folder, no UI page for it at all.
- Assembling the real "commercials" content pool and the private channel's content —
  Allan's own media files, not something writable from here.
- **`DEPLOY_UNRAID.md`** now written (Allan asked directly whether this existed — it
  didn't, `README.md` had assumed a plain Linux box with `docker compose` just
  available, which isn't how Unraid works without an extra plugin). Covers: enabling
  Docker, the two real paths to run this (Docker Compose Manager plugin vs. adding each
  container by hand through Unraid's native Add Container form, with the generator run
  via the User Scripts plugin or a manual `docker run` since it's not a long-running
  service), and — the actual "endpoint" question — that bridge networking means every
  container's port lands on the Unraid server's own IP directly
  (`http://<unraid-ip>:8409` for ErsatzTV, `https://<unraid-ip>:8443/private/<token>/...`
  for the private channel), plus the one real gotcha: `ERSATZTV_UPSTREAM=http://ersatztv:8409`
  only resolves under Compose's shared network — the manual/no-plugin path needs the
  server's real LAN IP instead.
- Plex Live TV & DVR setup pointing at ErsatzTV (one-time, in Plex's own settings).
- Installing TiviMate/VLC on the TV device and adding the private channel's URL.
- The live functional test itself (deferred, as agreed).

## Goal / MVP requirements

- Read an **existing** media directory + subdirectory structure as-is — no reorganizing,
  renaming, or restructuring the user's existing library layout.
- **Channels**: multiple independent channels, each with its own programming playlist.
- **Playlists**: continuous linear playback (not on-demand browsing) — content plays in order
  per a configured "programming" playlist.
- **Commercial breaks**: a random, shorter video plays:
  - between two videos in the playlist, AND
  - **in the middle of a single video** (interrupts playback mid-show, then resumes).
  - Both behaviors must be **configurable in the UI**.
- **Playback surfaces**:
  1. A stream/output that can play on an actual TV.
  2. A management UI for configuring channels/playlists.
  3. The UI itself should also be usable to watch through (not just configure).
- Other features exist beyond this but are out of scope for MVP.

## Research findings

### Existing OSS prior art (ErsatzTV, Tunarr, dizqueTV)

These tools already implement the "fake IPTV / channelized personal streaming" category:
scan a media library, build channels with scheduled playlists, inject filler/commercial
clips, expose the result as a stream (HDHomeRun emulation / M3U+EPG / HLS) that Plex,
Jellyfin, VLC, or a smart TV app can tune into.

- **ErsatzTV**: supports local library scanning with no Plex/Jellyfin dependency
  (Media → Add Libraries → point at local folders); reads NFO metadata, falls back to
  filename parsing. TV show libraries expect show/season subfolder conventions
  (`Show/Season 01/Show - S01E01.mp4`); has an "Other Videos" library type for
  non-episodic content that doesn't require that convention.
  - Supports Filler content with Pre-Roll / Mid-Roll / Post-Roll / Fallback kinds, and
    Count / Duration / Pad modes.
  - **Mid-roll filler is distributed *between chapter markers embedded in the file*.**
    This is a hard requirement in ErsatzTV's current implementation — it computes
    mid-roll cut points at schedule-generation time by reading existing chapter data.
    Most home/downloaded video won't have chapters, so mid-show interruption would NOT
    work out of the box on this library.
  - Sources: https://ersatztv.org/docs/lists/filler/, https://ersatztv.org/docs/media/local/,
    https://ersatztv.org/docs/media/local/shows/

- **Tunarr**: same category, generally considered a more polished/friendlier UI than
  ErsatzTV. Also supports mid-roll breaks, configured per-slot in the Slot/Time Slot
  editor, but **also implemented as filler "between chapters within each media item"**
  — same chapter-dependency limitation as ErsatzTV.
  - Sources: https://tunarr.com/configure/scheduling/mid-roll-breaks/,
    https://tunarr.com/configure/library/filler/

- **dizqueTV**: predecessor/older project in this space, largely superseded by Tunarr;
  not investigated in depth since Tunarr covers the same ground with more active
  development.

### Key technical finding: chapter dependency is a design choice, not a hard limit

ErsatzTV/Tunarr require chapters because they pre-compute mid-roll insertion points at
**schedule-generation time** by reading a file's existing chapter markers. That's a
limitation of those two tools' scheduling model, not a fact about video playback.

**Proposed alternative (Allan's idea, confirmed technically sound):** a live playout
process can interrupt playback without any chapter data at all:

1. Start streaming video A from disk via `ffmpeg` (no file modification).
2. At a random point (chosen when the item starts, or live), stop reading video A and
   record the exact timestamp.
3. Stream the "commercial" clip.
4. Resume video A via `ffmpeg -ss <saved timestamp>`, seeking to that exact point and
   continuing.

This requires **zero chapter markers and zero file modification** — a better fit for the
"read as-is" requirement than any chapter-injection workaround. It's a standard, well
understood `ffmpeg` seek/concat pattern, not exotic.

### Environment answers (confirmed with Allan)

- Media server on Unraid: **Plex** (already running).
- TV playback path: **Plex Live TV & DVR tuner emulation** — ErsatzTV/Tunarr can emulate
  an HDHomeRun tuner; Plex detects it as a live channel source (Plex doesn't accept
  arbitrary M3U sources directly, but does support HDHomeRun-style tuners), so the
  channel(s) show up in Plex's own Live TV grid on whatever Plex app is already on the
  TV — no new app/client needed.
  - Caveat: Plex Live TV & DVR only supports **one tuner/guide source at a time**. If
    Allan ever adds a real OTA/HDHomeRun tuner to Plex, it would conflict with this
    setup (workaround exists: separate Plex instance per source, but adds complexity).
  - Source: https://discuss.ersatztv.org/d/82-plex-live-tv-dvr-setup,
    https://ersatztv.org/docs/clients/plex/

### Re-examining build vs. adopt: ErsatzTV Scripted Schedules

Found that ErsatzTV has a **Scripted Schedule** mechanism (formerly "YAML schedules"):
ErsatzTV's playout builder can invoke an **external script**, passing it the API host,
a build id, build mode (reset/continue), and custom arguments. The script then drives
playout construction via ErsatzTV's own OpenAPI. This means custom per-item logic
(e.g., "trim item A to a random duration, insert filler, then continue item A") may be
buildable **on top of** ErsatzTV's existing engine (tuner emulation, ffmpeg transcoding,
Plex integration) instead of writing a full custom playout/streaming engine from scratch.

Confirmed so far:
- Duration-based scheduling instructions support **trim** — if an item doesn't fit the
  remaining duration budget, ErsatzTV will cut its end short to fit exactly.
- **Not yet confirmed**: whether an item can be resumed from an arbitrary **start**
  offset (i.e., play item A from 14:32 to end, as a second segment) — this is the piece
  that would complete "interrupt mid-show, then resume where it left off" entirely
  within ErsatzTV's own engine. Trim alone only cuts the tail; it's unclear from docs
  search whether an in-point/seek-start parameter exists per playout item.
- Sources: https://ersatztv.org/docs/scheduling/scripted/,
  https://ersatztv.org/docs/scheduling/sequential/playout/,
  https://ersatztv.org/docs/scheduling/classic/items/,
  https://github.com/VaultDweller39/etv-yaml-playouts (community-maintained YAML
  playout examples, not official docs — treat as reference, not source of truth)

**This needs a hands-on spike, not more doc-search** — the OpenAPI spec is served live
by a running ErsatzTV instance, and is the authoritative source for whether a start-offset
parameter exists. Next concrete step: stand up ErsatzTV in Docker (matches the eventual
Unraid deployment target) and inspect its live OpenAPI spec / try a Scripted Schedule
against a couple of real files.

**Update — resolved via source inspection (Docker not available on this machine, so read
the actual ErsatzTV source instead of a live spike; cloned https://github.com/ErsatzTV/legacy
shallow into scratchpad and grepped it):**

- `ErsatzTV.Core/Domain/PlayoutItem.cs` — the core domain model already has **both**
  `InPoint` and `OutPoint` (`TimeSpan`), not just an end-trim. `ForChapter()` builds one
  `PlayoutItem` per chapter, setting `InPoint`/`OutPoint` from `chapter.StartTime`/
  `EndTime`. So the underlying engine already natively supports "play this file from X to
  Y" — the chapter-based mid-roll UI is just one way of populating those fields.
- **However**, the public Scripted Schedule API (`ErsatzTV.Core.Nullable/Api/ScriptedPlayout/*`,
  e.g. `PlayoutDuration.cs`) only exposes `Trim` (cut the **end** to fit a duration budget)
  and `ControlSkipItems` (skip whole items) — **no arbitrary start-offset/in-point
  parameter is exposed to scripts.** So driving arbitrary mid-item resume points through
  the Scripted Schedule mechanism directly isn't available as documented/public API.
- **The actual unlock: external chapter sidecar files.** `ErsatzTV.Scanner/Core/Metadata/LocalChaptersProvider.cs`
  looks for a file next to the source video with the **same base filename** and extension
  `.xml` (Matroska-style chapter XML) or `.chapters`, and parses chapter markers from it —
  **it never reads or writes the video file itself.** Confirmed this runs automatically as
  a normal part of every **local library** scan (television/movie/other-video/music-video
  folder scanners all call `_localChaptersProvider.UpdateChapters` per item) — not a
  special/manual step, and not tied to Plex/Jellyfin/Emby.
- **This means:** we can write a small standalone script that walks the existing
  directory (completely untouched/unmodified), and for each video, writes a small
  sidecar `<basename>.xml` file (e.g. `Episode.xml` next to `Episode.mp4`) containing one
  or more chapter markers at whatever split point(s) we choose (random offset, evenly
  spaced, etc.) — with **zero modification of any existing file**, no re-encode, no
  embedded-chapter dependency. Point ErsatzTV's local library scanner at the real
  directory, configure a Mid-Roll Filler preset (already a native, UI-configurable
  ErsatzTV feature) referencing a "commercials" collection, and ErsatzTV's existing
  engine — scheduling, ffmpeg transcoding, HDHomeRun tuner emulation for Plex — handles
  everything else natively. **No custom playout/streaming engine or custom tuner
  emulator needed.** The only custom code is the chapter-sidecar generator.
- One real wrinkle: the sidecar file is looked up in the **same folder as the source
  video** (`Path.GetDirectoryName(mediaItemPath)`), not a separate/central location —
  so this does mean *adding* a new small file into Allan's existing media folders
  (never modifying/renaming/moving anything that's already there). Need to confirm
  this is acceptable given the "read directories as-is" requirement — it's an addition,
  not a mutation, but worth explicit sign-off before building the sidecar generator.
- Sources (read directly from https://github.com/ErsatzTV/legacy, commit at time of
  investigation): `ErsatzTV.Core/Domain/PlayoutItem.cs`,
  `ErsatzTV.Core.Nullable/Api/ScriptedPlayout/PlayoutDuration.cs`,
  `ErsatzTV.Core.Nullable/Api/ScriptedPlayout/ControlSkipItems.cs`,
  `ErsatzTV.Scanner/Core/Metadata/LocalChaptersProvider.cs`,
  `ErsatzTV.Scanner/Core/Metadata/TelevisionFolderScanner.cs` (+ Movie/OtherVideo/MusicVideo
  equivalents).
- **Still not done: a live end-to-end functional test** (actually running ErsatzTV against
  a couple of real sample files + a hand-written chapter sidecar, confirming Mid-Roll
  filler cuts exactly where expected). Source reading confirms the mechanism exists and
  is wired up; it does not substitute for seeing it actually work. Docker is not
  installed on Allan's Mac, so this needs either installing Docker locally, testing
  directly on the Unraid box, or another environment.

## Build vs. adopt tradeoff (open)

Because:
- the mid-show interrupt behavior isn't exposed as a config option in ErsatzTV/Tunarr
  (their scheduling is pre-computed, not live-interrupt-based), and
- the MVP already requires a custom playlist-management UI *and* an in-app watch
  experience (requirement 3 above),

...this project leans toward **building a small custom playout/orchestration service**
(channel engine: playlist + randomized interrupt + `ffmpeg`-driven splice + HLS output)
rather than purely configuring an existing tool. Still to decide:

- [x] Confirm target TV playback mechanism → **Plex Live TV & DVR tuner emulation**.
- [x] Confirm whether Plex/Jellyfin is already running on the Unraid box → **Plex, yes**.
- [x] Confirm existing directory structure shape → **TV-style Show/Season/Episode**,
      matches ErsatzTV's native local-library convention directly.
- [x] Resolved via source inspection: mid-show interrupt is achievable **without any
      custom playout engine**, via external chapter sidecar files + ErsatzTV's existing
      Mid-Roll Filler feature. See finding above.
- [ ] Confirm whether writing small sidecar files into the existing media folders
      (alongside originals, nothing existing modified) is acceptable — the one wrinkle
      in an otherwise "adopt ErsatzTV as-is" plan.
- [ ] **Live functional test** (blocked on Docker locally): actually run ErsatzTV
      against sample files + a hand-written chapter sidecar to confirm Mid-Roll filler
      cuts exactly at the expected point. Needs Docker locally, direct test on the
      Unraid box, or another environment with Docker/dotnet available.
- [ ] Deployment: Docker container on Unraid (confirmed requirement, not yet designed;
      much simpler now — likely just the official ErsatzTV image + our sidecar-generator
      script, not a custom app).

## Additional feature check (2026-09-20)

Allan asked about a batch of additional features. Status of each, based on ErsatzTV's
documented/source-confirmed behavior:

| Feature | Status | Notes |
| --- | --- | --- |
| Fully custom schedule, easy to update | **Yes** | ErsatzTV "Classic" schedules: add/reorder/edit schedule items through its own web UI, no YAML/scripting required. (Sequential/YAML and Scripted schedules exist too, for more advanced cases — not needed for MVP.) |
| Multiple channels | **Yes** | Each channel gets its own number, name, logo, and its own independent Playout/schedule. Confirmed no shared-state constraint between channels. Source: https://ersatztv.org/docs/user-guide/create-channels/, https://ersatztv.org/docs/scheduling/playouts/ |
| Commercials between episodes | **Yes** | Native Pre-Roll/Post-Roll filler, or just schedule-item ordering. |
| Commercials within episodes, at custom or random intervals | **Yes, via the sidecar-chapter approach already found** | We control exactly where the chapter split points go when generating the sidecar file, so both "custom" (fixed offsets we choose) and "random" (randomized at generation time) intervals are supported — this is on our generator script, not a native ErsatzTV UI setting. |
| Play movies | **Yes** | ErsatzTV has a native Movie library type (`MovieFolderScanner`), same chapter-sidecar mechanism applies. |
| Commercials picked at random | **Yes** | Collections (including filler collections) support **Random** (random order, may repeat) or **Shuffle** (random order, no repeat until the pool is exhausted) — both are existing config options, not something we'd build. |
| Manage shows/commercials/channels — is it within Plex? | **No — separate ErsatzTV web UI** | All library scanning, channel creation, schedule/playlist editing, and filler/commercial configuration happens in ErsatzTV's own web UI (its own port, e.g. `:8409`), completely separate from Plex's settings. Plex's only role is: (1) a one-time DVR/tuner setup pointing at ErsatzTV, and (2) where people actually watch (Live TV grid). |

### Open limitation: private / per-user channels

Investigated whether a channel could be restricted to one specific person, or whether
programming could vary by which user is watching.

- Plex's **Live TV & DVR access** is an **all-or-nothing per managed user** toggle
  (Settings → Plex Home → managed user → Restrictions → Live TV & DVR Access): a user
  either can or cannot see Live TV at all. There is no per-channel visibility control
  within that grid — every channel from the configured tuner source is visible to
  everyone who has Live TV access. Source: https://support.plex.tv/articles/204232573-restricting-the-shares/,
  https://forums.plex.tv/t/live-tv-for-managed-users/915844
- Compounding this: Plex Live TV & DVR only supports **one tuner/guide source at a
  time** (noted earlier), so there's no native way to give different users access to
  different subsets of ErsatzTV channels via Plex itself.
- **So: true "private channel, visible to only one person" is not achievable through
  Plex's Live TV integration.** Two real alternatives if this matters:
  1. **Accept the limitation** — all channels are visible to everyone with Plex Live TV
     access (which itself can still be toggled on/off per managed user, just not
     per-channel). Simplest, zero extra build.
  2. **Bypass Plex for the "private" channel(s)** — serve that channel's stream
     directly via its own URL (ErsatzTV can expose a direct HLS link per channel outside
     the Plex tuner path) and gate access with a lightweight auth layer (e.g. a simple
     per-person password or link) we'd build ourselves. This is a modest addition (a
     small auth/gateway layer), not a large one, but it is custom scope, and that
     channel would be watched outside Plex's UI (a browser or a simple player pointed
     at the URL) rather than inside Plex's Live TV grid.
- "Custom programming based on user" (i.e., the same channel showing different content
  depending on who's watching) isn't something Plex Live TV or ErsatzTV support at all —
  a live broadcast-style channel has one stream, the same for every viewer at any given
  moment. The closest equivalent is: give that person their own dedicated channel with
  its own schedule (fully supported), rather than one channel that behaves differently
  per viewer.

## Follow-up detail (2026-09-20, cont'd)

### Mid-roll timing: percentage-based & randomized per episode

Since the chapter sidecar is generated by our own script (not an ErsatzTV feature), we
have full control over where the split point(s) go — this isn't limited to a fixed
timestamp:

- **Percentage-based** ("after 16% of the video"): trivial — `ffprobe` gives us the
  file's real duration, so `split_time = duration * 0.16` per file. Works for movies and
  episodes of any length without hardcoding minutes.
- **Randomized per episode**: also trivial — since each file gets its own
  independently-generated sidecar, each episode/movie can get its own independently
  randomized split point (e.g., uniformly random between 20%–80% of runtime). Different
  episodes will naturally land on different break points.
- **Important nuance**: a chapter split point is static file metadata, read once at
  scan time and stored in ErsatzTV's database — it does **not** get re-randomized on
  every individual playback of that same episode. If Allan wants the *same* episode to
  break at a *different* point each time it re-airs (not just each episode having its
  own point), that requires periodically regenerating the sidecar file and triggering a
  rescan (e.g., a nightly job) — easy to add, but is a scheduled task, not a live/instant
  decision at play time. Worth confirming whether per-episode variety is sufficient, or
  per-play-instance variety is actually wanted.

### Capping commercial count (within and between episodes)

Fully native to ErsatzTV's existing Filler Preset UI — **no custom code**:

- **Within an episode**: the *number of break points* is controlled by how many chapter
  splits we put in the sidecar (we decide — e.g. exactly 1 or 2 per file). The *number of
  commercials played at each break* is capped by the Filler Preset's **Count** mode
  (e.g. `Count: 1` = exactly one commercial per break) or **Duration** mode (time-boxed
  instead of count-boxed) — both are just fields in ErsatzTV's Filler Preset editor.
- **Between episodes**: same mechanism via Pre-Roll/Post-Roll Filler Preset Count/
  Duration mode.
- So both caps are just configuration values in ErsatzTV's UI, not something we'd build.

### Private channel — effort estimate

Confirmed ErsatzTV exposes a **direct per-channel stream URL**, independent of the Plex
tuner integration entirely (e.g. `http://<host>:8409/iptv/channel/1.m3u8`) — this is how
ErsatzTV supports VLC/Kodi/any IPTV client without Plex at all.
Source: https://mintlify.wiki/ErsatzTV/ErsatzTV/api/iptv, https://ersatztv.org/docs/user-guide/configure-clients/

This means a private channel needs **no custom application code** — just a small
reverse-proxy (nginx or Caddy) in front of that one channel's direct URL, gated by HTTP
Basic Auth or a shared token in the URL, running as one more lightweight container
alongside ErsatzTV on Unraid.

**Effort: small — config, not software.** Roughly:
- Write a ~20-line Caddyfile/nginx config gating that one channel's path.
- Add the container to the Unraid Docker stack.
- Test auth + playback.

Realistically an hour or so of setup, not a build project, and nothing ongoing to
maintain beyond that config file.

**The real tradeoff isn't effort, it's UX**: that private channel is watched via a
direct URL (VLC, a browser, or any IPTV-capable app that accepts a username/password on
an M3U/stream URL) — it will **not** appear inside Plex's own Live TV grid, since the
whole point is bypassing Plex's all-or-nothing access model. On a smart TV this means
using whatever app can open an authenticated stream URL, rather than the Plex app people
already use for the shared channels.

## Private channel — clarified requirement (2026-09-20, cont'd)

Allan confirmed: the private channel should stay **live** (not a pre-rendered/recorded
file in a private Plex library — ruled out, since Live TV access isn't scoped by
underlying library membership in Plex; see finding above), and does **not** need
commercial support at all — just random videos from a private library/directory,
playing continuously, live-TV style.

This simplifies the private channel considerably vs. the shared channels:

- **No chapter sidecar generation needed for this channel's content** — skip mid-roll
  entirely for it.
- Point a separate ErsatzTV local library at the private directory, create a dedicated
  channel + schedule using **Shuffle or Random order** (already-confirmed native
  ErsatzTV collection feature) over that library — this alone gives "random videos,
  live-TV style, always something playing."
- Access control still needs to bypass Plex (per the finding above — Live TV access
  can't be scoped to one user), so this channel is reached via ErsatzTV's **direct
  per-channel stream URL** (e.g. `http://host:8409/iptv/channel/N.m3u8`) behind a small
  auth proxy (nginx/Caddy, basic auth or token) — same low-effort approach as before
  (~an hour of config, not a build). It stays a real live 24/7 channel; it's just
  watched via a direct authenticated link/app instead of Plex's Live TV grid.

## Private channel — watching on the actual TV (2026-09-20, cont'd)

Clarified misunderstanding: "watched via a direct URL" does **not** mean stuck on a
phone/laptop browser — it means a different **app** opens the stream, and that app runs
on whatever's connected to the TV, same as Plex does today.

- Confirmed Allan's TV device: **Fire TV / Nvidia Shield / Chromecast with Google TV**
  (all full Android TV-based, open app ecosystem) — the best case for this. These
  support installing a proper IPTV player (e.g. **TiviMate** — purpose-built for exactly
  this: point it at an M3U/XMLTV URL, get a normal channel-guide UI, full-screen
  playback) or plain **VLC**, alongside the existing Plex app. The private channel would
  show up as its own app/channel entry on the same device — a second icon next to Plex,
  not a different piece of hardware.
- **Design refinement based on this**: prefer a **token embedded in the stream URL**
  itself (e.g. `https://host/<random-token>/channel.m3u8`) over HTTP Basic Auth for the
  private channel's auth proxy. A TV remote is painful for typing a username/password;
  a token-in-URL only needs to be entered once, when adding the stream URL to
  TiviMate/VLC's "add playlist" field — after that it just works like any other channel,
  no repeated login. Basic Auth would work too but is worse UX given remote-based text
  entry.
- Net result: **both the shared channels (via Plex's Live TV app) and the private
  channel (via TiviMate/VLC with a token URL) play on the same physical TV**, through
  two different apps on the same device already sitting there.

## Next steps

- Get answers to the open decision points above.
- If custom build direction is confirmed: sketch a minimal architecture (library scanner,
  channel/playlist data model, playout engine, HLS output, management UI, watch-through
  player) before writing code.
