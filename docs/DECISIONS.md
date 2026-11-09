# Architecture decisions and open choices

This record explains the accepted direction and its tradeoffs. Implementation status and validation remain in [CHECKLIST.md](CHECKLIST.md) and [VERIFICATION.md](VERIFICATION.md).

## Accepted direction

| Decision                                                               | Why                                                                               | Consequence                                                                                             |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Continue `afbeals/myTuner` on a feature branch                         | Preserve earlier investigation/history while building a standalone service        | Legacy files stay clearly labeled; no extra local git tag is necessary                                  |
| Own server and browser/native TV clients                               | Control profiles, channels and schedules as one product                           | More client/player work; Plex/ErsatzTV are not runtime dependencies                                     |
| Existing media remains read-only                                       | Reuse the actual Unraid library without damage or imported copies                 | Metadata/state/derivatives must live outside original roots; file changes elsewhere need reconciliation |
| Sonarr for shows and Radarr for movies                                 | Reuse existing organization and numbering without manual episode selection        | Optional GET-only integrations require explicit mount mappings and live-version acceptance              |
| Custom sources remain first-class                                      | Non-managed videos must be usable without remote matching                         | Filename/NFO/folder fallbacks are bounded and less rich than full metadata services                     |
| Dynamic show/season/folder/provider collection selections              | Future available additions should join rotations without manual per-episode edits | Already materialized airings are stable; fixed user collections still need explicit membership updates  |
| Admin-created accounts, separate profiles and TV pairing/PINs          | Keep administration distinct from remote-friendly household viewing               | One-time pairing authenticates device; PIN unlocks permitted profile per launch/session                 |
| Private channels invisible except to owner/admin                       | Avoid leaking another user's personal programming                                 | Server filters enumeration/counts/assets/history, and subscription grants no extra rights               |
| One TypeScript/Fastify process with local SQLite                       | Keep the POC deployable without external state services                           | Single-owner model; synchronous work/batch limits and restore discipline matter                         |
| Rotation-based exact timelines                                         | Continuous TV behavior with predictable restarts and edits                        | Clock/calendar slots are out of first-release scope                                                     |
| Persist random decisions and revisions                                 | Every viewer sees one broadcast and paused sessions retain context                | Additional schedule/checkpoint state and retention policy are required                                  |
| Demand-only delivery/conversion                                        | Idle channels should consume little media compute                                 | Actual start/transition latency and CPU throughput need real-player measurement                         |
| Direct capability match with fixed CPU HLS fallback                    | Start with a bounded interoperable delivery path                                  | No current adaptive bitrate, hardware acceleration or broad HDR guarantee                               |
| Explicit optional generation jobs                                      | Avoid unexpected bulk work/copies when sources are added                          | Admin previews/requests separate outputs and manages storage                                            |
| Docker scaffold with separate data/generated/cache and read-only media | Reproduce runtime and preserve application state across updates                   | Runtime UID/GID, volume lifecycle and image acceptance remain required                                  |
| UI only after design approval                                          | Coordinate browser and remote TV experience                                       | Backend/harness work can proceed; visual baselines come after approved Figma handoff                    |
| Network/TV cleanup as separate follow-ups                              | Router policy and device maintenance are outside application behavior             | TV still needs permitted server connectivity; cleanup benefit must be measured                          |

## Choices still requiring evidence or agreement

| Open choice                                     | Evidence/input needed                                                     | Existing behavior until resolved                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Browser/TV visual acceptance                    | Complete frame/state/native accessibility review against approved designs | Approved designs implemented; local browser baselines and emulator screenshots; full audit open         |
| Device support matrix                           | Exact Bravia/Fire model, OS, codecs and network conditions                | Android/Google TV and Android-based Fire OS APK implemented; hardware acceptance pending; Vega excluded |
| Player library/authentication integration       | Browser/Media3 manifests, dependent request auth, offset/reload tests     | Direct/HLS browser and Media3 clients implemented; representative media/soak acceptance open            |
| Hardware transcode/HDR/image subtitles          | Representative media and actual CPU/GPU/device measurements               | Fixed CPU H.264/AAC fallback and text subtitle extraction                                               |
| Source replacement/removal/reassociation policy | Live Sonarr/Radarr versions and realistic library changes                 | Filesystem availability plus metadata upserts/outage preservation                                       |
| History/telemetry/backups retention             | Measured growth, useful history requirements and restore objectives       | Active history retained; unused superseded revisions expire after seven days                            |
| Performance targets and concurrency             | Startup latency, drift, bandwidth, disk/CPU and long soak                 | Existing bounded worker/cache defaults, no household capacity guarantee                                 |
| Deployed backup/update/rollback                 | Actual Unraid volumes, identity and known image/database versions         | Locally tested application snapshots and supplied deployment scaffold                                   |
| Device renewal/re-pair flow                     | UX for 30-day token expiry, lost/revoked devices                          | Implemented re-pair screen on expiry/revocation; actual-device expiry/update acceptance open            |
| Cross-network access                            | Router/AP/SSID/VLAN inventory and narrow routing/firewall policy          | Explicit server address, no automatic network reconfiguration                                           |

New requirements should identify whether they alter server contracts, client design, operations or infrastructure. Record the accepted behavior and validation before checking the corresponding delivery item complete.
