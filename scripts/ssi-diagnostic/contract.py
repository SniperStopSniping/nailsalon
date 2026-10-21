"""Pure source/ownership/resource contracts; no services, install or network."""
from pathlib import Path
import ast,copy,hashlib,importlib.util,io,json,os,tarfile,tempfile,time
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
# Exact public manifests supplement libc omitted by this immutable lock.
lock_path=source/'package-lock.json';lock_rows=json.loads(lock_path.read_text())['packages'];eligibility=runner.platform_entries(lock_path)
assert len(eligibility)==10 and all(row['libc']==['musl'] for row in eligibility.values())
for name,entry in eligibility.items():
 row=lock_rows[name];assert row.get('libc') is None and row['optional'] is True
 assert runner.platform_compatible(name,row,{}) is True and runner.platform_compatible(name,row,eligibility) is False
 bad=copy.deepcopy(row);bad['version']='0.0.0'
 try:runner.platform_compatible(name,bad,eligibility)
 except RuntimeError as error:assert str(error)=='PLATFORM_METADATA_NODE_PIN'
 else:raise AssertionError('unbound platform metadata accepted')
assert runner.platform_compatible('node_modules/unknown-musl',{'optional':True,'os':['linux'],'cpu':['x64']},eligibility) is True
# Exercise the actual installed() validator: unknown/compatible optional absence
# and required absence still fail, with one bounded public lock-row diagnosis.
with tempfile.TemporaryDirectory(prefix='ssi-pure-install-') as temporary:
 application=Path(temporary);name='node_modules/synthetic';diagnostics={}
 for row in [{'version':'1.0.0'},{'version':'1.0.0','optional':True,'os':['linux'],'cpu':['x64'],'libc':['glibc']},{'version':'1.0.0','optional':True}]:
  (application/'package-lock.json').write_text(json.dumps({'packages':{'':{'dependencies':{'synthetic':'1.0.0'}},name:row}}));diagnostics.clear()
  with patch.object(runner,'platform_entries',return_value={}):
   try:runner.installed(application,SimpleNamespace(observe=Mock()),diagnostics)
   except RuntimeError as error:assert str(error)=='REQUIRED_INSTALLED_NODE_MISSING'
   else:raise AssertionError('required or unqualified optional absence accepted')
  assert diagnostics['firstMissing']['lockPath']==name and diagnostics['firstMissing']['version']=='1.0.0' and diagnostics['firstMissing']['activeDependency'] is True and len(diagnostics)==1
 known=next(iter(eligibility));row=lock_rows[known];(application/'package-lock.json').write_text(json.dumps({'packages':{'':{},known:row}}));diagnostics.clear()
 with patch.object(runner,'platform_entries',return_value={known:eligibility[known]}):
  summary=runner.installed(application,SimpleNamespace(observe=Mock()),diagnostics)
  assert summary['absentPlatformOptionals']==summary['absentManifestBoundMuslOptionals']==1 and not diagnostics
  package=application/known/'package.json';package.parent.mkdir(parents=True);package.write_text(json.dumps({'version':'0.0.0'}))
  try:runner.installed(application,SimpleNamespace(observe=Mock()),diagnostics)
  except RuntimeError as error:assert str(error)=='INSTALLED_VERSION_MISMATCH'
  else:raise AssertionError('installed version mismatch accepted')
# Platform eligibility is a path property, not a compatible leaf property.
active=runner.active_lock_nodes(lock_rows,eligibility)
orphans={name for name,row in lock_rows.items() if name and row.get('optional') and runner.platform_compatible(name,row,eligibility) and name not in active}
assert len(active)-1==2777 and orphans=={'node_modules/@emnapi/runtime','node_modules/@img/sharp-wasm32'}
assert all(not row.get('optional') or name in active or name in orphans or not runner.platform_compatible(name,row,eligibility) for name,row in lock_rows.items() if name)
# Nested resolution chooses the nearest ancestor before a root hoist.
nested={'':{'dependencies':{'parent':'1'}},'node_modules/parent':{'version':'1','dependencies':{'inner':'1'}},'node_modules/parent/node_modules/inner':{'version':'1','optional':True,'dependencies':{'leaf':'1'}},'node_modules/parent/node_modules/leaf':{'version':'1','optional':True},'node_modules/leaf':{'version':'2','optional':True}}
assert runner.resolve_lock_dependency(nested,'node_modules/parent/node_modules/inner','leaf')=='node_modules/parent/node_modules/leaf'
assert 'node_modules/parent/node_modules/leaf' in runner.active_lock_nodes(nested,{}) and 'node_modules/leaf' not in runner.active_lock_nodes(nested,{})
hoisted=copy.deepcopy(nested);del hoisted['node_modules/parent/node_modules/leaf'];assert runner.resolve_lock_dependency(hoisted,'node_modules/parent/node_modules/inner','leaf')=='node_modules/leaf'
cycle={'':{'optionalDependencies':{'a':'1'},'devDependencies':{'dev':'1'}},'node_modules/a':{'version':'1','optional':True,'dependencies':{'b':'1'}},'node_modules/b':{'version':'1','optional':True,'dependencies':{'a':'1'}},'node_modules/dev':{'version':'1','optional':True}}
assert runner.active_lock_nodes(cycle,{})==set(cycle)
peers={'':{'dependencies':{'a':'1'}},'node_modules/a':{'version':'1','peerDependencies':{'required-peer':'1','optional-peer':'1','absent-peer':'1'},'peerDependenciesMeta':{'optional-peer':{'optional':True},'absent-peer':{'optional':True}}},'node_modules/required-peer':{'version':'1','optional':True},'node_modules/optional-peer':{'version':'1','optional':True}}
assert 'node_modules/required-peer' in runner.active_lock_nodes(peers,{}) and 'node_modules/optional-peer' not in runner.active_lock_nodes(peers,{})
for bad in [{'':{'dependencies':{'absent':'1'}}},{'':{'peerDependencies':{'absent':'1'}}}]:
 try:runner.active_lock_nodes(bad,{})
 except RuntimeError as error:assert str(error)=='LOCK_REQUIRED_EDGE_UNRESOLVED'
 else:raise AssertionError('unresolved mandatory graph edge accepted')
assert runner.active_lock_nodes({'':{'optionalDependencies':{'absent':'1'}}},{})=={''}
# Actual filesystem validation still refuses a required/active optional or peer
# even if another inactive parent or a different root-hoisted copy exists.
def fake_graph_install(packages,present,error=None):
 with tempfile.TemporaryDirectory(prefix='ssi-pure-active-graph-') as temporary:
  app=Path(temporary);(app/'package-lock.json').write_text(json.dumps({'packages':packages}));diagnostics={}
  for name in present:
   file=app/name/'package.json';file.parent.mkdir(parents=True,exist_ok=True);file.write_text(json.dumps({'version':packages[name]['version']}))
  with patch.object(runner,'platform_entries',return_value={}):
   try:summary=runner.installed(app,SimpleNamespace(observe=Mock()),diagnostics)
   except RuntimeError as actual:
    assert error is not None and str(actual)==error;return diagnostics
   else:assert error is None;return summary
failure=fake_graph_install(nested,{'node_modules/parent','node_modules/parent/node_modules/inner','node_modules/leaf'},'REQUIRED_INSTALLED_NODE_MISSING');assert failure['firstMissing']['lockPath']=='node_modules/parent/node_modules/leaf' and failure['firstMissing']['activeDependency'] is True
failure=fake_graph_install(peers,{'node_modules/a'},'REQUIRED_INSTALLED_NODE_MISSING');assert failure['firstMissing']['lockPath']=='node_modules/required-peer'
assert fake_graph_install(peers,{'node_modules/a','node_modules/required-peer'})['absentInactiveGraphOptionals']==1
inactive={'':{'optionalDependencies':{'foreign':'1'}},'node_modules/foreign':{'version':'1','optional':True,'os':['darwin'],'dependencies':{'neutral':'1'}},'node_modules/neutral':{'version':'1','optional':True}}
assert fake_graph_install(inactive,set())['absentInactiveGraphOptionals']==1
multiple=copy.deepcopy(inactive);multiple['']['dependencies']={'local':'1'};multiple['node_modules/local']={'version':'1','dependencies':{'neutral':'1'}}
failure=fake_graph_install(multiple,{'node_modules/local'},'REQUIRED_INSTALLED_NODE_MISSING');assert failure['firstMissing']['lockPath']=='node_modules/neutral' and failure['firstMissing']['activeDependency'] is True
failure=fake_graph_install({'':{},'node_modules/nonoptional-orphan':{'version':'1'}},set(),'REQUIRED_INSTALLED_NODE_MISSING');assert failure['firstMissing']['optional'] is False
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
# Install classification is a bounded fixed-enum projection, never raw output.
wire=b'npm error code ETIMEDOUT\nnpm ERR! code EINTEGRITY\r\nnpm error code 1\n'
expected={'ETIMEDOUT':1,'EINTEGRITY':1,'EXIT_CODE_1':1}
for split in range(len(wire)+1):
 classifier=lc.NpmErrorClassifier();classifier.feed('stderrBytes',wire[:split]);classifier.feed('stderrBytes',wire[split:]);classifier.feed('stderrBytes',b'',eof=True)
 safe=classifier.snapshot();assert safe['codeCounts']==expected and safe['firstRecognizedCode']=='ETIMEDOUT' and not classifier.pending
classifier=lc.NpmErrorClassifier();assert classifier.snapshot()['firstRecognizedCode']=='UNKNOWN'
private_payload=b'https://example.invalid/private-token?key=synthetic-value\nnpm error code EPRIVATE_SYNTHETIC_VALUE\nnot npm error code ECONNRESET\nnpm error code ETIMEDOUT https://example.invalid/credential\n'
classifier.feed('stdoutBytes',private_payload);classifier.feed('stdoutBytes',b'npm error code '+b'X'*1000);classifier.feed('stdoutBytes',b'npm error code ECONNRESET\n');classifier.feed('stdoutBytes',b'npm error code ELIFECYCLE',eof=True)
safe=classifier.snapshot();encoded=json.dumps(safe);assert safe['codeCounts']=={'ELIFECYCLE':1} and safe['unrecognizedCodeLines']==1
assert all(value not in encoded for value in ['example.invalid','synthetic-value','EPRIVATE_SYNTHETIC_VALUE','credential']) and not classifier.pending and not classifier.overflow
classifier=lc.NpmErrorClassifier();classifier.feed('stdoutBytes',b'npm error co');classifier.feed('stderrBytes',b'de EINTEGRITY\n');classifier.feed('stdoutBytes',b'de EAI_AGAIN\n');assert classifier.snapshot()['codeCounts']=={'EAI_AGAIN':1}
# The real controller drain forwards only the install's observed stream, with
# chunk-boundary/EOF handling and the unchanged per-stream byte cap.
stream=SimpleNamespace(fileno=lambda:99,close=Mock());item={'process':SimpleNamespace(pid=777),'role':'INSTALL','installErrors':lc.NpmErrorClassifier(),'private':False,'stdoutBytes':0,'stderrBytes':0}
key=SimpleNamespace(data=(item,'stderrBytes'),fileobj=stream);draining=object.__new__(lc.Controller);draining.selector=SimpleNamespace(select=lambda timeout:[(key,None)],unregister=Mock());draining.tails={};draining.classifiers={'oom':0,'enospc':0,'egressDenied':0}
with patch.object(lc.os,'read',side_effect=[b'npm error co',b'de ECONNRESET\n',b'']):
 for _ in range(3):draining.drain()
assert item['installErrors'].snapshot()['codeCounts']=={'ECONNRESET':1} and item['stderrBytes']==26 and stream.close.call_count==1
# Source-only observation cadence starts its interval AFTER an expensive full
# observation. Fast file opportunities cannot retrigger full storage scans.
assert runner.SOURCE_OBSERVE_INTERVAL_SECONDS==0.1
clock=[0.0];counts={'attemptedObservations':0,'completedObservations':0,'forcedObservations':0,'skippedObservationOpportunities':0}
def expensive_observation():clock[0]+=2.0
monitor=SimpleNamespace(observe=Mock(side_effect=expensive_observation));cadence=runner.SourceObservation(monitor,counts)
with patch.object(runner.time,'monotonic',side_effect=lambda:clock[0]):
 cadence.observe(force=True)
 for _ in range(1000):cadence.observe()
 assert monitor.observe.call_count==1
 clock[0]+=0.05;cadence.observe();assert monitor.observe.call_count==1
 clock[0]+=0.051;cadence.observe();assert monitor.observe.call_count==2
 cadence.observe(force=True);assert monitor.observe.call_count==3 and counts['forcedObservations']==2 and counts['completedObservations']==3
failing=runner.SourceObservation(SimpleNamespace(observe=Mock(side_effect=RuntimeError('COMBINED_RSS_LIMIT'))),dict.fromkeys(counts,0))
try:failing.observe(force=True)
except RuntimeError as error:assert str(error)=='COMBINED_RSS_LIMIT' and failing.metrics['completedObservations']==0
else:raise AssertionError('source cadence suppressed guard')
# Exercise actual copy_source with a synthetic tar written by a fake controller;
# no git process, install, service or transport executes. Every byte is hashed.
class SourceController:
 def __init__(self,payloads,fail_final=False):self.payloads=payloads;self.observe_calls=0;self.fail_final=fail_final
 def start(self,role,argv):
  assert role=='SOURCE' and argv[0]=='git';archive=Path(argv[argv.index('--output')+1])
  with tarfile.open(archive,'w') as tar:
   for name,payload in self.payloads.items():
    member=tarfile.TarInfo(name);member.size=len(payload);member.mode=0o644;tar.addfile(member,io.BytesIO(payload))
  return {'fakeSourceChild':True}
 def wait(self,item,seconds):assert item=={'fakeSourceChild':True} and seconds==30;return b''
 def observe(self):
  self.observe_calls+=1
  if self.fail_final and self.observe_calls==3:raise RuntimeError('DISK_FLOOR')
payloads={'src/a.ts':b'bounded-source'*10000,'public/b.txt':b'complete-source'};expected={name:hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest() for name,data in payloads.items()}
for failure in [None,'DISK_FLOOR','COPIED_SOURCE_CHANGED']:
 with tempfile.TemporaryDirectory(prefix='ssi-pure-source-copy-') as temporary:
  work=Path(temporary);monitor=SourceController(payloads,fail_final=failure=='DISK_FLOOR');metrics={};wanted=dict(expected)
  if failure=='COPIED_SOURCE_CHANGED':wanted['public/b.txt']='0'*40
  with patch.object(runner.time,'monotonic',return_value=0):
   try:target=runner.copy_source(work/'unused-app',work,wanted,monitor,metrics)
   except RuntimeError as error:assert str(error)==failure
   else:
    assert failure is None and metrics['phase']=='COMPLETE' and metrics['copiedFiles']==metrics['verifiedFiles']==2
    assert metrics['copiedBytes']==sum(map(len,payloads.values())) and metrics['forcedObservations']==monitor.observe_calls==3
    assert all((target/name).read_bytes()==data for name,data in payloads.items()) and not (work/'source.tar').exists()
  if failure=='DISK_FLOOR':assert metrics['phase']=='VERIFY' and metrics['verifiedFiles']==2 and metrics['completedObservations']==2
# Bootstrap failure projection accepts only the shared immutable enum schema.
boot={'status':'failed','phase':'MIGRATIONS','errorCode':'POSTGRES_ERROR','sqlState':'42P01'}
assert runner.bootstrap_failure(json.dumps(boot).encode())==boot
assert runner.bootstrap_failure(b'') is None and runner.bootstrap_failure(b'{"migrationCount":113,"ownedClusterAttested":true}') is None
for key,value in [('phase','https://example.invalid/private'),('errorCode','synthetic-private-value'),('sqlState','SECRET'),('message','synthetic-private-value')]:
 bad={**boot,key:value}
 try:runner.bootstrap_failure(json.dumps(bad).encode())
 except RuntimeError as error:assert str(error)=='BOOTSTRAP_DIAGNOSTIC_SCHEMA'
 else:raise AssertionError('raw bootstrap payload accepted')
boot_source=(D/'bootstrap.mts').read_text();assert boot_source.index('try {')<boot_source.index("require('pg')")<boot_source.index("phase = 'STATIC_TARGET'")<boot_source.index("phase = 'CONNECT'")<boot_source.index('await disposable.attestDisposableDatabaseSession')<boot_source.index('await marker.initializeNonProductionDatabaseMarker')<boot_source.index('await migrate(')
assert 'row.connections !== 40' in boot_source and "row.fsync !== 'on'" in boot_source and "row.full_page_writes !== 'on'" in boot_source and 'count !== 113' in boot_source
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
# Inspect the actual readiness launch AST, including the owned CID binding and
# unchanged attempt/wait budget. No command is executed by this contract.
def readiness_contract(text):
 tree=ast.parse(text);calls=[node for node in ast.walk(tree) if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=='start' and len(node.args)>=2 and isinstance(node.args[1],ast.List) and any(isinstance(item,ast.Constant) and item.value=='pg_isready' for item in node.args[1].elts)]
 assert len(calls)==1;call=calls[0];assert isinstance(call.args[0],ast.Constant) and call.args[0].value=='DOCKER'
 argv=call.args[1].elts;assert isinstance(argv[0],ast.Call) and isinstance(argv[0].func,ast.Name) and argv[0].func.id=='str' and len(argv[0].args)==1 and isinstance(argv[0].args[0],ast.Name) and argv[0].args[0].id=='docker'
 assert isinstance(argv[2],ast.Name) and argv[2].id=='cid'
 assert [ast.literal_eval(item) for index,item in enumerate(argv) if index not in [0,2]]==['exec','pg_isready','-h','127.0.0.1','-p','5432','-U','luster_e2e_ci','-d','luster_e2e_ci_disposable']
 loops=[node for node in ast.walk(tree) if isinstance(node,ast.For) and call in list(ast.walk(node))];assert len(loops)==1
 loop=loops[0];assert isinstance(loop.iter,ast.Call) and isinstance(loop.iter.func,ast.Name) and loop.iter.func.id=='range' and [ast.literal_eval(arg) for arg in loop.iter.args]==[60]
 waits=[node for node in ast.walk(loop) if isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute) and node.func.attr=='wait'];assert len(waits)==1 and isinstance(waits[0].args[0],ast.Name) and waits[0].args[0].id=='item' and ast.literal_eval(waits[0].args[1])==3
readiness_source=(D/'run.py').read_text();readiness_contract(readiness_source)
for old,new in [("'pg_isready','-h','127.0.0.1','-p','5432'","'pg_isready'"),("'pg_isready','-h','127.0.0.1','-p','5432'","'pg_isready','-h','0.0.0.0','-p','5432'"),("'pg_isready','-h','127.0.0.1','-p','5432'","'pg_isready','-h','127.0.0.1','-p','55432'"),("'exec',cid,'pg_isready'","'exec',foreign_cid,'pg_isready'"),("for _ in range(60):","for _ in range(61):"),("c.wait(item,3)","c.wait(item,4)")]:
 assert old in readiness_source
 try:readiness_contract(readiness_source.replace(old,new,1))
 except AssertionError:pass
 else:raise AssertionError('weakened readiness command accepted')
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
print(json.dumps({'pureContracts':'PASS','actualOwnedContainerTcpReadinessArgvAndUnchangedBudget':'PASS','bootstrapFixedEnumSchemaPrivacyAndGuardOrder':'PASS','boundedSourceObservationCadenceAndForcedGuards':'PASS','actualSyntheticSourceCopyAndAllByteHashVerification':'PASS','activeDependencyGraph2777NodesTwoOrphans':'PASS','nestedHoistCyclePeersAndMandatoryEdges':'PASS','safeInstallErrorCodeProjectionAndChunkBoundaries':'PASS','exactManifestLibcEligibility':'PASS','missingRequiredAndCompatibleOptionalRefused':'PASS','boundedMissingNodeDiagnosis':'PASS','installCache512MiBBoundary':'PASS','unchangedInstallTree2GiBBoundary':'PASS','sourceSha':runner.SHA,'originalExpectCalls':245,'unchangedRetryAndSerializablePolicy':True,'eventAndWorkflowGuards':'PASS','effectiveCgroupMemoryFloor':'PASS','fakePopenRegistration':'PASS','allOwnedAndContainerRssAccounting':'PASS','guardFailureRolesRetained':'PASS','containerIdentityRefusal':'PASS','pidfdCleanupAndUnknownRefusal':'PASS','pendingDirectChildRefusal':'PASS','exactCgroupSubtreeOrphanAndFailureContracts':'PASS','vercelExactBranchAndCrons':'PASS','nativeServicesInstallOrNetworkExecuted':False}))
