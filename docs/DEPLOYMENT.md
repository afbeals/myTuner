# Standalone Docker and Unraid deployment

Status: version 0.2.0 includes the server, browser manager/player and a locally built native TV POC APK. Docker is unavailable in the implementation environment, so image build/runtime and Unraid permissions have not been validated. No image has been published. Actual household deployment and device acceptance remain open.

Read [OPERATIONS.md](OPERATIONS.md) for onboarding, budgets, cleanup, backup/restore and diagnosis; [ARCHITECTURE.md](ARCHITECTURE.md) explains process/storage boundaries.

## Image workflow

Use the established **Windows 11 Docker Desktop → tested Linux/amd64 image → deliberate transfer → Unraid** route. [Windows build and acceptance](WINDOWS_DOCKER.md) gives PowerShell commands, the disposable synthetic harness, report/skip interpretation and same-image promotion checks. [Pilot acceptance](PILOT_ACCEPTANCE.md) separates Windows packaging, Unraid storage/recovery and physical TV gates.

`docker:build` builds the versioned candidate; `docker:test` terminates with a pass/fail report. It uses unique disposable named volumes, not `docker-data` or `.env`. `docker:tag` and `docker:push` require that exact accepted image/source and reject stale tags. Publication is a later explicit action. No Docker execution or publication is claimed here.

## Unraid mounts

Copy .env.example to .env and replace every placeholder with existing directories. Keep SQLite on a local appdata pool; the generated/cache locations may be managed separately. Use existing `/mnt/user/<share>` media paths so mover activity does not break file references.

| Host                                 | Container    | Mode       |
| ------------------------------------ | ------------ | ---------- |
| local pool appdata/mytuner/data      | /app/data    | read/write |
| local pool appdata/mytuner/generated | /generated   | read/write |
| local pool appdata/mytuner/cache     | /cache       | read/write |
| existing media share                 | /media       | read-only  |
| existing commercial share            | /commercials | read-only  |

Image runtime uses the node user (UID/GID 1000). Provision appdata/generated/cache ownership and media read permissions for that identity, or set an explicit tested runtime user/group in your Unraid configuration. Do not run a blanket chmod/chown over the source library. Storage may not overlap source roots.

Port: host 8777 -> container 8777 by default. Follow the ordered first-installation sequence below; bootstrap must run before starting the server. The browser manager/player is served at `/`; the Unraid WebUI label opens this root. `/api/health` remains the diagnostic endpoint. The image builds and contains its matching browser assets and local fonts.

## First installation on Unraid

Unraid does not provide Docker Compose by default. One supported setup path is **Community Applications → Docker Compose Manager** (check the plugin's compatibility with your Unraid version), with Docker enabled under Settings → Docker. This project has no published image or Community Applications template yet.

Place `docker-compose.yml` and a private `.env` together on the Unraid appdata pool outside media, for example `/mnt/YOUR_POOL/appdata/mytuner/project`. Do not place writable runtime roots under the checkout or a media source. Compose contains only an image reference: it cannot silently rebuild a different candidate on Unraid. Use the same working directory and `.env` for maintenance commands.

1. Enable Docker, make Compose v2 available and confirm `docker compose version`.
2. Copy `.env.example` to `.env`; replace every path placeholder and select the tested runtime UID/GID. Create only the three new writable directories, then grant that identity the necessary access. Existing media/commercial paths must exist and be readable; Compose rejects missing bind paths instead of creating misleading empty directories. Confirm all writable/source roots are separate.
3. Transfer the accepted image from Windows using the registry or private save/load procedure in [the Windows guide](WINDOWS_DOCKER.md). Confirm the loaded image ID matches the acceptance report and `.env` selects its exact version. Run `docker compose config --quiet` to validate configuration.
4. Keep the normal service stopped. Bootstrap as below, clear the bootstrap password from the invoking environment, then run `docker compose up -d --no-build mytuner`.
5. Run `docker compose ps` and `docker compose logs --tail=100 mytuner`. Open `http://<UNRAID-LAN-IP>:<host-port>/api/health`, then the same origin's `/` to sign in. Continue with [your first channel](FIRST_CHANNEL.md).

If using Compose Manager, point its project/working directory at that Compose/`.env` directory; menu names vary by plugin version. A Windows-local image is not automatically available on Unraid. Verify the selected local pool/runtime identity and real bind permissions on Unraid; named-volume acceptance does not prove these host properties. Neither these instructions nor a local script test establishes deployment success.

### Optional separate metadata mount

Adjacent NFO files already share the read-only media mount. For a separate metadata directory, add a local Compose override with an existing host directory mounted read-only:

```yaml
services:
  mytuner:
    volumes:
      - type: bind
        source: /actual/existing/metadata
        target: /metadata
        read_only: true
        bind:
          create_host_path: false
```

Then configure that source's metadata location as `/metadata` in the admin UI, using matching relative subdirectories. Keep this root separate from data/generated/cache. No NFO or media files are written. Apply the same override to one-off bootstrap/verification/restore commands if they need that source configuration.

## Bootstrap and operation

There is no default password or public signup. Bootstrap before starting the server: the bootstrap CLI acquires the same data lock, so running it beside an active server is rejected. With the service stopped and `MYTUNER_ADMIN_PASSWORD` supplied privately in the invoking environment, use the same mounts through a one-off container:

```sh
docker compose run --rm -e MYTUNER_ADMIN_PASSWORD mytuner node dist/bootstrap.js your-admin-name
```

Unset the bootstrap password afterward, then start the normal service with `docker compose up -d --no-build mytuner`. Do not persist the password in Compose or commit it. Only the first admin is bootstrapped; later account management requires an authenticated admin.

Docker restarts retain the data volume. Logs use stdout. Graceful shutdown stops generation work and leaves interrupted tasks retryable. No playback encoders run merely because schedules exist.

Use `node dist/backup-cli.js` for consistent application snapshots, including the private integration encryption key. Stop the server and run `node dist/restore-cli.js /path/to/snapshot-directory` for restore; never run a second server against the same data. Local recovery tests cover corrupt backups, migration snapshots, active locks and interrupted restore recovery. Unraid volume/update rehearsal remains required. Reverting an image does not reverse schema changes.

An interrupted restore leaves restore.pending.json and blocks startup. With the server stopped, `node dist/restore-cli.js --recover` reinstalls the validated prior recovery snapshot when one exists; for fresh or damaged targets without a rollback snapshot, it retries the validated input recorded in the journal. Preserve the journal and backup input until recovery succeeds. Preserve snapshot directories and integration.key privately. After restore, rescan mounted sources and explicitly regenerate any missing outputs; original shares remain read-only. See BACKEND.md for limits and recovery details.

The API supports LAN HTTP cookies with SameSite/CSRF protection. If a trusted HTTPS endpoint is configured, set MYTUNER_SECURE_COOKIE=true and MYTUNER_PUBLIC_ORIGIN to the exact HTTPS origin. Forwarding headers are not trusted automatically.

## Connect the TV client to this server

Follow [TV_INSTALLATION.md](TV_INSTALLATION.md) for installing the signed Bravia/Google TV or Fire OS APK and pairing. The local debug-signed POC artifact is `android/app/build/outputs/apk/debug/app-debug.apk`. Its build/signature/version/checksum and installation commands are documented there. It is not a store release or published download.

With the default bridge mapping, enter `http://<Unraid-LAN-IP>:8777` as the TV app's base address, for example `http://192.168.1.10:8777`. If MYTUNER_PORT changes the host mapping, use that host port. Use a deliberately assigned container LAN IP only for a tested custom-IP deployment. Do not enter localhost, a Docker-internal name, the Unraid management URL, an SMB path or a Sonarr/Plex address.

Check `/api/health` on that endpoint, then approve the TV's returned pairing code from a signed-in browser on the same myTuner instance. The app then selects/unlocks a profile and loads its subscriptions. The TV needs access to this application endpoint, not direct media-share or integration ports. The native client explicitly supports LAN HTTP and normal system-validated HTTPS. Device-specific connectivity and certificate behavior still require acceptance.

A successful wired desktop request does not prove the TV's network permits this path. Keep any required narrow routing/firewall/DNS work as the separate infrastructure follow-up. APK sideloading's computer-to-TV adb port is unrelated to the myTuner server's host port.

## Out-of-scope follow-ups

Router/firewall/SSID/VLAN work stays separate from application development. Later permit only the relevant TV devices/networks to reach Unraid's selected app port. TV cleanup is optional and model-specific. Neither is performed by this scaffold.

## Container backup, verification and recovery commands

Run from the same complete checkout/Compose working directory on Unraid. `.env` is read by Compose for **host** volume paths (`MYTUNER_*_PATH`). The image supplies **container/process** paths such as `MYTUNER_DATA_DIR=/app/data`; Node CLIs do not automatically load `.env`. A snapshot printed as `/app/data/backups/<name>` resides under `<MYTUNER_DATA_PATH>/backups/<name>` on the host. Preserve the whole private snapshot directory, including the key/manifest.

Create an online consistent backup while the service runs:

```sh
docker compose exec mytuner node dist/backup-cli.js
```

Record its printed directory. To verify it, replace both host placeholders below with the actual snapshot path. This extra mount exposes that bundle read-only; verification uses temporary scratch and does not install it:

```sh
docker compose run --rm --no-deps --volume /mnt/YOUR_POOL/appdata/mytuner/data/backups/REPLACE_WITH_SNAPSHOT_DIRECTORY:/verification:ro mytuner node dist/verify-cli.js /verification --json
```

Before restore, independently confirm the target data directory is outside every media root, including roots recorded in the input backup. The selected recovery fixes now reject nonempty WAL bundles and overlapping targets; still verify the intended mount paths independently before any restore. Replace the snapshot name below with the selected directory; the input must remain available at this container path until any recovery finishes.

```sh
docker compose stop mytuner
docker compose run --rm --no-deps mytuner node dist/restore-cli.js /app/data/backups/REPLACE_WITH_SNAPSHOT_DIRECTORY
```

Only after success, restart with `docker compose up -d --no-build mytuner`, inspect logs/health and sign in again (old sessions are revoked). If restore fails, keep the server stopped and preserve the journal, damaged/rollback bytes and input. When an interrupted-restore journal exists, run:

```sh
docker compose run --rm --no-deps mytuner node dist/restore-cli.js --recover
```

Then restart only after successful recovery. For a backup stored elsewhere, mount its host directory read-only at `/restore-input` on the one-off container. Use `/restore-input` as the restore argument, and repeat the identical `--volume /actual/host/snapshot:/restore-input:ro` option on the later `--recover` command. Recovery reads that original input path from its journal; do not supply a new snapshot argument to `--recover`. Never delete appdata or use `down --volumes` as a recovery step. The example commands are source-checked instructions; Docker/Unraid execution remains unverified in this environment.

## Optional separate subtitle mount

Captions beside media or in its subtitle subdirectories already use the read-only media mount. For a separate caption root, add an override to your private Compose project:

```yaml
services:
  mytuner:
    volumes:
      - type: bind
        source: /mnt/user/YOUR_SUBTITLE_SHARE/shows
        target: /subtitles/shows
        read_only: true
        bind:
          create_host_path: false
```

Replace the host placeholder with an existing readable directory, validate `docker compose config --quiet`, then recreate using your tested image. In **Sources → Configure → Subtitle search locations**, set the container path `/subtitles/shows`, save and scan/check. Mirror the media source's relative directories below this root, as shown in [subtitle setup](SUBTITLES.md). Keep it outside application writable roots and other media sources. Do not enable source writes, copy captions into the repository or modify a household sidecar to satisfy the application. Database backups preserve configuration/associations but do not include original subtitle files or host mount configuration.
