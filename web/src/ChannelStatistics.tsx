import { useState } from "react";
import { Load, useRemote } from "./ui";
export function ChannelStatistics({
  profileId,
  channelId,
}: {
  profileId: string;
  channelId: string;
}) {
  const [open, setOpen] = useState(false);
  const result = useRemote<{
    scheduled: {
      mediaId: string;
      title: string;
      kind: string;
      assignments: number;
      startedAssignments: number;
    }[];
    deliveredForCurrentAccount: {
      mediaId: string;
      title: string;
      kind: string;
      deliveredMs: number;
    }[];
  }>(
    open ? `/api/profiles/${profileId}/channels/${channelId}/statistics` : null,
  );
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>Scheduled and delivered exposure</summary>
      <p>
        Assignments include scheduled broadcasts with no viewers. Started
        assignments have reached their broadcast time. Delivered time covers
        this account’s sessions; it is not proof someone watched.
      </p>
      <Load {...result} retry={result.reload} />
      {result.data && result.data.scheduled.length === 0 && (
        <p>No scheduled exposure recorded for this channel yet.</p>
      )}
      {Boolean(result.data?.scheduled.length) && (
        <div
          className="table-scroll exposure-history"
          role="region"
          aria-label="Exposure history"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th>Video</th>
                <th>Type</th>
                <th>Scheduled</th>
                <th>Started</th>
                <th>Delivered seconds · your account</th>
              </tr>
            </thead>
            <tbody>
              {result.data?.scheduled.slice(0, 100).map((row) => (
                <tr key={`${row.mediaId}:${row.kind}`}>
                  <td>{row.title}</td>
                  <td>{row.kind}</td>
                  <td>{row.assignments}</td>
                  <td>{row.startedAssignments}</td>
                  <td>
                    {(
                      (result.data?.deliveredForCurrentAccount.find(
                        (d) => d.mediaId === row.mediaId && d.kind === row.kind,
                      )?.deliveredMs ?? 0) / 1000
                    ).toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {result.data && result.data.scheduled.length > 100 && (
        <p>Showing the first 100 videos.</p>
      )}
    </details>
  );
}
export type BreakDiagnostic = {
  startMs: number;
  endMs: number;
  requestedDurationMs: number;
  poolSize: number;
  clips: number;
  shortenedClips: number;
  reason: string;
};
const reasons: Record<string, string> = {
  filled: "Break filled",
  "minimum-remaining": "Short remainder returned to the show",
  "clip-limit": "Clip limit reached",
  "no-commercials": "No eligible commercials",
  "duration-fit": "No complete clip fits",
  "variation-limits": "Repeat or cooldown limit reached",
};
export function BreakDiagnostics({ items }: { items: BreakDiagnostic[] }) {
  return (
    <section>
      <h3>Commercial variation</h3>
      {items.length === 0 ? (
        <p>No commercial breaks in this preview.</p>
      ) : (
        <>
          <p>
            {items.reduce((n, d) => n + d.clips, 0)} clips ·{" "}
            {(
              items.reduce((n, d) => n + d.endMs - d.startMs, 0) / 1000
            ).toFixed(1)}{" "}
            actual seconds · {items.reduce((n, d) => n + d.shortenedClips, 0)}{" "}
            shortened clips. Repeat allowance, per-break cap and cooldown are
            enforced independently.
          </p>
          {items.slice(0, 50).map((d, i) => (
            <p key={i}>
              {new Date(d.startMs).toLocaleString()} · Pool: {d.poolSize} clips
              · Played: {d.clips} ·{" "}
              {(Math.max(0, d.endMs - d.startMs) / 1000).toFixed(1)} of{" "}
              {d.requestedDurationMs / 1000} requested seconds ·{" "}
              {reasons[d.reason] ?? "Review this break"}
            </p>
          ))}
          {items.length > 50 && <p>Showing the first 50 break explanations.</p>}
        </>
      )}
    </section>
  );
}
