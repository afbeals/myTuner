#!/usr/bin/env python3
"""Generate Matroska-style external chapter sidecar files for a media library.

Walks a directory tree of video files (never modifying the videos themselves) and,
for each one, writes a `<basename>.xml` chapter file next to it describing one or more
split points. ErsatzTV's local library scanner picks these up automatically and uses
them to drive Mid-Roll filler (commercial) insertion.

See ~/Code/tmp/myTuner/INVESTIGATION.md for the full design rationale.
"""

from __future__ import annotations

import argparse
import random
import subprocess
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

DEFAULT_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".m4v", ".ts"}

# ErsatzTV's own API key header name (ErsatzTV.Core/Security/ApiHelper.cs) and the
# library-scan endpoint (ErsatzTV/Controllers/Api/LibrariesController.cs).
ERSATZTV_API_KEY_HEADER = "X-Etv-Api-Key"


@dataclass
class Chapter:
    start: float
    end: float
    title: str


def ffprobe_duration(path: Path) -> float:
    """Return a video file's duration in seconds via ffprobe metadata (no decoding)."""
    result = subprocess.run(
        [
            "ffprobe",
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(result.stdout.strip())


def find_video_files(root: Path, extensions: set[str]) -> Iterator[Path]:
    for path in sorted(root.rglob("*")):
        if path.is_file() and path.suffix.lower() in extensions:
            yield path


def sidecar_path(video_path: Path) -> Path:
    return video_path.with_suffix(".xml")


def compute_split_points(
    duration: float,
    breaks: int,
    mode: str,
    fixed_percent: float,
    min_percent: float,
    max_percent: float,
) -> list[float]:
    """Return `breaks` split-point timestamps (seconds), strictly inside (0, duration),
    sorted ascending. Points are spaced into `breaks` roughly-equal regions so multiple
    breaks don't cluster together.
    """
    if breaks <= 0:
        return []

    region_width = 100.0 / breaks
    points: list[float] = []
    for i in range(breaks):
        region_start = i * region_width
        region_end = region_start + region_width

        if mode == "fixed-percent":
            percent = fixed_percent
        elif mode == "random-percent":
            lo = max(region_start, min_percent)
            hi = min(region_end, max_percent)
            if lo >= hi:
                lo, hi = region_start, region_end
            percent = random.uniform(lo, hi)
        else:
            raise ValueError(f"unknown mode: {mode}")

        points.append(duration * (percent / 100.0))

    # keep points strictly inside the file and monotonically increasing
    points = sorted(min(max(p, 0.001), duration - 0.001) for p in points)
    return points


def build_chapters(duration: float, split_points: list[float]) -> list[Chapter]:
    boundaries = [0.0, *split_points, duration]
    return [
        Chapter(start=boundaries[i], end=boundaries[i + 1], title=f"Part {i + 1}")
        for i in range(len(boundaries) - 1)
    ]


def format_timestamp(seconds: float) -> str:
    whole_seconds = int(seconds)
    hours, remainder = divmod(whole_seconds, 3600)
    minutes, secs = divmod(remainder, 60)
    millis = round((seconds - whole_seconds) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def build_chapter_xml(chapters: list[Chapter]) -> ET.Element:
    root = ET.Element("Chapters")
    edition_entry = ET.SubElement(root, "EditionEntry")
    for chapter in chapters:
        atom = ET.SubElement(edition_entry, "ChapterAtom")
        ET.SubElement(atom, "ChapterTimeStart").text = format_timestamp(chapter.start)
        ET.SubElement(atom, "ChapterTimeEnd").text = format_timestamp(chapter.end)
        display = ET.SubElement(atom, "ChapterDisplay")
        ET.SubElement(display, "ChapterString").text = chapter.title
    return root


def write_chapter_xml(path: Path, chapters: list[Chapter]) -> None:
    root = build_chapter_xml(chapters)
    ET.indent(root, space="  ")
    tree = ET.ElementTree(root)
    tree.write(path, encoding="UTF-8", xml_declaration=True)


def process_file(
    video_path: Path,
    args: argparse.Namespace,
) -> str:
    """Returns one of: "written", "skipped", "error:<message>"."""
    sidecar = sidecar_path(video_path)
    if sidecar.exists() and not args.regenerate:
        return "skipped"

    try:
        duration = ffprobe_duration(video_path)
    except (subprocess.CalledProcessError, ValueError, FileNotFoundError) as exc:
        return f"error:{exc}"

    split_points = compute_split_points(
        duration=duration,
        breaks=args.breaks,
        mode=args.mode,
        fixed_percent=args.percent,
        min_percent=args.min_percent,
        max_percent=args.max_percent,
    )
    chapters = build_chapters(duration, split_points)

    if args.dry_run:
        points_str = ", ".join(format_timestamp(p) for p in split_points)
        print(f"[dry-run] {video_path} (duration {format_timestamp(duration)}) -> splits: {points_str or 'none'}")
        return "written"

    write_chapter_xml(sidecar, chapters)
    return "written"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("library_path", type=Path, help="Root directory to scan for video files")
    parser.add_argument(
        "--mode",
        choices=["fixed-percent", "random-percent"],
        default="random-percent",
        help="How to choose each break's position within the file (default: random-percent)",
    )
    parser.add_argument("--percent", type=float, default=50.0, help="Break position for fixed-percent mode (0-100)")
    parser.add_argument("--min-percent", type=float, default=20.0, help="Lower bound for random-percent mode")
    parser.add_argument("--max-percent", type=float, default=80.0, help="Upper bound for random-percent mode")
    parser.add_argument("--breaks", type=int, default=1, help="Number of mid-roll break points per file")
    parser.add_argument("--regenerate", action="store_true", help="Overwrite sidecars that already exist")
    parser.add_argument("--dry-run", action="store_true", help="Print planned split points without writing files")
    parser.add_argument(
        "--extensions",
        nargs="*",
        default=sorted(DEFAULT_EXTENSIONS),
        help="Video file extensions to include (default: %(default)s)",
    )
    parser.add_argument(
        "--ersatztv-url",
        default=None,
        help="ErsatzTV base URL (e.g. http://localhost:8409). If set along with "
        "--library-id, triggers a library rescan after writing any sidecars.",
    )
    parser.add_argument(
        "--library-id",
        type=int,
        default=None,
        help="ErsatzTV library id to rescan (its numeric id, not its name)",
    )
    parser.add_argument(
        "--ersatztv-api-key",
        default=None,
        help="ErsatzTV API key, sent as the %s header, if the instance requires one"
        % ERSATZTV_API_KEY_HEADER,
    )
    return parser.parse_args(argv)


def trigger_rescan(base_url: str, library_id: int, api_key: str | None) -> None:
    url = f"{base_url.rstrip('/')}/api/libraries/{library_id}/scan"
    headers = {ERSATZTV_API_KEY_HEADER: api_key} if api_key else {}
    request = urllib.request.Request(url, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            print(f"rescan triggered: {url} -> HTTP {response.status}")
    except urllib.error.URLError as exc:
        print(f"error: failed to trigger rescan at {url}: {exc}", file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    extensions = {e if e.startswith(".") else f".{e}" for e in args.extensions}

    if not args.library_path.is_dir():
        print(f"error: {args.library_path} is not a directory", file=sys.stderr)
        return 1

    counts = {"written": 0, "skipped": 0, "error": 0}
    for video_path in find_video_files(args.library_path, extensions):
        result = process_file(video_path, args)
        if result.startswith("error"):
            counts["error"] += 1
            print(f"error: {video_path}: {result.split(':', 1)[1]}", file=sys.stderr)
        else:
            counts[result] += 1

    print(f"done: {counts['written']} written, {counts['skipped']} skipped, {counts['error']} errors")

    if counts["written"] and not args.dry_run and args.ersatztv_url and args.library_id:
        trigger_rescan(args.ersatztv_url, args.library_id, args.ersatztv_api_key)

    return 1 if counts["error"] else 0


if __name__ == "__main__":
    sys.exit(main())
