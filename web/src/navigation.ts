import { useEffect } from "react";
import { confirmAction } from "./confirmation";
type Guard = { message: string; title: string; label: string };
const guards = new Map<symbol, Guard>();
let pending: Promise<boolean> | null = null;
export function allowNavigation(): Promise<boolean> {
  if (pending) return pending;
  const guard = guards.values().next().value;
  if (!guard) return Promise.resolve(true);
  pending = confirmAction(guard.message, {
    title: guard.title,
    label: guard.label,
  }).finally(() => {
    pending = null;
  });
  return pending;
}
export function useDraftNavigation(
  dirty: boolean,
  message = "Discard unsaved changes?",
  options: { title?: string; label?: string } = {},
) {
  const title = options.title ?? "Discard unsaved changes?",
    label = options.label ?? "Discard changes";
  useEffect(() => {
    const id = Symbol();
    if (dirty) guards.set(id, { message, title, label });
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", unload);
    return () => {
      guards.delete(id);
      window.removeEventListener("beforeunload", unload);
    };
  }, [dirty, message, title, label]);
}
