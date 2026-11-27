# Generation — detail contract, polling and large-job investigation

Investigation only, base `a67d418`. Root follow-up supporting GEN-02/03; not a substitute for either independent page pass.

## GEN-T01 · P2 · confirmed under simulated slow responses

An isolated synthetic job generated a real thumbnail and reached `completed` on the server. The browser’s first job-detail response was explicitly changed to `running` to represent a previously observed active state. Subsequent real terminal responses were delayed **4.5 seconds**, exceeding the page’s fixed **3-second** polling interval. This is a controlled response-delay experiment, not a measured household-storage delay.

The modal remained “Loading… running” with Cancel job while the queue/API already said completed. Five detail requests started about three seconds apart; later requests were repeatedly aborted before a result could be accepted. Restoring normal latency allowed the next response to update the modal to completed. Both desktop 1440×1000 and narrow 390×844 screenshots were viewed.

`web/src/Management.tsx:1190` increments a tick every three seconds; `useRemote` at `web/src/ui.tsx:185` aborts its previous effect request whenever that version changes. A consistently slower response can therefore prevent the terminal state from arriving indefinitely. Merely stopping polling after observing terminal state does not fix starvation before that observation.

- [ ] Use completion-driven single-flight polling or an equivalent bounded policy: let an in-flight request settle; avoid overlapping polls; back off transient failures and stop frequent polling for terminal jobs.
- [ ] Preserve explicit loading/stale timestamps and retry; selected job/profile/authority changes still cancel and reject stale results.
- [ ] Verify terminal updates eventually arrive when requests exceed the nominal interval, and slower requests never accumulate.

## Detail contract and bounded logs

The first-pass count finding remains independently supported by source: detail route `src/server.ts:1094` returns job plus all tasks, while `GenerationRunner.list()` supplies aggregate counts. The modal expects the aggregates and currently renders NaN progress attributes. Align a summary contract for finite total/completed/failed/reused values and a terminal label.

Task listing returns all items. Legal 5,000-file/three-kind work can produce 15,000 task rows and repeated full responses. GEN-02 needs paged/bounded log retrieval and rendering, a current-work summary and explicit success/failed/reused/cancelled meanings. A collapsed text block by itself does not reduce serialization, transport or memory work. Keep source reads and generated cleanup under existing admission limits; do not introduce file probing per poll.

Evidence: `/private/tmp/mytuner-ui-review/generation-slow/results.json`, `slow-desktop.png`, `slow-narrow.png`, ARIA snapshots and browser/server logs. Script `/private/tmp/mytuner-review-generation-slow.mjs`. Expected route-handler teardown errors in the JSON came from removing delayed Playwright routes when restoring normal latency, not from app code. Browser and fixture closed in `finally`; script exited 0. No installs, app/tests/baselines/version edits, commits or production access.
