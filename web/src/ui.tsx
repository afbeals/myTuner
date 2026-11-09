import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
  type SelectHTMLAttributes,
  type InputHTMLAttributes,
} from "react";
import { api, ApiError } from "./api";
import { useDraftNavigation } from "./navigation";
export function Field({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span id={`${id}-label`}>{label}</span>
      <input
        id={id}
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        {...props}
      />
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </label>
  );
}
export function Select({
  label,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} {...props}>
        {children}
      </select>
    </label>
  );
}
export function ErrorBox({ error }: { error: unknown }) {
  return error ? (
    <div role="alert" className="error">
      {error instanceof Error ? error.message : String(error)}
    </div>
  ) : null;
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <section className="empty">
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </section>
  );
}
export function Action({
  children,
  task,
  secondary = false,
  danger = false,
  disabled = false,
}: {
  children: ReactNode;
  task: () => Promise<unknown>;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  return (
    <>
      <button
        type="button"
        className={`${secondary ? "secondary" : ""} ${danger ? "danger" : ""}`}
        disabled={busy || disabled}
        onClick={() => {
          setBusy(true);
          setError(null);
          void task()
            .catch(setError)
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Working…" : children}
      </button>
      <ErrorBox error={error} />
    </>
  );
}
export function Form({
  children,
  onSave,
  submit = "Save",
  className = "panel",
  onCancel,
  disabled = false,
  guardDraft = true,
}: {
  children: ReactNode;
  onSave: (data: FormData) => Promise<unknown>;
  submit?: string;
  className?: string;
  onCancel?: () => void;
  disabled?: boolean;
  guardDraft?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [dirty, setDirty] = useState(false);
  useDraftNavigation(
    guardDraft && (dirty || busy),
    "Discard unsaved form changes? A request already received by the server may still finish.",
  );
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSave(new FormData(e.currentTarget));
      setDirty(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className={className}
      aria-busy={busy}
      data-form-dirty={guardDraft && dirty}
      data-form-busy={guardDraft && busy}
      onChange={() => setDirty(true)}
      onSubmit={(e) => void save(e)}
    >
      <fieldset disabled={busy || disabled}>
        {children}
        <ErrorBox error={error} />
        <div className="actions">
          <button type="submit">{busy ? "Saving…" : submit}</button>
          {onCancel && (
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </fieldset>
    </form>
  );
}
export function useRemote<T>(
  path: string | null,
  version: number | string = 0,
  retain = false,
) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState<unknown>(null),
    [loading, setLoading] = useState(Boolean(path)),
    [tick, setTick] = useState(0);
  const previousPath = useRef<string | null>(null);
  useEffect(() => {
    if (!retain || previousPath.current !== path) setData(null);
    previousPath.current = path;
    setError(null);
    if (!path) {
      setLoading(false);
      return;
    }
    const c = new AbortController();
    setLoading(true);
    void api<T>(path, "GET", undefined, c.signal)
      .then((value) => {
        if (!c.signal.aborted) setData(value);
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          if (e instanceof ApiError && [401, 403, 404].includes(e.status))
            setData(null);
          setError(e);
        }
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [path, version, tick, retain]);
  return { data, error, loading, reload: () => setTick((v) => v + 1) };
}
export function Load({
  loading,
  error,
  retry,
}: {
  loading: boolean;
  error: unknown;
  retry?: () => void;
}) {
  return (
    <>
      {loading && <p role="status">Loading…</p>}
      <ErrorBox error={error} />
      {error && retry && (
        <button type="button" className="secondary" onClick={retry}>
          Try again
        </button>
      )}
    </>
  );
}
export function Modal({
  title,
  children,
  onClose,
  closeDisabled = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  const requestClose = () => {
    if (closeDisabled) return;
    const changed = ref.current?.querySelector(
      '[data-form-dirty="true"], [data-form-busy="true"]',
    );
    if (
      changed &&
      !window.confirm(
        "Discard unsaved form changes? A request already received by the server may still finish.",
      )
    )
      return;
    onClose();
  };
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const dialog = event.currentTarget;
        if ((event.target as Element).closest("dialog") !== dialog) return;
        const targets = [
          ...dialog.querySelectorAll<HTMLElement>(
            "button, [href], input, select, textarea, [tabindex]",
          ),
        ].filter(
          (element) =>
            element.closest("dialog") === dialog &&
            !element.matches(":disabled") &&
            element.tabIndex >= 0 &&
            element.getClientRects().length > 0,
        );
        const first = targets[0],
          last = targets.at(-1);
        if (!first) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === dialog)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last || document.activeElement === dialog)
        ) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
    >
      <div className="dialog-head">
        <h2 id={id}>{title}</h2>
        <button
          type="button"
          className="secondary"
          aria-label="Close dialog"
          disabled={closeDisabled}
          onClick={requestClose}
        >
          Close
        </button>
      </div>
      {children}
    </dialog>
  );
}
export const time = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
export const duration = (ms: number) =>
  `${Math.max(1, Math.round(ms / 60000))} min`;
export const value = (data: FormData, key: string) =>
  String(data.get(key) ?? "").trim();
export const number = (data: FormData, key: string) => Number(data.get(key));
