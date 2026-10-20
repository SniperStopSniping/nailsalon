#!/usr/bin/env python3
"""Verified raw UI -> spacious branded tutorial, with traceable real clicks."""
import json,math,subprocess,sys,hashlib
from pathlib import Path
from importlib.util import spec_from_file_location,module_from_spec
from PIL import Image,ImageDraw
from library_metadata import update_queue
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'docs/tutorials';kind=sys.argv[1]
spec=spec_from_file_location('brand',Path(__file__).with_name('render.py'));t=module_from_spec(spec);spec.loader.exec_module(t)
data=json.loads((OUT/f'recordings/{kind}-timeline.json').read_text());evidence=json.loads((OUT/f'verification/{kind}-evidence.json').read_text())
if not data.get('completed') or not evidence.get('completed'):raise RuntimeError('Workflow is not verified; refusing to render success')
queue=json.loads((OUT/'library-queue.json').read_text());item=next(q for q in queue if q['id']==kind);preview=kind in ('manual-appointment','online-booking','no-show','shared-alert','no-show-correction','staff-assignment','client-flags','deposit-setup','portfolio','no-show-review','booking-approval','booking-request')
work=OUT/'assets/library'/kind;work.mkdir(parents=True,exist_ok=True)
bg=Image.open(OUT/'assets/service-typography/base.png').convert('RGBA');mask=OUT/'assets/service-typography/mask.png'
message_setup=kind in ('reminders','rebooking-reminders','review-requests','owner-notifications','client-contact','guest-rebook','winback-settings','next-visit','review-preferences')
setup=message_setup or kind in ('smart-fit','deposit-setup','deposit-protection','google-calendar','sms-topups')
if preview:
 d=ImageDraw.Draw(bg);d.rounded_rectangle((820,92,1028,134),radius=14,fill='#eadbd1');d.text((838,105),'FEATURE PREVIEW',font=t.font('Inter',17,'Medium'),fill=t.ROSE)
elif setup:
 d=ImageDraw.Draw(bg);d.rounded_rectangle((820,92,1028,134),radius=14,fill='#eadbd1');d.text((850,105),'SETUP GUIDE',font=t.font('Inter',19,'Medium'),fill=t.ROSE)
if message_setup:
 d=ImageDraw.Draw(bg);label='SETUP DEMO · NO MESSAGES SENT';w=d.textlength(label,font=t.font('Inter',22,'Medium'));d.text(((1080-w)/2,176),label,font=t.font('Inter',22,'Medium'),fill=t.ROSE)
bg.save(work/'base.png');clips=[];edits=[];cursor=0;checks=[]
def run(args):
 p=subprocess.run(args,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 if p.returncode:raise RuntimeError(p.stderr.decode()[-3500:])
def center(d,text,y,f,fill=t.INK):
 width=d.textlength(text,font=f);box=d.textbbox((0,0),text,font=f)
 if width>950:raise RuntimeError('Shorten the headline: '+text)
 d.text(((1080-width)/2,y-box[1]),text,font=f,fill=fill)
 return [y,y+box[3]-box[1],width]
def explanation(d,text,headline_end=0):
 f=t.font('Inter',34);lines=['']
 for word in text.split():
  trial=(lines[-1]+' '+word).strip()
  if d.textlength(trial,font=f)>850:lines.append(word)
  else:lines[-1]=trial
 if len(lines)>2:raise RuntimeError('Shorten explanation: '+text)
 y=max(350 if len(lines)==2 else 357,headline_end+28);boxes=[center(d,line,y+n*44,f,t.MUTED) for n,line in enumerate(lines)]
 return [boxes[0][0],boxes[-1][1],max(b[2] for b in boxes)]
for i,s in enumerate(data['steps']):
 if 'end' not in s:raise RuntimeError('Incomplete captured step')
 raw=OUT/s.get('raw',data['raw']);start=s['start'];end=s['end'];
 if i==0 and s.get('clicks'):start=max(start,s['clicks'][0]['t']-.18)
 original=end-start
 cuts=sorted((max(start,c['start']),min(end,c['end'])) for c in s.get('cuts',[]) if c['end']>c['start']);ranges=[];p=start
 for a,b in cuts:
  if a>p+.04:ranges.append((p,a))
  p=max(p,b)
 if end>p+.04:ranges.append((p,end))
 kept=sum(b-a for a,b in ranges)
 if kept>13 or not ranges:raise RuntimeError('Review long/incomplete captured step '+s['heading'])
 duration=math.ceil(max(kept,4.2)*30)/30;speed=kept/duration
 layer=Image.new('RGBA',(1080,1920));d=ImageDraw.Draw(layer)
 label=center(d,f'LUSTER GUIDE  /  STEP {i+1:02}',211,t.font('Inter',21,'Medium'),t.ROSE)
 head=center(d,s['heading'],259,t.font('Newsreader',72,'Medium'))
 body=explanation(d,s.get('benefit',s.get('body')),head[1])
 if body[2]>850 or body[0]-head[1]<24 or 479-body[1]<40:raise RuntimeError('Revise explanation spacing: '+s['heading'])
 layer.save(work/f'text-{i:02}.png');checks.append({'heading':s['heading'],'benefit':s.get('benefit',s.get('body')),'bounds':[label,head,body],'fits':True})
 if len(ranges)==1:
  a,b=ranges[0];graph=f'[0:v]setpts=PTS-STARTPTS,trim=start={a-start}:end={b-start},setpts=PTS-STARTPTS[raw];'
 else:
  graph='[0:v]setpts=PTS-STARTPTS,split='+str(len(ranges))+''.join(f'[p{k}]' for k in range(len(ranges)))+';'
  for k,(a,b) in enumerate(ranges):graph+=f'[p{k}]trim=start={a-start}:end={b-start},setpts=PTS-STARTPTS[r{k}];'
  graph+=''.join(f'[r{k}]' for k in range(len(ranges)))+f'concat=n={len(ranges)}:v=1:a=0[raw];'
 graph+=f'[raw]setpts=(PTS-STARTPTS)/{speed:.9f},fps=30,crop=390:844:0:0,scale=582:1259,setsar=1[ui];[2:v]format=gray[m];[ui][m]alphamerge[phone];[1:v][phone]overlay=249:479:shortest=1[scene];'
 graph+=f'[3:v]format=rgba,fade=t=in:st=0:d=0.25:alpha=1,fade=t=out:st={duration-.16}:d=0.16:alpha=1[txt];[scene][txt]overlay=0:8*(1-min(t/.25\\,1)):eval=frame:shortest=1[textscene];'
 args=['ffmpeg','-y','-ss',str(start),'-t',str(original),'-i',str(raw),'-loop','1','-i',str(work/'base.png'),'-loop','1','-i',str(mask),'-loop','1','-i',str(work/f'text-{i:02}.png')];prev='textscene';mapped=[]
 for n,c in enumerate(s.get('clicks',[])):
  elapsed=0
  for a,b in ranges:
   if a<=c['t']<=b:local=(elapsed+c['t']-a)/speed;break
   elapsed+=b-a
  else:raise RuntimeError('Actual tap was cut out')
  x=249+c['x']*582/390;y=479+c['y']*1259/844;down=c['y']>750;left=x-(44 if down else 24);top=y-(79 if down else 7);before=top+(-70 if down else 70);a=max(0,local-.45);b=min(duration,local+.2)
  args+=['-loop','1','-i',str(OUT/'assets'/('hand-pointer-down.png' if down else 'hand-pointer-up.png'))]
  graph+=f'[{n+4}:v]format=rgba,fade=t=in:st={a}:d=0.08:alpha=1,fade=t=out:st={local+.05}:d=0.15:alpha=1[h{n}];[{prev}][h{n}]overlay=x={left}:y=\'{before}+({top-before})*min(max((t-{a})/.3,0),1)\':enable=\'between(t,{a},{b})\':shortest=1[c{n}];';prev=f'c{n}';mapped.append({'actualClickTimeSeconds':cursor+local,'x':c['x'],'y':c['y']})
 graph+=f'[{prev}]format=yuv420p[out]';clip=work/f'{i:02}.mp4';args+=['-filter_complex',graph,'-map','[out]','-t',str(duration),'-r','30','-an','-c:v','libx264','-preset','fast','-crf','18','-threads','2','-pix_fmt','yuv420p','-color_range','tv',str(clip)];run(args)
 edits.append({**s,'outputStart':cursor,'outputEnd':cursor+duration,'retainedSourceRanges':ranges,'playbackSpeed':speed,'synchronizedClicks':mapped});cursor+=duration;clips.append(clip)
if not 15<=cursor<=60:raise RuntimeError('Review pacing outside 15–60 seconds')
(work/'concat.txt').write_text('\n'.join("file '"+p.name+"'" for p in clips));slug='luster-how-to-'+kind;dest=OUT/'videos'/(slug+'.mp4');run(['ffmpeg','-y','-f','concat','-safe','0','-i',str(work/'concat.txt'),'-c','copy','-movflags','+faststart',str(dest)])
cover=bg.copy();screen=Image.open(OUT/f'verification/{kind}-{len(data["steps"])}.png').resize((582,1259),Image.Resampling.LANCZOS);cover.paste(screen,(249,479),Image.open(mask));d=ImageDraw.Draw(cover);center(d,'YOUR LUSTER GUIDE',211,t.font('Inter',21,'Medium'),t.ROSE);coverhead=center(d,data['steps'][0]['heading'],259,t.font('Newsreader',72,'Medium'));explanation(d,data['steps'][0].get('benefit'),coverhead[1]);cover.save(OUT/'thumbnails'/(slug+'.png'))
(work/'edit-timeline.json').write_text(json.dumps(edits,indent=2));(work/'text-layout-checks.json').write_text(json.dumps(checks,indent=2))
owned={'status':'rendered_pending_visual_and_decode_checks','exportVerification':'pending','visualVerification':'pending','video':str(dest.relative_to(OUT)),'thumbnail':'thumbnails/'+slug+'.png','durationSeconds':round(cursor,3),'featurePreview':preview,'sourceCommit':data['sourceCommit'],'editTimeline':str((work/'edit-timeline.json').relative_to(OUT)),'captureTimeline':f'recordings/{kind}-timeline.json','sha256':hashlib.sha256(dest.read_bytes()).hexdigest()};update_queue({kind:owned});print(json.dumps(owned))
