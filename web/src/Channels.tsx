import {
  ChannelStatistics,
  BreakDiagnostics,
  type BreakDiagnostic,
} from "./ChannelStatistics";
import { GroupCheckpoint } from "./GroupCheckpoint";
import {
  SelectionPicker,
  selectionSummary,
  type ProgrammingOptions,
} from "./SelectionPicker";
import { ResourceLink } from "./ResourceLink";
import { ReadinessPanel } from "./Inspection";
import { useDraftNavigation } from "./navigation";
import { useEffect, useRef, useState } from "react";
import type { Workspace } from "./App";
import type {
  Channel,
  Collection,
  Entry,
  GuideChannel,
  Library,
  Programming,
  Selection,
} from "./types";
import { noBreaks } from "./types";
import { api, ApiError } from "./api";
import { choices } from "./Library";
import {
  Action,
  Empty,
  Field,
  Form,
  Load,
  Modal,
  Select,
  time,
  useRemote,
  value,
  number,
} from "./ui";
export function ChannelsPage(
  props: Workspace & {
    initialSelection: Selection | null;
    onSelectionUsed: () => void;
  },
) {
  const list = useRemote<Channel[] | { items: Channel[] }>(
      props.account.role === "admin"
        ? "/api/admin/channels"
        : `/api/profiles/${props.profileId}/channels`,
      `${props.version}:${props.resource?.id ?? ""}`,
      true,
    ),
    guide = useRemote<{ channels: GuideChannel[] }>(
      `/api/profiles/${props.profileId}/guide`,
      props.version,
      true,
    );
  const [selection, setSelected] = useState<Channel | null>(null),
    [creating, setCreating] = useState(false),
    [creatingSaving, setCreatingSaving] = useState(false),
    [copySource, setCopySource] = useState<Channel | null>(null),
    [copiedConfig, setCopiedConfig] = useState<Programming | null>(null),
    [editing, setEditing] = useState(false),
    [details, setDetails] = useState<Channel | null>(null),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all");
  useEffect(() => {
    setSelected(null);
    setEditing(false);
    setDetails(null);
    setCreating(false);
    setCopySource(null);
    setCopiedConfig(null);
  }, [props.profileId]);
  useEffect(() => {
    if (props.initialSelection) setCreating(true);
  }, [props.initialSelection]);
  const rows = (
    Array.isArray(list.data) ? list.data : (list.data?.items ?? [])
  ).filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) &&
      (filter === "all" || filter === "archived"
        ? filter === "archived"
          ? c.archived
          : !c.archived
        : c.visibility === filter && !c.archived),
  );
  const allChannels = Array.isArray(list.data)
    ? list.data
    : (list.data?.items ?? []);
  const selected =
    allChannels.find((channel) => channel.id === selection?.id) ?? selection;
  const resolvedTarget = useRef("");
  const [resourceMissing, setResourceMissing] = useState(false);
  useEffect(() => {
    const id = props.resource?.kind === "channel" ? props.resource.id : "";
    if (!id) {
      if (resolvedTarget.current) {
        setSelected(null);
        setEditing(false);
        setDetails(null);
      }
      resolvedTarget.current = "";
      setResourceMissing(false);
      return;
    }
    if (!list.data || list.loading) return;
    const changed = resolvedTarget.current !== id;
    resolvedTarget.current = id;
    const channel = allChannels.find((c) => c.id === id && !c.archived);
    setResourceMissing(!channel);
    if (changed || !channel || resourceMissing) {
      setSelected(channel ?? null);
      setEditing(false);
      setDetails(null);
      setCopiedConfig(null);
      setCopySource(null);
      setCreating(false);
    }
    if (changed && channel)
      requestAnimationFrame(() =>
        document.getElementById("linked-channel-title")?.focus(),
      );
  }, [props.resource?.id, list.data, list.loading]);
  const [now, setNow] = useState(Date.now);
  const reloadGuide = useRef(guide.reload);
  reloadGuide.current = guide.reload;
  useEffect(() => {
    let seconds = 0;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (++seconds % 30 === 0) reloadGuide.current();
    }, 1000);
    return () => clearInterval(timer);
  }, [props.profileId]);
  const entries =
    guide.data?.channels.find((c) => c.id === selected?.id)?.entries ?? [];
  const refresh = () => {
    list.reload();
    guide.reload();
    props.changed();
  };
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Channels</h1>
          <p>Program the channels your household tunes into.</p>
        </div>
        <button onClick={() => setCreating(true)}>+ Create channel</button>
      </header>
      <div className="filters">
        <div className="tabs">
          {[
            "all",
            "shared",
            "private",
            ...(props.account.role === "admin" ? ["archived"] : []),
          ].map((f) => (
            <button
              className={filter === f ? "selected" : "secondary"}
              aria-pressed={filter === f}
              key={f}
              onClick={() => setFilter(f)}
            >
              {f === "all" ? "All channels" : f[0]!.toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
        <Field
          label="Search channels"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <Load {...list} retry={list.reload} />
      {resourceMissing && (
        <p role="alert">
          This item is unavailable. The link may be outdated or access has
          changed.
        </p>
      )}
      <div className="channel-workspace">
        <section className="panel channel-table">
          <div className="section-head">
            <h2>Your network</h2>
            <span className="badge">{rows.length} channels</span>
          </div>
          {!rows.length && list.data && !list.loading ? (
            <Empty title="Your network starts here">
              Create a channel and choose a whole show, season, collection or
              folder.
            </Empty>
          ) : (
            <div className="table-scroll channel-desktop">
              <table>
                <thead>
                  <tr>
                    <th>Channel</th>
                    <th>Access</th>
                    <th>Now / next</th>
                    <th>Manage</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const canEdit =
                      props.account.role === "admin" ||
                      c.ownerAccountId === props.account.id;
                    const current =
                      guide.data?.channels
                        .find((g) => g.id === c.id)
                        ?.entries.filter((e) => e.endMs > now) ?? [];
                    return (
                      <tr
                        key={c.id}
                        className={selected?.id === c.id ? "active-row" : ""}
                      >
                        <td>
                          <button
                            className="text-button"
                            onClick={() => setSelected(c)}
                          >
                            {c.name}
                          </button>
                          {c.archived && (
                            <span className="badge">Archived</span>
                          )}
                        </td>
                        <td>
                          <span className="badge">{c.shortName}</span>{" "}
                          <span className="badge">{c.visibility}</span>
                        </td>
                        <td>
                          {current[0]?.title ?? "Preview programming"}
                          <small>
                            {current[1]?.title
                              ? `Next · ${current[1].title}`
                              : ""}
                          </small>
                        </td>
                        <td>
                          {canEdit ? (
                            <div className="actions">
                              <button
                                className="secondary"
                                onClick={() => {
                                  setSelected(c);
                                  setDetails(c);
                                }}
                              >
                                Edit details
                              </button>
                              <button
                                className="secondary"
                                onClick={() => {
                                  setSelected(c);
                                  setEditing(true);
                                }}
                              >
                                Edit programming
                              </button>
                            </div>
                          ) : (
                            "Catalog channel"
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="channel-mobile">
            {rows.map((c) => {
              const current =
                guide.data?.channels
                  .find((g) => g.id === c.id)
                  ?.entries.filter((e) => e.endMs > now) ?? [];
              return (
                <article className="panel" key={c.id}>
                  <span className="badge">{c.shortName}</span>{" "}
                  <span className="badge">{c.visibility}</span>
                  <h2>{c.name}</h2>
                  <p>{current[0]?.title ?? "Preview programming"}</p>
                  {current[1] && <small>Next · {current[1].title}</small>}
                  <button className="secondary" onClick={() => setSelected(c)}>
                    Open {c.name}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
        <aside className="panel channel-preview">
          <span className="eyebrow">Channel preview</span>
          {selected ? (
            <>
              <h2 id="linked-channel-title" tabIndex={-1}>
                {selected.name}
              </h2>
              {(props.account.role === "admin" ||
                selected.ownerAccountId === props.account.id) &&
                !selected.archived && (
                  <button
                    className="secondary"
                    onClick={() => {
                      setCopySource(selected);
                      setCreating(true);
                    }}
                  >
                    Create from this channel
                  </button>
                )}
              <ChannelStatistics
                key={selected.id}
                profileId={props.profileId}
                channelId={selected.id}
              />
              <ResourceLink
                kind="channel"
                profileId={props.profileId}
                id={selected.id}
              />
              <p>
                {selected.visibility === "private"
                  ? "Private · visible to its owner and administrators"
                  : "Shared household channel"}
              </p>
              {props.account.role === "admin" && (
                <ReadinessPanel
                  key={selected.id}
                  profileId={props.profileId}
                  channelId={selected.id}
                />
              )}
              {selected.description && (
                <p className="metadata-preview">{selected.description}</p>
              )}
              <h3>Coming up</h3>
              {entries.slice(0, 5).map((e) => (
                <div className="preview-entry" key={e.id}>
                  <time>{time(e.startMs)}</time>
                  <strong>{e.title}</strong>
                  <span>{e.kind}</span>
                </div>
              ))}
              {!entries.length && (
                <p>
                  Publish programming and subscribe this profile to see its
                  guide.
                </p>
              )}
              <div className="actions">
                {(props.account.role === "admin" ||
                  selected.ownerAccountId === props.account.id) && (
                  <>
                    <button
                      className="secondary"
                      onClick={() => setDetails(selected)}
                    >
                      Edit details
                    </button>
                    <button onClick={() => setEditing(true)}>
                      Edit programming
                    </button>
                  </>
                )}
                <Action
                  secondary
                  task={async () => {
                    await api(
                      `/api/profiles/${props.profileId}/subscriptions/${selected.id}`,
                      "PUT",
                    );
                    refresh();
                  }}
                >
                  Add to profile guide
                </Action>
                <button
                  className="secondary"
                  onClick={() => props.watch(selected.id)}
                  disabled={!entries.length}
                >
                  Watch live
                </button>
                {(props.account.role === "admin" ||
                  selected.ownerAccountId === props.account.id) && (
                  <Action
                    secondary
                    danger
                    task={async () => {
                      if (
                        !window.confirm(
                          selected.archived
                            ? "Restore this channel? Subscriptions must be added again."
                            : "Archive this channel and remove its subscriptions?",
                        )
                      )
                        return;
                      await api(`/api/channels/${selected.id}`, "PATCH", {
                        archived: !selected.archived,
                      });
                      setSelected(null);
                      refresh();
                    }}
                  >
                    {selected.archived ? "Restore channel" : "Archive channel"}
                  </Action>
                )}
              </div>
            </>
          ) : (
            <Empty title="Choose a channel">
              See its upcoming schedule and make changes here.
            </Empty>
          )}
        </aside>
      </div>
      {creating && (
        <Modal
          title={
            copySource ? "Copy channel into a new draft" : "Create channel"
          }
          closeDisabled={creatingSaving}
          onClose={() => {
            setCreating(false);
            setCopySource(null);
            props.onSelectionUsed();
          }}
        >
          <Form
            guardDraft={true}
            submit="Create & program"
            onSave={async (d) => {
              setCreatingSaving(true);
              try {
                const targetProfile = copySource
                  ? value(d, "targetProfile")
                  : props.profileId;
                const copy = copySource
                  ? await api<{ config: Programming }>(
                      `/api/channels/${copySource.id}/draft-copy?profileId=${targetProfile}`,
                    )
                  : null;
                const c = await api<Channel>("/api/channels", "POST", {
                  name: value(d, "name"),
                  profileId: targetProfile,
                  visibility: copySource ? "private" : value(d, "visibility"),
                  shortName: value(d, "shortName") || null,
                });
                setSelected(c);
                setCopiedConfig(copy?.config ?? null);
                setCopySource(null);
                setCreating(false);
                setEditing(true);
                refresh();
              } finally {
                setCreatingSaving(false);
              }
            }}
          >
            <Field
              label="Channel name"
              name="name"
              required
              maxLength={120}
              defaultValue={
                copySource ? `${copySource.name} copy`.slice(0, 120) : ""
              }
            />
            {copySource && (
              <>
                <Select
                  label="Target profile"
                  name="targetProfile"
                  defaultValue={props.profileId}
                >
                  {props.profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <p>
                  A new private unpublished draft with an independent timeline.
                  Subscriptions, history and rotation positions are not copied.
                </p>
              </>
            )}
            <Field
              label="Short name (optional)"
              name="shortName"
              maxLength={12}
              hint="Leave blank to derive a compact label from the channel name."
            />
            {!copySource && (
              <Select label="Visibility" name="visibility">
                <option value="private">
                  Private · only you and administrators
                </option>
                {props.account.role === "admin" && (
                  <option value="shared">Shared · household catalog</option>
                )}
              </Select>
            )}
            <p>
              Subscriptions use one shared live timeline. Playback always joins
              the current program.
            </p>
          </Form>
        </Modal>
      )}
      {editing && selected && (
        <ProgramEditor
          key={`program:${props.profileId}:${selected.id}`}
          {...props}
          channel={selected}
          {...(copiedConfig
            ? { draftConfig: copiedConfig, profileId: copiedConfig.profileId }
            : {})}
          onDetails={() => setDetails(selected)}
          onClose={() => {
            setEditing(false);
            setDetails(null);
            setCopiedConfig(null);
            props.onSelectionUsed();
          }}
          onSaved={refresh}
        />
      )}
      {details && (
        <ChannelDetailsEditor
          key={`details:${props.profileId}:${details.id}`}
          {...props}
          channel={details}
          onClose={() => setDetails(null)}
          onSaved={refresh}
        />
      )}
    </>
  );
}
function ChannelDetailsEditor(
  props: Workspace & {
    channel: Channel;
    onClose: () => void;
    onSaved: () => void;
  },
) {
  const [dirty, setDirty] = useState(false),
    [saved, setSaved] = useState(false),
    [saving, setSaving] = useState(false);
  const active = useRef(true),
    detailsRevision = useRef(props.channel.detailsRevision ?? 0),
    controller = useRef(new AbortController());
  const discard = saving
    ? "A save is pending. Closing cannot undo a save already received by the server. Close details?"
    : "Discard unsaved channel details?";
  useDraftNavigation(dirty, discard);
  useEffect(() => {
    active.current = true;
    controller.current = new AbortController();
    return () => {
      active.current = false;
      controller.current.abort();
    };
  }, []);
  const close = () => {
    if (!dirty || window.confirm(discard)) props.onClose();
  };
  return (
    <Modal title={`Edit details · ${props.channel.name}`} onClose={close}>
      <p>
        Details save immediately. Programming and playback keep their place.
      </p>
      <div
        onChangeCapture={() => {
          setDirty(true);
          setSaved(false);
        }}
      >
        <Form
          guardDraft={false}
          submit="Save channel details"
          onCancel={close}
          onSave={async (d) => {
            setSaving(true);
            try {
              await api(
                `/api/channels/${props.channel.id}`,
                "PATCH",
                {
                  name: value(d, "name"),
                  description: String(d.get("description") ?? ""),
                  expectedDetailsRevision: detailsRevision.current,
                  ...(props.account.role === "admin" ||
                  value(d, "visibility") !== props.channel.visibility
                    ? { visibility: value(d, "visibility") }
                    : {}),
                  shortName: value(d, "shortName") || null,
                },
                controller.current.signal,
              );
              if (!active.current) return;
              detailsRevision.current++;
              setDirty(false);
              setSaved(true);
              props.onSaved();
            } finally {
              if (active.current) setSaving(false);
            }
          }}
        >
          <div className="two-col">
            <Field
              label="Channel name"
              name="name"
              defaultValue={props.channel.name}
              required
              maxLength={120}
            />
            <Field
              label="Short name (optional)"
              name="shortName"
              defaultValue={props.channel.shortNameOverride ?? ""}
              maxLength={12}
              placeholder={props.channel.shortName}
              hint="Blank follows the channel name automatically."
            />
            <Select
              label="Visibility"
              name="visibility"
              defaultValue={props.channel.visibility}
            >
              <option value="private">Private</option>
              {(props.account.role === "admin" ||
                props.channel.visibility === "shared") && (
                <option value="shared">Shared</option>
              )}
            </Select>
          </div>
          <label className="field">
            <span>Channel description</span>
            <textarea
              name="description"
              defaultValue={props.channel.description ?? ""}
              maxLength={20000}
              rows={4}
            />
          </label>
          {saved && (
            <p className="notice" role="status">
              Channel details saved. Changes take effect immediately.
            </p>
          )}
        </Form>
      </div>
    </Modal>
  );
}
function ProgramEditor(
  props: Workspace & {
    channel: Channel;
    initialSelection: Selection | null;
    onClose: () => void;
    onDetails: () => void;
    onSaved: () => void;
    draftConfig?: Programming;
  },
) {
  const data = useRemote<{
      revisionId: string | null;
      config: Programming | null;
      effectiveMs: number | null;
    }>(`/api/channels/${props.channel.id}/programming`),
    library = useRemote<ProgrammingOptions>(
      `/api/profiles/${props.profileId}/library/options?limit=50`,
    );
  const [config, setConfig] = useState<Programming | null>(null),
    [tab, setTab] = useState("content"),
    [picker, setPicker] = useState<string | null>(null),
    [chosenLabels, setChosenLabels] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState<Entry[] | null>(null),
    [diagnostics, setDiagnostics] = useState<BreakDiagnostic[]>([]),
    [previewEffective, setPreviewEffective] = useState<number | null>(null),
    [saved, setSaved] = useState<number | null>(null),
    [dirty, setDirty] = useState(false),
    [commercialDirty, setCommercialDirty] = useState(false),
    [commercialVersion, setCommercialVersion] = useState(0),
    [conflict, setConflict] = useState(false),
    [latestReview, setLatestReview] = useState<{
      config: Programming | null;
      effectiveMs: number | null;
    } | null>(null);
  const expectedRevision = useRef<string | null>(null);
  const hasChanges = dirty || commercialDirty;
  useDraftNavigation(hasChanges);
  const configRevision = useRef(0),
    previewRequest = useRef(0),
    publicationRequest = useRef(0);
  useEffect(() => {
    return () => {
      configRevision.current++;
      previewRequest.current++;
      publicationRequest.current++;
    };
  }, []);
  useEffect(() => {
    if (data.data) {
      expectedRevision.current = data.data.revisionId;
      setConflict(false);
      setLatestReview(null);
      configRevision.current++;
      setPreview(null);
      setSaved(null);
      setDirty(Boolean(props.draftConfig && !data.data.config));
      setCommercialVersion((v) => v + 1);
      setCommercialDirty(false);
      setConfig(
        data.data.config ??
          props.draftConfig ?? {
            profileId: props.profileId,
            groups: props.initialSelection
              ? [
                  {
                    id: "group-1",
                    mode: "ordered",
                    selection: props.initialSelection,
                  },
                ]
              : [],
            rules: {
              ...noBreaks,
              maxClips: 3,
              maxDurationMs: 120000,
              overflowPolicy: "truncate",
              minRemainingMs: 6000,
            },
            seed: 42,
          },
      );
    }
  }, [data.data, props.profileId, props.initialSelection, props.draftConfig]);
  const options = (library.data?.items ?? []).map((o) => ({
    ...o,
    label: o.title,
    kind:
      o.kind === "folder"
        ? (library.data?.sources.find((s) => s.id === o.sourceId)?.kind ??
          "videos")
        : o.kind === "collection"
          ? "collections"
          : o.kind,
    detail: o.kind,
  }));
  const update = (next: Programming) => {
    configRevision.current++;
    setConfig(next);
    setDirty(true);
    setPreview(null);
    setSaved(null);
  };
  const checkConflict = (error: unknown, revision: number) => {
    if (
      revision === configRevision.current &&
      error instanceof ApiError &&
      error.status === 409 &&
      error.message.startsWith("Channel changed elsewhere")
    ) {
      setConflict(true);
      setPreview(null);
      setSaved(null);
      setDirty(true);
    }
    throw error;
  };
  return (
    <Modal
      title={`Program ${props.channel.name}`}
      onClose={() => {
        if (
          !hasChanges ||
          window.confirm("Discard unpublished changes to this channel?")
        )
          props.onClose();
      }}
    >
      <Load {...data} retry={data.reload} />
      <Load {...library} retry={library.reload} />
      {config && (
        <div>
          {conflict && (
            <section className="notice" role="alert">
              <h3>Channel changed elsewhere</h3>
              <p>
                Your draft is preserved. Load the latest programming or
                deliberately review this draft against the latest revision, then
                generate a fresh preview.
              </p>
              <Action
                secondary
                task={async () => {
                  if (
                    window.confirm(
                      "Discard this unpublished draft and load the latest programming?",
                    )
                  )
                    data.reload();
                }}
              >
                Load latest programming
              </Action>
              <Action
                task={async () => {
                  const revision = configRevision.current;
                  const latest = await api<{
                    revisionId: string | null;
                    config: Programming | null;
                    effectiveMs: number | null;
                  }>(`/api/channels/${props.channel.id}/programming`);
                  if (revision !== configRevision.current) return;
                  expectedRevision.current = latest.revisionId;
                  setLatestReview(latest);
                  setConflict(false);
                  setPreview(null);
                  setSaved(null);
                  setDirty(true);
                }}
              >
                Keep draft and review against latest
              </Action>
            </section>
          )}
          {latestReview && (
            <section className="notice">
              <h3>Latest publication to compare with your draft</h3>
              <p>
                {latestReview.effectiveMs
                  ? `Effective ${new Date(latestReview.effectiveMs).toLocaleString()}`
                  : "No programming published"}
                . Your draft remains below; review and preview it before
                publishing.
              </p>
              {latestReview.config?.groups.map((g, index) => (
                <p key={g.id}>
                  Group {index + 1}:{" "}
                  {options.find(
                    (o) =>
                      JSON.stringify(o.selection) ===
                      JSON.stringify(g.selection),
                  )?.label ?? "Saved selection"}{" "}
                  · {g.mode} · {g.episodesPerTurn ?? 1} episode(s) per turn
                </p>
              ))}
              {latestReview.config && (
                <p>
                  Commercial pool:{" "}
                  {latestReview.config.commercialSelection
                    ? (options.find(
                        (o) =>
                          JSON.stringify(o.selection) ===
                          JSON.stringify(
                            latestReview.config!.commercialSelection,
                          ),
                      )?.label ?? "Saved commercial selection")
                    : "None"}
                  . Maximum break:{" "}
                  {latestReview.config.rules.maxDurationMs / 1000} seconds;{" "}
                  {latestReview.config.rules.maxClips} clips;{" "}
                  {latestReview.config.rules.positions.length} fixed positions.
                  Between-program breaks:{" "}
                  {latestReview.config.rules.between ? "on" : "off"}.
                </p>
              )}
            </section>
          )}
          <p role="status" className="notice">
            {commercialDirty
              ? "Unapplied commercial inputs — retained across tabs. Apply these rules before preview or publication."
              : saved
                ? `Programming saved — effective ${new Date(saved).toLocaleString()}`
                : preview
                  ? "Preview current — ready to publish this draft"
                  : hasChanges
                    ? "Unsaved draft — generate a fresh preview"
                    : data.data?.revisionId
                      ? "Published programming — edit and preview to make changes"
                      : "Unpublished channel — add content and preview before publishing"}
          </p>
          <div className="tabs">
            {["content", "commercials", "preview"].map((t) => (
              <button
                key={t}
                className={tab === t ? "selected" : "secondary"}
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
              >
                {t[0]!.toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          {tab === "content" && (
            <>
              <p>
                Groups rotate independently. Whole shows, seasons and folders
                include newly discovered videos in future batches.
              </p>
              <button className="secondary" onClick={props.onDetails}>
                Edit details
              </button>
              {config.groups.map((g, i) => (
                <section className="panel group" key={g.id}>
                  <h3>Content group {i + 1}</h3>
                  <p>
                    {chosenLabels[JSON.stringify(g.selection)] ??
                      options.find(
                        (o) =>
                          JSON.stringify(o.selection) ===
                          JSON.stringify(g.selection),
                      )?.title ??
                      selectionSummary(g.selection)}
                  </p>
                  <button className="secondary" onClick={() => setPicker(g.id)}>
                    Change content selection
                  </button>
                  <Select
                    label="Rotation"
                    value={g.mode}
                    onChange={(e) =>
                      update({
                        ...config,
                        checkpointActions: (
                          config.checkpointActions ?? []
                        ).filter((a) => a.groupId !== g.id),
                        groups: config.groups.map((v, n) =>
                          n === i
                            ? { ...v, mode: e.target.value as typeof g.mode }
                            : v,
                        ),
                      })
                    }
                  >
                    <option value="ordered">
                      Ordered · keep episode sequence
                    </option>
                    <option value="shuffle">Shuffle · varied rotation</option>
                    <option value="random">Random · repeats possible</option>
                  </Select>
                  <Select
                    label="Episodes per turn"
                    value={g.episodesPerTurn ?? 1}
                    onChange={(e) =>
                      update({
                        ...config,
                        groups: config.groups.map((v) =>
                          v.id === g.id
                            ? { ...v, episodesPerTurn: Number(e.target.value) }
                            : v,
                        ),
                      })
                    }
                  >
                    {[1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                  <p>
                    {g.episodesPerTurn ?? 1} from this group before the next
                    group. For two per turn: A1, A2, B1, B2.
                  </p>
                  {g.mode === "ordered" && (
                    <GroupCheckpoint
                      profileId={props.profileId}
                      group={g}
                      command={config.checkpointActions?.find(
                        (a) => a.groupId === g.id,
                      )}
                      onChange={(command) =>
                        update({
                          ...config,
                          checkpointActions: [
                            ...(config.checkpointActions ?? []).filter(
                              (a) => a.groupId !== g.id,
                            ),
                            ...(command ? [command] : []),
                          ],
                        })
                      }
                    />
                  )}
                  <div className="actions">
                    <button
                      className="secondary"
                      disabled={i === 0}
                      onClick={() => {
                        const groups = [...config.groups];
                        [groups[i - 1], groups[i]] = [
                          groups[i]!,
                          groups[i - 1]!,
                        ];
                        update({ ...config, groups });
                      }}
                    >
                      Move up
                    </button>
                    <button
                      className="secondary danger"
                      onClick={() =>
                        update({
                          ...config,
                          groups: config.groups.filter((_, n) => n !== i),
                        })
                      }
                    >
                      Remove group {i + 1}
                    </button>
                  </div>
                </section>
              ))}
              <button onClick={() => setPicker("new")}>
                + Add content group
              </button>
            </>
          )}
          {picker && (
            <SelectionPicker
              profileId={props.profileId}
              {...(config.groups.find((g) => g.id === picker)
                ? {
                    current: config.groups.find((g) => g.id === picker)!
                      .selection,
                  }
                : {})}
              onClose={() => setPicker(null)}
              onChoose={(o) => {
                if (picker === "commercial") {
                  update({
                    ...config,
                    commercialSelection: o.selection,
                    disabledCommercialIds: [],
                  });
                  setCommercialVersion((v) => v + 1);
                  setPicker(null);
                  return;
                }
                setChosenLabels((old) => ({
                  ...old,
                  [JSON.stringify(o.selection)]: o.title,
                }));
                update({
                  ...config,
                  groups:
                    picker === "new"
                      ? [
                          ...config.groups,
                          {
                            id: crypto.randomUUID(),
                            mode: "ordered",
                            selection: o.selection,
                          },
                        ]
                      : config.groups.map((g) =>
                          g.id === picker
                            ? { ...g, selection: o.selection }
                            : g,
                        ),
                  checkpointActions: (config.checkpointActions ?? []).filter(
                    (a) => a.groupId !== picker,
                  ),
                });
                setPicker(null);
              }}
            />
          )}
          <div hidden={tab !== "commercials"}>
            <CommercialEligibility
              config={config}
              profileId={props.profileId}
              update={update}
            />
            <div onChangeCapture={() => setCommercialDirty(true)}>
              <Form
                guardDraft={false}
                key={commercialVersion}
                submit="Apply commercial rules"
                onSave={async (d) => {
                  const selected = value(d, "pool"),
                    positions = value(d, "positions")
                      .split(",")
                      .map((v) => v.trim())
                      .filter(Boolean)
                      .map((v) => ({
                        kind: value(d, "positionKind") as
                          "percent" | "timestamp",
                        value: Number(v),
                      }));
                  setCommercialDirty(false);
                  const { commercialSelection: _, ...base } = config;
                  update({
                    ...base,
                    disabledCommercialIds:
                      selected === JSON.stringify(config.commercialSelection)
                        ? (config.disabledCommercialIds ?? [])
                        : [],
                    ...(selected
                      ? {
                          commercialSelection: JSON.parse(
                            selected,
                          ) as Selection,
                        }
                      : {}),
                    rules: {
                      between: d.has("between"),
                      positions,
                      maxClips: number(d, "maxClips"),
                      maxDurationMs: number(d, "maxDuration") * 1000,
                      overflowPolicy: value(d, "overflowPolicy") as
                        "skip" | "truncate",
                      minRemainingMs: Math.round(
                        number(d, "minRemaining") * 1000,
                      ),
                      repeatAllowance: number(d, "repeat"),
                      maxPerBreak: number(d, "perBreak"),
                      cooldownMs: number(d, "cooldown") * 1000,
                      ...(number(d, "randomCount") > 0
                        ? {
                            random: {
                              count: number(d, "randomCount"),
                              minPercent: number(d, "minPercent"),
                              maxPercent: number(d, "maxPercent"),
                            },
                          }
                        : {}),
                    },
                  });
                }}
              >
                <div className="two-col">
                  <div>
                    <h3>Make every break deliberate</h3>
                    <button
                      type="button"
                      className="secondary"
                      disabled={commercialDirty}
                      onClick={() => setPicker("commercial")}
                    >
                      Find another commercial pool
                    </button>
                    {commercialDirty && (
                      <p>
                        Apply current commercial inputs before changing the
                        pool.
                      </p>
                    )}
                    <Select
                      label="Commercial pool"
                      name="pool"
                      defaultValue={
                        config.commercialSelection
                          ? JSON.stringify(config.commercialSelection)
                          : ""
                      }
                    >
                      <option value="">No commercials</option>
                      {config.commercialSelection &&
                        !options.some(
                          (o) =>
                            JSON.stringify(o.selection) ===
                            JSON.stringify(config.commercialSelection),
                        ) && (
                          <option
                            value={JSON.stringify(config.commercialSelection)}
                          >
                            Saved pool
                          </option>
                        )}
                      {options
                        .filter((o) =>
                          ["commercials", "collections", "videos"].includes(
                            o.kind,
                          ),
                        )
                        .map((o, n) => (
                          <option key={n} value={JSON.stringify(o.selection)}>
                            {o.label}
                          </option>
                        ))}
                    </Select>
                    <label className="check">
                      <input
                        type="checkbox"
                        name="between"
                        defaultChecked={config.rules.between}
                      />
                      Between programs
                    </label>
                    <Select
                      label="Fixed position unit"
                      name="positionKind"
                      defaultValue={
                        config.rules.positions[0]?.kind ?? "percent"
                      }
                    >
                      <option value="percent">Percent of source program</option>
                      <option value="timestamp">
                        Milliseconds into source program
                      </option>
                    </Select>
                    <Field
                      label="Fixed positions"
                      name="positions"
                      defaultValue={config.rules.positions
                        .map((p) => p.value)
                        .join(", ")}
                      hint="Comma-separated values, for example 25, 50, 75."
                    />
                    <Field
                      label="Random break count"
                      name="randomCount"
                      type="number"
                      min={0}
                      max={100}
                      defaultValue={config.rules.random?.count ?? 0}
                    />
                    <div className="two-col">
                      <Field
                        label="Minimum percent"
                        name="minPercent"
                        type="number"
                        min={1}
                        max={98}
                        defaultValue={config.rules.random?.minPercent ?? 30}
                      />
                      <Field
                        label="Maximum percent"
                        name="maxPercent"
                        type="number"
                        min={2}
                        max={99}
                        defaultValue={config.rules.random?.maxPercent ?? 70}
                      />
                    </div>
                  </div>
                  <div>
                    <Field
                      label="Maximum clips per break"
                      name="maxClips"
                      type="number"
                      min={0}
                      max={100}
                      required
                      defaultValue={config.rules.maxClips}
                    />
                    <Field
                      label="Maximum break duration (seconds)"
                      name="maxDuration"
                      type="number"
                      min={0}
                      max={3600}
                      required
                      defaultValue={config.rules.maxDurationMs / 1000}
                    />
                    <Select
                      label="When a commercial exceeds the remaining break"
                      name="overflowPolicy"
                      defaultValue={config.rules.overflowPolicy ?? "skip"}
                    >
                      <option value="truncate">
                        Cut off at the end of the break
                      </option>
                      <option value="skip">
                        Only play complete commercials
                      </option>
                    </Select>
                    <Field
                      label="Minimum remaining time to start a commercial (seconds)"
                      name="minRemaining"
                      type="number"
                      min={0}
                      max={3600}
                      step={0.001}
                      required
                      defaultValue={
                        (config.rules.minRemainingMs ?? 6000) / 1000
                      }
                      hint="In cutoff mode, more than this time must remain. At or below it, return to the show."
                    />
                    <Field
                      label="Appearances per clip, per pool rotation"
                      name="repeat"
                      type="number"
                      min={1}
                      max={100}
                      required
                      defaultValue={config.rules.repeatAllowance}
                    />
                    <Field
                      label="Maximum repeats of one clip in a break"
                      name="perBreak"
                      type="number"
                      min={1}
                      max={100}
                      required
                      defaultValue={config.rules.maxPerBreak}
                    />
                    <Field
                      label="Cooldown between clip starts (seconds)"
                      name="cooldown"
                      type="number"
                      min={0}
                      max={604800}
                      required
                      defaultValue={config.rules.cooldownMs / 1000}
                    />
                    <p className="notice">
                      Cutoff mode plays only the scheduled portion of the last
                      commercial. Short remainders return to the show; repeat
                      and cooldown limits still apply. Original files stay
                      unchanged.
                    </p>
                  </div>
                </div>
              </Form>
            </div>
          </div>

          {tab === "preview" && (
            <>
              <p>
                Preview resolves actual scheduled intervals. Publishing changes
                an active channel after its current program and associated
                breaks.
              </p>
              <Action
                task={async () => {
                  const revision = configRevision.current,
                    request = ++previewRequest.current;
                  setPreview(null);
                  const result = await api<{
                    entries: Entry[];
                    diagnostics: BreakDiagnostic[];
                    effectiveMs: number;
                  }>(
                    `/api/channels/${props.channel.id}/programming/preview?horizonMs=7200000`,
                    "POST",
                    { ...config, expectedRevisionId: expectedRevision.current },
                  ).catch((error) => checkConflict(error, revision));
                  if (
                    revision === configRevision.current &&
                    request === previewRequest.current
                  ) {
                    setPreview(result.entries);
                    setDiagnostics(result.diagnostics);
                    setPreviewEffective(result.effectiveMs);
                  }
                }}
                disabled={!config.groups.length || conflict || commercialDirty}
              >
                Generate two-hour preview
              </Action>
              {preview && (
                <>
                  <p className="notice">
                    Changes take effect{" "}
                    {new Date(previewEffective!).toLocaleString()} after the
                    current program and its breaks.
                  </p>
                  <BreakDiagnostics items={diagnostics} />
                  <Schedule entries={preview} />
                </>
              )}
            </>
          )}
          <div className="actions editor-footer">
            <Action
              disabled={
                !config.groups.length || !preview || commercialDirty || conflict
              }
              task={async () => {
                const revision = configRevision.current,
                  request = ++publicationRequest.current;
                const r = await api<{
                  effectiveMs: number;
                  revisionId: string;
                }>(`/api/channels/${props.channel.id}/programming`, "PUT", {
                  ...config,
                  expectedRevisionId: expectedRevision.current,
                }).catch((error) => checkConflict(error, revision));
                if (request === publicationRequest.current)
                  expectedRevision.current = r.revisionId;
                if (
                  revision === configRevision.current &&
                  request === publicationRequest.current
                ) {
                  setSaved(r.effectiveMs);
                  setDirty(false);
                  setPreview(null);
                  const { checkpointActions: _, ...published } = config;
                  setConfig(published);
                }
                props.onSaved();
              }}
            >
              Publish programming
            </Action>
            <button className="secondary" onClick={() => setTab("preview")}>
              Review schedule
            </button>
          </div>
          <p className="muted">
            {commercialDirty
              ? "Apply commercial rules before previewing or publishing."
              : "Preview this draft before publishing. Original media stays in place."}
          </p>
        </div>
      )}
    </Modal>
  );
}
export function Schedule({ entries }: { entries: Entry[] }) {
  return (
    <div className="table-scroll">
      {entries.length > 0 && (
        <p>
          Generated window: {new Date(entries[0]!.startMs).toLocaleString()} –{" "}
          {new Date(entries.at(-1)!.endMs).toLocaleString()}. Rows show actual
          scheduled durations.
        </p>
      )}
      <table>
        <thead>
          <tr>
            <th>Starts</th>
            <th>Ends</th>
            <th>Video</th>
            <th>Type</th>
            <th>Actual seconds</th>
          </tr>
        </thead>
        <tbody>
          {entries.slice(0, 100).map((e) => (
            <tr key={e.id}>
              <td>
                {new Date(e.startMs).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </td>
              <td>
                {new Date(e.endMs).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </td>
              <td>{e.title ?? e.mediaId}</td>
              <td>{e.kind}</td>
              <td>
                {((e.endMs - e.startMs) / 1000).toLocaleString(undefined, {
                  maximumFractionDigits: 3,
                })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length > 100 && <p>Showing the first 100 intervals.</p>}
    </div>
  );
}

function CommercialEligibility({
  config,
  profileId,
  update,
}: {
  config: Programming;
  profileId: string;
  update: (next: Programming) => void;
}) {
  const [items, setItems] = useState<{ id: string; title: string }[] | null>(
      null,
    ),
    [error, setError] = useState<unknown>(null);
  const selection = JSON.stringify(config.commercialSelection);
  useEffect(() => {
    setItems(null);
    setError(null);
    if (!config.commercialSelection) return;
    const controller = new AbortController();
    void api<{ items: { id: string; title: string }[] }>(
      `/api/profiles/${profileId}/selection`,
      "POST",
      config.commercialSelection,
      controller.signal,
    )
      .then((data) => {
        if (!controller.signal.aborted) setItems(data.items);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e);
      });
    return () => controller.abort();
  }, [profileId, selection]);
  if (!config.commercialSelection) return null;
  const disabled = config.disabledCommercialIds ?? [];
  return (
    <section className="panel">
      <h3>Commercial eligibility</h3>
      <p>
        Disable a commercial for this channel without moving its file. Preview
        and publish to change future programming after the current program and
        breaks; existing airings and paused sessions retain their choices.
      </p>
      <Load loading={!items && !error} error={error} />
      {items && (
        <>
          <p>
            {items.filter((i) => !disabled.includes(i.id)).length} eligible of{" "}
            {items.length} available commercials. An empty pool returns to the
            show without dead air.
          </p>
          <div className="commercial-eligibility">
            {items.map((item) => (
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
        </>
      )}
    </section>
  );
}
