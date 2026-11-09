import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import { ErrorBox, Field, Form, Load, Select, useRemote } from "./ui";
import { useDraftNavigation } from "./navigation";

interface Settings {
  enabled: boolean;
  root: string | null;
  subdirectories: string[];
  maxDepth: number;
  revision: number;
}
interface Track {
  index: number;
  origin: string;
  format: string;
  language: string | null;
  forced: boolean;
  sdh: boolean;
  manual: boolean;
  status: string;
  rootKind?: string;
  relativePath?: string;
}
interface Info {
  revision?: string;
  checkedMs: number | null;
  lastSuccessMs: number | null;
  error: string | null;
  automatic: boolean;
  tracks: Track[];
}
interface Manual {
  rootKind: "media" | "subtitles";
  relativePath: string;
}
interface Preview {
  fingerprint: string;
  format: string;
  size: number;
  supported: boolean;
}

export function SubtitleSettings({
  sourceId,
  onSaved,
  onDirtyChange,
}: {
  sourceId: string;
  onSaved: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const remote = useRemote<Settings>(`/api/sources/${sourceId}/subtitles`);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [baseline, setBaseline] = useState("");
  const [folders, setFolders] = useState("");
  const active = useRef(true);
  const controller = useRef(new AbortController());
  useEffect(() => {
    if (remote.data && !draft) {
      setDraft(remote.data);
      setFolders(remote.data.subdirectories.join(", "));
      setBaseline(JSON.stringify(remote.data));
    }
  }, [remote.data, draft]);
  useEffect(() => {
    active.current = true;
    controller.current = new AbortController();
    return () => {
      active.current = false;
      controller.current.abort();
    };
  }, []);
  const dirty =
    draft !== null &&
    (JSON.stringify(draft) !== baseline ||
      folders !== JSON.parse(baseline || "{}").subdirectories?.join(", "));
  useDraftNavigation(
    dirty || busy,
    "Discard unsaved subtitle settings? A save received by the server may still finish.",
  );
  useEffect(() => {
    onDirtyChange(dirty || busy);
    return () => onDirtyChange(false);
  }, [dirty, busy, onDirtyChange]);
  const change = (patch: Partial<Settings>) => {
    setDraft((old) => old && { ...old, ...patch });
    setSaved(false);
  };
  return (
    <section aria-label="Subtitle search settings">
      <h3>Subtitle search locations</h3>
      <p>
        Find matching text captions beside videos, in subtitle folders or a
        separate read-only root. These settings are separate from NFO
        information.
      </p>
      <Load {...remote} retry={remote.reload} />
      {draft && (
        <Form
          guardDraft={false}
          submit="Save subtitle settings"
          disabled={busy}
          onCancel={() => {
            setDraft(JSON.parse(baseline));
            setFolders(JSON.parse(baseline).subdirectories.join(", "));
            setSaved(false);
          }}
          onSave={async () => {
            setBusy(true);
            try {
              const next = await api<Settings>(
                `/api/sources/${sourceId}/subtitles`,
                "PUT",
                {
                  ...draft,
                  subdirectories: folders
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                },
                controller.current.signal,
              );
              if (!active.current) return;
              setDraft(next);
              setFolders(next.subdirectories.join(", "));
              setBaseline(JSON.stringify(next));
              setSaved(true);
              onSaved();
            } finally {
              if (active.current) setBusy(false);
            }
          }}
        >
          <label className="check">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(e) => change({ enabled: e.target.checked })}
            />
            Automatically discover subtitles during scans
          </label>
          <Field
            label="Separate subtitle root (optional)"
            value={draft.root ?? ""}
            onChange={(e) => change({ root: e.target.value || null })}
            placeholder="/subtitles/shows"
            hint="Existing server/container directory mounted read-only. Relative media directories are mirrored below this root."
          />
          <Field
            label="Subtitle subdirectories"
            value={folders}
            onChange={(e) => {
              setFolders(e.target.value);
              setSaved(false);
            }}
            hint="Comma-separated relative folders, such as Subs, Subtitles or Captions/English. Video basenames must match; ambiguous files need a manual choice."
          />
          <Select
            label="Nested subtitle folder depth"
            value={draft.maxDepth}
            onChange={(e) => change({ maxDepth: Number(e.target.value) })}
          >
            {[0, 1, 2, 3, 4].map((n) => (
              <option value={n} key={n}>
                {n}
              </option>
            ))}
          </Select>
          <p>
            After saving, scan the source or use Check / Rescan subtitles in
            Video details. Previous results need rechecking after location
            settings change.
          </p>
        </Form>
      )}
      {saved && (
        <p role="status">
          Subtitle settings saved. Check the source to refresh discoveries.
        </p>
      )}
    </section>
  );
}

export function SubtitlePanel({
  profileId,
  mediaId,
  admin,
  onDirtyChange,
}: {
  profileId: string;
  mediaId: string;
  admin: boolean;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const path = `/api/profiles/${profileId}/media/${mediaId}/subtitles`;
  const remote = useRemote<Info>(path);
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<Manual>({
    rootKind: "media",
    relativePath: "",
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [saved, setSaved] = useState(false);
  const active = useRef(true);
  const controller = useRef(new AbortController());
  useEffect(() => {
    if (remote.data) setInfo(remote.data);
  }, [remote.data]);
  useEffect(() => {
    active.current = true;
    controller.current = new AbortController();
    return () => {
      active.current = false;
      controller.current.abort();
    };
  }, []);
  const dirty = Boolean(manual.relativePath);
  useDraftNavigation(
    dirty || busy,
    "Discard this subtitle association draft? A save received by the server may still finish.",
  );
  useEffect(() => {
    onDirtyChange(dirty || busy);
    return () => onDirtyChange(false);
  }, [dirty, busy, onDirtyChange]);
  const request = async (
    action: "check" | "preview",
    body: unknown,
    apply: (result: unknown) => void,
  ) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await api(
        `${path}/${action}`,
        "POST",
        body,
        controller.current.signal,
      );
      if (active.current) apply(result);
    } catch (e) {
      if (active.current) setError(e);
    } finally {
      if (active.current) setBusy(false);
    }
  };
  const edit = (next: Manual) => {
    setManual(next);
    setPreview(null);
    setSaved(false);
  };
  return (
    <section aria-label="Discovered subtitles">
      <h3>Subtitle discovery</h3>
      <p>
        Embedded tracks appear in Stored technical metadata. External text files
        use the same browser and TV subtitle menu.
      </p>
      <Load {...remote} retry={remote.reload} />
      <ErrorBox error={error} />
      {info && (
        <>
          <p>
            {info.checkedMs === null
              ? "Not checked"
              : `Last check: ${new Date(info.checkedMs).toLocaleString()}`}
            {!info.automatic && " · Automatic discovery disabled"}
          </p>
          {info.error && (
            <p className="notice" role="status">
              {info.error} Last successful results are retained.
            </p>
          )}
          {!info.tracks.length && (
            <p>
              {info.lastSuccessMs
                ? "No external subtitle matches found."
                : "No external subtitles recorded yet."}
            </p>
          )}
          <ul className="stack">
            {info.tracks.map((track) => (
              <li key={track.index}>
                <strong>{track.language ?? "Unknown language"}</strong> ·{" "}
                {track.format} · {track.origin} · {track.status}
                {track.forced && " · Forced"}
                {track.sdh && " · SDH"}
                {track.relativePath && (
                  <p>
                    {track.rootKind === "subtitles"
                      ? "Subtitle root"
                      : "Media root"}
                    : {track.relativePath}
                  </p>
                )}
                {admin && track.status === "ambiguous" && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      edit({
                        rootKind: track.rootKind as Manual["rootKind"],
                        relativePath: track.relativePath!,
                      })
                    }
                  >
                    Review {track.relativePath}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {admin && (
            <>
              <div className="actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void request(
                      "check",
                      { revision: info.revision },
                      (result) => {
                        setInfo(result as Info);
                        setPreview(null);
                      },
                    )
                  }
                >
                  Check / Rescan subtitles
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => {
                    remote.reload();
                    setPreview(null);
                  }}
                >
                  Reload subtitle information
                </button>
              </div>
              <fieldset disabled={busy}>
                <legend>Manually associate a subtitle</legend>
                <p>
                  Choose a file inside this source or its configured subtitle
                  root. Check the candidate, then save to associate it with this
                  video.
                </p>
                <Select
                  label="Subtitle file root"
                  value={manual.rootKind}
                  onChange={(e) =>
                    edit({
                      ...manual,
                      rootKind: e.target.value as Manual["rootKind"],
                    })
                  }
                >
                  <option value="media">Media source</option>
                  <option value="subtitles">Configured subtitle root</option>
                </Select>
                <Field
                  label="Relative subtitle filename"
                  value={manual.relativePath}
                  onChange={(e) =>
                    edit({ ...manual, relativePath: e.target.value })
                  }
                  placeholder="Show/Season 1/Subs/English.srt"
                />
                <div className="actions">
                  <button
                    className="secondary"
                    disabled={!manual.relativePath.trim()}
                    onClick={() =>
                      void request(
                        "preview",
                        { revision: info.revision, manual },
                        (result) => setPreview(result as Preview),
                      )
                    }
                  >
                    Check subtitle candidate
                  </button>
                  <button
                    disabled={!preview?.supported}
                    onClick={() =>
                      void request(
                        "check",
                        {
                          revision: info.revision,
                          manual,
                          fingerprint: preview?.fingerprint,
                        },
                        (result) => {
                          setInfo(result as Info);
                          setPreview(null);
                          setManual({ rootKind: "media", relativePath: "" });
                          setSaved(true);
                        },
                      )
                    }
                  >
                    Save subtitle association
                  </button>
                  <button
                    className="secondary"
                    onClick={() => {
                      setManual({ rootKind: "media", relativePath: "" });
                      setPreview(null);
                    }}
                  >
                    Cancel subtitle draft
                  </button>
                </div>
                {preview && (
                  <p role="status">
                    Candidate: {preview.format} · {preview.size} bytes ·{" "}
                    {preview.supported
                      ? "Supported text; ready to associate"
                      : "Unsupported image captions; burn-in is unavailable"}
                  </p>
                )}
              </fieldset>
            </>
          )}
        </>
      )}
      {busy && <p role="status">Checking or saving subtitles…</p>}
      {saved && <p role="status">Subtitle association saved.</p>}
    </section>
  );
}
