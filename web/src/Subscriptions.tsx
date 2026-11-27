import { useDraftNavigation } from "./navigation";
import { useEffect, useId, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { confirmAction } from "./confirmation";
import { Field, Form, Load, Modal, ModalCancel, useRemote } from "./ui";
type Item = {
  id: string;
  name: string;
  shortName: string | null;
  visibility: string;
};
type Configuration = {
  revision: string;
  items: Item[];
  order: Item[];
  total: number;
  hasMore: boolean;
};
export function SubscriptionsModal({
  profileId,
  profileName,
  admin,
  onClose,
  onSaved,
  onUnlocked,
}: {
  profileId: string;
  profileName: string;
  admin: boolean;
  onClose: () => void;
  onSaved: () => void;
  onUnlocked?: () => void;
}) {
  const formId = useId(),
    [search, setSearch] = useState(""),
    [query, setQuery] = useState(""),
    [offset, setOffset] = useState(0),
    [order, setOrder] = useState<Item[] | null>(null),
    [revision, setRevision] = useState(""),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const original = useRef<Item[]>([]),
    list = useRef<HTMLDivElement>(null);
  const result = useRemote<Configuration>(
    `/api/profiles/${profileId}/subscription-configuration?${new URLSearchParams({ search: query, offset: String(offset), limit: "50" })}`,
  );
  useEffect(() => {
    if (result.data && order === null) {
      setOrder(result.data.order);
      original.current = [...result.data.order];
      setRevision(result.data.revision);
    }
  }, [result.data, order]);
  useEffect(() => {
    if (
      result.error instanceof ApiError &&
      [401, 403, 404].includes(result.error.status)
    ) {
      setOrder(null);
      setRevision("");
      original.current = [];
      setDirty(false);
    }
  }, [result.error]);
  useDraftNavigation(dirty || busy);
  const selected = new Set(order?.map((item) => item.id) ?? []);
  const change = (next: Item[]) => {
    setOrder(next);
    setDirty(true);
  };
  const move = (id: string, delta: number) => {
    if (!order) return;
    const next = [...order],
      from = next.findIndex((item) => item.id === id),
      to = from + delta;
    if (to < 0 || to >= next.length) return;
    [next[from], next[to]] = [next[to]!, next[from]!];
    change(next);
    setMessage(`Moved ${next[to]!.name} to position ${to + 1}.`);
    requestAnimationFrame(() =>
      list.current
        ?.querySelector<HTMLButtonElement>(
          `[data-channel-id="${id}"] button:not(:disabled)`,
        )
        ?.focus(),
    );
  };
  return (
    <Modal
      title={`Subscriptions for ${profileName}`}
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <div className="actions">
          <button
            type="submit"
            form={formId}
            disabled={busy || !order || Boolean(result.error)}
          >
            Save subscriptions
          </button>
          <ModalCancel />
        </div>
      }
    >
      <p>
        Choose channels, then arrange their guide order.{" "}
        {admin
          ? "Admin view includes other accounts’ private channels."
          : "Only your own private channels are visible."}
      </p>
      <p>
        Removing a channel stops this profile’s playback on that channel. Other
        profiles are unaffected.
      </p>
      <form
        className="actions"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(search);
          setOffset(0);
        }}
      >
        <Field
          label="Find channels"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="submit" className="secondary">
          Search
        </button>
      </form>
      {result.error instanceof ApiError &&
      result.error.status === 403 &&
      result.error.message === "Profile is locked" ? (
        <Form
          guardDraft={false}
          submit={`Unlock ${profileName}`}
          onSave={async (data) => {
            await api(`/api/profiles/${profileId}/unlock`, "POST", {
              pin: String(data.get("pin")),
            });
            result.reload();
            onUnlocked?.();
          }}
        >
          <Field
            label={`PIN for ${profileName}`}
            name="pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4,8}"
            minLength={4}
            maxLength={8}
            required
            autoComplete="off"
            hint="Enter this profile’s PIN to manage its lineup."
          />
        </Form>
      ) : (
        <Load {...result} retry={result.reload} />
      )}
      {Boolean(result.error) && (
        <p>Subscription status is unavailable. Retry before saving.</p>
      )}
      {order && (
        <div data-form-dirty={dirty}>
          <Form
            id={formId}
            guardDraft={false}
            hideActions
            onBusyChange={setBusy}
            onSave={async () => {
              const removed = original.current.filter(
                  (item) => !selected.has(item.id),
                ),
                names = removed
                  .slice(0, 8)
                  .map((item) => `“${item.name}”`)
                  .join(", "),
                other =
                  removed.length > 8
                    ? ` and ${removed.length - 8} other channels`
                    : "";
              if (
                removed.length &&
                !(await confirmAction(
                  `Remove ${names}${other} from ${profileName}? Current playback on ${removed.length === 1 ? "this channel" : "these channels"} will stop.`,
                  {
                    title: `Update ${profileName}'s lineup?`,
                    label: "Save lineup",
                  },
                ))
              )
                return false;
              await api(
                `/api/profiles/${profileId}/subscription-configuration`,
                "PUT",
                { revision, channelIds: order.map((item) => item.id) },
              );
              onSaved();
            }}
          >
            <h3>
              Available channels{" "}
              {admin && <span className="badge">Admin view</span>}
            </h3>
            <div className="bounded-checklist">
              {result.data?.items.map((item) => (
                <label className="subscription-choice" key={item.id}>
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    disabled={result.loading}
                    onChange={(event) =>
                      change(
                        event.target.checked
                          ? [...order, item]
                          : order.filter((current) => current.id !== item.id),
                      )
                    }
                  />
                  <span>
                    <strong>{item.name}</strong>
                    <small>
                      {item.shortName ?? ""} ·{" "}
                      {item.visibility === "private" ? "Private" : "Shared"}
                    </small>
                  </span>
                </label>
              ))}
              {!result.loading && result.data?.items.length === 0 && (
                <p>
                  {query
                    ? "No matching channels. Clear the search to see available choices."
                    : "No eligible channels are available."}
                </p>
              )}
            </div>
            <div className="actions">
              <button
                type="button"
                className="secondary"
                disabled={!offset || result.loading}
                onClick={() => setOffset((n) => Math.max(0, n - 50))}
              >
                Previous channels
              </button>
              <button
                type="button"
                className="secondary"
                disabled={!result.data?.hasMore || result.loading}
                onClick={() => setOffset((n) => n + 50)}
              >
                Next channels
              </button>
            </div>
            <h3>Guide order · {order.length} selected</h3>
            <div className="bounded-checklist" ref={list}>
              {order.map((item, index) => (
                <div
                  className="compact-row lineup-row"
                  key={item.id}
                  data-channel-id={item.id}
                >
                  <span>
                    {index + 1}. {item.name}
                  </span>
                  <div className="actions">
                    <button
                      type="button"
                      className="secondary"
                      aria-label={`Move ${item.name} up`}
                      disabled={index === 0}
                      onClick={() => move(item.id, -1)}
                    >
                      Up
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      aria-label={`Move ${item.name} down`}
                      disabled={index === order.length - 1}
                      onClick={() => move(item.id, 1)}
                    >
                      Down
                    </button>
                  </div>
                </div>
              ))}
              {!order.length && (
                <p>
                  No channels selected. Choose channels above to build this
                  profile’s guide.
                </p>
              )}
            </div>
            <p role="status">{message}</p>
          </Form>
        </div>
      )}
    </Modal>
  );
}
