import copy
import importlib.util
import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "video_pipeline.py"
SPEC = importlib.util.spec_from_file_location("video_pipeline", MODULE_PATH)
assert SPEC and SPEC.loader
pipeline = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(pipeline)


def template():
    return json.loads((ROOT / "timelines/tutorial-booking.template.json").read_text(encoding="utf-8"))


class TimelineValidationTests(unittest.TestCase):
    def test_template_is_valid_but_not_final(self):
        self.assertEqual([], pipeline.validate_timeline(template()))

    def test_path_escape_is_rejected(self):
        data = template()
        data["scenes"][0]["recording"] = "../outside.mp4"
        self.assertTrue(any("cannot escape" in error for error in pipeline.validate_timeline(data)))

    def test_overlapping_or_out_of_range_segments_are_rejected(self):
        data = template()
        data["narration"]["segments"][1]["start"] = 3
        data["narration"]["segments"][-1]["end"] = 80
        errors = pipeline.validate_timeline(data)
        self.assertTrue(any("invalid or overlapping" in error for error in errors))

    def test_output_dimension_and_fps_are_limited_to_supported_formats(self):
        data = template()
        data["format"]["width"] = 1000
        data["format"]["fps"] = 24
        errors = pipeline.validate_timeline(data)
        self.assertTrue(any("1920x1080 or 1080x1920" in error for error in errors))

    def test_scene_ranges_define_ordered_runtime_without_compression(self):
        data = template()
        self.assertEqual(62.0, pipeline.planned_duration(data))
        data["scenes"][0]["output_duration_seconds"] = 5.5
        data["scenes"][1]["playback_rate"] = 1.2
        errors = pipeline.validate_timeline(data)
        self.assertTrue(any("output_duration_seconds" in error for error in errors))
        self.assertTrue(any("playback_rate" in error for error in errors))

    def test_tutorial_runtime_must_stay_within_target_range(self):
        data = template()
        data["scenes"][0]["source_end"] = 1
        data["scenes"][0]["output_duration_seconds"] = 1
        errors = pipeline.validate_timeline(data)
        self.assertTrue(any("Ordered scene runtime" in error for error in errors))

    def test_vertical_timeline_is_supported(self):
        data = template()
        data["format"].update({"width": 1080, "height": 1920, "min_duration_seconds": 20, "max_duration_seconds": 90})
        self.assertEqual([], pipeline.validate_timeline(data))

    def test_multiscene_filters_preserve_source_order_and_zoom(self):
        data = template()
        first = pipeline.scene_filter(0, data["scenes"][0], data)
        second = pipeline.scene_filter(1, data["scenes"][1], data)
        self.assertIn("[0:v]trim=duration=6.000000", first)
        self.assertIn("[1:v]trim=duration=12.000000", second)
        self.assertIn("trunc(iw*1.0300/2)*2", second)

    def test_source_crop_is_validated_and_applied_before_scaling(self):
        data = template()
        data["scenes"][0]["framing"]["source_crop"] = {"x": 0, "y": 0, "width": 390, "height": 844}
        data["scenes"][0]["label"] = "PREVIEW · Booking complete"
        self.assertEqual([], pipeline.validate_timeline(data))
        filter_text = pipeline.scene_filter(0, data["scenes"][0], data, Path("/tmp/label.txt"))
        self.assertLess(filter_text.index("crop=390:844:0:0"), filter_text.index("scale="))
        self.assertIn("drawtext=textfile='/tmp/label.txt'", filter_text)

    def test_invalid_source_crop_and_label_cover_are_rejected(self):
        data = template()
        data["scenes"][0]["framing"]["source_crop"] = {"x": 0, "y": 0, "width": 0, "height": 844}
        data["scenes"][0]["label"] = "Service"
        data["scenes"][0]["framing"]["fit"] = "cover"
        errors = pipeline.validate_timeline(data)
        self.assertTrue(any("source_crop" in error for error in errors))
        self.assertTrue(any("outside the app UI" in error for error in errors))

    def test_source_crop_bounds_are_checked_against_probe_dimensions(self):
        data = template()
        data["scenes"][0]["framing"]["source_crop"] = {"x": 0, "y": 0, "width": 390, "height": 844}
        recordings = [ROOT / "work" / "recording.mp4"] * len(data["scenes"])
        with patch.object(pipeline, "media_duration", return_value=20), patch.object(pipeline, "source_dimensions", return_value=(780, 1688)):
            pipeline.validate_recording_sources(data, recordings)
        data["scenes"][0]["framing"]["source_crop"]["height"] = 1689
        with patch.object(pipeline, "media_duration", return_value=20), patch.object(pipeline, "source_dimensions", return_value=(780, 1688)):
            with self.assertRaisesRegex(pipeline.PipelineError, "exceeds"):
                pipeline.validate_recording_sources(data, recordings)


class SubtitleTests(unittest.TestCase):
    def test_srt_and_vtt_use_explicit_timing(self):
        data = template()
        srt = pipeline.subtitle_text(data["narration"]["segments"][:1], False)
        vtt = pipeline.subtitle_text(data["narration"]["segments"][:1], True)
        self.assertIn("00:00:00,000 --> 00:00:05,500", srt)
        self.assertTrue(vtt.startswith("WEBVTT\n\n00:00:00.000 --> 00:00:05.500"))

    def test_long_subtitles_split_into_short_two_line_cues(self):
        cues = pipeline.split_caption("one two three four five six seven eight nine ten eleven twelve", max_chars=12)
        self.assertGreater(len(cues), 1)
        for cue in cues:
            self.assertLessEqual(len(cue.splitlines()), 2)
            self.assertTrue(all(len(line) <= 12 for line in cue.splitlines()))


class OfflineSafetyTests(unittest.TestCase):
    def test_tts_plan_is_deterministic_and_never_starts_a_process(self):
        data = template()
        with patch.object(subprocess, "run") as run_mock:
            first = pipeline.tts_plan(data)
            second = pipeline.tts_plan(copy.deepcopy(data))
        self.assertEqual(first["cache_key"], second["cache_key"])
        self.assertEqual("dry-run-only", first["mode"])
        run_mock.assert_not_called()

    def test_normal_render_fails_before_invoking_ffmpeg_when_media_is_missing(self):
        data = template()
        with patch.object(pipeline, "executable") as executable_mock, patch.object(pipeline, "run") as run_mock:
            with self.assertRaisesRegex(pipeline.PipelineError, "Approved scene recordings"):
                pipeline.render(data)
        executable_mock.assert_called_once_with("ffmpeg", "VIDEO_FFMPEG")
        run_mock.assert_not_called()

    def test_internal_test_refuses_final_timeline(self):
        data = template()
        data["status"] = "final"
        with self.assertRaisesRegex(pipeline.PipelineError, "Invalid timeline"):
            pipeline.render(data, internal_test=True)

    def test_silent_draft_only_targets_internal_drafts(self):
        data = template()
        recordings = [ROOT / "work" / "recording.mp4"] * len(data["scenes"])
        with patch.object(pipeline, "executable", return_value="ffmpeg"), patch.object(pipeline, "required_recordings", return_value=recordings), patch.object(pipeline, "validate_recording_sources"), patch.object(pipeline, "run") as run_mock:
            result = pipeline.render(data, internal_silent_draft=True)
        self.assertIn("work/internal-drafts", result["internal_silent_draft"])
        self.assertEqual("internal-silent-draft-not-approval-ready", result["render_status"])
        self.assertNotIn(data["outputs"]["clean"], result["internal_silent_draft"])
        self.assertEqual(1, run_mock.call_count)

    def test_mobile_right_layout_keeps_app_and_captions_in_separate_areas(self):
        data = template()
        data["layout"] = {"mode": "landscape-mobile-right"}
        data["caption_style"] = {"font_size": 24, "margin_vertical": 110, "margin_left": 80, "alignment": 1}
        self.assertEqual([], pipeline.validate_timeline(data))
        filter_text = pipeline.scene_filter(0, data["scenes"][0], data)
        self.assertIn("pad=1920:1080:1200:90:#F7F1E8", filter_text)
        self.assertIn("drawbox=x=1192:y=82", filter_text)
        self.assertEqual({"font_size": 24, "margin_vertical": 110, "margin_left": 80, "alignment": 1}, pipeline.caption_style(data))

    def test_mobile_right_editorial_defaults_are_readable_and_wrapped(self):
        data = template()
        data["layout"] = {"mode": "landscape-mobile-right"}
        editorial = pipeline.editorial_style(data)
        self.assertEqual((120, 240, 60), (editorial["title_x"], editorial["title_y"], editorial["title_font_size"]))
        self.assertEqual((120, 520, 36), (editorial["label_x"], editorial["label_y"], editorial["label_font_size"]))
        self.assertEqual("This is what\nyour clients see", pipeline.wrap_editorial_text("This is what your clients see", 16))
        self.assertEqual({"font_size": 25, "margin_vertical": 240, "margin_left": 120, "alignment": 1}, pipeline.caption_style(data))

    def test_mobile_right_layout_is_landscape_only(self):
        data = template()
        data["format"].update({"width": 1080, "height": 1920, "min_duration_seconds": 20, "max_duration_seconds": 90})
        data["layout"] = {"mode": "landscape-mobile-right"}
        self.assertTrue(any("requires 1920x1080" in error for error in pipeline.validate_timeline(data)))


if __name__ == "__main__":
    unittest.main()
