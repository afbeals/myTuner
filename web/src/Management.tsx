import { SubtitleSettings } from "./Subtitles";
import { EffectiveAccess, ImportReports, bytes } from "./Administration";
import { MetadataLocation } from "./MetadataEditor";
import { pairingPrefill } from "./pairing-link";
import { useEffect, useState } from "react";
import type { Workspace } from "./App";
import type { Account, Channel, GuideChannel, Profile, Source } from "./types";
import { api } from "./api";
import {
  Action,
  Empty,
  ErrorBox,
  Field,
  Form,
  Load,
  Modal,
  Select,
  useRemote,
  value,
  number,
} from "./ui";
export function AccountsPage(props: Workspace) {
  const rows = useRemote<Account[]>("/api/accounts", props.version),
    [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<Account | null>(null);
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Accounts & roles</h1>
          <p>
            Administrators create accounts. Profiles control what each person
            can watch.
          </p>
        </div>
        <button onClick={() => setCreating(true)}>+ Create account</button>
      </header>
      <Load {...rows} retry={rows.reload} />
      <section
        className="panel table-scroll account-table"
        aria-label="Accounts table"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th>Account</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.data?.map((a) => (
              <tr key={a.id}>
                <td>
                  {a.username}
                  {a.id === props.account.id && <small>Your account</small>}
                </td>
                <td>{a.role}</td>
                <td>{a.disabled ? "Disabled" : "Active"}</td>
                <td>
                  <button
                    className="secondary"
                    aria-label={`Manage ${a.username}`}
                    onClick={() => setSelected(a)}
                  >
                    Manage account
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {rows.data?.length === 0 && (
        <Empty title="No accounts to display">
          Create an account to grant access to your network.
        </Empty>
      )}
      {creating && (
        <Modal title="Create account" onClose={() => setCreating(false)}>
          <Form
            submit="Create account"
            onSave={async (d) => {
              await api("/api/accounts", "POST", {
                username: value(d, "username"),
                password: String(d.get("password")),
                role: value(d, "role"),
              });
              setCreating(false);
              props.changed();
            }}
          >
            <Field
              label="Username"
              name="username"
              required
              minLength={3}
              maxLength={64}
              autoComplete="off"
            />
            <Field
              label="Password"
              name="password"
              type="password"
              required
              minLength={12}
              maxLength={1024}
              autoComplete="new-password"
            />
            <RoleSelect />
          </Form>
        </Modal>
      )}
      {selected && (
        <Modal
          title={`Manage ${selected.username}`}
          onClose={() => setSelected(null)}
        >
          <div className="two-col">
            <Form
              submit="Save account"
              onSave={async (d) => {
                await api(`/api/accounts/${selected.id}`, "PATCH", {
                  role: value(d, "role"),
                  disabled: d.has("disabled"),
                });
                setSelected(null);
                props.changed();
              }}
            >
              <RoleSelect defaultValue={selected.role} />
              <label className="check">
                <input
                  type="checkbox"
                  name="disabled"
                  defaultChecked={selected.disabled}
                />
                Disable account and revoke access
              </label>
            </Form>
            <Form
              submit="Reset password"
              onSave={async (d) => {
                await api(`/api/accounts/${selected.id}/password`, "PUT", {
                  password: String(d.get("password")),
                });
                setSelected(null);
                props.changed();
              }}
            >
              <Field
                label="New password"
                name="password"
                type="password"
                required
                minLength={12}
                autoComplete="new-password"
              />
              <p>
                Changing a password signs out all sessions for this account.
              </p>
            </Form>
          </div>
          <Action
            secondary
            danger
            task={async () => {
              if (
                window.confirm(`Sign ${selected.username} out on every device?`)
              )
                await api(`/api/accounts/${selected.id}/sessions`, "DELETE");
            }}
          >
            Revoke all sessions
          </Action>
        </Modal>
      )}
    </>
  );
}
function RoleSelect({ defaultValue = "viewer" }: { defaultValue?: string }) {
  return (
    <Select label="Role" name="role" defaultValue={defaultValue}>
      <option value="viewer">Viewer · watch only</option>
      <option value="editor">Editor · manage assigned profiles</option>
      <option value="admin">Administrator · manage entire network</option>
    </Select>
  );
}
interface Settings {
  accounts: { accountId: string; username: string; canManage: boolean }[];
  grants: { sourceId: string; subtree: string }[];
}
export function ProfilesPage(props: Workspace) {
  const [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<Profile | null>(null),
    [kind, setKind] = useState("person");
  const accounts = useRemote<Account[]>(
    props.account.role === "admin" ? "/api/accounts" : null,
    props.version,
  );
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Profiles</h1>
          <p>Personal and shared room guides, with optional numeric TV PINs.</p>
        </div>
        {props.account.role === "admin" && (
          <button onClick={() => setCreating(true)}>+ Create profile</button>
        )}
      </header>
      <div className="library-grid">
        {props.profiles.map((p) => (
          <section className="panel" key={p.id}>
            <span className="badge">
              {p.kind === "room" ? "Room" : "Personal"}
            </span>
            <h2>{p.name}</h2>
            <p>
              {p.pinProtected ? "PIN protected" : "No PIN"}
              {p.locked ? " · Locked" : ""}
            </p>
            <button className="secondary" onClick={() => setSelected(p)}>
              Manage {p.name}
            </button>
          </section>
        ))}
      </div>
      {!props.profiles.length && (
        <Empty title="No profiles yet">
          Create a person or room profile to organize a guide.
        </Empty>
      )}
      {creating && (
        <Modal title="Create profile" onClose={() => setCreating(false)}>
          <Form
            submit="Create profile"
            onSave={async (d) => {
              await api("/api/profiles", "POST", {
                name: value(d, "name"),
                kind,
                ...(value(d, "owner")
                  ? { ownerAccountId: value(d, "owner") }
                  : {}),
              });
              setCreating(false);
              props.changed();
            }}
          >
            <Field label="Profile name" name="name" required maxLength={120} />
            <Select
              label="Profile type"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="person">Person</option>
              <option value="room">Shared room</option>
            </Select>
            <Select label="Owner" name="owner" required={kind === "person"}>
              <option value="">No assigned owner (rooms only)</option>
              {accounts.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.username}
                </option>
              ))}
            </Select>
          </Form>
        </Modal>
      )}
      {selected && (
        <Modal
          title={`Manage ${selected.name}`}
          onClose={() => setSelected(null)}
        >
          <ProfileSettings {...props} profile={selected} />
        </Modal>
      )}
    </>
  );
}
function ProfileSettings(props: Workspace & { profile: Profile }) {
  const admin = props.account.role === "admin",
    settings = useRemote<Settings>(
      admin ? `/api/profiles/${props.profile.id}/settings` : null,
      props.version,
    ),
    accounts = useRemote<Account[]>(admin ? "/api/accounts" : null),
    sources = useRemote<Source[]>(admin ? "/api/sources" : null);
  const refresh = () => {
    settings.reload();
    props.changed();
  };
  return (
    <div className="two-col">
      <div className="stack">
        {admin && <EffectiveAccess profileId={props.profile.id} />}
        {admin && <Load {...accounts} retry={accounts.reload} />}
        {admin && accounts.data && (
          <Form
            submit="Save profile"
            onSave={async (d) => {
              await api(`/api/profiles/${props.profile.id}`, "PATCH", {
                name: value(d, "name"),
                ownerAccountId: value(d, "owner") || null,
              });
              refresh();
            }}
          >
            <Field
              label="Profile name"
              name="name"
              required
              defaultValue={props.profile.name}
            />
            <Select
              label="Owner"
              name="owner"
              defaultValue={props.profile.ownerAccountId ?? ""}
              required={props.profile.kind === "person"}
            >
              <option value="">No assigned owner</option>
              {accounts.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.username}
                </option>
              ))}
            </Select>
          </Form>
        )}
        <Form
          submit="Set TV PIN"
          onSave={async (d) => {
            await api(`/api/profiles/${props.profile.id}/pin`, "PUT", {
              pin: value(d, "pin") || null,
            });
            refresh();
          }}
        >
          <Field
            label="Optional TV PIN"
            name="pin"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4,8}"
            hint="4–8 digits. Leave empty to remove the PIN."
            autoComplete="new-password"
          />
          <p>The TV PIN unlocks this profile after device pairing.</p>
        </Form>
        {admin && (
          <Form
            submit="Grant account access"
            disabled={!accounts.data || !settings.data}
            onSave={async (d) => {
              await api(
                `/api/profiles/${props.profile.id}/accounts/${value(d, "account")}`,
                "PUT",
                { canManage: d.has("manage") },
              );
              refresh();
            }}
          >
            <Select label="Account" name="account" required>
              {accounts.data?.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.username}
                </option>
              ))}
            </Select>
            <label className="check">
              <input type="checkbox" name="manage" />
              May manage this profile
            </label>
            {settings.data?.accounts.map((a) => (
              <div className="section-head" key={a.accountId}>
                <span>
                  {a.username} · {a.canManage ? "Manage" : "Watch only"}
                </span>
                <Action
                  secondary
                  task={async () => {
                    await api(
                      `/api/profiles/${props.profile.id}/accounts/${a.accountId}`,
                      "DELETE",
                    );
                    refresh();
                  }}
                >
                  Remove access
                </Action>
              </div>
            ))}
          </Form>
        )}
      </div>
      {admin && (
        <div className="stack">
          <Load {...settings} retry={settings.reload} />
          <Load {...sources} retry={sources.reload} />
          <Form
            submit="Add library grant"
            disabled={!sources.data || !settings.data}
            onSave={async (d) => {
              await api(`/api/profiles/${props.profile.id}/grants`, "POST", {
                sourceId: value(d, "source"),
                subtree: value(d, "subtree"),
              });
              refresh();
            }}
          >
            <h3>Allowed library</h3>
            <Select label="Source" name="source" required>
              {sources.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Field
              label="Subfolder"
              name="subtree"
              placeholder="Entire source"
              hint="Relative folder. Includes nested folders."
            />
            <p className="notice">
              Permissions apply to artwork, search and playback too.
            </p>
          </Form>
          {settings.data?.grants.map((g) => (
            <section className="panel" key={g.sourceId + g.subtree}>
              <h3>
                {sources.data?.find((s) => s.id === g.sourceId)?.name ??
                  "Source"}
              </h3>
              <p>{g.subtree || "Entire source"}</p>
              <Action
                secondary
                danger
                task={async () => {
                  if (
                    !window.confirm(
                      "Remove this library grant? Current playback may stop.",
                    )
                  )
                    return;
                  await api(
                    `/api/profiles/${props.profile.id}/grants`,
                    "DELETE",
                    g,
                  );
                  refresh();
                }}
              >
                Remove grant
              </Action>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
interface RefreshStatus {
  sourceId: string;
  provider: string | null;
  url: string | null;
  intervalMs: number | null;
  lastSuccess: number | null;
  lastError: string | null;
  status?: string;
}
export function SourcesPage(props: Workspace) {
  const [subtitleDirty, setSubtitleDirty] = useState(false);
  const sources = useRemote<Source[]>("/api/sources", props.version),
    statuses = useRemote<RefreshStatus[]>(
      "/api/admin/refresh",
      props.version,
      true,
    ),
    [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<Source | null>(null),
    [result, setResult] = useState<unknown>(null);
  const integration = useRemote<{
    provider: string;
    url: string;
    mappings: { from: string; to: string }[];
  } | null>(selected ? `/api/sources/${selected.id}/integration` : null);
  // Keep the open integration draft mounted when sibling source settings refresh
  // the workspace. Its own save/disconnect, reopening, or Retry reloads it.
  // Automatic refresh stays mounted while that integration request is pending.
  const refresh = () => {
    sources.reload();
    statuses.reload();
    props.changed();
  };
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Sources</h1>
          <p>
            Read existing shares in place. Add Sonarr or Radarr metadata when
            available.
          </p>
        </div>
        <button onClick={() => setCreating(true)}>+ Add source</button>
      </header>
      <Load {...sources} retry={sources.reload} />
      <div className="stack">
        {sources.data?.map((s) => {
          const status = statuses.data?.find((r) => r.sourceId === s.id);
          return (
            <section className="panel" key={s.id}>
              <div className="section-head">
                <h2>{s.name}</h2>
                <span className="badge">{s.kind}</span>
              </div>
              <p>
                {s.rootPath} ·{" "}
                {s.recursive ? "Includes subfolders" : "Top-level only"}
              </p>
              {status?.provider && (
                <p>
                  {status.provider} · {status.url}
                </p>
              )}
              {status?.lastError && <p className="error">{status.lastError}</p>}
              <div className="actions">
                <Action
                  task={async () => {
                    setResult(await api(`/api/sources/${s.id}/scan`, "POST"));
                    refresh();
                  }}
                >
                  Scan & refresh metadata
                </Action>
                <button className="secondary" onClick={() => setSelected(s)}>
                  Configure {s.name}
                </button>
              </div>
            </section>
          );
        })}
      </div>
      {sources.data?.length === 0 && (
        <Empty title="Add your first source">
          Mount Unraid shares read-only in the server, then enter their
          container paths.
        </Empty>
      )}
      {result !== null && (
        <section className="panel status-message">
          <h2>Last scan result</h2>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </section>
      )}
      {creating && (
        <Modal title="Add a source" onClose={() => setCreating(false)}>
          <Form
            submit="Add source"
            onSave={async (d) => {
              await api("/api/sources", "POST", {
                name: value(d, "name"),
                root: value(d, "root"),
                kind: value(d, "kind"),
                recursive: d.has("recursive"),
              });
              setCreating(false);
              refresh();
            }}
          >
            <Field label="Source name" name="name" required maxLength={120} />
            <Field
              label="Container media path"
              name="root"
              placeholder="/media/shows"
              required
              hint="Use the path visible inside the Docker container."
            />
            <Select label="Media type" name="kind">
              <option value="shows">TV shows · Sonarr optional</option>
              <option value="movies">Movies · Radarr optional</option>
              <option value="videos">Custom videos</option>
              <option value="commercials">Commercials</option>
            </Select>
            <label className="check">
              <input type="checkbox" name="recursive" defaultChecked />
              Include subfolders
            </label>
            <p className="notice">
              Original videos stay in place. Scanning does not start bulk
              generation.
            </p>
          </Form>
        </Modal>
      )}
      {selected && (
        <Modal
          title={`Configure ${selected.name}`}
          onClose={() => {
            if (
              !subtitleDirty ||
              window.confirm(
                "Discard subtitle settings? A save received by the server may still finish.",
              )
            )
              setSelected(null);
          }}
        >
          <ImportReports
            key={`imports:${selected.id}`}
            sourceId={selected.id}
          />
          <SubtitleSettings
            key={`subtitles:${selected.id}`}
            sourceId={selected.id}
            onSaved={refresh}
            onDirtyChange={setSubtitleDirty}
          />
          <MetadataLocation
            key={selected.id}
            sourceId={selected.id}
            initialRoot={selected.metadataRoot ?? null}
            onSaved={refresh}
          />
          <Load {...integration} retry={integration.reload} />
          <div className="two-col">
            {!integration.loading &&
              !integration.error &&
              ["shows", "movies"].includes(selected.kind) && (
                <Form
                  submit="Save metadata integration"
                  onSave={async (d) => {
                    await api(
                      `/api/sources/${selected.id}/integration`,
                      "PUT",
                      {
                        provider:
                          selected.kind === "shows" ? "sonarr" : "radarr",
                        url: value(d, "url"),
                        apiKey: value(d, "key"),
                        mappings: value(d, "mappings")
                          .split("\n")
                          .filter(Boolean)
                          .map((line) => {
                            const parts = line.split("=>");
                            if (parts.length !== 2)
                              throw new Error(
                                "Use one provider path => container path per line.",
                              );
                            return {
                              from: parts[0]!.trim(),
                              to: parts[1]!.trim(),
                            };
                          }),
                      },
                    );
                    integration.reload();
                    refresh();
                  }}
                >
                  <h3>
                    {selected.kind === "shows" ? "Sonarr" : "Radarr"} metadata
                  </h3>
                  <Field
                    label="Application URL"
                    name="url"
                    type="url"
                    defaultValue={integration.data?.url ?? ""}
                    required
                    placeholder="http://192.168.1.10:8989"
                  />
                  <Field
                    label="API key"
                    name="key"
                    type="password"
                    required
                    autoComplete="off"
                    hint="Saved encrypted on the server. Enter the key when changing configuration."
                  />
                  <label className="field">
                    <span>Path mappings</span>
                    <textarea
                      name="mappings"
                      required
                      placeholder="/tv => /media/shows"
                      defaultValue={
                        integration.data?.mappings
                          .map((m) => `${m.from} => ${m.to}`)
                          .join("\n") ?? ""
                      }
                    />
                  </label>
                  <p>
                    One provider path =&gt; container path per line. Metadata
                    access is read-only.
                  </p>
                  <Action
                    secondary
                    danger
                    task={async () => {
                      if (
                        window.confirm(
                          "Remove this metadata integration? Imported metadata will remain.",
                        )
                      ) {
                        await api(
                          `/api/sources/${selected.id}/integration`,
                          "DELETE",
                        );
                        integration.reload();
                        refresh();
                      }
                    }}
                  >
                    Disconnect integration
                  </Action>
                </Form>
              )}
            <Form
              submit="Save automatic refresh"
              onSave={async (d) => {
                await api(`/api/sources/${selected.id}/refresh`, "PUT", {
                  intervalMs: number(d, "minutes")
                    ? number(d, "minutes") * 60000
                    : null,
                });
                refresh();
              }}
            >
              <Field
                label="Refresh interval (minutes)"
                name="minutes"
                type="number"
                min={0}
                defaultValue={
                  (statuses.data?.find((s) => s.sourceId === selected.id)
                    ?.intervalMs ?? 0) / 60000
                }
                hint="Use 0 for manual refresh."
              />
              <p>Scans and optional metadata refresh run on the server.</p>
            </Form>
          </div>
        </Modal>
      )}
    </>
  );
}
export function SubscriptionsPage(props: Workspace) {
  const [lineupBusy, setLineupBusy] = useState(false);
  const channels = useRemote<Channel[]>(
      `/api/profiles/${props.profileId}/channels`,
      props.version,
    ),
    guide = useRemote<{ channels: GuideChannel[] }>(
      `/api/profiles/${props.profileId}/guide`,
      props.version,
    );
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Profile guide & subscriptions</h1>
          <p>
            Choose what appears for{" "}
            {props.profiles.find((p) => p.id === props.profileId)?.name}. Other
            users’ private channels stay hidden.
          </p>
        </div>
        <a href="#watch" className="button secondary">
          Open profile guide
        </a>
      </header>
      <section className="panel">
        <h2>Guide order</h2>
        <p>
          Move channels in this profile’s lineup. Browser/TV guides and
          previous/next tuning use this order.
        </p>
        {guide.data?.channels.map((c, index) => (
          <div className="section-head" key={c.id}>
            <strong>
              {index + 1}. {c.name}
            </strong>
            <div className="actions">
              {[-1, 1].map((delta) => (
                <Action
                  key={delta}
                  secondary
                  disabled={
                    lineupBusy ||
                    index + delta < 0 ||
                    index + delta >= guide.data!.channels.length
                  }
                  task={async () => {
                    setLineupBusy(true);
                    try {
                      const ids = guide.data!.channels.map((c) => c.id);
                      [ids[index], ids[index + delta]] = [
                        ids[index + delta]!,
                        ids[index]!,
                      ];
                      await api(
                        `/api/profiles/${props.profileId}/lineup`,
                        "PUT",
                        { channelIds: ids },
                      );
                      props.changed();
                      guide.reload();
                    } finally {
                      setLineupBusy(false);
                    }
                  }}
                >
                  {delta < 0 ? `Move ${c.name} up` : `Move ${c.name} down`}
                </Action>
              ))}
            </div>
          </div>
        ))}
      </section>
      <Load {...channels} retry={channels.reload} />
      <Load {...guide} retry={guide.reload} />
      <div className="stack">
        {channels.data?.map((c) => {
          const subscribed = guide.data?.channels.some((g) => g.id === c.id);
          return (
            <section className="panel section-head" key={c.id}>
              <div>
                <h2>{c.name}</h2>
                <p>
                  {c.visibility} ·{" "}
                  {subscribed ? "In this profile’s guide" : "Available to add"}
                </p>
              </div>
              <Action
                secondary={Boolean(subscribed)}
                disabled={!guide.data}
                task={async () => {
                  if (
                    subscribed &&
                    !window.confirm(
                      `Remove ${c.name} from this profile’s guide? Current playback will stop.`,
                    )
                  )
                    return;
                  await api(
                    `/api/profiles/${props.profileId}/subscriptions/${c.id}`,
                    subscribed ? "DELETE" : "PUT",
                  );
                  props.changed();
                }}
              >
                {subscribed ? "Unsubscribe" : "Subscribe"}
              </Action>
            </section>
          );
        })}
      </div>
      {channels.data?.length === 0 && (
        <Empty title="No channels available">
          Publish a channel using media this profile may access.
        </Empty>
      )}
    </>
  );
}
export function PairingPage() {
  const [done, setDone] = useState(false),
    [review, setReview] = useState<{
      code: string;
      deviceName: string;
      expiresMs: number;
    } | null>(null);
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Approve a TV connection</h1>
          <p>Open myTuner on your TV and enter the code it displays.</p>
        </div>
      </header>
      <div className="two-col">
        <Form
          submit={review ? "Approve TV" : "Review TV"}
          onSave={async (d) => {
            const code = value(d, "code").replace(/[\s-]/g, "").toUpperCase();
            if (!review || review.code !== code) {
              const result = await api<{
                deviceName: string;
                expiresMs: number;
              }>("/api/auth/pairings/review", "POST", { userCode: code });
              setReview({ ...result, code });
              return;
            }
            await api("/api/auth/pairings/approve", "POST", { userCode: code });
            setDone(true);
            setReview(null);
          }}
        >
          <Field
            label="TV connection code"
            name="code"
            defaultValue={pairingPrefill()}
            required
            minLength={10}
            maxLength={14}
            autoComplete="off"
            placeholder="ABCDE 12345"
            onChange={() => {
              setDone(false);
              setReview(null);
            }}
          />
          <p>
            Only approve a TV you recognize. Its access follows your account and
            profile permissions.
          </p>
          {review && (
            <section className="notice" aria-label="Review TV approval">
              <h2>{review.deviceName}</h2>
              <p>Server: {location.origin}</p>
              <p>
                Code: <strong>{review.code.match(/.{1,5}/g)?.join(" ")}</strong>{" "}
                · Expires {new Date(review.expiresMs).toLocaleTimeString()}
              </p>
              <p>
                Check that this exact code and device appear on your television.
                Approval uses your account’s viewing permissions; choose a
                profile on the TV afterward.
              </p>
              <button
                type="button"
                className="secondary"
                onClick={() => setReview(null)}
              >
                Cancel approval
              </button>
            </section>
          )}
          {done && (
            <p role="status" className="notice">
              TV approved. Choose a profile on your TV to continue.
            </p>
          )}
        </Form>
        <section className="panel">
          <h2>Connect to this server</h2>
          <p>On your TV, enter:</p>
          <strong>{location.origin}</strong>
          <p className="muted">
            Use your Unraid LAN address and published port. Localhost works only
            on the server itself.
          </p>
          <a href="#setup">Installation and connection help →</a>
        </section>
      </div>
    </>
  );
}
interface Session {
  id: string;
  kind: string;
  expiresAt: number;
  current: boolean;
}
export function SessionsPage() {
  const rows = useRemote<Session[]>("/api/auth/sessions");
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Devices & sessions</h1>
          <p>Revoke access for browsers or paired TVs you no longer use.</p>
        </div>
      </header>
      <Load {...rows} retry={rows.reload} />
      {rows.data?.length === 0 && (
        <Empty title="No active sessions">
          Devices appear here after signing in or pairing.
        </Empty>
      )}
      <div className="stack">
        {rows.data?.map((s) => (
          <section className="panel section-head" key={s.id}>
            <div>
              <h2>
                {s.kind === "device"
                  ? "Paired TV"
                  : s.kind === "browser"
                    ? "Browser"
                    : "API session"}
                {s.current ? " · This session" : ""}
              </h2>
              <p>Expires {new Date(s.expiresAt).toLocaleString()}</p>
            </div>
            <Action
              secondary
              danger
              task={async () => {
                if (
                  !window.confirm(
                    "Revoke this session? It will need to sign in or pair again.",
                  )
                )
                  return;
                await api(`/api/auth/sessions/${s.id}`, "DELETE");
                if (s.current)
                  window.dispatchEvent(new Event("mytuner:expired"));
                else rows.reload();
              }}
            >
              Revoke access
            </Action>
          </section>
        ))}
      </div>
    </>
  );
}
interface Job {
  id: string;
  status: string;
  directory: string;
  sourceId: string;
  total: number;
  completed: number;
  failed: number;
  error: string | null;
  items?: {
    id: string;
    mediaId: string;
    title?: string;
    relativePath?: string;
    kind: string;
    status: string;
    error: string | null;
    waitingReason?: string | null;
  }[];
}
interface GenerationPreview {
  count: number;
  items: { id: string; title: string }[];
  reusableOutputs: number;
  newOutputs: number;
  totalOutputs: number;
  totalDurationMs: number;
  availableBytes: number | null;
}
interface Scope {
  sourceId: string;
  directory: string;
  recursive: boolean;
  kinds: string[];
  regenerate: boolean;
}
interface CleanupReview {
  dryRun: boolean;
  review: string;
  staleAssets: number;
  missingReferences: number;
  orphanFiles: number;
  interruptedFiles: number;
  preservedUnknownFiles: number;
  reclaimableBytes: number;
  removedFiles: number;
  removedReferences: number;
}
export function GenerationPage(props: Workspace) {
  const sources = useRemote<Source[]>("/api/sources"),
    jobs = useRemote<Job[]>("/api/admin/generation", props.version, true),
    [selected, setSelected] = useState<string | null>(null),
    [tick, setTick] = useState(0),
    [scope, setScope] = useState<Scope | null>(null),
    [preview, setPreview] = useState<GenerationPreview | null>(null),
    [cleanup, setCleanup] = useState<CleanupReview | null>(null),
    [cleanupBusy, setCleanupBusy] = useState(false);
  const job = useRemote<Job>(
    selected ? `/api/generation/jobs/${selected}` : null,
    tick,
    true,
  );
  useEffect(() => {
    const timer = setInterval(() => {
      setTick((v) => v + 1);
    }, 3000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    jobs.reload();
  }, [tick]);
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Generated assets</h1>
          <p>
            Optional previews and compatible conversions, stored separately from
            your originals.
          </p>
        </div>
      </header>
      <div className="two-col">
        <Form
          submit="Preview scope"
          disabled={!sources.data?.length}
          onSave={async (d) => {
            const input: Scope = {
              sourceId: value(d, "source"),
              directory: value(d, "directory"),
              recursive: d.has("recursive"),
              kinds: d.getAll("kinds").map(String),
              regenerate: d.has("regenerate"),
            };
            if (!input.kinds.length)
              throw new Error("Choose at least one output.");
            const r = await api<GenerationPreview>(
              "/api/generation/preview",
              "POST",
              input,
            );
            setScope(input);
            setPreview(r);
          }}
        >
          <h2>Choose files & outputs</h2>
          <Load {...sources} retry={sources.reload} />
          {sources.data?.length === 0 && (
            <p>Add a source before generating outputs.</p>
          )}
          <Select label="Source" name="source" required>
            {sources.data?.map((s) => (
              <option value={s.id} key={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Field
            label="Folder within source"
            name="directory"
            placeholder="Entire source"
          />
          <label className="check">
            <input type="checkbox" name="recursive" />
            Include subfolders
          </label>
          {[
            ["thumbnail", "320px JPEG thumbnails"],
            ["gif", "Short GIF previews"],
            ["conversion", "Compatible MP4 conversions"],
          ].map(([id, label]) => (
            <label className="check" key={id}>
              <input
                name="kinds"
                type="checkbox"
                value={id}
                defaultChecked={id === "thumbnail"}
              />
              {label}
            </label>
          ))}
          <label className="check">
            <input type="checkbox" name="regenerate" />
            Regenerate existing outputs
          </label>
          <p>
            Valid outputs are reused by default. Conversions use a fixed CPU
            preset and can take time.
          </p>
        </Form>
        <section className="panel">
          <h2>Generation queue</h2>
          <Load {...jobs} retry={jobs.reload} />
          {jobs.data?.length === 0 && (
            <p>No jobs yet. Preview a folder to get started.</p>
          )}
          <div className="stack">
            {jobs.data?.map((j) => (
              <div className="job-item" key={j.id}>
                <strong>
                  {sources.data?.find((s) => s.id === j.sourceId)?.name ??
                    "Source"}{" "}
                  / {j.directory || "Entire source"}
                </strong>
                <p>
                  {j.status} · {j.completed ?? 0}/{j.total} completed ·{" "}
                  {j.failed ?? 0} failed
                </p>
                <button className="secondary" onClick={() => setSelected(j.id)}>
                  View job
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="panel status-message" aria-label="Output storage">
        <h2>Output storage</h2>
        <p>
          Review stale outputs, missing references and orphaned generated files
          before applying cleanup. Only managed outputs are removed; original
          media stays in place. Wait for active generation to finish.
        </p>
        <div className="actions">
          <Action
            secondary
            disabled={cleanupBusy}
            task={async () => {
              setCleanupBusy(true);
              setCleanup(null);
              try {
                setCleanup(
                  await api<CleanupReview>(
                    "/api/admin/assets/cleanup",
                    "POST",
                    { dryRun: true, reconcile: true },
                  ),
                );
              } finally {
                setCleanupBusy(false);
              }
            }}
          >
            Review cleanup
          </Action>
          {cleanup?.dryRun && (
            <Action
              secondary
              danger
              disabled={cleanupBusy}
              task={async () => {
                if (
                  !window.confirm(
                    "Apply this output reconciliation review? Stale/orphan files and missing references will be removed. You can regenerate missing outputs afterward.",
                  )
                )
                  return;
                setCleanupBusy(true);
                try {
                  setCleanup(
                    await api<CleanupReview>(
                      "/api/admin/assets/cleanup",
                      "POST",
                      {
                        dryRun: false,
                        reconcile: true,
                        review: cleanup.review,
                      },
                    ),
                  );
                } finally {
                  setCleanupBusy(false);
                }
              }}
            >
              Apply reviewed cleanup
            </Action>
          )}
        </div>
        {cleanup && (
          <>
            <p role="status">
              {cleanup.dryRun
                ? "Review ready. No files or references have changed."
                : `Cleanup complete: ${cleanup.removedFiles} files and ${cleanup.removedReferences} references removed.`}
            </p>
            <dl className="inspection-details">
              <dt>Stale outputs</dt>
              <dd>{cleanup.staleAssets}</dd>
              <dt>Missing output references</dt>
              <dd>{cleanup.missingReferences}</dd>
              <dt>Orphaned generated files</dt>
              <dd>{cleanup.orphanFiles}</dd>
              <dt>Interrupted output files</dt>
              <dd>{cleanup.interruptedFiles}</dd>
              <dt>Unknown files preserved</dt>
              <dd>{cleanup.preservedUnknownFiles}</dd>
              <dt>Reclaimable storage in this review</dt>
              <dd>{bytes(cleanup.reclaimableBytes)}</dd>
            </dl>
            <p>
              Regeneration is a separate action. If outputs change or a review
              expires, review cleanup again before applying.
            </p>
          </>
        )}
      </section>
      {preview && scope && (
        <Modal
          title="Confirm generation scope"
          onClose={() => setPreview(null)}
        >
          <p>
            {preview.count} files · {scope.kinds.length} output types ·{" "}
            {scope.recursive ? "Including subfolders" : "This folder only"}
          </p>
          <p>
            {preview.totalOutputs} requested outputs · {preview.reusableOutputs}{" "}
            reusable · {preview.newOutputs} new. Total source duration:{" "}
            {(preview.totalDurationMs / 60000).toFixed(1)} minutes. Output
            storage headroom: {bytes(preview.availableBytes)}. Size and time
            estimates are unknown.
          </p>
          <ul>
            {preview.items.slice(0, 20).map((i) => (
              <li key={i.id}>{i.title}</li>
            ))}
          </ul>
          {preview.count > 20 && <p>And {preview.count - 20} more files.</p>}
          <Action
            disabled={!preview.count}
            task={async () => {
              const j = await api<Job>("/api/generation/jobs", "POST", scope);
              setPreview(null);
              setSelected(j.id);
              props.changed();
            }}
          >
            Start generation
          </Action>
        </Modal>
      )}
      {selected && (
        <Modal title="Generation progress" onClose={() => setSelected(null)}>
          <Load {...job} retry={job.reload} />
          {job.data && (
            <>
              <p role="status">
                {job.data.status} · {job.data.completed}/{job.data.total}{" "}
                outputs completed · {job.data.failed} failed
              </p>
              <progress
                aria-label="Generation progress"
                max={Math.max(1, job.data.total)}
                value={job.data.completed + job.data.failed}
              />
              <ErrorBox error={job.data.error} />
              <div className="stack">
                {job.data.items?.map((i) => (
                  <div className="job-item" key={i.id}>
                    <strong>
                      {i.kind} · {i.status}
                    </strong>
                    <small>{i.title ?? "Video"}</small>
                    <small>{i.relativePath ?? ""}</small>
                    {i.waitingReason === "playback-capacity" && (
                      <p role="status">Waiting for playback capacity</p>
                    )}
                    {i.error && <p className="error">{i.error}</p>}
                  </div>
                ))}
              </div>
              <div className="actions">
                {["queued", "running"].includes(job.data.status) && (
                  <Action
                    secondary
                    danger
                    task={async () => {
                      if (
                        !window.confirm(
                          "Cancel unfinished generation? Completed outputs remain available. Original media is unchanged.",
                        )
                      )
                        return;
                      await api(
                        `/api/generation/jobs/${selected}/cancel`,
                        "POST",
                      );
                      job.reload();
                    }}
                  >
                    Cancel job
                  </Action>
                )}
                {["failed", "cancelled"].includes(job.data.status) && (
                  <Action
                    task={async () => {
                      await api(
                        `/api/admin/generation/${selected}/retry`,
                        "POST",
                      );
                      job.reload();
                    }}
                  >
                    Retry unfinished outputs
                  </Action>
                )}
              </div>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
export function HelpPage() {
  return (
    <main className="help panel">
      <a href="#channels">← Back to myTuner</a>
      <h1>Your television network</h1>
      <h2>Start the Unraid server</h2>
      <ol>
        <li>
          Use the repository’s Docker Compose configuration. Mount your existing
          shares under <code>/media</code> with read-only access and keep data,
          generated files and cache on writable appdata volumes.
        </li>
        <li>
          Create the first administrator with{" "}
          <code>
            docker compose run --rm -e MYTUNER_ADMIN_PASSWORD mytuner node
            dist/bootstrap.js admin
          </code>
          . Set MYTUNER_ADMIN_PASSWORD in your shell first; no default password
          exists.
        </li>
        <li>
          Open <code>http://UNRAID-LAN-IP:8777</code> in your browser. Sign in,
          add sources, scan, create profiles and grant access.
        </li>
        <li>
          Publish channel programming and subscribe each profile to its
          channels.
        </li>
      </ol>
      <h2>Back up and recover the application</h2>
      <p>
        Backups are triggered by an operator. This application does not schedule
        recurring backups. A completed bundle contains the database, manifest
        and matching integration encryption key; media and derivatives stay
        outside it.
      </p>
      <ol>
        <li>
          While the server is running, use{" "}
          <code>docker compose exec mytuner node dist/backup-cli.js</code>.
          Record the completed snapshot directory printed by the command.
        </li>
        <li>
          Check that complete bundle with{" "}
          <code>
            docker compose exec mytuner node dist/verify-cli.js
            /app/data/backups/SNAPSHOT --json
          </code>
          . Verification checks database integrity, migrations and encryption
          keys; it does not test media mounts.
        </li>
        <li>
          Before restoring, stop the application. Use the same compatible image
          with{" "}
          <code>
            docker compose run --rm mytuner node dist/restore-cli.js
            /app/data/backups/SNAPSHOT
          </code>
          , then start it again. Restore revokes all sessions; sign in and pair
          TVs again.
        </li>
      </ol>
      <p>
        Retain complete bundles and the previous tested image separately.
        Copying a live SQLite file is insufficient. Nonempty WAL-bearing inputs
        are rejected. Detailed recovery, interrupted-restore and rollback steps
        are in <code>docs/OPERATIONS.md</code>.
      </p>
      <h2>Install on your TV or Fire TV</h2>
      <ol>
        <li>
          Use an Android/Google TV television or Android-based Fire OS stick.
          Amazon Vega devices require a different client.
        </li>
        <li>
          Enable developer options and ADB debugging on your device. Use its
          displayed pairing/address instructions; recent Google TV models use
          separate pairing and connect ports.
        </li>
        <li>
          Build the APK from the <code>android/</code> directory using the
          documented Gradle command. Return to the repository root, then install
          from your computer with{" "}
          <code>
            adb install -r android/app/build/outputs/apk/debug/app-debug.apk
          </code>
          .
        </li>
        <li>
          Open myTuner from the TV launcher. Enter the server’s LAN URL, such as{" "}
          <code>http://192.168.1.20:8777</code>.
        </li>
        <li>
          In this browser, open Connect TV and approve the exact code on the
          television. Select your profile on the TV, enter its PIN if required,
          then choose a channel.
        </li>
      </ol>
      <p>
        If the server is unreachable, check the Unraid published port and your
        network’s TV-to-server routing. Separate IoT networks may need a router
        firewall rule.
      </p>
      <p>
        The detailed model-specific steps, build requirements and
        troubleshooting are in <code>docs/TV_INSTALLATION.md</code> in the
        checkout.
      </p>
    </main>
  );
}
