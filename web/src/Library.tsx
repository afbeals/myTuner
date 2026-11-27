import { canManageProfile } from "./permissions";
import {
  SourceInspectionNotice,
  sourceAvailability,
  useSourceInspections,
} from "./SourceInspectionNotice";
import { CollectionEditor, type SavedCollection } from "./CollectionEditor";
import { MetadataEditor, type MetadataTarget } from "./MetadataEditor";
import { DeletedCollections } from "./Retained";
import { resourceLink } from "./resource-route";
import { ResourceLink } from "./ResourceLink";
import { VideoDetails, DeleteCollection, ReadinessPanel } from "./Inspection";
import { useEffect, useRef, useState } from "react";
import type { Workspace } from "./App";
import type {
  Library,
  Media,
  MediaReference,
  Selection,
  Collection,
} from "./types";
import { api, ApiError } from "./api";
import { CatalogBrowser, useCatalogPage } from "./CatalogBrowser";
import {
  Field,
  Select,
  Form,
  Modal,
  Load,
  Empty,
  Action,
  duration,
  value,
  ModalCancel,
} from "./ui";
export function Artwork({
  url,
  title = "",
  className = "artwork",
}: {
  url?: string;
  title?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  return url && !failed ? (
    <img
      className={className}
      src={url}
      loading="lazy"
      decoding="async"
      alt={title}
      onError={() => setFailed(true)}
    />
  ) : (
    <div className={`${className} placeholder`}>
      <span aria-hidden="true">▤</span>
      <span>No artwork</span>
    </div>
  );
}
export interface Choice {
  label: string;
  selection: Selection;
  sourceId?: string;
  kind: string;
  artwork?: string | undefined;
  detail: string;
}
function collectionDetail(collection: Collection) {
  const total = collection.totalCount ?? collection.count;
  const missing =
    collection.unavailableCount ?? Math.max(0, total - collection.count);
  return `Saved collection · ${total} referenced ${total === 1 ? "video" : "videos"} · ${collection.count} available · ${missing} unavailable`;
}
export function choices(
  library: Library,
  collections: Collection[],
  profileId: string,
): Choice[] {
  return [
    ...library.shows.flatMap((show) => [
      {
        label: show.title,
        selection: {
          type: "show",
          sourceId: show.sourceId,
          key: show.key,
          includeSpecials: false,
        } as Selection,
        sourceId: show.sourceId,
        kind: "shows",
        artwork: show.artwork[0]
          ? `/api/profiles/${profileId}/media/${show.artwork[0].mediaId}/artwork/${show.artwork[0].index}`
          : undefined,
        detail: `Show · ${show.seasons.reduce((n, s) => n + s.available, 0)} available / ${show.seasons.reduce((n, s) => n + s.unavailable, 0)} missing`,
      },
      ...show.seasons.map((season) => ({
        label: `${show.title} · Season ${season.number}`,
        selection: {
          type: "show",
          sourceId: show.sourceId,
          key: show.key,
          season: season.number,
          includeSpecials: season.number === 0,
        } as Selection,
        sourceId: show.sourceId,
        kind: "seasons",
        detail: `${season.available} available ${season.available === 1 ? "episode" : "episodes"}`,
      })),
    ]),
    ...library.movies.map((movie) => ({
      label: movie.title,
      selection: { type: "media", ids: [movie.id] } as Selection,
      sourceId: movie.sourceId,
      kind: "movies",
      artwork: movie.metadata.images?.[0]?.url,
      detail: `${movie.metadata.year ?? ""} · Movie${movie.available ? "" : " · Unavailable"}`,
    })),
    ...library.folders.map((folder) => ({
      label:
        folder.directory ||
        library.sources.find((s) => s.id === folder.sourceId)?.name ||
        "Source folder",
      selection: {
        type: "folder",
        sourceId: folder.sourceId,
        directory: folder.directory,
        recursive: true,
      } as Selection,
      sourceId: folder.sourceId,
      kind:
        library.sources.find((s) => s.id === folder.sourceId)?.kind ?? "videos",
      detail: `${folder.directory ? "Folder" : "Source root"} · ${folder.available} available ${folder.available === 1 ? "video" : "videos"}`,
    })),
    ...library.movieCollections.map((c) => ({
      label: c.title,
      selection: {
        type: "movieCollection",
        sourceId: c.sourceId,
        key: c.key,
      } as Selection,
      sourceId: c.sourceId,
      kind: "collections",
      detail: `Movie collection · ${c.available} available`,
    })),
    ...collections.map((c) => ({
      label: c.name,
      selection: { type: "collection", id: c.id } as Selection,
      kind: "collections",
      detail: collectionDetail(c),
    })),
  ] as Choice[];
}
export function LibraryPage(
  props: Workspace & {
    onUse: (selection: Selection) => void;
    embedded?: boolean;
    createRequested?: number;
  },
) {
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [source, setSource] = useState(""),
    [kind, setKind] = useState("all"),
    [dense, setDense] = useState(false),
    [page, setPage] = useState(1),
    library = useRemoteLibrary(props, query, source, kind, page),
    [selected, setSelected] = useState<Choice | null>(null),
    [picked, setPicked] = useState<string[]>([]),
    [collect, setCollect] = useState(false),
    [browseMode, setBrowseMode] = useState("titles"),
    [tray, setTray] = useState<Map<string, MediaReference>>(() => new Map()),
    [trayMessage, setTrayMessage] = useState(""),
    [savedCollection, setSavedCollection] = useState<SavedCollection | null>(
      null,
    ),
    [trayOffset, setTrayOffset] = useState(0),
    [detailOffset, setDetailOffset] = useState(0),
    [detailTotal, setDetailTotal] = useState(0),
    [editingCollection, setEditingCollection] = useState<string | null>(null),
    [metadataTarget, setMetadataTarget] = useState<MetadataTarget | null>(null),
    [deletedOpen, setDeletedOpen] = useState(false),
    [undo, setUndo] = useState<{ id: string; name: string } | null>(null),
    [detail, setDetail] = useState<Media[] | null>(null),
    [detailVersion, setDetailVersion] = useState(0),
    [linkedVersion, setLinkedVersion] = useState(0),
    [inspection, setInspection] = useState<{
      id: string;
      context: string;
    } | null>(null),
    [deletion, setDeletion] = useState<{
      id: string;
      name: string;
      context: string;
    } | null>(null),
    [error, setError] = useState<unknown>(null);
  const pickedNames = useRef(new Map<string, MediaReference>());
  const manage = canManageProfile(
    props.account,
    props.profiles.find((profile) => profile.id === props.profileId),
  );
  useEffect(() => {
    if (props.createRequested && manage) setCollect(true);
  }, [props.createRequested, manage]);
  useEffect(() => {
    if (!manage) {
      setCollect(false);
      setEditingCollection(null);
      setTray(new Map());
      setPicked([]);
      setMetadataTarget(null);
      setDeletion(null);
    }
  }, [manage]);
  useEffect(() => {
    const last = Math.max(0, Math.floor((tray.size - 1) / 50) * 50);
    if (trayOffset > last) setTrayOffset(last);
  }, [tray.size, trayOffset]);
  const trayIdentity = [...tray.keys()].join(",");
  useEffect(() => {
    if (!trayIdentity) return;
    const controller = new AbortController();
    void api(
      `/api/profiles/${props.profileId}/selection?limit=1&includeUnavailable=true`,
      "POST",
      { type: "media", ids: trayIdentity.split(",") },
      controller.signal,
    ).catch((error) => {
      if (
        !controller.signal.aborted &&
        error instanceof ApiError &&
        [401, 403, 404].includes(error.status)
      ) {
        setTray(new Map());
        setTrayMessage(
          "The selection was cleared because media access changed. Choose permitted videos again.",
        );
        setSelected(null);
        setCollect(false);
      }
    });
    return () => controller.abort();
  }, [props.profileId, props.version, trayIdentity]);
  const sourceIds = [
    ...new Set([
      ...(library.data?.shows.map((item) => item.sourceId) ?? []),
      ...(library.data?.movies.map((item) => item.sourceId) ?? []),
      ...(library.data?.folders.map((item) => item.sourceId) ?? []),
      ...(library.data?.movieCollections.map((item) => item.sourceId) ?? []),
      ...(detail?.map((item) => item.sourceId) ?? []),
    ]),
  ];
  const sourceHistory = useSourceInspections({
    profileId: props.profileId,
    sourceIds,
    version: props.version,
    identity: props.account.id,
  });
  const referenceContext = (item: MediaReference) =>
    [
      item.sourceId
        ? (library.data?.sources.find((source) => source.id === item.sourceId)
            ?.name ?? "Source")
        : "",
      item.relativePath,
    ]
      .filter(Boolean)
      .join(" · ");
  const referenceLabel = (item: MediaReference) =>
    [item.title, referenceContext(item)].filter(Boolean).join(" · ");
  useEffect(() => {
    setSelected((old) => {
      if (old?.selection.type !== "collection") return old;
      const id = old.selection.id;
      const current = library.collections.find((item) => item.id === id);
      if (!current) return old;
      const detail = collectionDetail(current);
      return old.label === current.name && old.detail === detail
        ? old
        : { ...old, label: current.name, detail };
    });
  }, [library.data]);
  const selectionContext = selected ? JSON.stringify(selected.selection) : "";
  useEffect(() => {
    setPicked([]);
    pickedNames.current.clear();
    setDetailOffset(0);
    setInspection(null);
    setMetadataTarget(null);
    setDeletion(null);
    setCollect(false);
    setEditingCollection(null);
  }, [selectionContext, props.resource?.id, props.profileId]);
  const linkedSelection = useRef(false);
  useEffect(() => {
    const target = props.resource;
    if (target?.kind !== "collection") {
      if (linkedSelection.current) setSelected(null);
      linkedSelection.current = false;
      return;
    }
    linkedSelection.current = true;
    const controller = new AbortController();
    setSelected(null);
    setError(null);
    void api<{ id: string; name: string; ids: string[] }>(
      `/api/profiles/${props.profileId}/collections/${target.id}/membership`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((c) => {
        if (!controller.signal.aborted)
          setSelected({
            label: c.name,
            selection: { type: "collection", id: c.id },
            kind: "collections",
            detail: library.collections.some((item) => item.id === c.id)
              ? collectionDetail(
                  library.collections.find((item) => item.id === c.id)!,
                )
              : `Saved collection · ${c.ids.length} referenced ${c.ids.length === 1 ? "video" : "videos"}`,
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            new Error(
              "This item is unavailable. The link may be outdated or access has changed.",
            ),
          );
      });
    return () => controller.abort();
  }, [props.resource?.id, props.profileId, linkedVersion]);
  useEffect(() => {
    setSelected(null);
    setPicked([]);
    setTray(new Map());
    setPage(1);
    setUndo(null);
    setDeletedOpen(false);
    setSavedCollection(null);
    setTrayMessage("");
  }, [props.profileId]);
  useEffect(() => setPage(1), [query, source, kind]);
  useEffect(() => {
    if (library.loading || !library.data?.pagination) return;
    const lastPage = Math.max(1, Math.ceil(library.data.pagination.total / 24));
    if (page > lastPage) setPage(lastPage);
  }, [library.loading, library.data?.pagination?.total, page]);
  useEffect(() => {
    setDetail(null);
    setError(null);
    if (!selected) return;
    const c = new AbortController();
    void api<{ items: Media[]; total: number }>(
      `/api/profiles/${props.profileId}/selection?includeUnavailable=true&offset=${detailOffset}&limit=50`,
      "POST",
      selected.selection,
      c.signal,
    )
      .then((r) => {
        if (!c.signal.aborted) {
          setDetail(r.items);
          setDetailTotal(r.total);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(e);
          if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
            setPicked([]);
            pickedNames.current.clear();
            setTray(new Map());
          }
        }
      });
    return () => c.abort();
  }, [selected, props.profileId, detailVersion, detailOffset]);
  const list = library.data
    ? choices(library.data, library.collections, props.profileId).filter(
        (c) =>
          c.kind !== "seasons" &&
          c.kind !== "commercials" &&
          (c.selection.type !== "collection" ||
            c.label
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase())) &&
          (!source || c.sourceId === source) &&
          (kind === "all" || c.kind === kind),
      )
    : [];
  return (
    <>
      <header className="page-head library-heading">
        <div>
          {props.embedded ? (
            <h2 id="network-library" tabIndex={-1}>
              Your library
            </h2>
          ) : (
            <h1>Your library</h1>
          )}
        </div>
        <div className="actions">
          <button
            className="secondary"
            onClick={() => {
              library.reload();
              sourceHistory.reload();
            }}
            disabled={library.loading}
          >
            Refresh view
          </button>
          {manage && (
            <button className="secondary" onClick={() => setDeletedOpen(true)}>
              Recently deleted
            </button>
          )}
          {manage && !props.embedded && (
            <button onClick={() => setCollect(true)}>Create collection</button>
          )}
        </div>
      </header>
      <p className="section-description">
        {manage
          ? "Select exact videos for a collection, or use whole shows and folders to program a channel."
          : "Browse media available to this profile."}
      </p>
      {undo && (
        <div className="notice" role="status">
          Deleted {undo.name}.{" "}
          <Action
            secondary
            task={async () => {
              await api(
                `/api/profiles/${props.profileId}/deleted-collections/${undo.id}/restore`,
                "POST",
              );
              setUndo(null);
              library.reload();
              props.changed();
            }}
          >
            Undo deletion
          </Action>
        </div>
      )}
      {manage && deletedOpen && (
        <DeletedCollections
          profileId={props.profileId}
          onClose={() => setDeletedOpen(false)}
          onRestored={() => {
            setUndo(null);
            library.reload();
            props.changed();
          }}
        />
      )}
      {trayMessage && (
        <p role="status" className="notice">
          {trayMessage}{" "}
          {savedCollection && (
            <a
              onClick={() => setLinkedVersion((version) => version + 1)}
              href={resourceLink(
                "collection",
                props.profileId,
                savedCollection.id,
              )}
            >
              Open saved collection · {savedCollection.name}
            </a>
          )}
          {savedCollection?.editExplanation && (
            <span> {savedCollection.editExplanation}</span>
          )}
          {savedCollection?.channels?.map((channel) => (
            <span key={channel.id}>
              {" "}
              <a href={resourceLink("channel", props.profileId, channel.id)}>
                Review {channel.name}
              </a>
            </span>
          ))}
        </p>
      )}
      {manage && (
        <section
          className={`panel selection-tray${tray.size ? "" : " selection-tray-empty"}`}
          aria-label="Selection tray"
        >
          <div className="section-head">
            <h3>
              Selection tray · {tray.size}{" "}
              {tray.size === 1 ? "video" : "videos"}
            </h3>
            {tray.size > 0 && (
              <div className="actions">
                <button onClick={() => setCollect(true)}>
                  Create collection from tray
                </button>
                <button
                  className="secondary"
                  disabled={!tray.size}
                  onClick={() =>
                    props.onUse({ type: "media", ids: [...tray.keys()] })
                  }
                >
                  Create channel from tray
                </button>
                <button
                  className="secondary"
                  disabled={!tray.size}
                  onClick={() => {
                    setTray(new Map());
                    setTrayMessage("Selection cleared.");
                  }}
                >
                  Clear tray
                </button>
              </div>
            )}
          </div>
          <p>
            {tray.size
              ? "Exact videos stay selected across searches and folders in this profile. Maximum 5,000 videos."
              : "Select videos from the library to build a collection or channel."}
          </p>
          {tray.size > 0 && (
            <details>
              <summary>Review selected videos</summary>
              <div className="bounded-checklist">
                {[...tray.values()]
                  .slice(trayOffset, trayOffset + 50)
                  .map((item) => (
                    <div className="compact-row" key={item.id}>
                      <span className="media-reference">
                        {item.title}
                        <small className="media-reference-context">
                          {referenceContext(item)}
                        </small>
                      </span>
                      <button
                        className="secondary"
                        aria-label={`Remove ${referenceLabel(item)} from tray`}
                        onClick={() =>
                          setTray((old) => {
                            const next = new Map(old);
                            next.delete(item.id);
                            return next;
                          })
                        }
                      >
                        Remove
                      </button>
                    </div>
                  ))}
              </div>
              {tray.size > 50 && (
                <div className="actions">
                  <button
                    className="secondary"
                    disabled={!trayOffset}
                    onClick={() => setTrayOffset((n) => Math.max(0, n - 50))}
                  >
                    Previous tray videos
                  </button>
                  <span>
                    {trayOffset + 1}–{Math.min(trayOffset + 50, tray.size)} of{" "}
                    {tray.size}
                  </span>
                  <button
                    className="secondary"
                    disabled={trayOffset + 50 >= tray.size}
                    onClick={() => setTrayOffset((n) => n + 50)}
                  >
                    Next tray videos
                  </button>
                </div>
              )}
            </details>
          )}
        </section>
      )}
      <div className="tabs" aria-label="Browse library by">
        <button
          className={browseMode === "titles" ? "selected" : "secondary"}
          aria-pressed={browseMode === "titles"}
          onClick={() => setBrowseMode("titles")}
        >
          Shows, movies and collections
        </button>
        <button
          className={browseMode === "paths" ? "selected" : "secondary"}
          aria-pressed={browseMode === "paths"}
          onClick={() => setBrowseMode("paths")}
        >
          Folders and file names
        </button>
      </div>
      {browseMode === "paths" && (
        <CatalogBrowser
          profileId={props.profileId}
          version={props.version}
          sources={library.data?.sources ?? []}
          selectedIds={[...tray.keys()]}
          identity={props.account.id}
          allowFileSelection={manage}
          onFile={(item) => {
            setTray((old) => {
              if (old.size >= 5000) return old;
              return new Map(old).set(item.id, {
                id: item.id,
                title: item.label,
                sourceId: item.sourceId,
                relativePath: item.path,
              });
            });
            setTrayMessage("Video added to selection tray.");
          }}
          onFolder={(item) =>
            setSelected({
              label: item.label,
              detail: `Indexed folder · ${item.path}`,
              kind: "videos",
              sourceId: item.sourceId,
              selection: {
                type: "folder",
                sourceId: item.sourceId,
                directory: item.path,
                recursive: true,
              },
            })
          }
        />
      )}
      {!selected && (
        <SourceInspectionNotice
          profileId={props.profileId}
          sourceIds={sourceIds}
          version={props.version}
          identity={props.account.id}
          sources={library.data?.sources ?? []}
        />
      )}
      <div hidden={browseMode !== "titles"}>
        <div className="tabs" aria-label="Content type">
          {[
            ["all", "All types"],
            ["shows", "Shows"],
            ["movies", "Movies"],
            ["videos", "Custom videos"],
            ["collections", "Collections"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={kind === id ? "selected" : "secondary"}
              aria-pressed={kind === id}
              onClick={() => setKind(id!)}
            >
              {label}
            </button>
          ))}
        </div>
        <form
          className="filters"
          onSubmit={(event) => {
            event.preventDefault();
            setQuery(search);
            setPage(1);
          }}
        >
          <Field
            label="Search catalog titles"
            placeholder="Search titles"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <details className="library-filter-options">
            <summary>Source and display options</summary>
            <div className="filters">
              <Select
                label="Source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
              >
                <option value="">All permitted sources</option>
                {library.data?.sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Select
                label="View"
                value={dense ? "list" : "grid"}
                onChange={(e) => setDense(e.target.value === "list")}
              >
                <option value="grid">Artwork grid</option>
                <option value="list">Dense list</option>
              </Select>
            </div>
          </details>
          <button type="submit">Search</button>
        </form>
        {!selected && Boolean(error) && (
          <p role="alert">
            {error instanceof Error ? error.message : String(error)}
          </p>
        )}
        <Load
          loading={library.loading}
          error={library.error}
          retry={library.reload}
        />
        {library.data && (library.loading || Boolean(library.error)) && (
          <p role="status">
            Showing the previous library view
            {library.updatedAt
              ? ` from ${new Date(library.updatedAt).toLocaleString()}`
              : ""}
            .{" "}
            {library.loading
              ? "Refreshing…"
              : "The latest refresh failed. Retry to update it."}
          </p>
        )}
        {library.data && (
          <>
            {!list.length ? (
              <section className="empty">
                <h2>No titles found</h2>
                <p>
                  Try another filter, or ask your administrator to scan and
                  grant a source.
                </p>
                {(search || source || kind !== "all") && (
                  <button
                    onClick={() => {
                      setSearch("");
                      setQuery("");
                      setSource("");
                      setKind("all");
                      setPage(1);
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </section>
            ) : (
              <div className={dense ? "library-list" : "library-grid"}>
                {(library.data.pagination
                  ? list
                  : list.slice((page - 1) * 24, page * 24)
                ).map((item, index) => (
                  <article
                    className="media-card"
                    key={JSON.stringify(item.selection) + index}
                  >
                    <Artwork {...(item.artwork ? { url: item.artwork } : {})} />
                    <div>
                      <h2>{item.label}</h2>
                      <p>{item.detail}</p>
                      <button
                        className="secondary"
                        onClick={() => setSelected(item)}
                        aria-label={`Open details for ${item.label}`}
                      >
                        Open details
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <div className="pagination">
              <button
                className="secondary"
                disabled={page === 1}
                onClick={() => setPage((v) => v - 1)}
              >
                Previous page
              </button>
              <p>
                {list.length
                  ? `${(page - 1) * 24 + 1}–${Math.min(page * 24, library.data.pagination?.total ?? list.length)}`
                  : "0"}{" "}
                of {library.data.pagination?.total ?? list.length} permitted
                items · Page {page}
              </p>
              <button
                disabled={
                  page * 24 >= (library.data.pagination?.total ?? list.length)
                }
                onClick={() => setPage((v) => v + 1)}
              >
                Next page →
              </button>
            </div>
          </>
        )}
      </div>
      {selected && (
        <Modal
          title={selected.label}
          onClose={() => setSelected(null)}
          footer={
            <div className="actions">
              {manage && (
                <button
                  disabled={
                    !picked.length ||
                    (picked.some((id) => !tray.has(id)) &&
                      tray.size + picked.filter((id) => !tray.has(id)).length >
                        5000)
                  }
                  onClick={() => {
                    setTray((old) => {
                      const next = new Map(old);
                      for (const id of picked) {
                        const item = pickedNames.current.get(id);
                        if (item) next.set(id, item);
                      }
                      return next;
                    });
                    setTrayMessage(
                      `${picked.length} selected ${picked.length === 1 ? "video" : "videos"} added to the tray.`,
                    );
                    setSelected(null);
                  }}
                >
                  Add {picked.length || "selected"}{" "}
                  {picked.length === 1 ? "video" : "videos"} to tray
                </button>
              )}
              <ModalCancel />
            </div>
          }
        >
          <p>{selected.detail}</p>
          <SourceInspectionNotice
            profileId={props.profileId}
            sourceIds={sourceIds}
            version={props.version}
            identity={props.account.id}
            sources={library.data?.sources ?? []}
          />
          {selected.selection.type === "folder" &&
            detail &&
            !detail.some((item) => item.available) && (
              <p className="notice" role="status">
                This indexed folder has no available videos. A folder may have
                moved or become unavailable since the last scan. Review its
                source and relative path, scan the source, or choose another
                folder. This does not change or remap the saved reference.
              </p>
            )}
          {props.account.role === "admin" &&
            (selected.selection.type === "show" ||
              (selected.selection.type === "media" &&
                selected.selection.ids.length === 1)) && (
              <button
                className="secondary"
                onClick={() => {
                  const s = selected.selection;
                  if (s.type === "show")
                    setMetadataTarget({
                      kind: "show",
                      sourceId: s.sourceId,
                      key: s.key,
                    });
                  else if (s.type === "media")
                    setMetadataTarget({ kind: "media", mediaId: s.ids[0]! });
                }}
              >
                Edit information
              </button>
            )}
          {manage && selected.selection.type === "collection" && (
            <button
              className="secondary"
              onClick={() => {
                if (selected.selection.type === "collection")
                  setEditingCollection(selected.selection.id);
              }}
            >
              Edit collection
            </button>
          )}
          {selected.selection.type === "collection" && (
            <ResourceLink
              kind="collection"
              profileId={props.profileId}
              id={selected.selection.id}
            />
          )}
          {selected.selection.type === "show" && (
            <div className="actions">
              <Select
                label="Season"
                value={selected.selection.season ?? "all"}
                onChange={(e) => {
                  const s = selected.selection;
                  if (s.type !== "show") return;
                  const { season: _, ...base } = s;
                  setSelected({
                    ...selected,
                    selection: {
                      ...base,
                      ...(e.target.value === "all"
                        ? {}
                        : { season: Number(e.target.value) }),
                    },
                  });
                }}
              >
                <option value="all">Whole show</option>
                {library.data?.shows
                  .find(
                    (s) =>
                      s.key ===
                        (selected.selection.type === "show"
                          ? selected.selection.key
                          : "") && s.sourceId === selected.sourceId,
                  )
                  ?.seasons.map((s) => (
                    <option value={s.number} key={s.number}>
                      Season {s.number}
                    </option>
                  ))}
              </Select>
              <label className="check">
                <input
                  type="checkbox"
                  checked={selected.selection.includeSpecials}
                  onChange={(e) => {
                    if (selected.selection.type === "show")
                      setSelected({
                        ...selected,
                        selection: {
                          ...selected.selection,
                          includeSpecials: e.target.checked,
                        },
                      });
                  }}
                />
                Include specials
              </label>
            </div>
          )}
          {selected.selection.type === "folder" && (
            <label className="check">
              <input
                type="checkbox"
                checked={selected.selection.recursive}
                onChange={(e) => {
                  if (selected.selection.type === "folder")
                    setSelected({
                      ...selected,
                      selection: {
                        ...selected.selection,
                        recursive: e.target.checked,
                      },
                    });
                }}
              />
              Include subfolders
            </label>
          )}
          {manage && (
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={!detail?.some((item) => item.available)}
                onClick={() => {
                  const available =
                    detail?.filter((item) => item.available) ?? [];
                  available.forEach((item) =>
                    pickedNames.current.set(item.id, item),
                  );
                  setPicked((old) => [
                    ...new Set([...old, ...available.map((item) => item.id)]),
                  ]);
                }}
              >
                Select all on this page
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const current = new Set(detail?.map((item) => item.id) ?? []);
                  current.forEach((id) => pickedNames.current.delete(id));
                  setPicked((old) => old.filter((id) => !current.has(id)));
                }}
              >
                Clear page selection
              </button>
              <span>
                {picked.length} {picked.length === 1 ? "video" : "videos"}{" "}
                selected
              </span>
            </div>
          )}
          <Load loading={!detail && !error} error={error} />
          {detail?.length === 0 ? (
            <Empty title="No available videos">
              The selection stays dynamic; new files can join future schedule
              batches after scanning.
            </Empty>
          ) : (
            <div className="table-scroll bounded-video-list">
              <table>
                <thead>
                  <tr>
                    {manage && <th>Select</th>}
                    <th>Video</th>
                    <th>Availability</th>
                    <th>Length</th>
                    <th>Inspect</th>
                  </tr>
                </thead>
                <tbody>
                  {detail?.map((item) => (
                    <tr key={item.id}>
                      {manage && (
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`Select ${referenceLabel(item)}`}
                            checked={picked.includes(item.id)}
                            disabled={!item.available}
                            onChange={(e) => {
                              if (e.target.checked)
                                pickedNames.current.set(item.id, item);
                              else pickedNames.current.delete(item.id);
                              setPicked((v) =>
                                e.target.checked
                                  ? [...v, item.id]
                                  : v.filter((id) => id !== item.id),
                              );
                            }}
                          />
                        </td>
                      )}
                      <td>
                        {item.title}
                        <small className="media-reference-context">
                          {referenceContext(item)}
                        </small>
                        {item.metadata.seasonNumber != null && (
                          <small>
                            {" "}
                            · S{item.metadata.seasonNumber} E
                            {item.metadata.episodeNumber ?? "?"}
                          </small>
                        )}
                      </td>
                      <td>
                        {sourceAvailability(
                          item.available,
                          sourceHistory.items.find(
                            (source) => source.sourceId === item.sourceId,
                          ),
                        )}
                      </td>
                      <td>{duration(item.durationMs)}</td>
                      <td>
                        <div className="actions">
                          <button
                            className="secondary"
                            onClick={() =>
                              setInspection({
                                id: item.id,
                                context: selectionContext,
                              })
                            }
                            aria-label={`Details for ${referenceLabel(item)}`}
                          >
                            Details
                          </button>
                          {props.account.role === "admin" && (
                            <button
                              className="secondary"
                              aria-label={`Edit information for ${referenceLabel(item)}`}
                              onClick={() =>
                                setMetadataTarget({
                                  kind: "media",
                                  mediaId: item.id,
                                })
                              }
                            >
                              Edit information
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="pagination">
            <button
              className="secondary"
              disabled={!detailOffset || !detail}
              onClick={() => setDetailOffset((n) => Math.max(0, n - 50))}
            >
              Previous videos
            </button>
            <span>
              {Math.min(detailOffset + 1, detailTotal)}–
              {Math.min(detailOffset + 50, detailTotal)} of {detailTotal}
            </span>
            <button
              className="secondary"
              disabled={!detail || detailOffset + 50 >= detailTotal}
              onClick={() => setDetailOffset((n) => n + 50)}
            >
              Next videos
            </button>
          </div>
          {manage && (
            <div className="actions">
              <button
                className="secondary"
                disabled={!detail?.some((item) => item.available)}
                onClick={() => {
                  props.onUse(selected.selection);
                  setSelected(null);
                }}
              >
                Program this whole{" "}
                {selected.selection.type === "show"
                  ? "show or season"
                  : selected.selection.type === "folder"
                    ? "folder"
                    : "selection"}{" "}
                in a channel
              </button>

              {selected.selection.type === "collection" && (
                <button
                  className="secondary danger"
                  onClick={() => {
                    if (selected.selection.type === "collection")
                      setDeletion({
                        id: selected.selection.id,
                        name: selected.label,
                        context: selectionContext,
                      });
                  }}
                >
                  Delete collection
                </button>
              )}
            </div>
          )}
          {props.account.role === "admin" && (
            <ReadinessPanel
              key={JSON.stringify(selected.selection)}
              profileId={props.profileId}
              selection={selected.selection}
              identity={props.account.id}
              version={props.version}
            />
          )}
        </Modal>
      )}
      {manage && deletion && deletion.context === selectionContext && (
        <DeleteCollection
          profileId={props.profileId}
          collectionId={deletion.id}
          collectionName={deletion.name}
          onClose={() => setDeletion(null)}
          onDeleted={() => {
            const id = deletion.id;
            setUndo({ id, name: deletion.name });
            setDeletion(null);
            setSelected((old) =>
              old?.selection.type === "collection" && old.selection.id === id
                ? null
                : old,
            );
            library.reload();
            props.changed();
          }}
        />
      )}
      {inspection && inspection.context === selectionContext && (
        <VideoDetails
          profileId={props.profileId}
          mediaId={inspection.id}
          admin={props.account.role === "admin"}
          onClose={() => setInspection(null)}
        />
      )}
      {manage && metadataTarget && (
        <MetadataEditor
          key={JSON.stringify(metadataTarget)}
          profileId={props.profileId}
          target={metadataTarget}
          onClose={() => setMetadataTarget(null)}
          onSaved={() => {
            setDetailVersion((v) => v + 1);
            library.reload();
            props.changed();
          }}
        />
      )}
      {manage && (collect || editingCollection) && (
        <CollectionEditor
          key={editingCollection ?? "new"}
          profileId={props.profileId}
          initialIds={[...tray.keys()]}
          initialItems={[...tray.values()]}
          version={props.version}
          identity={props.account.id}
          sources={library.data?.sources ?? []}
          {...(editingCollection ? { collectionId: editingCollection } : {})}
          onClose={() => {
            setCollect(false);
            setEditingCollection(null);
          }}
          onSaved={(saved) => {
            setSavedCollection(saved);
            setTrayMessage(`Saved collection “${saved.name}”.`);
            if (!editingCollection) {
              setTray(new Map());
            }
            setCollect(false);
            setEditingCollection(null);
            setDetailVersion((v) => v + 1);
            library.reload();
            props.changed();
          }}
        />
      )}
    </>
  );
}
function useRemoteLibrary(
  props: Workspace,
  search = "",
  source = "",
  kind = "all",
  page = 1,
) {
  const params = new URLSearchParams({
    search,
    kind,
    offset: String((page - 1) * 24),
    limit: "24",
    titleOnly: "true",
  });
  if (source) params.set("sourceId", source);
  const library = useCatalogPage<Library>(
    `/api/profiles/${props.profileId}/library?${params}`,
    `${props.account.id}:${props.profileId}:${props.version}`,
  );
  return {
    ...library,
    collections: library.data?.savedCollections ?? [],
    reload: library.reload,
  };
}
import { useRemote } from "./ui";
