import { useEffect, useState } from "react";
import { api } from "./api";
import type { Programming } from "./types";
import { Load } from "./ui";
export function CommercialEligibility({
  config,
  profileId,
  update,
}: {
  config: Programming;
  profileId: string;
  update: (next: Programming) => void;
}) {
  const [data, setData] = useState<{
      items: { id: string; title: string }[];
      total: number;
      hasMore: boolean;
    } | null>(null),
    [error, setError] = useState<unknown>(null),
    [offset, setOffset] = useState(0),
    [tick, setTick] = useState(0),
    selection = JSON.stringify(config.commercialSelection);
  useEffect(() => setOffset(0), [selection]);
  useEffect(() => {
    setData(null);
    setError(null);
    if (!config.commercialSelection) return;
    const controller = new AbortController();
    void api<NonNullable<typeof data>>(
      `/api/profiles/${profileId}/selection?offset=${offset}&limit=50`,
      "POST",
      config.commercialSelection,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setData(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error);
      });
    return () => controller.abort();
  }, [profileId, selection, offset, tick]);
  if (!config.commercialSelection) return null;
  const disabled = config.disabledCommercialIds ?? [];
  return (
    <section className="settings-section">
      <h3>Commercial choices</h3>
      <p>
        Uncheck a commercial to exclude it from future programming on this
        channel. Original files stay in place.
      </p>
      <Load
        loading={!data && !error}
        error={error}
        retry={() => setTick((n) => n + 1)}
      />
      {data && (
        <>
          <p>
            {data.items.filter((item) => !disabled.includes(item.id)).length}{" "}
            eligible on this page · {data.total} available in the pool
          </p>
          <div className="bounded-checklist">
            {data.items.map((item) => (
              <label className="check" key={item.id}>
                <input
                  type="checkbox"
                  checked={!disabled.includes(item.id)}
                  onChange={(event) =>
                    update({
                      ...config,
                      disabledCommercialIds: event.target.checked
                        ? disabled.filter((id) => id !== item.id)
                        : [...disabled, item.id],
                    })
                  }
                />
                {item.title}
              </label>
            ))}
          </div>
          <div className="actions">
            <button
              type="button"
              className="secondary"
              disabled={!offset}
              onClick={() => setOffset((n) => Math.max(0, n - 50))}
            >
              Previous commercials
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!data.hasMore}
              onClick={() => setOffset((n) => n + 50)}
            >
              Next commercials
            </button>
          </div>
        </>
      )}
    </section>
  );
}
