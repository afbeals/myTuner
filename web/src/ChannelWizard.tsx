import { useEffect, useId, useRef, useState } from "react";
import type { Workspace } from "./App";
import type { Channel, Entry, Programming, Selection } from "./types";
import { noBreaks } from "./types";
import { api } from "./api";
import { eventId } from "./playback-utils";
import { useDraftNavigation } from "./navigation";
import {
  SelectionPicker,
  selectionSummary,
  type ProgrammingOptions,
} from "./SelectionPicker";
import { ProgrammingRules, commercialSummary } from "./ProgrammingRules";
import { canManageProfile } from "./permissions";
import {
  Action,
  SubmissionErrorBox,
  Field,
  Load,
  Modal,
  ModalCancel,
  Select,
  duration,
  timeWithSeconds,
  MediaReferenceContext,
  useRemote,
} from "./ui";
const steps = [
  "Channel details",
  "Programming",
  "Commercials (optional)",
  "Preview and create",
];
export function ChannelWizard(
  props: Workspace & {
    initialSelection?: Selection | null;
    copySource?: Channel | null;
    onClose: () => void;
    onCreated: (channel: Channel) => void;
  },
) {
  const formId = useId(),
    draftId = useRef(eventId()),
    [step, setStep] = useState(0),
    [details, setDetails] = useState({
      name: props.copySource
        ? `${props.copySource.name} copy`.slice(0, 120)
        : "",
      shortName: "",
      description: props.copySource?.description ?? "",
      visibility: "private" as "private" | "shared",
    }),
    [target, setTarget] = useState(props.profileId),
    [config, setConfig] = useState<Programming>({
      profileId: props.profileId,
      groups: props.initialSelection
        ? [
            {
              id: eventId(),
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
    }),
    [picker, setPicker] = useState<string | null>(null),
    [rulesValid, setRulesValid] = useState(true),
    [labels, setLabels] = useState<Record<string, string>>({}),
    [dirty, setDirty] = useState(Boolean(props.initialSelection)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [preview, setPreview] = useState<{
      revision: string;
      entries: Entry[];
      total: number;
    } | null>(null);
  const options = useRemote<ProgrammingOptions>(
      `/api/profiles/${target}/library/options?limit=50`,
    ),
    initialCollection = useRemote<{ name: string; ids: string[] }>(
      props.initialSelection?.type === "collection"
        ? `/api/profiles/${target}/collections/${props.initialSelection.id}/membership`
        : null,
    ),
    copy = useRemote<{ config: Programming }>(
      props.copySource
        ? `/api/channels/${props.copySource.id}/draft-copy?profileId=${target}`
        : null,
    );
  const sourceNames = new Map(
    (options.data?.sources ?? []).map((source) => [source.id, source.name]),
  );
  const manage = canManageProfile(
    props.account,
    props.profiles.find((profile) => profile.id === target),
  );
  useEffect(() => {
    if (initialCollection.data && props.initialSelection)
      setLabels((old) => ({
        ...old,
        [JSON.stringify(props.initialSelection)]:
          `${initialCollection.data!.name} · ${initialCollection.data!.ids.length} referenced ${initialCollection.data!.ids.length === 1 ? "video" : "videos"}`,
      }));
  }, [initialCollection.data, props.initialSelection]);
  const serial = useRef(0),
    controller = useRef(new AbortController()),
    heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    controller.current = new AbortController();
    return () => {
      serial.current++;
      controller.current.abort();
    };
  }, []);
  useEffect(() => {
    if (copy.data) {
      setConfig({ ...copy.data.config, profileId: target });
      setPreview(null);
      serial.current++;
    }
  }, [copy.data, target]);
  useDraftNavigation(
    dirty || busy,
    "Discard this new channel draft? Nothing is created until the final Create channel action.",
  );
  const invalidate = () => {
    serial.current++;
    controller.current.abort();
    controller.current = new AbortController();
    setPreview(null);
    setError(null);
    setDirty(true);
  };
  const change = (next: Programming) => {
    invalidate();
    setConfig(next);
  };
  const body = {
    draftId: draftId.current,
    details: { ...details, shortName: details.shortName.trim() || null },
    config: { ...config, profileId: target },
  };
  const advance = (next: number) => {
    setStep(next);
    requestAnimationFrame(() => heading.current?.focus());
  };
  const generate = async () => {
    if (!manage || !rulesValid) return;
    const ticket = ++serial.current;
    setBusy(true);
    setError(null);
    try {
      const result = await api<NonNullable<typeof preview>>(
        "/api/channels/drafts/preview",
        "POST",
        body,
        controller.current.signal,
      );
      if (ticket === serial.current) setPreview(result);
    } catch (error) {
      if (ticket === serial.current && !controller.current.signal.aborted)
        setError(error);
    } finally {
      if (ticket === serial.current) setBusy(false);
    }
  };
  const publish = async () => {
    if (!preview || !manage || !rulesValid) return;
    const ticket = ++serial.current;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ id: string }>(
        "/api/channels/drafts/publish",
        "POST",
        { ...body, previewRevision: preview.revision },
        controller.current.signal,
      );
      if (ticket === serial.current) {
        setDirty(false);
        props.onCreated({
          id: result.id,
          name: details.name,
          description: details.description,
          visibility: details.visibility,
          ownerAccountId: props.account.id,
          shortName: details.shortName || details.name.slice(0, 12),
          shortNameOverride: details.shortName || null,
          hasProgramming: config.groups.length > 0,
        });
      }
    } catch (error) {
      if (ticket === serial.current && !controller.current.signal.aborted)
        setError(error);
    } finally {
      if (ticket === serial.current) setBusy(false);
    }
  };
  return (
    <Modal
      title={
        props.copySource
          ? "Create channel from existing programming"
          : "Create channel"
      }
      closeDisabled={busy}
      onClose={props.onClose}
      footer={
        <div className="actions">
          {step > 0 && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => advance(step - 1)}
            >
              Back
            </button>
          )}
          {step < 3 ? (
            <button
              type="submit"
              form={formId}
              disabled={
                busy ||
                !manage ||
                (step >= 2 && !rulesValid) ||
                copy.loading ||
                Boolean(copy.error)
              }
            >
              Next
            </button>
          ) : (
            <>
              <button
                type="button"
                className="secondary"
                disabled={busy || !manage || !rulesValid}
                onClick={() => void generate()}
              >
                {busy
                  ? "Working…"
                  : preview
                    ? "Update preview"
                    : "Generate preview"}
              </button>
              <button
                type="button"
                disabled={busy || !preview || !manage || !rulesValid}
                onClick={() => void publish()}
              >
                Create channel
              </button>
            </>
          )}
          <ModalCancel />
        </div>
      }
    >
      <ol className="wizard-progress" aria-label="Channel creation steps">
        {steps.map((label, index) => (
          <li key={label} aria-current={step === index ? "step" : undefined}>
            {index + 1}. {label}
          </li>
        ))}
      </ol>
      <h3 ref={heading} tabIndex={-1}>
        Step {step + 1}: {steps[step]}
      </h3>
      <SubmissionErrorBox error={error} focus={!busy} />
      {!manage && (
        <p role="alert">
          You cannot manage this profile. Choose a profile you are permitted to
          manage.
        </p>
      )}
      <Load {...copy} retry={copy.reload} />
      <form
        id={formId}
        data-form-dirty={dirty}
        onSubmit={(event) => {
          event.preventDefault();
          if (manage && (step < 2 || rulesValid))
            advance(Math.min(3, step + 1));
        }}
      >
        <fieldset disabled={busy}>
          {step === 0 && (
            <>
              <Field
                label="Channel name"
                required
                maxLength={120}
                value={details.name}
                onChange={(event) => {
                  invalidate();
                  setDetails({ ...details, name: event.target.value });
                }}
              />
              <div className="two-col">
                <Field
                  label="Short name (optional)"
                  maxLength={12}
                  value={details.shortName}
                  onChange={(event) => {
                    invalidate();
                    setDetails({ ...details, shortName: event.target.value });
                  }}
                  hint="Leave blank to derive it from the channel name."
                />
                <Select
                  label="Visibility"
                  value={details.visibility}
                  onChange={(event) => {
                    invalidate();
                    setDetails({
                      ...details,
                      visibility: event.target
                        .value as typeof details.visibility,
                    });
                  }}
                >
                  <option value="private">
                    Private · you and administrators
                  </option>
                  {props.account.role === "admin" && (
                    <option value="shared">
                      Shared · available to permitted profiles
                    </option>
                  )}
                </Select>
              </div>
              <label className="field">
                <span>Channel description</span>
                <textarea
                  value={details.description}
                  maxLength={20000}
                  rows={3}
                  onChange={(event) => {
                    invalidate();
                    setDetails({ ...details, description: event.target.value });
                  }}
                />
              </label>
              {props.copySource && (
                <Select
                  label="Target profile"
                  value={target}
                  onChange={(event) => {
                    invalidate();
                    setTarget(event.target.value);
                  }}
                >
                  {props.profiles
                    .filter((profile) =>
                      canManageProfile(props.account, profile),
                    )
                    .map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                </Select>
              )}
              <p>
                The channel is created only after you review its programming and
                submit the final step.
              </p>
            </>
          )}
          {step === 1 && (
            <>
              <p>
                Add collections, whole shows, seasons, folders or exact videos.
                Groups rotate independently. Whole shows and folders include
                newly scanned videos in future schedules.
              </p>
              {!config.groups.length && (
                <p role="status">
                  No content groups. You can create an empty channel and add
                  programming later. No videos or commercials will be scheduled.
                </p>
              )}
              {config.groups.map((group, index) => (
                <section className="settings-section" key={group.id}>
                  <h4>Content group {index + 1}</h4>
                  <p>
                    {labels[JSON.stringify(group.selection)] ??
                      selectionSummary(group.selection)}
                  </p>
                  <div className="actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setPicker(group.id)}
                    >
                      Change selection
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      disabled={index === 0}
                      aria-label={`Move group ${index + 1} up`}
                      onClick={() => {
                        const groups = [...config.groups];
                        [groups[index - 1], groups[index]] = [
                          groups[index]!,
                          groups[index - 1]!,
                        ];
                        change({ ...config, groups });
                      }}
                    >
                      Move up
                    </button>
                    <button
                      type="button"
                      className="secondary danger"
                      onClick={() =>
                        change({
                          ...config,
                          groups: config.groups.filter(
                            (item) => item.id !== group.id,
                          ),
                        })
                      }
                    >
                      Remove group {index + 1}
                    </button>
                  </div>
                  <div className="two-col">
                    <Select
                      label={`Group ${index + 1} play order`}
                      value={group.mode}
                      onChange={(event) =>
                        change({
                          ...config,
                          groups: config.groups.map((item) =>
                            item.id === group.id
                              ? {
                                  ...item,
                                  mode: event.target.value as typeof group.mode,
                                }
                              : item,
                          ),
                        })
                      }
                    >
                      <option value="ordered">In order</option>
                      <option value="shuffle">Shuffle</option>
                      <option value="random">Random · repeats possible</option>
                    </Select>
                    <Select
                      label={`Group ${index + 1} videos per turn`}
                      value={group.episodesPerTurn ?? 1}
                      onChange={(event) =>
                        change({
                          ...config,
                          groups: config.groups.map((item) =>
                            item.id === group.id
                              ? {
                                  ...item,
                                  episodesPerTurn: Number(event.target.value),
                                }
                              : item,
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
                  </div>
                </section>
              ))}
              <button type="button" onClick={() => setPicker("new")}>
                Add content group
              </button>
              <p>
                Videos per turn controls alternation. With two groups and two
                videos per turn: A1, A2, B1, B2, then A3, A4.
              </p>
              <details>
                <summary>Advanced shuffle seed</summary>
                <Field
                  label="Shuffle seed"
                  type="number"
                  min={0}
                  max={4294967295}
                  required
                  value={config.seed}
                  onChange={(event) =>
                    change({ ...config, seed: Number(event.target.value) })
                  }
                />
              </details>
            </>
          )}
          {step === 2 && (
            <>
              <Load {...options} retry={options.reload} />
              <ProgrammingRules
                config={config}
                sources={options.data?.sources ?? []}
                pools={options.data?.items ?? []}
                onChoosePool={() => setPicker("commercial")}
                onValidityChange={setRulesValid}
                onChange={change}
              />
            </>
          )}
          {step === 3 && (
            <>
              <p>
                <strong>{details.name}</strong> ·{" "}
                {details.visibility === "private"
                  ? "Private · owner and administrators"
                  : "Shared"}
              </p>
              {details.description && <p>{details.description}</p>}
              <p>
                {config.groups.length} content{" "}
                {config.groups.length === 1 ? "group" : "groups"} ·{" "}
                {commercialSummary(config)}
              </p>
              <ul>
                {config.groups.map((group, index) => (
                  <li key={group.id}>
                    Group {index + 1}:{" "}
                    {labels[JSON.stringify(group.selection)] ??
                      selectionSummary(group.selection)}
                  </li>
                ))}
              </ul>
              <p>
                {config.groups.length
                  ? "Generate a preview, then create the channel and publish its live schedule."
                  : "Generate an empty preview, then create the channel with no programming. You can add content later."}{" "}
                Previewing creates no channel, subscriptions or saved schedule.
              </p>
              {preview && (
                <>
                  <p role="status">
                    Preview ready · showing up to 100 of {preview.total}{" "}
                    intervals. The live schedule starts when you create the
                    channel.
                  </p>
                  <div className="bounded-checklist">
                    <table>
                      <thead>
                        <tr>
                          <th>Start</th>
                          <th>Video</th>
                          <th>Length</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.entries.map((entry) => (
                          <tr key={entry.id}>
                            <td>{timeWithSeconds(entry.startMs)}</td>
                            <td>
                              {entry.title}
                              {entry.kind === "program" && entry.offsetMs > 0
                                ? " (continued)"
                                : ""}
                              <MediaReferenceContext
                                entry={entry}
                                sourceNames={sourceNames}
                              />
                            </td>
                            <td>{duration(entry.endMs - entry.startMs)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </fieldset>
      </form>
      {picker && (
        <SelectionPicker
          profileId={target}
          identity={props.account.id}
          version={props.version}
          onClose={() => setPicker(null)}
          onChoose={(option) => {
            if (picker === "commercial") {
              change({
                ...config,
                commercialSelection: option.selection,
                disabledCommercialIds: [],
              });
              setPicker(null);
              return;
            }
            setLabels((old) => ({
              ...old,
              [JSON.stringify(option.selection)]: option.title,
            }));
            change({
              ...config,
              groups:
                picker === "new"
                  ? [
                      ...config.groups,
                      {
                        id: eventId(),
                        mode: "ordered",
                        selection: option.selection,
                      },
                    ]
                  : config.groups.map((group) =>
                      group.id === picker
                        ? { ...group, selection: option.selection }
                        : group,
                    ),
            });
            setPicker(null);
          }}
        />
      )}
    </Modal>
  );
}
