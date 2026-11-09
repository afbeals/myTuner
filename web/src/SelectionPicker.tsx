import { useEffect, useState } from "react";
import type { Selection, Source } from "./types";
import { Field, Select, Modal, Load, useRemote } from "./ui";
export type ProgrammingOption = {
  title: string;
  sourceId: string | null;
  kind: string;
  selection: Selection;
  available?: number;
  unavailable?: number;
};
export type ProgrammingOptions = {
  items: ProgrammingOption[];
  sources: Source[];
  total: number;
  offset: number;
  limit: number;
};
export function selectionSummary(s: Selection) {
  if (s.type === "show")
    return s.season === undefined ? "Whole show" : `Season ${s.season}`;
  if (s.type === "folder") return s.directory || "All files in source";
  if (s.type === "media")
    return `${s.ids.length} selected video${s.ids.length === 1 ? "" : "s"}`;
  return s.type === "collection" ? "Saved collection" : "Movie collection";
}
export function SelectionPicker({
  profileId,
  current,
  onChoose,
  onClose,
}: {
  profileId: string;
  current?: Selection;
  onChoose: (option: ProgrammingOption) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [source, setSource] = useState(""),
    [kind, setKind] = useState(""),
    [offset, setOffset] = useState(0),
    [show, setShow] = useState<{
      key: string;
      sourceId: string;
      title: string;
    } | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setOffset(0);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);
  const parameters = new URLSearchParams({
    search: query,
    offset: String(offset),
    limit: "50",
    ...(source ? { sourceId: source } : {}),
    ...(kind && !show ? { kind } : {}),
    ...(show ? { showKey: show.key, sourceId: show.sourceId } : {}),
  });
  const result = useRemote<ProgrammingOptions>(
    `/api/profiles/${profileId}/library/options?${parameters}`,
  );
  return (
    <Modal title="Choose programming content" onClose={onClose}>
      <p>
        Choose a whole show, season, movie, collection or folder. Searching
        preserves the saved draft selection.
      </p>
      {current && (
        <p className="notice">
          Current draft: {selectionSummary(current)}. Select a result to replace
          it.
        </p>
      )}
      <Field
        label="Find programming content"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setShow(null);
        }}
        placeholder="Search titles or filenames"
      />
      <div className="two-col">
        <Select
          label="Programming source"
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setShow(null);
            setOffset(0);
          }}
        >
          <option value="">All permitted sources</option>
          {result.data?.sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select
          label="Programming type"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value);
            setShow(null);
            setOffset(0);
          }}
        >
          <option value="">All types</option>
          <option value="show">Shows</option>
          <option value="movie">Movies</option>
          <option value="folder">Folders</option>
          <option value="collection">Saved collections</option>
          <option value="movieCollection">Movie collections</option>
        </Select>
      </div>
      {show && (
        <div className="section-head">
          <h3>{show.title} · whole show and seasons</h3>
          <button
            className="secondary"
            onClick={() => {
              setShow(null);
              setOffset(0);
            }}
          >
            Back to results
          </button>
        </div>
      )}
      <Load {...result} retry={result.reload} />
      <div className="stack">
        {result.data?.items.map((o) => (
          <section
            className="panel section-head"
            key={JSON.stringify(o.selection)}
          >
            <div>
              <h3>{o.title}</h3>
              <p>
                {result.data?.sources.find((s) => s.id === o.sourceId)?.name ??
                  "Saved collections"}{" "}
                · {o.kind}
                {o.available !== undefined ? ` · ${o.available} available` : ""}
                {o.unavailable ? ` · ${o.unavailable} unavailable` : ""}
              </p>
            </div>
            <div className="actions">
              <button
                onClick={() => onChoose(o)}
                aria-label={`Select ${o.title}`}
              >
                Select
              </button>
              {o.kind === "show" && !show && o.selection.type === "show" && (
                <button
                  className="secondary"
                  onClick={() => {
                    if (o.selection.type === "show") {
                      setShow({
                        key: o.selection.key,
                        sourceId: o.selection.sourceId,
                        title: o.title,
                      });
                      setOffset(0);
                    }
                  }}
                >
                  View seasons
                </button>
              )}
            </div>
          </section>
        ))}
      </div>
      {result.data?.total === 0 && (
        <p>No matching content. Your draft selection is unchanged.</p>
      )}
      <div className="pagination">
        <button
          className="secondary"
          disabled={offset === 0 || result.loading}
          onClick={() => setOffset((v) => Math.max(0, v - 50))}
        >
          Previous results
        </button>
        <p>
          {result.data
            ? `${offset + (result.data.total ? 1 : 0)}–${Math.min(offset + 50, result.data.total)} of ${result.data.total} permitted matches`
            : "Loading results"}
        </p>
        <button
          className="secondary"
          disabled={
            !result.data || offset + 50 >= result.data.total || result.loading
          }
          onClick={() => setOffset((v) => v + 50)}
        >
          Next results
        </button>
      </div>
    </Modal>
  );
}
