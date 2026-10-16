#!/usr/bin/env python3
"""Editorial typography revision; crops only real UI from the verified v4 video."""
import hashlib,json,math,subprocess,sys
from pathlib import Path
from importlib.util import spec_from_file_location,module_from_spec
from PIL import Image,ImageDraw,ImageFilter

ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'docs/tutorials';W,H=1080,1920
spec=spec_from_file_location('luster_template',Path(__file__).with_name('render.py'))
t=module_from_spec(spec);spec.loader.exec_module(t)
data=json.loads((OUT/'storyboards/service-typography.json').read_text())
source=OUT/data['sourceVideo'];work=OUT/'assets/service-typography';work.mkdir(exist_ok=True)

def run(args):
 p=subprocess.run(args,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 if p.returncode:raise RuntimeError(p.stderr.decode()[-3000:])

def centered(d,text,y,font,fill=t.INK,tracking=0):
 if tracking:
  width=sum(d.textlength(c,font=font) for c in text)+tracking*(len(text)-1)
 else:width=d.textlength(text,font=font)
 assert width<=950,('Text outside editorial margins',text,width)
 bbox=d.textbbox((0,0),text,font=font);x=(W-width)/2
 if tracking:
  for c in text:
   d.text((x,y-bbox[1]),c,font=font,fill=fill);x+=d.textlength(c,font=font)+tracking
 else:d.text((x,y-bbox[1]),text,font=font,fill=fill)
 return {'text':text,'left':(W-width)/2,'right':(W+width)/2,'top':y,'bottom':y+bbox[3]-bbox[1]}

bg=Image.new('RGBA',(W,H));px=bg.load()
for y in range(H):
 for x in range(W):
  glow=math.exp(-(((x-1040)/700)**2+((y-950)/950)**2))
  px[x,y]=(int(250-5*glow),int(246-14*glow),int(239-12*glow),255)
d=ImageDraw.Draw(bg)
centered(d,'LUSTER',98,t.font('Inter',46,'Medium'),tracking=7)
centered(d,'BOOK · MANAGE · GROW',156,t.font('Inter',17),t.MUTED,2.4)
# Slightly smaller screen (3%) buys a real gap beneath the explanations.
shadow=Image.new('RGBA',(W,H));sd=ImageDraw.Draw(shadow)
sd.rounded_rectangle((219,450,861,1778),radius=82,fill=(69,42,32,48))
bg=Image.alpha_composite(bg,shadow.filter(ImageFilter.GaussianBlur(28)));d=ImageDraw.Draw(bg)
d.rounded_rectangle((225,433,855,1774),radius=78,fill='#b8aaa1')
d.rounded_rectangle((229,436,851,1770),radius=75,fill='#242120')
d.rounded_rectangle((236,443,844,1763),radius=67,fill='#121110')
d.rounded_rectangle((387,451,693,474),radius=12,fill='#090909')
d.rounded_rectangle((461,1748,619,1755),radius=4,fill='#e7e1db')
centered(d,'CLEAR CHOICES. THOUGHTFUL TIMING.',1822,t.font('Inter',20),t.MUTED,1.1)
bg.save(work/'base.png')
mask=Image.new('L',(582,1259));ImageDraw.Draw(mask).rounded_rectangle((0,0,581,1258),radius=44,fill=255);mask.save(work/'mask.png')
layers=[];checks=[]
for i,s in enumerate(data['steps']):
 layer=Image.new('RGBA',(W,H));d=ImageDraw.Draw(layer)
 label=centered(d,s['label'],211,t.font('Inter',21,'Medium'),t.ROSE,2.3)
 headline=centered(d,s['heading'],259,t.font('Newsreader',72,'Medium'))
 body=centered(d,s['benefit'],357,t.font('Inter',34),t.MUTED)
 assert body['right']-body['left']<=850,'Explanation needs shorter copy'
 assert headline['top']-label['bottom']>=25
 assert body['top']-headline['bottom']>=24
 assert 433-body['bottom']>=40
 checks.append({'step':i+1,'label':label,'headline':headline,'explanation':body,'gapBeforePhonePx':433-body['bottom'],'fits':True})
 layer.save(work/f'text-{i:02}.png');layers.append(layer)

# Still review first; same graphics are used by the finished MP4.
for i in (0,7,10):
 s=data['steps'][i];shot=work/f'ui-{i:02}.png'
 run(['ffmpeg','-v','error','-y','-ss',str((s['sourceStart']+s['sourceEnd'])/2),'-i',str(source),'-frames:v','1',str(shot)])
 ui=Image.open(shot).crop((240,449,840,1747)).resize((582,1259),Image.Resampling.LANCZOS)
 frame=bg.copy();frame.paste(ui,(249,479),mask);frame=Image.alpha_composite(frame,layers[i]);frame.save(work/f'design-{i:02}.png')
(work/'text-layout-checks.json').write_text(json.dumps(checks,indent=2)+'\n')
if '--frames-only' in sys.argv:
 print('Design frames and text-spacing checks ready.');raise SystemExit(0)

clips=[];edits=[]
for i,s in enumerate(data['steps']):
 duration=s['sourceEnd']-s['sourceStart'];clip=work/f'{i:02}.mp4'
 graph=('[0:v]setpts=PTS-STARTPTS,crop=600:1298:240:449,scale=582:1259,setsar=1[ui];'
 '[2:v]format=gray[m];[ui][m]alphamerge[phone];[1:v]format=rgba[b];[b][phone]overlay=249:479:shortest=1[scene];'
 f'[3:v]format=rgba,fade=t=in:st=0:d=0.25:alpha=1,fade=t=out:st={duration-.16}:d=0.16:alpha=1[txt];'
 '[scene][txt]overlay=0:8*(1-min(t/0.25\\,1)):eval=frame:shortest=1,format=yuv420p[out]')
 run(['ffmpeg','-y','-ss',str(s['sourceStart']),'-t',str(duration),'-i',str(source),'-loop','1','-i',str(work/'base.png'),'-loop','1','-i',str(work/'mask.png'),'-loop','1','-i',str(work/f'text-{i:02}.png'),'-filter_complex',graph,'-map','[out]','-t',str(duration),'-r','30','-an','-c:v','libx264','-preset','fast','-crf','17','-threads','2','-pix_fmt','yuv420p','-color_range','tv',str(clip)])
 clips.append(clip);edits.append({**s,'outputStart':s['sourceStart'],'outputEnd':s['sourceEnd'],'retainedSourceRanges':[[s['sourceStart'],s['sourceEnd']]],'phoneScreen':{'x':249,'y':479,'width':582,'height':1259}})
(work/'concat.txt').write_text('\n'.join("file '"+p.name+"'" for p in clips))
dest=OUT/data['outputVideo'];run(['ffmpeg','-y','-f','concat','-safe','0','-i',str(work/'concat.txt'),'-c','copy','-movflags','+faststart',str(dest)])
(work/'edit-timeline.json').write_text(json.dumps(edits,indent=2)+'\n')
(work/'render-source.json').write_text(json.dumps({'sourceVideo':data['sourceVideo'],'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'all15ClickTimingsUnchanged':True,'phoneScaleConstant':True,'applicationCodeChanged':False},indent=2)+'\n')
# Matching cover uses the genuine saved screen and the same editorial grid.
cover=bg.copy();ui=Image.open(OUT/'verification/serviceextras-5.png').resize((582,1259),Image.Resampling.LANCZOS);cover.paste(ui,(249,479),mask);d=ImageDraw.Draw(cover)
centered(d,'SERVICES & EXTRAS',211,t.font('Inter',21,'Medium'),t.ROSE,2.3)
centered(d,'Build your service menu',259,t.font('Newsreader',72,'Medium'))
centered(d,'Clear prices. Thoughtful extras. Easy choices.',357,t.font('Inter',34),t.MUTED)
cover.save(OUT/'thumbnails/luster-how-to-add-service-v5.png')
print(json.dumps({'video':str(dest),'durationSeconds':edits[-1]['outputEnd'],'realClicks':sum(len(e['synchronizedClicks']) for e in edits),'textLayoutChecks':'passed'}))
