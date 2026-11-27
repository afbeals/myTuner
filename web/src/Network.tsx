import { useState } from "react";
import type { Workspace } from "./App";
import type { Selection } from "./types";
import { ChannelsPage } from "./Channels";
import { LibraryPage } from "./Library";
import { Info } from "./Info";
import { canManageProfile } from "./permissions";
export function NetworkPage(
  props: Workspace & {
    initialSelection: Selection | null;
    onSelectionUsed: () => void;
  },
) {
  const [createChannel, setCreateChannel] = useState(0),
    [createCollection, setCreateCollection] = useState(0),
    [selection, setSelection] = useState<Selection | null>(null);
  const manage = canManageProfile(
    props.account,
    props.profiles.find((p) => p.id === props.profileId),
  );
  const jump = (id: string) => {
    const target = document.getElementById(id);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "start" });
  };
  return (
    <>
      <header className="page-head">
        <div>
          <h1 aria-label="My Network">
            My Network{" "}
            <Info title="Channels, collections and library">
              The library indexes existing media. A collection saves a fixed
              selection of videos. A channel schedules one or more collections,
              shows, seasons or folders as live television. Private channels
              remain visible only to their owning account and administrators.
            </Info>
          </h1>
          <p>Your channels and the media behind them.</p>
        </div>
        {manage && (
          <div className="actions">
            <button onClick={() => setCreateChannel((n) => n + 1)}>
              Create channel
            </button>
            <button
              className="secondary"
              onClick={() => setCreateCollection((n) => n + 1)}
            >
              Create collection
            </button>
          </div>
        )}
      </header>
      <nav className="network-jumps" aria-label="My Network sections">
        <a
          href="#network-channels"
          className="button secondary"
          onClick={(event) => {
            event.preventDefault();
            jump("network-channels");
          }}
        >
          Channels
        </a>
        <a
          href="#network-library"
          className="button secondary"
          onClick={(event) => {
            event.preventDefault();
            jump("network-library");
          }}
        >
          Your library
        </a>
      </nav>
      {!manage && (
        <p className="notice">
          You can browse this profile’s library. Ask its owner or an
          administrator for permission to change its channels or collections.
        </p>
      )}
      <ChannelsPage
        {...props}
        embedded
        createRequested={createChannel}
        initialSelection={selection ?? props.initialSelection}
        onSelectionUsed={() => {
          setSelection(null);
          props.onSelectionUsed();
        }}
      />
      <LibraryPage
        {...props}
        embedded
        createRequested={createCollection}
        onUse={(selection) => setSelection(selection)}
      />
    </>
  );
}
