import { useEffect, useRef, useState, type ReactNode } from "react";
import unraid from "../../docs/UNRAID_DOCKER_TAB.md?raw";
import television from "../../docs/TV_INSTALLATION.md?raw";
import operations from "../../docs/OPERATIONS.md?raw";
import windows from "../../docs/WINDOWS_DOCKER.md?raw";
import pkg from "../../package.json";
const documents = {
  tv: {
    title: "Install and connect a TV",
    text: television,
    file: "TV_INSTALLATION.md",
  },
  server: {
    title: "Set up the Unraid container",
    text: unraid,
    file: "UNRAID_DOCKER_TAB.md",
  },
  recovery: {
    title: "Back up and restore",
    text: operations,
    file: "OPERATIONS.md",
  },
  windows: {
    title: "Build and update on Windows",
    text: windows,
    file: "WINDOWS_DOCKER.md",
  },
};
type Topic = keyof typeof documents;
function topic(): Topic {
  const key =
    new URLSearchParams(location.hash.split("?")[1] ?? "").get("topic") ?? "tv";
  return Object.hasOwn(documents, key) ? (key as Topic) : "tv";
}
function linkTarget(target: string) {
  if (target.startsWith("#"))
    return `#setup?topic=${topic()}&section=${encodeURIComponent(target.slice(1))}`;
  const name = target.split("/").at(-1)?.split("#")[0];
  const entry = Object.entries(documents).find(([, doc]) => doc.file === name);
  if (entry) return `#setup?topic=${entry[0]}`;
  if (/^https?:\/\//.test(target)) return target;
  if (/^[A-Za-z0-9_./-]+\.md(?:#[\w-]+)?$/.test(target))
    return `https://github.com/afbeals/myTuner/blob/main/${target.startsWith("../") ? target.slice(3) : `docs/${target.replace(/^\.\//, "")}`}`;
  return null;
}
function inline(text: string): ReactNode[] {
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g)
    .map((part, index) => {
      if (part.startsWith("`"))
        return <code key={index}>{part.slice(1, -1)}</code>;
      if (part.startsWith("**"))
        return <strong key={index}>{part.slice(2, -2)}</strong>;
      const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        const target = linkTarget(link[2]!);
        if (target)
          return (
            <a
              key={index}
              href={target}
              {...(target.startsWith("http")
                ? { target: "_blank", rel: "noreferrer" }
                : {})}
            >
              {link[1]}
            </a>
          );
      }
      return part;
    });
}
/** Curated bundled Markdown. React escapes all text; embedded HTML is never executed. */
function Document({ text }: { text: string }) {
  const lines = text.split("\n"),
    blocks: ReactNode[] = [];
  let n = 0;
  while (n < lines.length) {
    const line = lines[n]!,
      key = n;
    if (!line.trim()) {
      n++;
      continue;
    }
    if (line.startsWith("```")) {
      const language = line.slice(3);
      const code: string[] = [];
      for (n++; n < lines.length && !lines[n]!.startsWith("```"); n++)
        code.push(lines[n]!);
      n++;
      blocks.push(
        <figure className="help-command" key={key}>
          {language && <figcaption>{language}</figcaption>}
          <pre tabIndex={0}>
            <code>{code.join("\n")}</code>
          </pre>
        </figure>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const title = heading[2]!,
        id = title
          .toLowerCase()
          .replace(/[^a-z0-9 -]/g, "")
          .replaceAll(" ", "-");
      blocks.push(
        heading[1]!.length <= 2 ? (
          <h2 id={id} key={key}>
            {inline(title)}
          </h2>
        ) : (
          <h3 id={id} key={key}>
            {inline(title)}
          </h3>
        ),
      );
      n++;
      continue;
    }
    if (line.startsWith("|") && lines[n + 1]?.match(/^\|[ :|-]+\|$/)) {
      const cells = (row: string) =>
        row
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((cell) => cell.trim());
      const headers = cells(line),
        rows: string[][] = [];
      n += 2;
      while (n < lines.length && lines[n]!.startsWith("|"))
        rows.push(cells(lines[n++]!));
      blocks.push(
        <div className="table-scroll" key={key}>
          <table>
            <thead>
              <tr>
                {headers.map((header, i) => (
                  <th key={i}>{inline(header)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{inline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*(?:[-*]|\d+\.)\s/.test(line)) {
      const startNumber = Number(line.match(/^\s*(\d+)\./)?.[1] ?? 1),
        ordered = /^\s*\d+\./.test(line),
        items: ReactNode[] = [];
      while (n < lines.length && /^\s*(?:[-*]|\d+\.)\s/.test(lines[n]!))
        items.push(
          <li key={n}>
            {inline(lines[n++]!.replace(/^\s*(?:[-*]|\d+\.)\s/, ""))}
          </li>,
        );
      blocks.push(
        ordered ? (
          <ol key={key} start={startNumber}>
            {items}
          </ol>
        ) : (
          <ul key={key}>{items}</ul>
        ),
      );
      continue;
    }
    if (/^---+$/.test(line)) {
      n++;
      continue;
    }
    const paragraph: string[] = [];
    while (
      n < lines.length &&
      lines[n]!.trim() &&
      !/^(?:#|```|\||\s*[-*] |\s*\d+\. )/.test(lines[n]!)
    )
      paragraph.push(lines[n++]!.replace(/^>\s?/, ""));
    if (!paragraph.length) paragraph.push(lines[n++]!);
    blocks.push(<p key={key}>{inline(paragraph.join(" "))}</p>);
  }
  return <article className="help-document">{blocks}</article>;
}
export function HelpPage({ returnTo = "#watch" }: { returnTo?: string }) {
  const [selected, setSelected] = useState<Topic>(topic),
    [download, setDownload] = useState("");
  const main = useRef<HTMLElement>(null);
  const doc = documents[selected],
    safeReturn =
      /^#(?:watch|channels|library|sources|profiles|accounts|generated|operations|connect-tv|sessions|reports|subscriptions)(?:\?.*)?$/.test(
        returnTo,
      )
        ? returnTo
        : "#watch";
  useEffect(() => {
    let frame = 0;
    const changed = () => {
      setSelected(topic());
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const section = new URLSearchParams(
            location.hash.split("?")[1] ?? "",
          ).get("section"),
          target = section ? document.getElementById(section) : null;
        if (target) {
          target.tabIndex = -1;
          target.focus();
          target.scrollIntoView({ block: "start" });
        } else main.current?.focus();
      });
    };
    changed();
    window.addEventListener("hashchange", changed);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", changed);
    };
  }, []);
  useEffect(() => {
    const url = URL.createObjectURL(
      new Blob([doc.text], { type: "text/markdown;charset=utf-8" }),
    );
    setDownload(url);
    return () => URL.revokeObjectURL(url);
  }, [selected]);
  return (
    <main id="main" ref={main} tabIndex={-1} className="help panel">
      <header className="page-head">
        <div>
          <h1>Setup & TV help</h1>
          <p>Documentation bundled with myTuner {pkg.version}.</p>
        </div>
        <a className="button secondary" href={safeReturn}>
          Back to myTuner
        </a>
      </header>
      <nav className="help-topics" aria-label="Help topics">
        {Object.entries(documents).map(([key, value]) => (
          <a
            className={`button ${selected === key ? "selected" : "secondary"}`}
            aria-current={selected === key ? "page" : undefined}
            key={key}
            href={`#setup?topic=${key}`}
          >
            {value.title}
          </a>
        ))}
      </nav>
      <section className="notice" aria-labelledby="installed-tv-title">
        <h2 id="installed-tv-title">Already installed on your TV?</h2>
        <ol>
          <li>Start the myTuner container and open the app on your TV.</li>
          <li>
            Enter the Unraid LAN address and published myTuner port on the TV.
          </li>
          <li>
            Sign in here, open Connect TV, and review and approve the exact code
            shown on that TV.
          </li>
          <li>
            On the TV, select a permitted profile, enter its PIN if protected,
            and choose a subscribed channel.
          </li>
        </ol>
        <p>
          ADB pairing installs the app; myTuner approval connects it to your
          account. You do not need ADB for everyday viewing.
        </p>
        <div className="actions">
          <a className="button" href="#connect-tv">
            Connect TV / sign in
          </a>
          <a className="button secondary" href="#watch">
            Watch TV / sign in
          </a>
          <a className="button secondary" href="#operations">
            Server health · administrator
          </a>
        </div>
        <p>
          <a href="#setup?topic=tv&section=4-connect-the-installed-app-to-unraid">
            Detailed TV connection steps
          </a>
          {" · "}
          <a href="#setup?topic=tv&section=everyday-remote-controls">
            Remote controls
          </a>
        </p>
      </section>
      <section className="notice">
        <h2>{doc.title}</h2>
        {selected === "tv" ? (
          <p>
            Android/Google TV and Android-based Fire TV use the Android client.
            An administrator builds and installs the APK using the instructions
            below. No public prebuilt APK distribution is assumed. Vega OS
            devices need a different client.
          </p>
        ) : selected === "recovery" ? (
          <p>
            Backups are started by an operator. Restoring requires a stopped
            application, a complete verified backup bundle and a compatible
            image. Restore signs out every browser and TV; pair TVs again
            afterward.
          </p>
        ) : (
          <p>
            Use the Unraid Docker tab to manage the container. Keep original
            media read-only and publish port 8777. Create the first
            administrator only if one does not already exist.
          </p>
        )}
        <div className="actions">
          <a href={download} download={doc.file}>
            Save these instructions as Markdown
          </a>
          <a
            href="https://github.com/afbeals/myTuner"
            target="_blank"
            rel="noreferrer"
          >
            Project source on GitHub
          </a>
        </div>
      </section>
      <Document text={doc.text} />
      <a href="#setup">Back to help topics</a>
    </main>
  );
}
