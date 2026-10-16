#!/usr/bin/env python3
"""Three actual exported frames per tutorial, grouped for visual review."""
import json,subprocess
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
R=Path(__file__).resolve().parents[2]/'docs/tutorials';q=sorted((x for x in json.loads((R/'library-queue.json').read_text()) if x.get('video')),key=lambda x:x['rank']);dest=R/'verification/review-sheets';dest.mkdir(exist_ok=True);font=ImageFont.truetype(str(R/'assets/fonts/Inter-Regular.ttf'),20) if (R/'assets/fonts/Inter-Regular.ttf').exists() else ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',20);index=[]
for offset in range(0,len(q),3):
 group=q[offset:offset+3];im=Image.new('RGB',(1080,len(group)*704),'#efe5db');d=ImageDraw.Draw(im)
 for row,x in enumerate(group):
  d.text((12,row*704+8),f"{x['rank']:02} · {x['id']} · {x['durationSeconds']}s",font=font,fill='#30262a');dur=x['durationSeconds'];times=[.35,dur/2,dur-.35]
  for col,t in enumerate(times):
   p=dest/f"{x['id']}-{col}.png";subprocess.run(['ffmpeg','-v','error','-y','-ss',str(t),'-i',str(R/x['video']),'-frames:v','1',str(p)],check=True);im.paste(Image.open(p).resize((360,640),Image.Resampling.LANCZOS),(col*360,row*704+36));d.text((col*360+10,row*704+679),f'{t:.2f}s',font=font,fill='#30262a')
 f=f'review-{offset//3+1:02}.jpg';im.save(dest/f,quality=93);index.append({'sheet':f,'ids':[x['id'] for x in group]})
(dest/'index.json').write_text(json.dumps(index,indent=2)+'\n');print(f'{len(index)} review sheets generated.')
