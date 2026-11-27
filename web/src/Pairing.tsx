import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api";
import { pairingPrefill } from "./pairing-link";
import { ErrorBox, Field } from "./ui";
import type { Account } from "./types";
const loopback = (hostname: string) =>
  ["localhost", "127.0.0.1", "[::1]", "::1"].includes(hostname.toLowerCase()) ||
  hostname.startsWith("127.");
type Review = { code: string; deviceName: string; expiresMs: number };
export function PairingPage({
  account,
  onChangeAccount,
}: {
  account: Account;
  onChangeAccount: () => Promise<void>;
}) {
  const [code, setCode] = useState(pairingPrefill),
    [review, setReview] = useState<Review | null>(null),
    [stage, setStage] = useState<"entry" | "review" | "approved" | "uncertain">(
      "entry",
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [address, setAddress] = useState(
      loopback(location.hostname) ? "" : location.origin,
    );
  const serial = useRef(0),
    controller = useRef(new AbortController()),
    pending = useRef(false),
    heading = useRef<HTMLHeadingElement>(null),
    input = useRef<HTMLInputElement>(null);
  const reset = (next: string) => {
    serial.current++;
    controller.current.abort();
    controller.current = new AbortController();
    pending.current = false;
    setBusy(false);
    setCode(next);
    setReview(null);
    setStage("entry");
    setError(null);
  };
  useEffect(() => {
    controller.current = new AbortController();
    const changed = () => reset(pairingPrefill());
    window.addEventListener("hashchange", changed);
    return () => {
      serial.current++;
      controller.current.abort();
      window.removeEventListener("hashchange", changed);
    };
  }, []);
  useEffect(() => {
    if (!review) return;
    const timer = setTimeout(
      () => {
        setReview(null);
        setStage("entry");
        setError(
          new Error(
            "This code expired. Request a new code on your TV and enter it here.",
          ),
        );
        input.current?.focus();
      },
      Math.max(0, review.expiresMs - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [review]);
  const submit = async (approve: boolean) => {
    if (pending.current) return;
    const normalized = code.replace(/[\s-]/g, "").toUpperCase();
    if (!/^[A-F0-9]{10}$/.test(normalized)) {
      setError(
        new Error(
          "Enter the 10-character code shown on your TV (letters A–F and digits 0–9).",
        ),
      );
      input.current?.focus();
      return;
    }
    if (
      approve &&
      (!review || review.code !== normalized || review.expiresMs <= Date.now())
    ) {
      setReview(null);
      setStage("entry");
      setError(new Error("Review the current TV code before approving."));
      requestAnimationFrame(() => input.current?.focus());
      return;
    }
    const current = ++serial.current;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      if (approve) {
        await api(
          "/api/auth/pairings/approve",
          "POST",
          { userCode: normalized },
          controller.current.signal,
        );
        if (current !== serial.current) return;
        setReview(null);
        setStage("approved");
      } else {
        const result = await api<{ deviceName: string; expiresMs: number }>(
          "/api/auth/pairings/review",
          "POST",
          { userCode: normalized },
          controller.current.signal,
        );
        if (current !== serial.current) return;
        setReview({ ...result, code: normalized });
        setStage("review");
      }
      requestAnimationFrame(() => heading.current?.focus());
    } catch (failure) {
      if (current !== serial.current) return;
      setReview(null);
      const uncertain =
        approve &&
        (!(failure instanceof ApiError) ||
          failure.status === 0 ||
          failure.status >= 500);
      if (uncertain) {
        setStage("uncertain");
        setError(
          new Error(
            "Approval could not be confirmed. Check your TV: if it continued, approval succeeded. Otherwise request a new code. Do not approve an unfamiliar device.",
          ),
        );
      } else {
        setStage("entry");
        setError(
          new Error(
            failure instanceof ApiError &&
              [404, 409, 410].includes(failure.status)
              ? "This code is unavailable, expired or already used. Check that your TV is connecting to this server, then request a new code."
              : failure instanceof Error
                ? failure.message
                : "Unable to check the TV code. Try again.",
          ),
        );
      }
      requestAnimationFrame(() => {
        if (current === serial.current)
          (uncertain ? heading.current : input.current)?.focus();
      });
    } finally {
      if (current === serial.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  };
  let advertised = "";
  try {
    const url = new URL(address);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      !loopback(url.hostname) &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    )
      advertised = url.origin;
  } catch {}
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Connect TV</h1>
          <p>Enter the code from your TV, review its name, then approve.</p>
        </div>
      </header>
      <div className="two-col">
        <section className="panel">
          {stage === "approved" ? (
            <>
              <h2 ref={heading} tabIndex={-1}>
                TV approved
              </h2>
              <p role="status">
                Choose a profile on your TV to continue. The TV follows your
                account’s viewing permissions.
              </p>
              <button
                onClick={() => {
                  reset("");
                  requestAnimationFrame(() => input.current?.focus());
                }}
              >
                Connect another TV
              </button>
            </>
          ) : stage === "uncertain" ? (
            <>
              <h2 ref={heading} tabIndex={-1}>
                Check your TV
              </h2>
              <ErrorBox error={error} />
              <button
                onClick={() => {
                  reset("");
                  requestAnimationFrame(() => input.current?.focus());
                }}
              >
                Enter a new code
              </button>
            </>
          ) : (
            <>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void submit(false);
                }}
              >
                <fieldset disabled={busy}>
                  <label className="field">
                    <span>TV connection code</span>
                    <input
                      ref={input}
                      name="code"
                      aria-label="TV connection code"
                      value={code}
                      onChange={(event) => reset(event.target.value)}
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                      minLength={10}
                      maxLength={14}
                      required
                      placeholder="A1B2C D3E4F"
                      aria-describedby="pairing-format"
                    />
                  </label>
                  <small id="pairing-format">
                    10 letters/digits. Spaces, hyphens and lowercase are
                    accepted.
                  </small>
                  {stage === "entry" && (
                    <button type="submit">
                      {busy ? "Checking…" : "Review TV"}
                    </button>
                  )}
                </fieldset>
              </form>
              <ErrorBox error={error} />
              {review && (
                <section className="notice" aria-label="Review TV approval">
                  <h2 ref={heading} tabIndex={-1}>
                    {review.deviceName}
                  </h2>
                  <p>Server: {location.origin}</p>
                  <p>
                    Code:{" "}
                    <strong>{review.code.match(/.{1,5}/g)?.join(" ")}</strong> ·
                    Expires {new Date(review.expiresMs).toLocaleTimeString()}
                  </p>
                  <p id="approving-account">
                    Approve as <strong>{account.username}</strong>. This TV can
                    use profiles allowed for this account; approval is not
                    limited to the profile previously selected in this browser.
                  </p>
                  <p>
                    Only approve a device you recognize. Verify this exact code
                    and name on the TV.
                  </p>
                  <div className="actions">
                    <button
                      disabled={busy}
                      aria-describedby="approving-account"
                      onClick={() => void submit(true)}
                    >
                      {busy ? "Approving…" : "Approve TV"}
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        reset(code);
                        input.current?.focus();
                      }}
                    >
                      Cancel approval
                    </button>
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void onChangeAccount()}
                    >
                      Use another account
                    </button>
                  </div>
                </section>
              )}
            </>
          )}
        </section>
        <section className="panel">
          <h2>Server address for your TV</h2>
          {loopback(location.hostname) && (
            <p className="notice">
              This browser is using a local-only address. Your TV needs the
              server’s LAN address and published port.
            </p>
          )}
          <Field
            label="LAN server address"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder="http://192.168.1.10:8777"
          />
          {advertised ? (
            <p>
              On your TV, enter: <strong>{advertised}</strong>
            </p>
          ) : (
            <p>
              Enter a reachable LAN address, including http:// and the port.
              This check validates the format; it does not test your TV’s
              network.
            </p>
          )}
          <a href="#setup">TV installation and connection help</a>
        </section>
      </div>
    </>
  );
}
