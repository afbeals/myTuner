# myTuner

A personal "TV network" for an existing media library, running on Unraid: multiple
live channels with configurable commercial breaks (between and within episodes),
plus one private channel visible only to one person.

Built on [ErsatzTV](https://github.com/ErsatzTV/legacy) rather than a custom
streaming engine — see `INVESTIGATION.md` for the full research trail and the reasoning
behind every design decision below.

## Layout

- `INVESTIGATION.md` — the plan, and the research it's built on. Read this first.
- `sidecar-generator/` — the one custom application in this project: writes chapter
  marker sidecar files next to existing videos (never modifying them) so ErsatzTV's
  Mid-Roll filler can interrupt playback mid-show. See its module docstring and
  `test_generate_chapters.py`.
- `private-channel-proxy/Caddyfile` — reverse-proxy config that gates the private
  channel's stream behind a secret token in the URL, since Plex's Live TV access can't
  be scoped to one person.
- `docker-compose.yml` / `.env.example` — deployment scaffold.

## Deploying — three docs, in order

1. **`DEPLOY_UNRAID.md`** — enabling Docker on Unraid, and actually getting these
   containers running there (Unraid doesn't run a bare `docker-compose.yml` without an
   extra plugin — this covers both that path and the no-plugin alternative, plus what
   URL/endpoint you actually end up hitting for each piece).
2. **`ERSATZTV_SETUP.md`** — once ErsatzTV is running, configuring it: libraries,
   channels, schedules, filler presets, Playouts, the private channel, Plex DVR setup.
3. Run the chapter generator once your libraries exist in step 2 (exact command is in
   both docs above) — `--dry-run` first to preview split points before it writes
   anything.

`.env.example` has every variable both docs above reference — `cp` it to `.env` and
fill in real values (your actual share paths, a generated token) before starting
anything; `.env` is git-ignored so secrets never get committed.

## Status

See "Implementation progress" and "Open items carried into implementation" at the top
of `INVESTIGATION.md` for what's built, what's config-only, and what's still unverified.
