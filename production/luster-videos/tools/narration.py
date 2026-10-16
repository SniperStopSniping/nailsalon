#!/usr/bin/env python3
"""Guarded OpenAI TTS producer for approved, short narration sections.

Dry-run is the default. ``--generate`` makes one request per uncached section
only after a CAD reservation is committed to a local ledger. It never retries
automatically, never prints credentials, and never treats estimates as invoices.
"""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import tempfile
import urllib.error
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parents[1]
CAP_CAD_CENTS = 5_000
API_URL = "https://api.openai.com/v1/audio/speech"
LEDGER_PATH = ROOT / "narration" / "ledger.json"
LEDGER_LOCK_PATH = ROOT / "narration" / "ledger.lock"
COST_MANIFEST_PATH = ROOT / "manifests" / "costs.json"
SECTION_MAX_CHARS = 500
SECTION_RESERVATION_CAD_CENTS = 100
RETRY_HEADROOM_CAD_CENTS = 500
INSTRUCTIONS_MAX_CHARS = 1_000
PRICING_MAX_AGE_DAYS = 7
KNOWN_LEDGER_STATUSES = frozenset({
    "reserved",
    "attempted-unknown",
    "generated-actual-pending",
    "reconciled-actual-spend",
})


class NarrationError(RuntimeError):
    pass


def resolve_relative(value: str) -> Path:
    path = Path(value)
    if path.is_absolute() or ".." in path.parts:
        raise NarrationError("Narration paths must be relative and cannot escape production/luster-videos.")
    return ROOT / path


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise NarrationError("Section configuration does not exist: %s" % path) from error
    except json.JSONDecodeError as error:
        raise NarrationError("Section configuration is not valid JSON: %s" % error) from error
    if not isinstance(data, dict):
        raise NarrationError("Section configuration root must be an object.")
    return data


def require_string(data: dict[str, Any], key: str) -> str:
    value = data.get(key)
    if not isinstance(value, str) or not value.strip():
        raise NarrationError("Expected non-empty string for %s." % key)
    return value


def section_fingerprint(section: dict[str, Any], config: dict[str, Any]) -> str:
    payload = {
        "text": section["text"],
        "model": config["model"],
        "voice": config["voice"],
        "instructions": config["instructions"],
        "response_format": "wav",
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def validate_config(config: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    try:
        if config.get("schema_version") != 1:
            errors.append("schema_version must be 1.")
        if config.get("model") != "gpt-4o-mini-tts":
            errors.append("model must be gpt-4o-mini-tts.")
        if config.get("voice") != "marin":
            errors.append("voice must be marin.")
        instructions = require_string(config, "instructions")
        if len(instructions) > INSTRUCTIONS_MAX_CHARS:
            errors.append("instructions must be at most %s characters." % INSTRUCTIONS_MAX_CHARS)
        cache_dir = require_string(config, "cache_dir")
        resolve_relative(cache_dir)
        if config.get("ledger") != "narration/ledger.json":
            errors.append("ledger must be the fixed narration/ledger.json path.")
        if config.get("retry_headroom_cad_cents") != RETRY_HEADROOM_CAD_CENTS:
            errors.append("retry_headroom_cad_cents must be the fixed CAD5 minimum (%s cents)." % RETRY_HEADROOM_CAD_CENTS)
        sections = config.get("sections")
        if not isinstance(sections, list) or not sections:
            errors.append("sections must contain at least one short narration section.")
        else:
            ids: set[str] = set()
            for index, section in enumerate(sections, start=1):
                if not isinstance(section, dict):
                    errors.append("Section %s must be an object." % index)
                    continue
                try:
                    section_id = require_string(section, "id")
                    if section_id in ids:
                        errors.append("Section ids must be unique.")
                    ids.add(section_id)
                    text = require_string(section, "text")
                    if len(text) > SECTION_MAX_CHARS:
                        errors.append("Section %s text must be at most %s characters." % (index, SECTION_MAX_CHARS))
                except NarrationError as error:
                    errors.append("Section %s: %s" % (index, error))
                estimate, reservation = section.get("estimated_cad_cents"), section.get("reservation_cad_cents")
                if not isinstance(estimate, int) or isinstance(estimate, bool) or estimate < 0 or estimate > SECTION_RESERVATION_CAD_CENTS:
                    errors.append("Section %s must have an estimated_cad_cents from 0 through %s." % (index, SECTION_RESERVATION_CAD_CENTS))
                if reservation != SECTION_RESERVATION_CAD_CENTS:
                    errors.append("Section %s must reserve the fixed CAD1 amount (%s cents)." % (index, SECTION_RESERVATION_CAD_CENTS))
    except NarrationError as error:
        errors.append(str(error))
    return errors


def load_private_environment() -> None:
    """Load only the project's ignored video env file, never displaying it."""
    env_file = REPO_ROOT / ".env.video.local"
    if not env_file.is_file():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        if key in ("OPENAI_API_KEY", "VIDEO_NARRATION_FUNDED") and key not in os.environ:
            os.environ[key] = value.strip().strip('"').strip("'")


def ledger_path(config: dict[str, Any]) -> Path:
    # The ledger is deliberately not configurable: otherwise a changed config
    # could start a new ledger and evade the package-wide CAD cap.
    del config
    return LEDGER_PATH


def load_ledger(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"schema_version": 1, "entries": []}
    try:
        ledger = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise NarrationError("Narration ledger is not valid JSON; refusing to make a request.") from error
    if not isinstance(ledger, dict) or ledger.get("schema_version") != 1 or not isinstance(ledger.get("entries"), list):
        raise NarrationError("Narration ledger has an unsupported format; refusing to make a request.")
    for index, entry in enumerate(ledger["entries"], start=1):
        if not isinstance(entry, dict):
            raise NarrationError("Narration ledger entry %s is invalid; refusing to make a request." % index)
        status = entry.get("status")
        if status not in KNOWN_LEDGER_STATUSES:
            raise NarrationError("Narration ledger entry %s has unknown status; refusing to make a request." % index)
        reserved = entry.get("reserved_cad_cents")
        actual = entry.get("actual_cad_cents")
        if not isinstance(reserved, int) or isinstance(reserved, bool) or reserved < 0 or (actual is not None and (not isinstance(actual, int) or isinstance(actual, bool) or actual < 0)):
            raise NarrationError("Narration ledger entry %s has invalid spend; refusing to make a request." % index)
    return ledger


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=str(path.parent), delete=False) as file:
        json.dump(value, file, indent=2)
        file.write("\n")
        temporary = Path(file.name)
    temporary.replace(path)


def committed_ledger_cents(ledger: dict[str, Any]) -> int:
    """Use the higher known amount for every recorded paid attempt.

    A reservation remains a conservative cost until a reconciled invoice is
    higher. No status becomes free budget merely because generation completed.
    """
    total = 0
    for entry in ledger["entries"]:
        # load_ledger validates this before any generation path calls us; keep
        # the helper strict for direct unit-test use as well.
        status = entry.get("status")
        if status not in KNOWN_LEDGER_STATUSES:
            raise NarrationError("Narration ledger has unknown status; refusing to calculate spend.")
        reserved = entry.get("reserved_cad_cents")
        actual = entry.get("actual_cad_cents")
        if not isinstance(reserved, int) or isinstance(reserved, bool) or reserved < 0 or (actual is not None and (not isinstance(actual, int) or isinstance(actual, bool) or actual < 0)):
            raise NarrationError("Narration ledger has invalid spend; refusing to calculate spend.")
        total += max(reserved, actual or 0)
    return total


def active_reserved_cents(ledger: dict[str, Any]) -> int:
    """Compatibility name retained for callers; it now means all committed spend."""
    return committed_ledger_cents(ledger)


def cad_dollars_to_cents(value: Any, field: str) -> int:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or value < 0:
        raise NarrationError("Cost manifest %s must be a non-negative CAD amount." % field)
    cents = round(float(value) * 100)
    if abs(float(value) * 100 - cents) > 0.000001:
        raise NarrationError("Cost manifest %s must use whole CAD cents." % field)
    return cents


def load_generation_cost_manifest(today: date | None = None) -> dict[str, Any]:
    """Load the fixed package ledger inputs required before a paid request."""
    try:
        manifest = json.loads(COST_MANIFEST_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise NarrationError("Cost manifest is missing; refusing paid generation.") from error
    except json.JSONDecodeError as error:
        raise NarrationError("Cost manifest is not valid JSON; refusing paid generation.") from error
    if not isinstance(manifest, dict) or manifest.get("currency") != "CAD":
        raise NarrationError("Cost manifest must be a CAD object; refusing paid generation.")
    if manifest.get("paidGenerationAllowed") is not True:
        raise NarrationError("Cost manifest has not approved paidGenerationAllowed; refusing paid generation.")
    if manifest.get("fundingVerified") is not True:
        raise NarrationError("Cost manifest has not verified funding; refusing paid generation.")
    if manifest.get("fxAndTaxesVerified") is not True:
        raise NarrationError("Cost manifest has not verified FX and taxes; refusing paid generation.")
    source = manifest.get("pricingSource")
    if not isinstance(source, str) or not source.startswith("https://developers.openai.com/"):
        raise NarrationError("Cost manifest must cite current official OpenAI pricing; refusing paid generation.")
    checked = manifest.get("pricingChecked")
    if not isinstance(checked, str):
        raise NarrationError("Cost manifest pricingChecked is required; refusing paid generation.")
    try:
        checked_date = date.fromisoformat(checked)
    except ValueError as error:
        raise NarrationError("Cost manifest pricingChecked is invalid; refusing paid generation.") from error
    current_date = today or datetime.now(timezone.utc).date()
    age = (current_date - checked_date).days
    if age < 0 or age > PRICING_MAX_AGE_DAYS:
        raise NarrationError("Official pricing check must be no more than %s days old; refusing paid generation." % PRICING_MAX_AGE_DAYS)
    maximum = cad_dollars_to_cents(manifest.get("maximumAllIn"), "maximumAllIn")
    if maximum != CAP_CAD_CENTS:
        raise NarrationError("Cost manifest maximumAllIn must match the fixed CAD50 cap; refusing paid generation.")
    return {
        "external_cad_cents": cad_dollars_to_cents(manifest.get("confirmedExternalPurchases", 0), "confirmedExternalPurchases"),
        "manifest": manifest,
    }


@contextlib.contextmanager
def exclusive_ledger_lock():
    """Fail rather than race another producer across ledger, requests, and cache writes."""
    LEDGER_LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    with LEDGER_LOCK_PATH.open("a+", encoding="utf-8") as lock_file:
        try:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise NarrationError("Narration generation is already running; no request was made.") from error
        try:
            yield
        finally:
            fcntl.flock(lock_file.fileno(), fcntl.LOCK_UN)


def planned_sections(config: dict[str, Any]) -> list[dict[str, Any]]:
    cache_dir = resolve_relative(config["cache_dir"])
    result: list[dict[str, Any]] = []
    seen_fingerprints: set[str] = set()
    for section in config["sections"]:
        fingerprint = section_fingerprint(section, config)
        # A repeated section may have a different editing ID but produces the
        # same paid request. Keep one cache/request unit for its fingerprint.
        if fingerprint in seen_fingerprints:
            continue
        seen_fingerprints.add(fingerprint)
        output = cache_dir / (fingerprint + ".wav")
        result.append({**section, "cache_key": fingerprint, "output": output, "cached": output.is_file()})
    return result


def enforce_generation_prerequisites() -> str:
    load_private_environment()
    if os.environ.get("VIDEO_NARRATION_FUNDED") != "true":
        raise NarrationError("Generation requires VIDEO_NARRATION_FUNDED=true in the private video environment.")
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise NarrationError("Generation requires OPENAI_API_KEY in the private video environment.")
    return key


def reserve(ledger: dict[str, Any], sections: list[dict[str, Any]], config: dict[str, Any], external_cad_cents: int = 0) -> None:
    del config
    active_keys = {entry.get("cache_key") for entry in ledger["entries"]}
    if any(not section["cached"] and section["cache_key"] in active_keys for section in sections):
        raise NarrationError("A prior reservation exists for an uncached section; reconcile its actual cost before another explicit request.")
    if not isinstance(external_cad_cents, int) or external_cad_cents < 0:
        raise NarrationError("External package spend is invalid; refusing to reserve.")
    new_reservation = sum(SECTION_RESERVATION_CAD_CENTS for section in sections if not section["cached"])
    if committed_ledger_cents(ledger) + external_cad_cents + new_reservation + RETRY_HEADROOM_CAD_CENTS > CAP_CAD_CENTS:
        raise NarrationError("CAD reservation cap would be exceeded; no request was made.")
    created_at = datetime.now(timezone.utc).isoformat()
    for section in sections:
        if section["cached"]:
            continue
        ledger["entries"].append({
            "cache_key": section["cache_key"],
            "section_id": section["id"],
            "status": "reserved",
            "reserved_cad_cents": SECTION_RESERVATION_CAD_CENTS,
            "estimated_cad_cents": section["estimated_cad_cents"],
            "actual_cad_cents": None,
            "created_at": created_at,
            "note": "Reserved before one explicit request. Actual invoice amount is not known to this tool."
        })


def request_speech(key: str, config: dict[str, Any], text: str) -> bytes:
    payload = json.dumps({"model": config["model"], "voice": config["voice"], "input": text, "instructions": config["instructions"], "response_format": "wav"}).encode("utf-8")
    request = urllib.request.Request(API_URL, data=payload, method="POST", headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read()
    except urllib.error.HTTPError as error:
        raise NarrationError("Speech request returned HTTP %s; no retry was attempted." % error.code) from error
    except urllib.error.URLError as error:
        raise NarrationError("Speech request could not be completed; no retry was attempted.") from error
    if not body.startswith(b"RIFF"):
        raise NarrationError("Speech request did not return WAV audio; no retry was attempted.")
    return body


def write_audio(path: Path, audio: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("wb", dir=str(path.parent), delete=False) as file:
        file.write(audio)
        temporary = Path(file.name)
    temporary.replace(path)


def produce(config: dict[str, Any], generate: bool) -> dict[str, Any]:
    errors = validate_config(config)
    if errors:
        raise NarrationError("Invalid section configuration: " + "; ".join(errors))
    sections = planned_sections(config)
    plan = {
        "mode": "generate" if generate else "dry-run",
        "model": config["model"],
        "voice": config["voice"],
        "sections": [{"id": section["id"], "cache_key": section["cache_key"], "cached": section["cached"], "reserved_cad_cents": section["reservation_cad_cents"], "estimated_cad_cents": section["estimated_cad_cents"]} for section in sections],
        "new_reservation_cad_cents": sum(section["reservation_cad_cents"] for section in sections if not section["cached"]),
        "actual_cad_cents": None,
    }
    if not generate:
        plan["message"] = "Dry-run only: no API call, ledger write, or audio file was created."
        return plan
    cost_manifest = load_generation_cost_manifest()
    key = enforce_generation_prerequisites()
    ledger_file = ledger_path(config)
    # Keep the lock for every mutable or paid step. Releasing it after the
    # reservation would let a second producer race the same cache/ledger.
    with exclusive_ledger_lock():
        # The earlier plan is informational. The decision to spend always
        # rechecks the cache after acquiring the cross-process lock.
        sections = planned_sections(config)
        ledger = load_ledger(ledger_file)
        reserve(ledger, sections, config, cost_manifest["external_cad_cents"])
        atomic_json(ledger_file, ledger)
        for section in sections:
            if section["cached"]:
                continue
            entry = next(entry for entry in ledger["entries"] if entry["cache_key"] == section["cache_key"])
            try:
                audio = request_speech(key, config, section["text"])
            except NarrationError:
                entry["status"] = "attempted-unknown"
                atomic_json(ledger_file, ledger)
                raise
            write_audio(section["output"], audio)
            entry["status"] = "generated-actual-pending"
            entry["output"] = str(section["output"].relative_to(ROOT))
            atomic_json(ledger_file, ledger)
    plan["sections"] = [{"id": section["id"], "cache_key": section["cache_key"], "cached": section["cached"], "reserved_cad_cents": section["reservation_cad_cents"], "estimated_cad_cents": section["estimated_cad_cents"]} for section in sections]
    plan["new_reservation_cad_cents"] = sum(section["reservation_cad_cents"] for section in sections if not section["cached"])
    plan["message"] = "Generated cached WAV sections. Reserved and estimated amounts are not invoices; actual CAD remains pending."
    return plan


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sections", required=True, help="Relative JSON configuration for short narration sections.")
    parser.add_argument("--generate", action="store_true", help="Explicitly allow one request per uncached section after funding and budget checks.")
    args = parser.parse_args(argv)
    try:
        config = load_json(resolve_relative(args.sections))
        print(json.dumps(produce(config, args.generate), indent=2))
        return 0
    except NarrationError as error:
        print("narration: %s" % error, file=os.sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
