#!/usr/bin/env bash
# Read-only Docker/Unraid inspection. No installs, writes, restart, or scans.
set -u
container="${1:-MyTuner}"
if [[ ! "$container" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]]; then
  echo "Provide a Docker container name, such as MyTuner." >&2
  exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker CLI is unavailable. Run this in the Unraid terminal." >&2
  exit 1
fi
if ! docker inspect "$container" --format 'Name={{.Name}} Image={{.Config.Image}} User={{.Config.User}}
Running={{.State.Running}} Exit={{.State.ExitCode}} OOMKilled={{.State.OOMKilled}}
Started={{.State.StartedAt}} Finished={{.State.FinishedAt}}
Privileged={{.HostConfig.Privileged}} PID={{.HostConfig.PidMode}} Network={{.HostConfig.NetworkMode}} Restart={{.HostConfig.RestartPolicy.Name}}
{{range .Mounts}}{{printf "%s -> %s | writable=%t\n" .Source .Destination .RW}}{{end}}'; then
  echo "Container not found; names are case-sensitive." >&2
  exit 1
fi
echo "Published ports:"
ports="$(docker port "$container")"
if [ -n "$ports" ]; then
  echo "$ports"
else
  echo "No published ports. This is normal for host networking; bridge networking needs an explicit port entry."
fi
echo "Container uptimes (to distinguish a UI statistics refresh from restarts):"
docker ps -a --format 'table {{.Names}}\t{{.Status}}'
running="$(docker inspect "$container" --format '{{.State.Running}}')"
if [ "$running" != true ]; then
  echo "Container is stopped; runtime checks skipped. Nothing was started."
  exit 0
fi
if docker exec "$container" node --input-type=module -e 'import {existsSync} from "node:fs"; process.exit(existsSync("/app/dist/diagnose.js")?0:2)'; then
  docker exec "$container" node /app/dist/diagnose.js
else
  echo "This image predates the diagnostic CLI; checking its existing health endpoint only."
  docker exec "$container" node --input-type=module -e 'const r=await fetch("http://127.0.0.1:"+(process.env.PORT??8777)+"/api/health",{signal:AbortSignal.timeout(5000),redirect:"error"}); console.log(JSON.stringify(await r.json())); if(!r.ok)process.exitCode=1;'
fi
