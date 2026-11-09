# Approved phased delivery

Status: phases 1–3 have implementation and substantial local verification evidence. All six formerly deferred findings are fixed. Browser verification is complete; native state/font/pairing checks have passing evidence, while final emulator recovery/tracks/accessibility repeats are now deferred at the owner’s request after tooling failures. Phase4 runtime acceptance will use the owner’s existing Windows Docker Desktop; phase 5 remains intended-host/device and human acceptance. [Verification](VERIFICATION.md) records results and [differed](differed.md) records follow-ups.

1. Complete I47: channel descriptions; independent title/description choices from Sonarr/Radarr, read-only local NFO or manual values; cached availability, explicit file checks, conflict-safe editing and browser/TV display parity.
2. Complete the approved Silver Signal design: reconcile all 58 canonical screen/system frames and seven journeys; finish selected I01–I16/I18/I19/I21/I24 surfaces, state/interaction/accessibility/responsive/native-focus and visual coverage. Preserve approved channel-name and ten-character-code changes.
3. Correct pilot-critical R2-02/R3-01/R5-01/R3-06/R8-01/R8-02/R9-03/R8-04 with deterministic regressions. R3-08/R6-06/R6-07/R6-08/R8-03 and R10-03 are also corrected and regression-verified.
4. After phases 1–3: implement Windows-ready Linux/amd64 Docker build/test/tag/push, portable synthetic acceptance and Unraid instructions using existing afbeals Finapp/Tide/Supper Club patterns. Actual container testing occurs later on Windows 11; no Mac Docker installation or CI-first gate.
5. Later: signed APK/model preflight, real Unraid connection, Bravia-first then compatible Fire OS acceptance, accessibility/remote testing, two-device and six-hour/overnight checks. Network/router changes remain separate.

Browser UI/recovery and the named native state/font checks are complete within their recorded scope. External subtitles, storage/reconciliation and all selected corrections are delivered. Remaining emulator full recovery, actual language-alias transitions and current TalkBack repeats are deferred at the owner’s request, alongside intended-host and human work in [differed](differed.md). Passing synthetic checks do not establish household/device acceptance.

## Invariants and evidence

Source media and existing metadata are read-only. No source writes, moves, duplication or web parsing. Manual metadata stays separate from catalog identities/order and survives refresh/backup. Use synthetic fixtures, preserve demo 8788/Vite 5173, keep credentials/media/runtime assets out of Git. Reuse the approved Silver Signal patterns; raise new material design mismatches.

Each slice requires appropriate service/API/browser/native checks, reviewed visual evidence and updated CHECKLIST/VERIFICATION records. Docker and hardware gates remain explicitly pending until executed on their intended hosts. Publication/deployment are later actions.

## Research decisions ready for later phases

References are locally available Finapp d5da422, Tide 4fe593e and Supper Club 1d6f67f. Use the established Windows Docker Desktop → tested Linux/amd64 image → deliberate transfer → Unraid workflow. The former Docker test only launched a container; it has been replaced by the bounded pass/fail harness described below. Promote the same tested image instead of rebuilding or pushing stale latest. Use separate data/generated/cache and read-only media/commercial/metadata roots, preflight host aliases/permissions and preserve non-root execution. Runtime UID/GID, actual pools/paths/ports and Windows context must be taken from the target setup, not copied examples. Rollback uses the prior image's CLI and compatible full backup.

TV research: minimum SDK 23; Fire OS5 and Vega do not support this APK. Use stable private signing before the physical pilot; record exact model/OS, signer/checksum/version. Enter the application origin, approve the actual ten-hex code, then profile/PIN/subscriptions. Keep ADB transport distinct from app traffic, emulator-only guards intact and network changes separate. Direct native playback is deliberately MP4/M4V/H264/AAC-or-MP3; HLS/codec/HDR/caption quality need representative-device evidence.

## Delivery documents

- [Windows Docker build and acceptance](WINDOWS_DOCKER.md): PowerShell, isolated synthetic test/report, exact source/image identity and deliberate transfer.
- [Unraid and TV pilot acceptance](PILOT_ACCEPTANCE.md): actual binds/permissions, recovery/update, private signing, Bravia/Fire installation, cross-network diagnosis, remote/accessibility and soak gates.
- [Canonical design coverage](DESIGN_COVERAGE.md): all 58 frames, seven journeys, selected adaptations and remaining pixel/hardware evidence.

No container engine or physical device was used in this implementation session. Execute phase 4 container acceptance on the owner’s existing Windows Docker Desktop, then phase 5 on the intended hosts. No Mac Docker installation, publication, router or household-source changes were made.
