import { useState } from "react";
import type { Account } from "./types";
import { api } from "./api";
import { Field, Form, Load, Select, useRemote } from "./ui";
export const bytes = (value: number | null | undefined) =>
  value == null ? "Unknown" : `${(value / 1024 ** 3).toFixed(2)} GiB`;
const when = (value: number | null | undefined) =>
  value ? new Date(value).toLocaleString() : "Not recorded";
type Status = {
  checkedMs: number;
  database: string;
  sources: {
    id: string;
    name: string;
    readable: boolean;
    refreshState: string;
    lastImportMs: number | null;
    nextRefreshMs: number | null;
    lastAttemptMs?: number | null;
    lastRefreshMs?: number | null;
    refreshScheduled?: boolean;
    refreshError?: string | null;
  }[];
  sourcesTruncated: boolean;
  storage: { kind: string; state: string; freeBytes: number | null }[];
  backups: {
    state: string;
    latestCompletedMs: number | null;
    truncated: boolean;
  };
  generation: { status: string; count: number }[];
  schedules: {
    id: string;
    name: string;
    state: string;
    coverageEndMs: number | null;
  }[];
};
type Setup = {
  profiles: number;
  sources: number;
  availableMedia: number;
  sourceGrants: number;
  publishedChannels: number;
  subscriptions: number;
  pairedDevices: number;
};
export function OperationsPage() {
  const status = useRemote<Status>("/api/admin/status"),
    setup = useRemote<Setup>("/api/admin/setup");
  const steps: [keyof Setup, string, string][] = [
    ["profiles", "Create a person or room profile", "profiles"],
    ["sources", "Add a read-only media source", "sources"],
    ["availableMedia", "Scan files into the library", "sources"],
    ["sourceGrants", "Grant source access to a profile", "profiles"],
    ["publishedChannels", "Preview and publish a channel", "channels"],
    ["subscriptions", "Subscribe the viewing profile", "subscriptions"],
    ["pairedDevices", "Connect and approve your TV", "connect-tv"],
  ];
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Setup & server health</h1>
          <p>
            Read-only checks for your application, sources and recovery
            readiness.
          </p>
        </div>
        <button
          className="secondary"
          onClick={() => {
            status.reload();
            setup.reload();
          }}
        >
          Refresh overview
        </button>
      </header>
      <section className="panel">
        <h2>Get ready to watch</h2>
        <p>
          Custom folders work on their own. Sonarr and Radarr are optional
          metadata integrations.
        </p>
        <Load {...setup} retry={setup.reload} />
        <ol className="setup-steps">
          {steps.map(([key, label, hash]) => (
            <li key={key}>
              <span>
                {setup.data
                  ? setup.data[key] > 0
                    ? "✓ Complete"
                    : "To do"
                  : "Unknown"}
              </span>{" "}
              · <a href={`#${hash}`}>{label}</a>
            </li>
          ))}
        </ol>
        <p>
          These are server-wide readiness counts. Check the intended profile’s
          access and subscriptions before watching.
        </p>
      </section>
      <Load {...status} retry={status.reload} />
      {status.data && (
        <>
          <p>
            Checked {when(status.data.checkedMs)}. Results may be cached for up
            to 15 seconds.
          </p>
          <div className="two-col">
            <section className="panel">
              <h2>Sources</h2>
              {status.data.sources.map((s) => (
                <div key={s.id}>
                  <h3>{s.name}</h3>
                  <p>
                    {s.readable ? "Readable" : "Unreadable or check timed out"}{" "}
                    · Refresh:{" "}
                    {{
                      never: "Not yet checked",
                      incomplete: "In progress or interrupted",
                      failed: "Failed",
                      overdue: "Overdue",
                      ok: "Last check succeeded",
                    }[s.refreshState] ?? s.refreshState}
                  </p>
                  <p>
                    Last import: {when(s.lastImportMs)} · Next refresh:{" "}
                    {s.nextRefreshMs == null
                      ? "Not scheduled · manual checks only"
                      : when(s.nextRefreshMs)}
                  </p>
                  <p>
                    Last check: {when(s.lastAttemptMs)} · Last successful check:{" "}
                    {when(s.lastRefreshMs)}
                  </p>
                  {s.refreshError && <p role="status">{s.refreshError}</p>}
                </div>
              ))}
              {status.data.sources.length === 0 && (
                <p>No sources configured.</p>
              )}
              {status.data.sourcesTruncated && (
                <p>Showing the first 32 sources.</p>
              )}
              <a href="#sources">Review sources and integrations</a>
            </section>
            <section className="panel">
              <h2>Database & storage</h2>
              <p>Database: {status.data.database}</p>
              {status.data.storage.map((s) => (
                <p key={s.kind}>
                  {s.kind}: {s.state} · Free: {bytes(s.freeBytes)}
                </p>
              ))}
              <h3>Application backups</h3>
              <p>
                {status.data.backups.state === "none"
                  ? "No completed application backup found"
                  : status.data.backups.state === "completed"
                    ? `Last completed: ${when(status.data.backups.latestCompletedMs)}`
                    : "Backup state unknown"}
              </p>
              <p>
                Backups are operator-triggered with the backup CLI. Full bundles
                include SQLite and its matching integration key. Originals and
                derivatives are excluded. No recurring backup schedule is
                configured by this application. Restore runs offline.
              </p>
              {status.data.backups.truncated && (
                <p>Only the newest 200 backup candidates were checked.</p>
              )}
              <a href="#setup">Backup and recovery instructions</a>
            </section>
          </div>
          <section className="panel">
            <h2>Generation & schedules</h2>
            <p>
              {status.data.generation
                .map((j) => `${j.count} ${j.status}`)
                .join(" · ") || "No generation jobs"}
            </p>
            <a href="#generated">Review generation jobs</a>
            {status.data.schedules.map((s) => (
              <p key={s.id}>
                {s.name}: {s.state} · Coverage through {when(s.coverageEndMs)}
              </p>
            ))}
            {status.data.schedules.length === 0 && (
              <p>No channel schedules yet.</p>
            )}
            <p>
              Coverage reflects materialized intervals, not measured playback or
              physical-TV health.
            </p>
          </section>
        </>
      )}
    </>
  );
}
type Access = {
  disabled: boolean;
  canWatch: boolean;
  canManage: boolean;
  pinRequiredOnTv: boolean;
  pinRequiredInBrowser: boolean;
  adminException: boolean;
  grants: { sourceId: string; name: string; subtree: string }[];
  subscriptions: { id: string; name: string; mediaAllowed: boolean }[];
};
export function EffectiveAccess({ profileId }: { profileId: string }) {
  const accounts = useRemote<Account[]>("/api/accounts"),
    [accountId, setAccountId] = useState("");
  const target = accountId || accounts.data?.[0]?.id;
  const access = useRemote<Access>(
    target ? `/api/admin/profiles/${profileId}/access/${target}` : null,
  );
  return (
    <section className="panel">
      <h3>Explain account access</h3>
      <p>Evaluate the selected account’s permissions for this profile.</p>
      <Load {...accounts} retry={accounts.reload} />
      <Select
        label="Inspect account"
        value={target ?? ""}
        onChange={(e) => setAccountId(e.target.value)}
      >
        {accounts.data?.map((a) => (
          <option key={a.id} value={a.id}>
            {a.username} · {a.role}
            {a.disabled ? " · disabled" : ""}
          </option>
        ))}
      </Select>
      <Load {...access} retry={access.reload} />
      {access.data && (
        <>
          <p>
            {access.data.disabled
              ? "Account disabled"
              : access.data.canWatch
                ? "Profile viewing allowed"
                : "Profile viewing denied"}{" "}
            ·{" "}
            {access.data.canManage ? "Management allowed" : "Management denied"}
          </p>
          {access.data.adminException && (
            <p>This target account has the administrator access exception.</p>
          )}
          <p>
            TV PIN: {access.data.pinRequiredOnTv ? "Required" : "Not required"}.
            Browser PIN:{" "}
            {access.data.pinRequiredInBrowser ? "Required" : "Not required"}.
            Unlock state depends on the device session.
          </p>
          <h4>Allowed sources</h4>
          {access.data.grants.map((g, i) => (
            <p key={`${g.sourceId}:${i}`}>
              {g.name} · {g.subtree || "Entire source"}
            </p>
          ))}
          {access.data.grants.length === 0 && <p>No source access.</p>}
          <h4>Subscription readiness</h4>
          {access.data.subscriptions.map((s) => (
            <p key={s.id}>
              {s.name} ·{" "}
              {s.mediaAllowed
                ? "Scheduled media permitted"
                : "Source grants need attention"}
            </p>
          ))}
          {access.data.subscriptions.length === 0 && (
            <p>No visible subscriptions.</p>
          )}
        </>
      )}
    </section>
  );
}
type ImportRun = {
  id: string;
  provider: string;
  completedMs: number;
  scanComplete: number;
  summary: Record<string, number>;
};
export function ImportReports({ sourceId }: { sourceId: string }) {
  const runs = useRemote<{ items: ImportRun[] }>(
      `/api/admin/sources/${sourceId}/imports`,
    ),
    [selected, setSelected] = useState(""),
    [offset, setOffset] = useState(0);
  const report = useRemote<
    ImportRun & {
      items: { externalId: string; state: string; title?: string }[];
    }
  >(
    selected
      ? `/api/admin/imports/${selected}?offset=${offset}&limit=50`
      : null,
  );
  const [mapping, setMapping] = useState<
    { upstreamPath: string; mappedPath: string | null; state: string }[] | null
  >(null);
  return (
    <section className="panel">
      <h3>Mapping and import review</h3>
      <p>
        These checks read existing configuration and catalog associations. An
        absent association is a review candidate; nothing is detached
        automatically.
      </p>
      <Form
        submit="Check sample mappings"
        onSave={async (d) => {
          const paths = String(d.get("paths") ?? "")
            .split("\n")
            .map((p) => p.trim())
            .filter(Boolean);
          if (!paths.length || paths.length > 20)
            throw Error("Enter one to twenty upstream file paths.");
          const result = await api<{ items: NonNullable<typeof mapping> }>(
            `/api/admin/sources/${sourceId}/mapping-check`,
            "POST",
            { paths },
          );
          setMapping(result.items);
        }}
      >
        <label className="field">
          <span>Upstream paths · one per line</span>
          <textarea name="paths" rows={3} maxLength={81920} required />
        </label>
      </Form>
      {mapping?.map((m, i) => (
        <p key={i} className="metadata-preview">
          {m.upstreamPath} →{" "}
          {m.mappedPath ?? "Outside configured source mapping"} · {m.state}
        </p>
      ))}
      <Load {...runs} retry={runs.reload} />
      <button className="secondary" onClick={runs.reload}>
        Refresh import history
      </button>
      {runs.data?.items.length === 0 && (
        <p>
          No completed import reports. A source without an integration can still
          scan and play files.
        </p>
      )}
      <Select
        label="Import report"
        value={selected}
        onChange={(e) => {
          setSelected(e.target.value);
          setOffset(0);
        }}
      >
        <option value="">Choose a completed import</option>
        {runs.data?.items.map((r) => (
          <option key={r.id} value={r.id}>
            {r.provider} · {when(r.completedMs)}
          </option>
        ))}
      </Select>
      <Load {...report} retry={report.reload} />
      {report.data && (
        <>
          <p>
            Source scan:{" "}
            {report.data.scanComplete
              ? "Complete"
              : "Incomplete or not yet recorded"}
            . Provider-specific completeness still needs installed-provider
            acceptance.
          </p>
          <p>
            {Object.entries(report.data.summary)
              .map(([key, n]) => `${key}: ${n}`)
              .join(" · ")}
          </p>
          <ul>
            {report.data.items.map((i) => (
              <li key={i.externalId}>
                {i.title ?? `Provider item ${i.externalId}`} · {i.state}
              </li>
            ))}
          </ul>
          <div className="actions">
            <button
              className="secondary"
              disabled={!offset || report.loading}
              onClick={() => setOffset((n) => n - 50)}
            >
              Previous report items
            </button>
            <button
              className="secondary"
              disabled={report.data.items.length < 50 || report.loading}
              onClick={() => setOffset((n) => n + 50)}
            >
              Next report items
            </button>
          </div>
        </>
      )}
    </section>
  );
}
