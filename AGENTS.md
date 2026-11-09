# myTuner repository instructions

Personal project; Pineapple/Airbnb repository rules do not apply here.

- Read docs/MYTUNER_PLAN.md and update docs/CHECKLIST.md as behavior is implemented and verified. Record commands/limitations in docs/VERIFICATION.md.
- Browser/TV UI uses the owner-approved Silver Signal designs. The owner also approved implementing the selected extensions in docs/SELECTED_IMPROVEMENTS.md using that visual system; follow docs/SELECTED_DESIGN_BRIEF.md and raise material product/design mismatches.
- Source media is read-only: no moves, renames, deletions, source copies, or sidecars. Derivatives belong only in configured generated/cache roots outside sources.
- Never commit real media, generated assets, databases, runtime data, or credentials. Tests create synthetic media in temporary directories.
- Legacy sidecar-generator and ErsatzTV deployment are historical only; do not run them against the media library.
- Private channels and their media must be invisible to other accounts, including metadata, counts, manifests, and previews. Admin is the sole cross-owner exception.
- Obtain explicit user approval before installing host software or development toolchains, including SDKs and emulators in temporary directories. Authorization to develop or test does not authorize those installations.
- The owner approved continuing the project within documented acceptable-use conditions and reusing the existing Android SDK/emulator toolchain on 2026-11-08. Obtain approval before installing any additional software or toolchain components.

- The owner deferred remaining emulator verification after tooling stalls on 2026-11-08. Do not resume it as part of the current handoff; record scope/results in docs/VERIFICATION.md and docs/differed.md. Existing toolchain authorization does not authorize additional installations.
