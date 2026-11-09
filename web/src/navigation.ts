import { useEffect } from "react";
const guards = new Set<() => boolean>();
export const allowNavigation = () => [...guards].every((guard) => guard());
export function useDraftNavigation(
  dirty: boolean,
  message = "Discard unpublished changes to this channel?",
) {
  useEffect(() => {
    const guard = () => !dirty || window.confirm(message);
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    guards.add(guard);
    window.addEventListener("beforeunload", unload);
    return () => {
      guards.delete(guard);
      window.removeEventListener("beforeunload", unload);
    };
  }, [dirty, message]);
}
