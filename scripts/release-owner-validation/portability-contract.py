#!/usr/bin/env python3
"""Pure CI policy/key/hardware contracts. No Git/process/network/key access."""
import ast
import base64
import copy
import json
import os
from pathlib import Path
import runpy
from types import SimpleNamespace
from unittest.mock import patch

scope = runpy.run_path(str(Path(__file__).with_name('controller.py')), run_name='offline_portability')
check = scope['ci_context']; module = check.__globals__; Stop = scope['Stop']
assert scope['CANDIDATE'].name == 'application'
assert scope['FLOOR'] == 2 * 1024**3 and scope['INITIAL_RESERVE'] == 2 * 1024**3
assert scope['MIN_RAM_BYTES'] == 7 * 1024**3 and scope['MIN_AVAILABLE_RAM_BYTES'] == 5 * 1024**3
assert scope['RSS_LIMIT_KIB'] == 4 * 1024**2
assert scope['ROLE_HEAP_MIB'] == {'bootstrap': 256, 'browser': 256, 'next': 1536}
assert scope['DEADLINE_SECONDS'] == 1200
sha = 'a' * 40
event = {'pull_request': {'user': {'login': 'SniperStopSniping'}, 'base': {'ref': 'main'},
    'head': {'sha': sha, 'ref': 'codex/fresh-owner-release-validation-20261021',
             'repo': {'full_name': 'SniperStopSniping/nailsalon', 'fork': False}}}}
env = {'GITHUB_RUN_ID': '123456789', 'GITHUB_ACTIONS': 'true', 'GITHUB_EVENT_NAME': 'pull_request', 'GITHUB_REPOSITORY': 'SniperStopSniping/nailsalon',
       'GITHUB_ACTOR': 'SniperStopSniping', 'GITHUB_TRIGGERING_ACTOR': 'SniperStopSniping', 'FRESH_OWNER_HARNESS_SHA': sha}
class Event:
    def is_file(self): return True
    def stat(self): return SimpleNamespace(st_size=1024)
    def read_text(self): return json.dumps(current)
current = copy.deepcopy(event)
def git_read(argv, **kwargs): return sha + '\n' if 'rev-parse' in argv else ''
overrides = {'WORKSPACE': Path('/workspace'), 'HARNESS': Path('/workspace/harness'), 'CANDIDATE': Path('/workspace/application'),
             'Path': lambda _: Event(), 'physical': lambda *_: None}
with patch.dict(module, overrides), patch.dict(os.environ, env, clear=True), patch.object(module['subprocess'], 'check_output', git_read):
    assert check()['harnessSha'] == sha
    for key, value in [('GITHUB_EVENT_NAME', 'pull_request_target'), ('GITHUB_ACTOR', 'other'), ('GITHUB_TRIGGERING_ACTOR', 'other'), ('GITHUB_REPOSITORY', 'fork/nailsalon'), ('FRESH_OWNER_HARNESS_SHA', 'b' * 40)]:
        with patch.dict(os.environ, {key: value}):
            try: check()
            except Stop: pass
            else: raise AssertionError('unsafe CI context accepted')
    for mutate in [lambda pr: pr['user'].update(login='other'), lambda pr: pr['head']['repo'].update(fork=True),
                   lambda pr: pr['head']['repo'].update(full_name='fork/nailsalon'), lambda pr: pr['head'].update(ref='other'),
                   lambda pr: pr['base'].update(ref='unreviewed')]:
        current = copy.deepcopy(event); mutate(current['pull_request'])
        try: check()
        except Stop: pass
        else: raise AssertionError('unsafe PR payload accepted')
    current = copy.deepcopy(event)
    with patch.object(module['subprocess'], 'check_output', lambda argv, **_: sha if 'rev-parse' in argv else ' M tracked'):
        try: check()
        except Stop as error: assert str(error) == 'EXACT_CLEAN_HARNESS_HEAD_REQUIRED'
        else: raise AssertionError('dirty harness accepted')
# Keys are read only from execution env, consumed from parent env, never files.
load = scope['load_clerk_keys']; public = 'pk_test_' + base64.urlsafe_b64encode((scope['FRONTEND'] + '$').encode()).decode()
with patch.dict(os.environ, {'CLERK_SECRET_KEY': 'sk_test_' + 'x' * 30, 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY': public}, clear=True):
    assert load() == ('sk_test_' + 'x' * 30, public)
    assert 'CLERK_SECRET_KEY' not in os.environ and 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY' not in os.environ
for secret, public_value in [('', public), ('sk_live_' + 'x' * 30, public), ('sk_test_' + 'x' * 30, 'pk_test_' + base64.urlsafe_b64encode(b'foreign.example$').decode())]:
    with patch.dict(os.environ, {'CLERK_SECRET_KEY': secret, 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY': public_value}, clear=True):
        try: load()
        except Stop: pass
        else: raise AssertionError('invalid realm/key accepted')
# Hardware preflight fails closed for low RAM, availability, disk or non-Linux.
hardware = scope['hardware_preflight']; available = [6 * 1024**3]; disk = [5 * 1024**3]; total = [8 * 1024**3]
class MemInfo:
    def read_text(self): return 'MemTotal: 8388608 kB\nMemAvailable: ' + str(available[0] // 1024) + ' kB\n'
with patch.dict(module, {'Path': lambda _: MemInfo(), 'physical': lambda *_: None, 'free': lambda: disk[0]}), patch.object(module['os'], 'uname', lambda: SimpleNamespace(sysname='Linux')), patch.object(module['os'], 'sysconf', lambda name: total[0] // 4096 if name == 'SC_PHYS_PAGES' else 4096):
    assert hardware()['physicalRamBytes'] == 8 * 1024**3
    for target, value in [(total, 6 * 1024**3), (available, 4 * 1024**3), (disk, 3 * 1024**3)]:
        old = target[0]; target[0] = value
        try: hardware()
        except Stop: pass
        else: raise AssertionError('insufficient runner accepted')
        target[0] = old
# Linux observation uses actual field22 start tick; no process argv/env read.
source = Path(__file__).with_name('controller.py').read_text(); tree = ast.parse(source)
assert "'/stat'" in source and 'fields[19]' in source
assert '/environ' not in source and '/cmdline' not in source and 'KEY_SOURCE' not in source
assert 'PLAYWRIGHT_BROWSERS_PATH' in source and "'GITHUB_WORKSPACE': str(WORKSPACE)" in source and "'RUNNER_TEMP': str(TEMP_ROOT)" in source
execute = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'execute')
statements = [ast.unparse(node) for node in execute.body]
assert next(i for i, text in enumerate(statements) if text.startswith('clerk.guard()')) < next(i for i, text in enumerate(statements) if text.startswith('private ='))
workflow = Path(__file__).resolve().parents[2] / '.github/workflows/release-owner-validation.yml'
yaml = workflow.read_text()
assert 'pull_request_target:' not in yaml and 'workflow_dispatch:' not in yaml and 'push:' not in yaml
assert 'persist-credentials: false' in yaml and 'contents: read' in yaml and 'max-parallel: 2' in yaml
assert yaml.count('secrets.') == 2
assert yaml.index('Install exact application dependencies') < yaml.index('secrets.CLERK_SECRET_KEY')
assert yaml.index('Install browser and OS dependencies') < yaml.index('secrets.CLERK_SECRET_KEY')
# Explicit signed apt/native provisioning and its complete timeout/service policy
# remain in the credential-free step, before either existing secret is injected.
prerequisites = yaml[yaml.index('      - name: Native runner prerequisites'):yaml.index('      - name: Install exact application dependencies')]
assert yaml.index('Native runner prerequisites') < yaml.index('secrets.CLERK_SECRET_KEY')
assert 'secrets.' not in prerequisites and 'timeout-minutes: 10' in prerequisites
assert '180s sudo -n env DEBIAN_FRONTEND=noninteractive apt-get' in prerequisites
assert '360s sudo -n env DEBIAN_FRONTEND=noninteractive apt-get' in prerequisites
assert 'install -y --no-install-recommends postgresql-16 postgresql-client-16 redis-server' in prerequisites
assert 'policy-rc.d' in prerequisites and 'set -C' in prerequisites and 'trap cleanup_policy EXIT' in prerequisites
assert 'NATIVE_POLICY_IDENTITY_CHANGED_RETAINED' in prerequisites
assert 'postgres16ToolsPresent' in prerequisites and 'redisPresent' in prerequisites and 'node24Present' in prerequisites
assert 'NATIVE_POSTGRES16_TOOLS_MISSING' in prerequisites and 'NATIVE_REDIS_MISSING' in prerequisites
assert 'NATIVE_DEFAULT_SERVICE_STILL_ACTIVE' in prerequisites
assert 'owned-work' not in yaml and 'browser-output' not in yaml and '**' not in yaml

# Exercise actual Linux process parser with no native ps/proc reads.
Controller = scope['Controller']; table = Controller.__new__(Controller)
fields = ['S', '1', '123'] + ['0'] * 16 + ['987654']
class ProcStat:
    def read_text(self): return '123 (name with spaces) ' + ' '.join(fields)
with patch.object(module['subprocess'], 'run', lambda *args, **kwargs: SimpleNamespace(returncode=0, stdout='123 1 123 100 S\n')), patch.dict(module, {'Path': lambda _: ProcStat()}):
    assert table.table() == {123: (1, 123, 100, 'S', '987654')}
    fields[1] = '2'
    try: table.table()
    except Stop as error: assert str(error) == 'PROCESS_OBSERVATION_INVALID'
    else: raise AssertionError('torn ancestry observation accepted')
# Actual Clerk instance guard accepts only one fixed Development instance.
Clerk = scope['Clerk']
for instance, accepted in [({'id': scope['INSTANCE'], 'environment_type': 'development'}, True),
                           ({'id': 'ins_foreign', 'environment_type': 'development'}, False),
                           ({'id': scope['INSTANCE'], 'environment_type': 'production'}, False)]:
    client = Clerk.__new__(Clerk); client.request = lambda *_: instance
    try: client.guard()
    except Stop: assert not accepted
    else: assert accepted

# Evaluate the ACTUAL database URL construction with synthetic generated hex.
# Source contains no credential-shaped URL literal; connection semantics match.
url_assignment = next(node for node in ast.walk(execute) if isinstance(node, ast.Assign)
                      and any(isinstance(target, ast.Name) and target.id == 'database_url' for target in node.targets))
assert isinstance(url_assignment.value, ast.Call) and url_assignment.value.func.id == 'urlunsplit'
synthetic_password = '0123456789abcdef' * 3
constructed = eval(compile(ast.Expression(url_assignment.value), '<actual-owned-db-url>', 'eval'),
                   {'urlunsplit': scope['urlunsplit'], 'quote': scope['quote'], 'urlencode': scope['urlencode'], 'password': synthetic_password})
parsed = scope['urlsplit'](constructed)
assert parsed.scheme == 'postgresql' and parsed.hostname == '127.0.0.1' and parsed.port == 55432
assert parsed.username == 'luster_e2e_ci' and parsed.password == synthetic_password
assert parsed.path == '/luster_e2e_ci_disposable' and parsed.query == 'application_name=luster-e2e-ci-disposable'
assert parsed.fragment == ''

print('{"portabilityContracts":"passed","nativeProcessesStarted":0,"providerCalls":0,"realSecretValuesRead":false}')
