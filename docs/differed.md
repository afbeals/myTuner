# Differed: deferred device and deployment steps

This is the operator follow-up register. All six selected bug fixes and backend/browser verification are complete. Native checks have partial passing evidence; the owner deferred the remaining emulator verification after repeated tooling failures. [Verification](VERIFICATION.md) records the exact boundary. The unchecked items below remain follow-up work, rather than passed acceptance.

## Emulator verification — deferred at the owner’s request

This round is stopped. No more emulator work is needed for the current handoff. Resume it only as a separate follow-up task. The existing SDK/emulator toolchain may be reused under its prior authorization; additional software still requires explicit approval.

Passed evidence: 19 native state pixel comparisons and 24 enlarged-text states before the last pairing-only focus correction; final-APK focused pairing QR/error visibility, expired-code Retry and real browser approval;23 Android unit tests plus build/lint. Six current full-smoke visual comparisons passed before the inspector failed to produce a fresh hierarchy. These are partial runtime results, not a completed final full-smoke run.

- [ ] Complete the current-APK full playback/recovery smoke, including paused dialogs, failed/lost controls, delayed captions/delivery and cold-launch PIN.
- [ ] Repeat actual selected-audio/caption/commercial/MP4→MKV playback with alternating `eng`/`en` language aliases. Broad language mapping unit tests pass; this final runtime repeat is deferred.
- [ ] Repeat the installed TalkBack/long-name/font-scale accessibility mode on the current APK. Prior results remain historical; spoken narration still needs a person.
- [ ] Resolve the read-only UiAutomator inspection stalls before relying on additional long emulator journeys. Do not weaken product assertions or accept an old hierarchy as a fresh result.

## TV models and operating systems

Record the exact Sony Bravia model, Android/Google TV version/API level, display resolution and remote. Record the Fire Stick model/generation and Fire OS version/API level. These details are still unknown. This APK needs Android API 23 or newer; Fire OS5 and Vega are unsupported. Start with Bravia, then the compatible Fire device. Follow [TV installation](TV_INSTALLATION.md) and [pilot acceptance](PILOT_ACCEPTANCE.md).

| Target                      | Model / generation           | OS and Android API                                            | Remote / display                                         |
| --------------------------- | ---------------------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| Primary Sony Bravia         | Not yet supplied             | Not yet supplied                                              | Record remote and resolution                             |
| Secondary Fire Stick        | Not yet supplied             | Confirm Android-based Fire OS, API 23+; exclude Vega/Fire OS5 | Record remote and resolution                             |
| Local verification emulator | Existing `mytuner-tv`, ARM64 | Android 14 / API 34                                           | Synthetic1080p, ADB D-pad; not a household-device result |

- [ ] Record both device models/OS/API versions and supported installation/ADB transport.
- [ ] Validate remote navigation, pairing/profile/PIN, subtitles/audio, pause/Go Live, updates and re-pairing on each actual device.
- [ ] Review physical 1080p/4K text/focus and audible screen-reader output with a person.

## Windows Docker testing

The owner confirmed Docker Desktop is already installed on the Windows machine. Use that existing installation; no Mac Docker installation is planned. Container execution remains unverified until run there. Follow [Windows Docker acceptance](WINDOWS_DOCKER.md).

- [ ] Record Windows/Node/Docker/Compose versions and the active Linux-container context.
- [ ] Build linux/amd64 once, run the isolated synthetic container acceptance harness and retain its exact accepted image ID/source digest/report.
- [ ] Rehearse restart persistence, backup/restore, interrupted recovery, update and compatible rollback using disposable appdata.
- [ ] Transfer/promote the same tested image deliberately; publication and deployment remain later operator actions.

## Unraid and real integrations

- [ ] Record Unraid version, local appdata pool, runtime UID/GID, free published port and separate writable data/generated/cache locations.
- [ ] Verify read-only media/commercial/metadata/subtitle mounts without changing original-library ownership or files.
- [ ] Record installed Sonarr/Radarr versions, actual path mappings and successful removal/reassociation behavior.
- [ ] Test restored volumes, missing derivatives, unavailable sources, disk pressure and bounded shutdown on the real host.
- [ ] Select backup, delivered-history and active-schedule retention policies using measured household growth.

## Representative media and endurance

- [ ] Test actual household codecs, combined episodes, alternate audio and text captions through direct/HLS playback and commercial boundaries.
- [ ] Assess image-subtitle burn-in, additional codecs and HDR only when representative files/devices establish a need; these are not current supported claims.
- [ ] Measure concurrent viewers, CPU/memory/network, caption drift and conversion catch-up on Unraid.
- [ ] Run six-hour and overnight sessions, source/network loss and recovery, Home/relaunch and independent-device pause.

## Separate networking and optional TV cleanup

- [ ] Record router/AP models, TV/server SSIDs/VLANs, DNS and required ports.
- [ ] Configure and test narrow TV-to-server access as a separate infrastructure task; retain the existing networks.
- [ ] Consider model-specific TV cleanup only with a measured before/after responsiveness comparison.

New host software or toolchain components require explicit owner approval. Existing Android SDK/emulator use is authorized within the previously agreed conditions. Original media remains read-only and credentials/signing keys remain outside Git. Optional unselected feature proposals remain in [the improvement catalog](IMPROVEMENTS.md); this register does not select them.
