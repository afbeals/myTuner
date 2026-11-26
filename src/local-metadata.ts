import { readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, extname, posix } from "node:path";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Source } from "./domain.js";
import { mediaExtensions, safeMediaPath } from "./catalog.js";
const parsedFiles = new Map<
  string,
  { fingerprint: string; data: Record<string, unknown>; bytes: number }
>();
let parsedBytes = 0;
const parser = new XMLParser({
  ignoreAttributes: true,
  processEntities: false,
  parseTagValue: false,
});
export async function inspectLocalMetadata(
  source: Source,
  relativePath: string,
  singleVideo?: boolean,
  directoryNames?: ReadonlySet<string>,
): Promise<{ data: Record<string, unknown>; validNfo: boolean }> {
  const stem = basename(relativePath, extname(relativePath));
  const data: Record<string, unknown> = {
    title: stem.replace(/[._]/g, " ").trim(),
  };
  const episode = stem.match(
    /^(.*?)\bS(\d{1,3})E(\d{1,4})(?:[ ._-]*E?(\d{1,4}))?/i,
  );
  if (episode) {
    data.seasonNumber = Number(episode[2]);
    data.episodeNumber = Number(episode[3]);
    data.seriesTitle =
      episode[1]!
        .replace(/[._-]+$/g, "")
        .replace(/[._]/g, " ")
        .trim() || posix.basename(posix.dirname(relativePath));
    if (episode[4]) data.lastEpisodeNumber = Number(episode[4]);
  } else {
    const year = stem.match(/\b((?:19|20)\d{2})\b/);
    if (year) data.year = Number(year[1]);
  }
  let validNfo = false;
  const candidates = [
    relativePath.slice(0, -extname(relativePath).length) + ".nfo",
  ];
  // A generic sidecar describes one video, never every episode/movie in a folder.
  // Scans supply their existing directory enumeration; direct checks enumerate safely.
  try {
    if (singleVideo === undefined) {
      const video = await safeMediaPath(source, relativePath);
      singleVideo =
        (await readdir(dirname(video), { withFileTypes: true })).filter(
          (e) =>
            e.isFile() && mediaExtensions.has(extname(e.name).toLowerCase()),
        ).length === 1;
    }
    if (singleVideo)
      candidates.push(
        posix.join(
          posix.dirname(relativePath),
          source.kind === "movies" ? "movie.nfo" : "episode.nfo",
        ),
      );
  } catch {
    /* Uncertain directory contents cannot authorize a generic sidecar. */
  }
  for (const candidate of new Set(candidates)) {
    try {
      if (directoryNames && !directoryNames.has(basename(candidate))) continue;
      const path = await safeMediaPath(source, candidate);
      const before = await stat(path);
      if (before.size > 256 * 1024) continue;
      const fingerprint = JSON.stringify([
        before.size,
        before.mtimeMs,
        before.ctimeMs,
        before.ino,
      ]);
      const hit = parsedFiles.get(path);
      if (hit?.fingerprint === fingerprint) {
        Object.assign(data, hit.data);
        validNfo = true;
        break;
      }
      const xml = await readFile(path, "utf8");
      const after = await stat(path);
      if (
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs ||
        after.ino !== before.ino ||
        xml.length > 256 * 1024
      )
        continue;
      if (
        /<!DOCTYPE|<!ENTITY/i.test(xml) ||
        XMLValidator.validate(xml) !== true
      )
        continue;
      const parsed = parser.parse(xml) as Record<string, unknown>,
        root = parsed.movie ?? parsed.episodedetails;
      if (!root || typeof root !== "object") continue;
      const row = root as Record<string, unknown>;
      const fields: Record<string, unknown> = {};
      for (const [tag, key] of [
        ["title", "title"],
        ["plot", "overview"],
        ["showtitle", "seriesTitle"],
      ]) {
        if (typeof row[tag!] === "string") {
          const value = String(row[tag!]).slice(0, 20000);
          if ((key === "title" || key === "seriesTitle") && !value.trim())
            continue;
          data[key!] = fields[key!] = value;
        }
      }
      for (const [tag, key] of [
        ["season", "seasonNumber"],
        ["episode", "episodeNumber"],
        ["year", "year"],
      ]) {
        const value = row[tag!];
        if (typeof value !== "string" || !/^\d+$/.test(value.trim())) continue;
        const n = Number(value);
        if (Number.isSafeInteger(n)) data[key!] = fields[key!] = n;
      }
      if (typeof row.set === "string")
        data.collection = fields.collection = { title: row.set };
      else if (
        row.set &&
        typeof row.set === "object" &&
        typeof (row.set as { name?: unknown }).name === "string"
      )
        data.collection = fields.collection = {
          title: (row.set as { name: string }).name,
        };
      validNfo = true;
      const bytes = Buffer.byteLength(JSON.stringify(fields));
      if (hit) {
        parsedFiles.delete(path);
        parsedBytes -= hit.bytes;
      }
      while (
        parsedFiles.size &&
        (parsedFiles.size >= 512 || parsedBytes + bytes > 8 * 1024 ** 2)
      ) {
        const oldest = parsedFiles.keys().next().value!;
        parsedBytes -= parsedFiles.get(oldest)!.bytes;
        parsedFiles.delete(oldest);
      }
      parsedFiles.set(path, { fingerprint, data: fields, bytes });
      parsedBytes += bytes;
      break;
    } catch {
      /* Optional read-only metadata must not prevent playable files from being cataloged. */
    }
  }
  return { data, validNfo };
}
export async function localMetadata(
  source: Source,
  relativePath: string,
): Promise<Record<string, unknown>> {
  return (await inspectLocalMetadata(source, relativePath)).data;
}
