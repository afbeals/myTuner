import { SubtitlePanel } from "./Subtitles";
import { useEffect, useState } from "react";
import type { Selection, Track } from "./types";
import { api } from "./api";
import { Action, Load, Modal, Select, useRemote } from "./ui";
import { resourceLink } from "./resource-route";
interface Detail {
  title: string;
  sourceName: string;
  relativePath: string;
  durationMs: number;
  available: boolean;
  metadata: {
    seriesTitle: string | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
    year: number | null;
    overview: string | null;
  };
  technical: {
    format: string;
    streams: (Track & {
      default: boolean;
      forced: boolean;
      width?: number;
      height?: number;
      channels?: number;
    })[];
  } | null;
}
export function VideoDetails({
  profileId,
  mediaId,
  onClose,
  admin = false,
}: {
  profileId: string;
  mediaId: string;
  onClose: () => void;
  admin?: boolean;
}) {
  const [copyMessage, setCopyMessage] = useState("");
  const [subtitleDirty, setSubtitleDirty] = useState(false);
  const close = () => {
    if (
      !subtitleDirty ||
      window.confirm(
        "Discard this subtitle draft? A save received by the server may still finish.",
      )
    )
      onClose();
  };
  const detail = useRemote<Detail>(
    `/api/profiles/${profileId}/media/${mediaId}/details`,
  );
  return (
    <Modal title="Video details" onClose={close}>
      <Load {...detail} retry={detail.reload} />
      {detail.data && (
        <>
          <h3>{detail.data.title}</h3>
          <p>
            {detail.data.metadata.seriesTitle ?? "Standalone video"}
            {detail.data.metadata.seasonNumber != null &&
              ` · Season ${detail.data.metadata.seasonNumber}`}
            {detail.data.metadata.episodeNumber != null &&
              ` · Episode ${detail.data.metadata.episodeNumber}`}
            {detail.data.metadata.year != null &&
              ` · ${detail.data.metadata.year}`}
          </p>
          {detail.data.metadata.overview && (
            <p>{detail.data.metadata.overview}</p>
          )}
          <dl className="inspection-details">
            <dt>Source</dt>
            <dd>{detail.data.sourceName}</dd>
            <dt>Relative filename</dt>
            <dd>{detail.data.relativePath}</dd>
            <dt>Measured duration</dt>
            <dd>{(detail.data.durationMs / 1000).toFixed(3)} seconds</dd>
            <dt>Catalog availability</dt>
            <dd>
              {detail.data.available ? "Available at last scan" : "Unavailable"}
            </dd>
          </dl>
          <Action
            secondary
            task={async () => {
              if (!navigator.clipboard?.writeText) {
                setCopyMessage(
                  "Select the relative filename above to copy it.",
                );
                return;
              }
              await navigator.clipboard.writeText(detail.data!.relativePath);
              setCopyMessage("Relative filename copied");
            }}
          >
            Copy relative filename
          </Action>
          {copyMessage && <p role="status">{copyMessage}</p>}
          <details>
            <summary>Stored technical metadata</summary>
            {!detail.data.technical ? (
              <p>Unknown. Ask an administrator to scan this source.</p>
            ) : (
              <>
                <p>
                  Format: {detail.data.technical.format}. Last scan time is not
                  recorded. Stored scan data may be stale; it does not certify
                  playback on a particular TV.
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Track</th>
                        <th>Codec</th>
                        <th>Language</th>
                        <th>Properties</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.technical.streams.map((track) => (
                        <tr key={track.index}>
                          <td>
                            {track.type} {track.index}
                            {(track.type === "audio" ||
                              track.type === "subtitle") &&
                              " · Embedded"}
                          </td>
                          <td>{track.codec}</td>
                          <td>{track.language ?? "Unknown"}</td>
                          <td>
                            {[
                              track.default ? "Default" : "",
                              track.forced ? "Forced" : "",
                              track.width && track.height
                                ? `${track.width} × ${track.height}`
                                : "",
                              track.channels
                                ? `${track.channels} audio channels`
                                : "",
                              track.type === "subtitle"
                                ? [
                                    "subrip",
                                    "ass",
                                    "ssa",
                                    "webvtt",
                                    "mov_text",
                                    "text",
                                  ].includes(track.codec)
                                  ? "Text captions"
                                  : "Image/unsupported captions"
                                : "",
                            ]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </details>
          <SubtitlePanel
            key={`${profileId}:${mediaId}`}
            profileId={profileId}
            mediaId={mediaId}
            admin={admin}
            onDirtyChange={setSubtitleDirty}
          />
        </>
      )}
    </Modal>
  );
}
interface Dependencies {
  total: number;
  offset: number;
  limit: number;
  checkedMs: number;
  explanation: string;
  items: {
    id: string;
    name: string;
    recurring: boolean;
    materialized: boolean;
    retained: boolean;
  }[];
}
export function DeleteCollection({
  profileId,
  collectionId,
  collectionName,
  onClose,
  onDeleted,
}: {
  profileId: string;
  collectionId: string;
  collectionName: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const dependencies = useRemote<Dependencies>(
    `/api/profiles/${profileId}/collections/${collectionId}/dependencies?offset=${offset}&limit=25`,
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  return (
    <Modal title="Delete collection" onClose={onClose}>
      <p>
        Review where <strong>{collectionName}</strong> is used before deleting
        it. Original files stay in place.
      </p>
      <Load
        loading={dependencies.loading || busy}
        error={error ?? dependencies.error}
        retry={dependencies.reload}
      />
      {dependencies.data && (
        <>
          <p>
            {dependencies.data.total} permitted channel dependencies · Checked{" "}
            {new Date(dependencies.data.checkedMs).toLocaleTimeString()}
          </p>
          <p className="notice">
            {dependencies.data.explanation} This report is advisory and can
            change before deletion.
          </p>
          <ul>
            {dependencies.data.items.map((item) => (
              <li key={item.id}>
                <a href={resourceLink("channel", profileId, item.id)}>
                  {item.name}
                </a>{" "}
                ·{" "}
                {[
                  item.recurring && "Future programming",
                  item.materialized && "Scheduled matching videos",
                  item.retained && "Retained playback",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </li>
            ))}
          </ul>
          <div className="actions">
            <button
              className="secondary"
              disabled={offset === 0 || busy}
              onClick={() => setOffset((v) => Math.max(0, v - 25))}
            >
              Previous dependencies
            </button>
            <button
              className="secondary"
              disabled={offset + 25 >= dependencies.data.total || busy}
              onClick={() => setOffset((v) => v + 25)}
            >
              Next dependencies
            </button>
            <button
              className="secondary"
              onClick={dependencies.reload}
              disabled={busy}
            >
              Refresh impact
            </button>
          </div>
          <div className="actions">
            <button
              className="danger"
              disabled={busy || dependencies.loading}
              onClick={() => {
                setBusy(true);
                setError(null);
                void api(
                  `/api/profiles/${profileId}/collections/${collectionId}`,
                  "DELETE",
                )
                  .then(onDeleted)
                  .catch(setError)
                  .finally(() => setBusy(false));
              }}
            >
              Delete saved collection
            </button>
            <button className="secondary" onClick={onClose} disabled={busy}>
              Keep collection
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
interface Readiness {
  analyzed: number;
  truncated: boolean;
  counts: {
    direct: number;
    hls: number;
    unknown: number;
    unavailable: number;
    unsupportedCaptionTracks: number;
  };
  items: {
    id: string;
    title: string;
    status: string;
    mode: string;
    available: boolean;
    reasons: string[];
  }[];
  note: string;
  scope: string;
}
export function ReadinessPanel({
  profileId,
  selection,
  channelId,
}: {
  profileId: string;
  selection?: Selection;
  channelId?: string;
}) {
  const [preset, setPreset] = useState("compatible"),
    [attempt, setAttempt] = useState(0),
    [offset, setOffset] = useState(0),
    [result, setResult] = useState<Readiness | null>(null),
    [error, setError] = useState<unknown>(null),
    [loading, setLoading] = useState(false);
  const selector = JSON.stringify(selection);
  useEffect(() => {
    setResult(null);
    setError(null);
    if (!attempt) return;
    const controller = new AbortController();
    setLoading(true);
    void api<Readiness>(
      "/api/admin/playback-readiness",
      "POST",
      {
        profileId,
        ...(channelId ? { channelId } : { selection }),
        offset,
        limit: 25,
        capabilities:
          preset === "compatible"
            ? {
                containers: ["mp4", "m4v"],
                videoCodecs: ["h264"],
                audioCodecs: ["aac", "mp3"],
              }
            : { containers: [], videoCodecs: [], audioCodecs: [] },
      },
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setResult(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [profileId, channelId, selector, preset, attempt, offset]);
  return (
    <section className="panel inspection-readiness">
      <h3>Playback readiness</h3>
      <p>
        Predict delivery from stored metadata. This check starts no playback,
        scan or conversion.
      </p>
      <Select
        label="Declared playback capabilities"
        value={preset}
        onChange={(event) => {
          setPreset(event.target.value);
          setAttempt(0);
          setOffset(0);
          setResult(null);
          setLoading(false);
        }}
      >
        <option value="compatible">H.264 MP4 with AAC/MP3 audio</option>
        <option value="hls">Conversion required by client</option>
      </Select>
      <button
        className="secondary"
        disabled={loading}
        onClick={() => {
          setOffset(0);
          setAttempt((v) => v + 1);
        }}
      >
        Check playback readiness
      </button>
      <Load loading={loading} error={error} />
      {result && (
        <>
          <p role="status">
            {result.counts.direct} direct · {result.counts.hls} conversion ·{" "}
            {result.counts.unknown} unknown · {result.counts.unavailable}{" "}
            unavailable
          </p>
          <p>
            {result.counts.unsupportedCaptionTracks} unsupported caption tracks
            · {result.analyzed}{" "}
            {result.scope === "upcoming-materialized-intervals"
              ? "upcoming intervals"
              : "files"}{" "}
            analyzed{result.truncated ? " (limited to first 5,000)" : ""}
          </p>
          <p className="notice">{result.note}</p>
          {!result.analyzed && (
            <p>
              No available selected files or upcoming materialized intervals to
              analyze.
            </p>
          )}
          <ul>
            {result.items.map((item, index) => (
              <li key={`${item.id}:${index}`}>
                <strong>{item.title}</strong> · {item.status}
                {!item.available && " · unavailable"}
                {item.reasons.length > 0 && <p>{item.reasons.join("; ")}</p>}
              </li>
            ))}
          </ul>
          <div className="actions">
            <button
              className="secondary"
              disabled={!offset || loading}
              onClick={() => setOffset((v) => Math.max(0, v - 25))}
            >
              Previous readiness results
            </button>
            <button
              className="secondary"
              disabled={offset + 25 >= result.analyzed || loading}
              onClick={() => setOffset((v) => v + 25)}
            >
              Next readiness results
            </button>
          </div>
        </>
      )}
    </section>
  );
}
