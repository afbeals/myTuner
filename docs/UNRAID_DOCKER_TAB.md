# Install and operate myTuner through Unraid’s Docker tab

This is the owner’s preferred workflow: build/test/publish on the existing Windows Docker machine, then use Unraid **Docker → Add Container**. No Compose plugin, repo checkout or `.env` is needed on Unraid. No new software is installed on the Mac by these instructions.

## Publish the intended image from Windows

From the up-to-date checkout on the Windows machine, use existing Docker Hub authentication and run `npm run docker:release`. It builds the package-version linux/amd64 image, runs disposable acceptance, tags the exact accepted image and publishes version plus latest. Failures stop publication. Do not rebuild between acceptance and promotion. GitHub credentials do not authenticate Docker Hub. See [Windows Docker](WINDOWS_DOCKER.md).

## Container form

| Field            | Value                                                    |
| ---------------- | -------------------------------------------------------- |
| Name             | `MyTuner` (commands are case-sensitive)                  |
| Repository       | `afbeals/mytuner:latest`, or the specific tested version |
| Network          | Your existing working user-defined bridge, or Bridge     |
| WebUI            | `http://[IP]:[PORT:8777]/`                               |
| Extra Parameters | Blank for the owner’s manual-control preference          |
| Autostart        | Off                                                      |

Add a real **Port** entry: Name WebUI, Container Port **8777**, Host Port **8777**, Connection Type **TCP**. The WebUI shortcut and image EXPOSE declaration do not publish ports. For bridge networking, browse `http://UNRAID-LAN-IP:8777/`; the container’s internal 172.x address is normally not the client address. Check `docker port MyTuner` if the browser cannot connect.

## Path entries

Replace example host paths with existing directories. Keep original media and commercial mounts read-only.

| Name               | Container Path | Host Path example                         | Access Mode | Description                                                    |
| ------------------ | -------------- | ----------------------------------------- | ----------- | -------------------------------------------------------------- |
| App Data           | `/app/data`    | `/mnt/user/appdata/mytuner/data`          | Read/Write  | SQLite, accounts, settings, schedules, keys and backups.       |
| Generated Assets   | `/generated`   | `/mnt/user/appdata/mytuner/generated`     | Read/Write  | Optional thumbnails, GIFs and compatible conversions.          |
| Playback Cache     | `/cache`       | `/mnt/user/transcoding/Transcode/mytuner` | Read/Write  | Disposable streaming/processing files on the configured share. |
| TV Shows           | `/tv`          | `/mnt/user/media/media/tv`                | Read Only   | Existing regular TV library.                                   |
| Anime TV, optional | `/anime_tv`    | `/mnt/user/anime/media/tv`                | Read Only   | An additional existing library root.                           |
| Movies             | `/movies`      | `/mnt/user/media/media/movies`            | Read Only   | Existing movie library.                                        |
| Commercials        | `/commercials` | `/mnt/user/media/media/commercials`       | Read Only   | Individual commercial clips.                                   |

Create only the three new application output directories and give UID/GID **1000:1000** access. Change ownership only on your application-owned directories, never the source library. Existing files may have independent permissions; inspect numeric ownership before changing them. The image runs as the non-root node user. `PUID`/`PGID` variables are not implemented.

`/mnt/user` follows share storage policy; it does not itself guarantee SSD placement. Keep SQLite on local appdata storage, preferably an SSD pool. Prefer SSD storage for playback cache. Inspect both relevant share and pool minimum-free-space/allocation settings if new writes fail with ENOSPC despite free capacity. Thresholds depend on the largest expected files and other workloads; there is no universal mandatory value.

The image already sets `MYTUNER_DATA_DIR=/app/data`, `MYTUNER_GENERATED_DIR=/generated` and `MYTUNER_CACHE_DIR=/cache`. Its SQLite file is `/app/data/mytuner.db`. No `DATABASE_URL` is required. These are container paths, not `/mnt/user` host paths.

## First administrator, once only

If an administrator already exists, skip creation and retain its original password. With no server running against this data directory, use Advanced View **Post Arguments** `node dist/bootstrap.js admin` and add a temporary variable with Key `MYTUNER_ADMIN_PASSWORD` and your chosen password of at least twelve characters. Keep Extra Parameters blank and Autostart off. Apply and inspect logs for `Created administrator admin`; this one-off command then exits normally. An existing administrator is not overwritten or reset.

Edit the container again, remove the temporary password variable and clear Post Arguments. Keep Extra Parameters blank, Autostart off, paths and port mapping unchanged. Apply; start manually if needed. Apply may recreate/start the container now. Docker’s default restart policy is no; subsequent viewing requires manually starting the container. An image’s internal database path and existing data mount retain the account across recreation.

Open `http://UNRAID-LAN-IP:8777/` and sign in. Normal `/api/health` requests every thirty seconds are the image health check. A 200 response inside the container proves internal readiness, not a published host port or cross-network TV reachability.

## Sources and metadata

Register sources using container paths (`/tv`, `/anime_tv`, `/movies`, `/commercials`) and enable recursion as desired. Configure Sonarr/Radarr URLs using their reachable host ports and keys from their own settings. Mapping syntax is one `provider container path => myTuner container path` per line, never the database directory. For example, Sonarr `/media_tv` mapped to the same host library as myTuner `/tv` uses `/media_tv => /tv`; a separate Anime source can use `/anime_tv => /anime_tv`. Two physically different roots must not both map to `/tv`.

Save the integration and run Scan & refresh metadata. Check scan completeness/errors separately from provider matched/unmatched counts. Each source’s Sonarr request can include files from other configured provider roots, so unmatched records from another root may be expected. Saved keys are masked and retained on mapping-only edits. [Media discovery](MEDIA_DISCOVERY.md) and [first channel](FIRST_CHANNEL.md) explain profiles, grants, folder selections, publication and subscriptions.

## Routine changes and updates

Edit source details through Sources. Unused sources may be removed with confirmation; original files are untouched. Active scans/jobs and retained channel/collection/report dependencies protect destructive changes. A root/type change requires rescanning and reconfiguring integration/profile grants. Select folders within one custom source for independent channels; do not create overlapping sources for every subfolder.

For read-only inspection and the recorded host baseline, use [Unraid checks](UNRAID_CHECKS.md).

Before upgrading, create a consistent application backup using `docker exec MyTuner node dist/backup-cli.js`. Backups contain private key material. Publish/test from Windows, then use Unraid Check for Updates → Update while retaining paths and manual startup preferences. Schemas 17–18 add lookup indexes, catalog revisions and cached provider-root state; image rollback alone does not downgrade the database. For actual TV installation and pairing, follow [TV installation](TV_INSTALLATION.md).

Exit 137 means SIGKILL, not automatically OOM. Check `docker inspect MyTuner --format 'Exit={{.State.ExitCode}} OOMKilled={{.State.OOMKilled}}'` and other-container uptimes. Temporary zero statistics do not prove that containers restarted. See [operations](OPERATIONS.md) and [deferred target-host checks](differed.md). Do not delete appdata or the stable runtime lock file as a troubleshooting shortcut.
