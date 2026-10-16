#!/usr/bin/env python3
"""Keep the hand visible above the no-show modal, using its real click timestamp."""
import json,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[2]/'docs/tutorials'
path=root/'assets/noshow/edit-timeline.json';steps=json.loads(path.read_text());s=next(x for x in steps if x['heading'].startswith('06'))
if s.get('confirmationCursorOverlay'):
 print('Confirmation cursor already applied.');raise SystemExit(0)
c=s['clicks'][0];kept=0
for a,b in s['retainedSourceRanges']:
 if a<=c['t']<=b:
  t=s['outputStart']+(kept+c['t']-a)/s['playbackSpeed'];break
 kept+=b-a
else:raise RuntimeError('The confirmed click is absent from the edit')
start=t-.5;end=t+.1;top=449+c['y']*600/390-79;left=240+c['x']*600/390-44;before=top-180
source=root/'videos/luster-how-to-mark-no-show-v2.mp4';out=source.with_name('noshow-cursor-final.mp4')
graph=f"[1:v]format=rgba,fade=t=in:st={start}:d=0.08:alpha=1,fade=t=out:st={t+.025}:d=0.075:alpha=1[h];[0:v][h]overlay=x={left}:y='{before}+({top-before})*min(max((t-{start})/0.3,0),1)':enable='between(t,{start},{end})':shortest=1,format=yuv420p[v]"
subprocess.run(['ffmpeg','-v','error','-y','-i',str(source),'-loop','1','-i',str(root/'assets/hand-pointer-down.png'),'-filter_complex',graph,'-map','[v]','-r','30','-c:v','libx264','-preset','fast','-crf','18','-threads','2','-pix_fmt','yuv420p','-color_range','tv','-movflags','+faststart',str(out)],check=True)
out.replace(source);s['confirmationCursorOverlay']={'actualClickTimeSeconds':t,'start':start,'end':end,'reason':'Keep the hand clearly visible above the expanded confirmation dialog'};path.write_text(json.dumps(steps,indent=2))
