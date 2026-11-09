import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Media } from "./types";
import { Field, Form, Load, Modal, useRemote } from "./ui";
import { useDraftNavigation } from "./navigation";
type Member = { id: string; title: string; available: boolean };
export function CollectionEditor({
  profileId,
  initialIds,
  collectionId,
  onSaved,
  onClose,
}: {
  profileId: string;
  initialIds: string[];
  collectionId?: string;
  onSaved: () => void;
  onClose: () => void;
}) {
  const existing = useRemote<{ id: string; name: string; items: Member[] }>(
    collectionId
      ? `/api/profiles/${profileId}/collections/${collectionId}`
      : null,
  );
  const [name, setName] = useState(""),
    [ids, setIds] = useState(initialIds),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [page, setPage] = useState(1),
    [dirty, setDirty] = useState(false),
    [saving, setSaving] = useState(false);
  const names = useRef(new Map<string, Member>());
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (existing.data) {
      setName(existing.data.name);
      setIds(existing.data.items.map((i) => i.id));
      existing.data.items.forEach((i) => names.current.set(i.id, i));
    }
  }, [existing.data]);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, 200);
    return () => clearTimeout(timer);
  }, [search]);
  const media = useRemote<{ items: Media[]; total: number }>(
    `/api/profiles/${profileId}/media?search=${encodeURIComponent(query)}&page=${page}&limit=50`,
  );
  useEffect(() => {
    media.data?.items.forEach((i) => names.current.set(i.id, i));
  }, [media.data]);
  const warning = saving
    ? "A save is pending and may still finish. Close this collection?"
    : "Discard unsaved collection changes?";
  useDraftNavigation(dirty || saving, warning);
  const close = () => {
    if ((!dirty && !saving) || window.confirm(warning)) onClose();
  };
  return (
    <Modal
      title={collectionId ? "Edit collection" : "Create collection"}
      onClose={close}
    >
      <p>
        Collections reference permitted videos. Saving keeps the collection’s
        identity and existing channel references.
      </p>
      {collectionId && !existing.data ? (
        <Load {...existing} retry={existing.reload} />
      ) : (
        <Form
          guardDraft={false}
          submit="Save collection"
          onCancel={close}
          onSave={async () => {
            if (!ids.length) throw Error("Choose at least one video.");
            setSaving(true);
            try {
              await api(
                `/api/profiles/${profileId}/collections${collectionId ? `/${collectionId}` : ""}`,
                collectionId ? "PUT" : "POST",
                { name, mediaIds: ids },
              );
              if (active.current) {
                setDirty(false);
                onSaved();
              }
            } finally {
              if (active.current) setSaving(false);
            }
          }}
        >
          <Field
            label="Collection name"
            name="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            required
            maxLength={120}
          />
          <section aria-label="Selected videos" className="stack">
            <h3>{ids.length} selected videos</h3>
            {ids.map((id) => {
              const item =
                existing.data?.items.find((m) => m.id === id) ??
                media.data?.items.find((m) => m.id === id) ??
                names.current.get(id);
              return (
                <div className="panel section-head" key={id}>
                  <div>
                    <strong>{item?.title ?? "Selected video"}</strong>
                    <p>
                      {item?.available === false
                        ? "Unavailable · retained until you explicitly remove it"
                        : "Reference retained across search and pages"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    aria-label={`Remove ${item?.title ?? "selected video"}`}
                    onClick={() => {
                      setIds((old) => old.filter((i) => i !== id));
                      setDirty(true);
                    }}
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </section>
          <Field
            label="Find videos"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Load {...media} retry={media.reload} />
          {Boolean(media.data?.items.length) && (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Include</th>
                    <th>Video</th>
                    <th>Availability</th>
                  </tr>
                </thead>
                <tbody>
                  {media.data?.items.map((m) => (
                    <tr key={m.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Include ${m.title}`}
                          checked={ids.includes(m.id)}
                          onChange={(e) => {
                            setIds((old) =>
                              e.target.checked
                                ? [...old, m.id]
                                : old.filter((id) => id !== m.id),
                            );
                            setDirty(true);
                          }}
                        />
                      </td>
                      <td>{m.title}</td>
                      <td>{m.available ? "Available" : "Unavailable"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {media.data?.total === 0 && (
            <p>No matching videos. Your selected references are preserved.</p>
          )}
          <div className="pagination">
            <button
              type="button"
              className="secondary"
              disabled={page === 1 || media.loading}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous page
            </button>
            <p>
              Page {page} · {media.data?.total ?? "…"} permitted matches
            </p>
            <button
              type="button"
              className="secondary"
              disabled={
                !media.data || page * 50 >= media.data.total || media.loading
              }
              onClick={() => setPage((p) => p + 1)}
            >
              Next page
            </button>
          </div>
        </Form>
      )}
    </Modal>
  );
}
