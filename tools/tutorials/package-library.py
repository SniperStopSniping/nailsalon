#!/usr/bin/env python3
"""Package only verified current exports and reusable recipes, without private state."""
import hashlib,json,zipfile
from pathlib import Path
R=Path(__file__).resolve().parents[2];D=R/'docs/tutorials';m=json.loads((D/'manifest.json').read_text());items=m['tutorials'];checks={x['id']:x for x in json.loads((D/'verification/library-export-checks.json').read_text())};layouts={x['id']:x for x in json.loads((D/'verification/source-layout-checks.json').read_text())};dest=D/'Luster-Mobile-Tutorial-Library-Review.zip';paths=set()
for name in ['README.md','index.html','manifest.json','inventory.md','VERIFICATION.md','POSTING_ORDER.md','UX_IMPROVEMENTS.md','CHANGED_FILES.md']:
 paths.add(D/name)
for x in items:
 assert x['exportVerification']=='passed' and x['visualVerification']=='passed_sampled_review',x['id']
 assert checks[x['id']]['sha256']==x['sha256']
 for k in ['video','thumbnail','storyboard']:paths.add(D/x[k])
 paths.add(D/x['captureTimeline']);paths.add(D/x['editTimeline'])
paths.update((D/'assets/fonts').glob('*'));paths.update([D/'assets/service-typography/base.png',D/'assets/service-typography/mask.png',D/'assets/hand-pointer-up.png',D/'assets/hand-pointer-down.png'])
paths.update((D/'verification/source-patches').glob('*.patch'))
for name in ['library-export-checks.json','source-layout-checks.json','gallery-checks.json','visual-review-method.json','rehearsal-report-correction.json']:
 paths.add(D/'verification'/name)
# Include source recipes, not raw footage, provider environments, Clerk sessions or debug dumps.
paths.update(p for p in (R/'tools/tutorials').rglob('*') if p.suffix in ['.py','.mjs','.ts'] and '__pycache__' not in str(p) and p.name not in ['restore-verified-review.mjs','verify-review-capture.mjs','verify-guest-capture.mjs'])
with zipfile.ZipFile(dest,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 z.writestr('START_HERE.html','<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=docs/tutorials/index.html"><title>Luster Tutorial Library</title><a href="docs/tutorials/index.html">Open the Luster tutorial review library</a>')
 z.writestr('README.txt',f'LUSTER MOBILE TUTORIAL LIBRARY\n\n{len(items)} verified MP4 tutorials and matching covers.\nOpen START_HERE.html, or docs/tutorials/index.html.\nAll media/fonts are included for offline review. Raw footage and private auth/provider state are excluded.\nFeature Preview and setup limitations remain visible. Nothing is published.\nRecipes require the actual Luster checkout and a new guarded synthetic fixture; this package is not the application.\n')
 for p in sorted(paths):
  if not p.is_file():raise RuntimeError('Package file missing: '+str(p))
  z.write(p,p.relative_to(R).as_posix())
 for x in items:
  evidence=json.loads((D/'verification'/f"{x['id']}-evidence.json").read_text());saved=evidence.get('saved',{})
  safe_saved={k:saved[k] for k in ['id','status','startTime','price'] if isinstance(saved,dict) and k in saved}
  summary={'id':x['id'],'completed':evidence['completed'],'scope':x['scope'],'sourceIdentity':x['sourceIdentity'],'packagedSummary':True,'fullEvidence':'Full synthetic read-back evidence is retained in the original workspace.','savedOutcome':safe_saved,'exportChecks':checks[x['id']],'sourceLayoutChecks':layouts[x['id']]}
  z.writestr('docs/tutorials/verification/'+x['id']+'-evidence.json',json.dumps(summary,indent=2)+'\n')
with zipfile.ZipFile(dest) as z:
 assert z.testzip() is None
 for x in items:
  for key in ['video','thumbnail','storyboard']:assert 'docs/tutorials/'+x[key] in z.namelist()
  assert hashlib.sha256(z.read('docs/tutorials/'+x['video'])).hexdigest()==x['sha256']
 assert not any(n.endswith(('.env','owner-state.json','clerk-user.json')) or '.env.' in n for n in z.namelist())
report={'videos':len(items),'covers':len(items),'archiveIntegrity':'passed','videoHashes':'passed','privateRuntimeFiles':'excluded','bytes':dest.stat().st_size,'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()};(D/'verification/package-checks.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
