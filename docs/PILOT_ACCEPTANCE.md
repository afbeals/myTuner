# Unraid and physical TV pilot acceptance

This is the next operator-run validation phase. Local service/browser tests, Android builds and emulator checks are useful evidence, but no Windows Docker, Unraid, physical Bravia or Fire stick success is claimed. Start with [Windows packaging acceptance](WINDOWS_DOCKER.md), then keep its exact accepted image for the following steps.

## Record the target setup

Record the accepted image ID/version/source digest, Windows Docker context, actual Unraid version and local appdata pool, selected non-root UID/GID, free published port and application origin. Record the exact Bravia and Fire model, OS/API level and remote. Do not put passwords, PINs, pairing tokens or signing keys into this document or a bug report.

The APK requires Android API23 or newer. Fire OS5 and Vega do not support this APK. Confirm the stick model's operating system before attempting installation. Keep the TV on its existing network. Router/firewall/DNS changes remain a separate infrastructure task; the application does not alter them or register a `mytuner.local` name.

## Gate 1: Unraid storage and service

1. Load/pull the tested image and confirm its ID. Configure three separate writable data/generated/cache paths and existing read-only media/commercial paths. Mount a separate metadata root read-only if using it. Keep SQLite on a local appdata pool, outside media and SMB/NFS storage.
2. Validate Compose and provision only the new application directories for the intended runtime identity. Never recursively change source-library ownership or permissions. Confirm reads from the real mounts as that identity; a Windows named-volume test does not establish these permissions.
3. Bootstrap the first admin before starting the normal service, following [deployment](DEPLOYMENT.md). Start with `--no-build`; inspect bounded logs and health, then sign in through `/` on that same origin.
4. Add one source and optional Sonarr/Radarr mapping. Scan, inspect unavailable files, choose a show/season/folder and preview a small channel. Confirm manual titles/descriptions, local NFO choice and read-only source hashes. Provider integration is optional; confirm the installed provider version and actual path mapping separately.
5. Subscribe the intended profile, create its PIN and check effective access. With an unrelated account, confirm another owner's private channel and metadata are absent.
6. Recreate the container retaining its volumes. Confirm accounts, grants, catalog, manual information, channel descriptions, subscriptions, programming and progress remain.

Record pass/fail, observed timing and sanitized evidence for every step. Keep originals read-only throughout.

## Gate 2: backup, interrupted recovery and update

Use disposable test appdata for deliberate failure injection. Do not simulate failures against the household installation.

- Take an online full backup, preserve its matching key/manifest and verify it from a read-only mount. Reject a damaged/future-schema/nonempty-WAL bundle. Reject an overlapping media target before target files are created.
- Restore offline into separate permitted appdata. Old browser/device sessions must fail; sign in and pair again. Confirm metadata selections/manual values, grants, subscriptions, schedule checkpoints and catalog references. Rescan real mounts and regenerate missing derivatives deliberately.
- For interrupted restore, preserve the journal and exactly mounted input; invoke `--recover` with the same container paths. Test the resulting application health and revoked sessions. Never clear appdata or delete the journal as a shortcut.
- Stop during actual conversion/HLS/subtitle/generation activity. Record bounded termination, no late partial publication and a valid restart. Repeat with disk-pressure and unavailable-source fixtures.
- Before updating, retain a complete full backup and the previous accepted image. Update to the candidate without changing mount paths. If rollback is required, use the previous image's compatible restore CLI and its matching full pre-upgrade bundle. Image rollback alone cannot undo schema changes. If no prior accepted image exists, mark this gate unverified instead of calling a restart an upgrade test.

Exact commands, journal behavior and storage cautions are in [operations](OPERATIONS.md) and [deployment](DEPLOYMENT.md).

## Gate 3: signed TV application

Prepare a stable private release signer before the physical pilot. Preserve its keystore, alias and credentials outside Git with a private backup. Do not distribute the local debug signer as a production release strategy. Record APK version/code, minimum SDK, SHA-256 and signer certificate; matching signing identity is needed for updates. Follow [TV installation](TV_INSTALLATION.md) for build and model-specific ADB procedures.

From Windows PowerShell, using the actual address and selected device serial:

```powershell
Test-NetConnection -ComputerName <Unraid-IP> -Port <published-port>
Invoke-RestMethod "http://<Unraid-IP>:<published-port>/api/health"
Get-FileHash .\mytuner-tv.apk -Algorithm SHA256
& "C:\actual\platform-tools\adb.exe" devices -l
& "C:\actual\platform-tools\adb.exe" -s "<actual-device-serial>" install -r ".\mytuner-tv.apk"
```

Replace angle-bracket placeholders before execution. Newer Android TV wireless-debugging pairing and connection use different ports. Legacy port5555 works only on devices that support and enable it. ADB pairing is distinct from the public myTuner approval code. Always select the intended device with `-s`; do not use the emulator-only test harness against a real device.

Start with the Bravia, then repeat on the confirmed compatible Fire stick:

1. Launch myTuner, enter its actual Unraid HTTP(S) origin and port, and connect. Native entry accepts an origin, not a path-prefixed proxy URL. Normal HTTPS certificate validation applies; desktop trust does not establish TV trust.
2. Approve the displayed ten hexadecimal characters in a signed-in browser at `http://SERVER:PORT/#connect-tv`. Review the device name before approval. Choose the intended profile, enter its 4–8-digit PIN explicitly, and open its subscribed guide.
3. Disconnect ADB and confirm normal viewing continues. Everyday viewing needs only the TV-to-myTuner application route, not SMB, Plex, Sonarr or Radarr ports.
4. Use D-pad/Back/Play/Pause only: entry, pairing/new code/change address, profiles/PIN, guide, playback controls, browsing, audio/subtitles, caption appearance, recent programs and connection help. Numeric buttons are optional; Fire remotes still need the on-screen PIN keypad. Check errors, pending choices, revoked access and disappearing channels.
5. Pause at a nonzero subtitle cue. Browse without tuning, close dialogs and return; the frame/cue/session must stay paused. Resume behind live, Go Live, switch channels, and return to profiles. Opening another channel is an explicit live join.
6. Press Home/relaunch and cold launch. Protected dialog titles, captions and old private content must not remain; profile/PIN selection returns. Test expired/revoked device authorization, changed server address and restored-server re-pairing.
7. Install an update with the same signer and greater version code. Check intended connection/pairing state; also test clear-data/uninstall/reinstall recovery on the disposable pilot.

## Gate 4: accessibility, representative media and soak

Check 1080p/4K displays, long names/descriptions, font scaling and the model's screen reader. Verify accessible names, focus order/visibility, PIN feedback, errors and dialog dismissal. Browser axe and emulator captures do not certify native assistive-technology behavior. Capture photos when protected hardware video surfaces are absent from screenshots.

Use representative H264/AAC MP4, files requiring HLS conversion, multi-audio and text captions, combined episodes, commercial cutoff/minimum remainders and unavailable intervals. Record picture/sound, cue timing through inserted breaks, transition latency, CPU/memory, bandwidth and storage. Image subtitles/HDR and additional codec claims require their own measured fallback or explicit unsupported outcome.

Run two devices on the same and different profiles. Pausing one must not pause the other. Then run six hours and overnight, including Home/reopen, short network outages and source loss/return. Confirm no idle encoder when viewers leave, paused fetch suppression, bounded cache/generation growth and correct continuing schedules. Keep measured failures visible until corrected and retested.

## Connection diagnosis

| Observation                                            | Next check                                                                                    |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| Health fails on Unraid itself                          | Image startup, bootstrap, mounts and published port.                                          |
| Desktop works, TV does not                             | TV network route, selected origin/port, DNS and TLS trust.                                    |
| IP works, hostname does not                            | DNS on the TV's network; myTuner does not register names.                                     |
| Correct port returns HTML or another service at health | Wrong address/port or proxy route; do not pair there.                                         |
| Health works, pairing/profiles fail                    | Code expiry, API compatibility, approving account, token expiry and profile grants.           |
| Profile guide is empty                                 | Subscriptions, source grants, available programming and PIN state.                            |
| Guide works, media fails                               | Authenticated direct/HLS/subtitle requests, source availability, decoder and server capacity. |

Keep narrowly scoped network changes as a separately approved operator task. Never merge household networks just to make the pilot pass.
