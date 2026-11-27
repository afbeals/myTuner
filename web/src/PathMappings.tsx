import { useEffect, useId, useRef, useState } from "react";
import { api } from "./api";
import { Field } from "./ui";
export type PathMapping = { from: string; to: string };
/** Paired namespaces with explicit, bounded local checks. Never checks provider disks. */
export function PathMappings({
  rows,
  sourceId,
  defaultPath,
  onChange,
}: {
  rows: PathMapping[];
  sourceId: string;
  defaultPath: string;
  onChange: (rows: PathMapping[]) => void;
}) {
  return (
    <div className="mapping-list">
      {rows.map((row, index) => (
        <MappingRow
          key={index}
          row={row}
          index={index}
          sourceId={sourceId}
          removable={rows.length > 1}
          onChange={(next) =>
            onChange(rows.map((old, at) => (at === index ? next : old)))
          }
          onRemove={() => onChange(rows.filter((_, at) => at !== index))}
        />
      ))}
      <button
        type="button"
        className="secondary"
        disabled={rows.length >= 100}
        onClick={() => onChange([...rows, { from: "", to: defaultPath }])}
      >
        Add mapping
      </button>
    </div>
  );
}
function MappingRow({
  row,
  index,
  sourceId,
  removable,
  onChange,
  onRemove,
}: {
  row: PathMapping;
  index: number;
  sourceId: string;
  removable: boolean;
  onChange: (row: PathMapping) => void;
  onRemove: () => void;
}) {
  const id = useId(),
    controller = useRef<AbortController | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    controller.current?.abort();
    setBusy(false);
    setMessage("");
    setError("");
    return () => controller.current?.abort();
  }, [row.from, row.to, sourceId]);
  async function validate() {
    controller.current?.abort();
    if (!row.from.trim() || !row.to.trim()) {
      setError("Enter both paths for this mapping.");
      return;
    }
    if (!/^(?:\/|[a-z]:[\\/])/i.test(row.to)) {
      setError("Use the full directory path inside MyTuner.");
      return;
    }
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{
        exists: boolean | null;
        readableDirectory: boolean | null;
        message: string;
      }>(
        "/api/admin/setup/check-directory",
        "POST",
        { path: row.to, purpose: "source", sourceId, recursive: false },
        request.signal,
      );
      if (request.signal.aborted) return;
      if (result.exists && result.readableDirectory)
        setMessage(
          "MyTuner can read this directory. The application path is checked against imported metadata separately.",
        );
      else setError(result.message);
    } catch (failure) {
      if (!request.signal.aborted)
        setError(
          failure instanceof Error
            ? failure.message
            : "Directory check failed. Try again.",
        );
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }
  const described = message || error ? `${id}-result` : undefined;
  return (
    <section className="mapping-entry" aria-label={`Path mapping ${index + 1}`}>
      <div className="mapping-row">
        <Field
          label={`Application path ${index + 1}`}
          value={row.from}
          required
          aria-describedby={described}
          onChange={(event) => onChange({ ...row, from: event.target.value })}
        />
        <span aria-hidden>→</span>
        <Field
          label={`MyTuner path ${index + 1}`}
          value={row.to}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={described}
          onChange={(event) => onChange({ ...row, to: event.target.value })}
        />
        <div className="actions">
          <button
            type="button"
            className="secondary"
            aria-label={`Check directory for mapping ${index + 1}`}
            disabled={busy}
            onClick={() => void validate()}
          >
            {busy ? "Checking…" : "Check folder"}
          </button>
          <button
            type="button"
            className="secondary"
            aria-label={`Remove mapping ${index + 1}`}
            disabled={!removable}
            onClick={onRemove}
          >
            Remove
          </button>
        </div>
      </div>
      {(message || error) && (
        <p
          id={`${id}-result`}
          role={error ? "alert" : "status"}
          className={error ? "error" : "notice"}
        >
          {error || message}
        </p>
      )}
    </section>
  );
}
