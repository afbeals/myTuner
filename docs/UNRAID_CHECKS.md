# Read-only Unraid checks and performance validation

These checks use Unraid’s existing Docker CLI and the Node runtime inside myTuner. They install nothing, do not restart containers, do not scan source directories and do not alter media. Do not run a release, restore, permission change or stop/restart as part of this read-only stage.

## Recorded baseline

Hivemind runs Unraid **7.1.2** on an **Intel i5-12600K**, with about **31.13 GiB total RAM shared by all containers**. The owner reported about **20.11 GiB MemAvailable**, and a sample of **6.95% CPU / 60.58 MiB** for the existing myTuner image. Its **40.1 MB block I/O is cumulative**, not a read rate. An earlier all-zero sample is not proof of container restart or OOM. These are idle/unspecified-workload observations, not acceptance of the new image.

## Inspect the current container

In the Unraid terminal (container name is case-sensitive):

```sh
docker inspect MyTuner --format 'User={{.Config.User}} Privileged={{.HostConfig.Privileged}} PID={{.HostConfig.PidMode}} Network={{.HostConfig.NetworkMode}} Restart={{.HostConfig.RestartPolicy.Name}}
Running={{.State.Running}} Exit={{.State.ExitCode}} OOMKilled={{.State.OOMKilled}} Started={{.State.StartedAt}}
{{range .Mounts}}{{printf "%s -> %s | writable=%t\n" .Source .Destination .RW}}{{end}}'
docker port MyTuner
docker ps -a --format 'table {{.Names}}\t{{.Status}}'
```

Check that `/app/data`, `/generated`, `/cache` are the intended separate writable roots. Original TV/movie/custom/commercial/metadata/subtitle mounts should show `writable=false`. In particular, the owner’s earlier commercial mount was writable and should be checked. Keep privileged mode off and the normal private PID namespace. For the chosen manual lifecycle, restart policy is `no` and Unraid Autostart is off. No command here changes those settings.

A bridge-network WebUI requires a real host TCP port entry. Expect 8777 mapped to container 8777 unless deliberately changed. The WebUI shortcut does not publish a port. Host networking can work without published-port output, but that is not the owner’s current bridge setup.

## Runtime diagnostic after loading this update

```sh
docker exec MyTuner node /app/dist/diagnose.js
```

This prints a JSON report: runtime UID/GID; application directory ownership, accessible permissions and reported free bytes; internal `/api/health`; existence/size of `mytuner.db`. It does **not** open SQLite or attempt a write. A passed access check cannot prove a later write succeeds under Unraid share/pool allocation/minimum-free-space policy. Inspect those GUI policies separately if ENOSPC returns. The CLI is added by this update; an older image will not contain it.

The optional checked-in [inspection helper](../scripts/unraid-check.sh) combines the Docker checks and runtime report, with health-only fallback for older images. It requires Bash and Docker already supplied by Unraid. If a checkout is available, run `bash scripts/unraid-check.sh MyTuner`; a checkout is not required for the commands above. The script never starts a stopped container. Its output contains private host paths/container names, so keep reports private unless deliberately sharing a sanitized copy.

## Observe resource use

```sh
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.BlockIO}}' MyTuner
grep -E '^(MemTotal|MemAvailable):' /proc/meminfo
```

Repeat a small number of samples before/during/after a chosen workload. CPU is a sample, memory includes this container’s processes, and block-I/O values are cumulative counters. An initial zero display can be transient; use container uptimes and inspect timestamps to establish restart evidence. OOMKilled=false does not establish an out-of-memory cause for exit 137.

Use the browser’s existing Network panel for library/guide/control request times. Library Next/Previous each request the selected page; idle scrolling does not fetch another page. Search/filter/profile/Refresh actions can request current results. Artwork and active playback have independent requests. Server caches avoid media-share traversal for ordinary selectors and catalog paging.

## Controlled acceptance after the read-only stage

These are later deliberate workloads, not automatic actions by the diagnostic script:

1. Back up application data and run Windows Docker acceptance for the exact 0.2.2 candidate. Schema 18 requires a compatible pre-upgrade bundle for rollback; changing the image alone does not downgrade SQLite.
2. Update through the existing Docker-tab route, preserving mounts/port/manual startup. Confirm the diagnostic/version report.
3. Compare idle, ordinary library paging/search, direct viewing, HLS viewing, one scan, one generation job and combined load. Include other household containers in the observation. Do not drop global disk caches or stress all disks merely to create a cold result.
4. Confirm optional background work queues/pauses as reported. Default `MYTUNER_PAUSE_BACKGROUND_DURING_PLAYBACK=true` protects current available myTuner playback using startup grace plus recent delivery. It resumes after pause/leave or delivery expiry; a stalled status poll does not block recovery indefinitely. Setting the variable to `false` is an explicit operator choice, not required for installation. This policy does not observe Plex or other containers’ playback.
5. Inspect originals’ read-only mounts and representative file/directory hashes where appropriate. Do not write test clips into household sources. Generated outputs belong only under the generated root.
6. Rehearse backup/restore, interrupted recovery, update/compatible rollback and bounded stop/restart using disposable application storage before doing disruptive household tests.

Record Windows/Docker/Compose versions, exact accepted image ID/source digest, Unraid pool/share settings, installed Sonarr/Radarr versions, TV models/OS, outcomes and report locations. [Performance plan](PERFORMANCE_PLAN.md) and [deferred acceptance](differed.md) retain the open gates. Actual HDD throughput, Linux descriptor acceptance, shared-host memory headroom and other-app interference remain unverified until measured there.
