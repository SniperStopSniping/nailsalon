#!/usr/bin/env python3
import json, subprocess,hashlib,sys
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
root=Path(__file__).resolve().parents[2]/'docs/tutorials';target=sys.argv[1] if len(sys.argv)>1 else None;results=[]
if target and (root/'verification/export-checks.json').exists():
 results=[r for r in json.loads((root/'verification/export-checks.json').read_text()) if target not in r['visualContactSheet']]
for file in sorted((root/'videos').glob('*-v[2345].mp4')):
 if 'add-service-' in file.name:
  latest=max(n for n in (2,3,4,5) if (root/f'videos/luster-how-to-add-service-v{n}.mp4').exists())
  if not file.name.endswith(f'-v{latest}.mp4'):continue
 if target and target not in ('customize' if 'customize' in file.name else 'noshow' if 'no-show' in file.name else 'service'):continue
 meta=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(file)]));v=next(x for x in meta['streams'] if x['codec_type']=='video');duration=float(meta['format']['duration'])
 assert v['avg_frame_rate']=='30/1', (file,v['avg_frame_rate'])
 assert (v['width'],v['height'],v['r_frame_rate'],v['pix_fmt'])==(1080,1920,'30/1','yuv420p'),(file,v)
 assert 15<=duration<=60,(file,duration)
 subprocess.run(['ffmpeg','-v','error','-i',str(file),'-f','null','-'],check=True)
 thumb=root/'thumbnails'/(file.stem+'.png');assert Image.open(thumb).size==(1080,1920)
 kind='customize' if 'customize' in file.name else 'noshow' if 'no-show' in file.name else 'service'
 edit_kind='service-typography' if 'add-service-v5' in file.name else 'service-explained' if 'add-service-v4' in file.name else kind
 edits=json.loads((root/'assets'/edit_kind/'edit-timeline.json').read_text());times={0.2,duration/2,duration-.2}
 # Visual evidence includes both sides of each cut and the step's action/result range.
 for e in edits:
  if e.get('confirmationCursorOverlay'):times.add(e['confirmationCursorOverlay']['actualClickTimeSeconds'])
  for click in e.get('synchronizedClicks',[]):times.add(max(.01,click['actualClickTimeSeconds']-.05))
  times.update([max(.01,e['outputStart']+.1),(e['outputStart']+e['outputEnd'])/2,max(.01,e['outputEnd']-.1)])
 frames=[]
 for i,t in enumerate(sorted(times)):
  path=root/'verification'/f'{kind}-frame-{i:02}.jpg';subprocess.run(['ffmpeg','-v','error','-y','-ss',str(t),'-i',str(file),'-frames:v','1','-update','1',str(path)],check=True)
  frames.append((t,path))
 cols=5;tw,th=216,384;sheet=Image.new('RGB',(cols*tw,((len(frames)+cols-1)//cols)*(th+26)),'#eee5da');d=ImageDraw.Draw(sheet)
 for i,(t,p) in enumerate(frames):
  x=(i%cols)*tw;y=(i//cols)*(th+26);sheet.paste(Image.open(p).resize((tw,th)),(x,y));d.text((x+5,y+th+5),f'{t:.2f}s',fill='#302421')
 sheet.save(root/'verification'/f'{kind}-contact-sheet.jpg')
 results.append({'file':str(file.relative_to(root)),'width':v['width'],'height':v['height'],'fps':v['r_frame_rate'],'durationSeconds':duration,'codec':v['codec_name'],'pixelFormat':v['pix_fmt'],'fullDecode':'passed','thumbnail':'passed','sha256':hashlib.sha256(file.read_bytes()).hexdigest(),'sampledFrames':len(frames),'visualContactSheet':f'verification/{kind}-contact-sheet.jpg'})
(root/'verification'/'export-checks.json').write_text(json.dumps(results,indent=2));print(json.dumps(results,indent=2))
