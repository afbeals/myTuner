# Windows 11 Docker build and acceptance

Use the existing Windows Docker Desktop workflow used by the owner's Finapp and Tide projects. No Docker installation on the Mac is required. These instructions and scripts have local command-construction tests; actual Windows container execution remains pending.

## Before building

Use PowerShell in the myTuner checkout. Keep its path outside media and application data. Paths with spaces are supported. Mount paths containing commas are rejected because Docker's `--mount` CSV grammar needs additional handling for those paths.

```powershell
Set-Location "C:\Your Projects\myTuner"
node --version
npm --version
docker context show
docker version
docker info --format '{{.OSType}}'
docker compose version
docker buildx version
npm ci
```

Use Node `>=24.13.0 <25`, a running Docker Desktop **Linux-container** engine and working Buildx/Compose. Preserve the already working Docker context and installation. Do not copy a different project's port, appdata path or UID into myTuner without checking the intended host. Windows paths, WSL paths and container paths are different namespaces; these examples run from PowerShell.

## Build once, test that image

```powershell
npm run docker:build
npm run docker:test
Get-Content .\artifacts\docker\accepted.json
```

Stop if any command exits unsuccessfully. The build targets `linux/amd64`, loads `afbeals/mytuner:<package version>` locally and labels it with the version and SHA-256 of the actual build inputs. The test invokes that exact image ID. Changing source, rebuilding, changing the tag, or running a failed new test invalidates promotion. Editing source after building requires another build.

`docker:test` is a terminating automated check. It does not load `.env`, mount household shares, use provider credentials or launch a permanent local server. Each invocation creates uniquely named synthetic source/data/generated/cache volumes and containers. The image's FFmpeg creates the synthetic video and NFO. A root helper initializes only those new disposable volumes; service and verification processes use the non-root image identity. No host FFmpeg is needed.

The test checks:

- Linux/amd64, non-root identity, supported Node, FFmpeg features, compiled CLIs, bundled browser assets and fonts, and package/API/OCI version agreement.
- Admin bootstrap before service startup, health, unauthenticated denial and authenticated API access.
- Real scan, direct byte ranges, an HLS segment, embedded text captions and a generated thumbnail.
- Read-only source-mount write rejection and unchanged video/NFO hashes.
- Single-owner rejection, online full backup, verification with its input volume read-only, and rejection of restore beside a live server.
- Container recreation retaining programming, subscriptions, paused sessions, derivatives, manual metadata choices and channel descriptions.
- Offline restore, old-session rejection, fresh sign-in, restored metadata and clean bounded shutdown.

Each ordinary request has a ten-second deadline; startup is bounded at thirty seconds, CLI operations at sixty seconds, generation at sixty seconds, and graceful stop at thirty seconds. Image builds/pushes allow twenty minutes. Ctrl+C aborts active work and attempts cleanup. Cleanup tries every resource owned by that invocation, records failures, and never prunes Docker or removes existing appdata. If the daemon disappears, use the report's `resourcePrefix` to identify and remove only the remaining disposable resources after Docker is available again.

## Review evidence

Reports live in ignored `artifacts/docker/acceptance-<time>.json`. A successful `accepted.json` records the image ID, source digest, version/platform, Docker/Compose/runtime versions, timings and per-gate results. No report is supplied as evidence of Windows execution until the commands are actually run there.

A passed automated subset is permission to continue the deployment rehearsal. It does not certify production readiness. The report explicitly marks prior-image upgrade/rollback and destructive interrupted-restore/active-worker pressure tests as skipped. Deterministic host recovery/shutdown regressions already exist; the target-host rehearsal still needs those separate gates. Review every skip, then follow [pilot acceptance](PILOT_ACCEPTANCE.md).

## Transfer the tested image

Image publication is a deliberate later operator action. The local scripts never log in or publish automatically.

When publishing is authorized, first promote the accepted image and then push:

```powershell
npm run docker:tag
npm run docker:push
```

Both commands reject missing acceptance, changed source or a changed image. Push also rejects `latest` if it differs from the tested version. Use existing Docker authentication; keep registry credentials outside the repository.

For private transfer without a registry, export the accepted versioned image:

```powershell
$myTunerVersion = node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version"
docker image save --output ".\mytuner-$myTunerVersion.tar" "afbeals/mytuner:$myTunerVersion"
Get-FileHash ".\mytuner-$myTunerVersion.tar" -Algorithm SHA256
```

Keep the large archive outside the checkout afterward. Transfer it privately and run `docker image load --input /actual/path/mytuner-VERSION.tar` on Unraid. Verify the loaded image ID equals the accepted report. A Windows-local image is not automatically installed on Unraid. Do not rebuild between acceptance and transfer.

Use [deployment](DEPLOYMENT.md) for actual Unraid mounts, bootstrap and operation. Keep the matching checkout/Compose file for one-off maintenance commands. For the accepted-image route, use `docker compose up -d --no-build`; do not accidentally replace it with a locally rebuilt candidate.

## Common failures

| Failure                                              | Action                                                                                                                                      |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker executable or daemon unavailable              | Start the existing Docker Desktop installation and confirm the selected context; no application data repair is needed.                      |
| Engine says `windows`                                | Select the supported Linux-container engine in the existing installation.                                                                   |
| Source-digest mismatch                               | Build again from this checkout, then rerun acceptance.                                                                                      |
| `latest` differs                                     | Review accepted evidence and run `docker:tag`; never push an untested tag to get past this error.                                           |
| Test interrupted or cleanup failed                   | Review `resourcePrefix` and cleanup result; remove only that invocation's disposable resources.                                             |
| Named-volume test passes but Unraid permissions fail | Check the actual local pool, runtime UID/GID and source read permissions on Unraid; Windows volume behavior does not prove POSIX ownership. |
| Health works but TV cannot play                      | Follow the origin/network/media diagnosis in TV installation and pilot acceptance; health alone does not test decoding.                     |

The `.gitattributes` LF rule protects any future shell entrypoint from Windows CRLF conversion. The current image starts Node directly and needs no shell entrypoint.
