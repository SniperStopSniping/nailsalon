#!/usr/bin/env python3
"""Revise verified footage offline with readable action and benefit captions.

The phone and every actual click/hand annotation come from the reviewed v3
export. Only the editorial space is replaced; each scene is modestly slowed.
"""
import hashlib,json,math,subprocess
from pathlib import Path
from PIL import Image,ImageDraw
from importlib.util import spec_from_file_location,module_from_spec

ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'docs/tutorials'
spec=spec_from_file_location('luster_template',Path(__file__).with_name('render.py'))
template=module_from_spec(spec);spec.loader.exec_module(template)
data=json.loads((OUT/'storyboards/service-explained.json').read_text())
prior=json.loads((OUT/data['sourceEditTimeline']).read_text())
work=OUT/'assets/service-explained';work.mkdir(exist_ok=True)
source=OUT/data['sourceVideo'];data['sourceSha256']=hashlib.sha256(source.read_bytes()).hexdigest()
clips=[];cursor=0;checks=[];edits=[]

def run(args):
 result=subprocess.run(args,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 if result.returncode:raise RuntimeError(result.stderr.decode()[-3000:])

for i,s in enumerate(data['steps']):
 original=s['sourceEnd']-s['sourceStart'];duration=math.ceil(max(original,data['minimumStepSeconds'])*30)/30
 old=prior[i];removed=[]
 # Existing captured readyAt timestamps identify navigation/save loading waits.
 # Preserve the actual click and its first visible press, then the real result.
 if i in (0,1,3,5) and old.get('clicks') and old.get('readyAt'):
  def prior_time(t):
   kept=0
   for a,b in old['retainedSourceRanges']:
    if a<=t<=b:return old['outputStart']+(kept+t-a)/old['playbackSpeed']
    kept+=b-a
   raise RuntimeError('Captured time absent from prior edit')
  a=prior_time(old['clicks'][-1]['t'])+.07;b=prior_time(old['readyAt'])
  if b>a+.04:removed=[[a,b]]
 ranges=[[s['sourceStart'],s['sourceEnd']]] if not removed else [[s['sourceStart'],removed[0][0]],[removed[0][1],s['sourceEnd']]]
 kept=sum(b-a for a,b in ranges);speed=kept/duration
 top=template.base('Clearly booked.' if i==len(data['steps'])-1 else 'Your service menu').crop((0,0,1080,402)).convert('RGBA')
 top.save(work/f'top-{i:02}.png')
 text=Image.new('RGBA',(1080,402));d=ImageDraw.Draw(text)
 action=template.font('Inter',42,'Medium');benefit=template.font('Inter',34)
 assert d.textlength(s['heading'],font=action)<=950,'Action too wide'
 assert d.textlength(s['benefit'],font=benefit)<=950,'Benefit too wide'
 template.center(d,s['heading'],310,action,template.ROSE)
 template.center(d,s['benefit'],363,benefit,template.INK)
 text.save(work/f'text-{i:02}.png')
 # The footer is secondary branding, outside the essential instruction region.
 footer=Image.new('RGBA',(1080,135));pixels=footer.load()
 for fy in range(135):
  for fx in range(1080):
   glow=math.exp(-(((fx-1040)/700)**2+((fy+1785-950)/950)**2))
   pixels[fx,fy]=(int(250-5*glow),int(246-14*glow),int(239-12*glow),255)
 fd=ImageDraw.Draw(footer);template.center(fd,'CLEAR CHOICES. THOUGHTFUL TIMING.',27,template.font('Inter',24),template.MUTED)
 footer.save(work/'footer.png')
 clip=work/f'{i:02}.mp4'
 if len(ranges)==1:
  source_graph='[0:v]setpts=PTS-STARTPTS[vraw];'
 else:
  source_graph='[0:v]setpts=PTS-STARTPTS,split=2[p0][p1];'
  for k,(a,b) in enumerate(ranges):source_graph+=f'[p{k}]trim=start={a-s["sourceStart"]}:end={b-s["sourceStart"]},setpts=PTS-STARTPTS[r{k}];'
  source_graph+='[r0][r1]concat=n=2:v=1:a=0[vraw];'
 graph=(source_graph+f'[vraw]setpts=(PTS-STARTPTS)/{speed:.9f},fps=30,setsar=1[v];'
 '[v][1:v]overlay=0:0:shortest=1[s];[s][2:v]overlay=0:1785:shortest=1[f];'
 f'[3:v]format=rgba,fade=t=in:st=0:d=0.2:alpha=1,fade=t=out:st={duration-.12}:d=0.12:alpha=1[txt];'
 '[f][txt]overlay=0:6*(1-min(t/0.2\\,1)):eval=frame:shortest=1,format=yuv420p[out]')
 run(['ffmpeg','-y','-ss',str(s['sourceStart']),'-t',str(original),'-i',str(source),'-loop','1','-i',str(work/f'top-{i:02}.png'),'-loop','1','-i',str(work/'footer.png'),'-loop','1','-i',str(work/f'text-{i:02}.png'),'-filter_complex',graph,'-map','[out]','-t',str(duration),'-r','30','-an','-c:v','libx264','-preset','fast','-crf','17','-threads','2','-pix_fmt','yuv420p','-color_range','tv',str(clip)])
 mapped=[]
 for c in old.get('clicks',[]):
  kept=0
  for a,b in old['retainedSourceRanges']:
   if a<=c['t']<=b:
    v3=old['outputStart']+(kept+c['t']-a)/old['playbackSpeed'];break
   kept+=b-a
  else:raise RuntimeError('Real click missing from reviewed footage')
  kept=0
  for a,b in ranges:
   if a<=v3<=b:
    mapped.append({'actualClickTimeSeconds':cursor+(kept+v3-a)/speed,'x':c['x'],'y':c['y']});break
   kept+=b-a
  else:raise RuntimeError('Navigation edit removed an actual click')
 edits.append({**s,'outputStart':cursor,'outputEnd':cursor+duration,'playbackSpeed':speed,'synchronizedClicks':mapped,'retainedSourceRanges':ranges,'removedWaitSourceRanges':removed})
 checks.append({'step':i+1,'action':s['heading'],'benefit':s['benefit'],'durationSeconds':duration,'textFits':True})
 cursor+=duration;clips.append(clip)

(work/'concat.txt').write_text('\n'.join("file '"+p.name+"'" for p in clips))
dest=OUT/data['outputVideo']
run(['ffmpeg','-y','-f','concat','-safe','0','-i',str(work/'concat.txt'),'-c','copy','-movflags','+faststart',str(dest)])
(work/'edit-timeline.json').write_text(json.dumps(edits,indent=2)+'\n')
(work/'text-layout-checks.json').write_text(json.dumps(checks,indent=2)+'\n')
# A matching cover keeps the authentic saved add-on screen visible.
cover=template.base('Your services. Your extras.')
# Fit the longer cover headline within the existing editorial region.
top=template.base('Your service menu').crop((0,0,1080,402));d=ImageDraw.Draw(top)
template.center(d,'A clearer booking menu',310,template.font('Inter',42,'Medium'),template.ROSE)
template.center(d,'Services, prices and extras — all together.',363,template.font('Inter',34),template.INK)
cover.paste(top,(0,0))
screen=Image.open(OUT/'verification/serviceextras-5.png').convert('RGB').resize((600,1298),Image.Resampling.LANCZOS)
mask=Image.open(OUT/'assets/service/mask.png');cover.paste(screen,(240,449),mask);cover.paste(footer,(0,1785))
cover.save(OUT/'thumbnails/luster-how-to-add-service-v4.png')
print(json.dumps({'video':str(dest),'durationSeconds':cursor,'steps':len(edits),'realClicks':sum(len(e['synchronizedClicks']) for e in edits)}))
