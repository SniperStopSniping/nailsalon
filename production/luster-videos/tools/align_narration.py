#!/usr/bin/env python3
"""Rebuild naturally paced narration from cached sections, without API calls."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import narration

ROOT = Path(__file__).resolve().parents[1]


def local(value: str) -> Path:
    path = Path(value)
    if path.is_absolute() or '..' in path.parts:
        raise ValueError('Paths must stay within the production directory.')
    return ROOT / path


def invoke(args: list[str]) -> str:
    result = subprocess.run(args, capture_output=True, text=True, check=True)
    return result.stderr


def build(config_path: str) -> dict:
    config = json.loads(local(config_path).read_text())
    spoken_config = json.loads(local(config['sections_config']).read_text())
    ledger = json.loads((ROOT / 'narration/ledger.json').read_text())
    ffmpeg = os.environ.get('VIDEO_FFMPEG') or shutil.which('ffmpeg')
    ffprobe = os.environ.get('VIDEO_FFPROBE') or shutil.which('ffprobe')
    if not ffmpeg or not ffprobe:
        raise ValueError('FFmpeg and FFprobe are required.')
    duration = float(config['duration_seconds'])
    if not 60 <= duration <= 75 or len(config['sections']) > 20:
        raise ValueError('Expected bounded tutorial duration and sections.')
    command = [ffmpeg, '-y']
    filters, evidence = [], []
    previous_end = 0.0
    for index, section in enumerate(config['sections']):
        spoken_section = next(s for s in spoken_config['sections'] if s['id'] == section['id'])
        fingerprint = narration.section_fingerprint(spoken_section, spoken_config)
        entry = next(e for e in ledger['entries'] if e['cache_key'] == fingerprint and e['status'] in ('generated-actual-pending', 'reconciled-actual-spend'))
        source = local(entry['output'])
        report = json.loads(subprocess.check_output([ffprobe, '-v', 'error', '-show_format', '-of', 'json', str(source)]))
        seconds = float(report['format']['duration'])
        start = float(section['start'])
        if start < previous_end or start + seconds > duration:
            raise ValueError('Narration must fit without overlap or truncation: ' + section['id'])
        previous_end = start + seconds
        command += ['-i', str(source)]
        filters.append('[%d:a]adelay=%d:all=1[a%d]' % (index, round(start * 1000), index))
        evidence.append({'id': section['id'], 'source': entry['output'], 'sha256': hashlib.sha256(source.read_bytes()).hexdigest(), 'start': start, 'duration': seconds, 'end': previous_end, 'speed': 1})
    filters.append(''.join('[a%d]' % i for i in range(len(evidence))) + 'amix=inputs=%d:normalize=0,apad,atrim=duration=%.3f[mix]' % (len(evidence), duration))
    raw = ROOT / 'work/tutorial-booking-aligned.raw.wav'
    raw.parent.mkdir(parents=True, exist_ok=True)
    invoke(command + ['-filter_complex', ';'.join(filters), '-map', '[mix]', '-ar', '48000', '-c:a', 'pcm_s16le', str(raw)])
    target = config['normalization']
    spec = 'loudnorm=I=%s:TP=%s:LRA=%s' % (target['integrated_lufs'], target['true_peak_dbtp'], target['loudness_range_lu'])
    log = invoke([ffmpeg, '-i', str(raw), '-af', spec + ':print_format=json', '-f', 'null', '-'])
    measurements = json.loads(re.findall(r'\{\s*"input_i".*?\}', log, re.S)[-1])
    spec += ':measured_I=%s:measured_TP=%s:measured_LRA=%s:measured_thresh=%s:offset=%s:linear=true' % (measurements['input_i'], measurements['input_tp'], measurements['input_lra'], measurements['input_thresh'], measurements['target_offset'])
    output = local(config['output'])
    output.parent.mkdir(parents=True, exist_ok=True)
    invoke([ffmpeg, '-y', '-i', str(raw), '-af', spec, '-ar', '48000', '-c:a', 'pcm_s16le', str(output)])
    timeline_path = local(config['timeline'])
    timeline = json.loads(timeline_path.read_text())
    for segment in timeline['narration']['segments']:
        measured = next(e for e in evidence if e['id'] == segment['section_id'])
        segment.update({'start': measured['start'], 'end': measured['end']})
    timeline['narration']['timing_status'] = 'Measured cached audio durations at natural speed; caption cues must be reviewed against spoken words.'
    timeline_path.write_text(json.dumps(timeline, indent=2) + '\n')
    result = {'duration': duration, 'sections': evidence, 'normalization': target, 'measured_before_normalization': measurements, 'output': config['output'], 'paid_calls': 0}
    qa = ROOT / 'qa/audio-alignment.json'
    qa.parent.mkdir(parents=True, exist_ok=True)
    qa.write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', default='timelines/tutorial-booking.audio.json')
    args = parser.parse_args()
    print(json.dumps(build(args.config), indent=2))
