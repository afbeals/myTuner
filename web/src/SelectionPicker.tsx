import { SourceInspectionNotice } from "./SourceInspectionNotice";
import { CatalogBrowser } from "./CatalogBrowser";
import { useState } from "react";
import type { Selection, Source } from "./types";
import { Field, Select, Modal, ModalCancel, Load, useRemote } from "./ui";
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
  identity = "session",
  version = 0,
}: {
  profileId: string;
  current?: Selection;
  onChoose: (option: ProgrammingOption) => void;
  onClose: () => void;
  identity?: string;
  version?: number;
}) {
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [source, setSource] = useState(""),
    [kind, setKind] = useState(""),
    [offset, setOffset] = useState(0),
    [browseMode, setBrowseMode] = useState("titles"),
    [chosen, setChosen] = useState<ProgrammingOption | null>(null),
    [show, setShow] = useState<{
      key: string;
      sourceId: string;
      title: string;
    } | null>(null);
  const parameters = new URLSearchParams({
    search: query,
    offset: String(offset),
    limit: "50",
    titleOnly: "true",
    ...(source ? { sourceId: source } : {}),
    ...(kind && !show ? { kind } : {}),
    ...(show ? { showKey: show.key, sourceId: show.sourceId } : {}),
  });
  const result = useRemote<ProgrammingOptions>(
    `/api/profiles/${profileId}/library/options?${parameters}`,
  );
  return (
    <Modal
      title="Choose programming content"
      onClose={onClose}
      footer={
        <div className="actions">
          <p role="status">
            {chosen
              ? `Current choice: ${chosen.title}. Choosing another result replaces this choice.`
              : "Choose one show, collection, folder or video."}
          </p>
          <button
            disabled={!chosen || chosen.available === 0}
            onClick={() => chosen && onChoose(chosen)}
          >
            Use selection
          </button>
          <ModalCancel />
        </div>
      }
    >
      <p>
        Choose a whole show, season, movie, collection or folder. Searching
        preserves the saved draft selection.
      </p>
      <SourceInspectionNotice
        profileId={profileId}
        sourceIds={(result.data?.sources ?? []).map((source) => source.id)}
        sources={result.data?.sources ?? []}
        identity={identity}
        version={version}
      />
      {current && (
        <p className="notice">
          Current draft: {selectionSummary(current)}. Select a result to replace
          it.
        </p>
      )}
      <div className="tabs" aria-label="Choose content by">
        <button
          className={browseMode === "titles" ? "selected" : "secondary"}
          onClick={() => setBrowseMode("titles")}
        >
          Shows and collections
        </button>
        <button
          className={browseMode === "paths" ? "selected" : "secondary"}
          onClick={() => setBrowseMode("paths")}
        >
          Folders and file names
        </button>
      </div>
      {chosen && (
        <p role="status" className="notice">
          Selected: {chosen.title}.{" "}
          {chosen.available === 0
            ? "No videos are available in the last scan. Choose a replacement or rescan the source before using this folder."
            : "Choose Use selection to apply. A different result replaces this choice."}
        </p>
      )}
      {browseMode === "paths" && (
        <CatalogBrowser
          profileId={profileId}
          identity={identity}
          version={version}
          selectionMode="single"
          showInspectionNotice={false}
          selectedIds={
            chosen?.selection.type === "media" ? chosen.selection.ids : []
          }
          sources={result.data?.sources ?? []}
          includeCommercials
          onFile={(node) =>
            setChosen({
              title: `${result.data?.sources.find((source) => source.id === node.sourceId)?.name ?? "Source"} · ${node.path}`,
              sourceId: node.sourceId,
              kind: "movie",
              selection: { type: "media", ids: [node.id] },
            })
          }
          onFolder={(node, recursive) =>
            setChosen({
              title: node.label,
              sourceId: node.sourceId,
              kind: "folder",
              available: node.count,
              selection: {
                type: "folder",
                sourceId: node.sourceId,
                directory: node.path,
                recursive,
              },
            })
          }
        />
      )}
      <div hidden={browseMode !== "titles"}>
        <form
          className="actions"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(search);
            setOffset(0);
            setShow(null);
          }}
        >
          <Field
            label="Find programming content"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setShow(null);
            }}
            placeholder="Search titles"
          />
          <button type="submit">Search</button>
        </form>
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
                  {result.data?.sources.find((s) => s.id === o.sourceId)
                    ?.name ?? "Saved collections"}{" "}
                  · {o.kind}
                  {o.available !== undefined
                    ? ` · ${o.available} available in last scan`
                    : ""}
                  {o.unavailable ? ` · ${o.unavailable} unavailable` : ""}
                </p>
              </div>
              <div className="actions">
                {o.available === 0 && (
                  <p className="notice">
                    No videos available in the last scan. This retained
                    selection may be empty or its folder may have moved. Choose
                    a replacement or review the source and scan again.
                  </p>
                )}
                <button
                  disabled={o.available === 0}
                  aria-pressed={
                    JSON.stringify(chosen?.selection) ===
                    JSON.stringify(o.selection)
                  }
                  onClick={() => setChosen(o)}
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
      </div>
    </Modal>
  );
}
