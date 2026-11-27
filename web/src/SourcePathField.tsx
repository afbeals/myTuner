import { useEffect, useId, useRef, useState } from "react";
import { api } from "./api";
import {
  Field,
  Select,
  Load,
  useMarkFormDirty,
  useRemote,
  ErrorBox,
} from "./ui";
import { DirectoryTree, type DirectoryPage } from "./DirectoryTree";
import { Info } from "./Info";
interface DirectoryCheck {
  status: string;
  exists: boolean | null;
  readableDirectory: boolean | null;
  canonicalPath: string | null;
  samples: string[];
  extensions: Record<string, number>;
  examinedEntries: number;
  examinedDirectories: number;
  complete: boolean;
  reason: string | null;
  message: string;
  maxDepth: number;
  limit: number;
}
interface Suggestions {
  supported: boolean;
  error: string | null;
  items: { path: string; access: string; type: string; origin: string }[];
}
export function SourcePathField({
  label,
  name,
  defaultValue = "",
  value,
  onChange,
  sourceId,
  purpose,
  hint,
  placeholder,
  required = false,
}: {
  label: string;
  name?: string;
  defaultValue?: string;
  value?: string;
  onChange?: (value: string) => void;
  sourceId?: string;
  purpose: "source" | "metadata" | "subtitles";
  hint?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const id = useId(),
    markDirty = useMarkFormDirty(),
    [draft, setDraft] = useState(defaultValue),
    [open, setOpen] = useState(false),
    [browse, setBrowse] = useState<string | null>(null),
    [scope, setScope] = useState("configured"),
    [checking, setChecking] = useState(false),
    [checked, setChecked] = useState<DirectoryCheck | null>(null),
    [error, setError] = useState<unknown>(null),
    [search, setSearch] = useState("");
  const current = value ?? draft,
    serial = useRef(0),
    controller = useRef<AbortController | null>(null);
  const identity = JSON.stringify([current, purpose, sourceId, scope]),
    latest = useRef(identity);
  latest.current = identity;
  const reset = () => {
    serial.current++;
    controller.current?.abort();
    controller.current = null;
    setChecking(false);
    setChecked(null);
    setError(null);
  };
  useEffect(() => {
    reset();
    return () => {
      serial.current++;
      controller.current?.abort();
    };
  }, [identity]);
  useEffect(() => {
    const form = document.getElementById(id)?.closest("form"),
      changed = (event: Event) => {
        if (
          event.target instanceof HTMLInputElement &&
          event.target.name === "recursive"
        )
          reset();
      };
    form?.addEventListener("change", changed);
    return () => form?.removeEventListener("change", changed);
  }, [id]);
  const recursiveScope = () =>
    scope === "bounded" ||
    (scope === "configured" &&
      (purpose !== "source" ||
        (document
          .getElementById(id)
          ?.closest("form")
          ?.querySelector<HTMLInputElement>('input[name="recursive"]')
          ?.checked ??
          true)));
  const check = async () => {
    reset();
    const ticket = serial.current,
      abort = new AbortController(),
      recursive = recursiveScope();
    controller.current = abort;
    setChecking(true);
    try {
      const result = await api<DirectoryCheck>(
        "/api/admin/setup/check-directory",
        "POST",
        {
          path: current,
          purpose,
          ...(sourceId ? { sourceId } : {}),
          recursive,
        },
        abort.signal,
      );
      if (
        !abort.signal.aborted &&
        ticket === serial.current &&
        latest.current === identity &&
        recursiveScope() === recursive
      )
        setChecked(result);
    } catch (error) {
      if (!abort.signal.aborted && ticket === serial.current) setError(error);
    } finally {
      if (ticket === serial.current) {
        setChecking(false);
        controller.current = null;
      }
    }
  };
  const params = new URLSearchParams({
      purpose,
      ...(sourceId ? { sourceId } : {}),
    }),
    choices = useRemote<Suggestions>(
      open ? `/api/admin/setup/path-suggestions?${params}` : null,
    );
  const change = (next: string) => {
    reset();
    setDraft(next);
    onChange?.(next);
  };
  const choose = (next: string) => {
    if (next !== current) markDirty();
    change(next);
    setOpen(false);
    setBrowse(null);
    document.getElementById(id)?.focus();
  };
  return (
    <div className="directory-field">
      <Field
        id={id}
        label={label}
        {...(name ? { name } : {})}
        value={current}
        onChange={(event) => change(event.target.value)}
        required={required}
        {...(placeholder ? { placeholder } : {})}
        {...(hint ? { hint } : {})}
      />
      <div className="actions">
        <button
          type="button"
          className="secondary"
          aria-expanded={open}
          aria-controls={`${id}-choices`}
          onClick={() => setOpen((old) => !old)}
        >
          {open
            ? "Hide directory choices"
            : `Choose ${purpose === "source" ? "media" : purpose} directory`}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={
            checking || (!current && (purpose === "source" || !sourceId))
          }
          onClick={() => void check()}
        >
          {checking ? "Checking…" : "Check directory"}
        </button>
        {checking && (
          <button type="button" className="secondary" onClick={reset}>
            Cancel check
          </button>
        )}
        <Info title="Directory selection">
          Choose a directory mounted into MyTuner. The application sees
          container paths such as /tv. Host paths and other containers’ mappings
          cannot be read here. Opening a folder lists only its direct children;
          Check directory samples file names without inspecting videos.
        </Info>
      </div>
      {open && (
        <section
          id={`${id}-choices`}
          className="directory-choices"
          aria-label={`${label} choices`}
          onChange={(event) => event.stopPropagation()}
        >
          <Load {...choices} retry={choices.reload} />
          {choices.data?.error && <p role="status">{choices.data.error}</p>}
          {choices.data && !choices.data.supported && (
            <p>
              Automatic mount choices are available in the Linux container. You
              can enter a path above and check it.
            </p>
          )}
          <Field
            label={`Filter ${purpose} mounts`}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.preventDefault();
            }}
          />
          <div className="directory-options">
            {choices.data?.items
              .filter((item) =>
                item.path.toLowerCase().includes(search.toLowerCase()),
              )
              .map((item) => (
                <div className="compact-row" key={item.path}>
                  <span>
                    <code>{item.path}</code>
                    <small>
                      {item.access === "read-only"
                        ? "Read-only mount"
                        : item.access === "read-write"
                          ? "Writable mount · map original media as read-only"
                          : "Access not checked"}
                    </small>
                  </span>
                  <div className="actions">
                    <button
                      type="button"
                      className="secondary"
                      aria-label={`Use directory ${item.path}`}
                      onClick={() => choose(item.path)}
                    >
                      Use
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      aria-label={`Browse directory ${item.path}`}
                      onClick={() => setBrowse(item.path)}
                    >
                      Browse
                    </button>
                  </div>
                </div>
              ))}
          </div>
          {choices.data?.supported &&
            !choices.loading &&
            !choices.error &&
            !choices.data.error &&
            !choices.data.items.some((item) =>
              item.path.toLowerCase().includes(search.toLowerCase()),
            ) && (
              <p>
                {search
                  ? "No mount paths match this filter. Clear the filter or enter a path above."
                  : "No unused media mounts found. Your current or manually entered path is kept."}
              </p>
            )}
          {current && (
            <button
              type="button"
              className="secondary"
              onClick={() => setBrowse(current)}
            >
              Browse current directory
            </button>
          )}
          {purpose !== "source" && (
            <button
              type="button"
              className="secondary"
              onClick={() => choose("")}
            >
              Use files beside videos
            </button>
          )}
        </section>
      )}
      <details
        className="directory-check-options"
        onChange={(event) => event.stopPropagation()}
      >
        <summary>Directory check options</summary>
        <Select
          label="Directory check scope"
          value={scope}
          onChange={(event) => setScope(event.target.value)}
        >
          <option value="configured">
            {purpose === "source"
              ? "Use source subfolder setting"
              : "Standard sample (two levels)"}
          </option>
          <option value="shallow">This directory only</option>
          <option value="bounded">Include subfolders (two levels)</option>
        </Select>
        <p>
          Stops after five supported file names or 256 entries. No video
          inspection or full scan is started.
        </p>
      </details>
      <ErrorBox error={error} />
      {checking && <p role="status">Checking directory…</p>}
      {checked && (
        <section
          className="notice directory-check"
          aria-label={`${label} directory check`}
          aria-live="polite"
        >
          <p>{checked.message}</p>
          {checked.canonicalPath && <code>{checked.canonicalPath}</code>}
          {checked.readableDirectory === true && (
            <p>
              Directory exists and is readable.{" "}
              {checked.complete
                ? "Sample check complete."
                : "Partial sample; more files may exist."}
            </p>
          )}
          {checked.samples.length > 0 && (
            <details>
              <summary>
                {checked.samples.length} supported file names found
              </summary>
              <ul>
                {checked.samples.map((sample) => (
                  <li key={sample}>
                    <code>{sample}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}
      {browse !== null && (
        <DirectoryTree
          identity={`${sourceId ?? "new"}:${purpose}:${browse}`}
          title="Choose a directory"
          rootLabel={browse}
          rootChoiceLabel="This directory"
          emptyLabel="No subfolders in this page"
          initial={[""]}
          load={(parent, offset, signal) =>
            api<DirectoryPage>(
              `/api/admin/setup/directories?${new URLSearchParams({ root: browse, parent, offset: String(offset), purpose, ...(sourceId ? { sourceId } : {}) })}`,
              "GET",
              undefined,
              signal,
            )
          }
          onApply={(paths) =>
            choose(
              [browse.replace(/\/+$/, ""), paths[0]]
                .filter(Boolean)
                .join("/") || "/",
            )
          }
          onClose={() => setBrowse(null)}
        />
      )}
    </div>
  );
}
