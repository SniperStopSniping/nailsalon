#!/usr/bin/env python3
"""Annotations over native top-layer picker, locked to real recorded clicks."""
import json,subprocess
from pathlib import Path
r=Path(__file__).resolve().parents[2]/'docs/tutorials';p=r/'assets/service/edit-timeline.json';steps=json.loads(p.read_text())
if any(s.get('modalClickOverlays') for s in steps):raise SystemExit('Already annotated')
clicks=[]
for s in steps:
 if not s['heading'].startswith(('08','09','10')):continue
 for c in s.get('clicks',[]):
  kept=0
  for a,b in s['retainedSourceRanges']:
   if a<=c['t']<=b:
    t=s['outputStart']+(kept+c['t']-a)/s['playbackSpeed'];break
   kept+=b-a
  else:raise RuntimeError('Actual click missing from retained footage')
  clicks.append((t,c['x'],c['y']));s.setdefault('modalClickOverlays',[]).append({'actualClickTimeSeconds':t,'x':c['x'],'y':c['y']})
source=r/'videos/luster-how-to-add-service-v3.mp4';out=source.with_name('service-cursor-final.mp4');args=['ffmpeg','-v','error','-y','-i',str(source)];graph='';prev='0:v'
for i,(t,x,y) in enumerate(clicks):
 down=y>750;asset=r/'assets'/('hand-pointer-down.png' if down else 'hand-pointer-up.png');args+=['-loop','1','-i',str(asset)]
 start=t-.48;end=t+.14;left=240+x*600/390-(44 if down else 24);top=449+y*600/390-(79 if down else 7);before=top+(-85 if down else 85)
 graph+=f"[{i+1}:v]format=rgba,fade=t=in:st={start}:d=0.07:alpha=1,fade=t=out:st={t+.04}:d=0.1:alpha=1[h{i}];[{prev}][h{i}]overlay=x={left}:y='{before}+({top-before})*min(max((t-{start})/0.3,0),1)':enable='between(t,{start},{end})':shortest=1[v{i}];";prev=f'v{i}'
graph+=f'[{prev}]format=yuv420p[v]';args+=['-filter_complex',graph,'-map','[v]','-r','30','-c:v','libx264','-preset','fast','-crf','18','-threads','2','-pix_fmt','yuv420p','-color_range','tv','-movflags','+faststart',str(out)]
subprocess.run(args,check=True);out.replace(source);p.write_text(json.dumps(steps,indent=2));print('Annotated',len(clicks),'real modal clicks')
