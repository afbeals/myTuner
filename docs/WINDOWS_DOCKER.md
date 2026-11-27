# Windows 11 Docker build and acceptance

Use the existing Windows Docker Desktop workflow used by the owner's Finapp and Tide projects. No Docker installation on the Mac is required. The first reported Windows run built successfully and passed storage, runtime, bootstrap and media gates, then timed out during backup verification. Full Windows acceptance remains pending; rerun the current 0.3.0 candidate, which retains the 0.2.1 read-only verification fix. A successful older report cannot promote changed source/image inputs.

## Docker shortcuts

Run `npm run docker:help` (or `node scripts/docker.mjs --help`) for safe command help; it does not invoke Docker or create artifacts.

| Command                  | Behavior                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `npm run docker:build`   | Build/load the package-version Linux/amd64 image; show build progress.                                      |
| `npm run docker:test`    | Run automated disposable acceptance; show each named gate and write its JSON report.                        |
| `npm run docker:tag`     | Tag the exact accepted image as `latest`.                                                                   |
| `npm run docker:push`    | Publish accepted version and `latest`, with progress and an image/tag summary.                              |
| `npm run docker:release` | Build → test → tag → push. No second build after acceptance; failures stop the sequence.                    |
| `npm run docker:preview` | Run the current versioned image at `http://127.0.0.1:8877/` with persistent synthetic data.                 |
| `npm run docker:check`   | Check SemVer and both package-lock root versions; `-- --base origin/main` also requires a version increase. |

Release/push use existing Docker Hub authentication. A GitHub PAT is separate and does not authenticate image publication. Neither command changes the Unraid installation automatically. Version is taken from package.json; the CLI does not bump versions or make Git tags. CI validates package consistency and requires PR versions to be higher than their base.

### Interactive local preview

Build first, then run `npm run docker:preview`. First-run credentials are `preview` / `synthetic-preview-password`; later launches preserve existing accounts. In Sources, `/fixtures` contains one synthetic video with metadata and embedded captions. Use the browser setup flow to create a profile/channel. The preview does not read `.env` or mount household shares.

The four named volumes `mytuner-preview-source`, `mytuner-preview-data`, `mytuner-preview-generated` and `mytuner-preview-cache` retain data after Ctrl+C. The command refuses existing volumes without its preview ownership label. It stops/removes only its own temporary containers; it never prunes Docker or removes preview data automatically. Bootstrap and service use the image's non-root identity; only initialization of these owned synthetic volumes uses a root helper.

To choose a different local port in PowerShell:

```powershell
$env:MYTUNER_PREVIEW_PORT = "8878"
npm run docker:preview
```

Preview is an interactive inspection command, separate from automated `docker:test`. It does not grant acceptance or publish an image.

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

Image publication is an explicit operator action. Build/test/preview do not publish or log in. `docker:push` and `docker:release` publish when explicitly invoked.

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

Use [Unraid Docker-tab setup](UNRAID_DOCKER_TAB.md) for the preferred actual mounts, stopped-server bootstrap and manual operation. No Compose installation or checkout is needed on Unraid for that route. [Deployment](DEPLOYMENT.md) covers optional CLI/Compose maintenance; if using Compose, retain the matching file and use `docker compose up -d --no-build` with the accepted image so a local rebuild does not replace the tested candidate.

## Backup verification timeout after a successful build

A successful build does not establish runtime acceptance. The initial reported Windows failure passed `disposable-storage`, `runtime-artifact`, `bootstrap-health-assets-auth` and `scan-range-hls-captions-generation`, then hit the 60-second limit in `exclusive-owner-backup-verification`. A present `snapshot` with absent `backupSchema` identifies the verification command. Cleanup passed.

Version 0.2.1 stages the standalone database, manifest and optional key into private writable scratch before SQLite validation. Original backup files and mounts remain read-only; fingerprints still bracket verification and reject changed inputs/nonempty WAL bundles. The local regression demonstrates the old read-only failure and validates the repair. Full Windows acceptance must still be rerun there. Named errors now distinguish e.g. `Backup verification timed out after 60000ms` from interruption without printing credential arguments.

After updating the checkout, run `npm run docker:build` and `npm run docker:test` again. The source/image identity changed, so the old image and failed report cannot be promoted. Keep the normal Docker build cache. Inspect the newest acceptance JSON, including `error`, `gates`, `snapshot`, `backupSchema` and `cleanup`, if another gate fails. Do not raise deadlines or mark the image accepted manually.

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
