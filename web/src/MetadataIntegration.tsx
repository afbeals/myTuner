import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import {
  ErrorBox,
  Field,
  Form,
  Load,
  Select,
  useMarkFormDirty,
  useRemote,
} from "./ui";
import type { Source } from "./types";

export interface IntegrationSettings {
  provider: string;
  url: string;
  hasApiKey?: boolean;
  mappings: { from: string; to: string }[];
}
interface RootState {
  roots: {
    path: string;
    itemCount: number;
    origin: string;
    samples: string[];
  }[];
  observedAt: number | null;
  lastAttemptAt: number | null;
  error: string | null;
  stale: boolean;
  revision: string;
  sourceRevision: string;
  configRevision: string;
  inventoryAvailable: boolean;
}
interface Preview {
  items: { upstreamPath: string; mappedPath: string | null; state: string }[];
  sampled: number;
  cachedFileCount: number | null;
  complete: boolean;
  needsFileInventory: boolean;
}
function parseMappings(text: string) {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      const parts = line.split("=>");
      if (parts.length !== 2 || !parts[0]!.trim() || !parts[1]!.trim())
        throw new Error("Use one provider path => container path per line.");
      return { from: parts[0]!.trim(), to: parts[1]!.trim() };
    });
}
export function MetadataIntegration({
  source,
  initial,
  onSaved,
}: {
  source: Source;
  initial: IntegrationSettings | null;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState(initial?.url ?? ""),
    [key, setKey] = useState("");
  const [mappings, setMappings] = useState(
    initial?.mappings.map((row) => `${row.from} => ${row.to}`).join("\n") ?? "",
  );
  const [reuse, setReuse] = useState("");
  const connections = useRemote<
    { sourceId: string; name: string; provider: string; url: string }[]
  >("/api/admin/setup/provider-connections");
  const [picker, setPicker] = useState(false),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(source.rootPath ?? "");
  const [local, setLocal] = useState<{
    signature: string;
    state: RootState;
  } | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const remote = useRemote<RootState>(
    `/api/sources/${source.id}/provider-suggestions`,
  );
  const controller = useRef(new AbortController()),
    epoch = useRef(0);
  useEffect(() => () => controller.current.abort(), []);
  const signature = JSON.stringify([url, key, reuse]);
  const savedDestination = url === (initial?.url ?? "") && !key && !reuse;
  const suggestions =
    local?.signature === signature
      ? local.state
      : savedDestination
        ? remote.data
        : null;
  const changeConnection = (change: () => void) => {
    controller.current.abort();
    controller.current = new AbortController();
    epoch.current++;
    setBusy(false);
    setPreview(null);
    setError(null);
    setLocal(null);
    change();
  };
  const connection = {
    provider: source.kind === "shows" ? "sonarr" : "radarr",
    url,
    ...(key ? { apiKey: key } : reuse ? { reuseSourceId: reuse } : {}),
  };
  const request = async (kind: "refresh" | "mapping-preview") => {
    if (!remote.data) return;
    const ticket = ++epoch.current;
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      if (kind === "refresh") {
        const state = await api<RootState>(
          `/api/sources/${source.id}/provider-suggestions/refresh`,
          "POST",
          { ...connection, configRevision: remote.data.configRevision },
          controller.current.signal,
        );
        if (ticket === epoch.current) setLocal({ signature, state });
      } else {
        if (!suggestions?.revision)
          throw new Error(
            "Refresh provider suggestions before previewing this connection.",
          );
        const result = await api<Preview>(
          `/api/sources/${source.id}/provider-suggestions/mapping-preview`,
          "POST",
          {
            ...connection,
            mappings: parseMappings(mappings),
            sourceRevision: suggestions.sourceRevision,
            configRevision: suggestions.configRevision,
            inventoryRevision: suggestions.revision,
          },
          controller.current.signal,
        );
        if (ticket === epoch.current) setPreview(result);
      }
    } catch (failure) {
      if (ticket === epoch.current && !controller.current.signal.aborted)
        setError(failure);
    } finally {
      if (ticket === epoch.current) setBusy(false);
    }
  };
  return (
    <Form
      submit="Save metadata integration"
      onSave={async () => {
        await api(`/api/sources/${source.id}/integration`, "PUT", {
          ...connection,
          mappings: parseMappings(mappings),
        });
        setKey("");
        setReuse("");
        onSaved();
        remote.reload();
      }}
    >
      <h3>{source.kind === "shows" ? "Sonarr" : "Radarr"} metadata</h3>
      {connections.data?.some(
        (saved) =>
          saved.provider === connection.provider &&
          saved.sourceId !== source.id,
      ) && (
        <Select
          label="Copy a saved provider connection"
          value={reuse}
          onChange={(event) => {
            const selected = connections.data?.find(
              (saved) => saved.sourceId === event.target.value,
            );
            changeConnection(() => {
              setReuse(selected?.sourceId ?? "");
              if (selected) {
                setUrl(selected.url);
                setKey("");
              }
            });
          }}
        >
          <option value="">Enter connection details below</option>
          {connections.data
            .filter(
              (saved) =>
                saved.provider === connection.provider &&
                saved.sourceId !== source.id,
            )
            .map((saved) => (
              <option key={saved.sourceId} value={saved.sourceId}>
                {saved.name} · {saved.url}
              </option>
            ))}
        </Select>
      )}
      {reuse && (
        <p>
          The saved key is reused on the server. Each source retains its own
          connection settings after saving.
        </p>
      )}
      <Field
        label="Application URL"
        name="url"
        type="url"
        value={url}
        onChange={(event) =>
          changeConnection(() => {
            setUrl(event.target.value);
            setReuse("");
          })
        }
        required
        placeholder={
          source.kind === "shows"
            ? "http://192.168.1.10:8989"
            : "http://192.168.1.10:7878"
        }
      />
      <Field
        label="API key"
        name="key"
        value={key}
        onChange={(event) =>
          changeConnection(() => {
            setKey(event.target.value);
            setReuse("");
          })
        }
        type="password"
        required={!initial && !reuse}
        placeholder={initial ? "******** (saved)" : "Enter API key"}
        autoComplete="new-password"
        hint={
          initial
            ? "API key saved securely. Leave blank to keep it. A changed application URL requires a key."
            : "Saved encrypted on the server; never returned to the browser."
        }
      />
      <section
        className="directory-choices"
        aria-label="Provider root suggestions"
      >
        <p>
          Suggestions use cached provider information. Refresh reads the
          provider inventory without scanning this source.
        </p>
        <Load {...remote} retry={remote.reload} />
        {suggestions?.observedAt && (
          <p>
            Observed {new Date(suggestions.observedAt).toLocaleString()}
            {suggestions.stale ? " · may be out of date" : ""}. These paths may
            be provider-inferred parents.
          </p>
        )}
        {suggestions?.error && <p role="status">{suggestions.error}</p>}
        {!suggestions?.roots.length && (
          <p>
            No cached root choices for this connection. Refresh suggestions or
            enter paths manually.
          </p>
        )}
        <button
          type="button"
          className="secondary"
          disabled={
            busy || remote.loading || !url || (!key && !initial && !reuse)
          }
          onClick={() => void request("refresh")}
        >
          {busy ? "Checking…" : "Refresh provider suggestions"}
        </button>
      </section>
      <button
        type="button"
        className="secondary"
        aria-pressed={picker}
        onClick={() => setPicker((old) => !old)}
      >
        {picker ? "Hide mapping root chooser" : "Choose mapping roots"}
      </button>
      {picker && (
        <MappingChooser
          roots={suggestions?.roots ?? []}
          from={from}
          to={to}
          setFrom={setFrom}
          setTo={setTo}
          sourceRoot={source.rootPath ?? ""}
          onAdd={() => {
            if (!from.trim() || !to.trim())
              throw new Error("Choose both mapping paths.");
            setMappings((old) =>
              [
                ...old.split("\n").filter(Boolean),
                `${from.trim()} => ${to.trim()}`,
              ].join("\n"),
            );
            setPreview(null);
          }}
        />
      )}
      <label className="field">
        <span>Path mappings</span>
        <textarea
          name="mappings"
          required
          value={mappings}
          onChange={(event) => {
            setMappings(event.target.value);
            setPreview(null);
          }}
          placeholder="/tv => /media/shows"
        />
      </label>
      <p>
        One provider path =&gt; container path per line. The root chooser adds a
        row here; manual mappings remain editable. Metadata access is read-only.
      </p>
      <button
        type="button"
        className="secondary"
        disabled={busy || !suggestions?.revision || !mappings.trim()}
        onClick={() => void request("mapping-preview")}
      >
        Preview mapping against catalog
      </button>
      <ErrorBox error={error} />
      {preview && (
        <section
          className="directory-choices"
          aria-label="Mapping preview"
          role="status"
        >
          {preview.needsFileInventory ? (
            <p>
              No cached file inventory for this connection. The next explicit
              source scan can populate it; opening this form does not scan
              files.
            </p>
          ) : (
            <p>
              Checked {preview.sampled} cached file samples
              {preview.cachedFileCount !== null
                ? ` of ${preview.cachedFileCount}`
                : ""}
              .{" "}
              {preview.complete
                ? "Complete cached inventory."
                : "Sample only; no filesystem check."}
            </p>
          )}
          <ul>
            {preview.items.map((item, index) => (
              <li key={index}>
                {item.upstreamPath} → {item.mappedPath ?? "No mapping"} ·{" "}
                {item.state}
              </li>
            ))}
          </ul>
        </section>
      )}
      <button
        type="button"
        className="secondary danger"
        onClick={async () => {
          if (
            !window.confirm(
              "Remove this metadata integration? Imported metadata will remain.",
            )
          )
            return;
          try {
            await api(`/api/sources/${source.id}/integration`, "DELETE");
            onSaved();
          } catch (failure) {
            setError(failure);
          }
        }}
      >
        Disconnect integration
      </button>
    </Form>
  );
}
function MappingChooser({
  roots,
  from,
  to,
  setFrom,
  setTo,
  sourceRoot,
  onAdd,
}: {
  roots: RootState["roots"];
  from: string;
  to: string;
  setFrom: (value: string) => void;
  setTo: (value: string) => void;
  sourceRoot: string;
  onAdd: () => void;
}) {
  const markDirty = useMarkFormDirty();
  return (
    <fieldset className="directory-choices">
      <legend>Add a mapping</legend>
      <Select
        label="Observed provider root"
        value={roots.some((root) => root.path === from) ? from : ""}
        onChange={(event) => setFrom(event.target.value)}
      >
        <option value="">Choose a cached root or type below</option>
        {roots.map((root) => (
          <option key={root.path} value={root.path}>
            {root.path} · {root.itemCount} items
          </option>
        ))}
      </Select>
      <Field
        label="Provider root path"
        value={from}
        onChange={(event) => setFrom(event.target.value)}
        placeholder="/tv"
      />
      <Field
        label="Mapped source directory"
        value={to}
        onChange={(event) => setTo(event.target.value)}
        hint={`This source is ${sourceRoot}. Mapping preview uses the last scanned catalog.`}
      />
      <button
        type="button"
        className="secondary"
        disabled={!from.trim() || !to.trim()}
        onClick={() => {
          onAdd();
          markDirty();
        }}
      >
        Add mapping row
      </button>
    </fieldset>
  );
}
