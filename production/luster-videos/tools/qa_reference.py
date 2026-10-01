#!/usr/bin/env python3
"""Technical checks for the local reference exports; never creative approval."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import struct
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def mp4_atoms(path: Path) -> list[str]:
    result = []
    with path.open('rb') as stream:
        while header := stream.read(8):
            size, kind = struct.unpack('>I4s', header)
            header_size = 8
            if size == 1:
                size = struct.unpack('>Q', stream.read(8))[0]
                header_size = 16
            result.append(kind.decode('ascii'))
            if size == 0:
                break
            if size < header_size:
                raise ValueError('Invalid MP4 atom length.')
            stream.seek(size - header_size, 1)
    return result


def main() -> dict:
    ffmpeg = os.environ.get('VIDEO_FFMPEG') or shutil.which('ffmpeg')
    ffprobe = os.environ.get('VIDEO_FFPROBE') or shutil.which('ffprobe')
    if not ffmpeg or not ffprobe:
        raise ValueError('FFmpeg and FFprobe required.')
    report = {'creative_approval': 'pending user', 'checks': {}, 'paid_calls': 0}
    audio_hashes = []
    for variant in ('clean', 'captioned'):
        path = ROOT / 'exports' / ('tutorial-booking.' + variant + '.mp4')
        media = json.loads(subprocess.check_output([ffprobe, '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)]))
        subprocess.run([ffmpeg, '-v', 'error', '-i', str(path), '-f', 'null', '-'], check=True, capture_output=True)
        atoms = mp4_atoms(path)
        if atoms.index('moov') > atoms.index('mdat'):
            raise ValueError('Fast-start metadata missing.')
        video = next(s for s in media['streams'] if s['codec_type'] == 'video')
        if video['r_frame_rate'] != '30/1' or video['avg_frame_rate'] != '30/1' or int(video['nb_frames']) != 1983:
            raise ValueError('Expected exactly 1983 frames at constant 30 fps.')
        audio_hash = subprocess.check_output([ffmpeg, '-v', 'error', '-i', str(path), '-map', '0:a:0', '-c', 'copy', '-f', 'hash', '-hash', 'sha256', '-'], text=True).strip()
        audio_hashes.append(audio_hash)
        detect = subprocess.run([ffmpeg, '-i', str(path), '-vf', 'blackdetect=d=0.1:pix_th=0.10', '-an', '-f', 'null', '-'], check=True, capture_output=True, text=True).stderr
        if re.search(r'black_start:', detect):
            raise ValueError('Unintended whole-frame black detected.')
        levels = subprocess.run([ffmpeg, '-i', str(path), '-af', 'loudnorm=I=-18:TP=-1.5:LRA=7:print_format=json', '-vn', '-f', 'null', '-'], check=True, capture_output=True, text=True).stderr
        measurement = json.loads(re.findall(r'\{\s*"input_i".*?\}', levels, re.S)[-1])
        if float(measurement['input_tp']) >= 0:
            raise ValueError('Audio clipping/true-peak headroom failed.')
        report['checks'][variant] = {'full_decode': 'passed', 'fast_start': True, 'constant_fps': 30, 'frames': int(video['nb_frames']), 'duration': float(media['format']['duration']), 'whole_frame_black': False, 'integrated_lufs': float(measurement['input_i']), 'true_peak_dbtp': float(measurement['input_tp']), 'audio_sha256': audio_hash, 'file_sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    if audio_hashes[0] != audio_hashes[1]:
        raise ValueError('Clean and captioned audio differ.')
    report['identical_audio_pair'] = True
    output = ROOT / 'qa/reference-technical.json'
    output.write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    print(json.dumps(main(), indent=2))
