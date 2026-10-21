"""Pure source/ownership/resource contracts; no services, install or network."""
from pathlib import Path
import ast,copy,hashlib,importlib.util,json,os,tempfile,time
from types import SimpleNamespace
from unittest.mock import Mock,patch
import linux_controller as lc
import run as runner
from patches import transform,HELPER,TEST
D=Path(__file__).resolve().parent;H=D.parent.parent
pins=json.loads((D/'source-pins.json').read_text())
source=Path(os.environ.get('SSI_SOURCE_ROOT',str(Path(os.environ.get('GITHUB_WORKSPACE','/nonexistent'))/'application')))
assert runner.SHA==pins['applicationSha'] and lc.RSS_LIMIT==2*1024**3 and lc.DISK_FLOOR==2*1024**3 and lc.AVAILABLE_FLOOR==2*1024**3 and lc.WORK_SECONDS+120==lc.TOTAL_SECONDS==1200
# Only the npm cache budget changes after the measured hosted install stop.
assert runner.INSTALL_CACHE_LIMIT==512*1024**2 and runner.INSTALL_TREE_LIMIT==2*1024**3
runner.install_storage_bounds(runner.INSTALL_CACHE_LIMIT,runner.INSTALL_TREE_LIMIT)
for cache,modules,code in [(runner.INSTALL_CACHE_LIMIT+1,0,'INSTALL_CACHE_LIMIT'),(0,runner.INSTALL_TREE_LIMIT+1,'INSTALL_TREE_LIMIT')]:
 try:runner.install_storage_bounds(cache,modules)
 except RuntimeError as error:assert str(error)==code
 else:raise AssertionError('install storage boundary ignored')
assert hashlib.sha256((D/'patches.py').read_bytes()).hexdigest()==pins['immutablePatchSha256']
assert hashlib.sha256((D/'ssi-driver.cjs').read_bytes()).hexdigest()==pins['immutableDriverSha256']
helper=(source/HELPER).read_text();test=(source/TEST).read_text();changed=transform(helper,test);assert len(changed)==2 and changed[TEST].count('expect(')==test.count('expect(')==245
assert changed[HELPER][changed[HELPER].index('export const BOOKING_TRANSACTION_RETRY_POLICY'):changed[HELPER].index('export async function withClientLifecycleTransactionRetry')]==helper[helper.index('export const BOOKING_TRANSACTION_RETRY_POLICY'):helper.index('export async function withClientLifecycleTransactionRetry')]
assert changed[HELPER][changed[HELPER].index('      if (attempt === maxAttempts'):]==helper[helper.index('      if (attempt === maxAttempts'):]
assert "db.transaction(transaction, { isolationLevel: 'serializable' })" in (source/'src/libs/appointmentCreation.server.ts').read_text()
assert 'maxAttempts: 8,' in helper and 'retryAdmissionWindowMs: 10_000,' in helper and 'baseDelayMs: 50,' in helper and 'maxDelayMs: 800,' in helper
assert "max: 32" in changed[TEST] and 'it.each([25])' in changed[TEST] and 'round < 1' in changed[TEST] and 'ORIGINAL_UNSELECTED=59' in changed[TEST]
event={'ref':'refs/heads/'+runner.BRANCH,'deleted':False,'after':'a'*40,'repository':{'full_name':'SniperStopSniping/nailsalon'}}
env={'GITHUB_ACTIONS':'true','RUNNER_ENVIRONMENT':'github-hosted','GITHUB_EVENT_NAME':'push','GITHUB_REPOSITORY':'SniperStopSniping/nailsalon','GITHUB_ACTOR':'SniperStopSniping','GITHUB_TRIGGERING_ACTOR':'SniperStopSniping','GITHUB_REF':event['ref'],'GITHUB_SHA':'a'*40}
runner.event_guard(env,event,'a'*40)
for key,value in [('GITHUB_EVENT_NAME','pull_request'),('GITHUB_ACTOR','other'),('GITHUB_TRIGGERING_ACTOR','other'),('GITHUB_REF','refs/heads/main'),('GITHUB_REPOSITORY','fork/nailsalon')]:
 bad=dict(env);bad[key]=value
 try:runner.event_guard(bad,event,'a'*40)
 except RuntimeError:pass
 else:raise AssertionError('wrong event accepted')
assert lc.memory_info('MemTotal: 6291456 kB\nMemAvailable: 3145728 kB\n')['MemAvailable']==3*1024**3
try:lc.memory_info('MemTotal: 100 kB\n')
except RuntimeError:pass
else:raise AssertionError('missing available accepted')
# Finite ancestor ceilings constrain effective memory even when host is free.
def cgread(path,*args,**kwargs):
 if path.name=='cgroup.controllers':return 'memory pids cpu'
 if str(path)=='/proc/self/cgroup':return '0::/owned\n'
 if path.name=='memory.max':return str(4*1024**3) if path.parent.name=='owned' else 'max'
 if path.name=='memory.current':return str(3*1024**3)
 raise AssertionError('unexpected metadata path')
with patch.object(Path,'is_file',return_value=True),patch.object(Path,'read_text',cgread):
 assert lc.effective_available(10*1024**3)==1024**3
# No Popen invocation may occur before role admission; signals only defer.
controller=object.__new__(lc.Controller);controller.env={};controller.children=[];controller.groups=set();controller.selector=SimpleNamespace(register=Mock());controller.tokens={};controller.stop_requested=False
child=SimpleNamespace(pid=777,stdout=SimpleNamespace(fileno=lambda:10),stderr=SimpleNamespace(fileno=lambda:11),returncode=None)
controller.register=lambda pid,token:controller.children[-1]['process'] is child or (_ for _ in ()).throw(AssertionError('registration order'))
stat='777 (synthetic child) S '+str(os.getpid())+' 777 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 999 0 2'
with patch.object(lc.subprocess,'Popen',return_value=child) as popen,patch.object(lc.os,'set_blocking'),patch.object(Path,'read_text',return_value=stat):
 try:controller.start('FOREIGN',[])
 except RuntimeError:pass
 else:raise AssertionError('invalid role accepted')
 popen.assert_not_called();item=controller.start('TEST',['synthetic-node']);assert item['process'] is child and len(controller.children)==1 and controller.selector.register.call_count==2
# Actual observe(): include every PG-cgroup process and owned test descendant;
# same group or unrelated huge RSS must not authorize ownership/accounting.
selfpid=os.getpid();rows={selfpid:{'parent':1,'group':1,'token':1,'rss':10,'state':'S'},100:{'parent':selfpid,'group':100,'token':2,'rss':20,'state':'S'},101:{'parent':100,'group':100,'token':3,'rss':30,'state':'S'},200:{'parent':1,'group':200,'token':4,'rss':40,'state':'S'},201:{'parent':200,'group':200,'token':5,'rss':50,'state':'S'},999:{'parent':1,'group':100,'token':6,'rss':10**12,'state':'S'}}
fake=object.__new__(lc.Controller);fake.root=H;fake.disk_paths=[H];fake.extra_check=None;fake.selector=SimpleNamespace(select=lambda timeout:[]);fake.tokens={100:2,101:3};fake.register=lambda pid,token:None;fake.children=[{'process':SimpleNamespace(pid=100,returncode=None),'role':'TEST'}];fake.container_root=200;fake.container_token=4;fake.container_cgroup='0::/docker/'+'b'*64+'\n';fake.container_stopped=False;fake.peak=0;fake.minimum_disk=2**63;fake.minimum_available=2**63;fake.role_peaks={};fake.stop_requested=False;fake.started=time.monotonic()
space=SimpleNamespace(f_bavail=10*1024**3,f_frsize=1)
with patch.object(lc,'table',return_value=rows),patch.object(lc,'memory_info',return_value={'MemTotal':8*1024**3,'MemAvailable':4*1024**3}),patch.object(lc,'effective_available',return_value=4*1024**3),patch.object(lc,'container_snapshot',side_effect=lambda text,**kwargs:{pid:rows[pid] for pid in [200,201]} if text=='0::/docker/'+'b'*64+'\n' else {}),patch.object(lc.os,'statvfs',return_value=space):
 fake.observe();assert fake.peak==150 and fake.last_roles['POSTGRES']=={'rssBytes':90,'processes':2} and fake.last_roles['TEST']=={'rssBytes':50,'processes':2}
 rows[100]['rss']=3*1024**3
 try:fake.observe()
 except RuntimeError as error:assert str(error)=='COMBINED_RSS_LIMIT'
 else:raise AssertionError('RSS cap ignored')
 assert fake.last_roles['TEST']['rssBytes']>lc.RSS_LIMIT
 rows[100]['rss']=20;fake.container_cgroup='wrong'
 try:fake.observe()
 except RuntimeError as error:assert str(error)=='CONTAINER_ACCOUNTING_INCOMPLETE'
 else:raise AssertionError('foreign cgroup accepted')
# Real filesystem-only cgroup snapshots: include child groups and reparented PG
# members; inaccessible members can never disappear from accounting silently.
def process_stat(pid,parent,group,token,pages=1):
 tail=['0']*22;tail[0]='S';tail[1]=str(parent);tail[2]=str(group);tail[19]=str(token);tail[21]=str(pages)
 return str(pid)+' (synthetic) '+' '.join(tail)
def refuses_snapshot(call,code):
 try:call()
 except RuntimeError as error:assert str(error)==code,(str(error),code)
 else:raise AssertionError('incomplete cgroup snapshot accepted')
with tempfile.TemporaryDirectory(prefix='ssi-pure-cgroup-') as temporary:
 root=Path(temporary);cgroot=root/'cg';procroot=root/'proc';base=cgroot/'owned';sub=base/'workers';sub.mkdir(parents=True);procroot.mkdir()
 (base/'cgroup.procs').write_text('200\n');(sub/'cgroup.procs').write_text('201\n')
 for pid,parent,path,token in [(200,1,'/owned',4),(201,1,'/owned/workers',5)]:
  process=procroot/str(pid);process.mkdir();(process/'stat').write_text(process_stat(pid,parent,pid,token));(process/'cgroup').write_text('0::'+path+'\n')
 snapshot=lambda:lc.container_snapshot('0::/owned\n',cgroup_root=cgroot,proc_root=procroot)
 assert set(snapshot())=={200,201} and snapshot()[201]['parent']==1
 original_read=Path.read_text
 def denied_member(path,*args,**kwargs):
  if path==procroot/'201'/'cgroup':raise PermissionError('synthetic')
  return original_read(path,*args,**kwargs)
 with patch.object(Path,'read_text',denied_member):refuses_snapshot(snapshot,'CONTAINER_ACCOUNTING_PERMISSION')
 def denied_child(path,*args,**kwargs):
  if path==sub/'cgroup.procs':raise PermissionError('synthetic')
  return original_read(path,*args,**kwargs)
 with patch.object(Path,'read_text',denied_child):refuses_snapshot(snapshot,'CONTAINER_ACCOUNTING_PERMISSION')
 (procroot/'201'/'cgroup').write_text('0::/foreign\n');refuses_snapshot(snapshot,'CONTAINER_ACCOUNTING_MISMATCH');(procroot/'201'/'cgroup').write_text('0::/owned/workers\n')
 reads=[0]
 def exited_once(path,*args,**kwargs):
  if path==procroot/'201'/'stat':
   reads[0]+=1
   if reads[0]==1:raise FileNotFoundError('synthetic normal exit race')
  return original_read(path,*args,**kwargs)
 with patch.object(Path,'read_text',exited_once):assert set(snapshot())=={200,201} and reads[0]>=4
 def exited_always(path,*args,**kwargs):
  if path==procroot/'201'/'stat':raise FileNotFoundError('synthetic unstable snapshot')
  return original_read(path,*args,**kwargs)
 with patch.object(Path,'read_text',exited_always):refuses_snapshot(snapshot,'CONTAINER_SNAPSHOT_UNSTABLE')
 reads=[0]
 def reused_pid(path,*args,**kwargs):
  if path==procroot/'201'/'stat':
   reads[0]+=1
   return process_stat(201,1,201,5 if reads[0]==1 else 6)
  return original_read(path,*args,**kwargs)
 with patch.object(Path,'read_text',reused_pid):refuses_snapshot(snapshot,'CONTAINER_PROCESS_IDENTITY_CHANGED')
 assert lc.container_snapshot('0::/removed\n',allow_missing=True,cgroup_root=cgroot,proc_root=procroot)=={}
 refuses_snapshot(lambda:lc.container_snapshot('0::/removed\n',cgroup_root=cgroot,proc_root=procroot),'CONTAINER_SNAPSHOT_UNSTABLE')
# Actual cleanup sends pidfd-only signals and reaps its direct child.
class OwnedProcess:
 pid=100
 returncode=None
 def poll(self):
  if not alive[0]:self.returncode=0
  return self.returncode
 def wait(self):assert not alive[0];return 0
 def send_signal(self,sig):raise AssertionError('unexpected raw fallback')
alive=[True];stopping=object.__new__(lc.Controller);stopping.pidfds={(100,2):88};stopping.tokens={100:2};stopping.groups={100};stopping.children=[{'process':OwnedProcess()}]
stopping.observe=lambda cleanup:({100:{'token':2,'state':'S','group':100}} if alive[0] else {},{100} if alive[0] else set())
def send(fd,sig):assert fd==88;alive[0]=False
with patch.object(lc.signal,'pidfd_send_signal',create=True,side_effect=send) as sent,patch.object(lc.time,'sleep'):
 assert stopping.stop_children() is True and sent.call_count==1 and stopping.unknown==0
# Persistent unproven members fail at bounded deadlines without any signal.
stopping.children=[];stopping.observe=lambda cleanup:({999:{'token':9,'state':'S','group':100}},set());clock=iter(range(100))
with patch.object(lc.signal,'pidfd_send_signal',create=True) as sent,patch.object(lc.time,'sleep'),patch.object(lc.time,'monotonic',side_effect=lambda:next(clock)):
 assert stopping.stop_children() is False and stopping.unknown==1;sent.assert_not_called()
# No observed PID is not proof of direct-child completion. An unreaped Popen
# that never exits must consume the existing TERM/KILL budgets and fail closed.
class PendingProcess:
 pid=100
 returncode=None
 def __init__(self):self.signals=[];self.waits=0
 def poll(self):return None
 def send_signal(self,sig):self.signals.append(sig)
 def wait(self):self.waits+=1;raise AssertionError('pending child cannot be reaped')
pending=PendingProcess();stopping.children=[{'process':pending}];stopping.observe=lambda cleanup:({},set());clock=iter(range(100))
with patch.object(lc.signal,'pidfd_send_signal',create=True) as sent,patch.object(lc.time,'sleep'),patch.object(lc.time,'monotonic',side_effect=lambda:next(clock)):
 assert stopping.stop_children() is False and pending.poll() is None and pending.waits==0
 assert lc.signal.SIGTERM in pending.signals and lc.signal.SIGKILL in pending.signals;sent.assert_not_called()
# Exact container identity is required before cleanup authority.
row={'Id':'b'*64,'Name':'/owned','Config':{'Image':runner.IMAGE,'Labels':{'luster.ssi.run':'tag'}},'HostConfig':{'PortBindings':{'5432/tcp':[{'HostIp':'127.0.0.1','HostPort':'55432'}]}},'NetworkSettings':{'Networks':{'network':{}}},'Mounts':[{'Destination':'/var/lib/postgresql/data','Type':'volume','Name':'c'*64}]}
assert runner.container_identity(row,'owned','tag','network')==('b'*64,'c'*64)
for mutate in [lambda r:r['Config'].update(Image='foreign'),lambda r:r['Config']['Labels'].update({'luster.ssi.run':'foreign'}),lambda r:r['HostConfig']['PortBindings']['5432/tcp'][0].update(HostIp='0.0.0.0'),lambda r:r['NetworkSettings']['Networks'].update(foreign={})]:
 bad=copy.deepcopy(row);mutate(bad)
 try:runner.container_identity(bad,'owned','tag','network')
 except RuntimeError:pass
 else:raise AssertionError('foreign container accepted')
workflow=(H/'.github/workflows/ssi-diagnostic.yml').read_text();assert 'pull_request' not in workflow and 'workflow_dispatch' not in workflow and 'secrets.' not in workflow and 'id-token:' not in workflow and 'branches: ['+runner.BRANCH+']' in workflow
assert workflow.count('persist-credentials: false')==2 and 'ref: '+runner.SHA in workflow and 'contents: read' in workflow
for line in workflow.splitlines():
 if 'uses:' in line:assert __import__('re').search(r'@[a-f0-9]{40}(?: |$)',line)
vercel=json.loads((H/'vercel.json').read_text());assert vercel['git']=={'deploymentEnabled':{runner.BRANCH:False}}
assert hashlib.sha256(json.dumps(vercel['crons'],separators=(',',':')).encode()).hexdigest()==pins['harnessCronArraySha256']
text=(D/'run.py').read_text();assert '--ignore-scripts' not in text and "'NODE_OPTIONS':'--max-old-space-size=256'" in text and "'--log-driver','none'" in text and "'max_connections=40'" in text
assert text.index("'ci','--no-audit'")<text.index("'run','-d'")<text.index('runtime={**clean')
assert "'providerCredentialsSupplied':False" in text and "cleanup=cleanup or" in text
for file in D.glob('*.py'):ast.parse(file.read_text())
print(json.dumps({'pureContracts':'PASS','installCache512MiBBoundary':'PASS','unchangedInstallTree2GiBBoundary':'PASS','sourceSha':runner.SHA,'originalExpectCalls':245,'unchangedRetryAndSerializablePolicy':True,'eventAndWorkflowGuards':'PASS','effectiveCgroupMemoryFloor':'PASS','fakePopenRegistration':'PASS','allOwnedAndContainerRssAccounting':'PASS','guardFailureRolesRetained':'PASS','containerIdentityRefusal':'PASS','pidfdCleanupAndUnknownRefusal':'PASS','pendingDirectChildRefusal':'PASS','exactCgroupSubtreeOrphanAndFailureContracts':'PASS','vercelExactBranchAndCrons':'PASS','nativeServicesInstallOrNetworkExecuted':False}))
