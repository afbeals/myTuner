import { ProfilesPage } from "./Profiles";
import { confirmAction } from "./confirmation";
import {
  BackgroundStatus,
  WorkAdmissionNotice,
  workAdmissionLabel,
  type WorkAdmission,
} from "./BackgroundStatus";
import { SourcePathField } from "./SourcePathField";
import { MetadataIntegration } from "./MetadataIntegration";
import { SourceDirectory } from "./SourceDirectory";
import { SubtitleSettings } from "./Subtitles";
import { EffectiveAccess, ImportReports, bytes } from "./Administration";
import { MetadataLocation } from "./MetadataEditor";
import { pairingPrefill } from "./pairing-link";
import { lazy, Suspense, useEffect, useState } from "react";
import type { Workspace } from "./App";
import type { Account, Channel, GuideChannel, Profile, Source } from "./types";
import { api } from "./api";
import {
  Action,
  Empty,
  ErrorBox,
  Field,
  Form,
  Load,
  Modal,
  Select,
  useRemote,
  value,
  number,
} from "./ui";
export { AccountsPage } from "./Accounts";
export { ProfilesPage };
export { SourcesPage } from "./Sources";
export function SubscriptionsPage(props: Workspace) {
  return <ProfilesPage {...props} initialSubscriptions={props.profileId} />;
}
export { PairingPage } from "./Pairing";
export { SessionsPage } from "./Sessions";
interface Job extends WorkAdmission {
  id: string;
  status: string;
  directory: string;
  sourceId: string;
  total: number;
  completed: number;
  failed: number;
  error: string | null;
  hasMore?: boolean;
  current?: { relativePath: string } | null;
  items?: {
    id: string;
    mediaId: string;
    title?: string;
    relativePath?: string;
    kind: string;
    status: string;
    error: string | null;
    waitingReason?: string | null;
  }[];
}
interface GenerationPreview {
  count: number;
  items: { id: string; title: string }[];
  reusableOutputs: number;
  newOutputs: number;
  totalOutputs: number;
  totalDurationMs: number;
  availableBytes: number | null;
}
interface Scope {
  sourceId: string;
  directory: string;
  recursive: boolean;
  kinds: string[];
  regenerate: boolean;
}
interface CleanupReview {
  dryRun: boolean;
  review: string;
  staleAssets: number;
  missingReferences: number;
  orphanFiles: number;
  interruptedFiles: number;
  preservedUnknownFiles: number;
  reclaimableBytes: number;
  removedFiles: number;
  removedReferences: number;
}
export function GenerationPage(props: Workspace) {
  const sources = useRemote<Source[]>("/api/sources"),
    jobs = useRemote<Job[]>("/api/admin/generation", props.version, true, {
      intervalMs: 3000,
      active: (rows) =>
        rows.some((row) => ["queued", "running"].includes(row.status)),
    }),
    [selected, setSelected] = useState<string | null>(null),
    [scope, setScope] = useState<Scope | null>(null),
    [preview, setPreview] = useState<GenerationPreview | null>(null),
    [cleanup, setCleanup] = useState<CleanupReview | null>(null),
    [cleanupBusy, setCleanupBusy] = useState(false),
    [starting, setStarting] = useState(false),
    [generationSource, setGenerationSource] = useState("");
  const [logOffset, setLogOffset] = useState(0);
  const job = useRemote<Job>(
    selected
      ? `/api/generation/jobs/${selected}?offset=${logOffset}&limit=100`
      : null,
    props.version,
    true,
    {
      intervalMs: 3000,
      active: (row) => ["queued", "running"].includes(row.status),
    },
  );
  useEffect(() => setLogOffset(0), [selected]);
  useEffect(() => {
    if (job.data && !["queued", "running"].includes(job.data.status))
      jobs.reload();
  }, [job.data?.status]);
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Generated assets</h1>
          <p>
            Optional previews and compatible conversions, stored separately from
            your originals.
          </p>
        </div>
      </header>
      <BackgroundStatus />
      <div className="two-col">
        <Form
          submit="Preview scope"
          disabled={!sources.data?.length}
          onSave={async (d) => {
            const input: Scope = {
              sourceId: value(d, "source"),
              directory: value(d, "directory"),
              recursive: d.has("recursive"),
              kinds: d.getAll("kinds").map(String),
              regenerate: d.has("regenerate"),
            };
            if (!input.kinds.length)
              throw new Error("Choose at least one output.");
            const r = await api<GenerationPreview>(
              "/api/generation/preview",
              "POST",
              input,
            );
            setScope(input);
            setPreview(r);
          }}
        >
          <h2>Choose files & outputs</h2>
          <Load {...sources} retry={sources.reload} />
          {sources.data?.length === 0 && (
            <p>Add a source before generating outputs.</p>
          )}
          <Select
            label="Source"
            name="source"
            required
            value={generationSource || sources.data?.[0]?.id || ""}
            onChange={(e) => setGenerationSource(e.target.value)}
          >
            {sources.data?.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <SourceDirectory
            profileId={props.profileId}
            sourceId={generationSource || sources.data?.[0]?.id}
            label="Folder within source"
            name="directory"
            version={props.version}
          />
          <label className="check">
            <input type="checkbox" name="recursive" />
            Include subfolders
          </label>
          {[
            ["thumbnail", "320px JPEG thumbnails"],
            ["gif", "Short GIF previews"],
            ["conversion", "Compatible MP4 conversions"],
          ].map(([id, label]) => (
            <label className="check" key={id}>
              <input
                name="kinds"
                type="checkbox"
                value={id}
                defaultChecked={id === "thumbnail"}
              />
              {label}
            </label>
          ))}
          <label className="check">
            <input type="checkbox" name="regenerate" />
            Replace existing outputs
          </label>
          <p>
            Valid outputs are reused by default. Conversions use a fixed CPU
            preset and can take time.
          </p>
        </Form>
        <section className="panel">
          <h2>Generation work</h2>
          <Load {...jobs} retry={jobs.reload} />
          {[true, false].map((active) => (
            <section className="settings-section" key={String(active)}>
              <h3>{active ? "Active queue" : "Recent history"}</h3>
              {jobs.data &&
                !jobs.data.some(
                  (job) =>
                    ["queued", "running"].includes(job.status) === active,
                ) && (
                  <p>
                    {active
                      ? "No work is waiting or running."
                      : "No completed jobs yet."}
                  </p>
                )}
              <div className="stack">
                {jobs.data
                  ?.filter(
                    (job) =>
                      ["queued", "running"].includes(job.status) === active,
                  )
                  .map((job) => (
                    <div className="compact-row" key={job.id}>
                      <div>
                        <strong>
                          {sources.data?.find(
                            (source) => source.id === job.sourceId,
                          )?.name ?? "Source"}{" "}
                          / {job.directory || "Entire source"}
                        </strong>
                        <p>
                          {workAdmissionLabel(job) ??
                            (job.status === "completed"
                              ? "Finished"
                              : job.status[0]!.toUpperCase() +
                                job.status.slice(1))}{" "}
                          · {job.completed ?? 0}/{job.total} completed ·{" "}
                          {job.failed ?? 0} failed
                        </p>
                      </div>
                      <button
                        className="secondary"
                        aria-label={`View ${job.status} generation job`}
                        onClick={() => setSelected(job.id)}
                      >
                        View job
                      </button>
                    </div>
                  ))}
              </div>
            </section>
          ))}
        </section>
      </div>
      <section className="panel status-message" aria-label="Output storage">
        <h2>Output storage</h2>
        <p>
          Review stale outputs, missing references and orphaned generated files
          before applying cleanup. Only managed outputs are removed; original
          media stays in place. Wait for active generation to finish.
        </p>
        <div className="actions">
          <Action
            secondary
            disabled={cleanupBusy}
            task={async () => {
              setCleanupBusy(true);
              setCleanup(null);
              try {
                setCleanup(
                  await api<CleanupReview>(
                    "/api/admin/assets/cleanup",
                    "POST",
                    { dryRun: true, reconcile: true },
                  ),
                );
              } finally {
                setCleanupBusy(false);
              }
            }}
          >
            Review cleanup
          </Action>
          {cleanup?.dryRun && (
            <Action
              secondary
              danger
              disabled={cleanupBusy}
              task={async () => {
                if (
                  !(await confirmAction(
                    "Apply this output reconciliation review? Stale/orphan files and missing references will be removed. You can regenerate missing outputs afterward.",
                  ))
                )
                  return;
                setCleanupBusy(true);
                try {
                  setCleanup(
                    await api<CleanupReview>(
                      "/api/admin/assets/cleanup",
                      "POST",
                      {
                        dryRun: false,
                        reconcile: true,
                        review: cleanup.review,
                      },
                    ),
                  );
                } finally {
                  setCleanupBusy(false);
                }
              }}
            >
              Apply reviewed cleanup
            </Action>
          )}
        </div>
        {cleanup && (
          <>
            <p role="status">
              {cleanup.dryRun
                ? "Review ready. No files or references have changed."
                : `Cleanup complete: ${cleanup.removedFiles} files and ${cleanup.removedReferences} references removed.`}
            </p>
            <dl className="inspection-details">
              <dt>Stale outputs</dt>
              <dd>{cleanup.staleAssets}</dd>
              <dt>Missing output references</dt>
              <dd>{cleanup.missingReferences}</dd>
              <dt>Orphaned generated files</dt>
              <dd>{cleanup.orphanFiles}</dd>
              <dt>Interrupted output files</dt>
              <dd>{cleanup.interruptedFiles}</dd>
              <dt>Unknown files preserved</dt>
              <dd>{cleanup.preservedUnknownFiles}</dd>
              <dt>Reclaimable storage in this review</dt>
              <dd>{bytes(cleanup.reclaimableBytes)}</dd>
            </dl>
            <p>
              Regeneration is a separate action. If outputs change or a review
              expires, review cleanup again before applying.
            </p>
          </>
        )}
      </section>
      {preview && scope && (
        <Modal
          title="Confirm generation scope"
          closeDisabled={starting}
          footer={
            <div className="actions">
              {" "}
              <Action
                disabled={!preview.count || starting}
                task={async () => {
                  setStarting(true);
                  try {
                    const j = await api<Job>(
                      "/api/generation/jobs",
                      "POST",
                      scope,
                    );
                    setPreview(null);
                    setSelected(j.id);
                    props.changed();
                  } finally {
                    setStarting(false);
                  }
                }}
              >
                Start generation
              </Action>
              <button
                className="secondary"
                disabled={starting}
                onClick={() => setPreview(null)}
              >
                Cancel
              </button>
            </div>
          }
          onClose={() => setPreview(null)}
        >
          <h3>
            {sources.data?.find((source) => source.id === scope.sourceId)?.name}{" "}
            / {scope.directory || "Entire source"}
          </h3>
          <p>
            {scope.regenerate
              ? "Replace existing outputs"
              : "Reuse valid existing outputs"}{" "}
            · {scope.kinds.join(", ")}
          </p>
          <p>
            {preview.count} files · {scope.kinds.length} output types ·{" "}
            {scope.recursive ? "Including subfolders" : "This folder only"}
          </p>
          <p>
            {preview.totalOutputs} requested outputs · {preview.reusableOutputs}{" "}
            reusable · {preview.newOutputs} new. Total source duration:{" "}
            {(preview.totalDurationMs / 60000).toFixed(1)} minutes. Output
            storage headroom: {bytes(preview.availableBytes)}. Size and time
            estimates are unknown.
          </p>
          <ul>
            {preview.items.slice(0, 20).map((i) => (
              <li key={i.id}>{i.title}</li>
            ))}
          </ul>
          {preview.count > 20 && <p>And {preview.count - 20} more files.</p>}
        </Modal>
      )}
      {selected && (
        <Modal
          title="Generation progress"
          onClose={() => setSelected(null)}
          footer={
            <div className="actions">
              {job.data && (
                <>
                  {" "}
                  <div className="actions">
                    {["queued", "running"].includes(job.data.status) && (
                      <Action
                        secondary
                        danger
                        task={async () => {
                          if (
                            !(await confirmAction(
                              "Cancel unfinished generation? Completed outputs remain available. Original media is unchanged.",
                            ))
                          )
                            return;
                          await api(
                            `/api/generation/jobs/${selected}/cancel`,
                            "POST",
                          );
                          job.reload();
                          jobs.reload();
                        }}
                      >
                        Cancel job
                      </Action>
                    )}
                    {["failed", "cancelled"].includes(job.data.status) && (
                      <Action
                        task={async () => {
                          await api(
                            `/api/admin/generation/${selected}/retry`,
                            "POST",
                          );
                          job.reload();
                          jobs.reload();
                        }}
                      >
                        Retry unfinished outputs
                      </Action>
                    )}
                  </div>
                </>
              )}
              <button className="secondary" onClick={() => setSelected(null)}>
                Done
              </button>
            </div>
          }
        >
          <Load {...job} retry={job.reload} />
          {job.data && (
            <>
              <p role="status">
                {workAdmissionLabel(job.data) ?? job.data.status} ·{" "}
                {job.data.completed}/{job.data.total} outputs completed ·{" "}
                {job.data.failed} failed
              </p>
              <WorkAdmissionNotice work={job.data} />
              <progress
                aria-label="Generation progress"
                max={Math.max(1, job.data.total)}
                value={job.data.completed + job.data.failed}
              />
              <ErrorBox error={job.data.error} />
              <h3>
                {sources.data?.find(
                  (source) => source.id === job.data?.sourceId,
                )?.name ?? "Source"}{" "}
                /{" "}
                {job.data.current
                  ? job.data.current.relativePath
                      .split("/")
                      .slice(0, -1)
                      .join("/") || "Source root"
                  : job.data.directory || "Entire source"}
              </h3>
              <p role="status">
                {workAdmissionLabel(job.data) ??
                  (job.data.current && job.data.admission === "active"
                    ? `Processing: ${job.data.current.relativePath.split("/").at(-1)}`
                    : ["queued", "running"].includes(job.data.status)
                      ? "Waiting for the next file"
                      : "Work finished")}
              </p>
              <details open={!["queued", "running"].includes(job.data.status)}>
                <summary>File results · {job.data.total} outputs</summary>
                <ul className="result-log">
                  {job.data.items?.map((item) => (
                    <li key={item.id}>
                      <strong>{item.status}</strong> ·{" "}
                      {item.relativePath ?? item.title} · {item.kind}
                      {item.error && (
                        <span className="error"> — {item.error}</span>
                      )}
                      {item.waitingReason === "playback-capacity" &&
                        " · Waiting for playback capacity"}
                    </li>
                  ))}
                </ul>
                <div className="actions">
                  <button
                    className="secondary"
                    disabled={!logOffset || job.loading}
                    onClick={() => setLogOffset((n) => Math.max(0, n - 100))}
                  >
                    Previous results
                  </button>
                  <button
                    className="secondary"
                    disabled={!job.data.hasMore || job.loading}
                    onClick={() => setLogOffset((n) => n + 100)}
                  >
                    Next results
                  </button>
                </div>
              </details>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
const BundledHelp = lazy(() =>
  import("./Help").then((module) => ({ default: module.HelpPage })),
);
export function HelpPage(props: { returnTo?: string }) {
  return (
    <Suspense
      fallback={
        <main className="help panel">
          <p role="status">Loading help…</p>
        </main>
      }
    >
      <BundledHelp {...props} />
    </Suspense>
  );
}
