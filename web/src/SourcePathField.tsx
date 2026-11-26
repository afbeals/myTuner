import { useEffect, useId, useRef, useState } from "react";
import { api } from "./api";
import { Field, Select, Load, useMarkFormDirty, useRemote } from "./ui";

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
// Suggestions describe mount targets only. Opening or filtering never browses media.
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
    markDirty = useMarkFormDirty();
  const [draft, setDraft] = useState(defaultValue),
    [open, setOpen] = useState(false),
    [search, setSearch] = useState("");
  const [scope, setScope] = useState("configured"),
    [checking, setChecking] = useState(false),
    [checked, setChecked] = useState<DirectoryCheck | null>(null),
    [checkError, setCheckError] = useState("");
  const pending = useRef<AbortController | null>(null),
    generation = useRef(0);
  const current = value ?? draft;
  const identity = JSON.stringify([current, purpose, sourceId, scope]);
  const latest = useRef(identity);
  latest.current = identity;
  const resetCheck = () => {
    generation.current++;
    pending.current?.abort();
    pending.current = null;
    setChecking(false);
    setChecked(null);
    setCheckError("");
  };
  useEffect(() => {
    resetCheck();
    return () => {
      generation.current++;
      pending.current?.abort();
    };
  }, [identity]);
  useEffect(() => {
    if (purpose !== "source" || scope !== "configured") return;
    const form = document.getElementById(id)?.closest("form");
    const changed = (event: Event) => {
      if (
        event.target instanceof HTMLInputElement &&
        event.target.name === "recursive"
      )
        resetCheck();
    };
    form?.addEventListener("change", changed);
    return () => form?.removeEventListener("change", changed);
  }, [id, purpose, scope]);
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
  const checkDirectory = async () => {
    resetCheck();
    const controller = new AbortController(),
      revision = generation.current,
      recursive = recursiveScope();
    pending.current = controller;
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
        controller.signal,
      );
      if (
        !controller.signal.aborted &&
        revision === generation.current &&
        latest.current === identity &&
        recursiveScope() === recursive
      )
        setChecked(result);
    } catch (error) {
      if (
        !controller.signal.aborted &&
        revision === generation.current &&
        latest.current === identity
      )
        setCheckError(
          error instanceof Error
            ? error.message
            : "Directory check failed. Try again.",
        );
    } finally {
      if (revision === generation.current) {
        setChecking(false);
        pending.current = null;
      }
    }
  };
  const params = new URLSearchParams({
    purpose,
    ...(sourceId ? { sourceId } : {}),
  });
  const choices = useRemote<Suggestions>(
    open ? `/api/admin/setup/path-suggestions?${params}` : null,
  );
  const change = (next: string) => {
    resetCheck();
    setDraft(next);
    onChange?.(next);
  };
  const choose = (next: string) => {
    if (current !== next) markDirty();
    change(next);
    setOpen(false);
    document.getElementById(id)?.focus();
  };
  const filtered =
    choices.data?.items.filter((item) =>
      item.path.toLowerCase().includes(search.toLowerCase()),
    ) ?? [];
  return (
    <div className="directory-field">
      <Field
        id={id}
        label={label}
        {...(name ? { name } : {})}
        value={current}
        onChange={(event) => change(event.target.value)}
        required={required}
        {...(hint ? { hint } : {})}
        {...(placeholder ? { placeholder } : {})}
      />
      <button
        type="button"
        className="secondary"
        aria-expanded={open}
        aria-controls={`${id}-paths`}
        onClick={() => setOpen((old) => !old)}
      >
        {open
          ? "Hide directory choices"
          : `Choose ${purpose === "source" ? "media" : purpose} directory`}
      </button>
      <div className="actions">
        <button
          type="button"
          className="secondary"
          onClick={() => void checkDirectory()}
          disabled={
            checking || (!current && (purpose === "source" || !sourceId))
          }
          aria-describedby={`${id}-check-hint`}
        >
          {checking ? "Checking directory…" : "Check directory"}
        </button>
        {checking && (
          <button type="button" className="secondary" onClick={resetCheck}>
            Cancel directory check
          </button>
        )}
      </div>
      <Select
        label="Directory check scope"
        value={scope}
        onChange={(event) => {
          event.stopPropagation();
          resetCheck();
          setScope(event.target.value);
        }}
      >
        <option value="configured">
          {purpose === "source"
            ? "Use source subfolder setting"
            : "Standard sample (two levels)"}
        </option>
        <option value="shallow">This directory only</option>
        <option value="bounded">Include subfolders (two levels)</option>
      </Select>
      <p id={`${id}-check-hint`}>
        Checks only when requested, stopping after five supported file names or
        256 entries. No video inspection or source scan is started.
        {purpose !== "source" &&
          !current &&
          " Blank checks beside this source’s videos."}
      </p>
      {checking && (
        <p role="status">
          Checking the directory. You can keep editing or cancel.
        </p>
      )}
      {checkError && <p role="alert">{checkError}</p>}
      {checked && (
        <section
          className="notice directory-check"
          aria-label={`${label} directory check`}
          aria-live="polite"
        >
          <p>{checked.message}</p>
          {checked.canonicalPath && (
            <p>
              Container directory: <code>{checked.canonicalPath}</code>
            </p>
          )}
          {checked.readableDirectory === true && (
            <p>Directory exists and is readable.</p>
          )}
          {checked.readableDirectory === true && (
            <p>
              {checked.complete
                ? "Checked area completed."
                : "Partial check; other files may exist."}{" "}
              {checked.examinedEntries} entries in {checked.examinedDirectories}{" "}
              directories.{" "}
              {checked.maxDepth
                ? "Up to two subfolder levels."
                : "This directory only."}
            </p>
          )}
          {checked.samples.length > 0 && (
            <>
              <p>
                File name samples (
                {purpose === "source"
                  ? "supported video extensions; playback not verified"
                  : purpose === "metadata"
                    ? "NFO files"
                    : "caption files"}
                ):
              </p>
              <ul>
                {checked.samples.map((sample) => (
                  <li key={sample}>
                    <code>{sample}</code>
                  </li>
                ))}
              </ul>
              <p>
                {Object.entries(checked.extensions)
                  .map(([extension, count]) => `${extension}: ${count}`)
                  .join(" · ")}{" "}
                in the checked sample.
              </p>
            </>
          )}
        </section>
      )}
      {open && (
        <section
          id={`${id}-paths`}
          className="directory-choices"
          aria-label={`${label} choices`}
        >
          <p>
            Server-visible mount targets. Directory contents are not searched.
            Availability is checked when you save.
          </p>
          <Load {...choices} retry={choices.reload} />
          {choices.data?.error && <p role="status">{choices.data.error}</p>}
          {choices.data && !choices.data.supported && (
            <p>
              Mount suggestions are unavailable on this platform. Enter the
              server-visible directory above.
            </p>
          )}
          {purpose !== "source" && (
            <button
              type="button"
              className="secondary"
              onClick={() => choose("")}
            >
              Beside videos (default)
            </button>
          )}
          {choices.data && (
            <>
              <Field
                label={`Find ${purpose} directory choice`}
                value={search}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.preventDefault();
                }}
                onChange={(event) => {
                  event.stopPropagation();
                  setSearch(event.target.value);
                }}
              />
              <ul className="directory-options">
                {filtered.map((item) => (
                  <li key={item.path}>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => choose(item.path)}
                    >
                      {item.path} · {item.access} · not checked
                    </button>
                  </li>
                ))}
              </ul>
              {!filtered.length && (
                <p>
                  No matching mount suggestions. Your saved or manually entered
                  path is kept.
                </p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
