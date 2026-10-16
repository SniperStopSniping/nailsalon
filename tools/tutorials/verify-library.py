#!/usr/bin/env python3
import json,subprocess,hashlib,sys
from pathlib import Path
from PIL import Image,ImageDraw
from library_metadata import update_queue
root=Path(__file__).resolve().parents[2]/'docs/tutorials';queue=json.loads((root/'library-queue.json').read_text());ids=sys.argv[1:];results=[]
for item in queue:
 if ids and item['id'] not in ids:continue
 if not item.get('video'):continue
 id=item['id'];f=root/item['video'];meta=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(f)]));v=next(s for s in meta['streams'] if s['codec_type']=='video');dur=float(meta['format']['duration'])
 assert (v['width'],v['height'],v['r_frame_rate'],v['avg_frame_rate'],v['pix_fmt'])==(1080,1920,'30/1','30/1','yuv420p')
 assert 15<=dur<=60
 subprocess.run(['ffmpeg','-v','error','-i',str(f),'-f','null','-'],check=True)
 assert Image.open(root/item['thumbnail']).size==(1080,1920)
 assert hashlib.sha256(f.read_bytes()).hexdigest()==item['sha256']
 edits=json.loads((root/item['editTimeline']).read_text());times={.3,dur/2,dur-.3}
 for e in edits:
  times.update([e['outputStart']+.3,(e['outputStart']+e['outputEnd'])/2,e['outputEnd']-.3]);times.update(c['actualClickTimeSeconds']-.02 for c in e['synchronizedClicks'])
 out=root/'verification/library'/id;out.mkdir(parents=True,exist_ok=True);times=sorted(t for t in times if 0<t<dur)
 sheet=Image.new('RGB',(390*4,math_rows:=((len(times)+3)//4)*720),'#f7f1e8');d=ImageDraw.Draw(sheet)
 for n,t in enumerate(times):
  p=out/f'frame-{n:02}.png';subprocess.run(['ffmpeg','-v','error','-y','-ss',str(t),'-i',str(f),'-frames:v','1',str(p)],check=True);x=(n%4)*390;y=(n//4)*720;sheet.paste(Image.open(p).resize((390,693)),(x,y));d.text((x+8,y+697),f'{t:.2f}s',fill='#302421')
 sheet.save(out/'contact-sheet.jpg');item['exportVerification']='passed';item['sampledFrames']=len(times);item['status']='export_verified_pending_visual_review';results.append({'id':id,'dimensions':[1080,1920],'fps':30,'duration':dur,'fullDecode':'passed','thumbnail':'passed','sha256':item['sha256'],'samples':len(times)})
update_queue({r['id']:{'exportVerification':'passed','sampledFrames':r['samples'],'status':'export_verified_pending_visual_review'} for r in results});dest=root/'verification/library-export-checks.json';existing=json.loads(dest.read_text()) if dest.exists() else [];existing=[x for x in existing if x['id'] not in {r['id'] for r in results}];dest.write_text(json.dumps(existing+results,indent=2)+'\n');print(json.dumps(results,indent=2))
