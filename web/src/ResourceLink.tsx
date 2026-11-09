import { useState } from "react";
import { Action } from "./ui";
import { resourceLink, type ResourceTarget } from "./resource-route";
export function ResourceLink({ kind, profileId, id }: ResourceTarget) {
  const [message, setMessage] = useState("");
  const hash = resourceLink(kind, profileId, id);
  return (
    <div className="actions">
      <a href={hash}>Link to this {kind}</a>
      <Action
        secondary
        task={async () => {
          const url = new URL(location.href);
          url.hash = hash;
          if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url.href);
            setMessage("Link copied");
          } else
            setMessage(
              "Use the link beside this button to copy or bookmark this item.",
            );
        }}
      >
        Copy {kind} link
      </Action>
      {message && <small role="status">{message}</small>}
    </div>
  );
}
