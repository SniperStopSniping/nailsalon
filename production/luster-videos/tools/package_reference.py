#!/usr/bin/env python3
"""Package only allowlisted first-reference sources; never runtime credentials."""
import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]


def main():
    patterns = [
        "README.md", "QA.md", "tools/*.py", "tests/*.py",
        "demo/*.py", "demo/*.mjs", "demo/*.ts", "manifests/*.json",
        "storyboards/*", "narration-scripts/*", "timelines/*.json", "graphics/*.svg",
        "subtitles/tutorial-booking.*", "thumbnails/tutorial-booking.png",
        "assets/atelier-ai-nails.png", "recordings/tutorial-booking/*.webm",
        "narration/cache/tutorial-booking/*.wav", "narration/tutorial-booking-aligned.wav",
        "narration/ledger.json", "qa/reference-technical.json", "qa/tutorial-booking.json",
        "qa/audio-alignment.json", "qa/audio-listening-*.json",
        "qa/hero-booking.json", "qa/continuity-report.json",
        "qa/reschedule-slot-verification.json", "qa/booking-ui-verification.json",
        "qa/booking-capture-events.json", "qa/browser-playback.json", "qa/reference-tests.log",
        "qa/reference-secret-scan.log", "qa/final-frames/*.png",
        "exports/tutorial-booking.clean.mp4", "exports/tutorial-booking.captioned.mp4",
        "exports/review.html", "exports/review-thumbnail.png",
    ]
    selected = sorted({f for pattern in patterns for f in ROOT.glob(pattern) if f.is_file()})
    required = ["QA.md", "narration/tutorial-booking-aligned.wav",
                "exports/tutorial-booking.clean.mp4", "exports/tutorial-booking.captioned.mp4"]
    for name in required:
        if ROOT / name not in selected:
            raise SystemExit("Required reference artifact missing: " + name)
    inventory = []
    for f in selected:
        if f.is_symlink() or ROOT not in f.resolve().parents or f.name.startswith(".env"):
            raise SystemExit("Unsafe package path rejected")
        inventory.append({"path": f.relative_to(ROOT).as_posix(), "bytes": f.stat().st_size,
                          "sha256": hashlib.sha256(f.read_bytes()).hexdigest()})
    output = ROOT / "exports/tutorial-booking.source.zip"
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as bundle:
        for f in selected:
            bundle.write(f, "luster-videos/" + f.relative_to(ROOT).as_posix())
        bundle.writestr("luster-videos/package-inventory.json", json.dumps(inventory, indent=2) + "\n")
        bad = bundle.testzip()
        if bad:
            raise SystemExit("Archive verification failed: " + bad)
    print(json.dumps({"output": str(output.relative_to(ROOT)), "files": len(selected),
                      "bytes": output.stat().st_size, "private_runtime_included": False,
                      "paid_calls": 0}, indent=2))


if __name__ == "__main__":
    main()
