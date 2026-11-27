import { useId, useLayoutEffect, useRef, useState } from "react";
import { api } from "./api";
import { Form, Load, Modal, ModalCancel, Select, useRemote } from "./ui";

type Category = {
  id: string;
  label: string;
  description: string;
  requires: { category: string; reason: string }[];
};
type Administrator = { id: string; username: string };
type Options = {
  execution: "offline-only";
  retainedAdmin: Administrator;
  categories: Category[];
  instructions: string[];
};
type Preview = {
  execution: "offline-only";
  mode: "selective" | "fresh";
  requestedCategories: string[];
  effectiveCategories: string[];
  dependencies: { category: string; requiredBy: string; reason: string }[];
  tableCounts: {
    table: string;
    action: "delete" | "update" | "preserve";
    count: number;
    reason: string;
  }[];
  totalRecords: number;
  retainedAdmin: Administrator;
  revision: string;
  confirmationText: string;
  cli: { previewCommand: string; applyCommand: string };
  instructions: string[];
  filesystemCleanupDisabled: boolean;
};
const recoveryLink =
  "#setup?topic=recovery&section=reset-application-data-offline";

/** Browser planning is read-only. Execution requires the stopped server's data lock. */
export function ResetData() {
  const [open, setOpen] = useState(false);
  return (
    <details className="panel">
      <summary>Reset application data · offline execution</summary>
      <p>
        Review a selective reset or a fresh start while keeping your current
        administrator. Execution requires stopping myTuner so scans, playback
        and other requests cannot change the database during reset.
      </p>
      <p>
        Physical videos, subtitles, metadata files, generated outputs, cache
        files and existing backups stay on disk.
      </p>
      <button className="secondary" onClick={() => setOpen(true)}>
        Review reset options
      </button>
      {open && <ResetDialog onClose={() => setOpen(false)} />}
    </details>
  );
}
function ResetDialog({ onClose }: { onClose: () => void }) {
  const options = useRemote<Options>("/api/admin/reset/options"),
    formId = useId(),
    [mode, setMode] = useState<"selective" | "fresh">("selective"),
    [requested, setRequested] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null);
  const heading = useRef<HTMLHeadingElement>(null),
    categories = options.data?.categories ?? [],
    labels = new Map(
      categories.map((category) => [category.id, category.label]),
    ),
    effective = new Set(
      mode === "fresh" ? categories.map((category) => category.id) : requested,
    ),
    dependencies: { category: string; requiredBy: string; reason: string }[] =
      [];
  // Focus only after React has committed the preview heading. A frame requested
  // in the response handler can run before that commit or be throttled in a tab.
  useLayoutEffect(() => {
    if (!preview) return;
    heading.current?.focus();
    heading.current?.scrollIntoView({ block: "nearest" });
  }, [preview]);
  const queue = [...effective];
  for (let index = 0; index < queue.length; index++) {
    const requiredBy = queue[index]!;
    for (const dependency of categories.find(
      (category) => category.id === requiredBy,
    )?.requires ?? []) {
      dependencies.push({ ...dependency, requiredBy });
      if (!effective.has(dependency.category)) {
        effective.add(dependency.category);
        queue.push(dependency.category);
      }
    }
  }
  const supported = options.data?.execution === "offline-only";
  return (
    <Modal
      title="Review application data reset"
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <div className="actions">
          {preview ? (
            <button
              key="change-choices"
              type="button"
              className="secondary"
              onClick={(event) => {
                event.preventDefault();
                setPreview(null);
              }}
            >
              Change choices
            </button>
          ) : (
            <button
              key="review-reset"
              form={formId}
              type="submit"
              disabled={busy || !supported || !effective.size}
            >
              {busy ? "Reviewing…" : "Review exact changes"}
            </button>
          )}
          <ModalCancel>{preview ? "Done" : "Cancel"}</ModalCancel>
        </div>
      }
    >
      <p className="notice" role="status">
        Preview only. This page does not reset the database. The offline tool
        requires your administrator password and a final typed confirmation.
      </p>
      <p>
        Reset removes or updates database records. Source directories, media,
        subtitles, NFO files, generated assets, cache files, unknown files and
        existing backups are kept. No physical cleanup is included.
      </p>
      <Load {...options} retry={options.reload} />
      {options.data && (
        <section
          className="settings-section"
          aria-label="Retained administrator"
        >
          <h3>Administrator kept after reset</h3>
          <p>
            <strong>{options.data.retainedAdmin.username}</strong> ·{" "}
            <code>{options.data.retainedAdmin.id}</code>
          </p>
          <p>
            This is your currently signed-in administrator. Its existing
            credentials are kept. The offline tool verifies this account’s
            password before applying changes.
          </p>
        </section>
      )}
      {supported && !preview && (
        <Form
          id={formId}
          hideActions
          guardDraft={false}
          onBusyChange={setBusy}
          onSave={async () => {
            const result = await api<Preview>(
              "/api/admin/reset/preview",
              "POST",
              {
                mode,
                categories: mode === "fresh" ? [] : requested,
                retainedAdminId: options.data!.retainedAdmin.id,
              },
            );
            if (
              result.execution !== "offline-only" ||
              result.retainedAdmin.id !== options.data!.retainedAdmin.id
            )
              throw new Error(
                "The administrator or reset workflow changed. Reload reset options and review again.",
              );
            setPreview(result);
          }}
        >
          <Select
            label="Reset mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
            <option value="selective">Selective reset</option>
            <option value="fresh">Fresh start · keep this administrator</option>
          </Select>
          <h3>Database categories</h3>
          <p>
            Required dependent categories stay selected with their reasons.
            Clear the category that requires them to remove that dependency.
          </p>
          <div
            className="stack"
            role="group"
            aria-label="Database reset categories"
          >
            {categories.map((category) => {
              const required = dependencies.filter(
                (dependency) => dependency.category === category.id,
              );
              return (
                <section className="settings-section" key={category.id}>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={effective.has(category.id)}
                      disabled={
                        mode === "fresh" ||
                        (effective.has(category.id) &&
                          !requested.includes(category.id))
                      }
                      onChange={(event) =>
                        setRequested((old) =>
                          event.target.checked
                            ? [...old, category.id]
                            : old.filter((id) => id !== category.id),
                        )
                      }
                    />
                    {category.label}
                  </label>
                  <p>{category.description}</p>
                  {mode === "fresh" ? (
                    <p>Required for a fresh start.</p>
                  ) : (
                    required.map((dependency) => (
                      <p key={dependency.requiredBy}>
                        Required by{" "}
                        {labels.get(dependency.requiredBy) ??
                          dependency.requiredBy}
                        : {dependency.reason}
                      </p>
                    ))
                  )}
                </section>
              );
            })}
          </div>
        </Form>
      )}
      {preview && (
        <section aria-label="Exact reset preview">
          <h3 ref={heading} tabIndex={-1}>
            Review{" "}
            {preview.mode === "fresh" ? "fresh start" : "selective reset"}
          </h3>
          <p>
            <strong>
              {preview.totalRecords.toLocaleString()} database records affected.
            </strong>{" "}
            The counts below describe this live snapshot; the offline tool
            reviews the stopped database again.
          </p>
          <h4>Included categories</h4>
          <ul>
            {preview.effectiveCategories.map((category) => (
              <li key={category}>{labels.get(category) ?? category}</li>
            ))}
          </ul>
          {preview.dependencies.length > 0 && (
            <details>
              <summary>Required category dependencies</summary>
              <ul>
                {preview.dependencies.map((dependency) => (
                  <li key={`${dependency.requiredBy}:${dependency.category}`}>
                    {labels.get(dependency.category) ?? dependency.category} is
                    required by{" "}
                    {labels.get(dependency.requiredBy) ?? dependency.requiredBy}
                    : {dependency.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div
            className="table-scroll reset-counts"
            role="region"
            aria-label="Exact database record counts"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>Database records</th>
                  <th>Action</th>
                  <th>Count</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {preview.tableCounts.map((row) => (
                  <tr key={`${row.table}:${row.action}`}>
                    <td>
                      <code>{row.table}</code>
                    </td>
                    <td>
                      {
                        {
                          delete: "Remove",
                          update: "Update",
                          preserve: "Keep",
                        }[row.action]
                      }
                    </td>
                    <td>{row.count.toLocaleString()}</td>
                    <td>{row.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>Preview revision</summary>
            <code>{preview.revision}</code>
          </details>
          <section
            className="settings-section"
            aria-label="Offline reset steps"
          >
            <h3>Continue with the server stopped</h3>
            <p>
              Stop myTuner completely before running either command. This
              isolates reset from in-flight scans, playback and requests.
            </p>
            <h4>1. Review the stopped database</h4>
            <div
              className="table-scroll"
              role="region"
              aria-label="Offline preview command"
              tabIndex={0}
            >
              <pre tabIndex={0}>
                <code>{preview.cli.previewCommand}</code>
              </pre>
            </div>
            <h4>2. Apply the reviewed offline plan</h4>
            <p>
              If the offline preview reports a new revision or different counts,
              use its updated apply command and review those changes first.
            </p>
            <div
              className="table-scroll"
              role="region"
              aria-label="Offline apply command"
              tabIndex={0}
            >
              <pre tabIndex={0}>
                <code>{preview.cli.applyCommand}</code>
              </pre>
            </div>
            <p>
              The tool asks for{" "}
              <strong>{preview.retainedAdmin.username}’s password</strong> and
              requires this exact final confirmation:
            </p>
            <p>
              <code>{preview.confirmationText}</code>
            </p>
            <p>
              It creates and verifies a recoverable backup before changing
              records and reports the verified backup location and reset result.
              Keep that backup for recovery.
            </p>
            {preview.instructions.length > 0 && (
              <ol>
                {preview.instructions.map((instruction, index) => (
                  <li key={index}>{instruction}</li>
                ))}
              </ol>
            )}
            <h4>3. Restart and sign in</h4>
            <p>
              After the tool reports completion, restart myTuner and sign in as{" "}
              <strong>{preview.retainedAdmin.username}</strong> using its
              existing password. All sessions, profile unlocks and TV pairings
              end, including for a selective reset; TVs must be paired again.
            </p>
            {preview.filesystemCleanupDisabled && (
              <p className="notice">
                Generated outputs and cache files stay on disk. Automatic
                filesystem cleanup remains disabled after reset to protect
                retained and unknown files. Follow the recovery guide before
                enabling cleanup again.
              </p>
            )}
            <a href={recoveryLink}>Offline reset and recovery guide</a>
          </section>
        </section>
      )}
      {!preview && options.data?.instructions.length ? (
        <details>
          <summary>Offline execution requirements</summary>
          <ul>
            {options.data.instructions.map((instruction, index) => (
              <li key={index}>{instruction}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </Modal>
  );
}
