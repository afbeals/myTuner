import { eventId } from "./playback-utils";
import { resourceLink } from "./resource-route";
import {
  SourceInspectionNotice,
  sourceAvailability,
  useSourceInspections,
} from "./SourceInspectionNotice";
import { useDraftNavigation } from "./navigation";
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError } from "./api";
import type { Media, MediaReference, Source } from "./types";
import { Field, Form, Load, Modal, ModalCancel, useRemote } from "./ui";
type CollectionImpact = {
  total: number;
  editExplanation: string;
  items: {
    id: string;
    name: string;
    recurring: boolean;
    materialized: boolean;
    retained: boolean;
  }[];
};
export type SavedCollection = {
  id: string;
  name: string;
  editExplanation?: string;
  channels?: { id: string; name: string }[];
};
export function CollectionEditor({
  profileId,
  initialIds,
  initialItems = [],
  sources = [],
  version = 0,
  identity = "session",
  collectionId,
  onSaved,
  onClose,
}: {
  profileId: string;
  initialIds: string[];
  initialItems?: MediaReference[];
  sources?: Source[];
  version?: number;
  identity?: string;
  collectionId?: string;
  onSaved: (saved: SavedCollection) => void;
  onClose: () => void;
}) {
  const formId = useId(),
    [creationId] = useState(eventId),
    [impactOffset, setImpactOffset] = useState(0),
    impact = useRemote<CollectionImpact>(
      collectionId
        ? `/api/profiles/${profileId}/collections/${collectionId}/dependencies?offset=${impactOffset}&limit=25`
        : null,
    ),
    existing = useRemote<{
      id: string;
      name: string;
      ids: string[];
      revision: string;
    }>(
      collectionId
        ? `/api/profiles/${profileId}/collections/${collectionId}/membership`
        : null,
    ),
    [name, setName] = useState(""),
    [ids, setIds] = useState(initialIds),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [selectedOffset, setSelectedOffset] = useState(0),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState<unknown>(null),
    [selectedLoading, setSelectedLoading] = useState(false),
    [tick, setTick] = useState(0),
    [selectedRetry, setSelectedRetry] = useState(0);
  const items = useRef(
    new Map<string, MediaReference & { available?: boolean }>(
      initialItems.map((item) => [item.id, item]),
    ),
  );
  const context = (item?: MediaReference) =>
    [
      item?.sourceId
        ? (sources.find((source) => source.id === item.sourceId)?.name ??
          "Source")
        : "",
      item?.relativePath,
    ]
      .filter(Boolean)
      .join(" · ");
  const label = (item?: MediaReference) =>
    [item?.title ?? "selected video", context(item)]
      .filter(Boolean)
      .join(" · ");
  useEffect(() => {
    if (existing.data) {
      setName(existing.data.name);
      setIds(existing.data.ids);
    }
  }, [existing.data]);
  useEffect(() => {
    if (
      existing.error instanceof ApiError &&
      [401, 403, 404].includes(existing.error.status)
    ) {
      setIds([]);
      items.current.clear();
      setDirty(false);
    }
  }, [existing.error]);
  const media = useRemote<{ items: Media[]; total: number }>(
    `/api/profiles/${profileId}/media?search=${encodeURIComponent(query)}&page=${page}&limit=50`,
  );
  const visibleIds = ids.slice(selectedOffset, selectedOffset + 50),
    key = visibleIds.join(",");
  useEffect(() => {
    if (!key) {
      setSelectedLoading(false);
      return;
    }
    const controller = new AbortController();
    setSelectedLoading(true);
    setError(null);
    void api<{ items: Media[] }>(
      `/api/profiles/${profileId}/selection?includeUnavailable=true&limit=50`,
      "POST",
      { type: "media", ids: key.split(",") },
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          result.items.forEach((item) => items.current.set(item.id, item));
          setTick((n) => n + 1);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setError(error);
          if (
            error instanceof ApiError &&
            [401, 403, 404].includes(error.status)
          ) {
            items.current.clear();
            setIds([]);
          }
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setSelectedLoading(false);
      });
    return () => controller.abort();
  }, [key, profileId, selectedRetry]);
  useEffect(() => {
    const last = Math.max(0, Math.floor((ids.length - 1) / 50) * 50);
    if (selectedOffset > last) setSelectedOffset(last);
  }, [ids.length, selectedOffset]);
  const sourceIds = [
    ...new Set(
      [
        ...visibleIds.map((id) => items.current.get(id)?.sourceId),
        ...(media.data?.items.map((item) => item.sourceId) ?? []),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  const sourceHistory = useSourceInspections({
    profileId,
    sourceIds,
    version,
    identity,
  });
  useDraftNavigation(dirty || busy);
  const change = (next: string[]) => {
    setIds(next);
    setDirty(true);
    const wanted = new Set(next);
    for (const id of items.current.keys())
      if (!wanted.has(id)) items.current.delete(id);
  };
  return (
    <Modal
      title={collectionId ? "Edit collection" : "Create collection"}
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <div className="actions">
          <button
            type="submit"
            form={formId}
            disabled={
              busy ||
              !ids.length ||
              Boolean(collectionId && !existing.data) ||
              Boolean(error) ||
              selectedLoading
            }
          >
            Save collection
          </button>
          <ModalCancel />
        </div>
      }
    >
      <p>
        Collections save exact video references. Whole-show and folder
        programming can include future videos; a collection changes only when
        you edit it.
      </p>
      <Load {...existing} retry={existing.reload} />
      {(!collectionId || existing.data) && (
        <div data-form-dirty={dirty}>
          <Form
            id={formId}
            guardDraft={false}
            hideActions
            onBusyChange={setBusy}
            onSave={async () => {
              if (!ids.length || ids.length > 5000)
                throw new Error("Choose 1–5,000 videos.");
              const saved = await api<{ id: string; name: string }>(
                `/api/profiles/${profileId}/collections${collectionId ? `/${collectionId}` : ""}`,
                collectionId ? "PUT" : "POST",
                {
                  name,
                  mediaIds: ids,
                  ...(collectionId && existing.data
                    ? { expectedRevision: existing.data.revision }
                    : { creationId }),
                },
              );
              onSaved({
                ...saved,
                ...(impact.data
                  ? {
                      editExplanation: impact.data.editExplanation,
                      channels: impact.data.items
                        .filter((item) => item.recurring)
                        .map(({ id, name }) => ({ id, name })),
                    }
                  : {}),
              });
            }}
          >
            <Field
              label="Collection name"
              name="name"
              required
              maxLength={120}
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setDirty(true);
              }}
            />
            {collectionId && (
              <section
                className="panel stack"
                aria-label="Collection programming impact"
              >
                <h3>Where this collection is used</h3>
                <Load {...impact} retry={impact.reload} />
                {impact.data && (
                  <>
                    <p>{impact.data.editExplanation}</p>
                    <p>
                      {impact.data.total} linked{" "}
                      {impact.data.total === 1 ? "channel" : "channels"}. This
                      review can change before saving.
                    </p>
                    <ul>
                      {impact.data.items.map((item) => (
                        <li key={item.id}>
                          <a href={resourceLink("channel", profileId, item.id)}>
                            {item.name}
                          </a>
                          {" · "}
                          {item.recurring
                            ? "Future programming uses this collection"
                            : "Already scheduled or paused videos overlap this collection"}
                        </li>
                      ))}
                    </ul>
                    {impact.data.total > 25 && (
                      <div className="actions">
                        <button
                          type="button"
                          className="secondary"
                          disabled={!impactOffset}
                          onClick={() =>
                            setImpactOffset((n) => Math.max(0, n - 25))
                          }
                        >
                          Previous linked channels
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          disabled={impactOffset + 25 >= impact.data!.total}
                          onClick={() => setImpactOffset((n) => n + 25)}
                        >
                          Next linked channels
                        </button>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}
            <SourceInspectionNotice
              profileId={profileId}
              sourceIds={sourceIds}
              sources={sources}
              version={version}
              identity={identity}
            />
            <section aria-label="Selected videos">
              <h3>
                {ids.length} selected {ids.length === 1 ? "video" : "videos"}
              </h3>
              <Load
                loading={selectedLoading}
                error={error}
                retry={() => setSelectedRetry((n) => n + 1)}
              />
              <div className="bounded-checklist" data-version={tick}>
                {visibleIds.map((id) => (
                  <div className="compact-row" key={id}>
                    <span className="media-reference">
                      <strong>
                        {items.current.get(id)?.title ??
                          "Loading selected video…"}
                      </strong>
                      <small className="media-reference-context">
                        {context(items.current.get(id))}
                        {items.current.get(id)?.available === false
                          ? " · Unavailable · retained reference"
                          : ""}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="secondary"
                      aria-label={`Remove ${label(items.current.get(id))}`}
                      onClick={() =>
                        change(ids.filter((current) => current !== id))
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              {ids.length > 50 && (
                <div className="actions">
                  <button
                    type="button"
                    className="secondary"
                    disabled={!selectedOffset}
                    onClick={() =>
                      setSelectedOffset((n) => Math.max(0, n - 50))
                    }
                  >
                    Previous selected videos
                  </button>
                  <span>
                    {selectedOffset + 1}–
                    {Math.min(selectedOffset + 50, ids.length)} of {ids.length}
                  </span>
                  <button
                    type="button"
                    className="secondary"
                    disabled={selectedOffset + 50 >= ids.length}
                    onClick={() => setSelectedOffset((n) => n + 50)}
                  >
                    Next selected videos
                  </button>
                </div>
              )}
            </section>
            <div
              className="actions"
              onChange={(event) => event.stopPropagation()}
            >
              <Field
                label="Find videos"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    setQuery(search);
                    setPage(1);
                  }
                }}
              />
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setQuery(search);
                  setPage(1);
                }}
              >
                Search videos
              </button>
            </div>
            <Load {...media} retry={media.reload} />
            <div className="bounded-checklist">
              {media.data?.items.map((item) => (
                <label className="subscription-choice" key={item.id}>
                  <input
                    type="checkbox"
                    aria-label={`Include ${label(item)}`}
                    checked={ids.includes(item.id)}
                    disabled={
                      (!item.available && !ids.includes(item.id)) ||
                      (ids.length >= 5000 && !ids.includes(item.id))
                    }
                    onChange={(event) => {
                      if (event.target.checked)
                        items.current.set(item.id, item);
                      change(
                        event.target.checked
                          ? [...ids, item.id]
                          : ids.filter((id) => id !== item.id),
                      );
                    }}
                  />
                  <span>
                    <strong>{item.title}</strong>
                    <small>
                      {context(item)} ·{" "}
                      {sourceAvailability(
                        item.available,
                        sourceHistory.items.find(
                          (source) => source.sourceId === item.sourceId,
                        ),
                      )}
                    </small>
                  </span>
                </label>
              ))}
              {media.data?.total === 0 && (
                <p>No matching videos. Selected references are kept.</p>
              )}
            </div>
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={page === 1 || media.loading}
                onClick={() => setPage((n) => n - 1)}
              >
                Previous videos
              </button>
              <span>Page {page}</span>
              <button
                type="button"
                className="secondary"
                disabled={
                  !media.data || page * 50 >= media.data.total || media.loading
                }
                onClick={() => setPage((n) => n + 1)}
              >
                Next videos
              </button>
            </div>
          </Form>
        </div>
      )}
    </Modal>
  );
}
