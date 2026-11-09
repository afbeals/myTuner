import { CollectionEditor } from "./CollectionEditor";
import { MetadataEditor, type MetadataTarget } from "./MetadataEditor";
import { DeletedCollections } from "./Retained";
import { ResourceLink } from "./ResourceLink";
import { VideoDetails, DeleteCollection, ReadinessPanel } from "./Inspection";
import { useEffect, useRef, useState } from "react";
import type { Workspace } from "./App";
import type { Library, Media, Selection, Collection } from "./types";
import { api } from "./api";
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
        detail: `${season.available} available episodes`,
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
      detail: `Folder · ${folder.available} available videos`,
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
      detail: `Saved collection · ${c.count} videos`,
    })),
  ] as Choice[];
}
export function LibraryPage(
  props: Workspace & { onUse: (selection: Selection) => void },
) {
  const [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    library = useRemoteLibrary(props, query),
    [source, setSource] = useState(""),
    [kind, setKind] = useState("all"),
    [dense, setDense] = useState(false),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState<Choice | null>(null),
    [picked, setPicked] = useState<string[]>([]),
    [collect, setCollect] = useState(false),
    [editingCollection, setEditingCollection] = useState<string | null>(null),
    [metadataTarget, setMetadataTarget] = useState<MetadataTarget | null>(null),
    [deletedOpen, setDeletedOpen] = useState(false),
    [undo, setUndo] = useState<{ id: string; name: string } | null>(null),
    [detail, setDetail] = useState<Media[] | null>(null),
    [detailVersion, setDetailVersion] = useState(0),
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
  const selectionContext = selected ? JSON.stringify(selected.selection) : "";
  useEffect(() => {
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
    void api<{ id: string; name: string; items: unknown[] }>(
      `/api/profiles/${props.profileId}/collections/${target.id}`,
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
            detail: `Saved collection · ${c.items.length} referenced videos`,
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
  }, [props.resource?.id, props.profileId]);
  useEffect(() => {
    setSelected(null);
    setPicked([]);
    setPage(1);
    setUndo(null);
    setDeletedOpen(false);
  }, [props.profileId]);
  useEffect(() => setPage(1), [search, source, kind]);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 200);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    setDetail(null);
    setError(null);
    setPicked([]);
    if (!selected) return;
    const c = new AbortController();
    void api<{ items: Media[] }>(
      `/api/profiles/${props.profileId}/selection?includeUnavailable=true`,
      "POST",
      selected.selection,
      c.signal,
    )
      .then((r) => {
        if (!c.signal.aborted) setDetail(r.items);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e);
      });
    return () => c.abort();
  }, [selected, props.profileId, detailVersion]);
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
      <header className="page-head">
        <div>
          <h1>Your library</h1>
          <p>Only media this profile is allowed to use.</p>
        </div>
        <div className="actions">
          <button
            className="secondary"
            onClick={library.reload}
            disabled={library.loading}
          >
            Refresh view
          </button>
          <button className="secondary" onClick={() => setDeletedOpen(true)}>
            Recently deleted
          </button>
          <button onClick={() => setCollect(true)}>
            Create collection{picked.length ? ` (${picked.length})` : ""}
          </button>
        </div>
      </header>
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
      {deletedOpen && (
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
      <div className="filters">
        <Field
          label="Search"
          placeholder="Search titles, shows or filenames"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
      {!selected && error && (
        <p role="alert">
          {error instanceof Error ? error.message : String(error)}
        </p>
      )}
      <Load
        loading={library.loading}
        error={library.error}
        retry={library.reload}
      />
      {library.data && (
        <>
          {!list.length ? (
            <section className="empty">
              <h2>No titles found</h2>
              <p>
                Try another filter, or ask your administrator to scan and grant
                a source.
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
              {list.slice((page - 1) * 24, page * 24).map((item, index) => (
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
                ? `${(page - 1) * 24 + 1}–${Math.min(page * 24, list.length)}`
                : "0"}{" "}
              of {list.length} permitted items · Page {page}
            </p>
            <button
              disabled={page * 24 >= list.length}
              onClick={() => setPage((v) => v + 1)}
            >
              Next page →
            </button>
          </div>
        </>
      )}
      {selected && (
        <Modal title={selected.label} onClose={() => setSelected(null)}>
          <p>{selected.detail}</p>
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
          {selected.selection.type === "collection" && (
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
          <Load loading={!detail && !error} error={error} />
          {detail?.length === 0 ? (
            <Empty title="No available videos">
              The selection stays dynamic; new files can join future schedule
              batches after scanning.
            </Empty>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Video</th>
                    <th>Availability</th>
                    <th>Length</th>
                    <th>Inspect</th>
                  </tr>
                </thead>
                <tbody>
                  {detail?.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${item.title}`}
                          checked={picked.includes(item.id)}
                          disabled={!item.available}
                          onChange={(e) =>
                            setPicked((v) =>
                              e.target.checked
                                ? [...v, item.id]
                                : v.filter((id) => id !== item.id),
                            )
                          }
                        />
                      </td>
                      <td>
                        {item.title}
                        {item.metadata.seasonNumber != null && (
                          <small>
                            {" "}
                            · S{item.metadata.seasonNumber} E
                            {item.metadata.episodeNumber ?? "?"}
                          </small>
                        )}
                      </td>
                      <td>
                        {item.available
                          ? "Available"
                          : "Unavailable · retained"}
                      </td>
                      <td>{duration(item.durationMs)}</td>
                      <td>
                        <button
                          className="secondary"
                          onClick={() =>
                            setInspection({
                              id: item.id,
                              context: selectionContext,
                            })
                          }
                          aria-label={`Details for ${item.title}`}
                        >
                          Details
                        </button>
                        {props.account.role === "admin" && (
                          <button
                            className="secondary"
                            aria-label={`Edit information for ${item.title}`}
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
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="actions">
            <button
              disabled={!detail?.some((item) => item.available)}
              onClick={() => {
                props.onUse(selected.selection);
                setSelected(null);
              }}
            >
              Use whole selection in a channel
            </button>
            <button
              className="secondary"
              disabled={!picked.length}
              onClick={() => setCollect(true)}
            >
              Create collection from selected videos
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
          {props.account.role === "admin" && (
            <ReadinessPanel
              key={JSON.stringify(selected.selection)}
              profileId={props.profileId}
              selection={selected.selection}
            />
          )}
        </Modal>
      )}
      {deletion && deletion.context === selectionContext && (
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
      {metadataTarget && (
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
      {(collect || editingCollection) && (
        <CollectionEditor
          key={editingCollection ?? "new"}
          profileId={props.profileId}
          initialIds={picked}
          {...(editingCollection ? { collectionId: editingCollection } : {})}
          onClose={() => {
            setCollect(false);
            setEditingCollection(null);
          }}
          onSaved={() => {
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
function useRemoteLibrary(props: Workspace, search = "") {
  const library = useRemote<Library>(
      `/api/profiles/${props.profileId}/library${search ? `?search=${encodeURIComponent(search)}` : ""}`,
      props.version,
      true,
    ),
    collection = useRemote<{ items: Collection[] }>(
      `/api/profiles/${props.profileId}/collections`,
      props.version,
    );
  return {
    ...library,
    collections: collection.data?.items ?? [],
    reload: () => {
      library.reload();
      collection.reload();
    },
  };
}
import { useRemote } from "./ui";
