import { useRef, useState } from "react";
import { eventId } from "./playback-utils";
import { api } from "./api";
import { Action, Empty, ErrorBox, Load, Modal, Select, useRemote } from "./ui";
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
  const reviewSerial = useRef(0);
  const [category, setCategory] = useState("picture"),
    [draft, setDraft] = useState<{
      draftId: string;
      summary: Summary;
      requestId: string;
    } | null>(null),
    [sent, setSent] = useState<string | null>(null),
    [error, setError] = useState<unknown>(null);
  return (
    <Modal title="Report a playback problem" onClose={onClose}>
      <p>
        Review the exact summary, then explicitly send it to your administrator.
        No logs, media, screenshots, PINs or credentials are included.
      </p>
      {sent ? (
        <p role="status">Report sent. Reference {sent}</p>
      ) : (
        <>
          <Select
            label="Problem category"
            value={category}
            onChange={(e) => {
              reviewSerial.current++;
              setCategory(e.target.value);
              setDraft(null);
              setError(null);
            }}
          >
            {["picture", "sound", "captions", "other"].map((c) => (
              <option key={c} value={c}>
                {c[0]!.toUpperCase() + c.slice(1)}
              </option>
            ))}
          </Select>
          <Action
            secondary
            task={async () => {
              const serial = ++reviewSerial.current;
              setError(null);
              setDraft(null);
              try {
                const preview = await api<{
                  draftId: string;
                  summary: Summary;
                }>(
                  `/api/playback/sessions/${sessionId}/report-preview`,
                  "POST",
                  { category, client: "browser" },
                );
                if (serial === reviewSerial.current)
                  setDraft({ ...preview, requestId: eventId() });
              } catch (e) {
                if (serial === reviewSerial.current) setError(e);
              }
            }}
          >
            Review summary
          </Action>
          {draft && (
            <>
              <ReportDetails summary={draft.summary} />
              <Action
                task={async () => {
                  const serial = reviewSerial.current;
                  try {
                    const r = await api<{ id: string }>(
                      "/api/problem-reports",
                      "POST",
                      { draftId: draft.draftId, requestId: draft.requestId },
                    );
                    if (serial !== reviewSerial.current) return;
                    setSent(r.id);
                    setError(null);
                  } catch (e) {
                    if (serial !== reviewSerial.current) return;
                    setError(
                      new Error(
                        `Not sent or delivery unconfirmed. Retry sends the same report once. ${e instanceof Error ? e.message : ""}`,
                      ),
                    );
                  }
                }}
              >
                {error ? "Retry sending report" : "Send report"}
              </Action>
            </>
          )}
          <ErrorBox error={error} />
        </>
      )}
    </Modal>
  );
}
export function ReportsInbox({ admin }: { admin: boolean }) {
  const [offset, setOffset] = useState(0),
    data = useRemote<{
      total: number;
      retentionDays: number;
      items: {
        id: string;
        createdMs: number;
        acknowledgedMs: number | null;
        summary: Summary;
      }[];
    }>(
      `${admin ? "/api/admin/problem-reports" : "/api/problem-reports"}?offset=${offset}&limit=25`,
    );
  return (
    <>
      <header className="page-head">
        <div>
          <h1>{admin ? "Playback problem reports" : "Your problem reports"}</h1>
          <p>
            Explicit viewer submissions. Reports contain no media or diagnostic
            logs.
          </p>
        </div>
        <button className="secondary" onClick={data.reload}>
          Refresh reports
        </button>
      </header>
      <Load {...data} retry={data.reload} />
      {data.data && (
        <p>
          Retention: {data.data.retentionDays} days · {data.data.total}{" "}
          permitted reports
        </p>
      )}
      {data.data?.items.length === 0 && <Empty title="No reports" />}
      {data.data?.items.map((r) => (
        <article className="panel" key={r.id}>
          <h2>
            {r.summary.category} · {r.acknowledgedMs ? "Acknowledged" : "New"}
          </h2>
          <p>
            Reference {r.id} · Sent {new Date(r.createdMs).toLocaleString()}
          </p>
          <ReportDetails summary={r.summary} />
          {admin && (
            <div className="actions">
              <Action
                secondary
                disabled={Boolean(r.acknowledgedMs)}
                task={async () => {
                  await api(`/api/admin/problem-reports/${r.id}`, "PATCH", {
                    acknowledged: true,
                  });
                  data.reload();
                }}
              >
                Acknowledge report
              </Action>
              <Action
                danger
                task={async () => {
                  if (
                    window.confirm("Permanently delete this problem report?")
                  ) {
                    await api(`/api/admin/problem-reports/${r.id}`, "DELETE");
                    data.reload();
                  }
                }}
              >
                Delete report
              </Action>
            </div>
          )}
        </article>
      ))}
      <div className="actions">
        <button
          className="secondary"
          disabled={offset === 0}
          onClick={() => setOffset((v) => Math.max(0, v - 25))}
        >
          Previous reports
        </button>
        <button
          disabled={!data.data || offset + 25 >= data.data.total}
          onClick={() => setOffset((v) => v + 25)}
        >
          Next reports
        </button>
      </div>
    </>
  );
}
