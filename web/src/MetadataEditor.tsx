import { confirmAction } from "./confirmation";
import { SourcePathField } from "./SourcePathField";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "./api";
import { Field, Form, Modal, ModalCancel, Load, Select, ErrorBox } from "./ui";
import { useDraftNavigation } from "./navigation";
export type MetadataTarget =
  | { kind: "media"; mediaId: string }
  | { kind: "show"; sourceId: string; key: string };
type Source = "automatic" | "integration" | "local" | "manual";
type Choice = { source: Source; manual?: string };
type Candidate = {
  values: { title?: string; description?: string };
  status: string;
  reference?: string;
  fingerprint?: string;
  checkedMs?: number;
};
type Info = {
  target: MetadataTarget;
  revision: string;
  choices: { title: Choice; description: Choice };
  candidates: {
    integration: Candidate;
    local: Candidate;
    fallback: Candidate["values"];
  };
  effective: Record<
    "title" | "description",
    { value: string | null; source: string; status: string }
  >;
  requiresReview: boolean;
  retained?: {
    choices: { title: Choice; description: Choice };
    identity: string;
    checkedMs: number | null;
  } | null;
};
export function MetadataEditor({
  profileId,
  target,
  onClose,
  onSaved,
}: {
  profileId: string;
  target: MetadataTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const formId = useId();
  const [info, setInfo] = useState<Info | null>(null),
    [choices, setChoices] = useState<Info["choices"] | null>(null),
    [checked, setChecked] = useState<Candidate | null>(null),
    [error, setError] = useState<unknown>(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const active = useRef(true),
    controller = useRef(new AbortController());
  const message = busy
    ? "A save or check is pending. A save already received by the server may still finish. Close this edit?"
    : "Discard unsaved content information?";
  useDraftNavigation(dirty || busy, message);
  const close = async () => {
    if ((!dirty && !busy) || (await confirmAction(message))) onClose();
  };
  const load = async (signal = controller.current.signal) => {
    setError(null);
    try {
      const next = await api<Info>(
        `/api/profiles/${profileId}/metadata/inspect`,
        "POST",
        { target },
        signal,
      );
      if (!signal.aborted && active.current) {
        setInfo(next);
        setChoices(next.choices);
        setChecked(null);
        setDirty(false);
        setSaved(false);
      }
    } catch (e) {
      if (!signal.aborted && active.current) setError(e);
    }
  };
  useEffect(() => {
    active.current = true;
    controller.current = new AbortController();
    void load(controller.current.signal);
    return () => {
      active.current = false;
      controller.current.abort();
    };
  }, []);
  const change = (field: "title" | "description", choice: Choice) => {
    setChoices((old) => old && { ...old, [field]: choice });
    setDirty(true);
    setSaved(false);
  };
  return (
    <Modal
      title={`Edit ${target.kind === "show" ? "show" : "video"} information`}
      onClose={close}
      closeDisabled={busy}
      footer={
        <div className="actions">
          <button
            type="submit"
            form={formId}
            disabled={busy || !info || !choices}
          >
            Save information
          </button>
          <ModalCancel />
        </div>
      }
    >
      <p>
        Display information saves immediately. Files, episode order and
        programming keep their place.
      </p>
      {!info && (
        <Load loading={!error} error={error} retry={() => void load()} />
      )}
      {info && choices && (
        <Form
          id={formId}
          hideActions
          guardDraft={false}
          disabled={busy}
          submit="Save information"
          onCancel={close}
          onSave={async () => {
            setBusy(true);
            setError(null);
            try {
              const next = await api<Info>(
                `/api/profiles/${profileId}/metadata/save`,
                "POST",
                {
                  target,
                  revision: info.revision,
                  choices,
                  ...(checked
                    ? { localFingerprint: checked.fingerprint ?? null }
                    : {}),
                },
                controller.current.signal,
              );
              if (!active.current) return;
              setInfo(next);
              setChoices(next.choices);
              setChecked(null);
              setDirty(false);
              setSaved(true);
              onSaved();
            } finally {
              if (active.current) setBusy(false);
            }
          }}
        >
          {info.requiresReview && (
            <p className="notice" role="status">
              The media identity changed. Previous custom information has been
              retained for review and is not applied to this replacement.
            </p>
          )}
          {info.retained && (
            <section
              className="panel stack metadata-retained"
              aria-label="Retained information from previous media"
            >
              <h3>Review previous information</h3>
              <p>
                These choices belong to the previous video at this path. Review
                each field before using it for this replacement. The buttons
                below change this draft only; Save information applies the
                reviewed choices.
              </p>
              {info.retained.checkedMs && (
                <p>
                  Previous metadata checked{" "}
                  {new Date(info.retained.checkedMs).toLocaleString()}.
                </p>
              )}
              <details>
                <summary>Previous media version</summary>
                <code>{info.retained.identity}</code>
              </details>
            </section>
          )}
          {(["title", "description"] as const).map((field) => {
            const choice = choices[field],
              local = checked ?? info.candidates.local;
            const candidates = {
              integration: info.candidates.integration,
              local:
                checked && checked.status !== "available"
                  ? { ...checked, values: info.candidates.local.values }
                  : local,
            };
            const value: string | null | undefined =
              choice.source === "manual"
                ? (choice.manual ?? "")
                : choice.source === "automatic"
                  ? field === "title"
                    ? candidates.integration.values[field]?.trim() ||
                      local.values[field]?.trim() ||
                      info.candidates.fallback[field]
                    : (candidates.integration.values[field] ??
                      local.values[field] ??
                      info.candidates.fallback[field])
                  : candidates[choice.source].values[field];
            return (
              <section className="panel stack" key={field}>
                <h3>{field === "title" ? "Title" : "Description"}</h3>
                {info.retained && (
                  <div className="notice metadata-preview">
                    <strong>
                      Previous {field} choice:{" "}
                      {info.retained.choices[field].source === "local"
                        ? "Local metadata"
                        : info.retained.choices[field].source}
                    </strong>
                    {info.retained.choices[field].manual !== undefined && (
                      <p>
                        Retained manual {field}:{" "}
                        {info.retained.choices[field].manual || "(empty)"}
                      </p>
                    )}
                    {info.retained.choices[field].source !== "manual" && (
                      <p>
                        Using the previous source choice reads this
                        replacement’s current metadata. It does not recover an
                        old local or provider value.
                      </p>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={async () => {
                        const retained = info.retained!.choices[field];
                        if (
                          JSON.stringify(choice) !==
                            JSON.stringify(info.choices[field]) &&
                          !(await confirmAction(
                            `Replace the ${field} choice in this draft with the retained choice?`,
                          ))
                        )
                          return;
                        change(field, { ...retained });
                      }}
                    >
                      Stage retained {field} choice
                    </button>
                    {info.retained.choices[field].source !== "manual" &&
                      info.retained.choices[field].manual !== undefined && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy}
                          onClick={async () => {
                            if (
                              JSON.stringify(choice) !==
                                JSON.stringify(info.choices[field]) &&
                              !(await confirmAction(
                                `Replace the ${field} choice in this draft with the retained manual value?`,
                              ))
                            )
                              return;
                            change(field, {
                              source: "manual",
                              manual: info.retained!.choices[field].manual!,
                            });
                          }}
                        >
                          Use retained manual {field}
                        </button>
                      )}
                  </div>
                )}
                <Select
                  label={`${field === "title" ? "Title" : "Description"} source`}
                  value={choice.source}
                  onChange={(e) =>
                    change(field, {
                      ...choice,
                      source: e.target.value as Source,
                    })
                  }
                >
                  <option value="automatic">
                    Automatic · integration, local, filename
                  </option>
                  <option value="integration">
                    Sonarr / Radarr ·{" "}
                    {info.candidates.integration.values[field] === undefined
                      ? "unavailable"
                      : info.candidates.integration.status}
                  </option>
                  <option value="local">
                    Local metadata ·{" "}
                    {local.values[field] === undefined
                      ? local.status
                      : local.status}
                  </option>
                  <option value="manual">Manual</option>
                </Select>
                {choice.source === "manual" && (
                  <label className="field">
                    <span>Manual {field}</span>
                    <textarea
                      aria-label={`Manual ${field}`}
                      value={choice.manual ?? ""}
                      maxLength={field === "title" ? 500 : 20000}
                      required={field === "title"}
                      rows={field === "title" ? 2 : 5}
                      onChange={(e) =>
                        change(field, { ...choice, manual: e.target.value })
                      }
                    />
                  </label>
                )}
                <p className="notice metadata-preview">
                  <strong>Effective {field}</strong>
                  <br />
                  {value ?? "This source has no available value."}
                </p>
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={async () => {
                    const current = value ?? info.effective[field].value ?? "";
                    if (
                      choice.manual &&
                      choice.manual !== current &&
                      !(await confirmAction(
                        `Replace the saved manual ${field} in this draft?`,
                      ))
                    )
                      return;
                    change(field, { source: "manual", manual: current });
                  }}
                >
                  Use current {field} as manual
                </button>
              </section>
            );
          })}
          <section className="panel">
            <h3>Local metadata files</h3>
            <p>
              {(checked ?? info.candidates.local).status} ·{" "}
              {(checked ?? info.candidates.local).reference ??
                "No file checked"}
            </p>
            {(checked ?? info.candidates.local).checkedMs && (
              <p>
                Checked{" "}
                {new Date(
                  (checked ?? info.candidates.local).checkedMs!,
                ).toLocaleString()}
              </p>
            )}
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                void api<Candidate>(
                  `/api/profiles/${profileId}/metadata/check`,
                  "POST",
                  { target },
                  controller.current.signal,
                )
                  .then((next) => {
                    if (active.current) {
                      setChecked(next);
                      setDirty(true);
                      setSaved(false);
                    }
                  })
                  .catch((e) => {
                    if (active.current) setError(e);
                  })
                  .finally(() => {
                    if (active.current) setBusy(false);
                  });
              }}
            >
              {busy ? "Checking…" : "Check metadata files"}
            </button>
            <p>
              Checks only read existing files. Save applies the preview; Cancel
              leaves the selection unchanged.
            </p>
          </section>
          <ErrorBox error={error} />
          {saved && (
            <p className="notice" role="status">
              Information saved.
            </p>
          )}
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={async () => {
              if (
                !dirty ||
                (await confirmAction(
                  "Discard this draft and load the latest information?",
                ))
              )
                void load();
            }}
          >
            Reload latest information
          </button>
        </Form>
      )}
    </Modal>
  );
}
export function MetadataLocation({
  sourceId,
  initialRoot,
  onSaved,
}: {
  sourceId: string;
  initialRoot?: string | null;
  onSaved: () => void;
}) {
  const [saved, setSaved] = useState(false);
  return (
    <Form
      guardDraft={true}
      submit="Save metadata location"
      onSave={async (data) => {
        await api(`/api/sources/${sourceId}/metadata-location`, "PUT", {
          root: String(data.get("root") ?? "").trim() || null,
        });
        setSaved(true);
        onSaved();
      }}
    >
      <h3>Read-only metadata location</h3>
      <SourcePathField
        label="Metadata container directory (optional)"
        name="root"
        purpose="metadata"
        sourceId={sourceId}
        defaultValue={initialRoot ?? ""}
        placeholder="/metadata/shows"
        hint="Blank uses files beside videos. A separate root mirrors this source’s relative folders and filenames."
      />
      <p>
        Mount this directory read-only. Changing it does not scan, edit files or
        generate media.
      </p>
      {saved && <p role="status">Metadata location saved.</p>}
    </Form>
  );
}
