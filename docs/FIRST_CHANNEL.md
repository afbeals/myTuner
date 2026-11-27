# Create your first channel

Use this walkthrough after [installing the server through Unraid’s Docker tab](UNRAID_DOCKER_TAB.md) and creating its first administrator. It describes the 0.3.0 browser interface. The [temporary demo](DEVELOPMENT.md#local-demo-with-mock-data) already contains sources, profiles and a channel for inspection without household media.

## Before you start

Open `http://<Unraid-LAN-IP>:<published-host-port>/` and sign in with the administrator you created. This is the myTuner login, separate from Unraid. Select a viewing profile if prompted. Have an existing readable video directory mounted in the container. Sonarr/Radarr are optional; Plex is not required.

For example, an Unraid host directory `/mnt/user/media/media/tv` may be mounted read-only as `/tv`. In myTuner, use `/tv`, not the host path. Keep application data, generated outputs and cache outside all source directories.

## 1. Add and scan a source

1. Open **Sources → Add source**. Enter a recognizable name, such as TV shows.
2. Set **Media directory inside MyTuner** to the container path, such as `/tv`. Mounted-directory suggestions and **Choose media directory** can help locate it; the folder picker opens only on request. **Check directory** performs a small read-only check of a typed path. It does not inspect every video or replace scanning.
3. Choose the media type and whether to include subfolders, then choose **Add source**. Use separate sources for physically separate roots, such as regular TV and anime. Use folder selections within a source when channels should cover different subfolders; overlapping sources are unnecessary.
4. If Sonarr/Radarr is used, open **Configure**, then choose **Connect Sonarr** or **Connect Radarr**. Enter the application address and API key. Add each paired path mapping: the left input is the path Sonarr/Radarr sees; the right input is the equivalent directory inside myTuner. For example, `/media_tv` → `/tv`. Choose **Save configuration** once after reviewing the sections.
5. Choose **Scan & refresh metadata** on the source card. In the scan dialog, choose whether to refresh connected metadata and select **Start scan**. Review scan completeness/errors and provider matches separately. You may close the dialog while the server continues; reopening shows status.

A complete scan should find the expected files without unexplained errors. An incomplete scan does not prove missing files were deleted. Check the container path, mount/read permissions and supported extensions if results are empty. Saved API keys remain masked; mapping-only edits at the same application address can leave the key input blank. Changing provider/address requires an explicit key or a compatible saved connection. [Media discovery](MEDIA_DISCOVERY.md) explains ordering and mappings.

Expected result: the source contains cataloged videos with measured durations. Scanning neither copies media nor starts optional thumbnail/GIF/conversion generation.

## 2. Create a profile and grant access

1. Open **Profiles → Create profile**. Name it, for example Living Room. Choose **Shared room** or **Personal**; a personal profile needs an owner. Administrators create login accounts in **Accounts**; there is no public signup.
2. Choose **Manage Living Room**. In **Account access**, check the accounts permitted to use it. Only eligible editors need **Manage** permission. Owners/administrators have implicit access; a viewer remains a viewer even if they own a profile.
3. In **Allowed library**, choose a source and **Choose folders**. Select its root for the entire source or select indexed subfolders for narrower access. Confirm the folder selection. Add other sources as needed, including a commercial source if commercials will be used later.
4. In **TV PIN**, choose **Set PIN** and enter matching **New TV PIN** and **Confirm TV PIN** values. PINs have 4–8 digits. Leave the existing PIN unchanged when editing unrelated settings.
5. Choose **Save profile** once in the footer. Membership, grants and PIN changes are staged until that save; Cancel discards them. If a conflict reports another edit, reopen and review the saved state before retrying.
6. Choose Living Room as the current profile, then open **My Network** and confirm its permitted library appears. The account that approves a TV must also have access to this profile.

An administrator can inspect more than another household account. Verify the final viewing experience with the intended account too. A profile PIN protects selection of an already-permitted profile; it does not add source rights or reveal another account’s private channel.

## 3. Choose content in My Network

**My Network** places channels above **Your library**. A source indexes existing files. A collection saves a fixed set of video references. A channel schedules selections as a continuous broadcast. [The My Network guide](MY_NETWORK.md) explains the complete relationship.

For a whole show, season, folder or existing collection, use the channel wizard’s programming picker in the next step. Whole-show/folder choices can include newly discovered files later, avoiding manual episode scheduling.

For selected episodes or custom videos, open a library card, check the exact videos, then use the **Add … videos to tray** footer button. **Select all on this page** affects the current loaded page, not every video on the server. You can add more from other cards/searches. Create a reusable collection from the tray, or choose **Create channel from tray** for a fixed explicit selection. The tray contains references only, is limited to 5,000 videos, and clears when its profile/context is discarded. Original files stay where they are.

## 4. Create and preview the channel

1. In **My Network**, choose **Create channel** or **Create channel from tray**.
2. **Channel details:** enter the name, optional short name and description. Blank short name derives a label from the name. Choose visibility deliberately: **Private · you and administrators** belongs to the creating account; **Shared · available to permitted profiles** is an administrator option. Sharing still does not grant media access.
3. **Programming:** add content groups and use **Choose programming content** to choose shows, seasons, folders, collections or individual files. Select a result, then **Use selection** to apply it to the group. Use **Ordered** for episode sequence, or a shuffle/random mode when appropriate. Multiple groups can alternate. Choose **Next** to continue.
4. **Commercials (optional):** leave commercials disabled for the first test. This step may be revisited before submission.
5. **Preview and create:** choose **Generate preview**, review the upcoming programs and duration display, then choose **Create channel**. The server creates the channel and publishes its initial programming together. An empty/unavailable selection needs correction before creation. A preview alone saves no channel.

Back returns to earlier steps without losing the draft. Changing the draft or catalog can invalidate a preview; generate a fresh one when asked. Cancel discards the unsaved new channel. After successful creation, an uncertain repeated final request uses the same draft identity to avoid duplicating it.

For an existing channel, **Edit details** saves name, short name, description and visibility independently. **Edit programming** retains the existing editor’s preview/publication flow. Programming edits activate after the current program and its related breaks, preserving paused viewers’ retained revisions. Archiving removes subscriptions; restoration does not resubscribe profiles. Permanent deletion is available only when dependency checks permit it; retained schedules/history are not silently erased.

## 5. Subscribe and watch in the browser

1. Open **Profiles**, then **Subscriptions for Living Room** beside Manage. Check the eligible channel and arrange the selected lineup if desired. Choose **Save subscriptions**. Creating a channel and subscribing a profile remain separate actions. The older Subscriptions link still opens the same modal workflow.
2. Open **Watch TV**, choose Living Room and the channel, then **Watch live**. Playback joins the current point in its broadcast; the first episode may already be underway because channels advance without viewers.
3. Try **Pause**, **Resume**, **Go Live**, volume/mute, and the available audio/subtitle controls. Pause affects only this playback session. Resume stays behind live; Go Live rejoins the broadcast. Track choices depend on the file and supported formats. See [audio/subtitle setup](SUBTITLES.md).

If the channel is absent, check visibility/ownership, profile membership, source grants, publication and subscription. A shared room does not make another user’s private channels visible. An admin-added subscription cannot bypass that rule. Browser success does not establish TV-to-server networking or decoding compatibility.

## 6. Load and connect the TV app

Follow [TV installation and connection](TV_INSTALLATION.md) for Sony Bravia Android/Google TV first, or an Android-based Fire OS stick. Install the compatible signed APK, enter the reachable server origin, approve the exact displayed TV code from a browser signed in as the intended account, then select Living Room and enter its PIN. Its subscribed channels appear in the guide.

The TV/stick needs network access to the published myTuner port; it does not mount media shares or connect directly to Sonarr/Radarr. Exact model/OS, household media and network acceptance remain required.

## Add commercials and edit information later

Keep each commercial as its own existing file, mount the commercial source read-only, scan it and grant the profile access. Configure its pool/timing/repeat rules in the wizard or existing channel’s Commercials editor, then preview and create/publish. Cutoff mode can shorten an eligible clip to the remaining break budget; the default six-second minimum skips tiny remaining breaks and returns to the show. Original files remain unchanged. See [commercial timing](SCHEDULING_AND_PLAYBACK.md#cutoff-mode-and-minimum-remaining-time).

For descriptions and titles, open the show/movie/video in **My Network → Your library**, then **Edit information**. Choose each field’s source independently: Automatic, Sonarr/Radarr, an existing local NFO file or manual input. Configure a separate metadata directory through **Sources → Configure → Metadata** if needed. **Check metadata files** reads existing files; it writes no sidecars. See [metadata editing](METADATA_EDITING.md).
