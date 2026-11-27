import pkg from "../../package.json";
import { confirmAction } from "./confirmation";
import { useEffect, useRef, useState } from "react";
import { eventId } from "./playback-utils";
import { api } from "./api";
import {
  Action,
  Empty,
  ErrorBox,
  Load,
  Modal,
  ModalCancel,
  Select,
  useRemote,
} from "./ui";
interface Recent {
  retention: string;
  truncated: boolean;
  items: {
    programId: string;
    title: string;
    startMs: number;
    endMs: number;
    seriesTitle: string | null;
    seasonNumber: number | null;
    episodeNumber: number | null;
  }[];
}
export function RecentPrograms({
  profileId,
  channelId,
  onClose,
}: {
  profileId: string;
  channelId: string;
  onClose: () => void;
}) {
  const data = useRemote<Recent>(
    `/api/profiles/${profileId}/channels/${channelId}/recent`,
  );
  const [selected, setSelected] = useState<Recent["items"][number] | null>(
    null,
  );
  return (
    <Modal title="Recently aired" onClose={onClose}>
      <p>Scheduled programs that ended in the last two hours.</p>
      <Load {...data} retry={data.reload} />
      {data.data && (
        <>
          <p className="notice">{data.data.retention}</p>
          {!data.data.items.length && (
            <Empty title="No retained programs in this window" />
          )}
          {data.data.items.map((item) => (
            <article className="panel" key={item.programId}>
              <h3>{item.title}</h3>
              <p>
                {item.seriesTitle}
                {item.seasonNumber !== null
                  ? ` · S${item.seasonNumber} E${item.episodeNumber ?? "?"}`
                  : ""}
              </p>
              <p>
                {new Date(item.startMs).toLocaleString()} –{" "}
                {new Date(item.endMs).toLocaleTimeString()}
              </p>
              <button className="secondary" onClick={() => setSelected(item)}>
                Airing details
              </button>
            </article>
          ))}
          {data.data.truncated && (
            <p>Showing the latest 200 retained programs.</p>
          )}
        </>
      )}
      {selected && (
        <Modal title={selected.title} onClose={() => setSelected(null)}>
          <p>{selected.seriesTitle}</p>
          <p>
            {new Date(selected.startMs).toLocaleString()} –{" "}
            {new Date(selected.endMs).toLocaleString()}
          </p>
          <p>
            Scheduled airing identification only. Playback continues separately.
          </p>
        </Modal>
      )}
    </Modal>
  );
}
export function DeletedCollections({
  profileId,
  onClose,
  onRestored,
}: {
  profileId: string;
  onClose: () => void;
  onRestored: () => void;
}) {
  const data = useRemote<{
    items: { id: string; name: string; count: number; expiresMs: number }[];
  }>(`/api/profiles/${profileId}/deleted-collections`);
  return (
    <Modal title="Recently deleted collections" onClose={onClose}>
      <p>
        Restore the original collection and member references before expiry.
        Media files and existing airings stay in place. Collections outside this
        profile’s current access are omitted.
      </p>
      <Load {...data} retry={data.reload} />
      {data.data?.items.length === 0 && (
        <Empty title="No recoverable collections" />
      )}
      {data.data?.items.map((c) => (
        <article className="panel" key={c.id}>
          <h3>{c.name}</h3>
          <p>
            {c.count} references · Expires{" "}
            {new Date(c.expiresMs).toLocaleString()}
          </p>
          <Action
            task={async () => {
              await api(
                `/api/profiles/${profileId}/deleted-collections/${c.id}/restore`,
                "POST",
              );
              data.reload();
              onRestored();
            }}
          >
            Restore {c.name}
          </Action>
        </article>
      ))}
    </Modal>
  );
}
interface Summary {
  category: string;
  client: string;
  appVersion: string;
  serverTime: number;
  channelId: string;
  entryId: string;
  state: string;
  route: string;
}
function ReportDetails({ summary }: { summary: Summary }) {
  const labels: Record<string, string> = {
    category: "Category",
    client: "Application",
    appVersion: "Version",
    serverTime: "Prepared at",
    channelId: "Channel reference",
    entryId: "Airing reference",
    state: "Playback state",
    route: "Delivery route",
  };
  return (
    <dl className="report-summary">
      {Object.entries(summary).map(([key, value]) => (
        <div key={key}>
          <dt>{labels[key] ?? key}</dt>
          <dd>
            {key === "serverTime"
              ? new Date(Number(value)).toLocaleString()
              : String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export function ProblemReport({
  sessionId,
  onClose,
}: {
  sessionId: string;
  onClose: () => void;
}) {
  const serial = useRef(0),
    [category, setCategory] = useState("picture"),
    [draft, setDraft] = useState<{
      draftId: string;
      summary: Summary;
      requestId: string;
    } | null>(null),
    [sent, setSent] = useState<string | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const review = async () => {
    const ticket = ++serial.current;
    setBusy(true);
    setDraft(null);
    setError(null);
    try {
      const result = await api<{ draftId: string; summary: Summary }>(
        `/api/playback/sessions/${sessionId}/report-preview`,
        "POST",
        { category, client: "browser", appVersion: pkg.version },
      );
      if (ticket === serial.current)
        setDraft({ ...result, requestId: eventId() });
    } catch (error) {
      if (ticket === serial.current) setError(error);
    } finally {
      if (ticket === serial.current) setBusy(false);
    }
  };
  const send = async () => {
    if (!draft) return;
    const ticket = serial.current;
    setBusy(true);
    try {
      const result = await api<{ id: string }>("/api/problem-reports", "POST", {
        draftId: draft.draftId,
        requestId: draft.requestId,
      });
      if (ticket === serial.current) {
        setSent(result.id);
        setError(null);
      }
    } catch (error) {
      if (ticket === serial.current)
        setError(
          new Error(
            `Delivery unconfirmed. Retrying sends this report only once. ${error instanceof Error ? error.message : ""}`,
          ),
        );
    } finally {
      if (ticket === serial.current) setBusy(false);
    }
  };
  return (
    <Modal
      title="Report a playback problem"
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <div className="actions">
          {!sent &&
            (draft ? (
              <button disabled={busy} onClick={() => void send()}>
                {busy
                  ? "Sending…"
                  : error
                    ? "Retry sending report"
                    : "Send report"}
              </button>
            ) : (
              <button disabled={busy} onClick={() => void review()}>
                {busy ? "Preparing…" : "Review summary"}
              </button>
            ))}
          <ModalCancel>{sent ? "Done" : "Cancel"}</ModalCancel>
        </div>
      }
    >
      <p>
        Review the exact summary before sending it to your administrator. No
        logs, media, screenshots, PINs or credentials are included.
      </p>
      {sent ? (
        <p role="status">Report sent. Reference {sent}</p>
      ) : (
        <>
          <Select
            label="Problem category"
            value={category}
            disabled={busy}
            onChange={(event) => {
              serial.current++;
              setCategory(event.target.value);
              setDraft(null);
              setError(null);
            }}
          >
            {["picture", "sound", "captions", "other"].map((value) => (
              <option key={value} value={value}>
                {value[0]!.toUpperCase() + value.slice(1)}
              </option>
            ))}
          </Select>
          {draft && <ReportDetails summary={draft.summary} />}
          <ErrorBox error={error} />
        </>
      )}
    </Modal>
  );
}
export function ReportsInbox({ admin }: { admin: boolean }) {
  const [offset, setOffset] = useState(0),
    [filter, setFilter] = useState("all"),
    [message, setMessage] = useState("");
  const data = useRemote<{
    total: number;
    retentionDays: number;
    items: {
      id: string;
      createdMs: number;
      acknowledgedMs: number | null;
      summary: Summary;
      context?: {
        channelName: string;
        profileName: string;
        accountName: string;
        title: string;
      };
    }[];
  }>(
    `${admin ? "/api/admin/problem-reports" : "/api/problem-reports"}?offset=${offset}&limit=25&status=${filter}`,
    0,
    true,
  );
  useEffect(() => {
    if (data.data && offset && offset >= data.data.total)
      setOffset(Math.max(0, Math.floor((data.data.total - 1) / 25) * 25));
  }, [data.data?.total, offset]);
  return (
    <>
      <header className="page-head">
        <div>
          <h1>{admin ? "Playback problem reports" : "Your problem reports"}</h1>
          <p>
            Reports are sent explicitly from the player’s Report a problem
            action.
          </p>
        </div>
        <button
          className="secondary"
          disabled={data.loading}
          onClick={data.reload}
        >
          Refresh reports
        </button>
      </header>
      <div className="tabs" aria-label="Report status">
        {["all", "new", "acknowledged"].map((status) => (
          <button
            key={status}
            className={filter === status ? "selected" : "secondary"}
            aria-pressed={filter === status}
            onClick={() => {
              setFilter(status);
              setOffset(0);
            }}
          >
            {status[0]!.toUpperCase() + status.slice(1)}
          </button>
        ))}
      </div>
      <Load {...data} retry={data.reload} />
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {data.data && (
        <p>
          Kept for {data.data.retentionDays} days · {data.data.total} permitted
          reports
        </p>
      )}
      {data.data?.items.length === 0 && (
        <Empty
          title={
            filter === "all" ? "No reports" : "No reports with this status"
          }
        >
          <a href="#watch">Open Watch TV</a>, choose a channel, then use Report
          a problem to review and send a report.
        </Empty>
      )}
      <div className="stack">
        {data.data?.items.map((report) => (
          <article className="panel" key={report.id}>
            <div className="section-head">
              <h2>
                {report.summary.category[0]!.toUpperCase() +
                  report.summary.category.slice(1)}{" "}
                · {report.context?.channelName ?? "Playback report"}
              </h2>
              <span className="badge">
                {report.acknowledgedMs ? "Acknowledged" : "New"}
              </span>
            </div>
            <p>
              {new Date(report.createdMs).toLocaleString()} ·{" "}
              {report.context?.profileName ?? "Profile"}
              {admin ? ` · ${report.context?.accountName ?? "Account"}` : ""}
            </p>
            <p>{report.context?.title ?? ""}</p>
            <details>
              <summary>Report reference and technical details</summary>
              <p>Reference {report.id}</p>
              <ReportDetails summary={report.summary} />
            </details>
            {admin && (
              <div className="actions">
                <Action
                  secondary
                  disabled={Boolean(report.acknowledgedMs)}
                  label={`Acknowledge ${report.summary.category} report from ${new Date(report.createdMs).toLocaleString()}`}
                  task={async () => {
                    await api(
                      `/api/admin/problem-reports/${report.id}`,
                      "PATCH",
                      { acknowledged: true },
                    );
                    setMessage("Report acknowledged.");
                    data.reload();
                  }}
                >
                  Acknowledge
                </Action>
                <Action
                  secondary
                  danger
                  label={`Delete ${report.summary.category} report from ${new Date(report.createdMs).toLocaleString()}`}
                  task={async () => {
                    if (
                      !(await confirmAction(
                        `Permanently delete the ${report.summary.category} report sent ${new Date(report.createdMs).toLocaleString()}? This cannot be undone. Reference: ${report.id}`,
                        {
                          title: "Delete this report?",
                          label: "Delete report",
                        },
                      ))
                    )
                      return;
                    await api(
                      `/api/admin/problem-reports/${report.id}`,
                      "DELETE",
                    );
                    setMessage("Report deleted.");
                    data.reload();
                  }}
                >
                  Delete report
                </Action>
              </div>
            )}
          </article>
        ))}
      </div>
      <div className="actions">
        <button
          className="secondary"
          disabled={!offset || data.loading}
          onClick={() => setOffset((n) => Math.max(0, n - 25))}
        >
          Previous reports
        </button>
        <button
          className="secondary"
          disabled={
            !data.data || offset + 25 >= data.data.total || data.loading
          }
          onClick={() => setOffset((n) => n + 25)}
        >
          Next reports
        </button>
      </div>
    </>
  );
}
