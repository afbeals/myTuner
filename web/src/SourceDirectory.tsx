import { useEffect, useId, useState } from "react";
import { Field, Load, useRemote, useMarkFormDirty } from "./ui";

export function SourceDirectory(props: {
  sourceId?: string | undefined;
  name: string;
  label: string;
  version?: number;
}) {
  // Remounting clears a selected folder as soon as its source changes.
  return <DirectoryField key={props.sourceId ?? "none"} {...props} />;
}
function DirectoryField({
  sourceId,
  name,
  label,
  version = 0,
}: {
  sourceId?: string | undefined;
  name: string;
  label: string;
  version?: number;
}) {
  const id = useId(),
    markDirty = useMarkFormDirty();
  const [value, setValue] = useState(""),
    [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setOffset(0);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);
  const params = new URLSearchParams({
    search: query,
    offset: String(offset),
    limit: "50",
  });
  const folders = useRemote<{ items: string[]; hasMore: boolean }>(
    open && sourceId ? `/api/sources/${sourceId}/directories?${params}` : null,
    version,
  );
  const choose = (folder: string) => {
    if (folder !== value) markDirty();
    setValue(folder);
    setOpen(false);
    document.getElementById(id)?.focus();
  };
  return (
    <div className="directory-field">
      <Field
        id={id}
        label={label}
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Entire source"
        hint="Choose a scanned subfolder or enter a relative path. Blank selects the entire source."
      />
      <button
        type="button"
        className="secondary"
        disabled={!sourceId}
        aria-expanded={open}
        aria-controls={`${id}-choices`}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide subfolders" : "Browse subfolders"}
      </button>
      {open && (
        <section
          id={`${id}-choices`}
          className="directory-choices"
          aria-label="Scanned subfolders"
        >
          <p>
            From available videos in the last scan. Empty and unscanned folders
            are not listed.
          </p>
          <Field
            label="Find subfolder"
            value={search}
            onKeyDown={(event) => {
              // Searching must never submit the surrounding grant/job form.
              if (event.key === "Enter") event.preventDefault();
            }}
            onChange={(e) => {
              e.stopPropagation();
              setSearch(e.target.value);
            }}
          />
          <button
            type="button"
            className="secondary"
            onClick={() => choose("")}
          >
            Entire source
          </button>
          <Load
            {...folders}
            loading={folders.loading || search !== query}
            retry={folders.reload}
          />
          {folders.data && search === query && !folders.data.items.length && (
            <p role="status">
              No matching scanned subfolders. Scan the source or enter the path
              manually.
            </p>
          )}
          <ul className="directory-options">
            {(search === query ? folders.data?.items : [])?.map((folder) => (
              <li key={folder}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => choose(folder)}
                >
                  {folder}
                </button>
              </li>
            ))}
          </ul>
          {folders.data && (
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={!offset || folders.loading || search !== query}
                onClick={() => setOffset((v) => Math.max(0, v - 50))}
              >
                Previous folders
              </button>
              <button
                type="button"
                className="secondary"
                disabled={
                  !folders.data.hasMore || folders.loading || search !== query
                }
                onClick={() => setOffset((v) => v + 50)}
              >
                More folders
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
