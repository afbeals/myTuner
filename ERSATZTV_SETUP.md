# ErsatzTV setup walkthrough

Step-by-step for configuring ErsatzTV itself once it's running (`docker compose up -d`
or the Unraid Community Applications install — either way, its web UI is at
`http://<host>:8409`).

**How trustworthy this is:** the page routes below (e.g. `/media/sources/local`) are
confirmed directly from ErsatzTV's own source (`ErsatzTV/Pages/*.razor` route
declarations), not guessed — so if a link doesn't take you where described, something's
off (wrong version, etc.), not a typo on my part. The exact field labels/wording inside
each page are **not** independently verified — I don't have a running instance to look
at — so treat those as "here's what to look for," not a pixel-exact script. If a label
doesn't match, the underlying concept (Library / Channel / Collection / Filler Preset /
Schedule / Playout) still will.

## 1. Add your local libraries

Go to **Media → Libraries** (`/media/sources/local`) → **Add** (`/media/sources/local/add`).

- One library pointed at your shared content (the `/media/shared` mount from
  `docker-compose.yml`) — this is your existing Shows/Movies structure, read as-is.
- A second, separate library pointed at `/media/private` — the private channel's
  content.
- After adding, ErsatzTV scans automatically. Note the **library id** shown for the
  shared library (visible in its URL/edit page, e.g. `/media/sources/local/1/edit` →
  id `1`) — you'll need this for the chapter generator's `--library-id` flag.

## 2. Build a "commercials" collection

Go to **Media → Collections** (`/media/collections`) → **Add**
(`/media/collections/add`).

- Create a collection (e.g. "Commercials") and add your short filler clips to it.
- These clips can live anywhere ErsatzTV can see them — they don't need the chapter
  sidecar treatment; that's only for content you want interrupted mid-show.

## 3. Create Filler Presets

Go to **Media → Filler → Presets** (`/media/filler/presets`) → **Add**
(`/media/filler/presets/add`).

Create one preset per behavior you want, referencing the "Commercials" collection:

- **Between-episode**: Filler Kind = `Pre-Roll` or `Post-Roll`, Mode = `Count` (e.g.
  `1` = exactly one commercial) or `Duration` (time-boxed instead).
- **Within-episode (mid-roll)**: Filler Kind = `Mid-Roll`, same Count/Duration choice.
  This only does anything for content that has chapter markers — i.e., content the
  `sidecar-generator` has already processed. Run the generator (step 6) before this
  preset will have any effect.

Both are just config values here — this is exactly what makes "cap how many
commercials" and "disable commercials" a few clicks rather than a code change.

## 4. Create the channel(s)

Go to **Channels** (`/channels`) → **Add** (`/channels/add`).

- One channel per "network" you want (each gets its own number/name/logo).
- Create the private channel here too, alongside the shared ones — same page, just a
  separate channel entry.

## 5. Build a schedule for each channel

Go to **Schedules** (`/schedules`) → **Add** (`/schedules/add`), then edit its items
(`/schedules/{id}/items`).

- **Shared channel schedule**: add schedule items pointing at your shows/movies
  library/collection, in whatever order/rotation you want, and attach the Filler
  Presets from step 3 to the relevant items.
- **Private channel schedule**: add a schedule item pointing at the private library,
  set its order to **Shuffle** or **Random** (native collection-order option), and
  attach **no** filler preset — this channel doesn't do commercials at all, per your
  earlier call.

## 6. Run the chapter generator

Now that the shared library exists and has a real library id (step 1), run the
generator against it before relying on any Mid-Roll filler preset — it has nothing to
interrupt at until sidecars exist:

```
docker compose run --rm chapter-generator /media/shared --mode random-percent \
  --ersatztv-url http://ersatztv:8409 --library-id <id> --ersatztv-api-key "$ERSATZTV_API_KEY"
```

(Compose Manager: run this from the stack's Docker Compose Manager page. Added
containers by hand instead: `docker run --rm -v <shared-path>:/media/shared
mytuner-generator /media/shared ...` with the same flags, `--ersatztv-url` pointed at
your Unraid server's real IP. See `DEPLOY_UNRAID.md` for the full context on both
paths.)

## 7. Link each channel to its schedule (the Playout)

Go to **Playouts** (`/playouts`) → **Add**. Pick **Classic** as the playout type (the
UI-driven, non-YAML/scripted option — matches the plan), then choose the channel and
schedule to link. This is the step that actually generates the timed, minute-by-minute
programming from the schedule you built — nothing plays until a playout exists for a
channel.

Repeat for every channel, including the private one.

## 8. Get the private channel's direct stream URL

Once the private channel has a playout, its direct stream URL follows the pattern
confirmed earlier: `http://<host>:8409/iptv/channel/<channel-number>.m3u8` (the channel
number you set in step 4). This is the path the reverse proxy
(`private-channel-proxy/Caddyfile`) forwards to — the full client-facing URL to paste
into TiviMate/VLC is:

```
https://<host>:8443/private/<PRIVATE_CHANNEL_TOKEN>/iptv/channel/<channel-number>.m3u8
```

(using whatever `PROXY_PORT`/`PRIVATE_CHANNEL_TOKEN` you set in `.env`).

## 9. One-time Plex Live TV & DVR setup (shared channels only — not the private one)

In Plex's own settings: **Live TV & DVR** → **Set up Plex DVR** → enter ErsatzTV's
address (`<host>:8409`) as the tuner. Plex will detect it via HDHomeRun emulation and
pull in its XMLTV guide automatically. The shared channels then show up in Plex's own
Live TV grid, watched through the Plex app already on your TV device.

## 10. Get your API key (only needed for the generator's rescan flag)

Not in a Settings page — ErsatzTV auto-generates it on first run into
`api-secrets.json` inside its config folder:

```
cat /mnt/user/appdata/ersatztv/api-secrets.json
```
