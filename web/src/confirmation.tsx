import { useEffect, useRef, useSyncExternalStore } from "react";

type Request = {
  message: string;
  title: string;
  label: string;
  danger: boolean;
  resolve: (accepted: boolean) => void;
};
let requests: Request[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
/** Only in-app actions use this. beforeunload remains browser controlled. */
export function confirmAction(
  message: string,
  options: { title?: string; label?: string; danger?: boolean } = {},
): Promise<boolean> {
  return new Promise((resolve) => {
    requests = [
      ...requests,
      {
        message,
        title: options.title ?? "Confirm action",
        label: options.label ?? "Continue",
        danger: options.danger ?? true,
        resolve,
      },
    ];
    emit();
  });
}
export function ConfirmationHost() {
  const request = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => requests[0] ?? null,
  );
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!request) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, [request]);
  const finish = (accepted: boolean) => {
    if (!request || requests[0] !== request) return;
    requests = requests.slice(1);
    request.resolve(accepted);
    emit();
  };
  if (!request) return null;
  return (
    <dialog
      ref={ref}
      className="confirmation-dialog"
      aria-labelledby="confirmation-title"
      aria-describedby="confirmation-message"
      onCancel={(event) => {
        event.preventDefault();
        finish(false);
      }}
    >
      <div className="dialog-head">
        <h2 id="confirmation-title">{request.title}</h2>
      </div>
      <div className="dialog-body">
        <p id="confirmation-message">{request.message}</p>
      </div>
      <div className="dialog-footer actions">
        <button
          type="button"
          className="secondary"
          autoFocus
          onClick={() => finish(false)}
        >
          Cancel
        </button>
        <button
          type="button"
          className={request.danger ? "danger" : ""}
          onClick={() => finish(true)}
        >
          {request.label}
        </button>
      </div>
    </dialog>
  );
}
