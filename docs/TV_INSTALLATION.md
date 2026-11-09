# Install myTuner on a TV and connect it to Unraid

## Current availability and priority

**Primary target: the Sony Bravia running Android TV or Google TV. Secondary target: an Android-based Amazon Fire TV stick.** The intended result is a normal app in the device's Apps screen: open myTuner, select a profile, enter its PIN and watch its channel guide.

**Version 0.2.0 has a native Android/Fire OS TV project and a locally built, debug-signed POC APK.** The artifact is `android/app/build/outputs/apk/debug/app-debug.apk` in this checkout. No app-store listing or public release download exists. The steps below apply to this build; device addresses/debugging ports remain examples. Local emulator evidence is separate from physical Bravia/Fire OS acceptance, which is still required. No physical TV or Unraid server was accessed or modified.

The Figma handoff is recorded in [DESIGN_REVIEW.md](DESIGN_REVIEW.md). Screen T0 covers server entry, T1 covers pairing, and T2–T4 cover profiles/PIN/guide. Installation happens before those screens. Producing a signed APK and validating these instructions on the actual devices are delivery requirements in [CHECKLIST.md](CHECKLIST.md).

## What runs where

```text
Sony Bravia TV app or Fire OS stick app
       |
       | authenticated HTTP(S), including media requests
       v
Unraid address + myTuner host port
       |
       v
myTuner Docker server -> SQLite/app data
       |
       +-> existing show/movie/commercial shares, read-only
```

Install the TV app on the Bravia or stick. Run the server container on Unraid. The TV does not run Docker, mount the media shares, open SQLite, or connect directly to Sonarr/Radarr/Plex. Its one server address is enough for the app's API and video delivery.

ADB is a temporary installation/development connection from a computer to the TV/stick. It is separate from myTuner's everyday TV-to-Unraid connection and can be disabled after installation.

## Before installing

Record the exact Bravia model/OS version and Fire stick model/OS version. A Sony television without Android TV/Google TV cannot install this APK. The Fire route below applies to **Android-based Fire OS**. Vega OS devices require a different client and are outside the current target; the Fire TV branding alone does not establish APK compatibility. Check the device's About screen and Amazon's device/OS list.

Have these ready:

- A tested, signed, standalone TV APK from our build, with its version, minimum OS, supported CPU ABIs, package ID and checksum documented. A Play Store `.aab` is not directly installable with `adb install`.
- A computer with current [Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools); verify `adb version`. Use the appropriate executable path if adb is not on PATH.
- A reachable Unraid server with the myTuner container running and its application port published.
- A created account, permitted profile/source grants, at least one published channel and a subscription for that profile. Follow [Create your first channel](FIRST_CHANNEL.md), then configure its optional numeric PIN.
- A browser able to sign in to the same server to approve the TV. Open the implemented browser approval screen at `http://UNRAID-LAN-IP:8777/#connect-tv`.

Keep the release signing key outside Git and preserve it for updates. An APK must support the device OS/ABI and remote navigation; successful sideloading alone does not prove playback compatibility.

## Build the installable POC APK

This checkout uses Gradle 8.11.1 (wrapper included), Android Gradle Plugin 8.9.2, Kotlin 2.1.20 and Media3 1.6.1. Use Java 17 or 21, Android platform 35 and build-tools 35.0.0, plus current platform-tools. Set `ANDROID_HOME` to your SDK location or configure untracked `android/local.properties` with `sdk.dir`.

```sh
cd android
./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug
cd .. # Return to the repository root for the following commands.
```

Back at the repository root, the resulting installable file is `android/app/build/outputs/apk/debug/app-debug.apk` (or `app/build/outputs/apk/debug/app-debug.apk` relative to `android/`). It is debug-signed for personal POC sideloading. APK metadata: application ID **tv.mytuner.app**, version name **0.2.0**, version code **2**, minimum Android SDK **23**, target SDK **35**. It contains managed code without app-specific native ABI libraries. Platform decoder support must still be tested on each device.

Verify the actual artifact before copying/installing it:

```sh
shasum -a 256 android/app/build/outputs/apk/debug/app-debug.apk
"$ANDROID_HOME/build-tools/35.0.0/apksigner" verify --verbose android/app/build/outputs/apk/debug/app-debug.apk
```

The locally verified 0.2.0/code 2 artifact after the final language-alias and local state/recovery corrections has SHA-256 `33638fd5c85d095fe98e7738b9702d2ed04dbda52c91e747f22f8db4cdeff36d`. `apksigner verify` passes v1/v2 signatures; signer certificate SHA-256 is `23f659f4da56763f641ee46182828bd9dd53190b2ae8befa8e6500c73f63cf31` (Android Debug). These values identify this local build only; a rebuild or different signer can change them.

Keep the same private debug keystore for POC updates; a CI-generated debug key may differ from this machine’s key. Preserve a stable private release key outside Git before distributing longer-lived builds. To release-sign without committing secrets: build `:app:assembleRelease`, align the unsigned release APK with SDK `zipalign`, then use `apksigner sign --ks /private/path/to/keystore --ks-key-alias <alias> --out /private/path/mytuner-tv-0.2.0.apk <aligned-apk>`. Let the signer prompt for passwords. Verify that artifact and record its own checksum; do not reuse the debug checksum or signing identity.

The matching server/browser build is `npm run build`. Docker builds include `web-dist` and local fonts, and the Unraid WebUI link opens `/`. Build/tag scripts read version 0.2.0 from `package.json`. Set `MYTUNER_VERSION=0.2.0` in the deployment `.env` to select that accepted image tag; no published image or APK is implied by this document.

## 1. Prepare the Unraid endpoint

Use [DEPLOYMENT.md](DEPLOYMENT.md) for mounts, runtime identity, bootstrap and startup. Preserve data/generated/cache volumes and mount original media/commercials read-only. Bootstrap the first admin while the server is stopped, then start the normal container.

For the supplied bridge/port-mapping setup, myTuner listens on container port 8777 and publishes host port 8777 by default. The server address entered on the TV is:

```text
http://<UNRAID_LAN_IP>:<MYTUNER_HOST_PORT>
```

For example, if Unraid is `192.168.1.10` and its published host port is `8777`, enter `http://192.168.1.10:8777`. If the host mapping is `18877:8777`, use `http://192.168.1.10:18877`.

| Value                                                       | Use it for                                                                                         |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Unraid LAN IP and published app port                        | Normal bridge-mode client connection                                                               |
| Explicitly assigned custom Docker LAN IP and listening port | Only if the container was deliberately deployed with that reachable address                        |
| `localhost`, `127.0.0.1`, `0.0.0.0`                         | Never the remote server address on the TV; loopback is the TV itself and 0.0.0.0 is a bind address |
| Container name such as `mytuner`, or ephemeral bridge IP    | Usually internal Docker communication, not the TV's destination                                    |
| `/media`, `/mnt/user/...`, SMB path or Plex URL             | Server-side content locations/services, not the myTuner endpoint                                   |
| `/api/health`                                               | Diagnostic URL appended to the base address, not the base address saved by the app                 |

From a computer on a network permitted to reach the server, open the example diagnostic URL:

```text
http://192.168.1.10:8777/api/health
```

The current server returns JSON including `status: "ok"` and `service: "mytuner"`. Its root URL serves the browser manager after the combined server/web build. Health proves basic reachability/process/DB response; it does not establish that the TV network can reach it or that a video decodes correctly. Test the actual TV connection as well.

Use an IP first if local DNS is uncertain. Figma's `mytuner.local` is an example: no automatic name registration or cross-VLAN discovery is provided. A stable DHCP reservation or managed DNS record can prevent address changes; that configuration is an infrastructure follow-up.

For HTTPS, enter the trusted reverse-proxy base origin instead, set the server's explicit public origin/Secure-cookie settings correctly, and use a certificate trusted by the TV. Do not solve certificate errors by globally disabling certificate verification. This Android client explicitly permits LAN HTTP and validates its paired server origin. Trusted HTTPS uses normal system certificate verification.

## 2. Install on Sony Bravia Android TV / Google TV

Menu labels vary by firmware. Use the actual model's settings/help when labels differ; do not assume every Bravia exposes the same debugging transport.

1. On the TV, open Settings → System → About on Google TV, or Settings → Device Preferences → About on older Android TV. Find Android TV OS build/Build and select it seven times to enable developer options.
2. Return to System/Device Preferences → Developer options. Enable the supported debugging option for this firmware. Enable Wireless debugging when that feature is available, or the vendor's ADB/network debugging option. USB debugging alone does not guarantee an IP listener.
3. Find the TV IP in Network settings. Keep the installation computer and TV on the same trusted network for the documented ADB setup, or use an explicitly permitted development route. Do not change the household's network isolation blindly.
4. Choose one of the connection methods below. Accept the computer's debugging authorization on the TV if prompted.

### Method A: Wireless debugging with pairing

On firmware that exposes Wireless debugging, select Pair device with pairing code. Use the IP, pairing port and code shown on the TV. Android's current documentation lists wireless debugging for TV on Android 13+; availability still depends on firmware. The code is an ADB pairing code, separate from the later myTuner pairing code.

Illustrative commands, replacing addresses/ports with the values displayed on the TV:

```sh
adb pair "192.168.50.42:37123"
```

Enter the TV's displayed ADB pairing code when prompted. Then use the **connection** IP/port from the main Wireless debugging page; it can differ from the pairing port:

```sh
adb connect "192.168.50.42:39547"
adb devices -l
adb -s "192.168.50.42:39547" install -r "/absolute/path/to/mytuner-tv.apk"
```

Use the actual device serial reported by `adb devices -l` if it differs from the sample address. A successful install reports `Success`.

### Method B: Firmware-provided network ADB

If the TV explicitly supports network ADB and exposes port 5555, use its real IP/port:

```sh
adb connect "192.168.50.42:5555"
adb devices -l
adb -s "192.168.50.42:5555" install -r "/absolute/path/to/mytuner-tv.apk"
```

Do not assume port 5555 is enabled just because the TV has developer options. If neither method exists on the actual model, confirm a Sony-supported development connection or use a compatible external Fire OS/Android TV device. Do not root the TV or use unsupported cable/debugging steps to force installation.

### Open the app

Open Apps → myTuner on the TV and optionally add it to the home/favorites row. The APK includes Android and TV launcher entries and a banner; if adb reports success but myTuner is absent from Apps, diagnose the package/launcher rather than concluding it installed correctly for TV use.

Continue with the server connection and pairing steps below. Once installation/debug validation is finished, disconnect adb and disable debugging if it is no longer needed. Disabling adb does not revoke myTuner pairing or prevent normal playback.

## 3. Install on an Android-based Amazon Fire TV stick

1. Verify the stick runs a supported Android-based Fire OS, not Vega OS. Record its model/OS from Settings → My Fire TV → About.
2. Open Settings → My Fire TV → Developer Options. On software that hides the menu, go to About, highlight/select the device entry seven times, then return to My Fire TV.
3. Enable ADB Debugging. Amazon's instructions also enable Apps from Unknown Sources; on newer firmware, installation permissions may be named Install unknown apps or assigned per installer. Permit only the trusted installation path required by that firmware. These settings do not make APKs compatible with Vega.
4. Find the stick's IP under About → Network or Network settings. Put the installation computer on the same trusted network or a deliberately allowed development route.
5. Connect, accept the on-screen debugging authorization, and install the APK:

```sh
adb connect "192.168.50.60:5555"
adb devices -l
adb -s "192.168.50.60:5555" install -r "/absolute/path/to/mytuner-tv.apk"
```

Replace the sample IP/port and APK path with actual values. If authorization was pending, accept it and retry connection/install. Use `-s` to avoid installing on a different connected device.

6. Open Apps/Your Apps & Channels → myTuner. Menu placement varies; the client must be packaged to appear in the Fire TV launcher and work with its remote.
7. Use the same Unraid connection/pairing flow as the Bravia. The Fire stick connects through its own network interface; the television showing its HDMI output does not provide the stick's server connection.
8. Disconnect adb and turn off debugging when no longer needed. Normal myTuner viewing still works.

POC sideloading avoids depending on a public store release. Google Play/Amazon Appstore distribution can be a later decision with separate signing, account, review and update requirements. No store listing/download link is currently promised.

## 4. Connect the installed app to Unraid

This flow is implemented in the current POC and follows the approved designs. Emulator verification is recorded in VERIFICATION.md; exact Bravia/Fire OS acceptance remains pending.

1. Open myTuner on the Bravia/stick. At **Connect to your server**, enter the base address from step 1, such as `http://192.168.1.10:8777`.
2. Select Connect. The client validates the address and myTuner health-service identity, then saves the server origin. Connection failures display an error. **Connection help** shows the saved origin, last successful health check, server/API details and error category, with an explicit server check. Health success alone does not prove media playback.
3. The app starts pairing using a model-based device name and displays the server-returned user code with its expiry. A user-editable nickname is a proposed improvement.
4. On a computer/phone browser connected to the **same myTuner server**, sign in as the account whose permitted profiles should be available on this device. In the browser manager choose **Connect TV**, enter the displayed user code and choose **Review TV**. Compare the device name, server origin, exact code and expiry with the intended TV/server, confirm the browser is signed in as the intended approving account, then choose **Approve TV**. This is not the Unraid administrator login or an approval in Plex.
5. Keep the TV pairing screen open while it polls. Pairing is single-use and expires after five minutes; request a new code if it expires. Once approved, the client stores the viewing token in protected app storage.
6. The app clears old viewing unlock/state, lists permitted profiles, and lets the viewer select one. Enter its 4–8-digit PIN if protected; four digits are recommended for remote convenience.
7. Load that profile's subscribed channel guide. Select a channel to join the broadcast at its current live position.

The current API returns a **ten-character hexadecimal user code**, not Figma's six-character example. Display and submit the real returned code; if the UI groups characters visually, remove display spaces before submission. Do not substitute a fixed code, silently truncate it or use the ADB debugging code here. See [design reconciliation](DESIGN_REVIEW.md).

Pairing persists until expiry/revocation; a fresh app launch returns to profile selection/PIN without typing an account password with the remote. Device tokens currently last 30 days. An expired or revoked token returns the client to pairing; clearer renewal/re-pairing explanations are proposed in IMPROVEMENTS.md. Profile switching resets this device's viewing state and repeats PIN entry without interrupting other devices.

The TV connects only to myTuner; Sonarr/Radarr API keys and media share passwords stay on the server. An empty guide usually means profile/subscription/grant setup needs attention, not another media app must be installed.

## Everyday remote controls

| Control                                               | Result                                                                                                               |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| D-pad and OK                                          | Move focus and activate the selected profile, PIN digit, guide item or playback action.                              |
| Number/Delete/Enter keys, when supplied by the remote | Enter/edit/submit the PIN; the on-screen keypad remains available.                                                   |
| Pause / Resume                                        | Pause or continue only this device's playback session.                                                               |
| Go Live                                               | Discard this session's delay and join the current broadcast.                                                         |
| Audio / Subtitles                                     | Choose the current audio or available text-caption track; Off disables captions.                                     |
| Back                                                  | Close a dialog or visible player overlay first, then return from player to guide; from guide/PIN return to profiles. |
| Home, then reopen                                     | Stop this device's playback and return to profile/PIN selection on relaunch.                                         |

Press Back to hide player controls; press a remote direction/OK to reveal them. Automatic inactivity dismissal remains unselected. **Browse channels** opens the in-player channel list while retaining the current session and pause; choose **Watch live** to switch deliberately. **Connection help** shows diagnostics. In **Devices & sessions**, inspect the device label and last-seen information before revoking the intended entry.

## Networks, addresses and ports

The app's ordinary requirement is TV/stick → myTuner TCP host port, for example 8777, or the configured HTTPS endpoint. Responses and video use the same application service; clients do not need direct SQLite/SMB/Sonarr/Radarr ports. A reverse proxy must pass authenticated range, playlist and segment requests correctly.

The TV may stay on its current IoT/TV network when a narrow routing/firewall rule permits this connection. The app cannot bypass SSID/VLAN isolation. A successful test from an Ethernet desktop does not prove the TV network has access. Explicit IP/DNS entry avoids reliance on multicast discovery, but routing/firewall/DNS changes remain separate infrastructure work.

The installation computer → TV adb port is different. Wireless debugging may use changing ports, and older Fire/TV network ADB often uses 5555. These developer ports are not myTuner server ports and should not be exposed publicly. No internet port-forwarding is needed for the home-network POC.

## Updates, disconnecting and removal

For an update, supply a compatible APK with the same application ID/signing identity and appropriate version, then repeat the target-specific `adb ... install -r ...`. Normal update is intended to preserve app storage/pairing; test it on both targets. A debug-signed and release-signed APK are not interchangeable updates merely because filenames match. Do not uninstall as a routine workaround for a signing failure: uninstall/clear-data removes saved server/pairing state.

To revoke a lost/shared device, use the authenticated **Devices & sessions** screen. Disable accounts or reset passwords when broader revocation is intended. To remove the app, use the device's normal Apps settings; revoke its server-side session too if appropriate. Reinstallation or cleared app data requires entering the server/pairing again.

Rebuilding/updating the Unraid image should preserve server data and not require reinstalling the TV app when contracts remain compatible. Restoring server application data deliberately revokes authentication/pairing/playback sessions, so expect sign-in/re-pairing afterward. To change the saved origin, choose **Change server** from pairing/profiles or **More options → Connection help → Change server address** during playback; connect and pair again.

## Troubleshooting

| Symptom                                  | Likely boundary and next action                                                                                               |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `adb` not found                          | Install Platform-Tools or use its full executable path                                                                        |
| ADB `unauthorized`                       | Accept this computer's debugging authorization on the correct device                                                          |
| ADB connection refused/timeouts          | Confirm debugging feature/listener, actual IP/port and development-network reachability; do not assume every Bravia uses 5555 |
| Wireless pair succeeds, connect fails    | Use the separate connection port; inspect `adb devices -l` and current network                                                |
| APK incompatible/parse/ABI error         | Verify Android-based OS, minimum SDK/ABI, complete signed APK and installed signing identity; Vega needs a different client   |
| Install succeeds but no app tile         | Verify TV/Fire launcher intent/banner/package requirements and actual target installed                                        |
| TV cannot find server but desktop can    | Check TV network isolation, endpoint/bind/host mapping and DNS; try correct LAN IP                                            |
| Connection rejected for HTTP/certificate | Check Android cleartext policy or certificate trust; desktop health alone doesn't validate Android networking                 |
| Pairing rejected/expired                 | Same server, actual returned ten-hex-character code, expiry and authenticated browser approval; request a fresh code          |
| Profile missing/locked                   | Check approving account's memberships and profile PIN; pairing grants no extra access                                         |
| Guide empty or channel hidden            | Create subscriptions/published programming and source grants; private channels remain owner/admin only                        |
| Guide works but video fails              | Check read-only mount access, fingerprint/availability, authenticated media requests, codec negotiation and server logs       |
| Playback buffers/stutters                | Measure actual Wi-Fi/server CPU/transcoding latency and player behavior; app install/TV cleanup isn't a throughput guarantee  |

## Installation and connection acceptance

Before marking TV delivery complete, record the exact models/OS, APK version/signing/package/ABI, server image/config, address/network and observed results. Verify first install, launch tile/remote input, server entry, health/errors, real approval, profile PIN, subscription guide and actual video. Exercise commercial transitions, audio/subtitles, local pause/resume/Go Live and a second device continuing independently.

Also verify warm/cold restart, expired/revoked device token, wrong/changed server address, offline server, permission revocation, signed APK update preserving state, cleared-data re-pairing and server restore re-pairing. Keep real-device performance and screenshot/focus evidence separate from synthetic server tests.

## Official platform references

- [Android TV application setup and launcher requirements](https://developer.android.com/training/tv/get-started/create)
- [Android Debug Bridge: wireless pairing, device targeting and APK installation](https://developer.android.com/tools/adb)
- [Android SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools)
- [Amazon: connect to Fire TV through ADB](https://developer.amazon.com/docs/fire-tv/connecting-adb-to-device.html)
- [Amazon Fire OS and device OS overview](https://developer.amazon.com/docs/fire-tv/fire-os-overview.html)

Official pages were consulted for the written procedure; the actual Bravia/stick menus, packaging and playback still need validation on the user's devices.

## Developer appendix

The installation and household-use instructions above do not require these API details.

## Developer mapping for this flow

| Step                | Existing backend contract                                                 | Client obligation                                                                    |
| ------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Server reachability | `GET /api/health`                                                         | Use configured base origin; don't treat health as complete playback acceptance       |
| Start pairing       | `POST /api/auth/pairings` with `{deviceName}`                             | Keep private deviceCode private; display returned userCode/expiry                    |
| Approve in browser  | `POST /api/auth/pairings/approve` with `{userCode}`                       | Signed-in browser; current CSRF token for cookie mutation                            |
| Poll                | `POST /api/auth/pairings/poll` with `{deviceCode}`                        | Honor returned polling interval; store one-time approved token                       |
| Fresh launch        | `POST /api/playback/startup`                                              | Authenticate with saved device token; discard old playback/unlock state              |
| Profile selection   | `GET /api/profiles`, then `POST /api/playback/profiles/:profileId/select` | Show membership-filtered profiles and lock state                                     |
| Unlock              | `POST /api/profiles/:profileId/unlock` with `{pin}`                       | Respect wrong-PIN/throttle errors; don't cache a PIN as an account credential        |
| Guide               | `GET /api/profiles/:profileId/guide`                                      | Subscription-only guide, no global private-channel discovery                         |
| Play                | `POST /api/playback/sessions`, then `.../:sessionId/negotiate`            | Pass auth to every original/HLS/segment/subtitle request and handle timeline offsets |

Open the server’s browser root, sign in and select **Connect TV**, or use `http://UNRAID-LAN-IP:8777/#connect-tv`. Enter the exact ten-character code displayed by the television; visual grouping spaces are removed on submission. The route uses a hash: `/connect-tv` is not the application route. Approval requires the authenticated account and browser CSRF; the TV polls until approved, then stores its viewing-only token securely.

## Windows-assisted physical pilot

[The pilot runbook](PILOT_ACCEPTANCE.md) supplies PowerShell reachability, checksum and explicitly selected ADB installation commands; a model/OS/signing checklist; the Bravia-first then Fire procedure; re-pair/update/restore cases; and separate network, screen-reader, two-device and soak acceptance. [The Windows Docker guide](WINDOWS_DOCKER.md) prepares and transfers the server image independently of APK installation. No physical-device test is claimed by these instructions.
