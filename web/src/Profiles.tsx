import { useDraftNavigation } from "./navigation";
import { SubscriptionsModal } from "./Subscriptions";
import { useEffect, useId, useState } from "react";
import type { Workspace } from "./App";
import type { Account, Profile, Source } from "./types";
import { api, ApiError } from "./api";
import { confirmAction } from "./confirmation";
import { DirectoryTree, catalogDirectoryLoader } from "./DirectoryTree";
import { SecretFields } from "./SecretFields";
import { Info } from "./Info";
import { EffectiveAccess } from "./Administration";
import {
  Action,
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
  value,
} from "./ui";
type Configuration = {
  id: string;
  name: string;
  kind: "person" | "room";
  ownerAccountId: string | null;
  pinProtected: boolean;
  revision: string;
  accounts: { accountId: string; canManage: boolean }[];
  grants: { sourceId: string; subtree: string }[];
};
type CardProfile = Profile & {
  canManage?: boolean;
  ownerName?: string;
  accountCount?: number;
  grantCount?: number;
};
export function ProfilesPage(
  props: Workspace & { initialSubscriptions?: string },
) {
  const [subscriptions, setSubscriptions] = useState<string | null>(
      props.initialSubscriptions ?? null,
    ),
    [selected, setSelected] = useState<string | null>(null),
    [creating, setCreating] = useState(false),
    [message, setMessage] = useState("");
  return (
    <>
      <header className="page-head">
        <h1 aria-label="Profiles">
          Profiles{" "}
          <Info title="Profiles and access">
            A profile holds its library permissions and channel lineup. Accounts
            sign in; profile owners and assigned editors manage permitted
            profiles. A TV PIN protects profile entry.
          </Info>
        </h1>
        {props.account.role === "admin" && (
          <button onClick={() => setCreating(true)}>Create profile</button>
        )}
      </header>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <div className="library-grid">
        {props.profiles.map((raw) => {
          const profile = raw as CardProfile,
            manage =
              profile.canManage ??
              (props.account.role === "admin" ||
                (props.account.role === "editor" &&
                  profile.ownerAccountId === props.account.id));
          return (
            <article className="panel profile-summary" key={profile.id}>
              <span className="badge">
                {profile.kind === "person" ? "Personal" : "Room"}
              </span>
              <h2>{profile.name}</h2>
              <p>
                {profile.pinProtected ? "PIN protected" : "No PIN"}
                {profile.locked ? " · Locked" : ""}
              </p>
              {props.account.role === "admin" && (
                <p>
                  Owner: {profile.ownerName ?? "Shared room"}
                  <br />
                  {profile.accountCount ?? 0} assigned accounts ·{" "}
                  {profile.grantCount ?? 0} library grants
                </p>
              )}
              <div className="actions">
                {manage && (
                  <button
                    className="secondary"
                    aria-label={`Manage ${profile.name}`}
                    onClick={() => setSelected(profile.id)}
                  >
                    Manage
                  </button>
                )}
                {manage && (
                  <button
                    className="secondary"
                    aria-label={`Subscriptions for ${profile.name}`}
                    onClick={() => setSubscriptions(profile.id)}
                  >
                    Subscriptions
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {subscriptions && (
        <SubscriptionsModal
          key={subscriptions}
          profileId={subscriptions}
          profileName={
            props.profiles.find((profile) => profile.id === subscriptions)
              ?.name ?? "profile"
          }
          admin={props.account.role === "admin"}
          onClose={() => setSubscriptions(null)}
          onUnlocked={props.changed}
          onSaved={() => {
            setSubscriptions(null);
            setMessage("Subscriptions saved.");
            props.changed();
          }}
        />
      )}
      {creating && (
        <CreateProfile
          {...props}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            setMessage("Profile created.");
            props.changed();
          }}
        />
      )}
      {selected && (
        <ProfileEditor
          key={selected}
          {...props}
          id={selected}
          onClose={() => setSelected(null)}
          onSaved={(name) => {
            setSelected(null);
            setMessage(`Profile saved: ${name}`);
            props.changed();
          }}
          onDeleted={(name) => {
            setSelected(null);
            setMessage(
              `Profile deleted: ${name}. Source files and account-owned channels were kept.`,
            );
            props.changed();
          }}
        />
      )}
    </>
  );
}
function CreateProfile(
  props: Workspace & { onClose: () => void; onSaved: () => void },
) {
  const id = useId(),
    accounts = useRemote<Account[]>("/api/accounts"),
    [kind, setKind] = useState("person"),
    [owner, setOwner] = useState(props.account.id),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Create profile"
      onClose={props.onClose}
      closeDisabled={busy}
      footer={
        <div className="actions">
          <button type="submit" form={id} disabled={busy || accounts.loading}>
            Create profile
          </button>
          <ModalCancel />
        </div>
      }
    >
      <Load {...accounts} retry={accounts.reload} />
      <Form
        id={id}
        hideActions
        onBusyChange={setBusy}
        onSave={async (data) => {
          await api("/api/profiles", "POST", {
            name: value(data, "name"),
            kind,
            ...(value(data, "owner")
              ? { ownerAccountId: value(data, "owner") }
              : {}),
          });
          props.onSaved();
        }}
      >
        <Field label="Profile name" name="name" required maxLength={120} />
        <Select
          label="Profile type"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="person">Personal</option>
          <option value="room">Shared room</option>
        </Select>
        <Select
          label="Owner"
          name="owner"
          required={kind === "person"}
          value={owner}
          onChange={(event) => setOwner(event.target.value)}
        >
          {kind === "room" && <option value="">No owner · shared room</option>}
          {accounts.data?.map((account) => (
            <option key={account.id} value={account.id}>
              {account.username} · {account.role}
              {account.disabled ? " · disabled" : ""}
            </option>
          ))}
        </Select>
      </Form>
    </Modal>
  );
}
function ProfileEditor(
  props: Workspace & {
    id: string;
    onClose: () => void;
    onSaved: (name: string) => void;
    onDeleted: (name: string) => void;
  },
) {
  const admin = props.account.role === "admin",
    formId = useId(),
    remote = useRemote<Configuration>(
      `/api/profiles/${props.id}/configuration`,
    ),
    accounts = useRemote<Account[]>(admin ? "/api/accounts" : null),
    sources = useRemote<Source[]>(admin ? "/api/sources" : null);
  const [draft, setDraft] = useState<Configuration | null>(null),
    [dirty, setDirty] = useState(false),
    [recoveryVersion, setRecoveryVersion] = useState(0),
    [busy, setBusy] = useState(false),
    [pinIntent, setPinIntent] = useState("keep"),
    [source, setSource] = useState(""),
    [tree, setTree] = useState(false),
    [error, setError] = useState<unknown>(null),
    [impact, setImpact] = useState<{
      canDelete: boolean;
      retained: Record<string, number>;
      settings: Record<string, number>;
    } | null>(null);
  useEffect(() => {
    if (remote.data && !draft) setDraft(remote.data);
  }, [remote.data, draft]);
  useEffect(() => {
    if (
      remote.error instanceof ApiError &&
      [401, 403, 404].includes(remote.error.status)
    ) {
      setDraft(null);
      setDirty(false);
      setTree(false);
    }
  }, [remote.error]);
  useDraftNavigation(dirty || busy);
  const change = (next: Partial<Configuration>) => {
    setDraft((old) => (old ? { ...old, ...next } : null));
    setDirty(true);
  };
  const footer = (
    <div className="actions">
      <button type="submit" form={formId} disabled={busy || !draft}>
        Save profile
      </button>
      <ModalCancel />
      {admin && (
        <Action
          secondary
          danger
          disabled={busy || !draft}
          label={`Delete profile ${draft?.name ?? ""}`}
          task={async () => {
            setBusy(true);
            setError(null);
            try {
              const result = await api<{
                revision: string;
                canDelete: boolean;
                retained: Record<string, number>;
                settings: Record<string, number>;
              }>(`/api/profiles/${props.id}/dependencies`);
              setImpact(result);
              if (!result.canDelete) return;
              if (result.revision !== draft!.revision)
                throw new Error(
                  "This profile changed elsewhere. Reopen it before deleting.",
                );
              if (
                !(await confirmAction(
                  `Delete profile “${draft!.name}” and its access settings and subscriptions? Unsaved edits will be discarded. Original media and account-owned channels are kept.`,
                  { title: `Delete ${draft!.name}?`, label: "Delete profile" },
                ))
              )
                return;
              await api(`/api/profiles/${props.id}`, "DELETE", {
                revision: draft!.revision,
              });
              props.onDeleted(draft!.name);
            } catch (failure) {
              setError(failure);
            } finally {
              setBusy(false);
            }
          }}
        >
          Delete profile
        </Action>
      )}
    </div>
  );
  return (
    <Modal
      title={`Manage ${draft?.name ?? "profile"}`}
      onClose={props.onClose}
      closeDisabled={busy}
      footer={footer}
    >
      <Load {...remote} retry={remote.reload} />
      <ErrorBox error={error} />
      {impact && !impact.canDelete && (
        <p role="alert" className="notice">
          Deletion blocked:{" "}
          {Object.entries(impact.retained)
            .filter(([, count]) => count)
            .map(([kind, count]) => `${count} ${kind}`)
            .join(", ")}
          . Keep the profile until these references are reassigned or expire.
        </p>
      )}
      {draft && (
        <div data-form-dirty={dirty}>
          <Form
            key={`${draft.revision}:${recoveryVersion}`}
            id={formId}
            guardDraft={false}
            hideActions
            disabled={busy}
            onBusyChange={setBusy}
            renderError={(failure) => (
              <>
                {submissionErrorMessage(failure)}
                <SettingsRecovery
                  error={failure}
                  load={() =>
                    api<Configuration>(
                      `/api/profiles/${props.id}/configuration`,
                    )
                  }
                  apply={(latest) => {
                    setDraft(latest);
                    setDirty(false);
                    setPinIntent("keep");
                    setTree(false);
                    setRecoveryVersion((version) => version + 1);
                  }}
                  describe={(latest) => (
                    <>
                      <p>
                        {latest.name} ·{" "}
                        {latest.kind === "person" ? "Personal" : "Shared room"}{" "}
                        · Owner:{" "}
                        {accounts.data?.find(
                          (account) => account.id === latest.ownerAccountId,
                        )?.username ?? "No owner"}
                      </p>
                      <p>
                        {latest.accounts.length} assigned accounts ·{" "}
                        {latest.grants.length} library grants ·{" "}
                        {latest.pinProtected ? "PIN protected" : "No PIN"}
                      </p>
                      <p>
                        Saved PIN digits are never returned. Review the current
                        protection state before deciding whether to reapply a
                        PIN change.
                      </p>
                    </>
                  )}
                />
              </>
            )}
            onSave={async (data) => {
              const body = {
                revision: draft.revision,
                ...(admin
                  ? {
                      name: draft.name,
                      kind: draft.kind,
                      ownerAccountId: draft.ownerAccountId,
                      accounts: draft.accounts,
                      grants: draft.grants,
                    }
                  : {}),
                ...(pinIntent === "change"
                  ? { pin: String(data.get("pin")) }
                  : pinIntent === "remove"
                    ? { pin: null }
                    : {}),
              };
              await api(`/api/profiles/${props.id}/configuration`, "PUT", body);
              props.onSaved(draft.name);
            }}
          >
            {admin && (
              <>
                <Field
                  label="Profile name"
                  value={draft.name}
                  onChange={(event) => change({ name: event.target.value })}
                  required
                  maxLength={120}
                />
                <div className="two-col">
                  <Select
                    label="Profile type"
                    value={draft.kind}
                    onChange={(event) =>
                      change({
                        kind: event.target.value as Configuration["kind"],
                      })
                    }
                  >
                    <option value="person">Personal</option>
                    <option value="room">Shared room</option>
                  </Select>
                  <Select
                    label="Owner"
                    required={draft.kind === "person"}
                    value={draft.ownerAccountId ?? ""}
                    onChange={(event) =>
                      change({ ownerAccountId: event.target.value || null })
                    }
                  >
                    <option value="">No owner · room only</option>
                    {accounts.data?.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.username} · {account.role}
                      </option>
                    ))}
                  </Select>
                </div>
              </>
            )}
            <section className="settings-section">
              <h3>TV PIN</h3>
              <Select
                label="PIN action"
                value={pinIntent}
                onChange={(event) => {
                  setPinIntent(event.target.value);
                  setDirty(true);
                }}
              >
                <option value="keep">
                  {draft.pinProtected ? "Keep existing PIN" : "No PIN"}
                </option>
                <option value="change">
                  {draft.pinProtected ? "Change PIN" : "Set PIN"}
                </option>
                {draft.pinProtected && (
                  <option value="remove">Remove PIN</option>
                )}
              </Select>
              {pinIntent === "change" && (
                <SecretFields
                  name="pin"
                  kind="pin"
                  label="New TV PIN"
                  confirmLabel="Confirm TV PIN"
                  required
                />
              )}
              {pinIntent !== "keep" && (
                <p>TVs must unlock this profile again after the PIN changes.</p>
              )}
            </section>
            {admin && (
              <>
                <section className="settings-section">
                  <h3>
                    Account access{" "}
                    <Info title="Watch and manage">
                      Owners and administrators have implicit access. Viewers
                      can watch; only assigned editors can manage.
                      Private-channel ownership remains separate.
                    </Info>
                  </h3>
                  <Load {...accounts} retry={accounts.reload} />
                  <div className="bounded-checklist">
                    {accounts.data?.map((account) => {
                      const grant = draft.accounts.find(
                          (item) => item.accountId === account.id,
                        ),
                        implicit =
                          account.role === "admin" ||
                          account.id === draft.ownerAccountId;
                      return (
                        <div className="access-row" key={account.id}>
                          <span>
                            <strong>{account.username}</strong>
                            <small>
                              {account.role}
                              {account.disabled ? " · disabled" : ""}
                              {implicit ? " · implicit access" : ""}
                            </small>
                          </span>
                          <label>
                            <input
                              type="checkbox"
                              aria-label={`Allow ${account.username} to watch ${draft.name}`}
                              checked={implicit || Boolean(grant)}
                              disabled={implicit}
                              onChange={(event) =>
                                change({
                                  accounts: event.target.checked
                                    ? [
                                        ...draft.accounts,
                                        {
                                          accountId: account.id,
                                          canManage: false,
                                        },
                                      ]
                                    : draft.accounts.filter(
                                        (item) => item.accountId !== account.id,
                                      ),
                                })
                              }
                            />
                            Watch
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              aria-label={`Allow ${account.username} to manage ${draft.name}`}
                              checked={
                                account.role === "admin" ||
                                (account.id === draft.ownerAccountId &&
                                  account.role === "editor") ||
                                (account.role === "editor" &&
                                  Boolean(grant?.canManage))
                              }
                              disabled={
                                implicit || account.role !== "editor" || !grant
                              }
                              onChange={(event) =>
                                change({
                                  accounts: draft.accounts.map((item) =>
                                    item.accountId === account.id
                                      ? {
                                          ...item,
                                          canManage: event.target.checked,
                                        }
                                      : item,
                                  ),
                                })
                              }
                            />
                            Manage
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </section>
                <section className="settings-section">
                  <h3>Allowed library</h3>
                  <Load {...sources} retry={sources.reload} />
                  <div className="actions">
                    <Select
                      label="Library source"
                      value={source}
                      onChange={(event) => {
                        event.stopPropagation();
                        setSource(event.target.value);
                      }}
                    >
                      <option value="">Choose source</option>
                      {sources.data?.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </Select>
                    <button
                      type="button"
                      className="secondary"
                      disabled={!source}
                      onClick={() => setTree(true)}
                    >
                      Choose folders
                    </button>
                  </div>
                  <div className="bounded-checklist">
                    {draft.grants.map((grant) => (
                      <label
                        className="grant-row"
                        key={`${grant.sourceId}:${grant.subtree}`}
                      >
                        <input
                          type="checkbox"
                          checked
                          onChange={() =>
                            change({
                              grants: draft.grants.filter(
                                (item) => item !== grant,
                              ),
                            })
                          }
                        />
                        <span>
                          <strong>
                            {sources.data?.find(
                              (item) => item.id === grant.sourceId,
                            )?.name ?? "Source"}
                          </strong>
                          <small>{grant.subtree || "Entire source"}</small>
                        </span>
                      </label>
                    ))}
                    {!draft.grants.length && (
                      <p>No library grants. Choose a source and folders.</p>
                    )}
                  </div>
                </section>
                <details>
                  <summary>Check an account’s saved access</summary>
                  <p>
                    These are saved permissions. Unsaved changes above take
                    effect after Save.
                  </p>
                  <EffectiveAccess
                    profileId={props.id}
                    version={props.version}
                  />
                </details>
              </>
            )}
          </Form>
        </div>
      )}
      {tree && draft && (
        <DirectoryTree
          identity={`${props.id}:${source}:${props.version}`}
          title="Allowed library folders"
          rootLabel={
            sources.data?.find((item) => item.id === source)?.name ?? "Source"
          }
          multiple
          initial={draft.grants
            .filter((item) => item.sourceId === source)
            .map((item) => item.subtree)}
          load={catalogDirectoryLoader(props.id, source, "all")}
          onApply={(paths) => {
            change({
              grants: [
                ...draft.grants.filter((item) => item.sourceId !== source),
                ...paths.map((subtree) => ({ sourceId: source, subtree })),
              ],
            });
            setTree(false);
          }}
          onClose={() => setTree(false)}
        />
      )}
    </Modal>
  );
}
