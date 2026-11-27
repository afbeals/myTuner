import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import type { Source } from "./types";

export type SourceInspection = {
  sourceId: string;
  lastAttemptMs: number | null;
  lastCompletedMs: number | null;
  lastSuccessMs: number | null;
  status: "never" | "checking" | "current" | "incomplete";
};
type Scope = {
  profileId: string;
  sourceIds: string[];
  version?: number;
  identity?: string;
};
const cache = new Map<string, SourceInspection[]>();
const pending = new Map<string, Promise<SourceInspection[]>>();
const listeners = new Set<(scope: string) => void>();
function readBatch(key: string, profileId: string, ids: string[]) {
  const cached = cache.get(key);
  if (cached) return Promise.resolve(cached);
  const running = pending.get(key);
  if (running) return running;
  const request = api<{ items: SourceInspection[] }>(
    `/api/profiles/${profileId}/source-inspections?${new URLSearchParams({ ids: ids.join(",") })}`,
  )
    .then(({ items }) => {
      if (
        !Array.isArray(items) ||
        items.some(
          (item) =>
            !item ||
            typeof item.sourceId !== "string" ||
            !["never", "checking", "current", "incomplete"].includes(
              item.status,
            ),
        )
      )
        throw new Error(
          "Source check history returned an unreadable response.",
        );
      if (cache.size >= 24) cache.delete(cache.keys().next().value!);
      cache.set(key, items);
      return items;
    })
    .catch((error) => {
      if (error instanceof ApiError && [401, 403, 404].includes(error.status))
        cache.clear();
      throw error;
    })
    .finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
/** Cached catalog history only: this never reads or probes source files. */
export function useSourceInspections({
  profileId,
  sourceIds,
  version = 0,
  identity = "session",
}: Scope) {
  const ids = [...new Set(sourceIds)].sort();
  const scope = `${identity}:${profileId}:${version}`;
  const key = `${scope}:${ids.join(",")}`;
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const listener = (changed: string) => {
      if (changed === scope) setRetry((n) => n + 1);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, [scope]);
  const [state, setState] = useState<{
    key: string;
    items: SourceInspection[];
    loading: boolean;
    error: unknown;
  }>({ key: "", items: [], loading: true, error: null });
  useEffect(() => {
    let active = true;
    setState({ key, items: [], loading: Boolean(ids.length), error: null });
    const batches: Promise<SourceInspection[]>[] = [];
    for (let offset = 0; offset < ids.length; offset += 100) {
      const batch = ids.slice(offset, offset + 100);
      batches.push(readBatch(`${scope}:${batch.join(",")}`, profileId, batch));
    }
    void Promise.all(batches).then(
      (values) => {
        if (active)
          setState({ key, items: values.flat(), loading: false, error: null });
      },
      (error) => {
        if (active) setState({ key, items: [], loading: false, error });
      },
    );
    return () => {
      active = false;
    };
  }, [key, retry]);
  return {
    items: state.key === key ? state.items : [],
    loading: state.key !== key || state.loading,
    error: state.key === key ? state.error : null,
    reload: () => {
      for (const cachedKey of cache.keys())
        if (cachedKey.startsWith(`${scope}:`)) cache.delete(cachedKey);
      listeners.forEach((listener) => listener(scope));
    },
  };
}
export function sourceAvailability(
  available: boolean,
  inspection?: SourceInspection,
) {
  if (!available) return "Unavailable · retained reference";
  return inspection?.status === "incomplete"
    ? "Last known available — source could not be checked"
    : inspection?.status === "checking"
      ? "Last known available — source check in progress"
      : "Available in last scan";
}
export function SourceInspectionNotice(props: Scope & { sources?: Source[] }) {
  const history = useSourceInspections(props);
  const affected = history.items.filter((item) => item.status !== "current");
  if (history.error)
    return (
      <p className="notice" role="status">
        Source check history could not be loaded. Availability uses the last
        catalog scan.{" "}
        <button type="button" className="text-button" onClick={history.reload}>
          Retry source history
        </button>
      </p>
    );
  if (!affected.length) return null;
  return (
    <aside className="notice" aria-label="Source check history">
      {affected.map((item) => (
        <p key={item.sourceId}>
          <strong>
            {props.sources?.find((source) => source.id === item.sourceId)
              ?.name ?? "Selected source"}
          </strong>
          {" · "}
          {item.status === "incomplete"
            ? "Source could not be completely checked. Availability is retained from the last catalog scan."
            : item.status === "checking"
              ? "Source check in progress. Availability is retained from the last catalog scan."
              : "This source has not completed a scan."}
          {item.lastSuccessMs
            ? ` Last successful scan: ${new Date(item.lastSuccessMs).toLocaleString()}.`
            : " No successful scan recorded."}
        </p>
      ))}
      <a href="#sources">Review sources and scan again</a>
    </aside>
  );
}
