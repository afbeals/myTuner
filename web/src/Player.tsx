import { Artwork } from "./Library";
import {
  readPreferences,
  storePreferences,
  matchLanguage,
  language,
  type ViewingPreferences,
} from "./viewing-preferences";
import { RecentPrograms, ProblemReport } from "./Retained";
import { useEffect, useRef, useState } from "react";
import type Hls from "hls.js";
import type { Workspace } from "./App";
import type { Delivery, GuideChannel, Media, Playback } from "./types";
import { api, ApiError } from "./api";
import {
  Action,
  Empty,
  ErrorBox,
  Load,
  Select,
  Modal,
  time,
  useRemote,
} from "./ui";
import { eventId, parseVtt, type Cue } from "./playback-utils";
export function WatchPage(
  props: Workspace & { channelId: string | null; onLeave: () => void },
) {
  const guide = useRemote<{ channels: GuideChannel[] }>(
      `/api/profiles/${props.profileId}/guide`,
      props.version,
      true,
    ),
    [tick, setTick] = useState(0),
    [recent, setRecent] = useState<string | null>(null),
    [focusedChannel, setFocusedChannel] = useState<string | null>(null);
  const focused =
    guide.data?.channels.find((c) => c.id === focusedChannel) ??
    guide.data?.channels[0];
  const focusedEntry = focused?.entries.find((e) => e.endMs > Date.now());
  const focusedNext = focused?.entries.find(
    (e) => e.endMs > Date.now() && e.programId !== focusedEntry?.programId,
  );
  const focusedMedia = useRemote<Media>(
    !props.channelId && focusedEntry?.mediaId
      ? `/api/profiles/${props.profileId}/media/${focusedEntry.mediaId}`
      : null,
  );
  useEffect(() => {
    const timer = setInterval(() => setTick((v) => v + 1), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (tick) guide.reload();
  }, [tick]);
  const profile = props.profiles.find((p) => p.id === props.profileId);
  if (props.channelId)
    return (
      <Player
        key={`${props.profileId}:${props.channelId}`}
        {...props}
        channels={guide.data?.channels ?? []}
      />
    );
  return (
    <>
      <div className="silver-bar">
        <h2>myTuner</h2>
        <strong>{profile?.name}</strong>
        <button className="secondary" onClick={props.chooseProfile}>
          Switch profile
        </button>
        <a
          className="button secondary"
          href={props.account.role === "viewer" ? "#profiles" : "#channels"}
        >
          My network
        </a>
        <span>{time(Date.now())}</span>
      </div>
      <header className="page-head">
        <div>
          <span className="eyebrow">{profile?.name} / Channels</span>
          <h1>On your channels</h1>
          <p>Now and next in one readable guide. Every channel joins live.</p>
        </div>
        {props.account.role !== "viewer" && (
          <a className="button secondary" href="#subscriptions">
            Edit profile lineup
          </a>
        )}
      </header>
      {recent && (
        <RecentPrograms
          key={`${props.profileId}:${recent}`}
          profileId={props.profileId}
          channelId={recent}
          onClose={() => setRecent(null)}
        />
      )}
      <Load {...guide} retry={guide.reload} />
      <div className="browser-guide-layout">
        <div className="guide-list">
          {guide.data?.channels.map((c) => {
            const now = Date.now(),
              entries = c.entries.filter((e) => e.endMs > now),
              current = entries[0],
              next = entries.find((e) => e.programId !== current?.programId);
            return (
              <article
                className={`guide-row ${focused?.id === c.id ? "guide-selected" : ""}`}
                key={c.id}
                onFocus={() => setFocusedChannel(c.id)}
              >
                <div>
                  <span className="eyebrow">
                    {c.shortName} · {c.name}
                  </span>
                  <button
                    className="guide-preview-action secondary"
                    onClick={() => setFocusedChannel(c.id)}
                    aria-label={`Preview ${c.name}`}
                  >
                    Details
                  </button>
                  <small>{c.visibility}</small>
                  {c.description && (
                    <p className="metadata-preview">{c.description}</p>
                  )}
                </div>
                <div>
                  <h2>{current?.title ?? "No programming"}</h2>
                  <small>
                    {current
                      ? `${time(current.startMs)} – ${time(current.endMs)}`
                      : "Ask an administrator to publish a schedule."}
                  </small>
                  {current && !current.available && (
                    <span className="badge">Unavailable interval</span>
                  )}
                </div>
                <div>
                  <p>Next · {next?.title ?? "More to come"}</p>
                  {c.error && <small>{c.error}</small>}
                </div>
                <button className="secondary" onClick={() => setRecent(c.id)}>
                  Recently aired on {c.name}
                </button>
                <button disabled={!current} onClick={() => props.watch(c.id)}>
                  Watch live
                </button>
              </article>
            );
          })}
        </div>
        {focused && (
          <section
            className="panel guide-preview"
            aria-label="Selected channel details"
          >
            <Artwork
              {...(focusedMedia.data?.metadata.images?.[0]?.url
                ? { url: focusedMedia.data.metadata.images[0].url }
                : {})}
            />
            <span className="eyebrow">
              {focused.shortName} · {focused.name}
            </span>
            <h2>{focusedEntry?.title ?? "No programming"}</h2>
            <p>{focused.description}</p>
            <Load {...focusedMedia} retry={focusedMedia.reload} />
            <p>{focusedMedia.data?.metadata.overview}</p>
            <button
              disabled={!focusedEntry}
              onClick={() => props.watch(focused.id)}
            >
              Watch {focused.name} live
            </button>
            <p>Up next · {focusedNext?.title ?? "More to come"}</p>
          </section>
        )}
      </div>
      {guide.data?.channels.length === 0 && (
        <Empty title="Your guide is empty">
          Subscribe this profile to permitted channels to start watching.
        </Empty>
      )}
    </>
  );
}
function Player(
  props: Workspace & {
    channelId: string | null;
    onLeave: () => void;
    channels: GuideChannel[];
  },
) {
  const stage = useRef<HTMLDivElement>(null),
    video = useRef<HTMLVideoElement>(null),
    hls = useRef<Hls | null>(null),
    snapshot = useRef<Playback | null>(null),
    controlSequence = useRef(0),
    controlPending = useRef(false),
    controlRecovery = useRef(false),
    [session, setSession] = useState<Playback | null>(null),
    [delivery, setDelivery] = useState<Delivery | null>(null),
    [media, setMedia] = useState<Media | null>(null),
    [error, setError] = useState<unknown>(null),
    [pollError, setPollError] = useState<unknown>(null),
    [loading, setLoading] = useState(true),
    [restart, setRestart] = useState(0),
    [joinAttempt, setJoinAttempt] = useState(0),
    [controlling, setControlling] = useState(false),
    [forceHls, setForceHls] = useState(false),
    [audio, setAudio] = useState(-1),
    [subtitle, setSubtitle] = useState(-1),
    [cue, setCue] = useState(""),
    [pausedFrame, setPausedFrame] = useState<string | undefined>(),
    cues = useRef<Cue[]>([]),
    [needsPlay, setNeedsPlay] = useState(false),
    [recentOpen, setRecentOpen] = useState(false),
    [reportOpen, setReportOpen] = useState(false),
    [browseOpen, setBrowseOpen] = useState(false),
    [overlayOpen, setOverlayOpen] = useState(true),
    [captionError, setCaptionError] = useState<unknown>(null),
    [preferences, setPreferences] = useState(() =>
      readPreferences(props.profileId),
    );
  const audioChosen = useRef<{
    entryId: string | undefined;
    index: number;
  } | null>(null);
  const subtitleChosen = useRef<{
    entryId: string | undefined;
    index: number;
  } | null>(null);
  const preferenceRef = useRef(preferences);
  const savePreferences = (next: ViewingPreferences) => {
    preferenceRef.current = next;
    setPreferences(next);
    storePreferences(props.profileId, next);
  };
  const tune = (id: string) => {
    if (
      !snapshot.current?.paused ||
      window.confirm(
        "Watch this channel live and discard the current paused position?",
      )
    ) {
      setBrowseOpen(false);
      props.watch(id);
    }
  };

  const update = (s: Playback) => {
    snapshot.current = s;
    setSession(s);
  };
  useEffect(() => {
    setError(null);
    setPollError(null);
    setLoading(true);
    controlPending.current = false;
    controlRecovery.current = false;
    setControlling(false);
    let current = true,
      pollingFailed = false,
      id: string | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      if (!id || !current) return;
      if (controlPending.current) {
        timer = setTimeout(() => void poll(), 1000);
        return;
      }
      const sequence = controlSequence.current;
      try {
        const s = await api<Playback>(`/api/playback/sessions/${id}`);
        if (current && sequence === controlSequence.current) {
          update(s);
          setPollError(null);
          const recoveringControl = controlRecovery.current;
          if (recoveringControl) {
            controlRecovery.current = false;
            setControlling(false);
            setError(null);
          }
          if (pollingFailed || recoveringControl) {
            pollingFailed = false;
            if (!s.paused && s.available) setRestart((n) => n + 1);
          }
        }
      } catch (e) {
        if (current && sequence === controlSequence.current) {
          pollingFailed = true;
          setPollError(e);
          video.current?.pause();
          hls.current?.stopLoad();
        }
      }
      if (current) timer = setTimeout(() => void poll(), 1000);
    }
    void api<Playback>("/api/playback/sessions", "POST", {
      profileId: props.profileId,
      channelId: props.channelId,
    })
      .then((s) => {
        id = s.id;
        if (!current) {
          void api(`/api/playback/sessions/${s.id}`, "DELETE").catch(() => {});
          return;
        }
        update(s);
        timer = setTimeout(() => void poll(), 1000);
      })
      .catch((e) => {
        if (current) {
          setError(e);
          setLoading(false);
        }
      });
    return () => {
      current = false;
      controlSequence.current++;
      clearTimeout(timer);
      video.current?.pause();
      hls.current?.destroy();
      hls.current = null;
      if (id)
        void api(`/api/playback/sessions/${id}`, "DELETE").catch(() => {});
    };
  }, [props.profileId, props.channelId, joinAttempt]);
  const entryId = session?.playback?.entry.id,
    revisionId = session?.revisionId,
    paused = session?.paused ?? false;
  useEffect(() => {
    audioChosen.current = null;
    subtitleChosen.current = null;
    setAudio(-1);
    setSubtitle(-1);
    setPausedFrame(undefined);
    cues.current = [];
    setCue("");
  }, [entryId]);
  useEffect(() => {
    if (
      controlling ||
      !session?.id ||
      !session.playback ||
      !session.available ||
      paused
    ) {
      if (session && !session.available) {
        setLoading(false);
        video.current?.pause();
        hls.current?.stopLoad();
      }
      return;
    }
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    setNeedsPlay(false);
    const el = video.current;
    if (!el) return;
    hls.current?.destroy();
    hls.current = null;
    el.pause();
    el.removeAttribute("src");
    el.load();
    async function open() {
      const capable =
        !forceHls &&
        audio < 0 &&
        Boolean(el!.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'));
      const d = await api<Delivery>(
        `/api/playback/sessions/${session!.id}/negotiate`,
        "POST",
        {
          containers: capable ? ["mp4", "m4v"] : [],
          videoCodecs: capable ? ["h264"] : [],
          audioCodecs: capable ? ["aac", "mp3"] : [],
        },
        controller.signal,
      );
      if (!active) return;
      const matchedAudio = matchLanguage(
        preferenceRef.current.audio,
        d.tracks.filter((t) => t.type === "audio"),
      );
      const preferredAudio =
        audioChosen.current && audioChosen.current.entryId === entryId
          ? audioChosen.current.index
          : matchedAudio;
      if (audio !== preferredAudio) {
        setAudio(preferredAudio);
        return;
      }
      setSubtitle(
        subtitleChosen.current && subtitleChosen.current.entryId === entryId
          ? subtitleChosen.current.index
          : preferenceRef.current.subtitleOff
            ? -1
            : matchLanguage(
                preferenceRef.current.subtitle,
                d.tracks.filter((t) => t.type === "subtitle" && t.url),
              ),
      );
      setDelivery(d);
      const item = await api<Media>(
        `/api/profiles/${props.profileId}/media/${session!.playback!.entry.mediaId}`,
        "GET",
        undefined,
        controller.signal,
      );
      if (!active) return;
      setMedia(item);
      const url = d.url + (audio >= 0 ? `?audioTrack=${audio}` : "");
      const play = () => {
        if (!active) return;
        void el!
          .play()
          .then(() => {
            if (active) {
              setLoading(false);
              setNeedsPlay(false);
            }
          })
          .catch((e) => {
            if (active) {
              setLoading(false);
              if (e instanceof DOMException && e.name === "NotAllowedError")
                setNeedsPlay(true);
              else setError(e);
            }
          });
      };
      if (d.mode === "direct") {
        el!.src = url;
        el!.onloadedmetadata = () => {
          if (!active) return;
          el!.currentTime = d.sourceOffsetMs / 1000;
          play();
        };
      } else {
        const { default: Hls } = await import("hls.js");
        if (!active) return;
        if (Hls.isSupported()) {
          const h = new Hls({
            enableWorker: true,
            backBufferLength: 8,
            maxBufferLength: 12,
            liveSyncDurationCount: 1,
          });
          hls.current = h;
          h.loadSource(url);
          h.attachMedia(el!);
          h.on(Hls.Events.MANIFEST_PARSED, play);
          h.on(Hls.Events.ERROR, (_, e) => {
            if (active && e.fatal) {
              setError(
                new Error(
                  "Playback interrupted. Retry to reconnect at the current channel position.",
                ),
              );
              setLoading(false);
              h.stopLoad();
            }
          });
        } else if (el!.canPlayType("application/vnd.apple.mpegurl")) {
          el!.src = url;
          el!.onloadedmetadata = play;
        } else
          throw new Error(
            "This browser cannot play this stream. Try a current desktop browser or the TV app.",
          );
      }
    }
    void open().catch((e) => {
      if (active && !controller.signal.aborted) {
        setError(e);
        setLoading(false);
      }
    });
    return () => {
      active = false;
      controller.abort();
      hls.current?.destroy();
      hls.current = null;
      el.pause();
      el.onloadedmetadata = null;
      el.removeAttribute("src");
      el.load();
    };
  }, [
    session?.id,
    entryId,
    revisionId,
    restart,
    forceHls,
    audio,
    paused,
    session?.available,
    props.profileId,
    controlling,
  ]);
  useEffect(() => {
    const track = delivery?.tracks.find((t) => t.index === subtitle && t.url);
    setCaptionError(null);
    cues.current = [];
    setCue("");
    if (!track?.url) return;
    const controller = new AbortController();
    void fetch(track.url, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw new Error("Subtitles unavailable");
        return r.text();
      })
      .then((text) => {
        if (!controller.signal.aborted) cues.current = parseVtt(text);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setCaptionError(e);
      });
    return () => controller.abort();
  }, [subtitle, delivery]);
  useEffect(() => {
    const el = video.current;
    if (!el) return;
    let last: { entryId: string; position: number } | null = null;
    const boundaryController = new AbortController();
    let boundaryPending = false;
    const timer = setInterval(() => {
      const s = snapshot.current,
        e = s?.playback?.entry;
      if (!s || !e || el.paused || el.readyState < 2 || s.paused) {
        last = null;
        return;
      }
      const position =
        delivery?.mode === "direct"
          ? e.startMs + el.currentTime * 1000 - e.offsetMs
          : (hls.current?.playingDate?.getTime() ?? s.positionMs);
      const source = e.offsetMs + position - e.startMs;
      setCue(
        cues.current
          .filter((c) => c.start <= source && c.end > source)
          .map((c) => c.text)
          .join("\n"),
      );
      if (
        last &&
        last.entryId === e.id &&
        position > last.position &&
        position - last.position <= 6000
      ) {
        void api(`/api/playback/sessions/${s.id}/events`, "POST", {
          id: eventId(),
          entryId: e.id,
          startMs: Math.max(e.startMs, Math.round(last.position)),
          endMs: Math.min(e.endMs, Math.round(position)),
        }).catch(() => {});
      }
      last = { entryId: e.id, position };
      if (
        delivery?.mode === "direct" &&
        position >= e.endMs - 100 &&
        !boundaryPending &&
        !controlPending.current
      ) {
        el.pause();
        boundaryPending = true;
        const sequence = controlSequence.current;
        const valid = () =>
          !boundaryController.signal.aborted &&
          sequence === controlSequence.current &&
          !controlPending.current &&
          snapshot.current?.id === s.id;
        void api<Playback>(
          `/api/playback/sessions/${s.id}`,
          "GET",
          undefined,
          boundaryController.signal,
        )
          .then((next) => {
            if (valid()) update(next);
          })
          .catch((error) => {
            if (valid()) setError(error);
          })
          .finally(() => {
            boundaryPending = false;
          });
      }
    }, 1000);
    return () => {
      clearInterval(timer);
      boundaryController.abort();
    };
  }, [delivery]);
  const control = async (action: "pause" | "resume" | "goLive") => {
    const current = snapshot.current;
    if (!current || controlPending.current || controlling) return;
    const sequence = ++controlSequence.current;
    controlPending.current = true;
    // Preserve the displayed frame before delivery cleanup releases the source.
    // The in-memory poster lets paused delivery stop all fetching, including HLS.
    const el = video.current;
    if (el && el.readyState >= 2 && el.videoWidth && el.videoHeight) {
      try {
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 1920 / el.videoWidth);
        canvas.width = Math.round(el.videoWidth * scale);
        canvas.height = Math.round(el.videoHeight * scale);
        const context = canvas.getContext("2d");
        if (context) {
          context.drawImage(el, 0, 0, canvas.width, canvas.height);
          setPausedFrame(canvas.toDataURL("image/jpeg", 0.9));
        }
      } catch {
        // A platform without readable video frames can still pause safely.
      }
    }
    setControlling(true);
    video.current?.pause();
    hls.current?.stopLoad();
    const valid = () =>
      sequence === controlSequence.current &&
      snapshot.current?.id === current.id;
    try {
      const next = await api<Playback>(
        `/api/playback/sessions/${current.id}/${action}`,
        "POST",
      );
      if (valid()) {
        update(next);
        controlRecovery.current = false;
        setError(null);
        setControlling(false);
        setRestart((n) => n + 1);
      }
    } catch (failure) {
      if (valid()) {
        // The POST may have reached the server even if its response was lost.
        // Keep delivery stopped until a fresh descriptor resolves its pause state.
        controlRecovery.current = true;
        setError(failure);
      }
    } finally {
      if (valid()) controlPending.current = false;
    }
  };
  const title =
      media?.metadata.seriesTitle ?? media?.title ?? "Channel playback",
    channel = props.channels.find((c) => c.id === props.channelId),
    index = props.channels.findIndex((c) => c.id === props.channelId),
    failure = pollError ?? error;
  return (
    <>
      <div className="silver-bar">
        <h2>myTuner</h2>
        <strong>
          {props.profiles.find((p) => p.id === props.profileId)?.name}
        </strong>
        <button className="secondary" onClick={props.chooseProfile}>
          Switch profile
        </button>
        <button className="secondary" onClick={props.onLeave}>
          Channel guide
        </button>
        <a
          className="button secondary"
          href={props.account.role === "viewer" ? "#profiles" : "#channels"}
        >
          My network
        </a>
      </div>
      {recentOpen && props.channelId && (
        <RecentPrograms
          profileId={props.profileId}
          channelId={props.channelId}
          onClose={() => setRecentOpen(false)}
        />
      )}
      {reportOpen && session && (
        <ProblemReport
          key={session.id}
          sessionId={session.id}
          onClose={() => setReportOpen(false)}
        />
      )}
      {browseOpen && (
        <Modal title="Browse channels" onClose={() => setBrowseOpen(false)}>
          <p>
            Browse without changing this playback session. Watch live switches
            channels{paused ? " and discards the current paused position" : ""}.
          </p>
          <div className="stack">
            {props.channels.map((c) => {
              const upcoming = c.entries.filter((e) => e.endMs > Date.now());
              const current = upcoming[0];
              const next = upcoming.find(
                (e) => e.programId !== current?.programId,
              );
              return (
                <article className="panel section-head" key={c.id}>
                  <div>
                    <h3>
                      {c.shortName} · {c.name}
                    </h3>
                    <p>Now: {current?.title ?? "No programming"}</p>
                    <p>Next: {next?.title ?? "More to come"}</p>
                  </div>
                  <button disabled={!current} onClick={() => tune(c.id)}>
                    Watch {c.name} live
                  </button>
                </article>
              );
            })}
          </div>
        </Modal>
      )}
      <div
        className={`video-stage ${overlayOpen ? "controls-open" : "controls-hidden"}`}
        ref={stage}
      >
        <video
          ref={video}
          poster={pausedFrame}
          playsInline
          onError={() => {
            if (!forceHls && delivery?.mode === "direct") setForceHls(true);
            else {
              setError(
                new Error(
                  "The video could not be played. Retry or choose another channel.",
                ),
              );
              setLoading(false);
            }
          }}
          onWaiting={() => setLoading(true)}
          onPlaying={() => {
            setLoading(false);
            if (!controlPending.current && !snapshot.current?.paused)
              setPausedFrame(undefined);
          }}
        />
        {(loading || (session && !session.available) || Boolean(failure)) && (
          <div className="video-status" role="status">
            <p>
              {failure instanceof Error
                ? failure.message
                : session && !session.available
                  ? "This scheduled video is unavailable. The channel will continue at the next interval."
                  : "Joining your channel…"}
            </p>
          </div>
        )}
        {cue && (
          <div
            className={`subtitle-cue caption-${preferences.size} caption-${preferences.background}`}
          >
            {cue}
          </div>
        )}
        {!overlayOpen && (
          <button
            className="player-reveal secondary"
            onClick={() => setOverlayOpen(true)}
          >
            Show controls
          </button>
        )}
        <div className="player-overlay" hidden={!overlayOpen}>
          <div>
            <small>
              {channel?.shortName} · {channel?.name ?? "Your channel"}
            </small>
            <h2>{title}</h2>
            {session?.context && (
              <div className="playback-context">
                <p>
                  {session.context.kind === "commercial"
                    ? `Commercial · ${Math.ceil(session.context.remainingMs / 1000)} seconds remaining · ${session.context.program?.title ?? "Programming resumes next"}`
                    : `${session.context.title}${session.context.seasonNumber === null ? "" : ` · S${session.context.seasonNumber} E${session.context.episodeNumber ?? "?"}`}`}
                </p>
                <progress
                  aria-label="Current interval progress"
                  max={session.context.entryDurationMs}
                  value={Math.max(
                    0,
                    session.context.entryDurationMs -
                      session.context.remainingMs,
                  )}
                />
                <p>Next: {session.context.next?.title ?? "More to come"}</p>
              </div>
            )}
            <div className="actions">
              {needsPlay ? (
                <Action
                  task={async () => {
                    await video.current?.play();
                    setNeedsPlay(false);
                  }}
                >
                  Play video
                </Action>
              ) : (
                <Action
                  disabled={!session || !session.available || controlling}
                  task={() => control(paused ? "resume" : "pause")}
                >
                  {paused ? "Resume" : "Pause"}
                </Action>
              )}
              <button className="secondary" onClick={props.onLeave}>
                Channel guide
              </button>
              <button className="secondary" onClick={() => setBrowseOpen(true)}>
                Browse channels
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setOverlayOpen(false);
                  requestAnimationFrame(() =>
                    stage.current
                      ?.querySelector<HTMLButtonElement>(".player-reveal")
                      ?.focus(),
                  );
                }}
              >
                Hide controls
              </button>
              <button className="secondary" onClick={() => setRecentOpen(true)}>
                Recently aired
              </button>
              <button
                className="secondary"
                disabled={!session}
                onClick={() => setReportOpen(true)}
              >
                Report a problem
              </button>
              {Boolean(failure) && (
                <button
                  className="secondary"
                  onClick={() => {
                    if (session) setRestart((v) => v + 1);
                    else setJoinAttempt((v) => v + 1);
                    setError(null);
                  }}
                >
                  Retry playback
                </button>
              )}
            </div>
          </div>
          <div>
            <span className="badge">
              {paused
                ? "Paused on this device"
                : session && session.behindLiveMs > 2000
                  ? `${Math.round(session.behindLiveMs / 1000)} seconds behind live`
                  : "● LIVE"}
            </span>
            {(paused || (session && session.behindLiveMs > 2000)) && (
              <div className="actions">
                <Action disabled={controlling} task={() => control("goLive")}>
                  Go Live
                </Action>
              </div>
            )}
            <div className="actions">
              <button
                className="secondary"
                disabled={index <= 0}
                onClick={() => tune(props.channels[index - 1]!.id)}
              >
                ← Previous
              </button>
              <button
                className="secondary"
                disabled={index < 0 || index >= props.channels.length - 1}
                onClick={() => tune(props.channels[index + 1]!.id)}
              >
                Next →
              </button>
            </div>
          </div>
        </div>
      </div>
      <section className="panel player-details">
        <h3>
          {paused
            ? "Paused only on this device."
            : "You joined this program midway. Switching channels joins the next channel live."}
        </h3>
        <p>
          {media?.title}
          {media?.metadata.seasonNumber !== undefined
            ? ` · S${media.metadata.seasonNumber} E${media.metadata.episodeNumber ?? "?"}`
            : ""}
        </p>
        <p>{media?.metadata.overview}</p>
        <div className="player-tools">
          <Select
            label="Audio"
            value={audio}
            onChange={(e) => {
              const index = Number(e.target.value);
              audioChosen.current = { entryId, index };
              savePreferences({
                ...preferences,
                audio: language(
                  delivery?.tracks.find(
                    (t) => t.type === "audio" && t.index === index,
                  )?.language,
                ),
              });
              setAudio(index);
            }}
          >
            <option value={-1}>Default audio</option>
            {delivery?.tracks
              .filter((t) => t.type === "audio")
              .map((t) => (
                <option key={t.index} value={t.index}>
                  {t.title ?? t.language ?? `Track ${t.index}`} · {t.codec}
                </option>
              ))}
          </Select>
          <Select
            label="Subtitles"
            value={subtitle}
            onChange={(e) => {
              const index = Number(e.target.value);
              subtitleChosen.current = { entryId, index };
              savePreferences({
                ...preferences,
                subtitle: language(
                  delivery?.tracks.find(
                    (t) => t.type === "subtitle" && t.index === index,
                  )?.language,
                ),
                subtitleOff: index < 0,
              });
              setSubtitle(index);
            }}
          >
            <option value={-1}>Off</option>
            {delivery?.tracks
              .filter((t) => t.type === "subtitle" && t.url)
              .map((t) => (
                <option key={t.index} value={t.index}>
                  {t.title ?? t.language ?? `Track ${t.index}`}
                </option>
              ))}
          </Select>
          <Select
            label="Caption size"
            value={preferences.size}
            onChange={(e) =>
              savePreferences({
                ...preferences,
                size: e.target.value as ViewingPreferences["size"],
              })
            }
          >
            <option value="normal">Normal</option>
            <option value="large">Large</option>
            <option value="largest">Largest</option>
          </Select>
          <Select
            label="Caption background"
            value={preferences.background}
            onChange={(e) =>
              savePreferences({
                ...preferences,
                background: e.target.value as ViewingPreferences["background"],
              })
            }
          >
            <option value="dark">Dark background</option>
            <option value="shadow">Text shadow</option>
          </Select>
          <Action
            secondary
            task={async () => {
              await stage.current?.requestFullscreen();
            }}
          >
            Full screen
          </Action>
        </div>
        <ErrorBox error={captionError} />
        <p
          className={`caption-sample caption-${preferences.size} caption-${preferences.background}`}
        >
          Caption preview: choose size and background for this browser and
          profile.
        </p>
        <p className="muted">
          Language and caption preferences are remembered for this device,
          server and profile. Missing preferred tracks fall back to default
          audio or subtitles off.
        </p>
        <p className="muted">
          {delivery?.mode === "hls"
            ? "Compatible HLS stream"
            : "Direct playback"}{" "}
          · Text subtitles only. Pause and Go Live affect this device.
        </p>
      </section>
      {failure instanceof ApiError && failure.status === 403 && (
        <ErrorBox
          error={
            new Error(
              "This profile no longer has access. Return to the guide or switch profiles.",
            )
          }
        />
      )}
    </>
  );
}
