import { SecretField } from "./SecretFields";
import { NetworkPage } from "./Network";
import { OperationsPage } from "./Administration";
import { allowNavigation } from "./navigation";
import { readResourceRoute, type ResourceTarget } from "./resource-route";
import { currentRoute } from "./pairing-link";
import { version as appVersion } from "../../package.json";
import { useEffect, useRef, useState } from "react";
import { api, setCsrf, ApiError } from "./api";
import type { Account, Profile, Selection } from "./types";
import { Field, Form, ErrorBox, Select, Modal } from "./ui";
import { ChannelsPage } from "./Channels";
import { LibraryPage } from "./Library";
import {
  AccountsPage,
  ProfilesPage,
  SourcesPage,
  GenerationPage,
  PairingPage,
  SessionsPage,
  SubscriptionsPage,
  HelpPage,
} from "./Management";
import { ReportsInbox } from "./Retained";
import { WatchPage } from "./Player";
export interface Workspace {
  account: Account;
  profiles: Profile[];
  profileId: string;
  version: number;
  changed: () => void;
  watch: (id: string) => void;
  resource?: ResourceTarget | null;
  chooseProfile?: () => void;
}
export function App() {
  const [account, setAccount] = useState<Account | null>(null),
    [profiles, setProfiles] = useState<Profile[]>([]),
    [profilesLoaded, setProfilesLoaded] = useState(false),
    [profilesError, setProfilesError] = useState<unknown>(null),
    [profileId, setProfileId] = useState(""),
    [requestedPage, setPage] = useState(currentRoute()),
    [resource, setResource] = useState(readResourceRoute()),
    [version, setVersion] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<unknown>(null),
    [identityTick, setIdentityTick] = useState(0),
    [startupAccount, setStartupAccount] = useState<Account | null>(null),
    [startupError, setStartupError] = useState<unknown>(null),
    [startupBusy, setStartupBusy] = useState(false),
    [menu, setMenu] = useState(false),
    [profilePicker, setProfilePicker] = useState(false),
    [watchId, setWatchId] = useState<string | null>(null),
    [draft, setDraft] = useState<Selection | null>(null);
  const page =
    account?.role === "viewer" &&
    [
      "channels",
      "library",
      "subscriptions",
      "accounts",
      "sources",
      "generated",
      "operations",
    ].includes(requestedPage)
      ? "watch"
      : requestedPage;
  const profileIdentity = useRef(profileId);
  profileIdentity.current = profileId;
  const startupSequence = useRef(0);
  const helpReturn = useRef("#watch");
  const acceptedHash = useRef(location.hash),
    navigationSequence = useRef(0);
  useEffect(() => {
    if (account?.role === "viewer" && page !== requestedPage && !resource) {
      acceptedHash.current = "#watch";
      history.replaceState(
        null,
        "",
        location.pathname + location.search + "#watch",
      );
      setPage("watch");
    }
  }, [account?.role, page, requestedPage, resource]);
  const changed = () => setVersion((v) => v + 1);
  const chooseProfile = async (id: string) => {
    if (!(await allowNavigation())) return;
    if (resource) {
      setResource(null);
      acceptedHash.current = `#${page}`;
      history.replaceState(
        null,
        "",
        location.pathname + location.search + acceptedHash.current,
      );
    }
    try {
      sessionStorage.setItem(
        "mytuner:profile",
        JSON.stringify({ accountId: account?.id, id }),
      );
    } catch {}
    setProfileId(id);
    setWatchId(null);
    setProfilePicker(false);
  };
  const clearIdentityState = () => {
    startupSequence.current++;
    setStartupAccount(null);
    setStartupError(null);
    setStartupBusy(false);
    navigationSequence.current++;
    try {
      sessionStorage.removeItem("mytuner:profile");
    } catch {}
    setDraft(null);
    setWatchId(null);
    setProfilePicker(false);
    setMenu(false);
    setError(null);
    setProfilesError(null);
    setProfiles([]);
    setProfilesLoaded(false);
    setProfileId("");
    // Only the explicit URL may continue through reauthentication. Resolve it
    // again under the next account's grants; never retain a cached selection.
    setResource(readResourceRoute());
    setPage(currentRoute());
    acceptedHash.current = location.hash;
  };
  const signOut = async () => {
    if (!(await allowNavigation())) return;
    try {
      await api("/api/auth/logout", "POST");
      clearIdentityState();
      setAccount(null);
      setCsrf(null);
    } catch (failure) {
      setError(failure);
    }
  };
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    void api<Account>("/api/auth/me")
      .then((a) => {
        if (current) setAccount(a);
      })
      .catch((e) => {
        if (current && !(e instanceof ApiError && e.status === 401))
          setError(e);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    const expired = () => {
      clearIdentityState();
      setAccount(null);
      setCsrf(null);
    };
    const hash = async () => {
      const targetHash = location.hash,
        sequence = ++navigationSequence.current;
      const permitted = await allowNavigation();
      if (sequence !== navigationSequence.current) return;
      if (!permitted) {
        history.replaceState(
          null,
          "",
          location.pathname + location.search + acceptedHash.current,
        );
        return;
      }
      if (
        currentRoute(targetHash) === "setup" &&
        currentRoute(acceptedHash.current) !== "setup"
      )
        helpReturn.current = acceptedHash.current;
      acceptedHash.current = targetHash;
      setResource(readResourceRoute(targetHash));
      setPage(currentRoute(targetHash));
      setMenu(false);
      requestAnimationFrame(() => document.getElementById("main")?.focus());
    };
    window.addEventListener("mytuner:expired", expired);
    window.addEventListener("hashchange", hash);
    return () => {
      current = false;
      window.removeEventListener("mytuner:expired", expired);
      window.removeEventListener("hashchange", hash);
    };
  }, [identityTick]);
  useEffect(() => {
    if (!account) {
      setProfilesLoaded(false);
      return;
    }
    let current = true;
    setProfilesError(null);
    void api<Profile[]>("/api/profiles")
      .then((rows) => {
        if (!current) return;
        if (
          profileIdentity.current &&
          !rows.some((row) => row.id === profileIdentity.current)
        ) {
          setWatchId(null);
          setDraft(null);
        }
        setProfiles(rows);
        setProfilesLoaded(true);
        let remembered = "";
        try {
          const saved = JSON.parse(
            sessionStorage.getItem("mytuner:profile") ?? "null",
          );
          if (
            saved?.accountId === account.id &&
            rows.some((row) => row.id === saved.id)
          )
            remembered = saved.id;
        } catch {}
        if (!profileId && !remembered && !resource && rows.length > 1)
          setProfilePicker(true);
        setProfileId((old) =>
          typeof resource === "object" &&
          resource &&
          rows.some((p) => p.id === resource.profileId)
            ? resource.profileId
            : rows.some((p) => p.id === old)
              ? old
              : remembered || (rows[0]?.id ?? ""),
        );
      })
      .catch((e) => {
        if (current) setProfilesError(e);
      });
    return () => {
      current = false;
    };
  }, [account, version, resource]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
        setMenu(false);
        document.querySelector<HTMLButtonElement>(".mobile-menu")?.focus();
      }
    };
    document.addEventListener("keydown", dismiss);
    return () => document.removeEventListener("keydown", dismiss);
  }, [menu]);
  const finishStartup = async (identity: Account) => {
    const sequence = ++startupSequence.current;
    setStartupAccount(identity);
    setStartupBusy(true);
    setStartupError(null);
    try {
      await api("/api/playback/startup", "POST");
      if (sequence !== startupSequence.current) return;
      clearIdentityState();
      setAccount(identity);
    } catch (failure) {
      if (sequence !== startupSequence.current) return;
      if (failure instanceof ApiError && failure.status === 401) {
        clearIdentityState();
        setAccount(null);
        setCsrf(null);
      } else setStartupError(failure);
    } finally {
      if (sequence === startupSequence.current) setStartupBusy(false);
    }
  };
  const watch = (id: string) => {
    setWatchId(id);
    location.hash = "watch";
  };
  if (page === "setup") return <HelpPage returnTo={helpReturn.current} />;
  if (loading)
    return (
      <main className="login">
        <p role="status">Connecting to your network…</p>
      </main>
    );
  if (startupAccount)
    return (
      <main className="login">
        <h1>Signed in as {startupAccount.username}</h1>
        <p>Preparing your viewing session.</p>
        <ErrorBox error={startupError} />
        <button
          disabled={startupBusy}
          onClick={() => void finishStartup(startupAccount)}
        >
          {startupBusy ? "Preparing…" : "Retry startup"}
        </button>
        <a href="#setup">Server and TV setup help</a>
      </main>
    );
  if (!account && error)
    return (
      <main className="login">
        <h1>Unable to connect to your server</h1>
        <ErrorBox error={error} />
        <button onClick={() => setIdentityTick((n) => n + 1)}>
          Retry connection
        </button>
        <a href="#setup">Server and TV setup help</a>
      </main>
    );
  if (!account)
    return (
      <main className="login">
        <h1>myTuner</h1>
        {sessionStorage.getItem("mytuner:notice") && (
          <p className="notice" role="status">
            {sessionStorage.getItem("mytuner:notice")}
          </p>
        )}
        <p className="eyebrow">Your personal television network</p>
        <Form
          submit="Sign in"
          busyLabel="Signing in…"
          guardDraft={false}
          onSave={async (data) => {
            const result = await api<{ account: Account; csrfToken: string }>(
              "/api/auth/browser",
              "POST",
              {
                username: String(data.get("username")),
                password: String(data.get("password")),
              },
            );
            sessionStorage.removeItem("mytuner:notice");
            setCsrf(result.csrfToken);
            await finishStartup(result.account);
          }}
        >
          <h2>Welcome back</h2>
          <p>Sign in with an account created by your administrator.</p>
          <Field
            label="Username"
            name="username"
            autoComplete="username"
            required
            maxLength={64}
          />
          <SecretField
            label="Password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={1024}
          />
          <div className="notice">
            <strong>Setting up for the first time?</strong>
            <p>
              Create the first administrator on your server, then sign in here.
              There is no public registration.
            </p>
          </div>
        </Form>
        <a href="#setup">Server and TV setup instructions →</a>
        <ErrorBox error={error} />
      </main>
    );
  const workspace: Workspace = {
    account,
    profiles,
    profileId,
    version,
    changed,
    watch,
    chooseProfile: () => setProfilePicker(true),
    resource: typeof resource === "object" ? resource : null,
  };
  const profile = profiles.find((p) => p.id === profileId);
  const nav = [
    "watch",
    ...(account.role !== "viewer" ? ["channels"] : []),
    "profiles",
    ...(account.role === "admin"
      ? ["accounts", "sources", "generated", "operations"]
      : []),
    "connect-tv",
    "sessions",
    "reports",
  ];
  const labels: Record<string, string> = {
    channels: "My Network",
    library: "My Network",
    subscriptions: "Subscriptions",
    watch: "Watch TV",
    profiles: "Profiles",
    accounts: "Accounts",
    sources: "Sources",
    generated: "Generated Assets",
    operations: "Setup & Server Health",
    "connect-tv": "Connect TV",
    sessions: "Devices & Sessions",
    reports: account.role === "admin" ? "Problem Reports" : "Your Reports",
  };
  const needsProfile = [
    "channels",
    "library",
    "subscriptions",
    "watch",
  ].includes(page);
  return (
    <div className={`workspace ${page === "watch" ? "watching" : ""}`}>
      {profilePicker && (
        <Modal title="Who’s watching?" onClose={() => setProfilePicker(false)}>
          <p>
            Choose a person or room profile. Switching joins its channels live.
          </p>
          <div className="profile-grid">
            {profiles.map((p) => (
              <button
                key={p.id}
                className="profile-card secondary"
                onClick={async () => {
                  chooseProfile(p.id);
                }}
              >
                <strong>{p.name}</strong>
                <span>
                  {p.kind}
                  {p.pinProtected ? " · PIN protected" : ""}
                </span>
              </button>
            ))}
          </div>
        </Modal>
      )}
      <a
        className="skip"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          const main = document.getElementById("main");
          main?.focus();
          main?.scrollIntoView({ block: "start" });
        }}
      >
        Skip to content
      </a>
      <div className="mobile-header">
        <a
          className="brand"
          href={account.role === "viewer" ? "#watch" : "#channels"}
        >
          myTuner
        </a>
        <button
          className="mobile-menu secondary"
          aria-expanded={menu}
          aria-controls="navigation"
          onClick={() => setMenu((v) => !v)}
        >
          Menu
        </button>
      </div>
      <aside id="navigation" className={menu ? "rail open" : "rail"}>
        <a
          href={account.role === "viewer" ? "#watch" : "#channels"}
          className="brand"
        >
          myTuner
        </a>
        <p className="eyebrow">Your personal network</p>
        <nav aria-label="Main navigation">
          {nav.map((item) => (
            <a
              href={`#${item}`}
              key={item}
              aria-current={page === item ? "page" : undefined}
            >
              {labels[item]}
            </a>
          ))}
        </nav>
        <div className="rail-bottom">
          <span>{account.username}</span>
          <small>
            {account.role} · v{appVersion}
          </small>
          <a href="#setup">Setup & TV help</a>
          <button className="secondary" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </aside>
      <main id="main" tabIndex={-1}>
        <div className="workspace-bar">
          <span className="eyebrow">
            {page === "channels" || page === "library"
              ? "My Network"
              : `${needsProfile ? "My Network" : "Network Settings"} / ${labels[page] ?? "My Network"}`}
          </span>
          <div className="profile-switch" hidden={page === "connect-tv"}>
            <span className="badge">{account.role}</span>
            <Select
              label="Current profile"
              value={profileId}
              onChange={(e) => chooseProfile(e.target.value)}
            >
              {!profiles.length && <option value="">No profiles</option>}
              {profiles.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <ErrorBox error={error} />
        <ErrorBox error={profilesError} />
        {Boolean(profilesError) && (
          <button className="secondary" onClick={changed}>
            Retry profile loading
          </button>
        )}
        {(resource || needsProfile) && !profilesLoaded ? (
          profilesError ? null : (
            <p role="status">Loading permitted profiles…</p>
          )
        ) : resource === "invalid" ||
          (resource &&
            (account.role === "viewer" ||
              !profiles.some((p) => p.id === resource.profileId))) ? (
          <section className="empty">
            <h1>This item is unavailable</h1>
            <p>The link may be outdated or you may not have access.</p>
          </section>
        ) : resource && resource.profileId !== profileId ? (
          <p role="status">Opening permitted profile…</p>
        ) : needsProfile && !profile ? (
          <section className="empty">
            <h1>
              {account.role === "admin"
                ? "Create your first profile"
                : "No profiles available"}
            </h1>
            <p>
              {account.role === "admin"
                ? "Profiles hold the library access and channel subscriptions for a person or room."
                : "Ask an administrator to give this account access to a viewing profile."}
            </p>
            {account.role === "admin" && (
              <a href="#profiles">Set up profiles →</a>
            )}
          </section>
        ) : needsProfile && profile?.locked ? (
          <Form
            guardDraft={false}
            focusOnError="pin"
            submit="Unlock profile"
            busyLabel="Unlocking…"
            onSave={async (data) => {
              try {
                await api(`/api/profiles/${profileId}/unlock`, "POST", {
                  pin: String(data.get("pin")),
                });
                changed();
              } catch (failure) {
                if (failure instanceof ApiError && failure.status === 403) {
                  const input =
                    document.querySelector<HTMLInputElement>(
                      'input[name="pin"]',
                    );
                  if (input) {
                    input.value = "";
                  }
                }
                throw failure;
              }
            }}
          >
            <h1>Unlock {profile.name}</h1>
            <button
              type="button"
              className="secondary"
              onClick={() => setProfilePicker(true)}
            >
              Switch profile
            </button>
            <SecretField
              kind="pin"
              label="TV PIN"
              name="pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4,8}"
              autoComplete="off"
              required
              hint="4–8 digits. Forgotten PIN? Ask the profile owner or administrator."
            />
          </Form>
        ) : (
          <div
            key={`${account.id}:${profileId}:${page === "library" ? "channels" : page}`}
          >
            {page === "library" || page === "channels" ? (
              <NetworkPage
                {...workspace}
                initialSelection={draft}
                onSelectionUsed={() => setDraft(null)}
              />
            ) : page === "accounts" && account.role === "admin" ? (
              <AccountsPage {...workspace} />
            ) : page === "sources" && account.role === "admin" ? (
              <SourcesPage {...workspace} />
            ) : page === "operations" && account.role === "admin" ? (
              <OperationsPage />
            ) : page === "generated" && account.role === "admin" ? (
              <GenerationPage {...workspace} />
            ) : page === "profiles" ? (
              <ProfilesPage {...workspace} />
            ) : page === "subscriptions" && account.role !== "viewer" ? (
              <SubscriptionsPage {...workspace} />
            ) : page === "connect-tv" ? (
              <PairingPage account={account} onChangeAccount={signOut} />
            ) : page === "reports" ? (
              <ReportsInbox key={account.id} admin={account.role === "admin"} />
            ) : page === "sessions" ? (
              <SessionsPage />
            ) : page === "watch" ? (
              <WatchPage
                {...workspace}
                channelId={watchId}
                onLeave={() => setWatchId(null)}
              />
            ) : account.role !== "viewer" ? (
              <ChannelsPage
                {...workspace}
                initialSelection={draft}
                onSelectionUsed={() => setDraft(null)}
              />
            ) : (
              <WatchPage
                {...workspace}
                channelId={watchId}
                onLeave={() => setWatchId(null)}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
