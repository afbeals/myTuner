import { useEffect, useId, useRef, useState } from "react";
import { api } from "./api";
import { confirmAction } from "./confirmation";
import {
  Action,
  Empty,
  Field,
  Form,
  Load,
  Modal,
  ModalCancel,
  useRemote,
  value,
} from "./ui";
type Session = {
  id: string;
  kind: string;
  label: string | null;
  createdMs: number | null;
  lastUsedMs: number | null;
  expiresAt: number;
  current: boolean;
};
const label = (session: Session) =>
  session.label ??
  (session.kind === "device"
    ? "Paired TV"
    : session.kind === "browser"
      ? "Browser"
      : "API session");
export function SessionsPage() {
  const rows = useRemote<Session[]>("/api/auth/sessions", 0, true),
    [editing, setEditing] = useState<Session | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    id = useId();
  const list = useRef<HTMLDivElement>(null),
    refreshButton = useRef<HTMLButtonElement>(null),
    nextFocus = useRef<string | null | undefined>(undefined);
  const focusSession = (sessionId: string | null, revoke = false) => {
    requestAnimationFrame(() => {
      const row = sessionId
        ? list.current?.querySelector<HTMLElement>(
            `[data-session-id="${sessionId}"]`,
          )
        : null;
      (
        row?.querySelector<HTMLButtonElement>(
          revoke ? 'button[aria-label^="Revoke "]' : "button",
        ) ?? refreshButton.current
      )?.focus();
    });
  };
  useEffect(() => {
    if (rows.loading || nextFocus.current === undefined) return;
    const target = nextFocus.current;
    nextFocus.current = undefined;
    focusSession(target);
  }, [rows.loading, rows.data, rows.updatedAt]);
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Devices & sessions</h1>
          <p>
            Name your devices and remove access you no longer use. These
            sessions belong to your signed-in account.
          </p>
        </div>
        <button
          ref={refreshButton}
          className="secondary"
          disabled={rows.loading}
          onClick={rows.reload}
        >
          Refresh sessions
        </button>
      </header>
      <Load {...rows} retry={rows.reload} />
      {rows.data && (rows.loading || Boolean(rows.error)) && (
        <p role="status">
          Showing the previous session list
          {rows.updatedAt
            ? ` checked ${new Date(rows.updatedAt).toLocaleString()}`
            : ""}
          .
          {rows.loading
            ? " Refreshing…"
            : " The latest refresh failed. Retry to update it."}
        </p>
      )}
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {rows.data?.length === 0 && <Empty title="No active sessions" />}
      <div className="stack" ref={list}>
        {rows.data?.map((session) => (
          <section
            className="panel compact-row"
            key={session.id}
            data-session-id={session.id}
          >
            <div>
              <h2>
                {label(session)}{" "}
                {session.current && <span className="badge">This session</span>}
              </h2>
              <p>
                {session.kind === "device"
                  ? "TV"
                  : session.kind === "browser"
                    ? "Browser"
                    : "API"}{" "}
                · Created{" "}
                {session.createdMs === null
                  ? "before activity tracking"
                  : new Date(session.createdMs).toLocaleString()}
              </p>
              <p>
                Last used{" "}
                {session.lastUsedMs === null
                  ? "not recorded"
                  : new Date(session.lastUsedMs).toLocaleString()}{" "}
                · Expires {new Date(session.expiresAt).toLocaleString()}
              </p>
            </div>
            <div className="actions">
              <button
                className="secondary"
                aria-label={`Rename ${label(session)}`}
                onClick={() => setEditing(session)}
              >
                Rename
              </button>
              <Action
                secondary
                danger
                label={`Revoke ${label(session)}`}
                task={async () => {
                  const name = label(session);
                  if (
                    !(await confirmAction(
                      `${session.current ? "This is your current session. Revoking it signs you out now." : `${name} will lose access.`} The device must sign in or pair again.`,
                      { title: `Revoke ${name}?`, label: "Revoke access" },
                    ))
                  ) {
                    focusSession(session.id, true);
                    return;
                  }
                  try {
                    await api(`/api/auth/sessions/${session.id}`, "DELETE");
                  } catch (error) {
                    focusSession(session.id, true);
                    throw error;
                  }
                  if (session.current) {
                    sessionStorage.setItem(
                      "mytuner:notice",
                      "Your session was revoked. Sign in again.",
                    );
                    window.dispatchEvent(new Event("mytuner:expired"));
                  } else {
                    setMessage(`Access revoked: ${name}.`);
                    const remaining =
                        rows.data?.filter((item) => item.id !== session.id) ??
                        [],
                      index =
                        rows.data?.findIndex(
                          (item) => item.id === session.id,
                        ) ?? 0;
                    nextFocus.current =
                      remaining[Math.min(index, remaining.length - 1)]?.id ??
                      null;
                    rows.reload();
                  }
                }}
              >
                Revoke access
              </Action>
            </div>
          </section>
        ))}
      </div>
      <p>
        Activity times update at most every 15 minutes. Names are entered by you
        or supplied when a TV is paired; device fingerprinting is not used.
      </p>
      {editing && (
        <Modal
          title={`Rename ${label(editing)}`}
          onClose={() => setEditing(null)}
          closeDisabled={busy}
          footer={
            <div className="actions">
              <button form={id} type="submit" disabled={busy}>
                Save name
              </button>
              <ModalCancel />
            </div>
          }
        >
          <Form
            id={id}
            hideActions
            onBusyChange={setBusy}
            onSave={async (data) => {
              const name = value(data, "label");
              await api(`/api/auth/sessions/${editing.id}`, "PATCH", {
                label: name,
              });
              nextFocus.current = editing.id;
              setEditing(null);
              setMessage(`Session named ${name}.`);
              rows.reload();
            }}
          >
            <Field
              label="Session name"
              name="label"
              required
              maxLength={120}
              defaultValue={label(editing)}
            />
          </Form>
        </Modal>
      )}
    </>
  );
}
