# Supplied Figma handoff and implementation reconciliation

## Received design references

The supplied review-links file points to a private Figma draft with 58 canonical frames and seven linked review journeys, as reported by the design handoff. Silver Signal is the selected visual direction, with Option 1 now/next TV guide and the Schedule First browser manager plus right-side channel preview.

- [Figma review index](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=40-241)
- [TV screens and remote focus notes](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=30-236)
- [T0: server connection](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=30-241)
- [T1: pairing approval](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=30-272)
- [Browser: approve a TV](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=25-638)
- [TV pairing/PIN/playback review journey](https://www.figma.com/proto/lAXmTA1teK8MqqogAqvRlr?node-id=36-13534&starting-point-node-id=36%3A13534)
- [Preserved review links](design/FIGMA_REVIEW_LINKS.md)
- [Preserved complete handoff](design/FIGMA_HANDOFF.md)

The two supplied Markdown files are preserved locally under docs/design so their references do not depend on temporary files. Their API gap inventory describes an earlier backend checkpoint and is historical; use the reconciliation below and current [BACKEND.md](BACKEND.md). The private Figma file's access/sharing/designs were not changed.

Before the sixth review round, the owner also approved implementing the twenty selected extensions using the existing Silver Signal visual system; see [the selected scope](SELECTED_IMPROVEMENTS.md) and [extension brief](SELECTED_DESIGN_BRIEF.md). No separate extension-design approval is pending.

The owner has now explicitly approved the designs and authorized implementation. Earlier approval-pending statements in the preserved handoff are historical. Browser and TV implementation may proceed against the current contracts; product/design mismatches should be raised with the owner.

## TV-first delivery requirement

A working television experience is the primary product goal. Delivery includes a tested installable client, not only a browser preview or a server container. Follow [TV_INSTALLATION.md](TV_INSTALLATION.md) for Bravia/Google TV installation, Fire OS installation, Unraid endpoint setup, approval, profiles/PIN and acceptance.

The intended journey is:

```text
Build and install signed TV APK
  -> Open from TV/Fire Apps
  -> Enter Unraid myTuner base address (T0)
  -> Approve returned code in signed-in browser (T1 / A6)
  -> Select permitted profile (T2)
  -> Enter its PIN if protected (T3)
  -> Subscribed guide (T4)
  -> Live playback, local pause/resume/Go Live (T5–T7)
```

An installation guide, actual release/build location and tested model/OS matrix must accompany the eventual client artifact. The server-address screen also needs a route to edit/recover a changed/offline endpoint. Device-token expiry/revocation and server restore must lead to a comprehensible re-pair flow.

## Reconcile the supplied handoff with the current backend

| Handoff topic                                                             | Current implementation and remaining work                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser cookie/CSRF and account/PIN lifecycle listed as gaps              | Implemented server contracts exist, including browser login/CSRF, account list/edit/reset, profile edits, numeric PINs and device scope. Browser and native wiring is implemented; full state/hardware acceptance remains open.              |
| Persistent integration keys/refresh and library aggregates listed as gaps | Encrypted saved connections, periodic refresh, authorized show/season/folder views, dynamic selectors and collection routes are implemented. Actual upstream/version acceptance remains open.                                                |
| Initial schedule rejects a second publish                                 | This describes the legacy explicit-ID route. Current recurring programming preview/PUT supports boundary-safe edits and retained revisions; use those contracts.                                                                             |
| Guide/HLS/conversion/revocation/retention listed as gaps                  | Core services are implemented. Actual browser/Media3 delivery, transitions, buffering, track timing and hardware remain open.                                                                                                                |
| Generation retry creates another scope job                                | Dedicated retry exists and preserves completed results. Presets are currently fixed, so controls must not imply arbitrary configurable encoding settings.                                                                                    |
| snake_case public responses                                               | Public JSON now normalizes camelCase and parsed metadata. Core JSON Schemas are available at the authenticated contracts endpoint.                                                                                                           |
| Six-character pairing example `J4K 8N2`                                   | Current API generates/accepts ten hexadecimal characters. Adapt displayed grouping/copy to the returned code and submit the actual ungrouped value, or deliberately revise the contract with tests.                                          |
| `http://mytuner.local:8777` sample address                                | DNS/name registration is not implemented. Use a real reachable IP/DNS name and published port; cross-network routing is separate.                                                                                                            |
| Dynamic collections and ordered source wording                            | Whole shows/seasons/folders/provider collections resolve dynamically; user reference collections are fixed. Ordering is numerical season/episode then natural title/ID, not arbitrary UI order.                                              |
| Commercial appearances per rotation                                       | Counters operate on a commercial pool accounting cycle, reset once all current clips reach the threshold, and combine with per-break/cooldown/duration caps. UI should avoid implying a daily/lifetime cap.                                  |
| Commercial cutoff and minimum remaining time                              | Owner requested configurable cutoff after initial handoff. Existing form primitives now expose whole-file/cutoff policy and minimum remaining seconds (default 6); no additional screen or layout pattern. Short remainders resume the show. |
| Missing tracked-only metadata representation                              | Library is based on scanned files and retained unavailable rows; a fully undownloaded Sonarr show/episode does not automatically appear as a playable library entry.                                                                         |

Use [MEDIA_DISCOVERY.md](MEDIA_DISCOVERY.md), [SCHEDULING_AND_PLAYBACK.md](SCHEDULING_AND_PLAYBACK.md) and [SECURITY.md](SECURITY.md) for exact behavior. Screen fixtures/copy are references, not authority to expose private data or invent APIs.

## Historical documentation-only review

Read the supplied review links and complete handoff, and retrieved current Figma metadata for T0 and T1 to verify the address/pairing screen references. This was a targeted read of connection flows, not a complete visual approval, accessibility audit or revalidation of all 58 frames/prototype edges. No product UI code, Figma edits, device install or Unraid network change was performed.

## Implementation review

The implementation pass retrieved screen-level Figma design contexts/screenshots for the browser manager/library/channel builder/management/player/responsive views and TV connection/pairing/profiles/PIN/guide/player states. React/CSS and Kotlin views adapt the Silver Signal colors, local fonts, panels and focus styles. Browser screenshot baselines and native emulator screenshots provide local comparison evidence; a complete frame-by-frame, native pixel-baseline and assistive-technology review remains open. The pairing panel displays the actual ten-character code with an expiration countdown.

## Owner clarification: channel labels

Use the configured full channel name, with an optional user-supplied short name up to 12 characters. If absent, derive up to four initials (or the first four letters for one word). There are no channel numbers. UUIDs remain immutable internal identity. This supersedes numbered design fixtures.
