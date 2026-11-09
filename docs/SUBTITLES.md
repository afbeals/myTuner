# Audio and subtitle setup

myTuner offers audio streams embedded in a video and supported embedded/external text subtitles through the browser and TV track menus. Original video and subtitle files remain read-only. Separate external audio files, image-subtitle conversion/burn-in and preservation of rich ASS styling are outside this implementation.

## Automatic subtitle discovery

Add and scan a media source normally. Subtitle discovery is enabled by default. It searches beside each video and inside `Subs` and `Subtitles` folders, including two nested directory levels by default. Supported text extensions are `.srt`, `.vtt`, `.ass` and `.ssa`; `.sup`, `.idx` and `.sub` are shown as unsupported rather than advertised as playable text.

A filename must match the video's full basename, optionally followed by dot-separated labels. For example:

```text
/media/shows/Orbit/Season 1/Orbit.S01E01.mkv
/media/shows/Orbit/Season 1/Orbit.S01E01.fr.vtt
/media/shows/Orbit/Season 1/Subs/Orbit.S01E01.en.forced.srt
```

Both matching captions are discovered for episode 1. Matching is Unicode-normalized and case-insensitive. Language tags, `forced` and `sdh`/`cc` labels are retained. A generic `English.srt` remains ambiguous and needs an explicit admin association. Another episode's nonmatching subtitle can also appear as ambiguous; the application never guesses a video from directory order.

## Configure search locations

As an administrator, open **Sources → Configure** for the source, then **Subtitle search locations**. Configure automatic discovery, comma-separated relative subtitle subdirectories, recursion depth 0–4 and an optional separate server/container subtitle root. Up to eight relative subdirectories are accepted. These settings are independent of descriptive NFO metadata locations.

A separate root mirrors the media source's relative directory structure. If the source is `/media/shows`, the video above has relative path `Orbit/Season 1/Orbit.S01E01.mkv`; a separate root `/subtitles/shows` searches:

```text
/subtitles/shows/Orbit/Season 1/Orbit.S01E01.en.srt
/subtitles/shows/Orbit/Season 1/Subs/Orbit.S01E01.en.srt
```

The root must already exist and be readable by the server. Mount it read-only in Docker; see [deployment](DEPLOYMENT.md#optional-separate-subtitle-mount). It must not overlap application writable storage or another media source. Traversal and symlink escapes are rejected.

**Save subtitle settings** persists configuration but does not run a scan. Scan the source or open a video's details and choose **Check / Rescan subtitles**. A settings change marks prior associations as needing a check before playback. Cancel restores the saved settings; closing/navigating with a draft asks before discarding it. Failed saves preserve the draft. A concurrent save fails with a conflict; reopen/reload and review the current configuration before retrying.

## Inspect and manually associate a file

Open **Library → show/folder/movie → video details**. **Stored technical metadata** labels embedded streams. **Subtitle discovery** lists external formats, language/forced/SDH, origin, support/status and last check. Administrators also see paths relative to the configured roots. Viewers receive authorized labels/status without raw filesystem locations.

Status meanings:

| State        | Meaning and next action                                                                           |
| ------------ | ------------------------------------------------------------------------------------------------- |
| Not checked  | No completed external discovery yet; run a scan/check                                             |
| Found        | Matching or explicitly associated supported file recorded; delivery still revalidates it          |
| Ambiguous    | No deterministic video match; admin must review and associate explicitly                          |
| Unsupported  | Recognized image/unsupported format; not offered as a text playback track                         |
| Missing      | A successful check no longer found a previously recorded file                                     |
| Needs-check  | Video fingerprint or source configuration changed; recheck before using the association           |
| Failed check | Previous results/last success retained; inspect mounts, permissions and search limits, then retry |
| No matches   | A successful check found no external candidates                                                   |

For an ambiguous or unusual filename, click **Review** or enter its relative filename. Choose **Media source** or **Configured subtitle root**, then **Check subtitle candidate**. This preview reads the file and reports format/size/support without changing the association. **Save subtitle association** requires that preview and checks the video's revision, settings and file fingerprint again. It stores the association in SQLite; it never renames, copies or rewrites the subtitle. **Cancel subtitle draft** clears an unsaved choice. Successful rescans preserve valid manual associations. A replaced video or changed location settings requires a fresh check/association. There is no separate removal/reset control for a still-valid saved manual association in this POC.

Files must be between one byte and 10 MiB. A check visits at most 100 directories, each with at most 2,000 entries, and considers at most 512 subtitle candidates per video. Directory listings are reused within a source scan, with a bounded 256-directory cache. At most 2,048 historical track rows per video are retained; exceeding that bound stops new publication with a failed-check result. Narrow the search/source rather than repeatedly adding unrelated captions. Limit failures preserve previous associations and publish no partial new set.

## Watching with captions and alternate audio

In the browser player or native TV controls, open **Subtitles** and choose a supported track. External labels include language, discovery origin and format. **Off** disables captions. **Audio** selects embedded audio; a nondefault selection uses authenticated HLS. Language preferences resolve against each new delivery's track identifiers rather than assuming stream indices are identical across videos.

Text cues use original media time, including resume offsets after a mid-program commercial. Captions clear during a commercial without that track and return with the program. Pause retains the current picture/cue and stops delivery; Resume stays behind live; Go Live joins the current timeline. Selecting a track does not change another device's session. Caption failures show a retry message while healthy video and controls continue. Native late-response and browser error-recovery regressions are recorded in [verification](VERIFICATION.md).

Authenticated WebVTT URLs are relative server routes. No arbitrary file URL is exposed. Every request checks the video's current profile/source access, source/subtitle fingerprints and current association. Revocation, replaced files and settings changes invalidate stale access. Conversion uses a fixed text demuxer, a restricted protocol list and bounded FFmpeg work; output goes only to managed cache. Cached captions and artwork have independent 64 MiB budgets, one-day expiry and least-recently-used eviction with 32 MiB free reserve. See [operations](OPERATIONS.md#storage-cleanup).

## Persistence and validation

Schema 15 stores source configuration/revision, check history and stable track associations. Application backup/restore includes these database records, not the original caption files. Keep original read-only mounts available at their configured paths after restore. Conversion cache is disposable and rebuilt on demand. Old-schema restore validation also protects source and subtitle roots from writable-directory overlap.

[Verification](VERIFICATION.md) records synthetic discovery/security/persistence tests, browser journeys/screenshots and native emulator execution. Representative household formats, physical Bravia/Fire OS decoders, assistive technology and long-duration playback remain separate acceptance. Follow [pilot acceptance](PILOT_ACCEPTANCE.md) before household rollout.
