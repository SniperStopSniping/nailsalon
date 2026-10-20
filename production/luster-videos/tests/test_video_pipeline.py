import copy
import importlib.util
import json
import subprocess
import tempfile
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

    def test_click_plan_uses_raw_source_time_with_scene_edit_offset(self):
        data = template()
        data["scenes"][0]["framing"]["source_crop"] = {"x": 0, "y": 0, "width": 390, "height": 844}
        data["scenes"][1]["framing"]["source_crop"] = {"x": 0, "y": 0, "width": 390, "height": 844}
        data["scenes"][1]["clicks"] = [{"source_time": 3.0, "x": 195, "y": 422, "label": "Add", "evidence": "Observed capture click."}]
        self.assertEqual([], pipeline.validate_timeline(data))
        event = pipeline.click_plan(data)[0]
        self.assertEqual(9.0, event["edit_time"])
        self.assertGreater(event["x"], 0)
        self.assertGreater(event["y"], 0)

    def test_click_mapping_respects_crop_and_mobile_right_frame(self):
        data = template()
        data["layout"] = {"mode": "landscape-mobile-right"}
        scene = data["scenes"][0]
        scene["framing"]["source_crop"] = {"x": 0, "y": 0, "width": 390, "height": 844}
        x, y = pipeline.map_raw_click(scene, data, 195, 422)
        self.assertAlmostEqual(1412.56, x, places=2)
        self.assertAlmostEqual(550.0, y, places=1)

    def test_scene_app_x_override_moves_render_and_clicks_without_changing_default(self):
        data = template()
        data["layout"] = {"mode": "landscape-mobile-right", "app_x": 1200}
        scene = data["scenes"][0]
        scene["framing"]["source_crop"] = {"x": 0, "y": 0, "width": 390, "height": 844}
        default_x, default_y = pipeline.map_raw_click(scene, data, 195, 422)
        scene["framing"]["app_x"] = 1320
        self.assertEqual([], pipeline.validate_timeline(data))
        overridden_x, overridden_y = pipeline.map_raw_click(scene, data, 195, 422)
        self.assertEqual(120, overridden_x - default_x)
        self.assertEqual(default_y, overridden_y)
        self.assertIn("pad=1920:1080:1320:90:#F7F1E8", pipeline.scene_filter(0, scene, data))
        del scene["framing"]["app_x"]
        self.assertEqual((default_x, default_y), pipeline.map_raw_click(scene, data, 195, 422))
        scene["framing"]["app_x"] = 1801
        self.assertTrue(any("framing.app_x" in error for error in pipeline.validate_timeline(data)))

    def test_invalid_or_overlapping_clicks_are_rejected(self):
        data = template()
        scene = data["scenes"][0]
        scene["framing"]["source_crop"] = {"x": 0, "y": 0, "width": 390, "height": 844}
        scene["clicks"] = [
            {"source_time": 1.0, "x": 500, "y": 422, "label": "Add", "evidence": "Observed."},
            {"source_time": 1.2, "x": 195, "y": 422, "label": "Continue", "evidence": "Observed."},
        ]
        errors = pipeline.validate_timeline(data)
        self.assertTrue(any("inside the visible" in error for error in errors))
        self.assertTrue(any("overlap" in error for error in errors))

    def test_annotation_filter_path_is_shared_by_silent_and_clean_exports(self):
        data = template()
        plan = [{"edit_time": 3.0, "x": 500.0, "y": 400.0, "label": "Continue", "evidence": "Observed."}]
        filters_a = ["[base]null[video]"]
        filters_b = ["[base]null[video]"]
        label_a = pipeline.append_annotation_filters(filters_a, plan, 4, data)
        label_b = pipeline.append_annotation_filters(filters_b, plan, 4, data)
        self.assertEqual("click_0", label_a)
        self.assertEqual(filters_a, filters_b)
        self.assertTrue(any("between(t\\,2.720\\,3.180)" in item for item in filters_a))


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

    def test_ass_subtitles_use_output_resolution_and_configured_pixel_style(self):
        data = template()
        data["format"].update({"width": 1920, "height": 1080})
        data["caption_style"] = {"font_size": 56, "margin_vertical": 110, "margin_left": 80, "margin_right": 780, "alignment": 1, "text_color": "#292421", "outline_color": "#F7F1E8", "outline_width": 0}
        data["narration"]["segments"] = [{"start": 0, "end": 5, "text": "Braces {stay literal} and captions retain two lines."}]
        ass = pipeline.ass_subtitle_text(data)
        self.assertIn("PlayResX: 1920", ass)
        self.assertIn("PlayResY: 1080", ass)
        self.assertIn("Style: LusterCaptions,Verdana,56", ass)
        self.assertIn("&H00212429,&H000000FF,&H00E8F1F7", ass)
        self.assertIn(",1,0,0,1,80,780,110,1", ass)
        self.assertIn(",1,80,780,110,1", ass)
        self.assertIn("Braces \\{stay literal\\} and captions\\Nretain two lines.", ass)
        dialogue_lines = [line for line in ass.splitlines() if line.startswith("Dialogue:")]
        self.assertTrue(dialogue_lines)
        self.assertTrue(all(line.count("\\N") <= 1 for line in dialogue_lines))

    def test_caption_color_fields_reject_non_hex_values(self):
        data = template()
        data["caption_style"] = {"text_color": "white;FontName=Injected", "outline_color": "#FFFFF", "outline_width": 5}
        errors = pipeline.validate_timeline(data)
        self.assertTrue(any("text_color" in error for error in errors))
        self.assertTrue(any("outline_color" in error for error in errors))
        self.assertTrue(any("outline_width" in error for error in errors))

    def test_write_subtitles_keeps_srt_vtt_and_ass_sidecars_together(self):
        data = template()
        with tempfile.TemporaryDirectory() as temp:
            data["outputs"]["srt"] = "subtitles/tutorial-booking.srt"
            data["outputs"]["vtt"] = "subtitles/tutorial-booking.vtt"
            with patch.object(pipeline, "ROOT", Path(temp)):
                srt, vtt = pipeline.write_subtitles(data)
                self.assertTrue(srt.is_file())
                self.assertTrue(vtt.is_file())
                ass = srt.with_suffix(".ass")
                self.assertTrue(ass.is_file())
                self.assertIn("PlayResX: 1920", ass.read_text(encoding="utf-8"))

    def test_reviewed_caption_segments_drive_all_subtitle_formats(self):
        data = template()
        data["narration"]["caption_segments"] = [
            {"start": 1.25, "end": 2.5, "text": "Reviewed first cue."},
            {"start": 2.75, "end": 4.0, "text": "Reviewed second cue."},
        ]
        self.assertEqual([], pipeline.validate_timeline(data))
        srt = pipeline.subtitle_text(pipeline.subtitle_segments(data), False)
        vtt = pipeline.subtitle_text(pipeline.subtitle_segments(data), True)
        ass = pipeline.ass_subtitle_text(data)
        self.assertIn("00:00:01,250 --> 00:00:02,500", srt)
        self.assertIn("00:00:02.750 --> 00:00:04.000", vtt)
        self.assertIn("Dialogue: 0,0:00:01.25,0:00:02.50", ass)
        self.assertNotIn(data["narration"]["segments"][0]["text"], srt)

    def test_reviewed_caption_segments_reject_overlap_and_more_than_two_lines(self):
        data = template()
        data["narration"]["caption_segments"] = [
            {"start": 1, "end": 3, "text": "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty"},
            {"start": 2, "end": 4, "text": "Overlapping cue."},
        ]
        errors = pipeline.validate_timeline(data)
        self.assertTrue(any("invalid or overlapping" in error for error in errors))
        self.assertTrue(any("one two-line cue" in error for error in errors))


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
        self.assertEqual({"font_size": 24, "margin_vertical": 110, "margin_left": 80, "margin_right": 80, "alignment": 1, "text_color": "#FFFFFF", "outline_color": "#292421", "outline_width": 2}, pipeline.caption_style(data))

    def test_mobile_right_editorial_defaults_are_readable_and_wrapped(self):
        data = template()
        data["layout"] = {"mode": "landscape-mobile-right"}
        editorial = pipeline.editorial_style(data)
        self.assertEqual((120, 240, 60), (editorial["title_x"], editorial["title_y"], editorial["title_font_size"]))
        self.assertEqual((120, 520, 36), (editorial["label_x"], editorial["label_y"], editorial["label_font_size"]))
        self.assertEqual("This is what\nyour clients see", pipeline.wrap_editorial_text("This is what your clients see", 16))
        self.assertEqual({"font_size": 56, "margin_vertical": 240, "margin_left": 120, "margin_right": 120, "alignment": 1, "text_color": "#FFFFFF", "outline_color": "#292421", "outline_width": 2}, pipeline.caption_style(data))

    def test_mobile_right_layout_is_landscape_only(self):
        data = template()
        data["format"].update({"width": 1080, "height": 1920, "min_duration_seconds": 20, "max_duration_seconds": 90})
        data["layout"] = {"mode": "landscape-mobile-right"}
        self.assertTrue(any("requires 1920x1080" in error for error in pipeline.validate_timeline(data)))


if __name__ == "__main__":
    unittest.main()
