import { ChannelWizard } from "./ChannelWizard";
import { ProgrammingRules } from "./ProgrammingRules";
import { canManageProfile } from "./permissions";
import { eventId } from "./playback-utils";
import { confirmAction } from "./confirmation";
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
import { useEffect, useId, useRef, useState } from "react";
import type { Workspace } from "./App";
import type {
  Channel,
  Entry,
  GuideChannel,
  Programming,
  Selection,
  Source,
} from "./types";
import { noBreaks } from "./types";
import { api, ApiError } from "./api";
import {
  Action,
  Empty,
  Field,
  Form,
  Load,
  Modal,
  ModalCancel,
  Select,
  time,
  duration,
  useRemote,
  value,
  SubmissionErrorBox,
  MediaReferenceContext,
  timeWithSeconds,
} from "./ui";
export function ChannelsPage(
  props: Workspace & {
    initialSelection: Selection | null;
    onSelectionUsed: () => void;
    embedded?: boolean;
    createRequested?: number;
  },
) {
  const profile = props.profiles.find(
      (profile) => profile.id === props.profileId,
    ),
    manage = canManageProfile(props.account, profile),
    profileName = profile?.name ?? "this profile";
  const canEditChannel = (channel: Channel) =>
    manage &&
    (props.account.role === "admin" ||
      channel.ownerAccountId === props.account.id);
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
    [searchText, setSearchText] = useState(""),
    [cardOffset, setCardOffset] = useState(0),
    [notice, setNotice] = useState(""),
    [filter, setFilter] = useState("all"),
    [addedToGuides, setAddedToGuides] = useState<Set<string>>(() => new Set()),
    [publishedIds, setPublishedIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    setSelected(null);
    setEditing(false);
    setDetails(null);
    setCreating(false);
    setCopySource(null);
    setCopiedConfig(null);
  }, [props.profileId]);
  useEffect(() => {
    if (props.initialSelection && manage) setCreating(true);
  }, [props.initialSelection, manage]);
  useEffect(() => {
    if (props.createRequested && manage) setCreating(true);
  }, [props.createRequested, manage]);
  useEffect(() => setCardOffset(0), [search, filter]);
  useEffect(() => {
    if (guide.data)
      setAddedToGuides(
        (old) =>
          new Set(
            [...old].filter((key) => !key.startsWith(`${props.profileId}:`)),
          ),
      );
  }, [guide.data, props.profileId]);

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
  const inGuide = Boolean(
    selected &&
    (guide.data?.channels.some((channel) => channel.id === selected.id) ||
      addedToGuides.has(`${props.profileId}:${selected.id}`)),
  );
  const published = Boolean(
    selected &&
    (publishedIds.has(selected.id) ||
      selected.hasProgramming ||
      guide.data?.channels.find((channel) => channel.id === selected.id)
        ?.entries.length),
  );
  useEffect(() => {
    if (
      list.data &&
      !list.loading &&
      selection &&
      !allChannels.some((channel) => channel.id === selection.id)
    ) {
      setSelected(null);
      setEditing(false);
      setDetails(null);
    }
  }, [list.data]);
  const previewPanel = useRef<HTMLElement>(null),
    channelList = useRef<HTMLDivElement>(null);
  const chooseChannel = (channel: Channel) => {
    setSelected(channel);
    requestAnimationFrame(() => previewPanel.current?.focus());
  };
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
          {props.embedded ? (
            <h2 id="network-channels" tabIndex={-1}>
              Channels
            </h2>
          ) : (
            <h1>Channels</h1>
          )}
          <p>Program the channels your household tunes into.</p>
        </div>
        {!props.embedded && manage && (
          <button onClick={() => setCreating(true)}>Create channel</button>
        )}
      </header>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      <form
        className="filters"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(searchText);
        }}
      >
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
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <button type="submit">Search channels</button>
      </form>
      <Load {...list} retry={list.reload} />
      {resourceMissing && (
        <p role="alert">
          This item is unavailable. The link may be outdated or access has
          changed.
        </p>
      )}
      {props.embedded && (
        <>
          {!rows.length && !list.loading && list.data && (
            <Empty
              title={
                search || filter !== "all"
                  ? "No matching channels"
                  : "Create your first channel"
              }
            >
              <p>
                {search || filter !== "all"
                  ? "Try clearing the channel search and filters."
                  : "Choose programming, preview a schedule, then create your channel."}
              </p>
              {(search || filter !== "all") && (
                <button
                  className="secondary"
                  onClick={() => {
                    setSearch("");
                    setSearchText("");
                    setFilter("all");
                  }}
                >
                  Clear channel filters
                </button>
              )}
            </Empty>
          )}
          <div
            className="channel-strip"
            role="region"
            ref={channelList}
            tabIndex={-1}
            aria-label="Your channels"
          >
            {rows.slice(cardOffset, cardOffset + 50).map((channel) => (
              <article className="panel channel-card" key={channel.id}>
                <span className="badge">
                  {channel.archived
                    ? "Archived"
                    : channel.visibility === "private"
                      ? "Private"
                      : "Shared"}
                </span>
                <button
                  className="text-button"
                  onClick={() => chooseChannel(channel)}
                >
                  {channel.name}
                </button>
                <p>{channel.shortName}</p>
                <p>
                  {guide.data?.channels
                    .find((current) => current.id === channel.id)
                    ?.entries.find(
                      (entry) => entry.startMs <= now && entry.endMs > now,
                    )?.title ??
                    (channel.archived
                      ? "Archived channel"
                      : "Select to view schedule")}
                </p>
              </article>
            ))}
          </div>
          {rows.length > 50 && (
            <div className="actions">
              <button
                className="secondary"
                disabled={!cardOffset}
                onClick={() => setCardOffset((n) => Math.max(0, n - 50))}
              >
                Previous channels
              </button>
              <button
                className="secondary"
                disabled={cardOffset + 50 >= rows.length}
                onClick={() => setCardOffset((n) => n + 50)}
              >
                More channels
              </button>
            </div>
          )}
        </>
      )}
      <div
        className={
          props.embedded
            ? "channel-workspace network-channel-workspace"
            : "channel-workspace"
        }
      >
        <section className="panel channel-table" hidden={props.embedded}>
          <div className="section-head">
            <h2>Your network</h2>
            <span className="badge">{rows.length} channels</span>
          </div>
          {!rows.length && list.data && !list.loading ? (
            <Empty
              title={
                search || filter !== "all"
                  ? "No matching channels"
                  : "Your network starts here"
              }
            >
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
                    const canEdit = canEditChannel(c);
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
                            onClick={() => chooseChannel(c)}
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
                                onClick={async () => {
                                  setSelected(c);
                                  setDetails(c);
                                }}
                              >
                                Edit details
                              </button>
                              <button
                                className="secondary"
                                onClick={async () => {
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
                  <button
                    className="secondary"
                    onClick={() => chooseChannel(c)}
                  >
                    Open {c.name}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
        <aside
          ref={previewPanel}
          tabIndex={-1}
          className="panel channel-preview"
          hidden={props.embedded && !selected}
        >
          <span className="eyebrow">Channel preview</span>
          {selected ? (
            <>
              {props.embedded && (
                <button
                  className="secondary"
                  onClick={() => {
                    setSelected(null);
                    channelList.current?.focus();
                  }}
                >
                  Back to channels
                </button>
              )}
              <h2 id="linked-channel-title" tabIndex={-1}>
                {selected.name}
              </h2>
              {canEditChannel(selected) && !selected.archived && (
                <button
                  className="secondary"
                  onClick={async () => {
                    setCopySource(selected);
                    setCreating(true);
                  }}
                >
                  Create from this channel
                </button>
              )}
              {!selected.archived && (
                <ChannelStatistics
                  key={`statistics:${selected.id}`}
                  profileId={props.profileId}
                  channelId={selected.id}
                />
              )}
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
              {props.account.role === "admin" && !selected.archived && (
                <ReadinessPanel
                  key={`readiness:${selected.id}`}
                  profileId={props.profileId}
                  channelId={selected.id}
                  identity={props.account.id}
                  version={props.version}
                />
              )}
              {selected.description && (
                <p className="metadata-preview">{selected.description}</p>
              )}
              {selected.archived && (
                <p role="status">
                  Archived · Restore this channel before editing programming or
                  adding it to a guide. Previous subscriptions are not restored.
                </p>
              )}
              <h3>
                {selected.archived ? "Archived programming" : "Coming up"}
              </h3>
              {entries.slice(0, 5).map((e) => (
                <div className="preview-entry" key={e.id}>
                  <time>{time(e.startMs)}</time>
                  <strong>{e.title}</strong>
                  <span>{e.kind}</span>
                </div>
              ))}
              {!entries.length && (
                <p>
                  {selected.archived
                    ? "Restore this channel to add it to a guide."
                    : published
                      ? inGuide
                        ? "Published. The guide is loading its scheduled programming."
                        : `Published. Add this channel to ${profileName}’s guide to watch.`
                      : selected.hasProgramming === false
                        ? "No programming scheduled. Add content when ready."
                        : `Add this channel to ${profileName}’s guide to see its programming when published.`}
                </p>
              )}
              <div className="actions">
                {canEditChannel(selected) && (
                  <>
                    <button
                      className="secondary"
                      onClick={() => setDetails(selected)}
                    >
                      Edit details
                    </button>
                    {!selected.archived && (
                      <button onClick={() => setEditing(true)}>
                        Edit programming
                      </button>
                    )}
                  </>
                )}
                {!selected.archived && manage && (
                  <Action
                    secondary
                    disabled={inGuide || guide.loading}
                    task={async () => {
                      await api(
                        `/api/profiles/${props.profileId}/subscriptions/${selected.id}`,
                        "PUT",
                      );
                      setAddedToGuides(
                        (old) =>
                          new Set([
                            ...old,
                            `${props.profileId}:${selected.id}`,
                          ]),
                      );
                      setNotice(
                        `Added ${selected.name} to ${profileName}’s guide.`,
                      );
                      refresh();
                    }}
                  >
                    {inGuide
                      ? `Already in ${profileName}’s guide`
                      : "Add to profile guide"}
                  </Action>
                )}
                {manage && inGuide && <a href="#subscriptions">Manage guide</a>}
                <button
                  className="secondary"
                  onClick={() => props.watch(selected.id)}
                  disabled={selected.archived || !entries.length}
                >
                  Watch live
                </button>
                {canEditChannel(selected) && (
                  <Action
                    secondary
                    danger
                    task={async () => {
                      if (
                        !(await confirmAction(
                          selected.archived
                            ? "Restore this channel? Subscriptions must be added again."
                            : "Archive this channel and remove its subscriptions?",
                        ))
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
                {selected.archived && canEditChannel(selected) && (
                  <Action
                    secondary
                    danger
                    label={`Permanently delete ${selected.name}`}
                    task={async () => {
                      const impact = await api<{
                        revision: string;
                        canDelete: boolean;
                        name: string;
                        counts: Record<string, number>;
                      }>(`/api/channels/${selected.id}/dependencies`);
                      if (!impact.canDelete)
                        throw new Error(
                          "This channel is no longer archived. Refresh your channels before deleting it.",
                        );
                      const labels: Record<string, string> = {
                        schedules: "schedule revisions",
                        entries: "scheduled intervals",
                        playback: "playback sessions",
                        reports: "problem reports",
                        history: "playback history records",
                        subscriptions: "subscriptions",
                      };
                      const summary = Object.entries(impact.counts)
                        .filter(([, count]) => count > 0)
                        .map(([key, count]) => `${count} ${labels[key] ?? key}`)
                        .join(", ");
                      if (
                        !(await confirmAction(
                          `Permanently delete archived channel “${impact.name}”? This removes its settings, content groups and programming${summary ? `, including ${summary}` : ""}. Related playback history and problem reports are removed. This cannot be undone. Original videos, subtitles, metadata files, collections and generated files stay on disk.`,
                          {
                            title: `Delete ${impact.name} permanently?`,
                            label: "Delete channel",
                          },
                        ))
                      )
                        return;
                      await api(
                        `/api/channels/${selected.id}/permanent`,
                        "DELETE",
                        { revision: impact.revision },
                      );
                      setSelected(null);
                      setNotice(`Archived channel deleted: ${selected.name}.`);
                      refresh();
                    }}
                  >
                    Delete permanently
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
      {creating && manage && (
        <ChannelWizard
          {...props}
          initialSelection={props.initialSelection}
          copySource={copySource}
          onClose={() => {
            setCreating(false);
            setCopySource(null);
            props.onSelectionUsed();
          }}
          onCreated={(channel) => {
            setCreating(false);
            setCopySource(null);
            setSelected(channel);
            if (channel.hasProgramming)
              setPublishedIds((old) => new Set([...old, channel.id]));
            setNotice(
              channel.hasProgramming
                ? `Channel created and published: ${channel.name}. Add it to a profile guide when ready.`
                : `Empty channel created: ${channel.name}. Add programming when ready.`,
            );
            props.onSelectionUsed();
            refresh();
          }}
        />
      )}
      {editing && selected && canEditChannel(selected) && (
        <ProgramEditor
          key={`program:${props.profileId}:${selected.id}`}
          {...props}
          channel={selected}
          {...(copiedConfig
            ? { draftConfig: copiedConfig, profileId: copiedConfig.profileId }
            : {})}
          onDetails={() => setDetails(selected)}
          onClose={async () => {
            setEditing(false);
            setDetails(null);
            setCopiedConfig(null);
            props.onSelectionUsed();
          }}
          onSaved={(hasProgramming) => {
            setPublishedIds((old) => {
              const next = new Set(old);
              if (hasProgramming) next.add(selected.id);
              else next.delete(selected.id);
              return next;
            });
            refresh();
          }}
        />
      )}
      {details && canEditChannel(details) && (
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
  const formId = useId();
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
  const close = async () => {
    if (!dirty || (await confirmAction(discard))) props.onClose();
  };
  return (
    <Modal
      title={`Edit details · ${props.channel.name}`}
      onClose={close}
      closeDisabled={saving}
      footer={
        <div className="actions">
          <button form={formId} type="submit" disabled={saving}>
            Save channel details
          </button>
          <ModalCancel />
        </div>
      }
    >
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
          id={formId}
          hideActions
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
    onSaved: (hasProgramming: boolean) => void;
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
    [rulesValid, setRulesValid] = useState(true),
    [submissionError, setSubmissionError] = useState<unknown>(null),
    [commercialVersion, setCommercialVersion] = useState(0),
    [conflict, setConflict] = useState(false),
    [reloading, setReloading] = useState(false),
    [latestReview, setLatestReview] = useState<{
      config: Programming | null;
      effectiveMs: number | null;
    } | null>(null);
  const expectedRevision = useRef<string | null>(null);
  const hasChanges = dirty;
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
      setSubmissionError(null);
      configRevision.current++;
      setPreview(null);
      setSaved(null);
      setDirty(Boolean(props.draftConfig && !data.data.config));
      setCommercialVersion((v) => v + 1);
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
  useEffect(() => {
    if (!data.loading) setReloading(false);
  }, [data.loading, data.data, data.error]);
  const reloadProgramming = () => {
    setReloading(true);
    data.reload();
  };
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
  const emptyGroups =
    config?.groups.filter((group) =>
      options.some(
        (option) =>
          JSON.stringify(option.selection) ===
            JSON.stringify(group.selection) && option.available === 0,
      ),
    ) ?? [];
  const noAvailableGroups = Boolean(
    config?.groups.length && emptyGroups.length === config.groups.length,
  );
  const update = (next: Programming) => {
    configRevision.current++;
    setConfig({
      ...next,
      ...(next.checkpointActions
        ? {
            checkpointActions: next.checkpointActions.filter((action) =>
              next.groups.some((group) => group.id === action.groupId),
            ),
          }
        : {}),
    });
    setDirty(true);
    setPreview(null);
    setSaved(null);
    setSubmissionError(null);
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
  const [publishing, setPublishing] = useState(false);
  const publish = async () => {
    if (!config || !rulesValid || noAvailableGroups) return;
    setSubmissionError(null);
    setPublishing(true);
    try {
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
      props.onSaved(config.groups.length > 0);
    } finally {
      setPublishing(false);
    }
  };
  return (
    <Modal
      title={`Program ${props.channel.name}`}
      closeDisabled={publishing}
      footer={
        config && (
          <div className="actions">
            <button
              className="secondary"
              disabled={
                tab === "content" || publishing || data.loading || reloading
              }
              onClick={() =>
                setTab(tab === "preview" ? "commercials" : "content")
              }
            >
              Back
            </button>
            {saved ? null : tab === "preview" ? (
              <Action
                disabled={
                  !preview ||
                  !rulesValid ||
                  noAvailableGroups ||
                  conflict ||
                  publishing
                }
                task={publish}
                onError={setSubmissionError}
              >
                {config.groups.length
                  ? "Publish programming"
                  : "Save empty programming"}
              </Action>
            ) : (
              <button
                disabled={
                  publishing || !rulesValid || data.loading || reloading
                }
                onClick={() =>
                  setTab(tab === "content" ? "commercials" : "preview")
                }
              >
                Next
              </button>
            )}
            <ModalCancel>{saved ? "Done" : "Cancel"}</ModalCancel>
          </div>
        )
      }
      onClose={async () => {
        if (
          !hasChanges ||
          (await confirmAction("Discard unpublished changes to this channel?"))
        )
          props.onClose();
      }}
    >
      <Load {...data} retry={reloadProgramming} />
      <Load {...library} retry={library.reload} />
      <SubmissionErrorBox error={submissionError} focus={!publishing} />
      {emptyGroups.map((group) => (
        <section key={group.id} className="notice" role="alert">
          <h3>
            Content group {(config?.groups.indexOf(group) ?? 0) + 1} has no
            available videos in the last scan
          </h3>
          <p>
            {group.selection.type === "folder"
              ? `${library.data?.sources.find((source) => source.id === ("sourceId" in group.selection ? group.selection.sourceId : undefined))?.name ?? "Source"} · ${group.selection.directory || "Entire source"}`
              : selectionSummary(group.selection)}
            . The folder may have moved or be empty. No replacement is chosen
            automatically.
          </p>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setTab("content");
              setPicker(group.id);
            }}
          >
            Choose replacement
          </button>{" "}
          <a href="#sources">Review sources and scan again</a>
        </section>
      ))}
      {config && (
        <fieldset disabled={data.loading || reloading || publishing}>
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
                    await confirmAction(
                      "Discard this unpublished draft and load the latest programming?",
                    )
                  )
                    reloadProgramming();
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
                  · {g.mode} · {g.episodesPerTurn ?? 1}{" "}
                  {(g.episodesPerTurn ?? 1) === 1 ? "video" : "videos"} per turn
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
            {!rulesValid
              ? "Correct the highlighted commercial break positions before preview or publication."
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
          <div className="tabs" aria-label="Programming steps">
            {["content", "commercials", "preview"].map((t) => (
              <button
                key={t}
                className={tab === t ? "selected" : "secondary"}
                aria-pressed={tab === t}
                onClick={() => setTab(t)}
              >
                {["content", "commercials", "preview"].indexOf(t) + 1}.{" "}
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
              {!config.groups.length && (
                <p role="status">
                  No content groups. You can save this channel empty and add
                  programming later. Any current program and its breaks finish
                  first; no new videos or commercials will be scheduled.
                </p>
              )}
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
                    label="Play order"
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
                    <option value="ordered">In order</option>
                    <option value="shuffle">Shuffle · varied rotation</option>
                    <option value="random">Random · repeats possible</option>
                  </Select>
                  <Select
                    label="Videos per turn"
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
                      onClick={async () => {
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
              identity={props.account.id}
              version={props.version}
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
                            id: eventId(),
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
            <ProgrammingRules
              key={commercialVersion}
              config={config}
              sources={library.data?.sources ?? []}
              pools={library.data?.items ?? []}
              onChange={update}
              onValidityChange={setRulesValid}
              onChoosePool={() => setPicker("commercial")}
            />
          </div>

          {tab === "preview" && (
            <>
              {!saved && (
                <p>
                  Preview resolves actual scheduled intervals. Publishing
                  changes an active channel after its current program and
                  associated breaks.
                </p>
              )}
              {!saved && (
                <Action
                  onError={setSubmissionError}
                  task={async () => {
                    setSubmissionError(null);
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
                      {
                        ...config,
                        expectedRevisionId: expectedRevision.current,
                      },
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
                  disabled={conflict || !rulesValid || noAvailableGroups}
                >
                  {config.groups.length
                    ? "Generate two-hour preview"
                    : "Review empty programming"}
                </Action>
              )}
              {preview && (
                <>
                  <p className="notice">
                    Changes take effect{" "}
                    {new Date(previewEffective!).toLocaleString()} after the
                    current program and its breaks.
                  </p>
                  {!config.groups.length && (
                    <p role="status">
                      No videos or commercials are scheduled after this change
                      takes effect. The channel and its settings are kept.
                    </p>
                  )}
                  <Schedule
                    entries={preview}
                    sources={library.data?.sources ?? []}
                  />
                  <BreakDiagnostics items={diagnostics} />
                </>
              )}
            </>
          )}
          <p className="muted">
            {!rulesValid
              ? "Correct the highlighted commercial break positions before previewing or publishing."
              : saved
                ? `Programming saved. Effective ${new Date(saved).toLocaleString()} after the current program and its breaks. Choose Done to close, or edit again.`
                : "Preview this draft before publishing. Original media stays in place."}
          </p>
        </fieldset>
      )}
    </Modal>
  );
}
export function Schedule({
  entries,
  sources = [],
}: {
  entries: Entry[];
  sources?: Source[];
}) {
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [entries]);
  const sourceNames = new Map(
    sources.map((source) => [source.id, source.name]),
  );
  return (
    <section aria-label="Schedule review">
      {entries.length > 0 && (
        <p>
          Preview: {entries.length}{" "}
          {entries.length === 1 ? "interval" : "intervals"} ·{" "}
          {new Date(entries[0]!.startMs).toLocaleString()} –{" "}
          {new Date(entries.at(-1)!.endMs).toLocaleString()}. Showing{" "}
          {offset + 1}–{Math.min(offset + 20, entries.length)}. Continued
          program portions resume after a commercial break.
        </p>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Starts</th>
              <th>Ends</th>
              <th>Video</th>
              <th>Type</th>
              <th>Duration</th>
            </tr>
          </thead>
          <tbody>
            {entries.slice(offset, offset + 20).map((entry) => (
              <tr key={entry.id}>
                <td>{timeWithSeconds(entry.startMs)}</td>
                <td>{timeWithSeconds(entry.endMs)}</td>
                <td>
                  {entry.title ?? entry.mediaId}
                  {entry.kind === "program" && entry.offsetMs > 0
                    ? " (continued)"
                    : ""}
                  <MediaReferenceContext
                    entry={entry}
                    sourceNames={sourceNames}
                  />
                </td>
                <td>
                  {entry.kind === "commercial"
                    ? "Commercial"
                    : entry.offsetMs > 0
                      ? `Program · resumes at ${duration(entry.offsetMs)}`
                      : "Program"}
                </td>
                <td>{duration(entry.endMs - entry.startMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {entries.length > 20 && (
        <div className="actions">
          <button
            type="button"
            className="secondary"
            disabled={!offset}
            onClick={() => setOffset((value) => Math.max(0, value - 20))}
          >
            Previous intervals
          </button>
          <button
            type="button"
            className="secondary"
            disabled={offset + 20 >= entries.length}
            onClick={() => setOffset((value) => value + 20)}
          >
            Next intervals
          </button>
        </div>
      )}
    </section>
  );
}
