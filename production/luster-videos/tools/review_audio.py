#!/usr/bin/env python3
"""Explicit, cached audio QA; offline plan by default and never automatic retry."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import shutil
import subprocess
import urllib.error
import urllib.request
from datetime import date, datetime, timezone

import narration

MODEL = 'gpt-audio'
PROMPT = ('Listen to the entire attached tutorial narration. Return a verbatim transcript, '
          'then assess intelligibility, naturalness, pronunciation of BIAB as B I A B, '
          'calm conversational tone, pauses, changes in voice between sections, audible '
          'clicks/distortion/clipping, and whether the ending is complete. Identify specific '
          'problems with approximate timestamps. Do not assume quality from the script. '
          'This is AI narration with deliberate silent spaces for visible actions. '
          'Do not claim to review the video or app; you receive audio only.')


def review(generate: bool) -> dict:
    source = narration.ROOT / 'narration/tutorial-booking-aligned.wav'
    audio = source.read_bytes()
    if len(audio) > 8_000_000:
        raise narration.NarrationError('Audio QA input exceeds the bounded size.')
    ffprobe = os.environ.get('VIDEO_FFPROBE') or shutil.which('ffprobe')
    if not ffprobe:
        raise narration.NarrationError('FFprobe is required for bounded audio review.')
    measured = json.loads(subprocess.check_output([ffprobe, '-v', 'error', '-show_format', '-of', 'json', str(source)]))
    if float(measured['format']['duration']) > 75:
        raise narration.NarrationError('Audio QA input exceeds 75 seconds.')
    fingerprint = hashlib.sha256(audio + MODEL.encode() + PROMPT.encode()).hexdigest()
    output = narration.ROOT / 'qa' / ('audio-listening-' + fingerprint[:16] + '.json')
    if output.exists():
        return json.loads(output.read_text())
    if not generate:
        return {'mode': 'offline-plan', 'model': MODEL, 'reservation_cad': 1, 'paid_calls': 0}
    costs = narration.load_generation_cost_manifest()
    try:
        pricing_age = (datetime.now(timezone.utc).date() - date.fromisoformat(costs['manifest']['audioReviewPricingChecked'])).days
    except (KeyError, TypeError, ValueError):
        pricing_age = -1
    if not 0 <= pricing_age <= narration.PRICING_MAX_AGE_DAYS or costs['manifest'].get('audioReviewPricingSource') != 'https://developers.openai.com/api/docs/models/gpt-audio':
        raise narration.NarrationError('Audio review official pricing must be recorded before generation.')
    key = narration.enforce_generation_prerequisites()
    with narration.exclusive_ledger_lock():
        ledger = narration.load_ledger(narration.LEDGER_PATH)
        if any(e.get('cache_key') == fingerprint for e in ledger['entries']):
            raise narration.NarrationError('Prior audio QA attempt exists; no automatic retry.')
        if narration.committed_ledger_cents(ledger) + costs['external_cad_cents'] + 100 + narration.RETRY_HEADROOM_CAD_CENTS > narration.CAP_CAD_CENTS:
            raise narration.NarrationError('Audio QA reservation would exceed the package cap.')
        entry = {'cache_key': fingerprint, 'section_id': 'audio-quality-review', 'status': 'reserved', 'reserved_cad_cents': 100, 'estimated_cad_cents': 35, 'actual_cad_cents': None, 'note': 'Bounded audio QA, text output only, maximum 1200 output tokens; invoice pending.'}
        ledger['entries'].append(entry)
        narration.atomic_json(narration.LEDGER_PATH, ledger)
        payload = {'model': MODEL, 'modalities': ['text'], 'max_completion_tokens': 1200, 'messages': [{'role': 'user', 'content': [{'type': 'text', 'text': PROMPT}, {'type': 'input_audio', 'input_audio': {'data': base64.b64encode(audio).decode(), 'format': 'wav'}}]}]}
        req = urllib.request.Request('https://api.openai.com/v1/chat/completions', data=json.dumps(payload).encode(), headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'}, method='POST')
        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                result = json.load(response)
            report = {'model': MODEL, 'audio_sha256': hashlib.sha256(audio).hexdigest(), 'review': result['choices'][0]['message']['content'], 'usage': result.get('usage'), 'acceptance': 'Automated audio listening review; human creative approval is still pending.'}
            narration.atomic_json(output, report)
        except Exception:
            entry['status'] = 'attempted-unknown'
            narration.atomic_json(narration.LEDGER_PATH, ledger)
            raise narration.NarrationError('Audio QA request failed; no retry and no credentials displayed.') from None
        entry.update({'status': 'generated-actual-pending', 'output': str(output.relative_to(narration.ROOT))})
        narration.atomic_json(narration.LEDGER_PATH, ledger)
        return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review', action='store_true')
    print(json.dumps(review(parser.parse_args().review), indent=2))
