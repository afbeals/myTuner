import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import { ErrorBox, Modal, ModalCancel } from "./ui";
export type DirectoryNode = {
  id: string;
  path: string;
  label: string;
  count?: number;
};
export type DirectoryPage = {
  items: DirectoryNode[];
  hasMore: boolean;
  offset: number;
  limit: number;
  revision?: number;
  partial?: boolean;
};
export type DirectoryLoader = (
  parent: string,
  offset: number,
  signal: AbortSignal,
) => Promise<DirectoryPage>;
type Branch = {
  offset: number;
  data: DirectoryPage | null;
  loading: boolean;
  error: unknown;
};
type Row =
  | { kind: "folder"; node: DirectoryNode; depth: number }
  | { kind: "state"; parent: string; depth: number; branch: Branch };
/** Fixed-height virtual spacers use static classes, never CSP-blocked inline styles. */
function Spacer({ rows }: { rows: number }) {
  const parts: ReactNode[] = [];
  for (let bit = 0; rows > 0; bit++, rows = Math.floor(rows / 2))
    if (rows % 2)
      parts.push(
        <div key={bit} aria-hidden className={`tree-spacer-${bit}`} />,
      );
  return <>{parts}</>;
}
export function DirectoryTree({
  identity,
  ...props
}: {
  identity: string;
  title: string;
  rootLabel: string;
  rootChoiceLabel?: string;
  emptyLabel?: string;
  load: DirectoryLoader;
  initial?: string[];
  multiple?: boolean;
  onApply: (paths: string[]) => void;
  onClose: () => void;
}) {
  return <TreeMount key={identity} {...props} />;
}
function TreeMount({
  title,
  rootLabel,
  rootChoiceLabel = "Entire source",
  emptyLabel = "No indexed subfolders",
  load,
  initial = [""],
  multiple = false,
  onApply,
  onClose,
}: {
  title: string;
  rootLabel: string;
  rootChoiceLabel?: string;
  emptyLabel?: string;
  load: DirectoryLoader;
  initial?: string[];
  multiple?: boolean;
  onApply: (paths: string[]) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(() => new Set(initial)),
    [expanded, setExpanded] = useState(() => new Set([""])),
    [branches, setBranches] = useState<Record<string, Branch>>({}),
    [scroll, setScroll] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  const retained = useRef(new Map<string, Branch>()),
    cache = useRef(new Map<string, DirectoryPage>()),
    pending = useRef(new Map<string, AbortController>()),
    alive = useRef(true),
    revision = useRef<number | undefined>(undefined),
    viewport = useRef<HTMLDivElement>(null),
    labelId = useId();
  const clearBranches = () => {
    pending.current.forEach((controller) => controller.abort());
    pending.current.clear();
    cache.current.clear();
    retained.current.clear();
    setBranches({});
    setExpanded(new Set([""]));
  };
  const retainBranch = (parent: string, branch: Branch) => {
    retained.current.delete(parent);
    retained.current.set(parent, branch);
    const removed: string[] = [];
    while (retained.current.size > 128) {
      const victim = [...retained.current.keys()].find(
        (path) => path !== "" && path !== parent,
      )!;
      retained.current.delete(victim);
      pending.current.get(victim)?.abort();
      pending.current.delete(victim);
      removed.push(victim);
    }
    if (removed.length)
      setExpanded(
        (old) =>
          new Set(
            [...old].filter(
              (path) =>
                !removed.some(
                  (victim) => path === victim || path.startsWith(victim + "/"),
                ),
            ),
          ),
      );
    setBranches(Object.fromEntries(retained.current));
  };
  const fetchBranch = async (parent: string, offset = 0, refresh = false) => {
    const key = JSON.stringify([parent, offset]);
    pending.current.get(parent)?.abort();
    if (!refresh && cache.current.has(key)) {
      const data = cache.current.get(key)!;
      retainBranch(parent, { offset, data, loading: false, error: null });
      return;
    }
    const controller = new AbortController();
    pending.current.set(parent, controller);
    retainBranch(parent, {
      offset,
      data: retained.current.get(parent)?.data ?? null,
      loading: true,
      error: null,
    });
    try {
      const data = await loader.current(parent, offset, controller.signal);
      if (controller.signal.aborted || !alive.current) return;
      const changed =
        revision.current !== undefined &&
        data.revision !== undefined &&
        revision.current !== data.revision;
      revision.current = data.revision;
      if (changed) {
        clearBranches();
        if (parent !== "") {
          void fetchBranch("", 0, true);
          return;
        }
      }
      // Cache pages while mounted, bounded to avoid retaining an arbitrarily large server tree.
      if (cache.current.size >= 128)
        cache.current.delete(cache.current.keys().next().value!);
      cache.current.set(key, data);
      retainBranch(parent, { offset, data, loading: false, error: null });
    } catch (error) {
      if (controller.signal.aborted || !alive.current) return;
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
        clearBranches();
        setSelected(new Set());
      }
      retainBranch(parent, { offset, data: null, loading: false, error });
    } finally {
      if (pending.current.get(parent) === controller)
        pending.current.delete(parent);
    }
  };
  useEffect(() => {
    alive.current = true;
    void fetchBranch("");
    return () => {
      alive.current = false;
      pending.current.forEach((controller) => controller.abort());
      pending.current.clear();
    };
  }, []);
  const toggle = (path: string) =>
    setSelected((old) => {
      if (!multiple) return new Set(old.has(path) ? [] : [path]);
      const next = new Set(old);
      if (next.has(path)) next.delete(path);
      else {
        for (const current of next)
          if (path === "" || current.startsWith(path + "/"))
            next.delete(current);
        next.add(path);
      }
      return next;
    });
  const inherited = (path: string) =>
    multiple &&
    [...selected].some(
      (parent) =>
        parent !== path && (parent === "" || path.startsWith(parent + "/")),
    );
  const rows: Row[] = [];
  const visit = (parent: string, depth: number) => {
    const branch = branches[parent] ?? {
      offset: 0,
      data: null,
      loading: true,
      error: null,
    };
    for (const node of branch.data?.items ?? []) {
      rows.push({ kind: "folder", node, depth });
      if (expanded.has(node.path)) visit(node.path, depth + 1);
    }
    if (
      branch.loading ||
      branch.error ||
      !branch.data?.items.length ||
      branch.data.hasMore ||
      branch.offset
    )
      rows.push({ kind: "state", parent, depth, branch });
  };
  visit("", 0);
  const start = Math.min(
      Math.max(0, rows.length - 1),
      Math.max(0, Math.floor(scroll / 64) - 4),
    ),
    end = Math.min(rows.length, start + 22);
  const moveFocus = (index: number) => {
    const next = Math.max(0, Math.min(rows.length - 1, index));
    if (viewport.current)
      viewport.current.scrollTop = Math.max(0, next * 64 - 128);
    setScroll(Math.max(0, next * 64 - 128));
    requestAnimationFrame(() =>
      viewport.current
        ?.querySelector<HTMLElement>(
          `[data-tree-index="${next}"] button,[data-tree-index="${next}"] input`,
        )
        ?.focus(),
    );
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <div className="actions">
          <button
            type="button"
            disabled={!selected.size}
            onClick={() => onApply([...selected])}
          >
            Apply selection
          </button>
          <ModalCancel />
        </div>
      }
    >
      <div
        className="directory-tree"
        onChange={(event) => event.stopPropagation()}
      >
        <p id={labelId}>
          Choose folders. Expanding a row loads only its children.{" "}
          {multiple
            ? "A selected parent includes its subfolders."
            : "Choose one folder."}
        </p>
        <label className="tree-root">
          <input
            type="checkbox"
            checked={selected.has("")}
            onChange={() => toggle("")}
          />
          <strong>
            {rootLabel} · {rootChoiceLabel}
          </strong>
        </label>
        <div
          className="tree-viewport"
          ref={viewport}
          role="region"
          aria-label="Folder choices"
          aria-describedby={labelId}
          tabIndex={0}
          onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
          onKeyDown={(event) => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            const current = (event.target as HTMLElement).closest<HTMLElement>(
              "[data-tree-index]",
            );
            const index = Number(current?.dataset.treeIndex ?? 0);
            event.preventDefault();
            moveFocus(index + (event.key === "ArrowDown" ? 1 : -1));
          }}
        >
          <Spacer rows={start} />
          {rows.slice(start, end).map((row, index) =>
            row.kind === "folder" ? (
              <div
                className={`tree-row tree-depth-${Math.min(row.depth, 12)}`}
                key={row.node.path}
                data-tree-index={start + index}
              >
                <button
                  type="button"
                  className="secondary tree-expand"
                  aria-label={`${expanded.has(row.node.path) ? "Close" : "Open"} folder ${row.node.path}`}
                  aria-expanded={expanded.has(row.node.path)}
                  onClick={() => {
                    const open = expanded.has(row.node.path);
                    setExpanded((old) => {
                      const next = new Set(old);
                      if (open) next.delete(row.node.path);
                      else next.add(row.node.path);
                      return next;
                    });
                    if (!open) void fetchBranch(row.node.path);
                  }}
                >
                  {expanded.has(row.node.path) ? "▾" : "▸"}
                </button>
                <label className="tree-choice">
                  <input
                    type="checkbox"
                    aria-label={`Select folder ${row.node.path}`}
                    checked={
                      selected.has(row.node.path) || inherited(row.node.path)
                    }
                    disabled={inherited(row.node.path)}
                    onChange={() => toggle(row.node.path)}
                  />
                  <span className="tree-name" title={row.node.path}>
                    <strong>{row.node.label}</strong>
                    <small>
                      {row.node.path}
                      {row.node.count === undefined
                        ? ""
                        : ` · ${row.node.count} videos`}
                    </small>
                  </span>
                </label>
              </div>
            ) : (
              <div
                className="tree-row tree-state"
                key={`state:${row.parent}`}
                data-tree-index={start + index}
              >
                {row.branch.loading ? (
                  <span role="status">Loading folders…</span>
                ) : row.branch.error ? (
                  <>
                    <ErrorBox error={row.branch.error} />
                    <button
                      className="secondary"
                      onClick={() =>
                        void fetchBranch(row.parent, row.branch.offset, true)
                      }
                    >
                      Retry folder
                    </button>
                  </>
                ) : (
                  <>
                    {row.branch.data?.partial && (
                      <span>
                        Folder limit reached. Enter a narrower path to continue.
                      </span>
                    )}
                    {!row.branch.data?.items.length && (
                      <span>{emptyLabel}</span>
                    )}
                    {row.branch.offset > 0 && (
                      <button
                        className="secondary"
                        onClick={() =>
                          void fetchBranch(
                            row.parent,
                            Math.max(0, row.branch.offset - 50),
                          )
                        }
                      >
                        Earlier folders
                      </button>
                    )}
                    {row.branch.data?.hasMore && (
                      <button
                        className="secondary"
                        onClick={() =>
                          void fetchBranch(row.parent, row.branch.offset + 50)
                        }
                      >
                        More folders
                      </button>
                    )}
                  </>
                )}
              </div>
            ),
          )}
          <Spacer rows={rows.length - end} />
        </div>
        <p className="selection-summary">
          Selected:{" "}
          {[...selected].map((path) => path || rootLabel).join(", ") || "None"}
        </p>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            clearBranches();
            if (viewport.current) viewport.current.scrollTop = 0;
            setScroll(0);
            void fetchBranch("", 0, true);
          }}
        >
          Refresh folder choices
        </button>
      </div>
    </Modal>
  );
}
export function catalogDirectoryLoader(
  profileId: string,
  sourceId: string,
  access: "profile" | "all" = "profile",
): DirectoryLoader {
  return (parent, offset, signal) =>
    api<DirectoryPage>(
      `/api/profiles/${profileId}/catalog/tree?${new URLSearchParams({ sourceId, parent, offset: String(offset), limit: "50", mode: "folders", access })}`,
      "GET",
      undefined,
      signal,
    );
}
