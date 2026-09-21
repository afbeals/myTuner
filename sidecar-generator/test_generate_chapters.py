import subprocess
import unittest
import urllib.error
import xml.etree.ElementTree as ET
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, patch

from generate_chapters import (
    ERSATZTV_API_KEY_HEADER,
    build_chapter_xml,
    build_chapters,
    compute_split_points,
    find_video_files,
    format_timestamp,
    main,
    parse_args,
    process_file,
    sidecar_path,
    trigger_rescan,
)


class FormatTimestampTests(unittest.TestCase):
    def test_formats_hours_minutes_seconds_millis(self):
        self.assertEqual(format_timestamp(0), "00:00:00.000")
        self.assertEqual(format_timestamp(3661.5), "01:01:01.500")

    def test_matches_ersatztv_regex_shape(self):
        # ErsatzTV's LocalChaptersProvider accepts HH:MM:SS.mmm
        import re

        pattern = re.compile(r"^(\d{1,2}):(\d{2}):(\d{2})[\.,](\d{3})$")
        self.assertTrue(pattern.match(format_timestamp(1234.567)))


class ComputeSplitPointsTests(unittest.TestCase):
    def test_fixed_percent_single_break(self):
        points = compute_split_points(
            duration=1000.0, breaks=1, mode="fixed-percent",
            fixed_percent=16.0, min_percent=20.0, max_percent=80.0,
        )
        self.assertEqual(points, [160.0])

    def test_no_breaks_returns_empty(self):
        points = compute_split_points(
            duration=1000.0, breaks=0, mode="fixed-percent",
            fixed_percent=16.0, min_percent=20.0, max_percent=80.0,
        )
        self.assertEqual(points, [])

    def test_random_percent_stays_within_bounds_and_sorted(self):
        for _ in range(50):
            points = compute_split_points(
                duration=1000.0, breaks=2, mode="random-percent",
                fixed_percent=50.0, min_percent=10.0, max_percent=90.0,
            )
            self.assertEqual(len(points), 2)
            self.assertEqual(points, sorted(points))
            for p in points:
                self.assertGreater(p, 0.0)
                self.assertLess(p, 1000.0)

    def test_multiple_breaks_do_not_collapse_to_same_region(self):
        # with 2 breaks and a narrow fixed percent per region, points should still
        # land in distinct, increasing regions rather than overlapping
        points = compute_split_points(
            duration=1000.0, breaks=2, mode="random-percent",
            fixed_percent=50.0, min_percent=0.0, max_percent=100.0,
        )
        self.assertLess(points[0], points[1])


class BuildChaptersTests(unittest.TestCase):
    def test_covers_full_duration_contiguously_with_one_split(self):
        chapters = build_chapters(duration=1000.0, split_points=[160.0])
        self.assertEqual(len(chapters), 2)
        self.assertEqual(chapters[0].start, 0.0)
        self.assertEqual(chapters[0].end, 160.0)
        self.assertEqual(chapters[1].start, 160.0)
        self.assertEqual(chapters[1].end, 1000.0)

    def test_no_splits_yields_single_chapter_covering_whole_file(self):
        chapters = build_chapters(duration=1000.0, split_points=[])
        self.assertEqual(len(chapters), 1)
        self.assertEqual((chapters[0].start, chapters[0].end), (0.0, 1000.0))

    def test_multiple_splits_are_contiguous(self):
        chapters = build_chapters(duration=1000.0, split_points=[100.0, 500.0])
        self.assertEqual(len(chapters), 3)
        for i in range(len(chapters) - 1):
            self.assertEqual(chapters[i].end, chapters[i + 1].start)
        self.assertEqual(chapters[0].start, 0.0)
        self.assertEqual(chapters[-1].end, 1000.0)


class BuildChapterXmlTests(unittest.TestCase):
    def test_xml_shape_matches_what_ersatztv_parses(self):
        chapters = build_chapters(duration=1000.0, split_points=[160.0])
        root = build_chapter_xml(chapters)

        # ErsatzTV looks for //Chapters -> .//ChapterAtom -> ChapterTimeStart/End + ChapterString
        self.assertEqual(root.tag, "Chapters")
        atoms = root.findall(".//ChapterAtom")
        self.assertEqual(len(atoms), 2)

        first_start = atoms[0].find(".//ChapterTimeStart").text
        first_end = atoms[0].find(".//ChapterTimeEnd").text
        self.assertEqual(first_start, "00:00:00.000")
        self.assertEqual(first_end, format_timestamp(160.0))

        title = atoms[0].find(".//ChapterString").text
        self.assertTrue(title)


class SidecarPathTests(unittest.TestCase):
    def test_sidecar_is_same_basename_with_xml_extension(self):
        video = Path("/library/Show/Season 01/Show - S01E01.mp4")
        sidecar = sidecar_path(video)
        self.assertEqual(sidecar, Path("/library/Show/Season 01/Show - S01E01.xml"))


class FindVideoFilesTests(unittest.TestCase):
    def test_finds_only_configured_extensions(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "a.mp4").touch()
            (root / "b.xml").touch()
            (root / "c.mkv").touch()
            (root / "sub").mkdir()
            (root / "sub" / "d.mov").touch()

            found = sorted(p.name for p in find_video_files(root, {".mp4", ".mkv", ".mov"}))
            self.assertEqual(found, ["a.mp4", "c.mkv", "d.mov"])


class ProcessFileTests(unittest.TestCase):
    def _args(self, **overrides):
        defaults = dict(
            mode="fixed-percent",
            percent=16.0,
            min_percent=20.0,
            max_percent=80.0,
            breaks=1,
            regenerate=False,
            dry_run=False,
        )
        defaults.update(overrides)
        return type("Args", (), defaults)()

    @patch("generate_chapters.ffprobe_duration", return_value=600.0)
    def test_writes_sidecar_when_absent(self, mock_duration):
        with TemporaryDirectory() as tmp:
            video = Path(tmp) / "episode.mp4"
            video.touch()

            result = process_file(video, self._args())

            self.assertEqual(result, "written")
            sidecar = sidecar_path(video)
            self.assertTrue(sidecar.exists())
            tree = ET.parse(sidecar)
            self.assertEqual(len(tree.getroot().findall(".//ChapterAtom")), 2)

    @patch("generate_chapters.ffprobe_duration", return_value=600.0)
    def test_skips_existing_sidecar_without_regenerate(self, mock_duration):
        with TemporaryDirectory() as tmp:
            video = Path(tmp) / "episode.mp4"
            video.touch()
            sidecar_path(video).write_text("<Chapters/>")

            result = process_file(video, self._args(regenerate=False))

            self.assertEqual(result, "skipped")
            mock_duration.assert_not_called()

    @patch("generate_chapters.ffprobe_duration", return_value=600.0)
    def test_regenerate_overwrites_existing_sidecar(self, mock_duration):
        with TemporaryDirectory() as tmp:
            video = Path(tmp) / "episode.mp4"
            video.touch()
            sidecar_path(video).write_text("<Chapters/>")

            result = process_file(video, self._args(regenerate=True))

            self.assertEqual(result, "written")
            mock_duration.assert_called_once()

    @patch(
        "generate_chapters.ffprobe_duration",
        side_effect=subprocess.CalledProcessError(1, "ffprobe"),
    )
    def test_ffprobe_failure_is_reported_as_error(self, mock_duration):
        with TemporaryDirectory() as tmp:
            video = Path(tmp) / "corrupt.mp4"
            video.touch()

            result = process_file(video, self._args())

            self.assertTrue(result.startswith("error:"))
            self.assertFalse(sidecar_path(video).exists())


class ParseArgsTests(unittest.TestCase):
    def test_defaults(self):
        args = parse_args(["/some/library"])
        self.assertEqual(args.library_path, Path("/some/library"))
        self.assertEqual(args.mode, "random-percent")
        self.assertEqual(args.breaks, 1)
        self.assertFalse(args.regenerate)
        self.assertFalse(args.dry_run)
        self.assertIsNone(args.ersatztv_url)
        self.assertIsNone(args.library_id)
        self.assertIsNone(args.ersatztv_api_key)


class TriggerRescanTests(unittest.TestCase):
    @patch("generate_chapters.urllib.request.urlopen")
    def test_posts_to_scan_endpoint_with_api_key_header(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.status = 200
        mock_urlopen.return_value.__enter__.return_value = mock_response

        trigger_rescan("http://localhost:8409", 3, "secret")

        request = mock_urlopen.call_args[0][0]
        self.assertEqual(request.full_url, "http://localhost:8409/api/libraries/3/scan")
        self.assertEqual(request.get_method(), "POST")
        # urllib.request.Request normalizes header keys via str.capitalize()
        self.assertEqual(request.get_header(ERSATZTV_API_KEY_HEADER.capitalize()), "secret")

    @patch("generate_chapters.urllib.request.urlopen")
    def test_omits_header_when_no_api_key(self, mock_urlopen):
        mock_response = MagicMock()
        mock_response.status = 200
        mock_urlopen.return_value.__enter__.return_value = mock_response

        trigger_rescan("http://localhost:8409", 3, None)

        request = mock_urlopen.call_args[0][0]
        self.assertIsNone(request.get_header(ERSATZTV_API_KEY_HEADER.capitalize()))

    @patch("generate_chapters.urllib.request.urlopen", side_effect=urllib.error.URLError("boom"))
    def test_connection_failure_is_reported_not_raised(self, mock_urlopen):
        # should not raise - just log to stderr
        trigger_rescan("http://localhost:8409", 3, None)


class MainRescanGatingTests(unittest.TestCase):
    @patch("generate_chapters.trigger_rescan")
    @patch("generate_chapters.ffprobe_duration", return_value=600.0)
    def test_triggers_rescan_when_files_written_and_rescan_args_given(self, mock_duration, mock_rescan):
        with TemporaryDirectory() as tmp:
            (Path(tmp) / "episode.mp4").touch()
            main([tmp, "--ersatztv-url", "http://localhost:8409", "--library-id", "3"])
            mock_rescan.assert_called_once_with("http://localhost:8409", 3, None)

    @patch("generate_chapters.trigger_rescan")
    @patch("generate_chapters.ffprobe_duration", return_value=600.0)
    def test_no_rescan_when_rescan_args_missing(self, mock_duration, mock_rescan):
        with TemporaryDirectory() as tmp:
            (Path(tmp) / "episode.mp4").touch()
            main([tmp])
            mock_rescan.assert_not_called()

    @patch("generate_chapters.trigger_rescan")
    @patch("generate_chapters.ffprobe_duration", return_value=600.0)
    def test_no_rescan_on_dry_run(self, mock_duration, mock_rescan):
        with TemporaryDirectory() as tmp:
            (Path(tmp) / "episode.mp4").touch()
            main([tmp, "--dry-run", "--ersatztv-url", "http://localhost:8409", "--library-id", "3"])
            mock_rescan.assert_not_called()

    @patch("generate_chapters.trigger_rescan")
    @patch("generate_chapters.ffprobe_duration", return_value=600.0)
    def test_no_rescan_when_everything_skipped(self, mock_duration, mock_rescan):
        with TemporaryDirectory() as tmp:
            video = Path(tmp) / "episode.mp4"
            video.touch()
            sidecar_path(video).write_text("<Chapters/>")
            main([tmp, "--ersatztv-url", "http://localhost:8409", "--library-id", "3"])
            mock_rescan.assert_not_called()


if __name__ == "__main__":
    unittest.main()
