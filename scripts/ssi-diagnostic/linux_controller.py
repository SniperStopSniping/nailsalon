"""Linux owned-process and private Docker-service resource accounting."""
from pathlib import Path
import hashlib,json,os,re,selectors,signal,subprocess,time
RSS_LIMIT=2*1024**3
DISK_FLOOR=2*1024**3
AVAILABLE_FLOOR=2*1024**3
WORK_SECONDS=1080
TOTAL_SECONDS=1200

def require(value,code):
 if not value:raise RuntimeError(code)
def digest(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as stream:
  for block in iter(lambda:stream.read(65536),b''):h.update(block)
 return h.hexdigest()
def memory_info(text=None):
 text=Path('/proc/meminfo').read_text() if text is None else text
 result={m.group(1):int(m.group(2))*1024 for m in re.finditer(r'^(MemTotal|MemAvailable):\s+(\d+) kB$',text,re.M)}
 require(set(result)=={'MemTotal','MemAvailable'},'MEMORY_OBSERVATION_REQUIRED');return result
def effective_available(host_available,extra_cgroup=None):
 # Conservative slack under every finite cgroupv2 ancestor limit. File cache
 # is not assumed reclaimable; shared ancestors are observed only once.
 root=Path('/sys/fs/cgroup');require((root/'cgroup.controllers').is_file() and 'memory' in (root/'cgroup.controllers').read_text().split(),'CGROUP_V2_OBSERVATION_REQUIRED')
 texts=[Path('/proc/self/cgroup').read_text()]+([extra_cgroup] if extra_cgroup else [])
 paths=set()
 for text in texts:
  rows=[line[3:] for line in text.splitlines() if line.startswith('0::')];require(len(rows)==1 and rows[0].startswith('/') and '..' not in Path(rows[0]).parts,'CGROUP_PATH_REQUIRED')
  path=root/rows[0].lstrip('/');path.resolve().relative_to(root.resolve())
  while True:
   paths.add(path)
   if path==root:break
   path=path.parent
 available=host_available
 for path in paths:
  # A real host hierarchy root has no configurable memory.max; host memory
  # remains bounded by MemAvailable. Non-root missing interfaces fail closed.
  if path==root and not (path/'memory.max').is_file():continue
  maximum=(path/'memory.max').read_text().strip();current=(path/'memory.current').read_text().strip();require(current.isdecimal() and (maximum=='max' or maximum.isdecimal()),'CGROUP_MEMORY_INVALID')
  if maximum!='max':available=min(available,max(0,int(maximum)-int(current)))
 return available

def parse_stat(text):
 tail=text.rpartition(') ')[2].split();require(len(tail)>=22,'PROCESS_STAT_INVALID')
 return {'state':tail[0],'parent':int(tail[1]),'group':int(tail[2]),'token':int(tail[19]),'rss':int(tail[21])*os.sysconf('SC_PAGE_SIZE')}
def cgroup_path(text):
 lines=text.splitlines();require(len(lines)==1 and lines[0].startswith('0::/'),'CONTAINER_CGROUP_INVALID')
 value=lines[0][3:];require('..' not in Path(value).parts and value!='/' and len(value)<4096,'CONTAINER_CGROUP_INVALID')
 return value

def container_snapshot(text,allow_missing=False,cgroup_root=Path('/sys/fs/cgroup'),proc_root=Path('/proc')):
 # cgroup.procs, rather than parent ancestry, includes reparented PG members.
 # Retry a bounded complete snapshot only for ordinary exit/tree-removal races.
 base=cgroup_root/cgroup_path(text).lstrip('/')
 def inventory():
  pending=[base];members={};directories=0
  while pending:
   path=pending.pop();directories+=1;require(directories<=64,'CONTAINER_CGROUP_BOUND')
   require(not path.is_symlink(),'CONTAINER_CGROUP_SYMLINK')
   raw=(path/'cgroup.procs').read_text();require(len(raw)<=8192,'CONTAINER_PROCESS_BOUND')
   entries=raw.split();require(all(x.isdecimal() and int(x)>0 for x in entries),'CONTAINER_CGROUP_INVALID')
   for entry in entries:
    pid=int(entry);require(pid not in members,'CONTAINER_CGROUP_DUPLICATE');members[pid]=path
   require(len(members)<=256,'CONTAINER_PROCESS_BOUND')
   for child in path.iterdir():
    require(not child.is_symlink(),'CONTAINER_CGROUP_SYMLINK')
    if child.is_dir():pending.append(child)
  return members
 for _ in range(3):
  try:
   before=inventory();result={}
   for pid,path in before.items():
    process=proc_root/str(pid);first=parse_stat((process/'stat').read_text())
    actual=cgroup_path((process/'cgroup').read_text());expected='/'+str(path.relative_to(cgroup_root))
    require(actual==expected,'CONTAINER_ACCOUNTING_MISMATCH')
    second=parse_stat((process/'stat').read_text());require(first['token']==second['token'],'CONTAINER_PROCESS_IDENTITY_CHANGED')
    result[pid]=second
   if before!=inventory():continue
   for pid,row in result.items():
    current=parse_stat((proc_root/str(pid)/'stat').read_text());require(current['token']==row['token'],'CONTAINER_PROCESS_IDENTITY_CHANGED')
   return result
  except (FileNotFoundError,ProcessLookupError):
   if allow_missing and not base.exists():return {}
  except PermissionError:raise RuntimeError('CONTAINER_ACCOUNTING_PERMISSION') from None
 raise RuntimeError('CONTAINER_SNAPSHOT_UNSTABLE')

def table():
 rows={}
 for path in Path('/proc').glob('[0-9]*/stat'):
  try:rows[int(path.parent.name)]=parse_stat(path.read_text())
  except (FileNotFoundError,ProcessLookupError):continue
  except PermissionError:raise RuntimeError('PROCESS_OBSERVATION_PERMISSION') from None
 return rows
class Controller:
 def __init__(self,root,env):
  self.root=root;self.disk_paths=[root];self.extra_check=None;self.env=env;self.started=time.monotonic();self.children=[];self.tokens={};self.pidfds={};self.groups=set();self.stop_requested=False;self.selector=selectors.DefaultSelector();self.container_root=None;self.container_token=None;self.container_cgroup=None;self.container_stopped=False;self.peak=0;self.minimum_disk=2**63;self.minimum_available=2**63;self.classifiers={'oom':0,'enospc':0,'egressDenied':0};self.tails={};self.role_peaks={};self.last_roles={};self.unknown=0
  self.previous={sig:signal.signal(sig,lambda *_:setattr(self,'stop_requested',True)) for sig in [signal.SIGINT,signal.SIGTERM]}
 def register(self,pid,token):
  if self.tokens.get(pid)==token:return
  require(len(self.pidfds)<256,'OWNED_PROCESS_BOUND')
  fd=None
  try:
   fd=os.pidfd_open(pid);current=parse_stat(Path('/proc',str(pid),'stat').read_text())
  except (ProcessLookupError,FileNotFoundError):
   if fd is not None:os.close(fd)
   return
  except BaseException:
   if fd is not None:os.close(fd)
   raise
  if current['token']!=token:os.close(fd);raise RuntimeError('OWNED_PID_IDENTITY_CHANGED')
  self.tokens[pid]=token;self.pidfds[(pid,token)]=fd
 def start(self,role,argv,env=None,cwd=None,private=False):
  require(role in ['INSTALL','TEST','BOOTSTRAP','DOCKER','SOURCE'],'CHILD_ROLE_REQUIRED')
  # Signal handlers only defer; append immediately after successful Popen.
  process=subprocess.Popen(argv,cwd=cwd,env=env or self.env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
  item={'process':process,'role':role,'private':private,'buffer':bytearray(),'stdoutBytes':0,'stderrBytes':0};self.children.append(item);self.groups.add(process.pid)
  try:
   row=parse_stat(Path('/proc',str(process.pid),'stat').read_text());require(row['parent']==os.getpid() and row['group']==process.pid,'DIRECT_CHILD_IDENTITY');self.register(process.pid,row['token'])
  except FileNotFoundError:require(process.poll() is not None,'CHILD_IDENTITY_UNOBSERVABLE')
  for name,stream in [('stdoutBytes',process.stdout),('stderrBytes',process.stderr)]:os.set_blocking(stream.fileno(),False);self.selector.register(stream,selectors.EVENT_READ,(item,name))
  return item
 def drain(self):
  for key,_ in self.selector.select(timeout=0):
   item,name=key.data;chunk=os.read(key.fileobj.fileno(),16384)
   if not chunk:self.selector.unregister(key.fileobj);key.fileobj.close();continue
   identity=(item['process'].pid,name);tail=self.tails.get(identity,b'');scan=(tail+chunk).lower()
   for key,marker in [('oom',b'heap out of memory'),('enospc',b'enospc'),('egressDenied',b'network fence denied')]:self.classifiers[key]+=sum(1 for m in re.finditer(re.escape(marker),scan) if m.end()>len(tail))
   self.tails[identity]=scan[-80:]
   item[name]+=len(chunk);require(item[name]<=4*1024**2,'STDIO_BYTE_BOUND')
   if item['private'] and name=='stdoutBytes':item['buffer'].extend(chunk);require(len(item['buffer'])<=16384,'PRIVATE_PIPE_BOUND')
 def observe(self,cleanup=False):
  self.drain();rows=table();owned={pid for pid,token in self.tokens.items() if pid in rows and rows[pid]['token']==token}
  for item in self.children:
   p=item['process'];row=rows.get(p.pid)
   if p.returncode is None and row and row['parent']==os.getpid() and row['group']==p.pid:owned.add(p.pid)
  while True:
   new={pid for pid,row in rows.items() if row['parent'] in owned}-owned
   if not new:break
   owned|=new
  for pid in owned:self.register(pid,rows[pid]['token'])
  require(all(rows[pid]['group']!=os.getpgrp() for pid in owned),'OWNED_GROUP_ESCAPE')
  roots={item['process'].pid:item['role'] for item in self.children if item['process'].returncode is None and item['process'].pid in owned};roles={name:{'rssBytes':0,'processes':0} for name in ['CONTROLLER','INSTALL','TEST','BOOTSTRAP','DOCKER','SOURCE','OTHER_PROVEN','POSTGRES']}
  if os.getpid() in rows:roles['CONTROLLER']={'rssBytes':rows[os.getpid()]['rss'],'processes':1}
  for pid in owned:
   cursor=pid;seen=set();role='OTHER_PROVEN'
   while cursor in rows and cursor not in seen and len(seen)<64:
    if cursor in roots:role=roots[cursor];break
    seen.add(cursor);cursor=rows[cursor]['parent']
   roles[role]['rssBytes']+=rows[pid]['rss'];roles[role]['processes']+=1
  if self.container_root and not self.container_stopped:
   row=rows.get(self.container_root);require(cleanup or row and row['token']==self.container_token,'OWNED_CONTAINER_PROCESS_LOST')
   ancestry={self.container_root} if row else set()
   while True:
    new={pid for pid,row in rows.items() if row['parent'] in ancestry}-ancestry
    if not new:break
    ancestry|=new
   members=container_snapshot(self.container_cgroup,allow_missing=cleanup and row is None);pg=set(members)
   require(ancestry<=pg and (cleanup or self.container_root in pg) and not (pg&owned),'CONTAINER_ACCOUNTING_INCOMPLETE')
   if self.container_root in pg:require(members[self.container_root]['token']==self.container_token,'CONTAINER_PROCESS_IDENTITY_CHANGED')
   roles['POSTGRES']={'rssBytes':sum(member['rss'] for member in members.values()),'processes':len(pg)}
  rss=sum(x['rssBytes'] for x in roles.values());mem=memory_info();memory_available=effective_available(mem['MemAvailable'],self.container_cgroup if not cleanup and not self.container_stopped else None);available=min(os.statvfs(path).f_bavail*os.statvfs(path).f_frsize for path in self.disk_paths)
  self.last_roles=roles;self.peak=max(self.peak,rss);self.minimum_disk=min(self.minimum_disk,available);self.minimum_available=min(self.minimum_available,memory_available)
  for name,row in roles.items():self.role_peaks[name]=max(self.role_peaks.get(name,0),row['rssBytes'])
  if not cleanup:
   if self.extra_check:self.extra_check()
   require(not self.stop_requested,'OPERATOR_STOP');require(time.monotonic()-self.started<WORK_SECONDS,'WORK_DEADLINE');require(rss<=RSS_LIMIT,'COMBINED_RSS_LIMIT');require(available>=DISK_FLOOR,'DISK_FLOOR');require(memory_available>=AVAILABLE_FLOOR,'AVAILABLE_MEMORY_FLOOR')
  require(time.monotonic()-self.started<TOTAL_SECONDS,'TOTAL_DEADLINE')
  return rows,owned
 def wait(self,item,seconds,cleanup=False):
  end=time.monotonic()+seconds
  while item['process'].poll() is None:
   self.observe(cleanup);require(time.monotonic()<end,'CHILD_DEADLINE');time.sleep(.1)
  for _ in range(3):self.observe(cleanup)
  require(item['process'].returncode==0,'CHILD_EXIT_FAILED');return bytes(item['buffer'])
 def command(self,argv,seconds=10,private=True,cleanup=False):return self.wait(self.start('DOCKER',argv,private=private),seconds,cleanup)
 def attach_container(self,pid,cid):
  row=parse_stat(Path('/proc',str(pid),'stat').read_text());cg=Path('/proc',str(pid),'cgroup').read_text();require(cid in cg and len(cg)<4096,'CONTAINER_CGROUP_REQUIRED');self.container_root=pid;self.container_token=row['token'];self.container_cgroup=cg
 def stop_children(self):
  # Only pidfds for proven PID/start-token identities are signaled; never groups.
  for sig,budget in [(signal.SIGTERM,10),(signal.SIGKILL,5)]:
   end=time.monotonic()+budget
   while time.monotonic()<end:
    try:rows,owned=self.observe(cleanup=True)
    except RuntimeError:rows=table();owned={pid for pid,token in self.tokens.items() if pid in rows and rows[pid]['token']==token}
    live={pid for pid in owned if rows[pid]['state']!='Z'}
    for pid in live:
     fd=self.pidfds.get((pid,rows[pid]['token']));require(fd is not None,'OWNED_PIDFD_REQUIRED')
     try:signal.pidfd_send_signal(fd,sig)
     except ProcessLookupError:pass
    pending_direct=False
    for item in self.children:
     process=item['process']
     if process.poll() is None and process.pid not in live:
      # An unreaped direct Popen child cannot have its PID reused.
      try:process.send_signal(sig)
      except ProcessLookupError:pass
     # poll reaps an exited direct child; wait confirms completion explicitly.
     if process.poll() is None:pending_direct=True
     else:process.wait()
    unknown={pid for pid,row in rows.items() if row['group'] in self.groups and pid not in owned and row['state']!='Z'};self.unknown=len(unknown)
    if not live and not unknown and not pending_direct:return True
    time.sleep(.1)
  return False
 def close(self):
  for fd in self.pidfds.values():os.close(fd)
  for sig,handler in self.previous.items():signal.signal(sig,handler)
