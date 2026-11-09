import { useState, useEffect } from "react";
import { api } from "./api";
import type { Media, Programming } from "./types";
import { Field, Load, Modal } from "./ui";
export function GroupCheckpoint({
  profileId,
  group,
  command,
  onChange,
}: {
  profileId: string;
  group: Programming["groups"][number];
  command: NonNullable<Programming["checkpointActions"]>[number] | undefined;
  onChange: (
    command: NonNullable<Programming["checkpointActions"]>[number] | null,
  ) => void;
}) {
  const [choosing, setChoosing] = useState(false),
    [search, setSearch] = useState("");
  const [items, setItems] = useState<Media[] | null>(null),
    [error, setError] = useState<unknown>(null),
    [version, setVersion] = useState(0);
  const signature = JSON.stringify(group.selection);
  useEffect(() => {
    if (!choosing) return;
    const controller = new AbortController();
    setItems(null);
    setError(null);
    const timer = setTimeout(() => {
      void api<{ items: Media[] }>(
        `/api/profiles/${profileId}/checkpoint-options`,
        "POST",
        { selection: JSON.parse(signature), search },
        controller.signal,
      )
        .then((r) => {
          if (!controller.signal.aborted) setItems(r.items);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e);
        });
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [choosing, profileId, signature, search, version]);
  return (
    <section aria-label="Ordered group checkpoint">
      <p>
        {command
          ? command.action === "restart"
            ? "Draft: restart this group at its first episode."
            : "Draft: the selected episode plays next in this group."
          : "Continue this group from its saved position."}{" "}
        Changes take effect after the current program and its breaks.
      </p>
      <div className="actions">
        <button
          className="secondary"
          onClick={() => {
            if (
              window.confirm(
                "Restart only this ordered group after the current program and breaks?",
              )
            )
              onChange({ groupId: group.id, action: "restart" });
          }}
        >
          Restart group
        </button>
        <button className="secondary" onClick={() => setChoosing(true)}>
          Choose next episode
        </button>
        {command && (
          <button className="secondary" onClick={() => onChange(null)}>
            Keep saved position
          </button>
        )}
      </div>
      {choosing && (
        <Modal
          title="Choose the next episode"
          onClose={() => setChoosing(false)}
        >
          <p>
            Only this group changes its next episode. Other groups and the
            current airing keep their place.
          </p>
          <Field
            label="Find next episode"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Load
            loading={!items && !error}
            error={error}
            retry={() => setVersion((v) => v + 1)}
          />
          <div className="stack">
            {items?.map((m) => (
              <button
                className="secondary"
                key={m.id}
                onClick={() => {
                  if (
                    window.confirm(
                      `Make ${m.title} the next episode in this group?`,
                    )
                  ) {
                    onChange({
                      groupId: group.id,
                      action: "startAt",
                      mediaId: m.id,
                    });
                    setChoosing(false);
                  }
                }}
              >
                {m.title} ·{" "}
                {m.metadata.seasonNumber !== undefined
                  ? `S${m.metadata.seasonNumber} E${m.metadata.episodeNumber}`
                  : m.relativePath}
              </button>
            ))}
          </div>
          {items?.length === 0 && (
            <p>No available matches. The saved position is unchanged.</p>
          )}
          <p>
            Up to 100 available matches. Narrow the search to find another
            episode.
          </p>
        </Modal>
      )}
    </section>
  );
}
