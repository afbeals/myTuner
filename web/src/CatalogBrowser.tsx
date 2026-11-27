import { SourceInspectionNotice } from "./SourceInspectionNotice";
import { useEffect, useRef, useState } from "react";
import type { Source } from "./types";
import { api, ApiError } from "./api";
import { DirectoryTree, catalogDirectoryLoader } from "./DirectoryTree";
import { Field, Select, Load } from "./ui";
export type CatalogNode = {
  id: string;
  sourceId: string;
  path: string;
  label: string;
  kind: "folder" | "file";
  count: number;
};
type Page = {
  items: CatalogNode[];
  total: number;
  hasMore: boolean;
  revision: number;
};
/** Only mounted pages are cached. Identity/permission revisions discard the whole cache. */
export function useCatalogPage<T extends { revision?: number }>(
  path: string,
  identity: string | number,
) {
  const cache = useRef(new Map<string, T>()),
    timestamps = useRef(new Map<string, number>()),
    scope = useRef(identity),
    request = useRef(0),
    [tick, setTick] = useState(0),
    [state, setState] = useState<{
      path: string;
      identity: string | number;
      data: T | null;
      loading: boolean;
      error: unknown;
      updatedAt: number | null;
    }>({
      path: "",
      identity,
      data: null,
      loading: true,
      error: null,
      updatedAt: null,
    });
  if (scope.current !== identity) {
    scope.current = identity;
    cache.current.clear();
    timestamps.current.clear();
  }
  const currentScope = identity;
  useEffect(() => {
    const id = ++request.current,
      controller = new AbortController(),
      cached = cache.current.get(path);
    if (cached) {
      setState({
        path,
        identity: currentScope,
        data: cached,
        loading: false,
        error: null,
        updatedAt: timestamps.current.get(path) ?? null,
      });
      return () => controller.abort();
    }
    setState((previous) => ({
      path,
      identity: currentScope,
      data:
        previous.path === path && previous.identity === currentScope
          ? previous.data
          : null,
      updatedAt:
        previous.path === path && previous.identity === currentScope
          ? previous.updatedAt
          : null,
      loading: true,
      error: null,
    }));
    void api<T>(path, "GET", undefined, controller.signal)
      .then((data) => {
        if (
          controller.signal.aborted ||
          id !== request.current ||
          scope.current !== currentScope
        )
          return;
        const revision = [...cache.current.values()][0]?.revision;
        if (
          revision !== undefined &&
          data.revision !== undefined &&
          revision !== data.revision
        ) {
          cache.current.clear();
          timestamps.current.clear();
        }
        if (cache.current.size >= 24) {
          const oldest = cache.current.keys().next().value!;
          cache.current.delete(oldest);
          timestamps.current.delete(oldest);
        }
        cache.current.set(path, data);
        const updatedAt = Date.now();
        timestamps.current.set(path, updatedAt);
        setState({
          path,
          identity: currentScope,
          data,
          updatedAt,
          loading: false,
          error: null,
        });
      })
      .catch((error) => {
        if (
          controller.signal.aborted ||
          id !== request.current ||
          scope.current !== currentScope
        )
          return;
        const denied =
          error instanceof ApiError && [401, 403, 404].includes(error.status);
        if (denied) {
          cache.current.clear();
          timestamps.current.clear();
        }
        setState((previous) => ({
          path,
          identity: currentScope,
          data:
            !denied &&
            previous.path === path &&
            previous.identity === currentScope
              ? previous.data
              : null,
          updatedAt:
            !denied &&
            previous.path === path &&
            previous.identity === currentScope
              ? previous.updatedAt
              : null,
          loading: false,
          error,
        }));
      });
    return () => controller.abort();
  }, [path, identity, tick]);
  const current =
    state.path === path &&
    state.identity === identity &&
    scope.current === currentScope;
  return {
    data: current ? state.data : null,
    error: current ? state.error : null,
    loading: !current || state.loading,
    updatedAt: current ? state.updatedAt : null,
    reload: () => {
      cache.current.clear();
      timestamps.current.clear();
      setTick((n) => n + 1);
    },
  };
}
export function CatalogBrowser({
  profileId,
  sources,
  version = 0,
  onFile,
  onFolder,
  selectedIds = [],
  includeCommercials = false,
  identity = "session",
  allowFileSelection = true,
  selectionMode = "multiple",
  showInspectionNotice = true,
}: {
  profileId: string;
  sources: Source[];
  version?: number;
  onFile: (node: CatalogNode) => void;
  onFolder: (node: CatalogNode, recursive: boolean) => void;
  selectedIds?: string[];
  includeCommercials?: boolean;
  identity?: string;
  allowFileSelection?: boolean;
  selectionMode?: "multiple" | "single";
  showInspectionNotice?: boolean;
}) {
  const [search, setSearch] = useState(""),
    [source, setSource] = useState(""),
    [mode, setMode] = useState<"folders" | "files">("folders"),
    [recursive, setRecursive] = useState(false),
    [parent, setParent] = useState(""),
    [tree, setTree] = useState(false),
    [offset, setOffset] = useState(0),
    [committed, setCommitted] = useState({
      search: "",
      source: "",
      mode: "folders" as "folders" | "files",
      recursive: false,
      parent: "",
    });
  const params = new URLSearchParams({
      sourceId: committed.source,
      parent: committed.parent,
      search: committed.search,
      mode: committed.mode,
      recursive: String(committed.recursive),
      offset: String(offset),
      limit: "50",
      includeCommercials: String(includeCommercials),
    }),
    result = useCatalogPage<Page>(
      `/api/profiles/${profileId}/catalog/tree?${params}`,
      `${identity}:${profileId}:${version}`,
    );
  const commit = (next: typeof committed) => {
    setCommitted(next);
    setOffset(0);
  };
  return (
    <section aria-label="Folder and filename search">
      <form
        className="catalog-search"
        onSubmit={(event) => {
          event.preventDefault();
          commit({ search, source, mode, recursive, parent });
        }}
      >
        <div className="filters">
          <Field
            label="Find folders or files"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={
              mode === "folders" ? "Folder name" : "Exact filename words"
            }
          />
          <Select
            label="Search in source"
            value={source}
            onChange={(event) => {
              setSource(event.target.value);
              setParent("");
            }}
          >
            <option value="">All permitted sources</option>
            {sources
              .filter(
                (item) => includeCommercials || item.kind !== "commercials",
              )
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
          </Select>
          <Select
            label="Match"
            value={mode}
            onChange={(event) => setMode(event.target.value as typeof mode)}
          >
            <option value="folders">Folder names only</option>
            <option value="files">File names only</option>
          </Select>
        </div>
        <div className="actions">
          <label className="check">
            <input
              type="checkbox"
              checked={recursive}
              onChange={(event) => setRecursive(event.target.checked)}
            />
            Search subfolders
          </label>
          <button
            type="button"
            className="secondary"
            disabled={!source}
            onClick={() => setTree(true)}
          >
            Choose search folder
          </button>
          <button type="submit">Search</button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setSearch("");
              setSource("");
              setParent("");
              setRecursive(false);
              commit({
                search: "",
                source: "",
                parent: "",
                mode,
                recursive: false,
              });
            }}
          >
            Clear search
          </button>
        </div>
        {parent && (
          <p>
            Search folder: <code>{parent}</code>
          </p>
        )}
      </form>
      <p>
        Results use the last completed media scan.{" "}
        {committed.recursive
          ? "All indexed subfolders are included."
          : "Only the current folder level is shown."}{" "}
        File search matches file names; folder search matches folder names.
      </p>
      {showInspectionNotice && (
        <SourceInspectionNotice
          profileId={profileId}
          sourceIds={[
            ...new Set(result.data?.items.map((node) => node.sourceId) ?? []),
          ]}
          version={version}
          identity={identity}
          sources={sources}
        />
      )}
      <Load {...result} retry={result.reload} />
      <div className="bounded-checklist catalog-results">
        {result.data?.items.map((node) => (
          <article className="compact-row catalog-result" key={node.id}>
            <div className="catalog-result-info">
              <strong>
                {node.kind === "folder"
                  ? node.label
                  : node.path.split("/").at(-1)}
              </strong>
              <small>
                {sources.find((source) => source.id === node.sourceId)?.name ??
                  "Source"}{" "}
                · <code>{node.path}</code>
                {node.kind === "folder"
                  ? ` · ${node.count} available ${node.count === 1 ? "video" : "videos"}${node.count === 0 ? " · No available indexed videos; retained paths may have moved" : ""}`
                  : node.label === node.path.split("/").at(-1)
                    ? ""
                    : ` · ${node.label}`}
              </small>
            </div>
            <div className="actions catalog-result-actions">
              {node.kind === "folder" ? (
                <>
                  <button
                    className="secondary"
                    type="button"
                    aria-label={`Open folder ${sources.find((source) => source.id === node.sourceId)?.name ?? "Source"} · ${node.path}`}
                    onClick={() => {
                      setParent(node.path);
                      setSource(node.sourceId);
                      commit({
                        ...committed,
                        parent: node.path,
                        source: node.sourceId,
                        search: "",
                      });
                      setSearch("");
                    }}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    aria-label={`Choose folder ${sources.find((source) => source.id === node.sourceId)?.name ?? "Source"} · ${node.path}`}
                    onClick={() => onFolder(node, true)}
                  >
                    Choose folder
                  </button>
                </>
              ) : allowFileSelection ? (
                <button
                  type="button"
                  disabled={
                    selectionMode === "multiple" &&
                    selectedIds.includes(node.id)
                  }
                  aria-pressed={
                    selectionMode === "single"
                      ? selectedIds.includes(node.id)
                      : undefined
                  }
                  aria-label={
                    selectionMode === "single"
                      ? `Select video ${node.label} from ${sources.find((source) => source.id === node.sourceId)?.name ?? "Source"} · ${node.path}`
                      : `Add file ${sources.find((source) => source.id === node.sourceId)?.name ?? "Source"} · ${node.path}`
                  }
                  onClick={() => onFile(node)}
                >
                  {selectionMode === "single"
                    ? selectedIds.includes(node.id)
                      ? "Selected video"
                      : "Select this video"
                    : selectedIds.includes(node.id)
                      ? "Added"
                      : "Add to selection"}
                </button>
              ) : null}
            </div>
          </article>
        ))}
        {result.data?.items.length === 0 && (
          <p>
            No matching {committed.mode === "files" ? "files" : "folders"}. Try
            file search for videos stored directly in this directory, or include
            subfolders.
          </p>
        )}
      </div>
      <div className="pagination">
        <button
          type="button"
          className="secondary"
          disabled={offset === 0 || result.loading}
          onClick={() => setOffset((n) => Math.max(0, n - 50))}
        >
          Previous matches
        </button>
        <span>
          {result.data
            ? `${Math.min(offset + 1, result.data.total)}–${Math.min(offset + 50, result.data.total)} of ${result.data.total}`
            : "Loading matches"}
        </span>
        <button
          type="button"
          className="secondary"
          disabled={!result.data?.hasMore || result.loading}
          onClick={() => setOffset((n) => n + 50)}
        >
          Next matches
        </button>
      </div>
      {committed.parent && (
        <div className="actions">
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setParent("");
              commit({ ...committed, parent: "" });
            }}
          >
            Back to source folders
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              onFolder(
                {
                  id: `${committed.source}:${committed.parent}`,
                  sourceId: committed.source,
                  path: committed.parent,
                  label: committed.parent.split("/").at(-1) ?? committed.parent,
                  kind: "folder",
                  count: 0,
                },
                true,
              )
            }
          >
            Choose this folder
          </button>
        </div>
      )}
      {tree && (
        <DirectoryTree
          identity={`${profileId}:${source}:${version}`}
          title="Choose search folder"
          rootLabel={
            sources.find((item) => item.id === source)?.name ?? "Source"
          }
          initial={[parent]}
          load={catalogDirectoryLoader(profileId, source)}
          onClose={() => setTree(false)}
          onApply={(paths) => {
            setParent(paths[0] ?? "");
            setTree(false);
          }}
        />
      )}
    </section>
  );
}
