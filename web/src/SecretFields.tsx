import { useEffect, useState, type ComponentProps } from "react";
import { Field } from "./ui";
export function SecretFields({
  name = "password",
  label = "New password",
  confirmLabel = "Confirm new password",
  kind = "password",
  required = false,
}: {
  name?: string;
  label?: string;
  confirmLabel?: string;
  kind?: "password" | "pin";
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false),
    [entered, setEntered] = useState(false);
  const rules =
    kind === "pin"
      ? {
          minLength: 4,
          maxLength: 8,
          pattern: "[0-9]{4,8}",
          inputMode: "numeric" as const,
        }
      : { minLength: 12, maxLength: 1024 };
  return (
    <div className="secret-fields">
      <Field
        label={label}
        name={name}
        type={visible ? "text" : "password"}
        {...rules}
        required={required}
        autoComplete="new-password"
        hint={kind === "pin" ? "4–8 digits" : "At least 12 characters"}
        onChange={(event) => {
          setEntered(Boolean(event.target.value));
          const confirm = event.currentTarget.form?.elements.namedItem(
            `confirm-${name}`,
          ) as HTMLInputElement | null;
          confirm?.setCustomValidity("");
        }}
      />
      <Field
        label={confirmLabel}
        name={`confirm-${name}`}
        type={visible ? "text" : "password"}
        {...rules}
        required={required || entered}
        autoComplete="new-password"
        data-confirm-for={name}
        onInput={(event) => event.currentTarget.setCustomValidity("")}
      />
      <button
        type="button"
        className="secondary"
        aria-pressed={visible}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? "Hide" : "Show"} {kind === "pin" ? "PIN" : "password"}
      </button>
    </div>
  );
}

/** Single credential entry; confirmation belongs only to password/PIN changes. */
export function SecretField({
  kind = "password",
  ...props
}: ComponentProps<typeof Field> & { kind?: "password" | "pin" }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => setVisible(false), [props.label, props.name]);
  const noun = kind === "pin" ? "PIN" : "password";
  return (
    <div className="secret-fields">
      <Field {...props} type={visible ? "text" : "password"} />
      <button
        type="button"
        className="secondary"
        aria-pressed={visible}
        onClick={() => setVisible((value) => !value)}
      >
        {visible ? "Hide" : "Show"} {noun}
      </button>
    </div>
  );
}
