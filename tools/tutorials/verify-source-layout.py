#!/usr/bin/env python3
"""Validate real capture provenance, fixed zoom, click mapping and text geometry."""
import hashlib,json
from pathlib import Path
R=Path(__file__).resolve().parents[2]/'docs/tutorials';out=[]
for x in json.loads((R/'library-queue.json').read_text()):
 if not x.get('video'):continue
 t=json.loads((R/x['captureTimeline']).read_text());e=json.loads((R/'verification'/f"{x['id']}-evidence.json").read_text());assert t['completed'] and e['completed'],x['id']
 identity=t.get('sourceIdentity');patch=identity.get('sourcePatchSha256') if identity else None
 if patch:
  p=R/'verification/source-patches'/f'{patch}.patch';assert p.exists() and hashlib.sha256(p.read_bytes()).hexdigest()==patch
 sources={t['raw']};sources.update(s['raw'] for s in t['steps'] if s.get('raw'))
 frames=0
 for raw in sources:
  stamps=json.loads((R/raw.replace('.mp4','-timestamps.json')).read_text());assert len(stamps['frames'])>=10
  assert all((f['width'],f['height'],f['scale'])==(390,844,1) for f in stamps['frames']),(x['id'],'unstable zoom/viewport')
  frames+=len(stamps['frames'])
 edits=json.loads((R/x['editTimeline']).read_text());layouts=json.loads((R/'assets/library'/x['id']/'text-layout-checks.json').read_text());assert len(edits)==len(t['steps'])==len(layouts)
 taps=0
 for s,l in zip(edits,layouts):
  assert l['fits'] and l['bounds'][1][2]<=950 and l['bounds'][2][2]<=850
  assert l['bounds'][2][0]-l['bounds'][1][1]>=24 and 479-l['bounds'][2][1]>=40
  assert len(s.get('clicks',[]))==len(s['synchronizedClicks'])
  for c in s['synchronizedClicks']:
   assert s['outputStart']<=c['actualClickTimeSeconds']<=s['outputEnd']
   assert 0<=c['x']<=390 and 0<=c['y']<=844
   taps+=1
 out.append({'id':x['id'],'sourcePatchSha256':patch,'compiledBuildId':identity.get('compiledBuildId') if identity else None,'sourceVerification':'compiled_build_and_patch' if identity else 'baseline_SHA_only_build_metadata_not_captured','rawFramesVerified':frames,'viewport':[390,844],'pageScaleFactor':1,'fixedPhoneScreen':[249,479,582,1259],'synchronizedTaps':taps,'instructionGeometry':'passed','captureAndSavedEvidence':'passed'})
(R/'verification/source-layout-checks.json').write_text(json.dumps(out,indent=2)+'\n');print(f'{len(out)} videos: fixed viewport/zoom, text geometry and real tap timing passed. Source verification scope is recorded per video.')
