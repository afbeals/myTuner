# Security, permissions and data boundaries

## Scope

The first release targets a household network with explicit authenticated clients. Public internet exposure, federation and anonymous viewing are outside the approved release scope. The server enforces access; hiding a card or a route in the eventual UI is not an authorization mechanism.

Original shares are read-only at two levels: application code reads contained paths and deployment mounts media with `:ro`. Only app data, generated assets and disposable cache roots are writable. myTuner never asks Sonarr/Radarr to mutate their libraries.

## Authority model

| Operation                                      | Admin account                                     | Editor account                             | Viewer account                        | Paired-device session                                                          |
| ---------------------------------------------- | ------------------------------------------------- | ------------------------------------------ | ------------------------------------- | ------------------------------------------------------------------------------ |
| Create/update accounts and reset passwords     | Allowed, with last-admin protection               | Denied                                     | Denied                                | Denied even if account is admin                                                |
| Create profiles, membership and source grants  | Allowed                                           | Denied                                     | Denied                                | Denied                                                                         |
| Register/scan sources or configure integration | Allowed                                           | Denied                                     | Denied                                | Denied                                                                         |
| Manage a profile's PIN                         | Allowed                                           | Owner or `canManage` membership            | Denied                                | Denied                                                                         |
| Create/manage channel programming              | Allowed                                           | Own channels in manageable profile context | Denied                                | Denied                                                                         |
| Publish shared visibility                      | Allowed                                           | Denied                                     | Denied                                | Denied                                                                         |
| Manage subscriptions                           | Allowed                                           | Manageable profile and eligible channel    | Denied                                | Denied                                                                         |
| Browse/watch                                   | All sources/channels, with device PIN rules below | Permitted profile, source and channel      | Permitted profile, source and channel | Viewing routes only; account/profile/source/privacy and PIN checks still apply |
| Request generation/cleanup                     | Allowed                                           | Denied                                     | Denied                                | Denied                                                                         |

A non-admin editor manages a profile only when they own it or have an explicit `canManage` membership. A viewer who owns a profile does not thereby become an editor. A room membership does not reveal someone else's private channels.

An authenticated admin browser/bearer session can perform management without a viewing PIN. A paired admin device still respects PIN-protected viewing. The device route allowlist is an additional restriction above the global role.

## Channel privacy and subscriptions

A private channel is discoverable/viewable only by its owning account and an admin. Other accounts must not see a locked placeholder, title, count, search result, guide entry, programming, preview, statistics or playable endpoint revealing it. Hidden resources return 404. Shared visibility creates a discoverable channel, but source/profile grants still determine eligibility.

A subscription adds a profile's guide reference and grants no media rights. Joining a channel checks visibility/profile/source scope. Source checks use revision and playback position so authorized current programming can operate without leaking retired content retained for paused sessions/history.

Archiving removes subscriptions and playback sessions and hides the channel from viewing/automatic extension. Restoring preserves identity/configuration but does not restore removed subscriptions. Making a channel private does not authorize past subscribers to keep accessing it.

## Passwords, sessions and PINs

Usernames contain 3–64 permitted characters and compare without case. Passwords require 12–1024 characters. Passwords and numeric PINs use random salts with scrypt. Bearer tokens are cryptographically random opaque values; SQLite stores SHA-256 digests rather than raw tokens.

| Credential/control             | Current bound                                                         |
| ------------------------------ | --------------------------------------------------------------------- |
| Browser/script account session | 12 hours                                                              |
| Paired device session          | 30 days                                                               |
| Profile unlock                 | At most 12 hours, tied to one authentication session                  |
| Pairing request                | Five minutes and one successful redemption                            |
| Recommended TV PIN             | Four digits; API permits 4–8 digits                                   |
| Failed account login threshold | Eight failures in a 15-minute window                                  |
| PIN attempt threshold          | Six attempts in a 15-minute account/profile window; success clears it |
| Pairing start/approval/poll    | Operation-specific throttles; obey the returned polling interval      |

Wrong credentials return safe messages. Last enabled admin cannot be disabled/demoted. Account changes, password reset, logout and explicit session revocation remove credentials as applicable. PIN change clears existing unlocks. Fresh TV launch/profile switch clears only that authentication session's unlock/playback state.

Explicit lock, playback startup and profile selection also invalidate pending PIN verifications for the affected authentication session/profile. A correct verification that finishes after that reset returns 409 and cannot recreate its unlock; enter the PIN again. Other sessions are unaffected. Pending attempts are tracked in memory because only the sole server process can own them; persistent unlock records remain in SQLite and no schema change is needed. Existing account/session/PIN rechecks still apply.

PINs are convenient household viewing locks with limited entropy. They are layered on authenticated pairing/account access, not used as a standalone network login.

## Browser and native authentication

Browser login sets an HttpOnly, SameSite=Strict cookie. Cookie-authenticated mutations require the current `X-CSRF-Token` and same-origin checks. CSRF refresh rotates the hash, invalidating the previous token; the browser client serializes in-tab refreshes and retries a rejected mutation once with a refreshed token. Independent tabs can still rotate the shared session token. Login rejects disallowed origins/cross-site requests too.

LAN HTTP uses a non-Secure cookie by default. A trusted HTTPS proxy requires Secure cookies and the exact `MYTUNER_PUBLIC_ORIGIN`. Forwarded headers do not automatically change the trusted public origin. The browser is served from the API origin; permissive cross-origin access is not a current contract.

Native clients/scripts use an Authorization bearer header and protected token storage. Media players must send authentication for all dependent requests. Do not place tokens in playlist URLs, logs, screenshots, Git or design files.

## Source and output authorization

Path normalization rejects absolute/traversal/backslash/null inputs where relative paths are required. Canonical roots and resolved files must remain contained; scan skips symlinks. Source and writable storage may not overlap. Admin-only source configuration does not let a client request arbitrary filesystem playback paths: playback uses catalog IDs.

Source fingerprints are checked for originals, scheduled segments, subtitles and reusable assets. Derivatives inherit the original's profile/source permissions. An asset in cache is not a public asset just because another authorized viewer generated it earlier.

Open original/derivative streams recheck access every second and after mutations. Revocation closes actual streams rather than only hiding the next guide response. In-flight HLS/subtitle work reauthorizes during processing and before delivery. Already downloaded bytes cannot be recalled from a client.

Published schedule extension evaluates the author's current management/source rights through an internal authority context. It does not depend on a browser viewing unlock remaining alive. Disabling/removing the author or management/source grants can prevent future extension; it does not silently create a new unrestricted author.

## Upstream credentials and artwork

Saved API keys use AES-256-GCM with random IVs and authentication tags. The private 32-byte `integration.key` is stored in app data with restrictive creation permissions. Losing it while connections exist blocks startup; recover the matching key rather than generating a replacement that cannot decrypt old settings.

This protects keys stored in the DB file separately from the key; it is not full disk/database encryption. An application snapshot includes the key and must be kept private. Admins and the server host remain trusted boundaries.

Only HTTP(S) configured integration URLs without embedded userinfo/query/fragment are accepted, requests are GET-only, have timeouts and reject redirects. Integrations are admin-configured LAN connections, not an arbitrary fetch proxy for viewers. Artwork additionally restricts requests to configured-host MediaCover paths with MIME/size/time limits and server-side API credentials. Raw upstream image URLs/keys are not returned as public artwork links.

## Logging, backups and remaining review

HTTP logs redact Authorization and Cookie headers. Public JSON excludes password/encrypted-key/CSRF hashes. Do not add request-body logging for credential endpoints or publish full diagnostic files without review; operational errors and paths can still be sensitive host information.

Backups contain account hashes, private-channel metadata and integration secrets/key material. Keep them private and select an external backup/retention process. Restore revokes sessions/pairings/unlocks/playback so credentials from an old snapshot are not revived.

Local tests cover cross-account privacy, source boundaries, forged/expired sessions, CSRF, device scope and open-stream revocation. Real deployment/proxy/volume review and client credential-storage validation remain necessary. See [verification](VERIFICATION.md) and [checklist](CHECKLIST.md) for evidence and pending gates.

## Asynchronous credential changes and revocation

Password verification and hashing yield to other requests. Login rechecks the current stored hash, enabled state and account authority before issuing a session. Account creation rechecks its initiating administrator after hashing and before insertion; local bootstrap is a separate explicit operation. Password/PIN changes recheck the initiating actor after hashing, and PIN unlock rechecks the current PIN hash, authentication session and profile access before writing an unlock. Fresh account reconstruction retains device viewing/PIN restrictions. Password reset, account changes and revoke-all invalidate approved, unconsumed device pairings alongside existing sessions.

Login attempts reserve an attempt synchronously before asynchronous password verification starts, so concurrent requests cannot all enter under the same unconsumed allowance. The selected R2-02 correction and deterministic regression evidence are recorded in [the priority register](IMPLEMENTATION_REVIEW.md) and CHECKLIST.md; the historical second-round finding is no longer pending.

## Retained collections, recent airings and problem reports

Deleted collections stay absent from normal selection/detail/edit/pickers. Recovery requires current owned/admin collection access, profile management and every member's source/subtree grant; no hidden member title/count or partial silent restore is exposed. Expiry removes metadata/member references only. Missing source files may remain unavailable references.

Recent-airing reads require current profile/PIN, subscription and channel authority. They use only the current active revision's authoritative retained prefix, filtering source authority before limiting returned titles. They do not materialize history, open media or create/control sessions.

Report preparation reads the caller's account/auth-session-bound playback reference and rechecks profile/PIN/subscription/channel/media grants. The strict allowlist accepts only category and client family. Server derives summary/time/version/references/route/state; no raw logs, user error text, absolute path, token, PIN, screenshot or upload is accepted. Preparation is a five-minute bounded in-memory capability tied to actor/session; Send rechecks context and permissions. Durable account/request uniqueness handles successful retry without duplicate reports. Idempotency lasts only while that record is retained.

Other accounts cannot enumerate own-report titles/references/counts; reporting-account reads recheck current access before counts/paging. Admin is the global-inbox exception. Paired devices receive only the specific new recent GET and report-send POST capabilities (plus playback report-preview). Device sessions, including those paired by admins, remain unable to list report inboxes, restore collections, manage programming or use admin mutations. These additions do not grant companion control or cross-session playback access.

Reports and soft-deleted references are sensitive application metadata included in DB backups. Configurable default report age30 days and collection grace7 days do not expire older operator-managed backup bundles. No background analytics/offline uploader is introduced.
