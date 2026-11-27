import { useEffect, useId, useRef, useState, type ReactNode } from "react";
export function Info({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const [pinned, setPinned] = useState(false),
    [hovered, setHovered] = useState(false),
    id = useId(),
    root = useRef<HTMLSpanElement>(null),
    button = useRef<HTMLButtonElement>(null);
  const open = pinned || hovered;
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setPinned(false);
        setHovered(false);
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return (
    <span
      ref={root}
      className="information"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setHovered(true);
      }}
      onPointerLeave={(event) => {
        if (
          event.pointerType === "mouse" &&
          !root.current?.contains(document.activeElement)
        ) {
          setPinned(false);
          setHovered(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          {
            setPinned(false);
            setHovered(false);
          }
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        type="button"
        className="secondary information-trigger"
        aria-label={`About ${title}`}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setPinned((value) => !value)}
      >
        i
      </button>
      {open && (
        <span id={id} className="information-content" role="note">
          <strong>{title}</strong>
          <span>{children}</span>
        </span>
      )}
    </span>
  );
}
