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
    [page, setPage] = useState(currentRoute()),
    [resource, setResource] = useState(readResourceRoute()),
    [version, setVersion] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<unknown>(null),
    [menu, setMenu] = useState(false),
    [profilePicker, setProfilePicker] = useState(false),
    [watchId, setWatchId] = useState<string | null>(null),
    [draft, setDraft] = useState<Selection | null>(null);
  const acceptedHash = useRef(location.hash);
  const changed = () => setVersion((v) => v + 1);
  const chooseProfile = (id: string) => {
    if (!allowNavigation()) return;
    if (resource) {
      setResource(null);
      acceptedHash.current = `#${page}`;
      history.replaceState(
        null,
        "",
        location.pathname + location.search + acceptedHash.current,
      );
    }
    setProfileId(id);
    setWatchId(null);
    setProfilePicker(false);
  };
  const clearIdentityState = () => {
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
  useEffect(() => {
    let current = true;
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
    const hash = () => {
      if (!allowNavigation()) {
        history.replaceState(
          null,
          "",
          location.pathname + location.search + acceptedHash.current,
        );
        return;
      }
      acceptedHash.current = location.hash;
      setResource(readResourceRoute());
      setPage(currentRoute());
      setMenu(false);
    };
    window.addEventListener("mytuner:expired", expired);
    window.addEventListener("hashchange", hash);
    return () => {
      current = false;
      window.removeEventListener("mytuner:expired", expired);
      window.removeEventListener("hashchange", hash);
    };
  }, []);
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
        setProfiles(rows);
        setProfilesLoaded(true);
        setProfileId((old) =>
          typeof resource === "object" &&
          resource &&
          rows.some((p) => p.id === resource.profileId)
            ? resource.profileId
            : rows.some((p) => p.id === old)
              ? old
              : (rows[0]?.id ?? ""),
        );
      })
      .catch((e) => {
        if (current) setProfilesError(e);
      });
    return () => {
      current = false;
    };
  }, [account, version, resource]);
  const watch = (id: string) => {
    setWatchId(id);
    location.hash = "watch";
  };
  if (page === "setup") return <HelpPage />;
  if (loading)
    return (
      <main className="login">
        <p role="status">Connecting to your network…</p>
      </main>
    );
  if (!account)
    return (
      <main className="login">
        <h1>myTuner</h1>
        <p className="eyebrow">Your personal television network</p>
        <Form
          submit="Sign in"
          onSave={async (data) => {
            const result = await api<{ account: Account; csrfToken: string }>(
              "/api/auth/browser",
              "POST",
              {
                username: String(data.get("username")),
                password: String(data.get("password")),
              },
            );
            setCsrf(result.csrfToken);
            await api("/api/playback/startup", "POST");
            clearIdentityState();
            setAccount(result.account);
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
          <Field
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
    ...(account.role !== "viewer"
      ? ["channels", "library", "subscriptions"]
      : []),
    "watch",
    "profiles",
    ...(account.role === "admin"
      ? ["accounts", "sources", "generated", "operations"]
      : []),
    "connect-tv",
    "sessions",
    "reports",
  ];
  const labels: Record<string, string> = {
    channels: "Channels",
    library: "Library",
    subscriptions: "Subscriptions",
    watch: "Watch TV",
    profiles: "Profiles",
    accounts: "Accounts",
    sources: "Sources",
    generated: "Generated assets",
    operations: "Setup & server health",
    "connect-tv": "Connect TV",
    sessions: "Devices & sessions",
    reports: account.role === "admin" ? "Problem reports" : "Your reports",
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
                onClick={() => {
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
        <a className="brand" href="#channels">
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
        <a href="#channels" className="brand">
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
          <button
            className="secondary"
            onClick={() => {
              if (!allowNavigation()) return;
              void api("/api/auth/logout", "POST")
                .then(() => {
                  clearIdentityState();
                  setAccount(null);
                  setCsrf(null);
                })
                .catch(setError);
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main id="main" tabIndex={-1}>
        <div className="workspace-bar">
          <span className="eyebrow">
            My network / {labels[page] ?? "Channels"}
          </span>
          <div className="profile-switch">
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
            <h1>Create your first profile</h1>
            <p>
              Profiles hold the source permissions and channel subscriptions for
              a person or room.
            </p>
            <a href="#profiles">Set up profiles →</a>
          </section>
        ) : needsProfile && profile?.locked ? (
          <Form
            submit="Unlock profile"
            onSave={async (data) => {
              await api(`/api/profiles/${profileId}/unlock`, "POST", {
                pin: String(data.get("pin")),
              });
              changed();
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
            <Field
              label="TV PIN"
              name="pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]{4,8}"
              autoComplete="off"
              required
            />
          </Form>
        ) : (
          <div key={`${profileId}:${page}`}>
            {page === "library" ? (
              <LibraryPage
                {...workspace}
                onUse={(selection) => {
                  setDraft(selection);
                  location.hash = "channels";
                }}
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
              <PairingPage />
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
