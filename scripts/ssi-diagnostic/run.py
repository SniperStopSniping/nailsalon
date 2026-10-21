#!/usr/bin/env python3
"""Secret-free, exact-source hosted diagnostic. No execution without --execute."""
from pathlib import Path
import argparse,hashlib,json,os,platform,re,secrets,shutil,socket,subprocess,tarfile,time
from urllib.parse import urlunsplit,urlencode
from linux_controller import Controller,require,digest,memory_info,effective_available,RSS_LIMIT,DISK_FLOOR
from patches import transform,HELPER,TEST
from report_protocol import safe_output,partial_driver
D=Path(__file__).resolve().parent
H=D.parent.parent
SHA='9793ab2220b813cef47505329c5e27c3ea2d040d'
BRANCH='codex/hosted-ssi-diagnostic-20261021'
IMAGE='mirror.gcr.io/library/postgres:16-alpine@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'
INSTALL_CACHE_LIMIT=512*1024**2
INSTALL_TREE_LIMIT=2*1024**3
ROOTS=['src','migrations','public','prototypes','package.json','package-lock.json','tsconfig.json','vitest-setup.ts','next-env.d.ts','next.config.mjs','postcss.config.js','tailwind.config.ts','components.json','sentry.client.config.ts']

def fixed_error(error):
 code=str(error);return code if re.fullmatch('[A-Z][A-Z0-9_]{1,100}',code) else 'FAILURE_REDACTED'
def write_json(path,value):
 body=json.dumps(value,sort_keys=True,indent=2).encode()+b'\n';require(len(body)<=1024**2,'SAFE_JSON_BOUND')
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(fd,'wb') as stream:stream.write(body);stream.flush();os.fsync(stream.fileno())
def git(app,*args):return subprocess.check_output(['git','-C',str(app),*args],stderr=subprocess.DEVNULL,timeout=10).decode().strip()
def source(app):
 pins=json.loads((D/'source-pins.json').read_text());require(app.is_dir() and not app.is_symlink(),'APPLICATION_DIRECTORY')
 require(git(app,'rev-parse','HEAD')==SHA and git(app,'rev-parse','HEAD^{tree}')==pins['sourceTree'] and not git(app,'status','--porcelain','--untracked-files=normal'),'APPLICATION_CHECKOUT_REJECTED')
 require(all(digest(app/name)==pin for name,pin in pins['files'].items()),'APPLICATION_INPUT_PIN')
 require(not (app/'.npmrc').exists() and all(p.name=='.env.example' for p in app.glob('.env*')),'APPLICATION_PRIVATE_CONFIG_FORBIDDEN')
 lines=git(app,'ls-tree','-r','HEAD','--',*ROOTS).splitlines();selected={}
 for line in lines:
  meta,name=line.split('\t',1);mode,kind,oid=meta.split();require(kind=='blob' and mode in ['100644','100755'] and '..' not in Path(name).parts,'SOURCE_MEMBER_REJECTED');selected[name]=oid
 require(selected and len(selected)<10000,'SOURCE_MEMBER_BOUND');return selected

def event_guard(env,event,harness_sha):
 require(env.get('GITHUB_ACTIONS')=='true' and env.get('RUNNER_ENVIRONMENT')=='github-hosted' and env.get('GITHUB_EVENT_NAME')=='push' and env.get('GITHUB_REPOSITORY')=='SniperStopSniping/nailsalon' and env.get('GITHUB_ACTOR')=='SniperStopSniping' and env.get('GITHUB_TRIGGERING_ACTOR')=='SniperStopSniping' and env.get('GITHUB_REF')=='refs/heads/'+BRANCH,'HOSTED_EVENT_REJECTED')
 require(event.get('ref')=='refs/heads/'+BRANCH and event.get('deleted') is False and event.get('after')==harness_sha==env.get('GITHUB_SHA') and event.get('repository',{}).get('full_name')=='SniperStopSniping/nailsalon','HOSTED_EVENT_PAYLOAD_REJECTED')
def bundle():
 pins=json.loads((D/'bundle-sha256.json').read_text());inputs=json.loads((D/'source-pins.json').read_text());require(inputs['applicationSha']==SHA and digest(D/'patches.py')==inputs['immutablePatchSha256'] and digest(D/'ssi-driver.cjs')==inputs['immutableDriverSha256'],'IMMUTABLE_DIAGNOSTIC_INPUT_PIN')
 require(all(not Path(name).is_absolute() and '..' not in Path(name).parts and digest(H/name)==pin for name,pin in pins.items()),'HARNESS_BUNDLE_PIN')
def platform_entries(lock_path):
 metadata=json.loads((D/'platform-eligibility.json').read_text());require(metadata['schemaVersion']==1 and metadata['applicationLockSha256']==digest(lock_path),'PLATFORM_METADATA_LOCK_PIN')
 return metadata['entries']
def platform_compatible(name,row,entries):
 def allows(values,target):return not values or '!'+target not in values and (not [v for v in values if not v.startswith('!')] or target in values or 'any' in values)
 libc=row.get('libc');extra=entries.get(name)
 if extra:
  require(row.get('optional') is True and libc is None and extra['version']==row['version'] and extra['integrity']==row.get('integrity') and extra['resolved']==row.get('resolved') and extra['name']==name.rsplit('node_modules/',1)[1] and extra['os']==row.get('os') and extra['cpu']==row.get('cpu') and extra['libc']==['musl'],'PLATFORM_METADATA_NODE_PIN')
  libc=extra['libc']
 return allows(row.get('os'),'linux') and allows(row.get('cpu'),'x64') and allows(libc,'glibc')
def resolve_lock_dependency(packages,parent,dependency):
 require(re.fullmatch(r'(?:@[A-Za-z0-9_.-]+/)?[A-Za-z0-9_.-]+',dependency) and '..' not in dependency.split('/'),'LOCK_DEPENDENCY_NAME')
 while True:
  candidate=(parent+'/' if parent else '')+'node_modules/'+dependency
  if candidate in packages:return candidate
  if not parent:return None
  parent=parent.rsplit('/node_modules/',1)[0] if '/node_modules/' in parent else ''
def active_lock_nodes(packages,entries):
 require('' in packages and len(packages)<=10000,'LOCK_GRAPH_BOUND')
 require(all(not name or name.startswith('node_modules/') and '..' not in Path(name).parts for name in packages),'LOCK_PATH_REJECTED')
 # All nonoptional lock nodes remain required, even if unreachable. Optional
 # descendants activate only through an active compatible dependency path.
 active={''}|{name for name,row in packages.items() if name and not row.get('optional')};pending=list(active)
 while pending:
  parent=pending.pop();row=packages[parent];optional=row.get('optionalDependencies',{});dependencies={**row.get('dependencies',{}),**(row.get('devDependencies',{}) if not parent else {}),**optional}
  for name,spec in row.get('peerDependencies',{}).items():
   if not row.get('peerDependenciesMeta',{}).get(name,{}).get('optional'):dependencies.setdefault(name,spec)
  for dependency in dependencies:
   child=resolve_lock_dependency(packages,parent,dependency)
   if child is None:
    require(dependency in optional,'LOCK_REQUIRED_EDGE_UNRESOLVED');continue
   if child not in active and platform_compatible(child,packages[child],entries):active.add(child);pending.append(child)
 return active
def installed(app,controller,diagnostics):
 lock_path=app/'package-lock.json';lock=json.loads(lock_path.read_text());entries=platform_entries(lock_path);active=active_lock_nodes(lock['packages'],entries);present=absent=required=manifest_absent=graph_absent=0
 require(set(entries)<=set(lock['packages']),'PLATFORM_METADATA_NODE_PIN')
 for i,(name,row) in enumerate(lock['packages'].items()):
  if not name:continue
  require(name.startswith('node_modules/') and '..' not in Path(name).parts,'LOCK_PATH_REJECTED');path=app/name/'package.json';compatible=platform_compatible(name,row,entries);needed=not row.get('optional') or name in active and compatible
  if needed:required+=1
  if path.is_file():
   path.resolve().relative_to(app.resolve());require(path.stat().st_size<=256*1024 and json.loads(path.read_text()).get('version')==row['version'],'INSTALLED_VERSION_MISMATCH');present+=1
  else:
   if needed:
    # Only this source-pinned public lock row is retained; no installer output.
    diagnostics['firstMissing']={'lockPath':name,'version':row['version'],'optional':bool(row.get('optional')),'os':row.get('os'),'cpu':row.get('cpu'),'lockLibc':row.get('libc'),'manifestLibc':entries.get(name,{}).get('libc'),'platformCompatible':compatible,'activeDependency':name in active}
    raise RuntimeError('REQUIRED_INSTALLED_NODE_MISSING')
   if compatible:graph_absent+=1
   else:absent+=1;manifest_absent+=int(name in entries)
  if i%64==0:controller.observe()
 return {'requiredNodes':required,'activeGraphNodes':len(active)-1,'inactiveCompatibleOptionalGraphNodes':[{'lockPath':name,'version':row['version']} for name,row in lock['packages'].items() if name and row.get('optional') and name not in active and platform_compatible(name,row,entries)],'presentNodes':present,'absentPlatformOptionals':absent,'absentManifestBoundMuslOptionals':manifest_absent,'absentInactiveGraphOptionals':graph_absent,'qualification':'Normal npm ci integrity verification; all nonoptional nodes, active compatible optional dependencies and every installed version checked. Optional peers alone do not force installation. Lock or exact version/SRI-bound public platform constraints prune inactive branches; not an independent byte scan.'}
def verify_copy(expected,root,controller=None):
 for i,(name,oid) in enumerate(expected.items()):
  path=root/name;require(path.is_file() and not path.is_symlink(),'COPIED_MEMBER_MISSING');data=path.read_bytes();require(hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()==oid,'COPIED_SOURCE_CHANGED')
  if controller and i%64==0:controller.observe()
 return {'checkedRuntimeFiles':len(expected),'unexpectedTrackedChanges':0}
def copy_source(app,work,expected,c):
 archive=work/'source.tar';item=c.start('SOURCE',['git','-C',str(app),'archive','--format=tar','--output',str(archive),SHA,'--',*ROOTS]);c.wait(item,30);require(archive.stat().st_size<=96*1024**2,'SOURCE_ARCHIVE_BOUND');target=work/'application';target.mkdir(mode=0o700);total=0
 with tarfile.open(archive) as tar:
  for member in tar:
   path=target/member.name;require(not member.name.startswith('/') and '..' not in Path(member.name).parts and (member.isfile() or member.isdir()),'SOURCE_ARCHIVE_MEMBER')
   if member.isdir():path.mkdir(parents=True,exist_ok=True,mode=0o700);continue
   require(member.name in expected and member.size<=32*1024**2,'SOURCE_ARCHIVE_FILE');total+=member.size;require(total<=64*1024**2,'SOURCE_COPY_BOUND');path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
   with tar.extractfile(member) as src,open(path,'xb') as out:shutil.copyfileobj(src,out,65536)
   os.chmod(path,0o700 if member.mode&0o111 else 0o600);c.observe()
 archive.unlink();verify_copy(expected,target,c);return target

def tree_bytes(root):
 if not root.exists():return 0
 total=count=0
 for directory,dirs,files in os.walk(root,followlinks=False):
  base=Path(directory)
  for name in dirs+files:
   path=base/name
   try:
    if path.is_symlink():path.resolve(strict=True).relative_to(root.resolve())
   except FileNotFoundError:continue
  dirs[:]=[name for name in dirs if not (base/name).is_symlink()]
  for name in files:
   path=base/name
   try:
    if not path.is_symlink():total+=path.stat().st_size;count+=1
   except FileNotFoundError:continue
   require(count<=150000,'OWNED_TREE_FILE_BOUND')
 return total

def install_storage_bounds(cache,modules):
 require(cache<=INSTALL_CACHE_LIMIT,'INSTALL_CACHE_LIMIT');require(modules<=INSTALL_TREE_LIMIT,'INSTALL_TREE_LIMIT')

def container_identity(row,name,tag,network):
 require(row.get('Id') and re.fullmatch('[a-f0-9]{64}',row['Id']) and row.get('Name')=='/'+name and row.get('Config',{}).get('Image')==IMAGE and row['Config'].get('Labels',{}).get('luster.ssi.run')==tag,'CONTAINER_IDENTITY_REJECTED')
 ports=row.get('HostConfig',{}).get('PortBindings',{});require(ports.get('5432/tcp')==[{'HostIp':'127.0.0.1','HostPort':'55432'}] and set(ports)=={'5432/tcp'},'CONTAINER_PORT_REJECTED')
 require(set(row.get('NetworkSettings',{}).get('Networks',{}))=={network},'CONTAINER_NETWORK_REJECTED')
 mounts=[m for m in row.get('Mounts',[]) if m.get('Destination')=='/var/lib/postgresql/data'];require(len(mounts)==1 and mounts[0].get('Type')=='volume' and re.fullmatch('[a-f0-9]{64}',mounts[0].get('Name','')),'CONTAINER_VOLUME_REJECTED');return row['Id'],mounts[0]['Name']

def execute():
 require(platform.system()=='Linux' and platform.machine()=='x86_64' and hasattr(os,'pidfd_open') and hasattr(__import__('signal'),'pidfd_send_signal'),'LINUX_PIDFD_REQUIRED')
 env=os.environ;workspace=Path(env['GITHUB_WORKSPACE']).resolve();require(H==workspace/'harness','HARNESS_WORKSPACE_REJECTED');app=workspace/'application';require(app.resolve()==app,'APPLICATION_PHYSICAL_PATH');harness_sha=git(H,'rev-parse','HEAD');event_guard(env,json.loads(Path(env['GITHUB_EVENT_PATH']).read_text()),harness_sha);bundle();expected=source(app)
 require(not git(H,'status','--porcelain','--untracked-files=normal'),'HARNESS_CHECKOUT_DIRTY');mem=memory_info();require(mem['MemTotal']>=6*1024**3 and effective_available(mem['MemAvailable'])>=3*1024**3,'INITIAL_MEMORY_RESERVE')
 require(re.fullmatch(r'\d+',env.get('GITHUB_RUN_ID','')),'RUN_ID_REQUIRED');temp=Path(env['RUNNER_TEMP']).resolve();require(temp.is_dir() and not temp.is_symlink() and temp.stat().st_uid==os.getuid(),'RUNNER_TEMP_REQUIRED');free=os.statvfs(temp);require(free.f_bavail*free.f_frsize>=8*1024**3,'INITIAL_DISK_RESERVE')
 safe=temp/'ssi-diagnostic-safe';safe.mkdir(mode=0o700,exist_ok=True);require(not safe.is_symlink() and safe.stat().st_uid==os.getuid() and safe.stat().st_mode&0o777==0o700,'SAFE_ROOT_OWNERSHIP');run=safe/('ssi-'+str(env['GITHUB_RUN_ID'])+'-'+secrets.token_hex(4));run.mkdir(mode=0o700);work=run/'owned-work';work.mkdir(mode=0o700);tag=run.name
 for directory in ['home','tmp','cache','config','docker-config']:(work/directory).mkdir(mode=0o700)
 for name in ['user.npmrc','global.npmrc','gitconfig']:(work/name).touch(mode=0o600)
 node=Path(shutil.which('node') or '').resolve();npm=Path(shutil.which('npm') or '').resolve();docker=Path(shutil.which('docker') or '').resolve();require(all(p.is_file() for p in [node,npm,docker]) and npm.is_relative_to(node.parent.parent),'REQUIRED_TOOL_BINDING')
 clean={'PATH':str(node.parent)+':/usr/local/bin:/usr/bin:/bin','HOME':str(work/'home'),'TMPDIR':str(work/'tmp'),'XDG_CONFIG_HOME':str(work/'config'),'XDG_CACHE_HOME':str(work/'cache'),'DOCKER_CONFIG':str(work/'docker-config'),'LANG':'C','LC_ALL':'C','TZ':'UTC','CI':'true','GITHUB_ACTIONS':'true','NODE_OPTIONS':'--max-old-space-size=256','NPM_CONFIG_USERCONFIG':str(work/'user.npmrc'),'NPM_CONFIG_GLOBALCONFIG':str(work/'global.npmrc'),'NPM_CONFIG_CACHE':str(work/'cache'),'NPM_CONFIG_LOGS_MAX':'0','NPM_CONFIG_UPDATE_NOTIFIER':'false','HUSKY':'0','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':str(work/'gitconfig')}
 c=Controller(work,clean);dependency_diagnostics={};failure=cleanup=None;failure_role=failure_exit=None;proof=dependency=bootstrap=source_proof=None;cid=volume=None;network='luster-'+tag;container='luster-'+tag;network_attempted=container_attempted=False;network_known=container_known=False;all_children=False;container_removed=network_removed=False;test=None;copied=None;changed={}
 write_json(run/'run-context.json',{'schemaVersion':1,'runTag':tag,'applicationSha':SHA,'harnessSha':harness_sha,'runId':str(env['GITHUB_RUN_ID']),'startedMs':int(time.time()*1000),'profile':'hosted-linux-2g-rss','realProviderCredentialsSupplied':False})
 try:
  require(c.wait(c.start('BOOTSTRAP',[str(node),'--version'],private=True),10).decode().strip()=='v24.19.0','NODE_VERSION_REJECTED');npm_version=c.wait(c.start('BOOTSTRAP',[str(node),str(npm),'--version'],private=True),10).decode().strip();require(re.fullmatch(r'\d+\.\d+\.\d+',npm_version),'NPM_VERSION_REJECTED')
  docker_root=Path(c.command([str(docker),'info','--format','{{.DockerRootDir}}']).decode().strip());require(docker_root.is_absolute() and docker_root.is_dir(),'DOCKER_STORAGE_ACCOUNTING_REQUIRED');space=os.statvfs(docker_root);require(space.f_bavail*space.f_frsize>=8*1024**3,'INITIAL_DOCKER_STORAGE_RESERVE');c.disk_paths.append(docker_root)
  storage={'last':0,'peakCacheBytes':0,'peakInstallBytes':0}
  def storage_check():
   if time.monotonic()-storage['last']<1:return
   storage['last']=time.monotonic();cache=tree_bytes(work/'cache');modules=tree_bytes(app/'node_modules');storage['peakCacheBytes']=max(storage['peakCacheBytes'],cache);storage['peakInstallBytes']=max(storage['peakInstallBytes'],modules);install_storage_bounds(cache,modules)
  c.extra_check=storage_check
  installenv={**clean,'NPM_CONFIG_USERCONFIG':str(work/'user.npmrc'),'NPM_CONFIG_GLOBALCONFIG':str(work/'global.npmrc'),'NPM_CONFIG_CACHE':str(work/'cache'),'NPM_CONFIG_REGISTRY':'https://registry.npmjs.org/','NPM_CONFIG_AUDIT':'false','NPM_CONFIG_FUND':'false','NPM_CONFIG_UPDATE_NOTIFIER':'false','NPM_CONFIG_LOGS_MAX':'0','NPM_CONFIG_FETCH_RETRIES':'0','NPM_CONFIG_FETCH_TIMEOUT':'15000','NPM_CONFIG_MAXSOCKETS':'4'}
  install=c.start('INSTALL',[str(node),str(npm),'ci','--no-audit','--no-fund','--fetch-retries=0','--fetch-timeout=15000','--maxsockets=4'],installenv,app);c.wait(install,600);dependency=installed(app,c,dependency_diagnostics);source(app)
  # Installation intentionally runs normal trusted exact-lock lifecycle/network.
  copied=copy_source(app,work,expected,c);(copied/'node_modules').symlink_to(app/'node_modules',target_is_directory=True)
  changed=transform((copied/HELPER).read_text(),(copied/TEST).read_text())
  for name,text in changed.items():
   (copied/name).write_text(text);data=text.encode();expected[name]=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
  (copied/'vitest.ssi.config.mts').write_text("import {defineConfig} from 'vitest/config';import tsconfigPaths from 'vite-tsconfig-paths';export default defineConfig({plugins:[tsconfigPaths()],cacheDir:process.env.SSI_VITE_CACHE,test:{include:['src/libs/appointmentCreation.customerOperation.concurrency.integration.test.ts'],setupFiles:['./vitest-setup.ts'],fileParallelism:false,maxWorkers:1,pool:'threads',isolate:true,execArgv:['--require',process.env.SSI_FENCE,'--require',process.env.SSI_DRIVER],reporters:[process.env.SSI_SAFE_REPORTER],testTimeout:120000,hookTimeout:120000}});")
  thread_contract=json.loads(c.wait(c.start('BOOTSTRAP',[str(node),str(D/'contract.cjs')],{**clean,'SSI_CONTRACT_APP':str(app),'SSI_SOURCE_ROOT':str(copied)},copied,True),15));require(thread_contract.get('realWorkerThreadPreload')=='PASS' and thread_contract.get('nativeDatabaseOrNetwork') is False,'THREAD_PRELOAD_CONTRACT')
  c.command([str(docker),'pull',IMAGE],120,private=False);size=int(c.command([str(docker),'image','inspect','--format','{{.Size}}',IMAGE]));require(0<size<=512*1024**2,'PG_IMAGE_SIZE_BOUND')
  with socket.socket() as probe:
   try:probe.bind(('127.0.0.1',55432))
   except OSError:raise RuntimeError('OWNED_PORT_OCCUPIED') from None
  network_attempted=True;raw=c.command([str(docker),'network','create','--internal','--label','luster.ssi.run='+tag,network]);require(re.fullmatch(b'[a-f0-9]{64}\n?',raw),'OWNED_NETWORK_CREATE');network_known=True
  password=secrets.token_hex(24);pg_env={**clean,'POSTGRES_PASSWORD':password,'POSTGRES_USER':'luster_e2e_ci','POSTGRES_DB':'luster_e2e_ci_disposable'};container_attempted=True
  raw=c.wait(c.start('DOCKER',[str(docker),'run','-d','--rm','--log-driver','none','--name',container,'--label','luster.ssi.run='+tag,'--network',network,'--publish','127.0.0.1:55432:5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_USER','--env','POSTGRES_DB',IMAGE,'postgres','-c','max_connections=40','-c','shared_buffers=16MB','-c','work_mem=1MB','-c','max_wal_size=64MB','-c','min_wal_size=32MB','-c','fsync=on','-c','full_page_writes=on','-c','log_statement=none','-c','log_min_error_statement=panic'],pg_env,private=True),30);require(re.fullmatch(b'[a-f0-9]{64}\n?',raw),'OWNED_CONTAINER_CREATE');container_known=True
  row=json.loads(c.command([str(docker),'inspect',container]))[0];cid,volume=container_identity(row,container,tag,network);pid=row['State']['Pid'];require(row['State']['Running'] and type(pid) is int and pid>1,'OWNED_CONTAINER_RUNNING');c.attach_container(pid,cid)
  # Readiness executes only the fixed bundled PG utility, not SQL/customer data.
  ready=False
  for _ in range(60):
   item=c.start('DOCKER',[str(docker),'exec',cid,'pg_isready','-U','luster_e2e_ci','-d','luster_e2e_ci_disposable'])
   try:c.wait(item,3);ready=True;break
   except RuntimeError as error:
    require(str(error)=='CHILD_EXIT_FAILED','PG_READINESS_GUARD');time.sleep(.2)
  require(ready,'PG_READINESS_TIMEOUT');control=c.command([str(docker),'exec',cid,'pg_controldata','/var/lib/postgresql/data']);match=re.search(rb'^Database system identifier:\s*(\d+)\s*$',control,re.M);require(match is not None,'PG_SYSTEM_ID_REQUIRED');system=match.group(1).decode()
  url=urlunsplit(('postgresql','luster_e2e_ci:'+password+'@127.0.0.1:55432','/luster_e2e_ci_disposable',urlencode({'application_name':'luster-e2e-ci-disposable'}),''));runtime={**clean,'NODE_ENV':'test','APP_ENV':'development','BILLING_PLAN_ENV':'test','DATABASE_URL':url,'CONCURRENCY_TEST_DATABASE_URL':url,'LUSTER_DISPOSABLE_DATABASE':'true','CUSTOMER_BOOKING_PG_REQUIRED':'true','LUSTER_DISPOSABLE_POSTGRES_CONTAINER_ID':cid,'LUSTER_DISPOSABLE_POSTGRES_NETWORK':network,'SSI_RUNTIME_COPY':str(copied),'SSI_PG_SYSTEM_ID':system,'CLERK_SECRET_KEY':'ci-placeholder-not-a-secret','NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY':'pk_test_Y2kubHVzdGVyLmludmFsaWQk','STRIPE_SECRET_KEY':'ci-placeholder-not-a-secret','STRIPE_WEBHOOK_SECRET':'ci-placeholder-not-a-secret','STRIPE_CONNECT_WEBHOOK_SECRET':'ci-placeholder-not-a-secret','NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY':'ci-placeholder-not-a-secret','COMMUNICATIONS_SMS_ENABLED':'false','GOOGLE_CALENDAR_ENABLED':'false','NETWORK_NO_SHOW_ENABLED':'false','LUSTER_SCALE_ALLOWED_HOST':'127.0.0.1','LUSTER_SCALE_ALLOWED_PORT':'55432','NODE_OPTIONS':'--max-old-space-size=256 --require='+str(D/'network-fence.cjs')}
  bootstrap=json.loads(c.wait(c.start('BOOTSTRAP',[str(node),'--conditions=react-server','--import',str(copied/'node_modules/tsx/dist/loader.mjs'),str(D/'bootstrap.mts')],runtime,copied,True),120));require(bootstrap=={'migrationCount':113,'ownedClusterAttested':True},'MIGRATIONS_ATTESTATION')
  testenv={**runtime,'SSI_DIAGNOSTIC_ENABLE':'1','SSI_FENCE':str(D/'network-fence.cjs'),'SSI_DRIVER':str(D/'ssi-driver.cjs'),'SSI_SAFE_REPORTER':str(D/'safe-reporter.mjs'),'SSI_VITE_CACHE':str(work/'vite-cache'),'NODE_OPTIONS':runtime['NODE_OPTIONS']+' --require='+str(D/'ssi-driver.cjs')}
  test=c.start('TEST',[str(node),str(copied/'node_modules/vitest/vitest.mjs'),'run','--config','vitest.ssi.config.mts','--configLoader','native','--maxWorkers=1','--no-file-parallelism','--bail=1','-t','completes five fresh rounds of'],testenv,copied,True);proof=safe_output(c.wait(test,240));source_proof=verify_copy(expected,copied,c);source(app)
 except BaseException as error:
  failure=fixed_error(error);failure_role=c.children[-1]['role'] if c.children else None;failure_exit=c.children[-1]['process'].returncode if c.children else None
  if test:
   try:proof=partial_driver(bytes(test['buffer']))
   except BaseException:pass
 finally:
  try:all_children=c.stop_children()
  except BaseException:cleanup='OWNED_CHILD_STOP_UNCERTAIN'
  # Docker mutations are tracked by exact unique labels before launch, including
  # interrupted create responses. No foreign group/PID/container is signaled.
  try:
   if container_attempted:
    ids=c.command([str(docker),'container','ls','-a','--no-trunc','--filter','label=luster.ssi.run='+tag,'--format','{{.ID}}'],cleanup=True).decode().split();require(len(ids)<=1,'OWNED_CONTAINER_MULTIPLE')
    if ids:
     row=json.loads(c.command([str(docker),'inspect',ids[0]],cleanup=True))[0];owned_id,owned_volume=container_identity(row,container,tag,network);volume=volume or owned_volume;c.command([str(docker),'stop','--time','5',owned_id],seconds=10,cleanup=True)
    c.container_stopped=True;remaining=c.command([str(docker),'container','ls','-a','--no-trunc','--filter','label=luster.ssi.run='+tag,'--format','{{.ID}}'],cleanup=True).strip();require(not remaining,'OWNED_CONTAINER_RETAINED');require(container_known,'OWNED_CONTAINER_CREATION_UNCERTAIN')
   if volume:
    require(not c.command([str(docker),'volume','ls','--filter','name=^'+volume+'$','--format','{{.Name}}'],cleanup=True).strip(),'OWNED_VOLUME_RETAINED')
   container_removed=True
  except BaseException as error:cleanup=cleanup or fixed_error(error)
  try:
   if network_attempted:
    # Network creation success is known before proceeding; identity is rechecked.
    if network_known:
     network_row=json.loads(c.command([str(docker),'network','inspect',network],cleanup=True))[0];require(network_row.get('Name')==network and network_row.get('Labels',{}).get('luster.ssi.run')==tag and not network_row.get('Containers'),'OWNED_NETWORK_IDENTITY');c.command([str(docker),'network','rm',network],cleanup=True);require(not c.command([str(docker),'network','ls','--filter','label=luster.ssi.run='+tag,'--format','{{.Name}}'],cleanup=True).strip(),'OWNED_NETWORK_RETAINED')
    require(network_known,'OWNED_NETWORK_CREATION_UNCERTAIN')
   network_removed=True
  except BaseException as error:cleanup=cleanup or fixed_error(error)
  try:all_children=c.stop_children() and all_children
  except BaseException:cleanup=cleanup or 'OWNED_CHILD_STOP_UNCERTAIN'
  if not all_children:cleanup=cleanup or 'OWNED_CHILD_STOP_UNCERTAIN'
  if c.unknown:cleanup=cleanup or 'UNKNOWN_PROCESS_GROUP_MEMBERS'
  for item in c.children:item['buffer'].clear()
  if all_children and container_removed and network_removed and not cleanup:
   try:require(work.parent==run and not work.is_symlink() and work.stat().st_uid==os.getuid(),'WORK_OWNERSHIP');shutil.rmtree(work)
   except BaseException:cleanup=cleanup or 'OWNED_WORK_RETAINED'
  result={'schemaVersion':1,'applicationSha':SHA,'harnessSha':harness_sha,'profile':'hosted-linux-2g-rss','primaryFailureCode':failure,'failureRole':failure_role,'failureChildExitCode':failure_exit,'cleanupFailureCode':cleanup,'proof':proof,'nativeBootstrap':bootstrap,'installed':dependency,'dependencyValidation':dependency_diagnostics,'sourceVerification':source_proof,'patchPostimageSha256':{name:hashlib.sha256(text.encode()).hexdigest() for name,text in changed.items()},'threadContract':locals().get('thread_contract'),'installStorage':locals().get('storage'),'installErrors':install['installErrors'].snapshot() if 'install' in locals() else {'firstRecognizedCode':'UNKNOWN','codeCounts':{},'unrecognizedCodeLines':0,'rawLinesUrlsValuesRetained':False},'tools':{'nodeBinarySha256':digest(node),'npmCliSha256':digest(npm),'nodeVersion':'v24.19.0','npmVersion':locals().get('npm_version')},'limits':{'installCacheBytes':INSTALL_CACHE_LIMIT,'installTreeBytes':INSTALL_TREE_LIMIT,'aggregateRssBytes':RSS_LIMIT,'nodeOldSpaceMiB':256,'workerTotalHeapNotClaimed256':True,'diskFloorBytes':DISK_FLOOR,'availableMemoryFloorBytes':2*1024**3,'deadlineSeconds':1200,'poolMax':32,'postgresMaxConnections':40,'salons':25,'rounds':1},'observed':{'peakAggregateRssBytes':c.peak,'minFreeBytes':c.minimum_disk,'minAvailableMemoryBytes':c.minimum_available,'lastRoles':c.last_roles,'rolePeakRssBytes':c.role_peaks},'cleanup':{'ownedChildrenStopped':all_children,'containerRemoved':container_removed,'networkRemoved':network_removed,'unknownGroupMembers':c.unknown,'workRetained':work.exists()},'classifiers':c.classifiers,'workloadPerturbed':True,'baselinePerformanceClaim':False,'rawLogsSqlParametersRetained':False,'providerCredentialsSupplied':False,'installQualification':'Normal trusted exact-lock npm ci with public lifecycle/network; not OS containment.'};write_json(run/'result.json',result);c.close();print(json.dumps({'resultFile':str(run/'result.json'),'primaryFailureCode':failure,'failureRole':failure_role,'failureChildExitCode':failure_exit,'cleanupFailureCode':cleanup}))
 return 0 if proof and not failure and not cleanup else 1

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--execute',action='store_true');args=parser.parse_args();require(args.execute,'PREPARATION_ONLY_REVIEW_REQUIRED');return execute()
if __name__=='__main__':
 os.umask(0o077)
 try:raise SystemExit(main())
 except BaseException as error:
  if isinstance(error,SystemExit):raise
  print(json.dumps({'status':'refused','failureCode':fixed_error(error)}));raise SystemExit(1)
