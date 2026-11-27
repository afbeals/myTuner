# Reset application data — safety design and implementation

Status: implemented locally with both required independent multi-agent review rounds complete and all confirmed findings fixed/retested. No household reset has been executed. [The safety review register](RESET_SAFETY_REVIEW.md) records the actual passes, corrections and limits. Earlier general walkthroughs/design research did not count as those rounds.

## Required boundary

The application must never delete data it did not create. Resetting a Source means removing database configuration/references, never deleting the source directory or any video, subtitle or metadata file inside it. Media mounts remain read-only.

The first implementation should be **database-only**. Operate on records in the configured myTuner SQLite database through the normal single-owner server. Never recursively delete appdata, unlink a live database, delete a share or follow source/host paths. A dedicated appdata directory can contain operator-created files, so being inside that directory is not proof that myTuner owns a file.

Generated assets and cache may live outside appdata, including the owner’s dedicated transcoding location. Physical cleanup remains a separate explicit operation over verified app-created files within dedicated configured roots. Do not combine an arbitrary directory-wipe control with database reset. Never follow a symlink or relative path outside a permitted root. Unknown files are always retained. Preserve backups.

## User-facing modes

- **Selective reset:** choose database categories and review the dependent records that must also be removed.
- **Fresh start, keep an administrator:** clear application data while retaining the explicitly identified administrator account and its existing credentials.

The retained administrator must be shown by username and immutable identity. Prefer the original bootstrap administrator only when it can be identified reliably; never infer it from an alphabetically sorted account list. Require an explicit choice if identity is uncertain, and verify that the operator can sign in as the retained administrator. Never permit a result with zero active administrators.

## Selective database categories

| Category                          | Meaning                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Imported/locally indexed metadata | Cached Sonarr/Radarr and sidecar-derived database information; no provider or sidecar writes                             |
| Custom information                | Manually entered titles/descriptions and field-source preferences; separate because these cannot simply be fetched again |
| Catalog/discovery records         | Indexed media, subtitle associations and scan history; no physical files                                                 |
| Sources and integration settings  | Source definitions, API-key records, path mappings and source grants                                                     |
| Collections                       | Saved exact references and retained collection records                                                                   |
| Channels/programming              | Channel definitions, rotations, revisions, subscriptions and dependent schedule/history records as explicitly reviewed   |
| Playback/activity records         | Sessions, retained playback and related telemetry/history                                                                |
| Accounts/profiles                 | All except the explicitly retained administrator when selected; related grants/sessions are included in the preview      |

Checkboxes must reflect dependencies. For example, removing a source can invalidate indexed selections, grants, collections and programming. Automatically required dependent categories must be visibly selected with a reason, rather than silently deleting extra records or leaving broken references. Final counts and consequences are reviewed before submission.

## Execution boundary

The first implementation uses browser preview plus **offline execution**. Existing asynchronous source/metadata requests do not share a complete cancellation registry, so closing a dialog or pausing jobs is insufficient proof that no callback can write. Do not add a destructive live-server endpoint. Stop myTuner, then use the dedicated CLI with exclusive data-directory ownership. The browser shows the exact scope and current administrator; the CLI independently authenticates, reviews and confirms the offline state. There is no persisted reset command to replay after restart or restore.

A persistent database safety record retains old read-only source/metadata/subtitle roots and disables physical output reclamation after reset. Clearing catalog records must not cause later startup, cache eviction or generated-asset reconciliation to delete retained files. Quotas still bound new writes. Physical cleanup/re-enablement requires a separately designed ownership-aware operation and is not part of reset.

## Execution and recovery

1. Admin-only access with administrator password confirmation and a named retained-account check.
2. Create and verify a recoverable backup; retain it outside any cleanup target.
3. Show the exact selected/dependent record counts, retained account and the explicit statement that source files and backups are unaffected.
4. Require the server to be stopped and hold exclusive data-directory ownership. Independently review the offline database and reject a changed revision before execution; no background work/playback is started.
5. Delete records in a transaction with foreign-key integrity; retain schema/migration bookkeeping and the running database/data-lock safety boundary.
6. End affected sessions deliberately and return the retained administrator to a documented sign-in/setup path.

If physical generated/cache cleanup is requested later, inventory and verify ownership **before** discarding database records that establish that ownership. Existing cleanup tools can be used separately while that inventory is available; a later reset must not guess ownership by walking a directory.
