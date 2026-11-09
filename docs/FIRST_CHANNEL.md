# Create your first channel

Use this walkthrough after [installing the server](DEPLOYMENT.md#first-installation-on-unraid) and bootstrapping its first administrator. It takes an empty installation through browser playback, then TV setup. The [temporary demo](DEVELOPMENT.md#local-demo-with-mock-data) already has sources, profiles and a channel; use it to explore without your own media.

## Before you start

Open `http://<Unraid-LAN-IP>:<published-host-port>/` and sign in with the administrator you created. This is the myTuner login, separate from Unraid. Have one existing directory of readable videos available to the container. Sonarr/Radarr are optional; Plex is not required.

For the examples, a host directory `/mnt/user/media` is mounted read-only as `/media`, with shows in `/media/shows`. Replace those examples with your actual mappings. A container cannot use an unmapped host path. Keep application data, generated outputs and cache outside all source directories.

## 1. Add and scan a source

1. Open **Sources** and choose **Add source**.
2. Give it a recognizable name, such as TV shows. Set **Container media path** to `/media/shows` in this example. Choose **TV shows · Sonarr optional**; use **Movies · Radarr optional**, **Custom videos** or **Commercials** for the corresponding directory. Leave **Include subfolders** selected when needed.
3. Save, then choose **Scan & refresh metadata** for that source. Adding a source alone does not catalog its files.
4. Review the result. A complete scan should have no unexplained errors and should find your expected files. If it finds nothing, check the container path, read permissions, supported file extensions and whether the directory is online. An incomplete scan is not proof that the missing files were deleted.

For Sonarr/Radarr metadata, save the matching integration for this source, including its URL, key and provider-to-container path mapping, then scan/refresh again. Follow [media discovery](MEDIA_DISCOVERY.md#path-mapping-the-common-integration-issue). Keep keys in the application, never in Git or screenshots. Without an integration, filename/local metadata and custom folders remain usable. This does not download or duplicate videos.

Expected result: the source contains cataloged videos with measured durations. Bulk thumbnail/GIF/conversion generation is a separate optional action.

## 2. Create a profile and grant access

1. Open **Profiles → Create profile**. Name it, for example Living Room. Choose a shared room or personal profile; assign the intended owner for a personal profile.
2. Open **Manage Living Room**. Add the intended account under account access. Select **May manage this profile** only when that account should edit its programming; watching does not require management authority. Administrators create additional accounts in **Accounts**; there is no public signup.
3. In **Allowed library**, choose the source and select **Add library grant**. Leave **Subfolder** blank for the entire source, or enter a source-relative folder for narrower access. Add separate grants for other sources, including commercials if you want them later.
4. Set the optional **TV PIN** and save it. PINs have 4–8 digits. The PIN protects viewing-profile selection; it is separate from the account password and does not grant library access.
5. In the browser's **Current profile** selector, choose Living Room. Open **Library** and confirm its permitted content appears. If another account will approve the TV, that account must have access to this profile too.

An admin can inspect more than a household viewer. Before considering setup complete, verify playback using the intended viewer/account as well as the administrator.

## 3. Create and program a channel

1. Open **Channels**, choose **Create channel**, and enter its name. **Short name** is optional; blank derives a compact label from the name.
2. Choose visibility deliberately. **Shared · household catalog** is available to an administrator and is the usual choice for a household channel watched by several accounts. **Private · only you and administrators** belongs to the creating account; another account cannot see or subscribe to it, even if it can use the same profile. An admin-created private channel is not a way to share content with a separate viewer.
3. Choose **Create & program**. In the programming editor, use **Add content group** if no group exists. Choose **Change content selection** to open **Choose programming content**. Search by title or filename and narrow by source/type. Use **Select** for a whole show, folder, saved collection or individual video; **View seasons** opens season choices. A whole-show selection discovers its usable episodes for you; no manual episode-by-episode scheduling is required.
4. For episodic shows, choose **Ordered · keep episode sequence**. Add other groups to alternate shows. Shuffle varies a rotation; random selection can repeat. Keep commercials off for this first test.
5. Open the **Preview** tab, choose **Generate two-hour preview**, then review the actual upcoming programs. If it reports an empty/unavailable selection, return to scan/grant/library checks. A preview does not publish the channel.
6. Choose **Publish programming**. The channel now has a saved timeline. On later edits, publication activates after the current program and its associated breaks; it does not interrupt the current airing. The editor distinguishes your draft, preview and saved programming. Channel-detail saves and commercial-rule application have their own controls; preview the final draft before publication.

To rename an existing channel, choose **Edit details** in its row or channel preview. **Save channel details** immediately saves name, optional short name, description and visibility without preview/publication. **Edit programming** changes groups/commercials; its own **Edit details** action retains the open programming draft. Cancel/Close confirms unsaved details; a pending save may still complete after closing. For show/movie/video information, open **Library → Open details → Edit information**. Choose the source independently for title and description: automatic, Sonarr/Radarr, local metadata file or manual input. **Check metadata files** reads existing NFO files; it does not create sidecars. Configure a separate read-only descriptive metadata directory under **Sources → Configure → Read-only metadata location** when needed. Review availability and save the chosen values. See [metadata editing](METADATA_EDITING.md).

The picker and programming/commercial controls share the same retained draft. Full state/frame, assistive-technology and physical-device acceptance remain separately tracked in [the checklist](CHECKLIST.md).

## 4. Subscribe and watch in the browser

1. Open **Subscriptions** with Living Room selected. Find the channel and choose **Subscribe**. Creating a channel and subscribing a profile are separate actions.
2. Open **Watch TV**, select the channel, then **Watch live**. Playback joins the current point in the shared broadcast. The first episode may already be partway through because the channel advances even with no viewers.
3. Try **Pause**, **Resume** and **Go Live**. Pause affects only this playback session; Go Live returns it to the current broadcast. Confirm the expected picture and sound before installing on the TV.

If the channel is absent, check visibility/ownership, profile membership, source grants, publication and subscription in that order. A subscription never grants access to otherwise hidden content. If the browser works but the TV cannot connect, check the TV-to-server network path separately.

## 5. Load the TV app

Follow [TV installation and connection](TV_INSTALLATION.md) for the Bravia/Google TV APK or Android-based Fire OS stick. Enter the same server's reachable LAN origin, approve the exact TV code from a browser signed in as the intended account, then select Living Room and enter its PIN. Its subscribed channel should appear in the guide.

A successful desktop/browser test does not prove that an IoT network can reach Unraid or that the TV supports every media format. Exact-device/network acceptance remains required.

## Add commercials or another source later

Store each commercial as its own existing file in a separate commercial source, scan it, and grant the profile access. The channel's **Commercials** tab selects its pool and timing/repeat rules. Apply the rules, preview, then publish. Cutoff mode can shorten an eligible ad to the remaining break budget; the default six-second minimum skips tiny remaining breaks and returns to the show. Source files remain unchanged. [Commercial timing](SCHEDULING_AND_PLAYBACK.md#cutoff-mode-and-minimum-remaining-time) and [the synthetic demo exercise](DEVELOPMENT.md#try-a-cutoff-commercial-in-the-demo) explain the controls.
