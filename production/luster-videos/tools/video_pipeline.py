#!/usr/bin/env python3
"""Fail-closed, offline FFmpeg assembly for approved Luster recordings.

Timelines are editable JSON. Every scene names its source, source range, fit,
and zoom, so an edit can be rebuilt without hidden editor state. This program
does not make network or paid narration calls; ``tts-plan`` is dry-run only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parents[1]
MAX_DURATION_SECONDS = 90
SUPPORTED_FORMATS = {(1920, 1080), (1080, 1920)}
REQUIRED_OUTPUTS = ("clean", "captioned", "thumbnail", "srt", "vtt", "qa")
ANNOTATION_GRAPHICS = ROOT / "graphics"
POINTER_HOTSPOT = (12, 4)


class PipelineError(RuntimeError):
    pass


def resolve_relative(value: str) -> Path:
    path = Path(value)
    if path.is_absolute() or ".." in path.parts:
        raise PipelineError("Timeline paths must be relative and cannot escape production/luster-videos.")
    return ROOT / path


def load_timeline(value: str) -> dict[str, Any]:
    timeline_path = Path(value)
    if not timeline_path.is_absolute():
        timeline_path = ROOT / timeline_path
    try:
        data = json.loads(timeline_path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise PipelineError("Timeline file does not exist: %s" % timeline_path) from error
    except json.JSONDecodeError as error:
        raise PipelineError("Timeline is not valid JSON: %s" % error) from error
    if not isinstance(data, dict):
        raise PipelineError("Timeline root must be an object.")
    return data


def require_string(container: dict[str, Any], key: str) -> str:
    value = container.get(key)
    if not isinstance(value, str) or not value.strip():
        raise PipelineError("Expected non-empty string for %s." % key)
    return value


def scene_duration(scene: dict[str, Any]) -> float:
    return float(scene["source_end"]) - float(scene["source_start"])


def planned_duration(data: dict[str, Any]) -> float:
    return sum(scene_duration(scene) for scene in data["scenes"])


def cursor_style(data: dict[str, Any]) -> dict[str, float]:
    style = data.get("cursor_style", {})
    return {
        "hand_size": float(style.get("hand_size", 52)), "ring_small_size": float(style.get("ring_small_size", 54)), "ring_large_size": float(style.get("ring_large_size", 82)),
        "hotspot_x": float(style.get("hotspot_x", POINTER_HOTSPOT[0])), "hotspot_y": float(style.get("hotspot_y", POINTER_HOTSPOT[1])),
        "approach_seconds": float(style.get("approach_seconds", 0.28)), "press_seconds": float(style.get("press_seconds", 0.08)), "post_click_seconds": float(style.get("post_click_seconds", 0.18)),
        "approach_dx": float(style.get("approach_dx", 18)), "approach_dy": float(style.get("approach_dy", 22)),
    }


def scene_edit_start(data: dict[str, Any], scene_index: int) -> float:
    return sum(scene_duration(scene) for scene in data["scenes"][:scene_index])


def visible_source_rect(scene: dict[str, Any]) -> tuple[float, float, float, float]:
    crop = scene.get("framing", {}).get("source_crop")
    if not crop:
        raise PipelineError("Click annotations require framing.source_crop so raw capture coordinates can be mapped safely.")
    return float(crop["x"]), float(crop["y"]), float(crop["width"]), float(crop["height"])


def map_raw_click(scene: dict[str, Any], data: dict[str, Any], raw_x: float, raw_y: float) -> tuple[float, float]:
    """Map a raw source-pixel click point through crop, framing, zoom, and pad."""
    crop_x, crop_y, crop_width, crop_height = visible_source_rect(scene)
    if not crop_x <= raw_x < crop_x + crop_width or not crop_y <= raw_y < crop_y + crop_height:
        raise PipelineError("Click point must be inside the visible source_crop.")
    x, y = raw_x - crop_x, raw_y - crop_y
    width, height = data["format"]["width"], data["format"]["height"]
    framing = scene.get("framing", {})
    zoom = float(framing.get("zoom", 1.0))
    layout = data.get("layout", {"mode": "legacy"})
    if layout.get("mode") == "landscape-mobile-right":
        app_x, app_y, app_height = framing.get("app_x", layout.get("app_x", 1200)), layout.get("app_y", 90), layout.get("app_height", 920)
        scaled_height = int(round(app_height * zoom / 2) * 2)
        scale = scaled_height / crop_height
        scaled_width = int(round(crop_width * scale / 2) * 2)
        visible_width = int(scaled_width / zoom / 2) * 2
        return app_x + x * scale - (scaled_width - visible_width) / 2, app_y + y * scale - (scaled_height - app_height) / 2
    fit = framing.get("fit", "contain")
    if fit == "contain":
        margin = 64 if width >= height else 48
        top = 110 if width >= height else 150
        bottom = 200 if width >= height else 300
        inner_width, inner_height = width - margin * 2, height - top - bottom
        scale = min(inner_width / crop_width, inner_height / crop_height)
        scaled_width, scaled_height = crop_width * scale, crop_height * scale
        mapped_x, mapped_y = (width - scaled_width) / 2 + x * scale, (height - scaled_height) / 2 + y * scale
    elif fit == "cover":
        scale = max(width / crop_width, height / crop_height)
        scaled_width, scaled_height = crop_width * scale, crop_height * scale
        mapped_x, mapped_y = x * scale - (scaled_width - width) / 2, y * scale - (scaled_height - height) / 2
    else:
        raise PipelineError("Click annotations do not support this framing mode.")
    if zoom > 1:
        mapped_x = mapped_x * zoom - (width * zoom - width) / 2
        mapped_y = mapped_y * zoom - (height * zoom - height) / 2
    return mapped_x, mapped_y


def click_plan(data: dict[str, Any]) -> list[dict[str, Any]]:
    plan: list[dict[str, Any]] = []
    for scene_index, scene in enumerate(data["scenes"]):
        for click in scene.get("clicks", []):
            edit_time = scene_edit_start(data, scene_index) + float(click["source_time"]) - float(scene["source_start"])
            mapped_x, mapped_y = map_raw_click(scene, data, float(click["x"]), float(click["y"]))
            plan.append({"scene_index": scene_index, "edit_time": edit_time, "x": mapped_x, "y": mapped_y, "label": click["label"], "evidence": click["evidence"]})
    return plan


def validate_timeline(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    try:
        if data.get("schema_version") != 2:
            raise PipelineError("schema_version must be 2.")
        require_string(data, "id")
        require_string(data, "title")
        if data.get("status") == "final":
            errors.append("Timeline status cannot be final until user approval is recorded.")
        format_data = data.get("format")
        if not isinstance(format_data, dict):
            raise PipelineError("format must be an object.")
        dimensions = (format_data.get("width"), format_data.get("height"))
        if dimensions not in SUPPORTED_FORMATS or format_data.get("fps") != 30:
            errors.append("format must be 1920x1080 or 1080x1920 at 30 fps.")
        layout = data.get("layout", {"mode": "legacy"})
        if not isinstance(layout, dict) or layout.get("mode", "legacy") not in ("legacy", "landscape-mobile-right"):
            errors.append("layout.mode must be legacy or landscape-mobile-right.")
        elif layout.get("mode") == "landscape-mobile-right":
            if dimensions != (1920, 1080):
                errors.append("landscape-mobile-right layout requires 1920x1080 output.")
            for key in ("app_x", "app_y", "app_height"):
                if key in layout and (not isinstance(layout[key], int) or layout[key] < 0):
                    errors.append("layout.%s must be a non-negative integer." % key)
            for key in ("title_x", "title_y", "label_x", "label_y", "disclosure_x", "disclosure_y", "watermark_x", "watermark_y"):
                if key in layout and (not isinstance(layout[key], int) or layout[key] < 0):
                    errors.append("layout.%s must be a non-negative integer." % key)
            for key in ("title_font_size", "label_font_size", "disclosure_font_size", "watermark_font_size", "title_wrap_chars", "label_wrap_chars"):
                if key in layout and (not isinstance(layout[key], int) or layout[key] <= 0):
                    errors.append("layout.%s must be a positive integer." % key)
            if "title_text" in layout and (not isinstance(layout["title_text"], str) or not layout["title_text"].strip() or len(layout["title_text"]) > 120):
                errors.append("layout.title_text must be a non-empty string of at most 120 characters.")
        caption_style = data.get("caption_style", {})
        if not isinstance(caption_style, dict):
            errors.append("caption_style must be an object when present.")
        else:
            for key, lower, upper in (("font_size", 24, 120), ("margin_vertical", 40, 400), ("margin_left", 0, 600), ("margin_right", 0, 1_200)):
                if key in caption_style and (not isinstance(caption_style[key], int) or not lower <= caption_style[key] <= upper):
                    errors.append("caption_style.%s must be an integer between %s and %s." % (key, lower, upper))
            for key in ("text_color", "outline_color"):
                if key in caption_style and (not isinstance(caption_style[key], str) or not re.fullmatch(r"#[0-9A-Fa-f]{6}", caption_style[key])):
                    errors.append("caption_style.%s must be a six-digit #RRGGBB hex color." % key)
            if "outline_width" in caption_style and (not isinstance(caption_style["outline_width"], int) or not 0 <= caption_style["outline_width"] <= 4):
                errors.append("caption_style.outline_width must be an integer between 0 and 4.")
            if "alignment" in caption_style and caption_style["alignment"] not in (1, 2, 3):
                errors.append("caption_style.alignment must be 1, 2, or 3.")
        raw_cursor_style = data.get("cursor_style", {})
        if not isinstance(raw_cursor_style, dict):
            errors.append("cursor_style must be an object when present.")
        else:
            for key, lower, upper in (("hand_size", 32, 96), ("ring_small_size", 32, 120), ("ring_large_size", 40, 144), ("hotspot_x", 0, 96), ("hotspot_y", 0, 96), ("approach_seconds", 0.08, 0.60), ("press_seconds", 0.04, 0.20), ("post_click_seconds", 0.08, 0.50), ("approach_dx", 0, 80), ("approach_dy", 0, 80)):
                if key in raw_cursor_style and (not isinstance(raw_cursor_style[key], (int, float)) or not lower <= raw_cursor_style[key] <= upper):
                    errors.append("cursor_style.%s must be between %s and %s." % (key, lower, upper))
            if raw_cursor_style.get("ring_small_size", 54) > raw_cursor_style.get("ring_large_size", 82):
                errors.append("cursor_style.ring_small_size cannot exceed ring_large_size.")
        minimum, maximum = format_data.get("min_duration_seconds"), format_data.get("max_duration_seconds")
        if not isinstance(minimum, (int, float)) or not isinstance(maximum, (int, float)) or not 1 <= minimum <= maximum <= MAX_DURATION_SECONDS:
            errors.append("format must specify min_duration_seconds and max_duration_seconds between 1 and %s." % MAX_DURATION_SECONDS)
        for section, keys in (("inputs", ("narration",)), ("outputs", REQUIRED_OUTPUTS)):
            values = data.get(section)
            if not isinstance(values, dict):
                errors.append("%s must be an object." % section)
                continue
            for key in keys:
                try:
                    resolve_relative(require_string(values, key))
                except PipelineError as error:
                    errors.append("%s.%s: %s" % (section, key, error))
        scenes = data.get("scenes")
        if not isinstance(scenes, list) or not scenes:
            errors.append("scenes must contain ordered scene definitions.")
        else:
            for index, scene in enumerate(scenes, start=1):
                if not isinstance(scene, dict):
                    errors.append("Scene %s must be an object." % index)
                    continue
                try:
                    resolve_relative(require_string(scene, "recording"))
                except PipelineError as error:
                    errors.append("Scene %s recording: %s" % (index, error))
                start, end = scene.get("source_start"), scene.get("source_end")
                if not isinstance(start, (int, float)) or not isinstance(end, (int, float)) or start < 0 or end <= start:
                    errors.append("Scene %s must have a non-empty, non-negative source range." % index)
                output_duration = scene.get("output_duration_seconds")
                if not isinstance(output_duration, (int, float)) or abs(float(output_duration) - scene_duration(scene)) > 0.001:
                    errors.append("Scene %s output_duration_seconds must equal its source range; no time compression is supported." % index)
                if "playback_rate" in scene and scene["playback_rate"] != 1:
                    errors.append("Scene %s playback_rate must be 1; required actions cannot be time-compressed." % index)
                framing = scene.get("framing", {"fit": "contain", "zoom": 1.0})
                if not isinstance(framing, dict) or framing.get("fit", "contain") not in ("contain", "cover"):
                    errors.append("Scene %s framing.fit must be contain or cover." % index)
                else:
                    zoom = framing.get("zoom", 1.0)
                    if not isinstance(zoom, (int, float)) or not 1.0 <= float(zoom) <= 1.08:
                        errors.append("Scene %s framing.zoom must be between 1.0 and 1.08." % index)
                    if "app_x" in framing and (not isinstance(framing["app_x"], int) or not 0 <= framing["app_x"] <= 1_800):
                        errors.append("Scene %s framing.app_x must be an integer between 0 and 1800." % index)
                source_crop = framing.get("source_crop") if isinstance(framing, dict) else None
                if source_crop is not None:
                    if not isinstance(source_crop, dict) or any(not isinstance(source_crop.get(key), int) for key in ("x", "y", "width", "height")):
                        errors.append("Scene %s framing.source_crop must have integer x, y, width, and height." % index)
                    elif source_crop["x"] < 0 or source_crop["y"] < 0 or source_crop["width"] <= 0 or source_crop["height"] <= 0:
                        errors.append("Scene %s framing.source_crop must have non-negative x/y and positive width/height." % index)
                if "label" in scene:
                    if not isinstance(scene["label"], str) or not scene["label"].strip() or len(scene["label"]) > 96:
                        errors.append("Scene %s label must be a non-empty string of at most 96 characters." % index)
                    elif isinstance(framing, dict) and framing.get("fit", "contain") != "contain":
                        errors.append("Scene %s label requires contain framing so it stays outside the app UI." % index)
                clicks = scene.get("clicks", [])
                if not isinstance(clicks, list):
                    errors.append("Scene %s clicks must be a list when present." % index)
                else:
                    style = cursor_style(data)
                    previous_click_time = None
                    for click_index, click in enumerate(clicks, start=1):
                        if not isinstance(click, dict):
                            errors.append("Scene %s click %s must be an object." % (index, click_index))
                            continue
                        click_time, click_x, click_y = click.get("source_time"), click.get("x"), click.get("y")
                        if not all(isinstance(value, (int, float)) for value in (click_time, click_x, click_y)):
                            errors.append("Scene %s click %s must have numeric source_time, x, and y." % (index, click_index))
                            continue
                        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)) or click_time < start + style["approach_seconds"] or click_time > end - style["post_click_seconds"]:
                            errors.append("Scene %s click %s needs room for its approach and release within the source range." % (index, click_index))
                        if previous_click_time is not None and click_time - previous_click_time < style["approach_seconds"] + style["post_click_seconds"] + 0.04:
                            errors.append("Scene %s click annotations overlap; leave room for approach and release." % index)
                        previous_click_time = click_time
                        if not isinstance(click.get("label"), str) or not click["label"].strip() or not isinstance(click.get("evidence"), str) or not click["evidence"].strip():
                            errors.append("Scene %s click %s requires non-empty label and evidence." % (index, click_index))
                        try:
                            map_raw_click(scene, data, float(click_x), float(click_y))
                        except PipelineError as error:
                            errors.append("Scene %s click %s: %s" % (index, click_index, error))
            if isinstance(minimum, (int, float)) and isinstance(maximum, (int, float)):
                duration = planned_duration(data)
                if duration < minimum or duration > maximum:
                    errors.append("Ordered scene runtime %.3fs must be within %.3fs–%.3fs." % (duration, minimum, maximum))
        narration = data.get("narration")
        if not isinstance(narration, dict):
            errors.append("narration must be an object.")
        else:
            segments = narration.get("segments")
            if not isinstance(segments, list) or not segments:
                errors.append("narration.segments must contain at least one timed segment.")
            else:
                previous_end = -1.0
                duration_limit = planned_duration(data) if isinstance(data.get("scenes"), list) and data["scenes"] else 0
                for index, segment in enumerate(segments, start=1):
                    if not isinstance(segment, dict):
                        errors.append("Narration segment %s must be an object." % index)
                        continue
                    start, end, text = segment.get("start"), segment.get("end"), segment.get("text")
                    if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
                        errors.append("Narration segment %s must have numeric start/end." % index)
                    elif start < 0 or end <= start or start < previous_end or end > duration_limit:
                        errors.append("Narration segment %s has invalid or overlapping time range." % index)
                    else:
                        previous_end = float(end)
                    if not isinstance(text, str) or not text.strip():
                        errors.append("Narration segment %s must have text." % index)
            caption_segments = narration.get("caption_segments")
            if caption_segments is not None:
                if not isinstance(caption_segments, list) or not caption_segments:
                    errors.append("narration.caption_segments must contain at least one reviewed timed cue when present.")
                else:
                    previous_end = -1.0
                    duration_limit = planned_duration(data) if isinstance(data.get("scenes"), list) and data["scenes"] else 0
                    for index, segment in enumerate(caption_segments, start=1):
                        if not isinstance(segment, dict):
                            errors.append("Caption segment %s must be an object." % index)
                            continue
                        start, end, text = segment.get("start"), segment.get("end"), segment.get("text")
                        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
                            errors.append("Caption segment %s must have numeric start/end." % index)
                        elif start < 0 or end <= start or start < previous_end or end > duration_limit:
                            errors.append("Caption segment %s has invalid or overlapping time range." % index)
                        else:
                            previous_end = float(end)
                        if not isinstance(text, str) or not text.strip():
                            errors.append("Caption segment %s must have text." % index)
                        else:
                            try:
                                if len(split_caption(text)) != 1:
                                    errors.append("Caption segment %s must fit one two-line cue; split it before export." % index)
                            except PipelineError as error:
                                errors.append("Caption segment %s: %s" % (index, error))
    except (PipelineError, KeyError, TypeError, ValueError) as error:
        errors.append(str(error))
    return errors


def hms(seconds: float, separator: str = ",") -> str:
    milliseconds = int(round(seconds * 1000))
    hours, remainder = divmod(milliseconds, 3_600_000)
    minutes, remainder = divmod(remainder, 60_000)
    whole_seconds, millis = divmod(remainder, 1000)
    return "%02d:%02d:%02d%s%03d" % (hours, minutes, whole_seconds, separator, millis)


def split_caption(text: str, max_chars: int = 40) -> list[str]:
    """Return one or more <=2-line caption chunks without wide fallback lines."""
    words = text.split()
    if any(len(word) > max_chars for word in words):
        raise PipelineError("Caption contains a word longer than %s characters; edit narration before export." % max_chars)
    lines: list[str] = []
    current: list[str] = []
    for word in words:
        candidate = " ".join(current + [word])
        if current and len(candidate) > max_chars:
            lines.append(" ".join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(" ".join(current))
    return ["\n".join(lines[index:index + 2]) for index in range(0, len(lines), 2)]


def subtitle_segments(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Prefer manually reviewed spoken-word cue timing when the timeline provides it."""
    narration = data["narration"]
    caption_segments = narration.get("caption_segments")
    return caption_segments if isinstance(caption_segments, list) and caption_segments else narration["segments"]


def subtitle_text(segments: Iterable[dict[str, Any]], vtt: bool) -> str:
    records: list[str] = ["WEBVTT", ""] if vtt else []
    separator = "." if vtt else ","
    number = 1
    for segment in segments:
        chunks = split_caption(str(segment["text"]))
        start, end = float(segment["start"]), float(segment["end"])
        interval = (end - start) / len(chunks)
        for index, chunk in enumerate(chunks):
            if not vtt:
                records.append(str(number))
            records.append("%s --> %s" % (hms(start + interval * index, separator), hms(start + interval * (index + 1), separator)))
            records.append(chunk)
            records.append("")
            number += 1
    return "\n".join(records)


def write_subtitles(data: dict[str, Any]) -> tuple[Path, Path]:
    outputs = data["outputs"]
    segments = subtitle_segments(data)
    srt, vtt = resolve_relative(outputs["srt"]), resolve_relative(outputs["vtt"])
    for path, contents in ((srt, subtitle_text(segments, False)), (vtt, subtitle_text(segments, True))):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(contents, encoding="utf-8")
    write_ass_subtitles(data, srt.with_suffix(".ass"))
    return srt, vtt


def ass_timestamp(seconds: float) -> str:
    """Return an ASS timestamp rounded to its centisecond precision."""
    centiseconds = int(round(seconds * 100))
    hours, remainder = divmod(centiseconds, 360_000)
    minutes, remainder = divmod(remainder, 6_000)
    whole_seconds, hundredths = divmod(remainder, 100)
    return "%d:%02d:%02d.%02d" % (hours, minutes, whole_seconds, hundredths)


def ass_dialogue_text(text: str) -> str:
    """Escape text for an ASS dialogue event while preserving explicit line breaks."""
    return text.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}").replace("\n", "\\N")


def ass_color(hex_color: str) -> str:
    """Convert a validated #RRGGBB color to ASS's &HAABBGGRR notation."""
    if not re.fullmatch(r"#[0-9A-Fa-f]{6}", hex_color):
        raise PipelineError("ASS colors must be six-digit #RRGGBB hex values.")
    red, green, blue = hex_color[1:3], hex_color[3:5], hex_color[5:7]
    return "&H00%s%s%s" % (blue.upper(), green.upper(), red.upper())


def ass_subtitle_text(data: dict[str, Any]) -> str:
    """Build deterministic, output-resolution-aware ASS captions for FFmpeg/libass."""
    width, height = data["format"]["width"], data["format"]["height"]
    style = caption_style(data)
    records = [
        "[Script Info]",
        "ScriptType: v4.00+",
        "PlayResX: %d" % width,
        "PlayResY: %d" % height,
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
        "Style: LusterCaptions,Verdana,%d,%s,&H000000FF,%s,&H00000000,0,0,0,0,100,100,0,0,1,%d,0,%d,%d,%d,%d,1" % (style["font_size"], ass_color(style["text_color"]), ass_color(style["outline_color"]), style["outline_width"], style["alignment"], style["margin_left"], style["margin_right"], style["margin_vertical"]),
        "",
        "[Events]",
        "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    ]
    for segment in subtitle_segments(data):
        chunks = split_caption(str(segment["text"]))
        start, end = float(segment["start"]), float(segment["end"])
        interval = (end - start) / len(chunks)
        for index, chunk in enumerate(chunks):
            records.append(
                "Dialogue: 0,%s,%s,LusterCaptions,,0,0,0,,%s"
                % (ass_timestamp(start + interval * index), ass_timestamp(start + interval * (index + 1)), ass_dialogue_text(chunk))
            )
    return "\n".join(records) + "\n"


def write_ass_subtitles(data: dict[str, Any], path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(ass_subtitle_text(data), encoding="utf-8")
    return path


def executable(name: str, env_name: str | None = None) -> str:
    selected = os.environ.get(env_name, "") if env_name else ""
    candidate = selected or shutil.which(name)
    if not candidate:
        raise PipelineError("%s is required. Set %s or install %s." % (name, env_name or name.upper(), name))
    return candidate


def run(command: list[str]) -> None:
    try:
        subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    except subprocess.CalledProcessError as error:
        raise PipelineError("FFmpeg command failed: %s" % error.stderr[-2500:].strip()) from error


def rasterize_annotation_asset(name: str, width: int) -> Path:
    source = ANNOTATION_GRAPHICS / (name + ".svg")
    if not source.is_file():
        raise PipelineError("Annotation graphic is missing: %s" % source)
    fingerprint = hashlib.sha256(source.read_bytes() + str(width).encode("ascii")).hexdigest()[:16]
    output = ROOT / "work" / "annotation-cache" / (name + "-" + fingerprint + ".png")
    if output.is_file():
        return output
    node = shutil.which("node")
    if not node:
        raise PipelineError("Node.js and the repository's installed sharp package are required to rasterize annotation graphics.")
    output.parent.mkdir(parents=True, exist_ok=True)
    script = "const sharp=require('sharp'); sharp(process.argv[1]).resize({width:Number(process.argv[3])}).png().toFile(process.argv[2]).catch(e=>{process.stderr.write(e.message);process.exit(1)})"
    try:
        subprocess.run([node, "-e", script, str(source), str(output), str(width)], cwd=str(ROOT.parents[1]), check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    except subprocess.CalledProcessError as error:
        raise PipelineError("Could not rasterize local annotation graphic with sharp: %s" % error.stderr[-1000:].strip()) from error
    return output


def annotation_assets(plan: list[dict[str, Any]]) -> tuple[Path, Path] | None:
    if not plan:
        return None
    return rasterize_annotation_asset("hand-pointer", 64), rasterize_annotation_asset("click-ring", 80)


def append_annotation_inputs(command: list[str], plan: list[dict[str, Any]], assets: tuple[Path, Path] | None) -> None:
    if not assets:
        return
    hand, ring = assets
    for _ in plan:
        command.extend(["-loop", "1", "-framerate", "30", "-i", str(ring), "-loop", "1", "-framerate", "30", "-i", str(hand)])


def append_annotation_filters(filters: list[str], plan: list[dict[str, Any]], input_start: int, data: dict[str, Any]) -> str:
    """Append short-lived ring and hand overlays after the assembled editorial video."""
    base = "video"
    style = cursor_style(data)
    for index, click in enumerate(plan):
        ring_input, hand_input = input_start + index * 2, input_start + index * 2 + 1
        start, press, end = click["edit_time"] - style["approach_seconds"], click["edit_time"], click["edit_time"] + style["post_click_seconds"]
        small_end = press + style["press_seconds"]
        x, y = click["x"], click["y"]
        small, large, first, second, hand = "ring_small_%d" % index, "ring_large_%d" % index, "ring_first_%d" % index, "ring_second_%d" % index, "hand_%d" % index
        filters.append("[%d:v]format=rgba,split=2[ring_a_%d][ring_b_%d]" % (ring_input, index, index))
        filters.append("[ring_a_%d]fade=t=in:st=%.3f:d=0.03:alpha=1,fade=t=out:st=%.3f:d=0.03:alpha=1,scale=%d:%d[%s]" % (index, press, small_end - 0.03, style["ring_small_size"], style["ring_small_size"], small))
        filters.append("[ring_b_%d]fade=t=in:st=%.3f:d=0.04:alpha=1,fade=t=out:st=%.3f:d=0.06:alpha=1,scale=%d:%d[%s]" % (index, small_end, end - 0.06, style["ring_large_size"], style["ring_large_size"], large))
        filters.append("[%s][%s]overlay=x=%.3f:y=%.3f:enable='between(t\\,%.3f\\,%.3f)'[%s]" % (base, small, x - style["ring_small_size"] / 2, y - style["ring_small_size"] / 2, press, small_end, first))
        filters.append("[%s][%s]overlay=x=%.3f:y=%.3f:enable='between(t\\,%.3f\\,%.3f)'[%s]" % (first, large, x - style["ring_large_size"] / 2, y - style["ring_large_size"] / 2, small_end, end, second))
        hot_x, hot_y = x - style["hotspot_x"], y - style["hotspot_y"]
        filters.append("[%d:v]format=rgba,fade=t=in:st=%.3f:d=0.06:alpha=1,fade=t=out:st=%.3f:d=0.06:alpha=1,scale=%d:%d[%s]" % (hand_input, start, end - 0.06, style["hand_size"], style["hand_size"], hand))
        x_expression = "if(lt(t\\,%.3f)\\,%.3f+%.3f*(%.3f-t)/%.3f\\,%.3f)" % (press, hot_x, style["approach_dx"], press, style["approach_seconds"], hot_x)
        y_expression = "if(lt(t\\,%.3f)\\,%.3f+%.3f*(%.3f-t)/%.3f\\,%.3f)+if(between(t\\,%.3f\\,%.3f)\\,4\\,0)" % (press, hot_y, style["approach_dy"], press, style["approach_seconds"], hot_y, press, press + style["press_seconds"])
        next_base = "click_%d" % index
        filters.append("[%s][%s]overlay=x='%s':y='%s':enable='between(t\\,%.3f\\,%.3f)'[%s]" % (second, hand, x_expression, y_expression, start, end, next_base))
        base = next_base
    return base


def probe(path: Path) -> dict[str, Any]:
    ffprobe = executable("ffprobe", "VIDEO_FFPROBE")
    completed = subprocess.run([ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return json.loads(completed.stdout)


def media_duration(path: Path) -> float:
    report = probe(path)
    try:
        return float(report["format"]["duration"])
    except (KeyError, TypeError, ValueError) as error:
        raise PipelineError("Cannot read media duration: %s" % path) from error


def source_dimensions(path: Path) -> tuple[int, int]:
    streams = probe(path).get("streams", [])
    video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
    if not video or not isinstance(video.get("width"), int) or not isinstance(video.get("height"), int):
        raise PipelineError("Cannot read source video dimensions: %s" % path)
    return video["width"], video["height"]


def required_recordings(data: dict[str, Any]) -> list[Path]:
    recordings = [resolve_relative(scene["recording"]) for scene in data["scenes"]]
    missing = [str(path.relative_to(ROOT)) for path in recordings if not path.is_file()]
    if missing:
        raise PipelineError("Approved scene recordings are required before render; missing: %s" % ", ".join(missing))
    return recordings


def required_media(data: dict[str, Any]) -> tuple[list[Path], Path]:
    recordings = required_recordings(data)
    narration = resolve_relative(data["inputs"]["narration"])
    missing = [str(narration.relative_to(ROOT))] if not narration.is_file() else []
    if missing:
        raise PipelineError("Approved scene recordings and narration are required before render; missing: %s" % ", ".join(missing))
    return recordings, narration


def textfile(directory: Path, name: str, value: str) -> Path:
    path = directory / name
    path.write_text(value, encoding="utf-8")
    return path


def wrap_editorial_text(value: str, max_chars: int) -> str:
    """Wrap title/labels conservatively for the ivory editorial panel."""
    if "\n" in value:
        return value
    words = value.split()
    lines: list[str] = []
    current: list[str] = []
    for word in words:
        candidate = " ".join(current + [word])
        if current and len(candidate) > max_chars:
            lines.append(" ".join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(" ".join(current))
    return "\n".join(lines)


def editorial_style(data: dict[str, Any]) -> dict[str, int | str]:
    layout = data.get("layout", {"mode": "legacy"})
    if layout.get("mode") == "landscape-mobile-right":
        return {
            "title_x": layout.get("title_x", 120), "title_y": layout.get("title_y", 240), "title_font_size": layout.get("title_font_size", 60), "title_wrap_chars": layout.get("title_wrap_chars", 16),
            "label_x": layout.get("label_x", 120), "label_y": layout.get("label_y", 520), "label_font_size": layout.get("label_font_size", 36), "label_wrap_chars": layout.get("label_wrap_chars", 28),
            "disclosure_x": layout.get("disclosure_x", 120), "disclosure_y": layout.get("disclosure_y", 1015), "disclosure_font_size": layout.get("disclosure_font_size", 18),
            "watermark_x": layout.get("watermark_x", 120), "watermark_y": layout.get("watermark_y", 650), "watermark_font_size": layout.get("watermark_font_size", 26),
            "title_text": layout.get("title_text", data["title"]),
        }
    height = data["format"]["height"]
    return {
        "title_x": 64, "title_y": 42, "title_font_size": 38, "title_wrap_chars": 80,
        "label_x": 64, "label_y": 82, "label_font_size": 22, "label_wrap_chars": 70,
        "disclosure_x": 64, "disclosure_y": height - 48, "disclosure_font_size": 22,
        "watermark_x": 0, "watermark_y": 0, "watermark_font_size": 34,
        "title_text": data["title"],
    }


def scene_filter(index: int, scene: dict[str, Any], data: dict[str, Any], label_file: Path | None = None) -> str:
    width, height = data["format"]["width"], data["format"]["height"]
    framing = scene.get("framing", {})
    fit, zoom = framing.get("fit", "contain"), float(framing.get("zoom", 1.0))
    source_crop = framing.get("source_crop")
    source_crop_filter = ""
    if source_crop:
        source_crop_filter = "crop=%d:%d:%d:%d," % (source_crop["width"], source_crop["height"], source_crop["x"], source_crop["y"])
    layout = data.get("layout", {"mode": "legacy"})
    if layout.get("mode") == "landscape-mobile-right":
        app_x, app_y, app_height = framing.get("app_x", layout.get("app_x", 1200)), layout.get("app_y", 90), layout.get("app_height", 920)
        scaled_height = int(round(app_height * zoom / 2) * 2)
        crop_width, crop_height = (source_crop["width"], source_crop["height"]) if source_crop else (390, 844)
        app_width = int(round(app_height * crop_width / crop_height))
        filter_text = "scale=-2:%d,crop=trunc(iw/%.4f/2)*2:%d:(in_w-out_w)/2:(in_h-out_h)/2,pad=%d:%d:%d:%d:#F7F1E8,drawbox=x=%d:y=%d:w=%d:h=%d:color=#B99A64@0.38:t=2" % (scaled_height, zoom, app_height, width, height, app_x, app_y, app_x - 8, app_y - 8, app_width + 16, app_height + 16)
    elif fit == "contain":
        margin = 64 if width >= height else 48
        top = 110 if width >= height else 150
        caption_safe_bottom = 200 if width >= height else 300
        inner_width, inner_height = width - margin * 2, height - top - caption_safe_bottom
        filter_text = "scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2:#F7F1E8" % (inner_width, inner_height, width, height)
    else:
        filter_text = "scale=%d:%d:force_original_aspect_ratio=increase,crop=%d:%d" % (width, height, width, height)
    if zoom > 1 and layout.get("mode") != "landscape-mobile-right":
        filter_text += ",scale=trunc(iw*%.4f/2)*2:trunc(ih*%.4f/2)*2,crop=%d:%d:(in_w-out_w)/2:(in_h-out_h)/2" % (zoom, zoom, width, height)
    if label_file:
        editorial = editorial_style(data)
        filter_text += ",drawtext=textfile='%s':fontcolor=#B99A64:fontsize=%d:x=%d:y=%d" % (escape_filter_path(label_file), editorial["label_font_size"], editorial["label_x"], editorial["label_y"])
    return "[%d:v]trim=duration=%.6f,setpts=PTS-STARTPTS,%s%s,setsar=1[v%d]" % (index, scene_duration(scene), source_crop_filter, filter_text, index)


def caption_style(data: dict[str, Any]) -> dict[str, Any]:
    style = data.get("caption_style", {})
    layout = data.get("layout", {"mode": "legacy"})
    mobile_right = layout.get("mode") == "landscape-mobile-right"
    return {
        "font_size": style.get("font_size", 56),
        "margin_vertical": style.get("margin_vertical", 240 if mobile_right else 100),
        "margin_left": style.get("margin_left", 120 if mobile_right else 0),
        "margin_right": style.get("margin_right", style.get("margin_left", 120 if mobile_right else 0)),
        "alignment": style.get("alignment", 1 if mobile_right else 2),
        "text_color": style.get("text_color", "#FFFFFF"),
        "outline_color": style.get("outline_color", "#292421"),
        "outline_width": style.get("outline_width", 2),
    }


def escape_filter_path(path: Path) -> str:
    return str(path).replace("\\", "\\\\").replace("'", "\\'").replace(":", "\\:")


def validate_recording_sources(data: dict[str, Any], recordings: list[Path]) -> None:
    for scene, recording in zip(data["scenes"], recordings):
        if media_duration(recording) + 0.05 < float(scene["source_end"]):
            raise PipelineError("Scene source range exceeds the available recording duration: %s" % recording.relative_to(ROOT))
        source_crop = scene.get("framing", {}).get("source_crop")
        if source_crop:
            source_width, source_height = source_dimensions(recording)
            if source_crop["x"] + source_crop["width"] > source_width or source_crop["y"] + source_crop["height"] > source_height:
                raise PipelineError("Scene source_crop exceeds the actual recording dimensions: %s" % recording.relative_to(ROOT))


def append_scene_inputs(command: list[str], data: dict[str, Any], recordings: list[Path]) -> None:
    for scene, recording in zip(data["scenes"], recordings):
        command.extend(["-ss", "%.6f" % float(scene["source_start"]), "-t", "%.6f" % scene_duration(scene), "-i", str(recording)])


def assemble_filters(data: dict[str, Any], label_files: list[Path | None], title_file: Path, disclosure_file: Path, watermark_file: Path | None = None) -> list[str]:
    filters = [scene_filter(index, scene, data, label_files[index]) for index, scene in enumerate(data["scenes"])]
    labels = "".join("[v%d]" % index for index in range(len(data["scenes"])))
    filters.append("%sconcat=n=%d:v=1:a=0[assembled]" % (labels, len(data["scenes"])))
    editorial = editorial_style(data)
    final_filter = "[assembled]drawtext=textfile='%s':fontcolor=#292421:fontsize=%d:x=%d:y=%d,drawtext=textfile='%s':fontcolor=#292421:fontsize=%d:x=%d:y=%d" % (escape_filter_path(title_file), editorial["title_font_size"], editorial["title_x"], editorial["title_y"], escape_filter_path(disclosure_file), editorial["disclosure_font_size"], editorial["disclosure_x"], editorial["disclosure_y"])
    if watermark_file:
        if data.get("layout", {}).get("mode") == "landscape-mobile-right":
            final_filter += ",drawtext=textfile='%s':fontcolor=#8A5B3D@0.92:fontsize=%d:x=%d:y=%d:box=1:boxcolor=#F7F1E8@0.82:boxborderw=12" % (escape_filter_path(watermark_file), editorial["watermark_font_size"], editorial["watermark_x"], editorial["watermark_y"])
        else:
            final_filter += ",drawtext=textfile='%s':fontcolor=#8A5B3D@0.92:fontsize=34:x=(w-text_w)/2:y=(h-text_h)/2:box=1:boxcolor=#F7F1E8@0.82:boxborderw=18" % escape_filter_path(watermark_file)
    return filters + [final_filter + "[video]"]


def render_silent_draft(data: dict[str, Any], ffmpeg: str) -> dict[str, str]:
    recordings = required_recordings(data)
    validate_recording_sources(data, recordings)
    plan = click_plan(data)
    assets = annotation_assets(plan)
    output = ROOT / "work" / "internal-drafts" / (str(data["id"]) + ".silent.not-approval-ready.mp4")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="luster-video-", dir=str(ROOT / "work")) as temp:
        temp_path = Path(temp)
        editorial = editorial_style(data)
        title_file = textfile(temp_path, "title.txt", wrap_editorial_text(str(editorial["title_text"]), int(editorial["title_wrap_chars"])))
        disclosure_file = textfile(temp_path, "disclosure.txt", str(data["branding"].get("disclosure", "AI-generated narration")))
        watermark_file = textfile(temp_path, "watermark.txt", "INTERNAL SILENT DRAFT — NOT APPROVAL READY")
        label_files = [textfile(temp_path, "label-%d.txt" % index, wrap_editorial_text(scene["label"], int(editorial["label_wrap_chars"]))) if scene.get("label") else None for index, scene in enumerate(data["scenes"])]
        command = [ffmpeg, "-y"]
        append_scene_inputs(command, data, recordings)
        expected_duration = planned_duration(data)
        command.extend(["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"])
        append_annotation_inputs(command, plan, assets)
        filters = assemble_filters(data, label_files, title_file, disclosure_file, watermark_file)
        output_label = append_annotation_filters(filters, plan, len(data["scenes"]) + 1, data)
        command.extend(["-filter_complex", ";".join(filters), "-map", "[%s]" % output_label, "-map", "%d:a" % len(data["scenes"]), "-t", "%.6f" % expected_duration, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-movflags", "+faststart", str(output)])
        run(command)
    return {"internal_silent_draft": str(output), "render_status": "internal-silent-draft-not-approval-ready"}


def render(data: dict[str, Any], internal_test: bool = False, internal_silent_draft: bool = False) -> dict[str, str]:
    errors = validate_timeline(data)
    if errors:
        raise PipelineError("Invalid timeline: " + "; ".join(errors))
    ffmpeg = executable("ffmpeg", "VIDEO_FFMPEG")
    outputs = data["outputs"]
    width, height = data["format"]["width"], data["format"]["height"]
    if internal_test:
        internal_output = ROOT / "work" / "internal-tests" / (str(data["id"]) + ".not-final.mp4")
        internal_output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="luster-video-", dir=str(ROOT / "work")) as temp:
            slate = textfile(Path(temp), "title.txt", "INTERNAL TEST — NOT FINAL")
            command = [ffmpeg, "-y", "-f", "lavfi", "-i", "color=c=#F7F1E8:s=%dx%d:r=30" % (width, height), "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "3", "-vf", "drawtext=textfile='%s':fontcolor=#292421:fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2" % escape_filter_path(slate), "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-movflags", "+faststart", str(internal_output)]
            run(command)
        return {"internal_test": str(internal_output), "render_status": "internal-test-not-final"}
    if internal_silent_draft:
        return render_silent_draft(data, ffmpeg)
    clean, captioned, thumbnail = (resolve_relative(outputs[key]) for key in ("clean", "captioned", "thumbnail"))
    for output in (clean, captioned, thumbnail):
        output.parent.mkdir(parents=True, exist_ok=True)
    recordings, narration = required_media(data)
    expected_duration = planned_duration(data)
    validate_recording_sources(data, recordings)
    plan = click_plan(data)
    assets = annotation_assets(plan)
    if media_duration(narration) > expected_duration + 0.1:
        raise PipelineError("Narration is longer than the ordered scene timeline; revise scenes or narration before rendering.")
    srt, _ = write_subtitles(data)
    with tempfile.TemporaryDirectory(prefix="luster-video-", dir=str(ROOT / "work") if (ROOT / "work").exists() else None) as temp:
        temp_path = Path(temp)
        editorial = editorial_style(data)
        title_file = textfile(temp_path, "title.txt", wrap_editorial_text(str(editorial["title_text"]), int(editorial["title_wrap_chars"])))
        disclosure_file = textfile(temp_path, "disclosure.txt", str(data["branding"].get("disclosure", "AI-generated narration")))
        font = data["branding"].get("font_file")
        if font:
            font_path = resolve_relative(str(font))
            if not font_path.is_file():
                raise PipelineError("Configured font file does not exist: %s" % font)
        label_files = [textfile(temp_path, "label-%d.txt" % index, wrap_editorial_text(scene["label"], int(editorial["label_wrap_chars"]))) if scene.get("label") else None for index, scene in enumerate(data["scenes"])]
        command = [ffmpeg, "-y"]
        append_scene_inputs(command, data, recordings)
        command.extend(["-i", str(narration)])
        append_annotation_inputs(command, plan, assets)
        filters = assemble_filters(data, label_files, title_file, disclosure_file)
        output_label = append_annotation_filters(filters, plan, len(data["scenes"]) + 1, data)
        narration_index = len(data["scenes"])
        filters.append("[%d:a]apad=whole_dur=%.6f[audio]" % (narration_index, expected_duration))
        command.extend(["-filter_complex", ";".join(filters), "-map", "[%s]" % output_label, "-map", "[audio]", "-t", "%.6f" % expected_duration, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(clean)])
        run(command)
        ass = srt.with_suffix(".ass")
        subtitle_filter = "subtitles=filename='%s'" % escape_filter_path(ass)
        run([ffmpeg, "-y", "-i", str(clean), "-vf", subtitle_filter, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "copy", "-movflags", "+faststart", str(captioned)])
        run([ffmpeg, "-y", "-ss", "00:00:02.000", "-i", str(clean), "-frames:v", "1", str(thumbnail)])
    return {"clean": str(clean), "captioned": str(captioned), "thumbnail": str(thumbnail), "render_status": "reference-ready-not-final"}


def qa(data: dict[str, Any]) -> dict[str, Any]:
    outputs = data["outputs"]
    clean, captioned = (resolve_relative(outputs[key]) for key in ("clean", "captioned"))
    width, height = data["format"]["width"], data["format"]["height"]
    expected_duration = planned_duration(data)
    result: dict[str, Any] = {"timeline_id": data["id"], "status": data.get("status"), "render_status": "reference-ready-not-final", "files": {}}
    for label, path in (("clean", clean), ("captioned", captioned)):
        if not path.is_file():
            raise PipelineError("Cannot QA missing export: %s" % path.relative_to(ROOT))
        report = probe(path)
        streams = report.get("streams", [])
        video = next((stream for stream in streams if stream.get("codec_type") == "video"), None)
        audio = next((stream for stream in streams if stream.get("codec_type") == "audio"), None)
        if not video or not audio:
            raise PipelineError("%s must contain video and audio." % label)
        if video.get("width") != width or video.get("height") != height or video.get("pix_fmt") != "yuv420p":
            raise PipelineError("%s does not meet configured dimensions and yuv420p requirements." % label)
        if video.get("codec_name") != "h264" or audio.get("codec_name") != "aac" or video.get("r_frame_rate") not in ("30/1", "30"):
            raise PipelineError("%s must use H.264/AAC at 30 fps." % label)
        duration = float(report.get("format", {}).get("duration", 0))
        if abs(duration - expected_duration) > 0.1:
            raise PipelineError("%s duration must match the ordered scene runtime." % label)
        result["files"][label] = {"duration_seconds": duration, "width": video["width"], "height": video["height"], "video_codec": video["codec_name"], "audio_codec": audio["codec_name"], "pixel_format": video["pix_fmt"]}
    if abs(result["files"]["clean"]["duration_seconds"] - result["files"]["captioned"]["duration_seconds"]) > 0.05:
        raise PipelineError("Clean and captioned output duration differs.")
    qa_path = resolve_relative(outputs["qa"])
    qa_path.parent.mkdir(parents=True, exist_ok=True)
    qa_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result


def tts_plan(data: dict[str, Any]) -> dict[str, str]:
    narration = data["narration"]
    fingerprint = json.dumps({"text": [segment["text"] for segment in narration["segments"]], "model": narration.get("model"), "voice": narration.get("voice"), "instructions": narration.get("instructions")}, sort_keys=True, separators=(",", ":"))
    return {"cache_key": hashlib.sha256(fingerprint.encode("utf-8")).hexdigest(), "mode": "dry-run-only", "message": "No API call was made. A separately approved budget-controlled producer must place approved narration at inputs.narration."}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("validate", "subtitles", "render", "qa", "tts-plan"))
    parser.add_argument("--timeline", required=True, help="Timeline JSON relative to production/luster-videos.")
    parser.add_argument("--internal-test", action="store_true", help="Render a clearly labelled three-second slate only; it is never final media.")
    parser.add_argument("--internal-silent-draft", action="store_true", help="Assemble actual scene footage with silence only under work/internal-drafts; it is never approval-ready.")
    args = parser.parse_args(argv)
    try:
        data = load_timeline(args.timeline)
        if args.command == "validate":
            errors = validate_timeline(data)
            if errors:
                raise PipelineError("\n".join(errors))
            print("Timeline is structurally valid. Exports remain reference-ready, not final, until user approval.")
        elif args.command == "subtitles":
            errors = validate_timeline(data)
            if errors:
                raise PipelineError("\n".join(errors))
            srt, vtt = write_subtitles(data)
            print(json.dumps({"srt": str(srt.relative_to(ROOT)), "vtt": str(vtt.relative_to(ROOT))}))
        elif args.command == "render":
            if args.internal_test and args.internal_silent_draft:
                raise PipelineError("Choose only one internal render mode.")
            print(json.dumps(render(data, internal_test=args.internal_test, internal_silent_draft=args.internal_silent_draft), indent=2))
        elif args.command == "qa":
            print(json.dumps(qa(data), indent=2))
        else:
            print(json.dumps(tts_plan(data), indent=2))
        return 0
    except PipelineError as error:
        print("video-pipeline: %s" % error, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
