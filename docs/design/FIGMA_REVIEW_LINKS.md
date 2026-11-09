> Preserved supplied design reference. Its backend status/gap statements may describe an older checkpoint; read [current reconciliation](../DESIGN_REVIEW.md) and [current API contracts](../BACKEND.md). Design review is not production UI approval.

# myTuner — Figma design review links

Added **58 canonical frames and seven linked review journeys**. Everything remains in the private draft, and the original mockups are preserved.

Start with the [Figma review index](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=40-241).

**For the implementation agent:** copy the contents of the [complete handoff](./FIGMA_HANDOFF.md). It includes every frame link, selected decisions, API mappings, open questions, and validation guidance. The expanded designs still need your approval before production UI implementation.

## Design pages

| Design area                                                                                             | Includes                                                              |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [Selected layouts](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=22-236)                  | Option 1 TV guide; Schedule First manager with channel preview        |
| [Setup, accounts and sources](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=25-236)       | Sign-in, source setup, integrations, permissions and pairing approval |
| [Library and collections](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=26-236)           | Shows, seasons, episodes, folders, movies and availability            |
| [Channels and commercials](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=27-236)          | Rotation, commercial rules, schedule preview and edit timing          |
| [Subscriptions and generation](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=28-236)      | Profile lineups, job scope, progress, retry and cancellation          |
| [Browser viewing](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=29-236)                   | Guide, live playback, local pause, resume and Go Live                 |
| [TV application](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=30-236)                    | Connection, pairing, profiles/PIN, playback and remote focus notes    |
| [Responsive layouts](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=31-236)                | 1024px compact and 390px narrow browser layouts                       |
| [Recovery states](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=32-236)                   | Loading, empty, offline, denied access and pairing failures           |
| [Foundations and components](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=33-245)        | Palette, typography, spacing, motion and interaction states           |
| [Implementation decisions and gaps](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=40-365) | Product rules and missing API contracts                               |
| [Copy inventory](https://www.figma.com/design/lAXmTA1teK8MqqogAqvRlr?node-id=41-236)                    | 804 unique visible strings with frame references                      |

## Prototype journeys

[Open the prototype menu](https://www.figma.com/proto/lAXmTA1teK8MqqogAqvRlr?node-id=36-9412&starting-point-node-id=36%3A9412), or jump directly into a journey:

1. [Sources → metadata → season selection](https://www.figma.com/proto/lAXmTA1teK8MqqogAqvRlr?node-id=36-9429&starting-point-node-id=36%3A9429)
2. [Custom folder → private shuffled channel](https://www.figma.com/proto/lAXmTA1teK8MqqogAqvRlr?node-id=36-10187&starting-point-node-id=36%3A10187)
3. [Subscribe → personal guide → live](https://www.figma.com/proto/lAXmTA1teK8MqqogAqvRlr?node-id=36-10734&starting-point-node-id=36%3A10734)
4. [Commercial pool → repeat limits → preview](https://www.figma.com/proto/lAXmTA1teK8MqqogAqvRlr?node-id=36-11032&starting-point-node-id=36%3A11032)
5. [Generation → retry → recursive conversion → cancel](https://www.figma.com/proto/lAXmTA1teK8MqqogAqvRlr?node-id=36-12949&starting-point-node-id=36%3A12949)
6. [TV pairing → PIN → pause → resume → Go Live](https://www.figma.com/proto/lAXmTA1teK8MqqogAqvRlr?node-id=36-13534&starting-point-node-id=36%3A13534)
7. [Integration failure → recovery → unavailable program](https://www.figma.com/proto/lAXmTA1teK8MqqogAqvRlr?node-id=36-14109&starting-point-node-id=36%3A14109)

The prototypes use scripted sample data. API gaps and hardware validation remain documented in the handoff.
