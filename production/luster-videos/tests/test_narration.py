import copy
import fcntl
import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "narration.py"
SPEC = importlib.util.spec_from_file_location("narration", MODULE_PATH)
assert SPEC and SPEC.loader
narration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(narration)


def config():
    return json.loads((ROOT / "narration-scripts/tutorial-booking.sections.json").read_text(encoding="utf-8"))


class NarrationTestCase(unittest.TestCase):
    """Keep every test away from the package's real cost/ledger/cache paths."""

    def setUp(self):
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.temporary_root = Path(self.temporary_directory.name)
        self.ledger = self.temporary_root / "narration" / "ledger.json"
        self.lock = self.temporary_root / "narration" / "ledger.lock"
        self.costs = self.temporary_root / "manifests" / "costs.json"
        self.costs.parent.mkdir(parents=True)
        self.costs.write_text(json.dumps({
            "currency": "CAD",
            "maximumAllIn": 50,
            "confirmedExternalPurchases": 0,
            "pricingChecked": "2026-09-30",
            "pricingSource": "https://developers.openai.com/api/docs/models/gpt-4o-mini-tts",
            "fundingVerified": False,
            "fxAndTaxesVerified": False,
            "paidGenerationAllowed": False,
        }), encoding="utf-8")
        self.path_patches = [
            patch.object(narration, "ROOT", self.temporary_root),
            patch.object(narration, "LEDGER_PATH", self.ledger),
            patch.object(narration, "LEDGER_LOCK_PATH", self.lock),
            patch.object(narration, "COST_MANIFEST_PATH", self.costs),
        ]
        for path_patch in self.path_patches:
            path_patch.start()

    def tearDown(self):
        for path_patch in reversed(self.path_patches):
            path_patch.stop()
        self.temporary_directory.cleanup()


class NarrationConfigTests(NarrationTestCase):
    def test_section_config_is_valid(self):
        self.assertEqual([], narration.validate_config(config()))

    def test_fingerprint_changes_for_spoken_content_or_voice_direction(self):
        original = config()
        changed = copy.deepcopy(original)
        changed["sections"][0]["text"] += " Again."
        self.assertNotEqual(
            narration.section_fingerprint(original["sections"][0], original),
            narration.section_fingerprint(changed["sections"][0], changed),
        )
        changed = copy.deepcopy(original)
        changed["instructions"] += " Pause."
        self.assertNotEqual(
            narration.section_fingerprint(original["sections"][0], original),
            narration.section_fingerprint(changed["sections"][0], changed),
        )

    def test_estimate_cannot_exceed_conservative_reservation(self):
        invalid = config()
        invalid["sections"][0]["estimated_cad_cents"] = 101
        self.assertTrue(any("estimated_cad_cents" in error for error in narration.validate_config(invalid)))

    def test_rejects_configurable_ledger_headroom_and_unbounded_text(self):
        invalid = config()
        invalid["ledger"] = "narration/another-ledger.json"
        invalid["retry_headroom_cad_cents"] = 1
        invalid["instructions"] = "x" * (narration.INSTRUCTIONS_MAX_CHARS + 1)
        invalid["sections"][0]["text"] = "x" * (narration.SECTION_MAX_CHARS + 1)
        invalid["sections"][0]["reservation_cad_cents"] = 1
        errors = narration.validate_config(invalid)
        self.assertTrue(any("ledger" in error for error in errors))
        self.assertTrue(any("headroom" in error for error in errors))
        self.assertTrue(any("instructions" in error for error in errors))
        self.assertTrue(any("at most" in error for error in errors))
        self.assertTrue(any("fixed CAD1" in error for error in errors))


class NarrationSafetyTests(NarrationTestCase):
    def test_dry_run_does_not_load_environment_or_call_network(self):
        with patch.object(narration, "load_private_environment") as load_env, patch.object(narration, "request_speech") as request:
            result = narration.produce(config(), generate=False)
        self.assertEqual("dry-run", result["mode"])
        self.assertIn("no API call", result["message"])
        load_env.assert_not_called()
        request.assert_not_called()

    def test_generation_requires_funded_flag_before_network(self):
        environment = {key: value for key, value in os.environ.items() if key not in ("OPENAI_API_KEY", "VIDEO_NARRATION_FUNDED")}
        with patch.dict(os.environ, environment, clear=True), patch.object(narration, "load_private_environment"), patch.object(narration, "load_generation_cost_manifest", return_value={"external_cad_cents": 0}), patch.object(narration, "request_speech") as request:
            with self.assertRaisesRegex(narration.NarrationError, "VIDEO_NARRATION_FUNDED"):
                narration.produce(config(), generate=True)
        request.assert_not_called()

    def test_unapproved_cost_manifest_blocks_paid_generation_before_network(self):
        environment = {**os.environ, "VIDEO_NARRATION_FUNDED": "true", "OPENAI_API_KEY": "not-a-real-key"}
        with patch.dict(os.environ, environment, clear=True), patch.object(narration, "load_private_environment"), patch.object(narration, "request_speech") as request:
            with self.assertRaisesRegex(narration.NarrationError, "paidGenerationAllowed"):
                narration.produce(config(), generate=True)
        request.assert_not_called()

    def test_reservation_keeps_retry_headroom_under_cad_cap(self):
        configured = config()
        ledger = {"schema_version": 1, "entries": [{"status": "generated-actual-pending", "reserved_cad_cents": 4_000}]}
        with self.assertRaisesRegex(narration.NarrationError, "cap"):
            narration.reserve(ledger, narration.planned_sections(configured), configured)
        self.assertEqual(1, len(ledger["entries"]))

    def test_failed_request_remains_reserved_without_automatic_retry(self):
        ledger = {"schema_version": 1, "entries": []}
        sections = narration.planned_sections(config())
        narration.reserve(ledger, sections, config())
        self.assertEqual(len(sections), len(ledger["entries"]))
        self.assertEqual(sum(section["reservation_cad_cents"] for section in sections), narration.active_reserved_cents(ledger))
        with self.assertRaisesRegex(narration.NarrationError, "prior reservation"):
            narration.reserve(ledger, sections, config())

    def test_counts_reconciled_actual_and_unknown_spend_conservatively(self):
        ledger = {
            "schema_version": 1,
            "entries": [
                {"status": "reconciled-actual-spend", "reserved_cad_cents": 100, "actual_cad_cents": 250},
                {"status": "attempted-unknown", "reserved_cad_cents": 100, "actual_cad_cents": None},
                {"status": "generated-actual-pending", "reserved_cad_cents": 100, "actual_cad_cents": 10},
            ],
        }
        self.assertEqual(450, narration.committed_ledger_cents(ledger))

    def test_unknown_ledger_status_refuses_spend_calculation(self):
        ledger = {"schema_version": 1, "entries": [{"status": "free", "reserved_cad_cents": 0, "actual_cad_cents": None}]}
        with self.assertRaisesRegex(narration.NarrationError, "unknown status"):
            narration.committed_ledger_cents(ledger)

    def test_planned_sections_deduplicate_identical_fingerprints(self):
        configured = config()
        copied = copy.deepcopy(configured["sections"][0])
        copied["id"] = "same-text-other-id"
        configured["sections"].append(copied)
        sections = narration.planned_sections(configured)
        self.assertEqual(len(configured["sections"]) - 1, len(sections))

    def test_nonblocking_lock_refuses_contention(self):
        self.lock.parent.mkdir(parents=True, exist_ok=True)
        with self.lock.open("a+", encoding="utf-8") as holder:
            fcntl.flock(holder.fileno(), fcntl.LOCK_EX)
            try:
                with self.assertRaisesRegex(narration.NarrationError, "already running"):
                    with narration.exclusive_ledger_lock():
                        self.fail("The contested lock must not be acquired.")
            finally:
                fcntl.flock(holder.fileno(), fcntl.LOCK_UN)


if __name__ == "__main__":
    unittest.main()
