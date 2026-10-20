"""Keep independent video jobs from overwriting another tutorial's metadata."""
import fcntl
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / 'docs/tutorials'

def update_queue(updates):
    with (ROOT / 'assets/library-metadata.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        path = ROOT / 'library-queue.json'
        queue = json.loads(path.read_text())
        for item in queue:
            if item['id'] in updates:
                item.update(updates[item['id']])
        path.write_text(json.dumps(queue, indent=2) + '\n')
