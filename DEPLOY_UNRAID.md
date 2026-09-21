# Deploying on Unraid

Unraid doesn't run a plain `docker-compose.yml` out of the box the way a normal Linux
box does — this covers what that actually takes, the two ways to do it, and what
address you end up hitting for each piece ("the endpoint").

## 1. Enable Docker

**Settings → Docker** → set **Enable Docker** to `Yes` → **Apply**. First time through,
Unraid creates a `docker.img` vdisk (or, on Unraid 6.12+, you can use a plain directory
on Btrfs/ZFS instead of a loopback image — simpler, and harder to accidentally fill up;
pick that if given the choice). Nothing to configure inside `myTuner` for this — it's a
one-time Unraid setting, done before any container exists.

## 2. Running the stack — two options

### Option A — Docker Compose Manager plugin (matches this repo's `docker-compose.yml` directly)

1. **Apps** tab → search **"Docker Compose Manager"** → Install (from Community
   Applications; needs Unraid 6.10+, Docker already enabled).
2. A **Compose** section appears at the bottom of the **Docker** tab. Add a new stack,
   paste in this repo's `docker-compose.yml`, and set up its `.env` values (copy
   `.env.example`, fill in your real share paths and a generated token — see `README.md`).
3. Click **Compose Up**. This starts `ersatztv` and `private-channel-proxy`;
   `chapter-generator` stays stopped since it's under the `tools` profile (not meant to
   run continuously) — start it manually (or via a scheduled Compose run) when you want
   a generation pass.

### Option B — no extra plugin, add each container by hand

If you'd rather not add the Compose Manager plugin, each piece maps to one manual
container:

- **ErsatzTV**: use its existing **Community Applications** template instead of our
  compose service for this one — **Apps** tab → search **"ersatztv"** → Install. CA
  already wires up the port (8409) and a WebUI link for you. Point its volume mappings
  at your real share paths (same ones as `docker-compose.yml`'s `SHARED_LIBRARY_PATH` /
  `PRIVATE_LIBRARY_PATH`, mounted **read-only**).
- **private-channel-proxy**: **Docker** tab → **Add Container** (bottom of the page,
  not from CA — this one has no template):
  - Repository: `caddy:2-alpine`
  - Port: container `8443` → host `8443` (or whatever `PROXY_PORT` you chose)
  - Volume: Host Path = wherever you've placed this repo's
    `private-channel-proxy/Caddyfile` on the array/cache (e.g. copy it into your
    appdata share) → Container Path `/etc/caddy/Caddyfile`, read-only
  - Environment variables (toggle **Advanced View** to see this section):
    `PROXY_PORT`, `PRIVATE_CHANNEL_TOKEN`, `ERSATZTV_UPSTREAM` (e.g.
    `http://<unraid-ip>:8409` — see the networking note below)
  - No **WebUI** field needed — this container has no admin page, only a stream
    endpoint (see step 4).
- **chapter-generator**: this one isn't a long-running service, so it doesn't fit
  Unraid's normal "always-on container" model well. Two reasonable ways to run it:
  - Build the image once (`docker build -t mytuner-generator ./sidecar-generator`, via
    SSH or the Unraid terminal), then invoke it on demand with `docker run --rm -v
    <shared-path>:/media/shared mytuner-generator /media/shared --mode random-percent
    ...` (full example in `README.md`).
  - Or install the **User Scripts** plugin (also from Community Applications) and put
    that same `docker run` command in a script there — gives you a "Run Now" button and
    optional cron scheduling from Unraid's own UI, without needing Compose at all.

## 3. Networking — what "the endpoint" actually is

Containers added either way default to **bridge** networking on Unraid, which just maps
a container port onto your Unraid server's own IP. There's no separate container IP to
hunt for — once running:

- **ErsatzTV's UI**: `http://<unraid-server-ip>:8409/` (CA gives you a clickable icon
  for this on the Docker tab; if you ever add it manually instead, fill the **WebUI**
  field with `http://[IP]:[PORT:8409]/` and Unraid does the substitution itself).
- **Private channel's stream endpoint** (not a webpage — this is the URL you paste into
  TiviMate/VLC, not something you browse to): `https://<unraid-server-ip>:8443/private/<PRIVATE_CHANNEL_TOKEN>/iptv/channel/<channel-number>.m3u8`.

If `ERSATZTV_UPSTREAM` is set to `http://ersatztv:8409` (a Docker Compose service name,
as in `docker-compose.yml`), that only resolves when both containers are on the *same*
Compose-managed network (Option A). Under Option B, where each container is added
independently, use the Unraid server's real LAN IP instead:
`ERSATZTV_UPSTREAM=http://<unraid-server-ip>:8409`.

## 4. After this: `ERSATZTV_SETUP.md`

Once ErsatzTV is actually running and reachable at its `:8409` endpoint, move on to
`ERSATZTV_SETUP.md` for configuring libraries/channels/schedules/filler presets inside
it.
