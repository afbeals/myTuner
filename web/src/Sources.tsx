import { useEffect, useId, useRef, useState } from "react";
import type { Workspace } from "./App";
import type { Source } from "./types";
import { api } from "./api";
import { confirmAction } from "./confirmation";
import {
  BackgroundStatus,
  WorkAdmissionNotice,
  workAdmissionLabel,
  type WorkAdmission,
} from "./BackgroundStatus";
import { SourcePathField } from "./SourcePathField";
import { SourceConfiguration } from "./SourceConfiguration";
import { ImportReports } from "./Administration";
import {
  Action,
  Empty,
  Field,
  Form,
  Load,
  Modal,
  ModalCancel,
  Select,
  SettingsRecovery,
  submissionErrorMessage,
  useRemote,
  value,
} from "./ui";
type ScanResult =
  | { superseded: true }
  | {
      seen: number;
      updated: number;
      missing: number;
      complete: boolean;
      superseded?: boolean;
      errors: { path?: string; message?: string; error?: string }[];
      imported?: { matched: number; unmatched: number };
    };
function scanSummary(result?: ScanResult) {
  if (!result) return "Open Scan and refresh for results.";
  return result.superseded
    ? "Settings changed. Open Scan and refresh to run again."
    : `${result.seen} videos found. Open Scan and refresh for results.`;
}
type ScanState = {
  status: "running" | "completed" | "failed";
  result?: ScanResult;
  error?: string;
};
export function SourcesPage(props: Workspace) {
  const sources = useRemote<Source[]>("/api/sources", props.version),
    [edit, setEdit] = useState<Source | "new" | null>(null),
    [configure, setConfigure] = useState<Source | null>(null),
    [scan, setScan] = useState<Source | null>(null),
    [scans, setScans] = useState<Record<string, ScanState>>({}),
    [notice, setNotice] = useState(""),
    [grantNextStep, setGrantNextStep] = useState(false);
  const changed = () => {
    sources.reload();
    props.changed();
  };
  const active = useRef(new Set<string>());
  const run = async (source: Source, metadata: boolean) => {
    if (active.current.has(source.id)) return;
    active.current.add(source.id);
    setScans((old) => ({ ...old, [source.id]: { status: "running" } }));
    try {
      const result = await api<ScanResult>(
        `/api/sources/${source.id}/scan`,
        "POST",
        { metadata },
      );
      setScans((old) => ({
        ...old,
        [source.id]: { status: "completed", result },
      }));
      setGrantNextStep(!result.superseded);
      setNotice(
        result.superseded
          ? `${source.name}: Settings changed during the scan. Review settings and run again.`
          : `${source.name}: ${result.complete ? "Scan completed" : "Scan completed with issues"}. ${result.seen} videos found.`,
      );
    } catch (error) {
      setScans((old) => ({
        ...old,
        [source.id]: {
          status: "failed",
          error:
            error instanceof Error ? error.message : "Scan failed. Try again.",
        },
      }));
    } finally {
      active.current.delete(source.id);
      changed();
    }
  };
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Sources</h1>
          <p>Your existing media directories and metadata connections.</p>
        </div>
        <button onClick={() => setEdit("new")}>Add source</button>
      </header>
      <BackgroundStatus />
      {notice && (
        <p role="status" className="notice">
          {notice}{" "}
          {grantNextStep && (
            <>
              <a href="#profiles">Choose permitted profiles →</a> In Manage
              profile, add this source under Allowed library. Access is never
              granted automatically.
            </>
          )}
        </p>
      )}
      <Load {...sources} retry={sources.reload} />
      <div className="stack">
        {sources.data?.map((source) => (
          <section className="panel" key={source.id}>
            <div className="section-head">
              <h2>{source.name}</h2>
              <span className="badge">{source.kind}</span>
            </div>
            <p>
              <code>{source.rootPath}</code> ·{" "}
              {source.recursive ? "Includes subfolders" : "This directory only"}
            </p>
            <div className="actions">
              <button onClick={() => setScan(source)}>Scan and refresh</button>
              <button
                className="secondary"
                aria-label={`Configure ${source.name}`}
                onClick={() => setConfigure(source)}
              >
                Configure
              </button>
              <button
                className="secondary"
                disabled={scans[source.id]?.status === "running"}
                aria-label={`Edit ${source.name}`}
                onClick={() => setEdit(source)}
              >
                Edit
              </button>
              <Action
                secondary
                danger
                label={`Remove source ${source.name}`}
                disabled={scans[source.id]?.status === "running"}
                task={async () => {
                  if (
                    !(await confirmAction(
                      `Remove ${source.name}, its catalog, connection and profile grants? Sources referenced by programming or collections cannot be removed. Original videos and metadata files are kept.`,
                      {
                        title: `Remove ${source.name}?`,
                        label: "Remove source",
                      },
                    ))
                  )
                    return;
                  await api(`/api/sources/${source.id}`, "DELETE");
                  setGrantNextStep(false);
                  setNotice(`Source removed: ${source.name}.`);
                  changed();
                }}
              >
                Remove source
              </Action>
            </div>
            {scans[source.id] && (
              <p
                role={
                  scans[source.id]!.status === "failed" ? "alert" : "status"
                }
              >
                {scans[source.id]!.status === "running"
                  ? "Scan requested. Open Scan and refresh for progress."
                  : (scans[source.id]!.error ??
                    scanSummary(scans[source.id]!.result))}
              </p>
            )}
          </section>
        ))}
      </div>
      {sources.data?.length === 0 && (
        <Empty title="Add your first source">
          Map a media share into MyTuner as read-only, then select its
          directory.
        </Empty>
      )}
      {edit && (
        <SourceEditor
          key={edit === "new" ? "new" : edit.id}
          source={edit === "new" ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={(reset) => {
            setEdit(null);
            setGrantNextStep(true);
            setNotice(
              reset
                ? "Source saved. Configure metadata and profile access, then scan the new directory."
                : "Source saved. Choose which profiles can use it, then scan when you are ready.",
            );
            changed();
          }}
        />
      )}
      {configure && (
        <SourceConfiguration
          source={configure}
          onClose={() => setConfigure(null)}
          onSaved={() => {
            setConfigure(null);
            setGrantNextStep(false);
            setNotice(`Configuration saved: ${configure.name}.`);
            changed();
          }}
        />
      )}
      {scan && (
        <ScanModal
          source={scan}
          state={scans[scan.id]}
          onRun={(metadata) => void run(scan, metadata)}
          onClose={() => setScan(null)}
          onConfigure={() => {
            setConfigure(scan);
            setScan(null);
          }}
        />
      )}
    </>
  );
}
type SourceSnapshot = Source & { revision: string };
function SourceEditor({
  source,
  onClose,
  onSaved,
}: {
  source: Source | null;
  onClose: () => void;
  onSaved: (reset: boolean) => void;
}) {
  const id = useId(),
    remote = useRemote<SourceSnapshot>(
      source ? `/api/sources/${source.id}` : null,
    ),
    [baseline, setBaseline] = useState<SourceSnapshot | null>(null),
    [recoveryVersion, setRecoveryVersion] = useState(0),
    [draft, setDraft] = useState({
      name: "",
      root: "",
      kind: "shows",
      recursive: true,
    }),
    [busy, setBusy] = useState(false);
  const load = (saved: SourceSnapshot) => {
    setBaseline(saved);
    setRecoveryVersion((version) => version + 1);
    setDraft({
      name: saved.name,
      root: saved.rootPath ?? "",
      kind: saved.kind,
      recursive: Boolean(saved.recursive),
    });
  };
  useEffect(() => {
    if (remote.data && !baseline) load(remote.data);
  }, [remote.data, baseline]);
  return (
    <Modal
      title={source ? `Edit source ${source.name}` : "Add a source"}
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <div className="actions">
          <button
            type="submit"
            form={id}
            disabled={busy || Boolean(source && !baseline)}
          >
            {source ? "Save source" : "Add source"}
          </button>
          <ModalCancel />
        </div>
      }
    >
      <Load {...remote} retry={remote.reload} />
      {(!source || baseline) && (
        <Form
          key={`${baseline?.revision ?? "new"}:${recoveryVersion}`}
          id={id}
          hideActions
          onBusyChange={setBusy}
          renderError={(error) => (
            <>
              {submissionErrorMessage(error)}
              {source && (
                <SettingsRecovery
                  error={error}
                  load={() => api<SourceSnapshot>(`/api/sources/${source.id}`)}
                  apply={load}
                  describe={(latest) => (
                    <p>
                      {latest.name} · <code>{latest.rootPath}</code> ·{" "}
                      {latest.kind} ·{" "}
                      {latest.recursive
                        ? "Includes subfolders"
                        : "This directory only"}
                    </p>
                  )}
                />
              )}
            </>
          )}
          onSave={async () => {
            const reset = Boolean(
              baseline &&
              (draft.root.trim() !== baseline.rootPath ||
                draft.kind !== baseline.kind),
            );
            if (
              reset &&
              !(await confirmAction(
                "Changing the directory or media type resets this source’s catalog, connection and profile grants. Sources in use cannot be reset. Original files are kept.",
                {
                  title: `Reset ${baseline!.name}'s catalog?`,
                  label: "Save and reset catalog",
                },
              ))
            )
              return false;
            const result = await api<{ catalogReset?: boolean }>(
              source ? `/api/sources/${source.id}` : "/api/sources",
              source ? "PATCH" : "POST",
              {
                ...draft,
                name: draft.name.trim(),
                root: draft.root.trim(),
                ...(baseline
                  ? { revision: baseline.revision, resetConfirmed: reset }
                  : {}),
              },
            );
            onSaved(Boolean(result.catalogReset));
          }}
        >
          <Field
            label="Source name"
            name="name"
            required
            maxLength={120}
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
          <SourcePathField
            label="Media directory inside MyTuner"
            name="root"
            purpose="source"
            {...(source ? { sourceId: source.id } : {})}
            value={draft.root}
            onChange={(root) => setDraft({ ...draft, root })}
            placeholder="/tv"
            required
          />
          <Select
            label="Media type"
            name="kind"
            value={draft.kind}
            onChange={(event) =>
              setDraft({ ...draft, kind: event.target.value })
            }
          >
            <option value="shows">TV shows · Sonarr optional</option>
            <option value="movies">Movies · Radarr optional</option>
            <option value="videos">Custom videos</option>
            <option value="commercials">Commercials</option>
          </Select>
          <label className="check">
            <input
              type="checkbox"
              name="recursive"
              checked={draft.recursive}
              onChange={(event) =>
                setDraft({ ...draft, recursive: event.target.checked })
              }
            />
            Include subfolders
          </label>
          <p>
            Scanning reads your files in place. Asset generation starts only
            when requested.
          </p>
        </Form>
      )}
    </Modal>
  );
}
function ScanModal({
  source,
  state,
  onRun,
  onClose,
  onConfigure,
}: {
  source: Source;
  state?: ScanState | undefined;
  onRun: (metadata: boolean) => void;
  onClose: () => void;
  onConfigure: () => void;
}) {
  const configuration = useRemote<{ integration: { provider: string } | null }>(
      `/api/sources/${source.id}/configuration`,
    ),
    [metadata, setMetadata] = useState(true),
    status = useRemote<
      WorkAdmission & {
        running: boolean;
        attempt: {
          lastAttemptMs: number;
          lastCompletedMs: number | null;
          lastSuccessMs: number | null;
          lastError: string | null;
        } | null;
      }
    >(
      `/api/sources/${source.id}/scan-status`,
      state?.status === "running" ? 1 : 0,
      false,
      { intervalMs: 2000, active: (data) => data.running },
    ),
    pending = state?.status === "running" || Boolean(status.data?.running),
    result = state?.result;
  return (
    <Modal
      title={`Scan ${source.name}`}
      onClose={onClose}
      footer={
        <div className="actions">
          <button
            disabled={pending || status.loading || Boolean(status.error)}
            onClick={() =>
              onRun(Boolean(configuration.data?.integration) && metadata)
            }
          >
            {pending
              ? ((status.data && workAdmissionLabel(status.data)) ??
                "Scan pending…")
              : "Start scan"}
          </button>
          <ModalCancel>
            {pending ? "Close · scan continues" : "Close"}
          </ModalCancel>
        </div>
      }
    >
      <section className="settings-section">
        <h3>Scan options</h3>
        <p>
          <code>{source.rootPath}</code> ·{" "}
          {source.recursive ? "Includes subfolders" : "This directory only"}
        </p>
        {configuration.data?.integration ? (
          <label className="check">
            <input
              type="checkbox"
              checked={metadata}
              disabled={pending}
              onChange={(event) => setMetadata(event.target.checked)}
            />
            Refresh connected{" "}
            {configuration.data.integration.provider === "sonarr"
              ? "Sonarr"
              : "Radarr"}{" "}
            metadata
          </label>
        ) : (
          <p>
            No metadata application connected. Scanning your files does not
            require one.
          </p>
        )}
        <button
          type="button"
          className="secondary"
          disabled={pending}
          onClick={onConfigure}
        >
          Change source configuration
        </button>
        <p>
          Unchanged videos reuse their inspection data. This scan checks
          directory listings and captions; it does not generate artwork or copy
          media.
        </p>
        <Load {...status} retry={status.reload} />
        {status.data?.attempt && (
          <>
            <p>
              Last started{" "}
              {new Date(status.data.attempt.lastAttemptMs).toLocaleString()} ·{" "}
              {status.data.attempt.lastError ??
                (status.data.attempt.lastCompletedMs
                  ? "Finished"
                  : (workAdmissionLabel(status.data) ??
                    (status.data.admission === "active"
                      ? "Scanning"
                      : "Pending")))}
            </p>
            {status.data.attempt.lastCompletedMs !== null && (
              <p>
                Last completed{" "}
                <time
                  dateTime={new Date(
                    status.data.attempt.lastCompletedMs,
                  ).toISOString()}
                >
                  {new Date(
                    status.data.attempt.lastCompletedMs,
                  ).toLocaleString()}
                </time>
              </p>
            )}
          </>
        )}
      </section>
      {pending && (
        <>
          {status.data && <WorkAdmissionNotice work={status.data} />}
          {!workAdmissionLabel(status.data ?? {}) && (
            <p role="status">
              {status.data?.admission === "active"
                ? "Scanning this source."
                : "Scan request pending. Checking server progress."}{" "}
              You can close this dialog; the request continues on the server.
            </p>
          )}
        </>
      )}
      {state?.error && (
        <p role="alert" className="error">
          {state.error}
        </p>
      )}
      {result?.superseded && (
        <section className="settings-section" aria-label="Scan results">
          <h3>Settings changed during scan</h3>
          <p>
            These results belong to earlier settings. Review the source
            configuration and start another scan.
          </p>
        </section>
      )}
      {result && !result.superseded && (
        <section className="settings-section" aria-label="Scan results">
          <h3>
            {result.complete ? "Scan completed" : "Scan completed with issues"}
          </h3>
          <p>
            {result.seen} videos found · {result.updated} updated ·{" "}
            {result.missing} missing · {result.errors.length} errors
          </p>
          {result.imported && (
            <p>
              Metadata: {result.imported.matched} matched ·{" "}
              {result.imported.unmatched} unmatched
            </p>
          )}
          <p>
            <a href="#profiles">Choose profiles for this source →</a> In Manage
            profile, add it under Allowed library. No access is granted
            automatically.
          </p>
          {!result.complete && (
            <p>
              Previous availability was retained where the scan could not
              complete. Review errors and retry.
            </p>
          )}
          {result.errors.length > 0 && (
            <details>
              <summary>File errors</summary>
              <div className="bounded-checklist">
                {result.errors.map((error, index) => (
                  <p key={index}>
                    <code>{error.path ?? "File"}</code> ·{" "}
                    {error.message ?? error.error ?? "Unable to inspect file"}
                  </p>
                ))}
              </div>
            </details>
          )}
        </section>
      )}
      <details>
        <summary>Metadata import history and mapping checks</summary>
        <ImportReports
          key={`${source.id}:${state?.status ?? "idle"}`}
          sourceId={source.id}
        />
      </details>
    </Modal>
  );
}
