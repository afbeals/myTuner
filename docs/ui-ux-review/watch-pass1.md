# Watch TV — owner review, pass 1

Route confirmed: `/#watch`, containing guide and active player. Base: `a67d418cf7258e669b11fcc9cae63cdc1bcda92d`. Isolated synthetic runtime: `127.0.0.1:19008`; designer, Living Room; 1440×1000 and 390×844. Native review was Kotlin-only; no emulator/device execution.

Evidence: `/private/tmp/mytuner-ui-review/watch-p1/`: visually inspected `desktop-guide.png`, `desktop-paused.png`, `desktop-paused-hidden.png`, `narrow-paused.png`, `narrow-browse.png`, `narrow-report-summary.png`, `narrow-profiles.png`; additional guide/playing/recent/empty screenshots and ARIA snapshots; `observations.json`, `targeted.json`, `browser-events.json`, `server.log`. Actual synthetic MP4 playback reached readyState 4, 320×180, currentTime 1.164 before pausing. No injected states. Events showed expected pre-login `/api/auth/me` 401 only; no CSP violations.

## Owner dispositions and current behavior

**WAT-01 — layout preference/proposed change.** Guide already has channel list plus selected details at desktop; active player does not. Active player has a brand/profile/navigation header, wide video with six overlay actions, a separate status/navigation block, and settings underneath. “Channel guide” is duplicated. At 390px mobile navigation and player each repeat myTuner; profile/navigation take substantial space before the picture.

**GLO-07 — partly present, missing time; black frame not reproduced.** Pause displays “Paused on this device”, program/series title, episode and a progress bar. The last frame remains visible, including after Hide controls: a 14,599-character in-memory JPEG poster survives unloading delivery (readyState becomes 0). No app-rendered numeric current time appears. The timestamp visible in the synthetic image is burned into the test video, not a player control. Native code has `setKeepContentOnPlayerReset(true)`, pauses/stops/clears media and displays PAUSED ON THIS DEVICE with title/context. This supports intended frame retention but cannot establish hardware behavior. Native context also lacks readable elapsed time.

**GLO-01/06/08** apply to browse, profile, recent-airing and report dialogs and paused-tune confirmation. **GLO-03** Watch hides the desktop sidebar; keep a clear manager return and coordinated lineup-modal entry. **GLO-04/05** retain live/pause consequences; move lengthy optional language/caption explanations into accessible information controls, preserving a usable preview and current choices. **GLO-10** not reproduced. GLO-02/09/11 have no directory/search/programming-preview surface here.

## Ranked findings and acceptance

### WAT-P1-01 · P2 · bug · Narrow player clips Go Live and navigation

Repro: watch After School → Pause → 390×844. Stage spans y307–898 with `overflow:hidden`; Go Live spans y917–965 and Previous/Next y981–1029 (`targeted.json`). Full-page screenshot still omits these actions; ordinary page scrolling cannot reveal content clipped by its parent. Horizontal width remains 390px.

Recommendation: let narrow controls determine content height; constrain the video independently. Acceptance: visible, reachable Resume/Go Live/previous-next at 390px and increased text size; focus must never move into clipped controls. Keep video aspect ratio and avoid shrinking text to fit.

### WAT-P1-02 · P2 · bug · “Watch live” on current paused channel does nothing

Repro: Pause → Browse channels → Watch After School live → accept native “Watch this channel live and discard the current paused position?” Dialog closes but Resume and Paused remain. `tune()` sets the same channel ID, so the keyed Player does not restart.

Recommendation: current-channel Watch live invokes the explicit Go Live operation, or guarantees fresh-session tuning. Acceptance: accepting joins live; cancelling preserves exact pause/session; browsing alone and closing Browse preserve pause. Replace native confirmation with shared app confirmation naming channel and lost pause. Do not alter browser-owned tab-close handling.

### WAT-P1-03 · P2 · owner request · Contextual two-column active-player layout

Apply WAT-01 with picture plus current program/settings beneath in the main column; profile selector and ordered channel list in the other. Header should prioritize current channel/program and concise live/behind-live context. Remove duplicate guide actions. On narrow screens stack picture/context, primary controls, then selectors/settings; keep essential selection access discoverable.

Acceptance: focus/selection only previews now/next and never retunes; explicit Watch live alone changes sessions; profile changes immediately clear old player/title/private data; same saved lineup order drives list and previous/next. Other Profile currently clears playback and shows an honest empty guide; preserve that behavior. Edit profile lineup must adopt SUB-01’s correctly targeted profile modal.

### WAT-P1-04 · P2 · owner request · Readable pause position

Add elapsed/total program time such as `01:05 / 22:18`, derived from paused session position and source offset, with separate airing/behind-live context. Keep title and a compact paused indicator when controls are hidden if the owner wants an always-visible pause treatment. Acceptance: time freezes during pause, resumes correctly, handles commercials and missing metadata, and never substitutes wall-clock time for playhead position. Preserve frame retention and stopped delivery fetching.

## Interaction results, shared adoption and decisions

Browse modal traps Tab from final Watch action to Close; Escape restores Browse channels focus and preserves Resume. Hide controls moves focus to Show controls. Recently aired explains retained schedules and showed a valid empty state. Report opens without sending; Review summary exposes the prepared data and explicit Send (not activated). Its long narrow content scrolls; Send initially falls below the dialog viewport. Adopt the shared sticky modal header/footer in all four Watch dialogs; keep Close/Send reachable while only the body scrolls.

Global supplies modal/confirmation, responsive action layout and accessible information controls; Watch adopts them in each named flow. A shared readable-duration formatter can serve browser/native pause displays with platform-specific rendering. Preserve Silver Signal colors, one active video and bounded metadata fetching.

Decisions: exact persistent hidden-controls pause treatment; program elapsed time versus scheduled-airing position labels; profile-switch pause-discard warning consistency; relationship between persistent side selection and existing Browse modal. Native frame/time acceptance remains deferred, not passed. No P0/P1 confirmed; multi-channel long-name, HLS and native hardware variants remain unverified.

Code: `web/src/Player.tsx:26,243,352,594,660,751,870,912`; `web/src/App.tsx:51,151,258`; `web/src/styles.css:625,886,1110,1142`; `web/src/ui.tsx:242`; `web/src/Retained.tsx:17,163`; `src/playback.ts:224`; `android/app/src/main/java/tv/mytuner/app/MainActivity.kt:990,1244,1283,1471`.

Cleanup: both bounded Watch scripts reached `finally` and printed CLOSED after closing browser and isolated fixture. No build/install/download, real media, product/test/version/deployment edits or emulator use.
