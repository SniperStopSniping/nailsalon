import copy
import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Optional
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / "tools"
sys.path.insert(0, str(TOOLS))


def load_tool(name: str):
    spec = importlib.util.spec_from_file_location(name, TOOLS / (name + ".py"))
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


align = load_tool("align_narration")
review_audio = load_tool("review_audio")


def probe_duration(seconds: float) -> bytes:
    return json.dumps({"format": {"duration": str(seconds)}}).encode()


class AlignNarrationTests(unittest.TestCase):
    def test_local_rejects_absolute_and_traversal_paths(self):
        with self.assertRaisesRegex(ValueError, "within the production directory"):
            align.local("../narration/ledger.json")
        with self.assertRaisesRegex(ValueError, "within the production directory"):
            align.local("/tmp/narration.wav")

    def test_current_config_uses_revised_fingerprint_and_reconciled_cache(self):
        spoken = json.loads((ROOT / "narration-scripts/tutorial-booking.sections.json").read_text(encoding="utf-8"))
        audio_config = json.loads((ROOT / "timelines/tutorial-booking.audio.json").read_text(encoding="utf-8"))
        timeline = json.loads((ROOT / "timelines/tutorial-booking.json").read_text(encoding="utf-8"))
        revised = next(section for section in spoken["sections"] if section["id"] == "extras")
        old_spoken = copy.deepcopy(revised)
        old_spoken["text"] = old_spoken["text"].replace("B. I. A. B.", "BIAB")
        self.assertNotEqual(
            align.narration.section_fingerprint(revised, spoken),
            align.narration.section_fingerprint(old_spoken, spoken),
        )

        with tempfile.TemporaryDirectory() as temp:
            temp_root = Path(temp)
            (temp_root / "narration-scripts").mkdir()
            (temp_root / "timelines").mkdir()
            (temp_root / "narration/cache/tutorial-booking").mkdir(parents=True)
            (temp_root / "narration").mkdir(exist_ok=True)
            (temp_root / "narration-scripts/tutorial-booking.sections.json").write_text(json.dumps(spoken), encoding="utf-8")
            (temp_root / "timelines/tutorial-booking.audio.json").write_text(json.dumps(audio_config), encoding="utf-8")
            (temp_root / "timelines/tutorial-booking.json").write_text(json.dumps(timeline), encoding="utf-8")
            entries = []
            for section in spoken["sections"]:
                fingerprint = align.narration.section_fingerprint(section, spoken)
                output = "narration/cache/tutorial-booking/%s.wav" % fingerprint
                (temp_root / output).write_bytes(section["id"].encode())
                entries.append({
                    "cache_key": fingerprint,
                    "section_id": section["id"],
                    "status": "reconciled-actual-spend",
                    "reserved_cad_cents": 100,
                    "actual_cad_cents": 5,
                    "output": output,
                })
            entries.insert(0, {
                "cache_key": align.narration.section_fingerprint(old_spoken, spoken),
                "section_id": "extras",
                "status": "reconciled-actual-spend",
                "reserved_cad_cents": 100,
                "actual_cad_cents": 5,
                "output": "narration/cache/tutorial-booking/stale-extras.wav",
            })
            (temp_root / "narration/ledger.json").write_text(json.dumps({"schema_version": 1, "entries": entries}), encoding="utf-8")

            def fake_invoke(command):
                if "-f" in command and "null" in command:
                    return '{"input_i":"-18.0","input_tp":"-1.0","input_lra":"2.0","input_thresh":"-28.0","target_offset":"0.0"}'
                return ""

            with patch.object(align, "ROOT", temp_root), patch.dict(os.environ, {"VIDEO_FFMPEG": "test-ffmpeg", "VIDEO_FFPROBE": "configured-ffprobe"}, clear=True), patch.object(align, "invoke", side_effect=fake_invoke), patch.object(align.subprocess, "check_output", side_effect=lambda command: probe_duration(1.0)) as probe:
                result = align.build("timelines/tutorial-booking.audio.json")

            extras = next(section for section in result["sections"] if section["id"] == "extras")
            self.assertEqual("reconciled-actual-spend", entries[3]["status"])
            self.assertEqual(entries[3]["output"], extras["source"])
            self.assertTrue(all(call.args[0][0] == "configured-ffprobe" for call in probe.call_args_list))
            self.assertEqual(0, result["paid_calls"])


class ReviewAudioTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / "narration").mkdir()
        (self.root / "qa").mkdir()
        self.audio = self.root / "narration/tutorial-booking-aligned.wav"
        self.audio.write_bytes(b"RIFF" + b"x" * 32)

    def tearDown(self):
        self.temp.cleanup()

    def review_with_root(self, generate: bool, duration: float, env: Optional[dict[str, str]] = None):
        with patch.object(review_audio.narration, "ROOT", self.root), patch.dict(os.environ, env or {"VIDEO_FFPROBE": "configured-ffprobe"}, clear=True), patch.object(review_audio.subprocess, "check_output", return_value=probe_duration(duration)) as probe:
            result = review_audio.review(generate)
        return result, probe

    def test_default_and_cached_review_never_load_credentials_or_call_api(self):
        with patch.object(review_audio.narration, "enforce_generation_prerequisites") as prerequisites, patch.object(review_audio.urllib.request, "urlopen") as urlopen:
            result, probe = self.review_with_root(False, 10)
        self.assertEqual("offline-plan", result["mode"])
        self.assertEqual("configured-ffprobe", probe.call_args.args[0][0])
        prerequisites.assert_not_called()
        urlopen.assert_not_called()

        fingerprint = hashlib.sha256(self.audio.read_bytes() + review_audio.MODEL.encode() + review_audio.PROMPT.encode()).hexdigest()
        cached = self.root / "qa" / ("audio-listening-" + fingerprint[:16] + ".json")
        cached.write_text(json.dumps({"cached": True}), encoding="utf-8")
        with patch.object(review_audio.narration, "enforce_generation_prerequisites") as prerequisites, patch.object(review_audio.narration, "load_generation_cost_manifest") as costs, patch.object(review_audio.urllib.request, "urlopen") as urlopen:
            result, _ = self.review_with_root(True, 10)
        self.assertEqual({"cached": True}, result)
        prerequisites.assert_not_called()
        costs.assert_not_called()
        urlopen.assert_not_called()

    def test_invalid_duration_and_pricing_refuse_paid_calls(self):
        with patch.object(review_audio.narration, "enforce_generation_prerequisites") as prerequisites, patch.object(review_audio.urllib.request, "urlopen") as urlopen:
            with self.assertRaisesRegex(review_audio.narration.NarrationError, "75 seconds"):
                self.review_with_root(True, 75.01)
        prerequisites.assert_not_called()
        urlopen.assert_not_called()

        invalid_costs = {"external_cad_cents": 0, "manifest": {"audioReviewPricingChecked": "2000-01-01", "audioReviewPricingSource": "https://developers.openai.com/api/docs/models/gpt-audio"}}
        with patch.object(review_audio.narration, "load_generation_cost_manifest", return_value=invalid_costs), patch.object(review_audio.narration, "enforce_generation_prerequisites") as prerequisites, patch.object(review_audio.urllib.request, "urlopen") as urlopen:
            with self.assertRaisesRegex(review_audio.narration.NarrationError, "official pricing"):
                self.review_with_root(True, 10)
        prerequisites.assert_not_called()
        urlopen.assert_not_called()


if __name__ == "__main__":
    unittest.main()
