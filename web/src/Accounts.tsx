import { useId, useState } from "react";
import type { Workspace } from "./App";
import type { Account } from "./types";
import { api } from "./api";
import { confirmAction } from "./confirmation";
import { SecretFields } from "./SecretFields";
import { Info } from "./Info";
import {
  Action,
  Empty,
  Field,
  Form,
  Load,
  Modal,
  ModalCancel,
  Select,
  useRemote,
  value,
} from "./ui";
type Configuration = Account & { revision: string };
export function AccountsPage(props: Workspace) {
  const rows = useRemote<Account[]>("/api/accounts", props.version, true),
    [editing, setEditing] = useState<Account | "new" | null>(null),
    [message, setMessage] = useState("");
  return (
    <>
      <header className="page-head">
        <div>
          <h1 aria-label="Accounts">
            Accounts{" "}
            <Info title="Account roles">
              Administrators manage the network. Editors manage assigned
              profiles and their own programming. Viewers watch permitted
              channels. These settings apply to the whole network.
            </Info>
          </h1>
        </div>
        <button onClick={() => setEditing("new")}>Create account</button>
      </header>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      <Load {...rows} retry={rows.reload} />
      <div className="account-list">
        {rows.data?.map((account) => (
          <article className="panel compact-row" key={account.id}>
            <div>
              <h2>
                {account.username}{" "}
                {account.id === props.account.id && (
                  <span className="badge">You</span>
                )}
              </h2>
              <span>
                {account.role === "admin"
                  ? "Administrator"
                  : account.role === "editor"
                    ? "Editor"
                    : "Viewer"}{" "}
                · {account.disabled ? "Disabled" : "Active"}
              </span>
            </div>
            <button
              className="secondary"
              aria-label={`Manage ${account.username}`}
              onClick={() => setEditing(account)}
            >
              Manage
            </button>
          </article>
        ))}
      </div>
      {rows.data?.length === 0 && <Empty title="No accounts" />}
      {editing && (
        <AccountEditor
          key={editing === "new" ? "new" : editing.id}
          account={editing === "new" ? null : editing}
          currentAccountId={props.account.id}
          onClose={() => setEditing(null)}
          onSaved={(name) => {
            setEditing(null);
            setMessage(`Account saved: ${name}`);
            props.changed();
          }}
        />
      )}
    </>
  );
}
function AccountEditor({
  account,
  currentAccountId,
  onClose,
  onSaved,
}: {
  account: Account | null;
  currentAccountId: string;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const id = useId(),
    [busy, setBusy] = useState(false),
    [revoking, setRevoking] = useState(false),
    [password, setPassword] = useState(!account),
    [message, setMessage] = useState("");
  const remote = useRemote<Configuration>(
    account ? `/api/accounts/${account.id}/configuration` : null,
  );
  const current = remote.data;
  const footer = (
    <div className="actions">
      <button
        form={id}
        type="submit"
        disabled={busy || revoking || Boolean(account && !current)}
      >
        Save account
      </button>
      <ModalCancel />
      {account && (
        <Action
          secondary
          danger
          disabled={busy || revoking || remote.loading}
          label={`Revoke sessions for ${account.username}`}
          task={async () => {
            if (
              !(await confirmAction(
                `Sign ${account.username} out on every device? TVs will need to pair again. Unsaved account changes will remain here.`,
                {
                  title: `Revoke sessions for ${account.username}?`,
                  label: "Revoke sessions",
                },
              ))
            )
              return;
            setRevoking(true);
            try {
              await api(`/api/accounts/${account.id}/sessions`, "DELETE");
            } finally {
              setRevoking(false);
            }
            if (account.id === currentAccountId) {
              sessionStorage.setItem(
                "mytuner:notice",
                "Your sessions were revoked. Sign in again.",
              );
              window.dispatchEvent(new Event("mytuner:expired"));
            } else setMessage(`Sessions revoked for ${account.username}.`);
          }}
        >
          Revoke sessions
        </Action>
      )}
    </div>
  );
  return (
    <Modal
      title={account ? `Manage ${account.username}` : "Create account"}
      onClose={onClose}
      closeDisabled={busy || revoking}
      footer={footer}
    >
      <Load {...remote} retry={remote.reload} />
      {message && <p role="status">{message}</p>}
      {(!account || current) && (
        <Form
          id={id}
          hideActions
          onBusyChange={setBusy}
          onSave={async (data) => {
            if (revoking) return;
            const username = account?.username ?? value(data, "username");
            if (account && current) {
              const result = await api<{ revoked: boolean }>(
                `/api/accounts/${account.id}/configuration`,
                "PUT",
                {
                  revision: current.revision,
                  role: value(data, "role"),
                  disabled: data.has("disabled"),
                  ...(password
                    ? { password: String(data.get("password")) }
                    : {}),
                },
              );
              if (result.revoked && account.id === currentAccountId) {
                sessionStorage.setItem(
                  "mytuner:notice",
                  "Your account was updated. Sign in again.",
                );
                window.dispatchEvent(new Event("mytuner:expired"));
                return;
              }
            } else
              await api("/api/accounts", "POST", {
                username,
                password: String(data.get("password")),
                role: value(data, "role"),
              });
            onSaved(username);
          }}
        >
          {!account && (
            <Field
              label="Username"
              name="username"
              required
              minLength={3}
              maxLength={64}
              autoComplete="off"
            />
          )}
          <Select
            label="Role"
            name="role"
            defaultValue={current?.role ?? "viewer"}
          >
            <option value="viewer">Viewer · watch only</option>
            <option value="editor">Editor · manage assigned profiles</option>
            <option value="admin">Administrator · manage network</option>
          </Select>
          {account && (
            <>
              <label className="check">
                <input
                  name="disabled"
                  type="checkbox"
                  defaultChecked={current?.disabled}
                />
                Disable account
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={password}
                  onChange={(event) => setPassword(event.target.checked)}
                />
                Change password
              </label>
            </>
          )}
          {password && (
            <SecretFields
              label={account ? "New password" : "Password"}
              confirmLabel={
                account ? "Confirm new password" : "Confirm password"
              }
              required
            />
          )}
          {account && (
            <p>
              Changing role, enabled state or password signs this account out on
              all devices. An unchanged save keeps its sessions.
            </p>
          )}
        </Form>
      )}
    </Modal>
  );
}
