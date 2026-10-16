#!/usr/bin/env python3
"""Offline premium vertical compositor. Input: real browser recording + timed steps."""
import json, subprocess,sys, math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter
ROOT=Path(__file__).resolve().parents[2]; OUT=ROOT/'docs/tutorials'; W,H=1080,1920
INK='#302421';MUTED='#7d6962';ROSE='#9d5568';CREAM='#f7f1e8'
FONT=OUT/'assets/fonts'
def font(name,size,weight=None):
 f=ImageFont.truetype(str(FONT/(name+'.ttf')),size)
 if weight:
  try:f.set_variation_by_name(weight)
  except:pass
 return f
def center(draw,text,y,f,fill=INK):
 box=draw.textbbox((0,0),text,font=f);draw.text(((W-(box[2]-box[0]))/2,y),text,font=f,fill=fill)
def wrap(text,f,width):
 d=ImageDraw.Draw(Image.new('RGB',(1,1)));lines=[];line=''
 for word in text.split():
  candidate=(line+' '+word).strip()
  if d.textlength(candidate,font=f)>width and line:lines.append(line);line=word
  else:line=candidate
 if line:lines.append(line)
 return lines
def base(title,preview=False):
 im=Image.new('RGB',(W,H));pix=im.load()
 for y in range(H):
  for x in range(W):
   glow=math.exp(-(((x-1040)/700)**2+((y-950)/950)**2))
   pix[x,y]=(int(250-5*glow),int(246-14*glow),int(239-12*glow))
 d=ImageDraw.Draw(im);center(d,'LUSTER',88,font('Inter',48,'Medium'));center(d,'BOOK  ·  MANAGE  ·  GROW',153,font('Inter',18),MUTED)
 center(d,title,195,font('Newsreader',79,'Regular'))
 d.line((490,296,590,296),fill='#c6a597',width=2)
 if preview:
  d.rounded_rectangle((814,90,1018,145),radius=17,fill='#eadbd1');d.text((834,107),'FEATURE PREVIEW',font=font('Inter',17,'Medium'),fill=ROSE)
  d.rounded_rectangle((372,1790,708,1844),radius=27,fill='#eadbd1');center(d,'FEATURE PREVIEW',1805,font('Inter',30,'Medium'),ROSE)
 else:center(d,'YOUR WORK. YOUR BOOKING PAGE. YOUR BUSINESS.',1810,font('Inter',22),MUTED)
 # Realistic, asset-free graphite device; no Apple logo or licensed mockup.
 shadow=Image.new('RGBA',(W,H));sd=ImageDraw.Draw(shadow);sd.rounded_rectangle((210,423,870,1790),radius=84,fill=(69,42,32,57));shadow=shadow.filter(ImageFilter.GaussianBlur(30));im=Image.alpha_composite(im.convert('RGBA'),shadow)
 d=ImageDraw.Draw(im);d.rounded_rectangle((215,402,865,1784),radius=80,fill='#b8aaa1');d.rounded_rectangle((219,405,861,1780),radius=77,fill='#242120');d.rounded_rectangle((226,412,854,1773),radius=69,fill='#121110')
 # active recording window: 600 x 1298, plus top/bottom device bands
 d.rounded_rectangle((382,421,698,445),radius=12,fill='#090909');d.rounded_rectangle((459,1757,621,1764),radius=4,fill='#e7e1db')
 return im
CONFIG={
 'customize':('Your booking page','Make your booking page feel like your salon.','luster-how-to-customize-booking-page-v2'),
 'service':('Your service menu','Offer the right extras with every service.','luster-how-to-add-service-v3'),
 'noshow':('No-show protection','Record confirmed nonattendance with confidence.','luster-how-to-mark-no-show-v2')}
def run(args):subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
def render(kind):
 title,benefit,slug=CONFIG[kind]; data=json.loads((OUT/f'recordings/{kind}-timeline.json').read_text());steps=data['steps'];raw=data['raw'];work=OUT/'assets'/kind;work.mkdir(parents=True,exist_ok=True)
 bg=base(title,kind=='noshow');bg.save(work/'base.png')
 clips=[];edits=[];cursor=0
 # Rounded clipping mask for the authentic screen, 600x1298.
 mask=Image.new('L',(600,1298));ImageDraw.Draw(mask).rounded_rectangle((0,0,599,1297),radius=45,fill=255);mask.save(work/'mask.png')
 for i,step in enumerate(steps):
  if 'end' not in step:raise RuntimeError('Incomplete recording; refusing to render')
  raw=Path(step.get('raw',data['raw']));raw=raw if raw.is_absolute() else OUT/raw;start=step['start'];duration=step['end']-start
  # Keep real actions/results, omitting only recorder-identified waiting intervals.
  original=step['end']-start
  cuts=sorted((max(0,c['start']-start),min(original,c['end']-start)) for c in step.get('cuts',[]) if c['end']>c['start'])
  ranges=[];position=0
  for a,b in cuts:
   if a>position+.04:ranges.append((position,a))
   position=max(position,b)
  if original>position+.04:ranges.append((position,original))
  if not ranges:raise RuntimeError('Edit removed the entire step')
  kept=sum(b-a for a,b in ranges)
  if kept>14:raise RuntimeError(f'Step {i+1} still contains a long wait; review its timing')
  duration=math.ceil(max(kept,3.2)*30)/30;speed=kept/duration
  if len(ranges)==1:
   a,b=ranges[0];source=f'[0:v]setpts=PTS-STARTPTS,trim=start={a}:end={b},setpts=PTS-STARTPTS[vraw];'
  else:
   source='[0:v]setpts=PTS-STARTPTS,split='+str(len(ranges))+''.join(f'[part{k}]' for k in range(len(ranges)))+';'
   for k,(a,b) in enumerate(ranges):source+=f'[part{k}]trim=start={a}:end={b},setpts=PTS-STARTPTS[kept{k}];'
   source+=''.join(f'[kept{k}]' for k in range(len(ranges)))+f'concat=n={len(ranges)}:v=1:a=0[vraw];'
  text=Image.new('RGBA',(W,H));d=ImageDraw.Draw(text)
  center(d,step['heading'],310,font('Inter',42,'Medium'),ROSE)
  for n,line in enumerate(wrap(step['body'],font('Inter',34),930)):center(d,line,359+n*38,font('Inter',34),MUTED)
  text.save(work/f'text-{i}.png');clip=work/f'{i:02}.mp4'
  graph=(source+f'[vraw]setpts=(PTS-STARTPTS)/{speed:.6f},fps=30,crop=390:844:0:0,scale=600:1298,setsar=1[v];'
   '[2:v]format=gray[m];[v][m]alphamerge[phone];'
   '[1:v]format=rgba[b];[b][phone]overlay=240:449:shortest=1[scene];'
   f'[3:v]format=rgba,fade=t=in:st=0:d=0.18:alpha=1,fade=t=out:st={duration-.12}:d=0.12:alpha=1[txt];[scene][txt]overlay=0:8*(1-min(t/0.2\,1)):eval=frame:shortest=1,format=yuv420p[out]')
  run(['ffmpeg','-y','-ss',str(start),'-t',str(step['end']-start),'-i',raw,'-loop','1','-i',str(work/'base.png'),'-loop','1','-i',str(work/'mask.png'),'-loop','1','-i',str(work/f'text-{i}.png'),'-filter_complex',graph,'-map','[out]','-t',str(duration),'-r','30','-an','-c:v','libx264','-preset','fast','-crf','18','-threads','2',str(clip)])
  clips.append(clip);edits.append({**step,'outputStart':cursor,'outputEnd':cursor+duration,'playbackSpeed':speed,'retainedSourceRanges':[[start+a,start+b] for a,b in ranges]});cursor+=duration
 (work/'concat.txt').write_text('\n'.join("file '"+p.name+"'" for p in clips))
 dest=OUT/'videos'/(slug+'.mp4');run(['ffmpeg','-y','-f','concat','-safe','0','-i',str(work/'concat.txt'),'-vf','scale=in_range=pc:out_range=tv,format=yuv420p,fps=30','-r','30','-c:v','libx264','-preset','fast','-crf','18','-threads','2','-pix_fmt','yuv420p','-color_range','tv','-movflags','+faststart',str(dest)])
 # Matching cover uses a real finished UI frame, not a fabricated app screen.
 cover=base(title,kind=='noshow');d=ImageDraw.Draw(cover);center(d,'YOUR STEP-BY-STEP GUIDE',330,font('Inter',27,'Medium'),ROSE)
 screenshot=Image.open(OUT/data.get('coverScreenshot',f'verification/{kind}-{len(steps)}.png')).convert('RGB').resize((600,1298),Image.Resampling.LANCZOS);cover.paste(screenshot,(240,449),mask);cover.save(OUT/'thumbnails'/(slug+'.png'))
 (work/'edit-timeline.json').write_text(json.dumps(edits,indent=2));print(json.dumps({'kind':kind,'file':str(dest),'duration':round(cursor,2)}),flush=True)
if __name__=='__main__':
 try:render(sys.argv[1])
 except subprocess.CalledProcessError as e:print(e.stderr.decode()[-3000:]);raise
