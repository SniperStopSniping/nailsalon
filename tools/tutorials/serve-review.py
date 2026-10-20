#!/usr/bin/env python3
"""Read-only loopback review server. Never serves private runtime/auth files."""
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
R=Path(__file__).resolve().parents[2]/'docs/tutorials'
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(R),**kw)
 def log_message(self,*args):pass
 def do_GET(self):
  path=self.path.split('?',1)[0]
  if '..' in path or not (path in ['/', '/index.html','/manifest.json','/README.md','/inventory.md','/VERIFICATION.md','/UX_IMPROVEMENTS.md','/POSTING_ORDER.md','/Luster-Mobile-Tutorial-Library-Review.zip'] or path.startswith(('/videos/','/thumbnails/','/assets/fonts/','/storyboards/'))):
   self.send_error(404);return
  super().do_GET()
print('Luster review gallery: http://127.0.0.1:3150 (local only)',flush=True)
ThreadingHTTPServer(('127.0.0.1',3150),Handler).serve_forever()
