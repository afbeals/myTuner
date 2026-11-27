import { createPortal } from "react-dom";
import { confirmAction } from "./confirmation";
import {
  createContext,
  useContext,
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
import type { Entry } from "./types";
export function Field({
  label,
  hint,
  id: suppliedId,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
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
      <span id={`${id}-label`}>{label}</span>
      <select id={id} aria-labelledby={`${id}-label`} {...props}>
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
/** Submission failures move into view; background errors remain passive. */
export function SubmissionErrorBox({
  error,
  children,
  focus = true,
}: {
  error: unknown;
  children?: ReactNode;
  focus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error && focus) {
      ref.current?.focus();
      ref.current?.scrollIntoView({ block: "nearest" });
    }
  }, [error, focus]);
  return error ? (
    <div
      ref={ref}
      role="alert"
      className="error submission-error"
      tabIndex={-1}
    >
      {error instanceof Error ? error.message : String(error)}
      {children}
    </div>
  ) : null;
}
export function submissionErrorMessage(error: unknown) {
  return error instanceof ApiError && error.status === 0
    ? "Could not confirm whether your changes were saved. Your draft is kept. Check saved settings before retrying."
    : error instanceof Error
      ? error.message
      : String(error);
}
/** Readback never replaces a draft until the user explicitly confirms. */
export function SettingsRecovery<T>({
  error,
  load,
  apply,
  describe,
}: {
  error: unknown;
  load: () => Promise<T>;
  apply: (latest: T) => void;
  describe: (latest: T) => ReactNode;
}) {
  const [latest, setLatest] = useState<T | null>(null),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>(null);
  if (!(error instanceof ApiError) || ![0, 409].includes(error.status))
    return null;
  return (
    <div>
      <p>
        Your local changes are still in this form. Check the saved version, then
        choose whether to keep editing or load it.
      </p>
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setFailure(null);
          try {
            setLatest(await load());
          } catch (failure) {
            setFailure(failure);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Checking saved settings…" : "Check saved settings"}
      </button>
      <ErrorBox error={failure} />
      {latest && (
        <section
          className="settings-section"
          aria-label="Saved settings review"
        >
          <h3>Currently saved settings</h3>
          {describe(latest)}
          <p>Your draft above is unchanged.</p>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              if (
                await confirmAction(
                  "Replace your unsaved draft with these saved settings? Choose Cancel to keep your draft.",
                  {
                    title: "Load saved settings?",
                    label: "Load saved settings",
                  },
                )
              )
                apply(latest);
            }}
          >
            Load saved settings
          </button>
        </section>
      )}
    </div>
  );
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
  label,
  onError,
}: {
  children: ReactNode;
  label?: string;
  onError?: (error: unknown) => void;
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
        aria-label={label}
        onClick={async () => {
          setBusy(true);
          setError(null);
          void task()
            .catch((error) => (onError ? onError(error) : setError(error)))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Working…" : children}
      </button>
      <ErrorBox error={error} />
    </>
  );
}
const FormDirtyContext = createContext<() => void>(() => {});
export function useMarkFormDirty() {
  return useContext(FormDirtyContext);
}
export function Form({
  children,
  onSave,
  submit = "Save",
  busyLabel = "Saving…",
  className = "panel",
  onCancel,
  disabled = false,
  guardDraft = true,
  id,
  hideActions = false,
  onBusyChange,
  focusOnError,
  renderError,
}: {
  children: ReactNode;
  onSave: (data: FormData) => Promise<unknown>;
  submit?: string;
  busyLabel?: string;
  className?: string;
  onCancel?: () => void;
  disabled?: boolean;
  guardDraft?: boolean;
  id?: string;
  hideActions?: boolean;
  onBusyChange?: (busy: boolean) => void;
  focusOnError?: string;
  renderError?: (error: unknown) => ReactNode;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [dirty, setDirty] = useState(false);
  useDraftNavigation(
    guardDraft && (dirty || busy),
    "Discard unsaved form changes? A request already received by the server may still finish.",
  );
  const pending = useRef(false),
    form = useRef<HTMLFormElement>(null),
    errorSummary = useRef<HTMLDivElement>(null),
    failureNumber = useRef(0),
    focusedFailure = useRef(0);
  useEffect(() => {
    if (
      !error ||
      busy ||
      disabled ||
      focusedFailure.current === failureNumber.current
    )
      return;
    focusedFailure.current = failureNumber.current;
    const control = focusOnError
      ? form.current?.elements.namedItem(focusOnError)
      : null;
    const target =
      control instanceof HTMLElement ? control : errorSummary.current;
    target?.focus();
    target?.scrollIntoView({ block: "nearest" });
  }, [error, busy, disabled, focusOnError]);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending.current || disabled) return;
    for (const field of e.currentTarget.querySelectorAll<HTMLInputElement>(
      "[data-confirm-for]",
    )) {
      const original = e.currentTarget.elements.namedItem(
        field.dataset.confirmFor!,
      ) as HTMLInputElement | null;
      field.setCustomValidity(
        field.value === original?.value ? "" : "The entries do not match.",
      );
      if (!field.reportValidity()) return;
    }
    pending.current = true;
    onBusyChange?.(true);
    setBusy(true);
    setError(null);
    try {
      const result = await onSave(new FormData(e.currentTarget));
      if (result !== false) setDirty(false);
    } catch (e) {
      failureNumber.current++;
      setError(e);
    } finally {
      setBusy(false);
      pending.current = false;
      onBusyChange?.(false);
    }
  }
  return (
    <form
      ref={form}
      id={id}
      className={className}
      aria-busy={busy}
      data-form-dirty={guardDraft && dirty}
      data-form-busy={guardDraft && busy}
      onChange={() => setDirty(true)}
      onSubmit={(e) => void save(e)}
    >
      {Boolean(error) && (
        <div
          ref={errorSummary}
          role="alert"
          className="error submission-error"
          tabIndex={-1}
        >
          {renderError
            ? renderError(error)
            : error instanceof Error
              ? error.message
              : String(error)}
        </div>
      )}
      <fieldset disabled={busy || disabled}>
        <FormDirtyContext.Provider value={() => setDirty(true)}>
          {children}
        </FormDirtyContext.Provider>
        {!hideActions && (
          <div className="actions">
            <button type="submit">{busy ? busyLabel : submit}</button>
            {onCancel && (
              <button type="button" className="secondary" onClick={onCancel}>
                Cancel
              </button>
            )}
          </div>
        )}
      </fieldset>
    </form>
  );
}
export function useRemote<T>(
  path: string | null,
  version: number | string = 0,
  retain = false,
  polling?: { intervalMs: number; active?: (data: T) => boolean },
) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState<unknown>(null),
    [loading, setLoading] = useState(Boolean(path)),
    [tick, setTick] = useState(0),
    [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const previousPath = useRef<string | null>(null),
    policy = useRef(polling);
  policy.current = polling;
  useEffect(() => {
    if (!retain || previousPath.current !== path) {
      setData(null);
      setUpdatedAt(null);
    }
    previousPath.current = path;
    setError(null);
    if (!path) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined,
      failures = 0;
    const run = async (initial: boolean) => {
      if (initial) setLoading(true);
      let next: T | undefined,
        retryable = true;
      try {
        next = await api<T>(path, "GET", undefined, controller.signal);
        if (controller.signal.aborted) return;
        failures = 0;
        setData(next);
        setUpdatedAt(Date.now());
        setError(null);
      } catch (e) {
        if (controller.signal.aborted) return;
        failures++;
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
          setData(null);
          setUpdatedAt(null);
          retryable = false;
        }
        setError(e);
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          const options = policy.current;
          if (
            options &&
            retryable &&
            (next === undefined || !options.active || options.active(next))
          ) {
            const delay = document.hidden
              ? Math.max(30000, options.intervalMs)
              : Math.min(30000, options.intervalMs * Math.max(1, failures));
            timer = setTimeout(() => void run(false), delay);
          }
        }
      }
    };
    void run(true);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [path, version, tick, retain, polling?.intervalMs]);
  const current = previousPath.current === path;
  return {
    data: current ? data : null,
    error: current ? error : null,
    loading: Boolean(path) && (loading || !current),
    updatedAt: current ? updatedAt : null,
    reload: () => setTick((v) => v + 1),
  };
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
const ModalFooterContext = createContext<HTMLElement | null>(null);
/** Keep a child workflow's state local while presenting its actions in the nearest opted-in modal footer. */
export function ModalFooterActions({ children }: { children: ReactNode }) {
  const target = useContext(ModalFooterContext);
  return target ? createPortal(children, target) : <>{children}</>;
}
const ModalCloseContext = createContext<{
  close: () => void;
  disabled: boolean;
}>({ close: () => {}, disabled: false });
export function ModalCancel({ children = "Cancel" }: { children?: ReactNode }) {
  const { close, disabled } = useContext(ModalCloseContext);
  return (
    <button
      type="button"
      className="secondary"
      disabled={disabled}
      onClick={close}
    >
      {children}
    </button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  closeDisabled = false,
  footer,
  footerSlot = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  footer?: ReactNode;
  footerSlot?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId(),
    [footerTarget, setFooterTarget] = useState<HTMLDivElement | null>(null);
  const footerContent = footer ?? (
    <div className="actions">
      <ModalCancel>Done</ModalCancel>
    </div>
  );
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  const requestClose = async () => {
    if (closeDisabled) return;
    const changed = ref.current?.querySelector(
      '[data-form-dirty="true"], [data-form-busy="true"]',
    );
    if (
      changed &&
      !(await confirmAction(
        "Your unsaved changes will be discarded. Choose Cancel to keep editing.",
        { title: "Discard unsaved changes?", label: "Discard changes" },
      ))
    )
      return;
    onClose();
  };
  return (
    <ModalCloseContext.Provider
      value={{ close: () => void requestClose(), disabled: closeDisabled }}
    >
      <ModalFooterContext.Provider value={footerTarget}>
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
              (document.activeElement === last ||
                document.activeElement === dialog)
            ) {
              event.preventDefault();
              first.focus();
            }
          }}
          onCancel={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.target === e.currentTarget) void requestClose();
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
          <div className="dialog-body">{children}</div>
          <div className="dialog-footer">
            {footerSlot ? (
              <div className="actions">
                <div className="actions" ref={setFooterTarget} />
                {footerContent}
              </div>
            ) : (
              footerContent
            )}
          </div>
        </dialog>
      </ModalFooterContext.Provider>
    </ModalCloseContext.Provider>
  );
}
export function MediaReferenceContext({
  entry,
  sourceNames,
}: {
  entry: Pick<Entry, "sourceId" | "relativePath">;
  sourceNames: ReadonlyMap<string, string>;
}) {
  if (!entry.sourceId && !entry.relativePath) return null;
  return (
    <small className="media-reference-context">
      {(entry.sourceId ? sourceNames.get(entry.sourceId) : null) ?? "Source"}
      {entry.relativePath ? (
        <>
          {" "}
          · <code>{entry.relativePath}</code>
        </>
      ) : null}
    </small>
  );
}
export const timeWithSeconds = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
export const time = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
export const duration = (ms: number) =>
  (() => {
    const seconds = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(seconds / 3600),
      minutes = Math.floor((seconds % 3600) / 60),
      rest = seconds % 60;
    return [
      hours ? `${hours} hr` : "",
      minutes ? `${minutes} min` : "",
      rest || !seconds ? `${rest} sec` : "",
    ]
      .filter(Boolean)
      .join(" ");
  })();
export const value = (data: FormData, key: string) =>
  String(data.get(key) ?? "").trim();
export const number = (data: FormData, key: string) => Number(data.get(key));

export function playhead(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000)),
    hours = Math.floor(seconds / 3600);
  return `${hours ? hours + ":" : ""}${hours ? String(Math.floor(seconds / 60) % 60).padStart(2, "0") : Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
