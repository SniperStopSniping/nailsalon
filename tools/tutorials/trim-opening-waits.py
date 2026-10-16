#!/usr/bin/env python3
"""Remove actual opening-navigation waits while keeping every real tap and result."""
import json
from pathlib import Path
R=Path(__file__).resolve().parents[2]/'docs/tutorials';dest=R/'versions/before-opening-wait-trims';dest.mkdir(exist_ok=True);changed=[]
for x in json.loads((R/'library-queue.json').read_text()):
 if not x.get('video'):continue
 p=R/x['captureTimeline'];t=json.loads(p.read_text())
 if not t.get('completed'):raise RuntimeError('Restore verified capture before trimming: '+x['id'])
 s=t['steps'][0];clicks=s.get('clicks',[]);cuts=[]
 for i,c in enumerate(clicks):
  end=clicks[i+1]['t']-.18 if i+1<len(clicks) else s['end']-.8
  start=c['t']+.03
  if end-start>.25:cuts.append({'start':start,'end':end,'reason':'Opening-navigation wait removed. Both real tap events and the actual settled target/result remain.'})
 if cuts:
  before=dest/(x['id']+'.json')
  if not before.exists():before.write_text(p.read_text())
  s['cuts']=[c for c in s.get('cuts',[]) if c.get('reason')!='Opening-navigation wait removed. Both real tap events and the actual settled target/result remain.']+cuts
  p.write_text(json.dumps(t,indent=2)+'\n');changed.append(x['id'])
(R/'verification/opening-wait-trims.json').write_text(json.dumps({'ids':changed,'scope':'Editorial cuts of actual navigation waits only; no replacement UI, fake states or deleted taps.'},indent=2)+'\n');print(f'{len(changed)} opening scenes trimmed; all original timelines retained.')
