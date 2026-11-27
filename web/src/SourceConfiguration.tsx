import { PathMappings } from "./PathMappings";
import { useDraftNavigation } from "./navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { Source } from "./types";
import { api, ApiError } from "./api";
import { SourcePathField } from "./SourcePathField";
import { Info } from "./Info";
import {
  Field,
  Form,
  Load,
  Modal,
  ModalCancel,
  Select,
  ErrorBox,
  useRemote,
  SettingsRecovery,
  submissionErrorMessage,
} from "./ui";
export type IntegrationDraft = {
  provider: "sonarr" | "radarr";
  url: string;
  hasApiKey?: boolean;
  apiKey?: string;
  reuseSourceId?: string;
  mappings: { from: string; to: string }[];
};
type Configuration = {
  revision: string;
  subtitles: {
    enabled: boolean;
    root: string | null;
    subdirectories: string[];
    maxDepth: number;
  };
  metadataRoot: string | null;
  integration: IntegrationDraft | null;
  intervalMs: number | null;
};
export function SourceConfiguration({
  source,
  onClose,
  onSaved,
}: {
  source: Source;
  onClose: () => void;
  onSaved: () => void;
}) {
  const id = useId(),
    remote = useRemote<Configuration>(
      `/api/sources/${source.id}/configuration`,
    ),
    [draft, setDraft] = useState<Configuration | null>(null),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [subtitleBaseline, setSubtitleBaseline] = useState(""),
    [recoveryVersion, setRecoveryVersion] = useState(0);
  useEffect(() => {
    if (remote.data && !draft) {
      setDraft(remote.data);
      setSubtitleBaseline(JSON.stringify(remote.data.subtitles));
    }
  }, [remote.data, draft]);
  useEffect(() => {
    if (
      remote.error instanceof ApiError &&
      [401, 403, 404].includes(remote.error.status)
    ) {
      setDraft(null);
      setDirty(false);
    }
  }, [remote.error]);
  useDraftNavigation(dirty || busy);
  const change = (patch: Partial<Configuration>) => {
    setDraft((old) => (old ? { ...old, ...patch } : null));
    setDirty(true);
  };
  const subtitle = (patch: Partial<Configuration["subtitles"]>) =>
    draft && change({ subtitles: { ...draft.subtitles, ...patch } });
  return (
    <Modal
      title={`Configure ${source.name}`}
      onClose={onClose}
      closeDisabled={busy}
      footer={
        <div className="actions">
          <button form={id} type="submit" disabled={busy || !draft}>
            Save configuration
          </button>
          <ModalCancel />
        </div>
      }
    >
      <Load {...remote} retry={remote.reload} />
      {draft && (
        <div data-form-dirty={dirty}>
          <Form
            key={`${draft.revision}:${recoveryVersion}`}
            id={id}
            guardDraft={false}
            hideActions
            onBusyChange={setBusy}
            renderError={(error) => (
              <>
                {submissionErrorMessage(error)}
                <SettingsRecovery
                  error={error}
                  load={() =>
                    api<Configuration>(
                      `/api/sources/${source.id}/configuration`,
                    )
                  }
                  apply={(latest) => {
                    setDraft(latest);
                    setSubtitleBaseline(JSON.stringify(latest.subtitles));
                    setDirty(false);
                    setRecoveryVersion((version) => version + 1);
                  }}
                  describe={(latest) => (
                    <>
                      <p>
                        Subtitles:{" "}
                        {latest.subtitles.enabled ? "Enabled" : "Disabled"} ·{" "}
                        {latest.subtitles.root ?? "Beside videos"} · Folders:{" "}
                        {latest.subtitles.subdirectories.join(", ") || "None"} ·{" "}
                        {latest.subtitles.maxDepth} subfolder levels
                      </p>
                      <p>
                        Metadata directory:{" "}
                        {latest.metadataRoot ?? "Beside videos"}. Connection:{" "}
                        {latest.integration
                          ? `${latest.integration.provider} · ${latest.integration.url}`
                          : "None"}
                        . Scan schedule:{" "}
                        {latest.intervalMs === null
                          ? "Manual"
                          : `${latest.intervalMs / 60000} minutes`}
                        .
                      </p>
                    </>
                  )}
                />
              </>
            )}
            onSave={async () => {
              const integration = draft.integration
                ? { ...draft.integration }
                : null;
              if (integration) {
                delete integration.hasApiKey;
                if (!integration.apiKey) delete integration.apiKey;
                if (!integration.reuseSourceId)
                  delete integration.reuseSourceId;
              }
              await api(`/api/sources/${source.id}/configuration`, "PUT", {
                ...draft,
                integration,
              });
              onSaved();
            }}
          >
            <section className="settings-section">
              <h3>
                Subtitles{" "}
                <Info title="Finding captions">
                  Scans match captions beside each video and in the named
                  subtitle folders below. A separate root mirrors each video’s
                  relative directory; arbitrary folders elsewhere in that root
                  are not searched. The subfolder limit applies inside named
                  subtitle folders. Media files stay read-only.
                </Info>
              </h3>
              {subtitleBaseline &&
                JSON.stringify({
                  ...draft.subtitles,
                  root: draft.subtitles.root?.trim() || null,
                }) !== subtitleBaseline && (
                  <p className="notice" role="status">
                    Saving changed subtitle search settings clears manual
                    subtitle associations for this source. Scan again, then
                    review and reassociate any custom caption choices. Original
                    caption files are kept.
                  </p>
                )}
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.subtitles.enabled}
                  onChange={(event) =>
                    subtitle({ enabled: event.target.checked })
                  }
                />
                Find subtitles during scans
              </label>
              <SourcePathField
                label="Separate subtitle directory (optional)"
                purpose="subtitles"
                sourceId={source.id}
                value={draft.subtitles.root ?? ""}
                onChange={(value) => subtitle({ root: value || null })}
                placeholder="Beside videos"
              />
              <FolderNames
                folders={draft.subtitles.subdirectories}
                onChange={(subdirectories) => subtitle({ subdirectories })}
              />
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.subtitles.maxDepth > 0}
                  onChange={(event) =>
                    subtitle({ maxDepth: event.target.checked ? 2 : 0 })
                  }
                />
                Include subfolders inside subtitle folders
              </label>
              <details>
                <summary>Advanced subtitle limits</summary>
                <Select
                  label="Maximum subfolder levels"
                  value={draft.subtitles.maxDepth}
                  onChange={(event) =>
                    subtitle({ maxDepth: Number(event.target.value) })
                  }
                >
                  {[0, 1, 2, 3, 4].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
                <p>
                  Discovery also stops at 100 folders and 2,000 entries per
                  folder to protect disk performance.
                </p>
              </details>
            </section>
            <section className="settings-section">
              <h3>
                Metadata files{" "}
                <Info title="Local descriptions and titles">
                  Read NFO files beside videos or in a matching directory
                  structure here. Library item editors let you choose imported
                  metadata, local files or manual text.
                </Info>
              </h3>
              <SourcePathField
                label="Separate metadata directory (optional)"
                purpose="metadata"
                sourceId={source.id}
                value={draft.metadataRoot ?? ""}
                onChange={(value) => change({ metadataRoot: value || null })}
                placeholder="Beside videos"
              />
            </section>
            {["shows", "movies"].includes(source.kind) && (
              <section className="settings-section">
                <h3>
                  {source.kind === "shows" ? "Sonarr" : "Radarr"} metadata
                </h3>
                {draft.integration ? (
                  <>
                    <IntegrationFields
                      source={source}
                      value={draft.integration}
                      onChange={(integration) => change({ integration })}
                    />
                    <button
                      type="button"
                      className="secondary danger"
                      onClick={() => change({ integration: null })}
                    >
                      Disconnect on save
                    </button>
                  </>
                ) : (
                  <>
                    <p>
                      No metadata application connected. Files can still be
                      scanned and played.
                    </p>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        change({
                          integration: {
                            provider:
                              source.kind === "shows" ? "sonarr" : "radarr",
                            url: "",
                            mappings: [{ from: "", to: source.rootPath ?? "" }],
                          },
                        })
                      }
                    >
                      Connect {source.kind === "shows" ? "Sonarr" : "Radarr"}
                    </button>
                    {remote.data?.integration && (
                      <p role="status">
                        Disconnection is staged. Cancel keeps the saved
                        connection.
                      </p>
                    )}
                  </>
                )}
              </section>
            )}
            <section className="settings-section">
              <h3>Automatic scan and refresh</h3>
              <Select
                label="Scan schedule"
                value={draft.intervalMs === null ? "manual" : "automatic"}
                onChange={(event) =>
                  change({
                    intervalMs:
                      event.target.value === "manual" ? null : 6 * 60 * 60_000,
                  })
                }
              >
                <option value="manual">Manual only</option>
                <option value="automatic">At a regular interval</option>
              </Select>
              {draft.intervalMs !== null && (
                <Field
                  label="Interval in minutes"
                  type="number"
                  min={1}
                  max={10080}
                  required
                  value={draft.intervalMs / 60_000}
                  onChange={(event) =>
                    change({ intervalMs: Number(event.target.value) * 60_000 })
                  }
                />
              )}
              <p>
                Unchanged videos reuse saved inspection results. Scans still
                read directory listings to find changes.
              </p>
            </section>
          </Form>
        </div>
      )}
    </Modal>
  );
}
type RootState = {
  roots: {
    path: string;
    itemCount: number;
    origin: string;
    samples: string[];
  }[];
  revision: string;
  sourceRevision: string;
  configRevision: string;
  stale: boolean;
  error: string | null;
  observedAt: number | null;
  inventoryAvailable: boolean;
};
function IntegrationFields({
  source,
  value,
  onChange,
}: {
  source: Source;
  value: IntegrationDraft;
  onChange: (value: IntegrationDraft) => void;
}) {
  const connections = useRemote<
      { sourceId: string; name: string; provider: string; url: string }[]
    >("/api/admin/setup/provider-connections"),
    remote = useRemote<RootState>(
      `/api/sources/${source.id}/provider-suggestions`,
    ),
    [roots, setRoots] = useState<RootState | null>(null),
    [preview, setPreview] = useState<
      | { upstreamPath: string; mappedPath: string | null; state: string }[]
      | null
    >(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const serial = useRef(0),
    controller = useRef(new AbortController()),
    previous = useRef("");
  const savedAddress = useRef(value.url),
    savedKeyApplies = Boolean(
      value.hasApiKey && value.url === savedAddress.current,
    );
  const signature = JSON.stringify(value);
  if (previous.current !== signature) {
    previous.current = signature;
    serial.current++;
    controller.current.abort();
    controller.current = new AbortController();
  }
  useEffect(() => {
    setRoots(null);
    setPreview(null);
    setError(null);
    setBusy(false);
  }, [signature]);
  useEffect(() => {
    controller.current = new AbortController();
    return () => {
      serial.current++;
      controller.current.abort();
    };
  }, []);
  const request = async (kind: "refresh" | "mapping-preview") => {
    const current = ++serial.current;
    setBusy(true);
    setError(null);
    try {
      const connection = {
        provider: value.provider,
        url: value.url,
        ...(value.apiKey
          ? { apiKey: value.apiKey }
          : value.reuseSourceId
            ? { reuseSourceId: value.reuseSourceId }
            : {}),
      };
      if (kind === "refresh") {
        const next = await api<RootState>(
          `/api/sources/${source.id}/provider-suggestions/refresh`,
          "POST",
          { ...connection, configRevision: remote.data?.configRevision },
          controller.current.signal,
        );
        if (current === serial.current) setRoots(next);
      } else {
        const state = roots ?? remote.data;
        if (!state)
          throw new Error(
            "Load application folder suggestions before checking mappings.",
          );
        const next = await api<{ items: NonNullable<typeof preview> }>(
          `/api/sources/${source.id}/provider-suggestions/mapping-preview`,
          "POST",
          {
            ...connection,
            mappings: value.mappings,
            sourceRevision: state.sourceRevision,
            configRevision: state.configRevision,
            inventoryRevision: state.revision,
          },
          controller.current.signal,
        );
        if (current === serial.current) setPreview(next.items);
      }
    } catch (error) {
      if (current === serial.current && !controller.current.signal.aborted)
        setError(error);
    } finally {
      if (current === serial.current) setBusy(false);
    }
  };
  const change = (patch: Partial<IntegrationDraft>) =>
    onChange({ ...value, ...patch });
  return (
    <>
      <Load {...connections} retry={connections.reload} />
      <Select
        label="Use a saved connection"
        value={value.reuseSourceId ?? ""}
        onChange={(event) => {
          const selected = connections.data?.find(
            (item) => item.sourceId === event.target.value,
          );
          change({
            reuseSourceId: selected?.sourceId ?? "",
            url: selected?.url ?? value.url,
            apiKey: "",
          });
        }}
      >
        <option value="">Enter connection details</option>
        {connections.data
          ?.filter(
            (item) =>
              item.provider === value.provider && item.sourceId !== source.id,
          )
          .map((item) => (
            <option key={item.sourceId} value={item.sourceId}>
              {item.name} · {item.url}
            </option>
          ))}
      </Select>
      <Field
        label={`${value.provider === "sonarr" ? "Sonarr" : "Radarr"} address`}
        type="url"
        required
        value={value.url}
        onChange={(event) =>
          change({ url: event.target.value, reuseSourceId: "" })
        }
        placeholder="http://192.168.1.10:8989"
      />
      <Field
        label="API key"
        type="password"
        autoComplete="new-password"
        value={value.apiKey ?? ""}
        onChange={(event) =>
          change({ apiKey: event.target.value, reuseSourceId: "" })
        }
        placeholder={savedKeyApplies ? "•••••••• · saved key" : "Enter API key"}
        required={!savedKeyApplies && !value.reuseSourceId}
        hint={
          savedKeyApplies
            ? "A key is saved. Leave blank to keep it at the same address."
            : value.reuseSourceId
              ? "Uses the selected saved connection’s key."
              : "Required for a new application address."
        }
      />
      <h4>
        Path mappings{" "}
        <Info title="Two applications, two paths">
          The left path is what Sonarr or Radarr sees. The right path is the
          same directory inside MyTuner. New right-hand paths are checked when
          you save.
        </Info>
      </h4>
      <PathMappings
        rows={value.mappings}
        sourceId={source.id}
        defaultPath={source.rootPath ?? ""}
        onChange={(mappings) => change({ mappings })}
      />
      <div className="actions">
        <button
          type="button"
          className="secondary"
          disabled={busy || !value.url || !remote.data}
          onClick={() => void request("refresh")}
        >
          {busy ? "Checking…" : "Get application folders"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={busy || !value.url || !remote.data}
          onClick={() => void request("mapping-preview")}
        >
          Check sample mappings
        </button>
      </div>
      <ErrorBox error={error} />
      {roots && (
        <div className="notice">
          <p>
            {roots.error ??
              `${roots.roots.length} application folders available.`}
          </p>
          {roots.roots.map((root) => (
            <div className="compact-row" key={root.path}>
              <code>{root.path}</code>
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  change({
                    mappings: [
                      ...value.mappings.filter(
                        (row) => row.from !== "" && row.from !== root.path,
                      ),
                      { from: root.path, to: source.rootPath ?? "" },
                    ],
                  })
                }
              >
                Use folder mapping
              </button>
            </div>
          ))}
        </div>
      )}
      {preview && (
        <div className="bounded-checklist">
          {preview.map((row, index) => (
            <p key={index}>
              <code>{row.upstreamPath}</code> →{" "}
              <code>{row.mappedPath ?? "No match"}</code> ·{" "}
              {row.state.replaceAll("-", " ")}
            </p>
          ))}
        </div>
      )}
    </>
  );
}

function FolderNames({
  folders,
  onChange,
}: {
  folders: string[];
  onChange: (folders: string[]) => void;
}) {
  const [text, setText] = useState(folders.join(", "));
  return (
    <Field
      label="Subtitle folder names"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(
          event.target.value
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        );
      }}
      hint="For example: Subs, Subtitles. These folders are checked beside each video."
    />
  );
}
