#!/usr/bin/env python3
"""Pure mocked contracts: no subprocess, socket, provider, DB, or key reads."""
import ast
import runpy
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

scope = runpy.run_path(str(Path(__file__).with_name('controller.py')), run_name='offline_controller')
Controller, Stop = scope['Controller'], scope['Stop']
module = Controller.live_owned.__globals__
owner = module['os'].getpid()

def controller():
    result = Controller.__new__(Controller)
    result.children = []
    result.owned_groups = {111}
    result.owned_tokens = {111: 'birth-a'}
    result.unverified_groups = set()
    result.unknown_group_members = []
    result.unknown_group_member_count = 0
    result.classifiers = {key: 0 for key in ['oom', 'enospc', 'eaddrinuse', 'missingModule', 'compileFailure', 'traceBlocked', 'egressBlocked', 'envValidation']}
    result.classifier_tails = {}
    result.phase = 'source-copy'
    result.service_exit = None
    result.cleanup_failure_code = None
    result.cleanup_diagnostics = []
    result.service_stop_observations = []
    result.emit = lambda *args, **kwargs: None
    result.drain_stdio = lambda: None
    return result

def row(parent, group, birth, state='S'):
    return (parent, group, 100, state, birth)

c = controller()
table = {111: row(owner, 111, 'birth-a'), 112: row(111, 112, 'birth-b'), 113: row(112, 112, 'birth-c'), 222: row(1, 111, 'foreign')}
assert c.live_owned(table) == {111, 112, 113}
assert c.unverified_groups == {111}
# Leader exit, reparenting, and a reused historical PID/PGID cannot admit foreign ownership.
table = {111: row(1, 111, 'reused'), 112: row(1, 112, 'birth-b'), 113: row(1, 112, 'birth-c')}
assert c.live_owned(table) == {112, 113}
assert c.unverified_groups == {111}
# Initial identity-read failure remains recoverable through unreaped direct Popen identity.
c = controller(); c.owned_tokens.clear()
c.children = [{'process': SimpleNamespace(pid=111, returncode=None)}]
assert c.live_owned({111: row(owner, 111, 'birth-a')}) == {111}
c.children[0]['process'].returncode = 0
assert c.live_owned({111: row(1, 111, 'reused')}) == set()
# Register before any identity observation may fail.
c = controller(); c.children.clear()
fake = SimpleNamespace(pid=333, returncode=None)
c.register_identity = lambda _: (_ for _ in ()).throw(Stop('MOCK_IDENTITY_FAILURE'))
with patch.object(module['subprocess'], 'Popen', lambda *a, **k: fake):
    try: c.start('initdb', [], {}, Path('/'))
    except Stop: pass
    else: raise AssertionError('expected identity refusal')
assert c.children[0]['process'] is fake and 333 in c.owned_groups
# Cleanup never signals a foreign member; a mixed group gets individual proven PIDs only.
c = controller()
live = {111: row(owner, 111, 'birth-a'), 112: row(111, 112, 'birth-b'), 222: row(1, 111, 'foreign')}
c.table = lambda: live.copy()
calls = []
def kill(pid, sig):
    calls.append(('pid', pid)); live.pop(pid, None)
def killpg(group, sig):
    calls.append(('group', group))
    for pid in list(live):
        if live[pid][1] == group: live.pop(pid)
clock = iter(range(0, 10000, 100))
with patch.object(module['os'], 'kill', kill), patch.object(module['os'], 'killpg', killpg), patch.dict(module, time=SimpleNamespace(monotonic=lambda: next(clock), sleep=lambda _: None)):
    assert c.stop_all() is False  # foreign member means uncertainty + retained work
assert ('pid', 111) in calls and ('group', 112) in calls
assert ('group', 111) not in calls and ('pid', 222) not in calls
# Fixed classifier markers split across chunks count once; raw bytes never emitted.
c = controller(); identity = (1, 'stderr')
c.classify(identity, b'sensitive/path FATAL ERROR: reached heap ')
c.classify(identity, b'limit ENOSPC EADDRINUSE Cannot find mod')
c.classify(identity, b'ule Failed to compile')
c.classify(identity, b' FRESH_OWNER_TRACE_FILE_FORBIDDEN FRESH_OWNER_EGRESS_BLOCKED ZodError')
assert c.classifiers == {'oom': 1, 'enospc': 1, 'eaddrinuse': 1, 'missingModule': 1, 'compileFailure': 1, 'traceBlocked': 1, 'egressBlocked': 1, 'envValidation': 1}
assert all(len(value) <= 80 for value in c.classifier_tails.values())

# All PostgreSQL clients are explicitly TCP; server disables Unix socket output.
controller_source = Path(__file__).with_name('controller.py').read_text()
assert "'-k', ''," in controller_source and "work / 'pg-socket'" not in controller_source
assert "'-h', '127.0.0.1', '-p', '55432'" in controller_source

# A denied first group must not prevent independently proven Redis cleanup.
c = controller()
live = {111: row(owner, 111, 'birth-a'), 112: row(111, 112, 'birth-b')}
c.table = lambda: live.copy()
calls = []
def partially_failing_killpg(group, sig):
    calls.append(group)
    if group == 111: raise PermissionError('unretained private error text')
    for pid in list(live):
        if live[pid][1] == group: live.pop(pid)
clock = iter(range(0, 10000, 100))
with patch.object(module['os'], 'killpg', partially_failing_killpg), patch.dict(module, time=SimpleNamespace(monotonic=lambda: next(clock), sleep=lambda _: None)):
    assert c.stop_all() is False
assert 112 in calls and 112 not in live and 111 in live
assert c.cleanup_failure_code == 'OWNED_PROCESSES_REMAIN'
assert c.cleanup_diagnostics == [{'step': 'group-signal', 'exceptionEnum': 'PERMISSION_DENIED'}] * 2
assert 'private' not in str(c.cleanup_diagnostics)

# An initial ps failure causes no guessed signal; later fresh proof still stops all.
c = controller()
live = {111: row(owner, 111, 'birth-a'), 112: row(111, 112, 'birth-b')}
observations = [0]
def initially_failed_table():
    observations[0] += 1
    if observations[0] == 1: raise module['subprocess'].TimeoutExpired('unretained-command', 3)
    return live.copy()
c.table = initially_failed_table
calls = []
clock = iter(range(0, 10000, 100))
with patch.object(module['os'], 'killpg', killpg), patch.dict(module, time=SimpleNamespace(monotonic=lambda: next(clock), sleep=lambda _: None)):
    assert c.stop_all() is True
assert ('group', 111) in calls and ('group', 112) in calls
assert c.cleanup_failure_code is None
assert c.cleanup_diagnostics == [{'step': 'pass-observation', 'exceptionEnum': 'PROCESS_OBSERVATION_TIMEOUT'}]

# Leader exit evidence does not hide a previously observed reparented child.
c = controller(); c.owned_tokens[112] = 'birth-b'; c.owned_groups.add(112)
live = {112: row(1, 112, 'birth-b')}
c.table = lambda: live.copy()
c.children = [{'label': 'next', 'process': SimpleNamespace(pid=111, returncode=0, poll=lambda: 0)}]
calls = []
clock = iter(range(0, 10000, 100))
with patch.object(module['os'], 'killpg', killpg), patch.dict(module, time=SimpleNamespace(monotonic=lambda: next(clock), sleep=lambda _: None)):
    assert c.stop_all() is True
assert ('group', 112) in calls
assert c.service_stop_observations[0] == {'phase': 'before-term', 'service': 'next', 'leaderStatus': 'exited', 'exitCode': 0}

# Execute the actual finalizer's failure-selection prefix with mocked cleanup.
tree = ast.parse(controller_source)
execute_node = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'execute')
finalizer = next(node.finalbody for node in execute_node.body if isinstance(node, ast.Try) and node.finalbody)
failure_branch = next(index for index, node in enumerate(finalizer) if isinstance(node, ast.If) and isinstance(node.test, ast.UnaryOp) and isinstance(node.test.operand, ast.Name) and node.test.operand.id == 'stopped')
# Execute assignments + actual failure branch; the independent raw-discard drain is mocked separately.
selection = ast.Module(body=finalizer[:3] + [finalizer[failure_branch]], type_ignores=[])
ast.fix_missing_locations(selection)
selection_scope = {'failure': 'RENDER_INVITATION_HTTP_NOT_200', 'controller': SimpleNamespace(stop_all=lambda: False, cleanup_failure_code='OWNED_PROCESSES_REMAIN')}
exec(compile(selection, '<actual-failure-selection>', 'exec'), selection_scope)
assert selection_scope['primary_failure'] == 'RENDER_INVITATION_HTTP_NOT_200'
assert selection_scope['failure'] == 'RENDER_INVITATION_HTTP_NOT_200'
assert selection_scope['cleanup_failure'] == 'OWNED_PROCESSES_REMAIN'
# The actual final drain is capped, nonblocking, and independent of failing tick.
drain_node = next(node for node in finalizer if isinstance(node, ast.For))
drain_scope = {'controller': SimpleNamespace(drain_stdio=lambda: drains.append(1), cleanup_note=lambda *args: None)}
drains = []
exec(compile(ast.fix_missing_locations(ast.Module(body=[drain_node], type_ignores=[])), '<actual-final-drain>', 'exec'), drain_scope)
assert len(drains) == 32
# Functional UI envelope only: Next1536, other Node roles256; same fence/disk floor.
assert scope['ROLE_HEAP_MIB'] == {'bootstrap': 256, 'browser': 256, 'next': 1536}
assert scope['RSS_LIMIT_KIB'] == 4194304 and scope['FLOOR'] == 2147483648
for role, limit in [('next', 1536), ('bootstrap', 256), ('browser', 256)]:
    options = scope['node_options'](role)
    assert options.startswith('--max-old-space-size=' + str(limit) + ' --require=')
    assert options.endswith('/node-egress-guard.cjs')
try: scope['node_options']('unrecognized')
except Stop: pass
else: raise AssertionError('unknown Node role accepted')
# Verify actual child environment wiring, not just the helper constants.
app_assignment = next(node for node in ast.walk(execute_node) if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'app_env' for target in node.targets))
browser_assignment = next(node for node in ast.walk(execute_node) if isinstance(node, ast.Assign) and any(isinstance(target, ast.Name) and target.id == 'browser_env' for target in node.targets))
server_call = next(node for node in ast.walk(execute_node) if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'start' and node.args and isinstance(node.args[0], ast.Constant) and node.args[0].value == 'next')
for env_dict, role in [(app_assignment.value, 'bootstrap'), (browser_assignment.value, 'browser'), (server_call.args[2], 'next')]:
    actual = next(value for key, value in zip(env_dict.keys, env_dict.values) if isinstance(key, ast.Constant) and key.value == 'NODE_OPTIONS')
    assert isinstance(actual, ast.Call) and actual.func.id == 'node_options' and actual.args[0].value == role
# HTTP observations retain only numeric status + fixed Location class.
observe = scope['render_http_observation']; token = 'nonsecretprobe12345678901234567890'
cases = [
    (b'HTTP/1.1 200 OK', 'missing'),
    (b'HTTP/1.1 307 Temporary Redirect\r\nLocation: /join/' + token.encode(), 'same-origin-canonical-invite'),
    (b'HTTP/1.1 302 Found\r\nLocation: http://localhost:56512/join/' + token.encode(), 'same-origin-canonical-invite'),
    (b'HTTP/1.1 307 Temporary Redirect\r\nLocation: https://musical-muskox-47.clerk.accounts.dev/v1/client/handshake?secret=never-retained', 'bound-fapi-handshake'),
    (b'HTTP/1.1 307 Temporary Redirect\r\nLocation: https://foreign.example/v1/client/handshake', 'other'),
    (b'HTTP/1.1 307 Temporary Redirect\r\nLocation: https://musical-muskox-47.clerk.accounts.dev.evil.example/v1/client/handshake', 'other'),
    (b'HTTP/1.1 307 Temporary Redirect\r\nLocation: /join/' + token.encode() + b'?unknown=private', 'other'),
    (b'HTTP/1.1 307 Temporary Redirect\r\nLocation: /join/' + token.encode() + b'\r\nLocation: /other', 'other'),
]
for headers, category in cases:
    record = observe(headers, token)
    assert record['status'] == int(headers.split()[1]) and record['locationClass'] == category
    assert record['redirectFollowed'] is False and set(record) == {'status', 'locationClass', 'redirectFollowed'}
    assert token not in str(record) and 'never-retained' not in str(record)
assert "request = ('GET /join/' + invitation_token" in controller_source
# Throttling is confined to source extraction, with an unconditional final tick.
copy_node = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'copy_source')
assert any(isinstance(node, ast.Compare) and any(isinstance(value, ast.Constant) and value.value == 0.1 for value in node.comparators) for node in ast.walk(copy_node))
assert any(isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Attribute) and node.value.func.attr == 'tick' for node in copy_node.body)
render_node = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'render_ready')
assert not any(isinstance(node, ast.Constant) and node.value == 0.1 for node in ast.walk(render_node))
# Next's reconstructed origin must match BASE/publicURL/authorizedparties.
server_argv = server_call.args[1]
server_constants = [node.value for node in server_argv.elts if isinstance(node, ast.Constant)]
base_parts = module['urlsplit'](scope['BASE'])
assert server_constants[server_constants.index('--hostname') + 1] == base_parts.hostname == 'localhost'
assert int(server_constants[server_constants.index('--port') + 1]) == base_parts.port == 56512
# Unknown-member diagnostics are metadata-only, capped32, never ownership.
assert scope['RUNTIME_ENVELOPE'] == 'isolated-ubuntu-ci-functional-ui'
c = controller()
unknown = {pid: row(1, 111, 'unknown-birth-' + str(pid), 'Z' if pid == 200 else 'S') for pid in range(200, 240)}
assert c.live_owned({111: row(owner, 111, 'birth-a'), **unknown}) == {111}
assert c.unverified_groups == {111} and c.unknown_group_member_count == 40
assert len(c.unknown_group_members) == 32
assert all(set(record) == {'pid', 'parentPid', 'groupId', 'startToken', 'state'} for record in c.unknown_group_members)
assert c.unknown_group_members[0]['pid'] == 200 and c.unknown_group_members[0]['state'] == 'Z'
assert not any(pid in c.owned_tokens for pid in unknown)
# Transient unknown late children may disappear during existing deadlines;
# no identity promotion or unknown signal is permitted.
c = controller(); unknown = {222: row(1, 111, 'late-unknown', 'R')}; seen = [0]; now = [0.0]; signals = []
def transient_table():
    seen[0] += 1
    return unknown.copy() if seen[0] <= 3 else {}
c.table = transient_table
with patch.object(module['os'], 'kill', lambda *args: signals.append(('pid', args))), patch.object(module['os'], 'killpg', lambda *args: signals.append(('group', args))), patch.dict(module, time=SimpleNamespace(monotonic=lambda: now[0], sleep=lambda duration: now.__setitem__(0, now[0] + duration))):
    assert c.stop_all() is True
assert not signals and 0 < now[0] < 10 and c.cleanup_failure_code is None
assert 222 not in c.owned_tokens
# Persistent unknowns consume only the existing10+5second grace, then retain/fail.
c = controller(); now = [0.0]; signals = []; c.table = lambda: unknown.copy()
with patch.object(module['os'], 'kill', lambda *args: signals.append(('pid', args))), patch.object(module['os'], 'killpg', lambda *args: signals.append(('group', args))), patch.dict(module, time=SimpleNamespace(monotonic=lambda: now[0], sleep=lambda duration: now.__setitem__(0, now[0] + duration))):
    assert c.stop_all() is False
assert not signals and 15 <= now[0] <= 15.5
assert c.cleanup_failure_code == 'UNVERIFIED_PROCESS_GROUP_MEMBERS' and 222 not in c.owned_tokens
# Only fixed primary-verification status, bool/null capability, and count survive.
state = scope['safe_fresh_user_state']
for raw, expected in [('verified', 'verified'), ('unverified', 'unverified'), (None, 'missing'), ('expired', 'other')]:
    fixture = {'primary_email_address_id': 'opaque-email-id', 'email_addresses': [{'id': 'opaque-email-id', 'email_address': 'private-fixture@example.invalid', 'verification': {'status': raw}}], 'create_organization_enabled': True}
    record = state(fixture, 0)
    assert record == {'primaryEmailVerificationStatus': expected, 'createOrganizationEnabled': True, 'membershipCount': 0}
    assert 'private-fixture' not in str(record) and 'opaque-email-id' not in str(record)
assert state({}, 0) == {'primaryEmailVerificationStatus': 'missing', 'createOrganizationEnabled': None, 'membershipCount': 0}
assert state({'create_organization_enabled': False}, 0)['createOrganizationEnabled'] is False
assert state({'create_organization_enabled': 'true'}, 0)['createOrganizationEnabled'] is None
# Desktop-only observation wait: settle/timeout/rise/guard propagation.
headroom = scope['wait_for_browser_headroom']; threshold = scope['PRE_BROWSER_RSS_KIB']
assert threshold == 3145728 and scope['PRE_BROWSER_WAIT_SECONDS'] == 60
now = [0.0]; events = []; values = iter([threshold + 1, threshold - 1, threshold - 2])
fake = SimpleNamespace(tick=lambda: next(values), emit=lambda *args, **kwargs: events.append((args, kwargs)), pre_browser_headroom=None)
with patch.dict(module, time=SimpleNamespace(monotonic=lambda: now[0], sleep=lambda duration: now.__setitem__(0, now[0] + duration))):
    headroom(fake, 'desktop-chromium')
assert now[0] == 2 and fake.pre_browser_headroom['observations'] == 3
assert fake.pre_browser_headroom['consecutiveBelowThreshold'] == 2 and fake.pre_browser_headroom['waitApplied'] is True
assert fake.pre_browser_headroom['project'] == 'desktop-chromium'
now = [0.0]; values = iter([threshold - 1, threshold, threshold - 1, threshold - 1])
fake = SimpleNamespace(tick=lambda: next(values), emit=lambda *args, **kwargs: None, pre_browser_headroom=None)
with patch.dict(module, time=SimpleNamespace(monotonic=lambda: now[0], sleep=lambda duration: now.__setitem__(0, now[0] + duration))):
    headroom(fake, 'desktop-chromium')
assert now[0] == 3 and fake.pre_browser_headroom['observations'] == 4  # exactthreshold resets streak
now = [0.0]; fake = SimpleNamespace(tick=lambda: threshold + 1, emit=lambda *args, **kwargs: None, pre_browser_headroom=None)
with patch.dict(module, time=SimpleNamespace(monotonic=lambda: now[0], sleep=lambda duration: now.__setitem__(0, now[0] + duration))):
    try: headroom(fake, 'desktop-chromium')
    except Stop as error: assert str(error) == 'PRE_BROWSER_HEADROOM_TIMEOUT'
    else: raise AssertionError('headroom timeout missing')
assert now[0] == 60 and fake.pre_browser_headroom['elapsedMs'] == 60000
for guard in ['DISK_FLOOR', 'COMBINED_RSS_LIMIT', 'OPERATOR_STOP', 'CONTROLLER_DEADLINE', 'OWNED_SERVICE_LEADER_EXITED']:
    fake = SimpleNamespace(tick=lambda: (_ for _ in ()).throw(Stop(guard)), emit=lambda *args, **kwargs: None, pre_browser_headroom=None)
    try: headroom(fake, 'desktop-chromium')
    except Stop as error: assert str(error) == guard
    else: raise AssertionError('existing full tick guard swallowed')
fake = SimpleNamespace(tick=lambda: (_ for _ in ()).throw(AssertionError('WebKit must not wait')), emit=lambda *args, **kwargs: None, pre_browser_headroom=None)
headroom(fake, 'iphone-13-webkit')
assert fake.pre_browser_headroom['project'] == 'iphone-13-webkit' and fake.pre_browser_headroom['waitApplied'] is False
assert fake.pre_browser_headroom['observations'] == 0
print('{"offlineProcessContracts":"passed","interruptedCleanup":"continues-proven-groups","primaryFailurePreserved":true,"nativeSubprocessesStarted":0,"networkRequests":0,"secretValuesRead":false}')
