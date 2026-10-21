#!/usr/bin/env python3
"""PREP default. Explicit CI execution starts isolated Development acceptance.

Never reads key values during preparation. No shell, raw stdio logs, credential
files, provider config writes, auth bypass, production build, or shared cleanup.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import selectors
import select
import secrets
import shutil
import signal
import socket
import ssl
import stat
import subprocess
import tarfile
import time
from datetime import datetime, timezone
from urllib.parse import quote, urlencode, urljoin, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parent
HARNESS = ROOT.parents[1]
WORKSPACE = Path(os.environ.get('GITHUB_WORKSPACE', '/nonexistent-release-owner-workspace'))
CANDIDATE = WORKSPACE / 'application'
BROWSER_ROOT = HARNESS / 'tests/releaseOwnerValidation'
TEMP_ROOT = Path(os.environ.get('RUNNER_TEMP', '/nonexistent-release-owner-temp'))
NODE = Path(shutil.which('node') or '/nonexistent-release-owner-node').resolve()
PG = Path('/usr/lib/postgresql/16/bin')
REDIS = Path(shutil.which('redis-server') or '/nonexistent-release-owner-redis').resolve()
SHA = 'b81137ef8bdc55e58030abe109d2d468f6c85e54'
INSTANCE = 'ins_36SfkrDmDOTiW6pXA8Qo6RzsSfe'
FRONTEND = 'musical-muskox-47.clerk.accounts.dev'
BASE = 'http://localhost:56512'
FLOOR = 2 * 1024 * 1024 * 1024
INITIAL_RESERVE = 2 * 1024 * 1024 * 1024
MIN_RAM_BYTES = 7 * 1024 * 1024 * 1024
MIN_AVAILABLE_RAM_BYTES = 5 * 1024 * 1024 * 1024
RUNTIME_ENVELOPE = 'isolated-ubuntu-ci-functional-ui'
RSS_LIMIT_KIB = 4 * 1024 * 1024
ROLE_HEAP_MIB = {'bootstrap': 256, 'browser': 256, 'next': 1536}
PRE_BROWSER_RSS_KIB = 3 * 1024 * 1024
PRE_BROWSER_WAIT_SECONDS = 60
DEADLINE_SECONDS = 1200
RUNTIME_DIRS = {'src', 'public', 'prototypes', 'migrations', 'scripts', 'tools'}
ROOT_FILES = {'package.json', 'package-lock.json', 'next.config.mjs', 'next-env.d.ts', 'tsconfig.json', 'postcss.config.js', 'tailwind.config.ts', 'sentry.client.config.ts', 'components.json'}
BROWSER_PINS = {
 'fresh-owner.acceptance.ts': 'f06992b6a45227081ba88e9effd051fcb314cd6ac525bb577743eb10c67652e5',
 'fresh-owner-safe-diagnostics.ts': '7037ccb8b133f2a2482cd715b5d4c49a73ed45f2620cebb83cd97b9b6119057b',
 'playwright.config.mts': '9408fd8260e24d3932b636d2daa62eb45fa545a769fe550b34133cedb2319dc0',
 'safe-reporter.mts': '8421b020e6739ac8adc3f9856f26a138f55d02f96db0772f25dd893d545f134b',
}

class Stop(RuntimeError):
    pass

class RenderOnlyComplete(Exception):
    pass

def require(value: bool, code: str) -> None:
    if not value:
        raise Stop(code)

def node_options(role: str) -> str:
    require(role in ROLE_HEAP_MIB, 'NODE_ROLE_REJECTED')
    return '--max-old-space-size=' + str(ROLE_HEAP_MIB[role]) + ' --require=' + str(ROOT / 'node-egress-guard.cjs')

def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def git(*args: str) -> str:
    return subprocess.check_output(['git', '-C', str(CANDIDATE), *args], timeout=15, text=True).strip()

def free() -> int:
    value = os.statvfs(TEMP_ROOT)
    return value.f_bavail * value.f_frsize

def exclusive_json(path: Path, record: dict) -> None:
    require(not path.exists() and not path.is_symlink(), 'EVIDENCE_ALREADY_EXISTS')
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w') as stream:
        json.dump(record, stream, indent=2, sort_keys=True)
        stream.write('\n')

def source() -> dict:
    require(git('rev-parse', 'HEAD') == SHA and not git('status', '--porcelain=v1', '--untracked-files=all'), 'EXACT_CLEAN_B811_REQUIRED')
    require(not any(path.name != '.env.example' for path in CANDIDATE.glob('.env*')), 'CANDIDATE_DOTENV_FORBIDDEN')
    require(not (CANDIDATE / '.npmrc').exists(), 'CANDIDATE_NPMRC_FORBIDDEN')
    raw = subprocess.check_output(['git', '-C', str(CANDIDATE), 'ls-tree', '-rzl', 'HEAD'], timeout=15)
    selected = {}
    for entry in raw.split(b'\0'):
        if not entry:
            continue
        metadata, filename = entry.split(b'\t', 1)
        mode, kind, oid, size = metadata.decode().split()
        name = filename.decode()
        if name.split('/')[0] not in RUNTIME_DIRS and name not in ROOT_FILES:
            continue
        require(kind == 'blob' and mode in {'100644', '100755'} and '..' not in Path(name).parts, 'RUNTIME_BLOB_SHAPE_REJECTED')
        selected[name] = {'oid': oid, 'size': int(size), 'mode': mode}
    require('src/models/Schema.ts' in selected and len(selected) > 1000, 'RUNTIME_SOURCE_CLOSURE_INCOMPLETE')
    size = sum(item['size'] for item in selected.values())
    require(size < 90 * 1024 * 1024, 'RUNTIME_SOURCE_COPY_BUDGET')
    return {'sha': SHA, 'tree': git('rev-parse', 'HEAD^{tree}'), 'selected': selected, 'bytes': size}

def physical(path: Path, mode: int | None = None) -> None:
    value = path.lstat()
    require(not stat.S_ISLNK(value.st_mode) and value.st_uid == os.getuid(), 'PHYSICAL_OWNED_PATH_REQUIRED')
    if mode is not None:
        require(stat.S_IMODE(value.st_mode) == mode, 'PATH_MODE_REJECTED')

def ci_context() -> dict:
    """Independent execution guard; never treats fork/PR content as authorization."""
    require(os.environ.get('GITHUB_ACTIONS') == 'true'
            and os.environ.get('GITHUB_EVENT_NAME') == 'pull_request', 'SAME_REPO_OWNER_PR_REQUIRED')
    require(os.environ.get('GITHUB_REPOSITORY') == 'SniperStopSniping/nailsalon'
            and os.environ.get('GITHUB_ACTOR') == 'SniperStopSniping'
            and os.environ.get('GITHUB_TRIGGERING_ACTOR') == 'SniperStopSniping', 'OWNER_ACTOR_REQUIRED')
    require(HARNESS == WORKSPACE / 'harness' and CANDIDATE == WORKSPACE / 'application', 'CI_CHECKOUT_LAYOUT_REQUIRED')
    physical(WORKSPACE)
    physical(CANDIDATE)
    physical(HARNESS)
    event_path = Path(os.environ.get('GITHUB_EVENT_PATH', '/nonexistent-event'))
    require(event_path.is_file() and event_path.stat().st_size <= 2 * 1024 * 1024, 'PR_EVENT_REQUIRED')
    event = json.loads(event_path.read_text())
    pr = event.get('pull_request', {})
    head = pr.get('head', {})
    require(pr.get('user', {}).get('login') == 'SniperStopSniping'
            and head.get('repo', {}).get('full_name') == 'SniperStopSniping/nailsalon'
            and head.get('repo', {}).get('fork') is False
            and head.get('ref') == 'codex/fresh-owner-release-validation-20261021'
            and pr.get('base', {}).get('ref') == 'main', 'SAME_REPO_OWNER_PR_REQUIRED')
    expected = os.environ.get('FRESH_OWNER_HARNESS_SHA', '')
    require(re.fullmatch('[0-9a-f]{40}', expected) is not None and head.get('sha') == expected, 'HARNESS_EVENT_SHA_REQUIRED')
    actual = subprocess.check_output(['git', '-C', str(HARNESS), 'rev-parse', 'HEAD'], text=True, timeout=15).strip()
    status = subprocess.check_output(['git', '-C', str(HARNESS), 'status', '--porcelain=v1', '--untracked-files=all'], text=True, timeout=15).strip()
    require(actual == expected and not status, 'EXACT_CLEAN_HARNESS_HEAD_REQUIRED')
    require(re.fullmatch(r'[0-9]{1,20}', os.environ.get('GITHUB_RUN_ID', '')) is not None, 'CI_RUN_ID_REQUIRED')
    return {'sameRepoOwnerPullRequest': True, 'eventHeadSha': expected, 'harnessSha': actual, 'applicationSha': SHA, 'runId': os.environ['GITHUB_RUN_ID']}

def hardware_preflight() -> dict:
    require(os.uname().sysname == 'Linux', 'LINUX_RUNNER_REQUIRED')
    total = os.sysconf('SC_PHYS_PAGES') * os.sysconf('SC_PAGE_SIZE')
    values = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        match = re.fullmatch(r'(MemTotal|MemAvailable):\s+(\d+) kB', line)
        if match:
            values[match.group(1)] = int(match.group(2)) * 1024
    require(total >= MIN_RAM_BYTES and values.get('MemAvailable', 0) >= MIN_AVAILABLE_RAM_BYTES, 'RUNNER_RAM_PREFLIGHT')
    physical(TEMP_ROOT)
    require(free() >= FLOOR + INITIAL_RESERVE, 'RUNNER_DISK_PREFLIGHT')
    return {'physicalRamBytes': total, 'availableRamBytes': values['MemAvailable'], 'freeBytes': free(),
            'minimumRamBytes': MIN_RAM_BYTES, 'minimumAvailableRamBytes': MIN_AVAILABLE_RAM_BYTES,
            'initialDiskRequiredBytes': FLOOR + INITIAL_RESERVE}

def prepare() -> dict:
    context = ci_context()
    hardware = hardware_preflight()
    snapshot = source()
    for name, expected in BROWSER_PINS.items():
        path = BROWSER_ROOT / name
        physical(path)
        require(digest(path) == expected, 'BROWSER_PIN_REJECTED')
    manifest = json.loads((ROOT / 'bundle-sha256.json').read_text())
    for name, expected in manifest.items():
        require('/' not in name and name != 'bundle-sha256.json', 'RUNTIME_MANIFEST_SHAPE')
        physical(ROOT / name)
        require(digest(ROOT / name) == expected, 'RUNTIME_PIN_REJECTED')
    require(NODE.is_file() and (PG / 'postgres').is_file() and REDIS.is_file(), 'NATIVE_RUNNER_BINARIES_REQUIRED')
    return {'preparedOnly': True, 'executionStarted': False, 'sourceSha': SHA, 'sourceTree': snapshot['tree'], 'copyBytes': snapshot['bytes'], 'copyFiles': len(snapshot['selected']), 'ciContext': context, 'hardware': hardware, 'secretValuesRead': False, 'freeBytes': free(), 'diskFloorBytes': FLOOR, 'combinedRssLimitKiB': RSS_LIMIT_KIB, 'nodeHeapMiBByRole': ROLE_HEAP_MIB, 'runtimeEnvelope': RUNTIME_ENVELOPE, 'runtime': 'isolated Ubuntu exact-source Next 15 Development; no production-build proof'}

def load_clerk_keys() -> tuple[str, str]:
    # Existing repository secrets arrive ONLY in this execution-step environment.
    # Never read a dotenv, write credentials, or forward the ambient environment.
    secret = os.environ.pop('CLERK_SECRET_KEY', '')
    public = os.environ.pop('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '')
    require(bool(re.fullmatch(r'sk_test_[A-Za-z0-9_-]{10,500}', secret))
            and bool(re.fullmatch(r'pk_test_[A-Za-z0-9_=-]{10,500}', public)), 'TEST_CLERK_KEYS_REQUIRED')
    try:
        frontend = base64.urlsafe_b64decode(public[8:] + '===').decode().rstrip('$')
    except Exception:
        raise Stop('CLERK_PK_DECODE_FAILED') from None
    require(frontend == FRONTEND, 'EXPECTED_CLERK_FRONTEND_REQUIRED')
    return secret, public

class Clerk:
    def __init__(self, secret: str):
        self.secret = secret
        self.deadline = time.monotonic() + DEADLINE_SECONDS
    def request(self, method: str, path: str) -> dict | list:
        require(time.monotonic() < self.deadline, 'CLERK_PHASE_DEADLINE')
        require(method in {'GET', 'POST', 'DELETE'} and path.startswith('/v1/') and '\n' not in path, 'CLERK_REQUEST_SHAPE')
        if method == 'POST':
            require(path == '/v1/testing_tokens', 'CLERK_POST_NOT_ALLOWLISTED')
        if method == 'DELETE':
            require(re.fullmatch(r'/v1/(?:users/user_|organizations/org_)[A-Za-z0-9]+', path) is not None, 'CLERK_DELETE_NOT_ALLOWLISTED')
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        context.load_default_certs()
        context.keylog_filename = None
        connection = http.client.HTTPSConnection('api.clerk.com', 443, timeout=15, context=context)
        try:
            connection.request(method, path, body=b'{}' if method == 'POST' else None, headers={'Authorization': 'Bearer ' + self.secret, 'Content-Type': 'application/json'})
            response = connection.getresponse()
            body = response.read(1024 * 1024 + 1)
            require(200 <= response.status < 300 and len(body) <= 1024 * 1024, 'CLERK_HTTP_REJECTED')
            return json.loads(body) if body else {}
        except Stop:
            raise
        except Exception:
            raise Stop('CLERK_REQUEST_FAILED_REDACTED') from None
        finally:
            connection.close()
    def guard(self) -> None:
        instance = self.request('GET', '/v1/instance')
        require(isinstance(instance, dict) and instance.get('id') == INSTANCE and instance.get('environment_type') == 'development', 'CLERK_INSTANCE_BINDING_REJECTED')
    def users(self, email: str) -> list:
        result = self.request('GET', '/v1/users?' + urlencode({'email_address': email, 'limit': 10}))
        rows = result if isinstance(result, list) else result.get('data')
        require(isinstance(rows, list) and len(rows) <= 1, 'CLERK_EXACT_EMAIL_NOT_UNIQUE')
        return rows
    def baseline_orgs(self) -> set[str]:
        found = set()
        for offset in range(0, 2000, 100):
            result = self.request('GET', f'/v1/organizations?limit=100&offset={offset}')
            rows = result.get('data', [])
            require(isinstance(rows, list), 'CLERK_ORG_INVENTORY_SHAPE')
            found.update(item['id'] for item in rows)
            if len(rows) < 100:
                return found
        raise Stop('CLERK_BASELINE_INVENTORY_BOUND')

class Controller:
    def __init__(self, run_dir: Path):
        self.run_dir = run_dir
        self.children = []
        self.selector = selectors.DefaultSelector()
        self.started = time.monotonic()
        self.stop_requested = False
        self.peak_rss = 0
        self.min_free = free()
        self.last_sample = 0.0
        self.fd_logs = os.fdopen(os.open(run_dir / 'safe-controller.jsonl', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w')
        self.last_table = {}
        self.owned_groups = set()
        self.owned_tokens = {}
        self.unverified_groups = set()
        self.unknown_group_members = []
        self.unknown_group_member_count = 0
        self.classifiers = {key: 0 for key in ['oom', 'enospc', 'eaddrinuse', 'missingModule', 'compileFailure', 'traceBlocked', 'egressBlocked', 'envValidation']}
        self.classifier_tails = {}  # transient bytes only; never emitted or persisted
        self.phase = 'source-copy'
        self.service_exit = None
        self.render_http = None
        self.pre_browser_headroom = None
        self.cleanup_failure_code = None
        self.cleanup_diagnostics = []
        self.service_stop_observations = []
    def emit(self, code: str, **numbers) -> None:
        # Only fixed enum-like codes and explicit primitive metadata are retained.
        self.fd_logs.write(json.dumps({'time': time.time(), 'code': code, **numbers}) + '\n')
        self.fd_logs.flush()
        require(self.fd_logs.tell() < 1024 * 1024, 'SAFE_LOG_CAP')
    def start(self, label: str, argv: list[str], env: dict, cwd: Path, pass_fds=(), private=False):
        require(label in {'initdb', 'postgres', 'createdb', 'redis', 'bootstrap', 'next', 'browser'}, 'CHILD_LABEL_REJECTED')
        self.phase = label
        self.emit('phase-start', phase=label)
        process = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True, pass_fds=pass_fds)
        item = {'label': label, 'process': process, 'pgid': process.pid, 'stdoutBytes': 0, 'stderrBytes': 0, 'private': private, 'buffer': bytearray()}
        self.children.append(item)
        self.owned_groups.add(process.pid)
        self.register_identity(process)
        for name, stream in [('stdoutBytes', process.stdout), ('stderrBytes', process.stderr)]:
            os.set_blocking(stream.fileno(), False)
            self.selector.register(stream, selectors.EVENT_READ, (item, name))
        return item
    def table(self) -> dict:
        result = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,pgid=,rss=,stat='], capture_output=True, text=True, timeout=3)
        require(result.returncode == 0 and len(result.stdout) < 5 * 1024 * 1024, 'PROCESS_OBSERVATION_FAILED')
        table = {}
        for line in result.stdout.splitlines():
            values = line.split()
            require(len(values) == 5 and all(x.isdecimal() for x in values[:4]), 'PROCESS_OBSERVATION_INVALID')
            pid = int(values[0])
            try:
                # /proc stat field22 is a boot-relative start tick, not argv.
                fields = Path('/proc/' + str(pid) + '/stat').read_text().rsplit(') ', 1)[1].split()
                require(len(fields) >= 20 and fields[19].isdecimal(), 'PROCESS_OBSERVATION_INVALID')
                # Reject torn PID reuse/ancestry observations rather than infer ownership.
                require(int(fields[1]) == int(values[1]) and int(fields[2]) == int(values[2]), 'PROCESS_OBSERVATION_INVALID')
            except (FileNotFoundError, ProcessLookupError):
                continue
            table[pid] = tuple(map(int, values[1:4])) + (values[4], fields[19])
        self.last_table = table
        return table
    def register_identity(self, process) -> None:
        # Registration in children happens BEFORE this observation can fail.
        table = self.table()
        row = table.get(process.pid)
        if row is not None:
            require(row[0] == os.getpid() and row[1] == process.pid, 'OWNED_NEW_PROCESS_IDENTITY_REQUIRED')
            self.owned_tokens[process.pid] = row[4]
        else:
            # A fast exit can be harmless, but cannot authorize a remaining
            # group member. Cleanup retains work if any member is unproven.
            require(process.poll() is not None, 'CHILD_IDENTITY_UNOBSERVABLE')
    def live_owned(self, table: dict) -> set[int]:
        # Historical PGIDs NEVER seed ownership. Only PID/start-token matches
        # and descendants observed while their verified parent lives do so.
        owned = {pid for pid, token in self.owned_tokens.items()
                 if pid in table and table[pid][4] == token}
        for item in self.children:
            process = item['process']
            row = table.get(process.pid)
            # An unreaped Popen child PID cannot be reused. Its current direct
            # parent + fresh session-group identity recovers an interrupted
            # initial observation without trusting a historical PGID.
            if process.returncode is None and row and row[0] == os.getpid() and row[1] == process.pid:
                owned.add(process.pid)
        while True:
            new = {pid for pid, row in table.items() if row[0] in owned} - owned
            if not new:
                break
            owned.update(new)
        for pid in owned:
            self.owned_tokens[pid] = table[pid][4]
            group = table[pid][1]
            require(group != os.getpgrp(), 'DESCENDANT_ESCAPED_TO_CONTROLLER_GROUP')
            self.owned_groups.add(group)
        self.unverified_groups = {group for group in self.owned_groups
                                  if any(row[1] == group and pid not in owned for pid, row in table.items())}
        # Diagnostics ONLY. Unknown members remain unowned/unsignaled and keep
        # the existing cleanup uncertainty semantics, including zombies.
        self.unknown_group_members = []
        self.unknown_group_member_count = 0
        for pid in sorted(table):
            row = table[pid]
            if row[1] in self.owned_groups and pid not in owned:
                self.unknown_group_member_count += 1
                if len(self.unknown_group_members) < 32:
                    self.unknown_group_members.append({'pid': pid, 'parentPid': row[0], 'groupId': row[1], 'startToken': row[4], 'state': row[3]})
        return {pid for pid in owned if not table[pid][3].startswith('Z')}
    def classify(self, identity: tuple, chunk: bytes) -> None:
        # Small transient overlap handles split markers; only fixed counters
        # survive. No raw line, path, header, URL, or error text is retained.
        patterns = {
            'oom': [b'heap out of memory', b'fatal error: reached heap limit', b'fatal error: ineffective mark-compacts', b'allocation failed - javascript heap'],
            'enospc': [b'enospc'], 'eaddrinuse': [b'eaddrinuse'],
            'missingModule': [b'cannot find module', b'module not found', b'err_module_not_found'],
            'compileFailure': [b'failed to compile', b'compilation failed', b'compile error'],
            'traceBlocked': [b'fresh_owner_trace_file_forbidden'],
            'egressBlocked': [b'fresh_owner_egress_blocked'],
            'envValidation': [b'zoderror', b'invalid environment variables', b'environment validation failed'],
        }
        tail = self.classifier_tails.get(identity, b'')
        data = tail + chunk.lower()
        for key, markers in patterns.items():
            # Count matching marker occurrences once even across chunks.
            for marker in markers:
                offset = 0
                while True:
                    position = data.find(marker, offset)
                    if position < 0:
                        break
                    if position + len(marker) > len(tail):
                        self.classifiers[key] += 1
                    offset = position + len(marker)
        self.classifier_tails[identity] = data[-80:]
    def drain_stdio(self) -> None:
        for key, _ in self.selector.select(timeout=0):
            item, name = key.data
            chunk = os.read(key.fileobj.fileno(), 16384)
            if not chunk:
                self.classifier_tails.pop((item['process'].pid, name), None)
                self.selector.unregister(key.fileobj)
                key.fileobj.close()
                continue
            item[name] += len(chunk)
            if not item['private']:
                self.classify((item['process'].pid, name), chunk)
            if item['private'] and name == 'stdoutBytes':
                item['buffer'].extend(chunk)
                require(len(item['buffer']) <= 16384, 'PRIVATE_BOOTSTRAP_PIPE_BOUND')
            require(item[name] <= 4 * 1024 * 1024, 'RAW_STDIO_DISCARD_BYTE_CAP')
            # ALL raw stdio is discarded. Never line-buffer Next URLs or errors.
    def tick(self) -> int:
        self.drain_stdio()
        table = self.table()
        owned = self.live_owned(table)
        for item in self.children:
            if item['label'] in {'postgres', 'redis', 'next'}:
                exit_code = item['process'].poll()
                if exit_code is not None:
                    self.service_exit = {'service': item['label'], 'exitCode': exit_code, 'phase': self.phase}
                    self.emit('owned-service-leader-exited', **self.service_exit)
                    raise Stop('OWNED_SERVICE_LEADER_EXITED')
        rss = sum(table[pid][2] for pid in owned) + (table.get(os.getpid(), (0, 0, 0, ''))[2])
        available = free()
        self.peak_rss = max(self.peak_rss, rss)
        self.min_free = min(self.min_free, available)
        require(not self.stop_requested, 'OPERATOR_STOP')
        require(time.monotonic() - self.started < DEADLINE_SECONDS, 'CONTROLLER_DEADLINE')
        require(available >= FLOOR, 'DISK_FLOOR')
        require(rss <= RSS_LIMIT_KIB, 'COMBINED_RSS_LIMIT')
        if time.monotonic() - self.last_sample >= 5:
            self.emit('resource-sample', rssKiB=rss, freeBytes=available, processes=len(owned))
            self.last_sample = time.monotonic()
        return rss
    def wait(self, item, timeout: int) -> bytes:
        deadline = time.monotonic() + timeout
        while item['process'].poll() is None:
            self.tick()
            require(time.monotonic() < deadline, 'CHILD_PHASE_TIMEOUT')
            time.sleep(0.25)
        for _ in range(3):
            self.tick()
        require(item['process'].returncode == 0, 'CHILD_FAILED_REDACTED_' + item['label'].upper())
        return bytes(item['buffer'])
    def cleanup_note(self, step: str, error: Exception) -> None:
        # Only fixed step/exception enums survive; never exception text/paths.
        if isinstance(error, Stop):
            known = {'PROCESS_OBSERVATION_FAILED', 'PROCESS_OBSERVATION_INVALID',
                     'DESCENDANT_ESCAPED_TO_CONTROLLER_GROUP', 'CLEANUP_GROUP_IDENTITY_REJECTED'}
            enum = str(error) if str(error) in known else 'CONTROLLER_GUARD_REFUSAL'
        elif isinstance(error, PermissionError):
            enum = 'PERMISSION_DENIED'
        elif isinstance(error, ProcessLookupError):
            enum = 'PROCESS_DISAPPEARED'
        elif isinstance(error, subprocess.TimeoutExpired):
            enum = 'PROCESS_OBSERVATION_TIMEOUT'
        elif isinstance(error, OSError):
            enum = 'OS_ERROR'
        else:
            enum = 'UNEXPECTED_EXCEPTION'
        if len(self.cleanup_diagnostics) < 32:
            self.cleanup_diagnostics.append({'step': step, 'exceptionEnum': enum})
    def observe_service_stops(self, phase: str) -> None:
        for item in self.children:
            if item['label'] not in {'postgres', 'redis', 'next'}:
                continue
            try:
                code = item['process'].poll()
                record = {'phase': phase, 'service': item['label'], 'leaderStatus': 'running' if code is None else 'exited', 'exitCode': code}
            except Exception as error:
                self.cleanup_note('service-exit-observation', error)
                record = {'phase': phase, 'service': item['label'], 'leaderStatus': 'unobserved', 'exitCode': None}
            if len(self.service_stop_observations) < 12:
                self.service_stop_observations.append(record)
    def cleanup_snapshot(self, step: str):
        try:
            table = self.table()
            return table, self.live_owned(table)
        except Exception as error:
            self.cleanup_note(step, error)
            return None
    def stop_all(self) -> bool:
        # Each group gets an independent fresh ownership check. Failure for one
        # group or observation never skips the remaining independently proven
        # groups. Unobservable/ambiguous identities are never signaled.
        self.observe_service_stops('before-term')
        for signum, seconds, phase in [(signal.SIGTERM, 10, 'term'), (signal.SIGKILL, 5, 'kill')]:
            initial = self.cleanup_snapshot('pass-observation')
            if initial is not None:
                table, live = initial
                groups = sorted({table[pid][1] for pid in live})
                for group in groups:
                    snapshot = self.cleanup_snapshot('group-revalidation')
                    if snapshot is None:
                        continue
                    current_table, current_live = snapshot
                    members = {pid for pid, row in current_table.items() if row[1] == group}
                    proven = {pid for pid in members if self.owned_tokens.get(pid) == current_table[pid][4]}
                    try:
                        require(group != os.getpgrp() and group > 1, 'CLEANUP_GROUP_IDENTITY_REJECTED')
                        if members and members == proven and members.intersection(current_live):
                            os.killpg(group, signum)
                        else:
                            for pid in sorted(proven.intersection(current_live)):
                                verified = self.cleanup_snapshot('pid-revalidation')
                                if verified is None:
                                    continue
                                latest, latest_live = verified
                                if pid in latest_live and self.owned_tokens.get(pid) == latest[pid][4]:
                                    try:
                                        os.kill(pid, signum)
                                    except ProcessLookupError:
                                        pass
                                    except Exception as error:
                                        self.cleanup_note('individual-signal', error)
                    except ProcessLookupError:
                        pass
                    except Exception as error:
                        self.cleanup_note('group-signal', error)
                        continue
            end = time.monotonic() + seconds
            while time.monotonic() < end:
                try:
                    self.drain_stdio()
                except Exception as error:
                    self.cleanup_note('stdio-drain', error)
                # Reap direct children individually without letting a failed
                # observation abort cleanup of the other known children.
                for item in self.children:
                    try:
                        item['process'].poll()
                    except Exception as error:
                        self.cleanup_note('child-reap', error)
                snapshot = self.cleanup_snapshot('wait-observation')
                if snapshot is not None and not snapshot[1] and not self.unverified_groups:
                    self.observe_service_stops('after-' + phase)
                    return True
                # Unknown members get observation-only grace within the same
                # TERM/KILL deadlines. Never infer ownership or signal them.
                time.sleep(0.2)
            self.observe_service_stops('after-' + phase)
        final = self.cleanup_snapshot('final-observation')
        if final is None:
            self.cleanup_failure_code = 'CLEANUP_OBSERVATION_FAILED'
        elif self.unverified_groups:
            self.cleanup_failure_code = 'UNVERIFIED_PROCESS_GROUP_MEMBERS'
        elif final[1]:
            self.cleanup_failure_code = 'OWNED_PROCESSES_REMAIN'
        else:
            return True
        return False

def wait_for_browser_headroom(controller: Controller, project: str) -> None:
    # Observe only: no GC, requests, child launches, or relaxed resource checks.
    require(project in {'desktop-chromium', 'iphone-13-webkit'}, 'BROWSER_PROJECT_REJECTED')
    started = time.monotonic()
    deadline = started + PRE_BROWSER_WAIT_SECONDS
    record = {'project': project, 'waitApplied': project == 'desktop-chromium', 'thresholdRssKiB': PRE_BROWSER_RSS_KIB, 'timeoutMs': PRE_BROWSER_WAIT_SECONDS * 1000,
              'elapsedMs': 0, 'observations': 0, 'consecutiveBelowThreshold': 0, 'lastRssKiB': 0}
    controller.pre_browser_headroom = record
    if not record['waitApplied']:
        return
    controller.emit('pre-browser-headroom-wait', thresholdRssKiB=PRE_BROWSER_RSS_KIB, timeoutMs=record['timeoutMs'])
    while True:
        now = time.monotonic()
        record['elapsedMs'] = round((now - started) * 1000)
        require(now < deadline, 'PRE_BROWSER_HEADROOM_TIMEOUT')
        rss = controller.tick()  # all existing disk/RSS/service/operator/time guards
        now = time.monotonic()
        record.update(elapsedMs=round((now - started) * 1000), observations=record['observations'] + 1, lastRssKiB=rss)
        record['consecutiveBelowThreshold'] = record['consecutiveBelowThreshold'] + 1 if rss < PRE_BROWSER_RSS_KIB else 0
        require(now < deadline, 'PRE_BROWSER_HEADROOM_TIMEOUT')
        if record['consecutiveBelowThreshold'] >= 2:
            controller.emit('pre-browser-headroom-ready', **record)
            return
        time.sleep(min(1.0, deadline - now))

def copy_source(snapshot: dict, destination: Path, controller: Controller) -> None:
    destination.mkdir(mode=0o700)
    paths = sorted(RUNTIME_DIRS | ROOT_FILES)
    process = subprocess.Popen(['git', '-C', str(CANDIDATE), 'archive', '--format=tar', SHA, '--', *paths], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, start_new_session=True)
    controller.children.append({'label': 'source-archive', 'process': process, 'pgid': process.pid})
    controller.owned_groups.add(process.pid)
    controller.register_identity(process)
    last_copy_tick = 0.0
    try:
        with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
            for member in archive:
                target = destination / member.name
                require(not member.issym() and not member.islnk() and '..' not in Path(member.name).parts and not Path(member.name).is_absolute(), 'ARCHIVE_PATH_REJECTED')
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True, mode=0o700)
                    continue
                require(member.isfile() and member.name in snapshot['selected'], 'ARCHIVE_MEMBER_REJECTED')
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                with archive.extractfile(member) as stream, open(target, 'xb') as out:
                    shutil.copyfileobj(stream, out, length=65536)
                os.chmod(target, 0o700 if member.mode & 0o111 else 0o600)
                # Only source extraction is throttled; live request checks stay
                # unthrottled. Copy size/reserve and blob checks remain fixed.
                if time.monotonic() - last_copy_tick >= 0.1:
                    controller.tick()
                    last_copy_tick = time.monotonic()
        require(process.wait(timeout=10) == 0, 'SOURCE_ARCHIVE_FAILED')
    finally:
        if process.poll() is None:
            # Registered process cleanup uses the same proven-identity path.
            require(controller.stop_all(), 'ARCHIVE_CLEANUP_UNCERTAIN')
            process.wait(timeout=5)
    controller.tick()  # forced final source-copy resource observation
    verify_copy(snapshot, destination, generated_allowed=False)
    (destination / 'node_modules').symlink_to((CANDIDATE / 'node_modules').resolve(), target_is_directory=True)

def verify_copy(snapshot: dict, root: Path, generated_allowed: bool) -> dict:
    changed_generated = []
    for name, expected in snapshot['selected'].items():
        path = root / name
        require(path.is_file() and not path.is_symlink(), 'COPIED_TRACKED_FILE_MISSING')
        data = path.read_bytes()
        oid = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        if oid != expected['oid']:
            require(generated_allowed and name in {'tsconfig.json', 'next-env.d.ts'}, 'COPIED_APPLICATION_SOURCE_CHANGED')
            changed_generated.append(name)
    return {'checkedRuntimeFiles': len(snapshot['selected']), 'nextGeneratedConfigFilesChanged': changed_generated}

def port_free(port: int) -> None:
    with socket.socket() as probe:
        try:
            probe.bind(('127.0.0.1', port))
        except OSError:
            raise Stop('OWNED_PORT_ALREADY_OCCUPIED') from None

def ready(controller: Controller, item, port: int, timeout: int) -> None:
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        controller.tick()
        require(item['process'].poll() is None, 'SERVICE_EXITED_DURING_STARTUP')
        try:
            with socket.create_connection(('127.0.0.1', port), timeout=0.3):
                return
        except OSError:
            time.sleep(0.3)
    raise Stop('SERVICE_READINESS_TIMEOUT')

def render_http_observation(header_block: bytes, invitation_token: str) -> dict:
    # The raw header block is transient. Only a numeric status and fixed
    # Location category survive; no URL/path/query/token/header value does.
    status = re.match(rb'HTTP/1\.[01] ([1-5][0-9]{2})(?: |\r|$)', header_block)
    require(status is not None, 'RENDER_HTTP_STATUS_INVALID')
    locations = [line.split(b':', 1)[1].strip().decode('latin1')
                 for line in header_block.split(b'\r\n')[1:]
                 if line.partition(b':')[0].lower() == b'location']
    category = 'missing' if not locations or locations == [''] else 'other'
    if len(locations) == 1 and locations[0] and not any(ord(char) < 32 or ord(char) == 127 for char in locations[0]):
        try:
            target = urlsplit(urljoin(BASE + '/', locations[0]))
            origin = urlsplit(BASE)
            credentials_absent = target.username is None and target.password is None
            if (credentials_absent and target.scheme == origin.scheme and target.hostname == origin.hostname
                and target.port == origin.port and target.path == '/join/' + invitation_token
                and not target.query and not target.fragment):
                category = 'same-origin-canonical-invite'
            elif (credentials_absent and target.scheme == 'https' and target.hostname == FRONTEND
                  and target.port in {None, 443} and target.path == '/v1/client/handshake' and not target.fragment):
                category = 'bound-fapi-handshake'
        except (ValueError, UnicodeError):
            category = 'other'
    return {'status': int(status.group(1)), 'locationClass': category, 'redirectFollowed': False}

def render_ready(controller: Controller, invitation_token: str) -> None:
    # One bounded loopback HTTP render, no cookies, redirects, auth, or signup.
    # Nonblocking reads let resource monitoring continue during dev compilation.
    require(re.fullmatch('[A-Za-z0-9_-]{20,200}', invitation_token) is not None, 'RENDER_INVITE_TOKEN_SHAPE')
    deadline = time.monotonic() + 240
    connection = socket.create_connection(('127.0.0.1', 56512), timeout=1)
    try:
        request = ('GET /join/' + invitation_token + ' HTTP/1.1\r\nHost: localhost:56512\r\nConnection: close\r\n\r\n').encode('ascii')
        connection.sendall(request)
        connection.setblocking(False)
        total, tail, headers, found, account_heading, complete = 0, b'', bytearray(), False, False, False
        while True:
            controller.tick()
            require(time.monotonic() < deadline, 'RENDER_RESPONSE_TIMEOUT')
            if not select.select([connection], [], [], 0.2)[0]:
                continue
            data = connection.recv(16384)
            if not data:
                break
            total += len(data)
            require(total <= 4 * 1024 * 1024, 'RENDER_RESPONSE_BOUND')
            if not complete:
                headers.extend(data)
                boundary = headers.find(b'\r\n\r\n')
                require(len(headers) <= 65536, 'RENDER_HEADERS_BOUND')
                if boundary < 0:
                    continue
                controller.render_http = render_http_observation(bytes(headers[:boundary]), invitation_token)
                controller.emit('render-http-response', **controller.render_http)
                require(controller.render_http['status'] == 200, 'RENDER_INVITATION_HTTP_NOT_200')
                data = bytes(headers[boundary + 4:])
                headers.clear()
                complete = True
            transient = tail + data.lower()
            found = found or b'<html' in transient
            account_heading = account_heading or b'create your owner account' in transient
            tail = transient[-64:]
        require(complete and found and account_heading, 'RENDER_INVITED_ACCOUNT_PAGE_MISSING')
    except Stop:
        raise
    except Exception:
        raise Stop('RENDER_REQUEST_FAILED_REDACTED') from None
    finally:
        connection.close()

def browser_result(path: Path, projects: list[str]) -> dict:
    physical(path, 0o600)
    require(path.stat().st_size < 512 * 1024, 'BROWSER_RESULTS_BOUND')
    result = json.loads(path.read_text())
    require(result.get('sourceSha') == SHA and result.get('rawPayloadsRetained') is False and result.get('authStorageStateRetained') is False, 'BROWSER_RESULT_SCHEMA')
    require(result.get('status') == 'passed', 'BROWSER_JOURNEY_NOT_PASSED')
    outcomes = result.get('outcomes', [])
    require(sorted(row.get('project') for row in outcomes) == sorted(projects), 'BROWSER_PROJECT_COVERAGE')
    require(all(row.get('status') == 'passed' and row.get('errorCount') == 0 for row in outcomes), 'BROWSER_OUTCOME_NOT_PASSED')
    required = ['registrationCompleted', 'organizationCreated', 'emailVerified', 'invitationSetupCompleted', 'publishCompleted', 'customerBookingCreated', 'appointmentCompleted', 'ownSessionRevoked', 'productSignInRestored', 'persistedOwnerWorkResumed']
    for project in projects:
        records = [row for row in result.get('events', []) if row.get('type') == 'journey-result' and row.get('project') == project]
        require(len(records) == 1 and records[0].get('unauthenticatedStatus') == 401 and all(records[0].get(key) is True for key in required), 'BROWSER_REQUIRED_JOURNEY_ASSERTION_MISSING')
    return result

def safe_fresh_user_state(user: dict, membership_count: int) -> dict:
    # Called only after existing independent fresh-user deletion guards pass.
    # No extra API call, raw email, primary-email ID, key, or token is retained.
    primary_id = user.get('primary_email_address_id')
    primary = next((item for item in user.get('email_addresses', [])
                    if isinstance(item, dict) and primary_id and item.get('id') == primary_id), None)
    verification = primary.get('verification') if isinstance(primary, dict) else None
    status = verification.get('status') if isinstance(verification, dict) else None
    category = status if isinstance(status, str) and status in {'verified', 'unverified'} else 'missing' if status is None else 'other'
    enabled = user.get('create_organization_enabled')
    return {'primaryEmailVerificationStatus': category,
            'createOrganizationEnabled': enabled if isinstance(enabled, bool) else None,
            'membershipCount': membership_count}

def cleanup_created(api: Clerk, run_tag: str, started_ms: int, baseline: set[str], reported: dict | None) -> dict:
    """Explicit phase. Reported IDs never suffice: discover/verify only exact
    predeclared test emails plus fresh self-created named orgs, then allowlist.
    """
    api.deadline = time.monotonic() + 120
    api.guard()
    plan = []
    report_ids = set()
    if reported:
        for event in reported.get('events', []):
            if event.get('type') == 'created-artifacts':
                require(event.get('tag') in {run_tag + '-desktop', run_tag + '-iphone'}, 'CLEANUP_REPORT_TAG_REJECTED')
                report_ids.add(event.get('userId'))
    for suffix in ['desktop', 'iphone']:
        email = f'luster.owner.{run_tag}.{suffix}+clerk_test@example.com'
        rows = api.users(email)
        if not rows:
            continue
        user = rows[0]
        user_id = user.get('id', '')
        require(re.fullmatch(r'user_[A-Za-z0-9]+', user_id) is not None, 'CLEANUP_USER_ID_SHAPE')
        require(user.get('created_at', 0) >= started_ms and user.get('created_at', 0) <= time.time() * 1000 + 5000, 'CLEANUP_USER_NOT_FRESH')
        emails = [row.get('email_address', '').lower() for row in user.get('email_addresses', [])]
        require(emails == [email], 'CLEANUP_USER_EXACT_EMAIL_REQUIRED')
        memberships = api.request('GET', '/v1/users/' + user_id + '/organization_memberships?limit=100')
        require(memberships.get('total_count', len(memberships.get('data', []))) <= 5, 'CLEANUP_MEMBERSHIP_BOUND')
        organizations = []
        named = api.request('GET', '/v1/organizations?' + urlencode({'query': f'RC {run_tag}-{suffix} Studio', 'limit': 10}))
        require(named.get('total_count', len(named.get('data', []))) <= 5, 'CLEANUP_TAGGED_ORG_DISCOVERY_BOUND')
        candidate_ids = {item.get('organization', {}).get('id', '') for item in memberships.get('data', [])}
        candidate_ids.update(item.get('id', '') for item in named.get('data', []) if item.get('name') == f'RC {run_tag}-{suffix} Studio')
        for org_id in sorted(candidate_ids):
            require(re.fullmatch(r'org_[A-Za-z0-9]+', org_id) is not None and org_id not in baseline, 'CLEANUP_BASELINE_OR_FOREIGN_ORG')
            org = api.request('GET', '/v1/organizations/' + org_id)
            require(org.get('name') == f'RC {run_tag}-{suffix} Studio' and org.get('created_by') == user_id and started_ms <= org.get('created_at', 0) <= time.time() * 1000 + 5000, 'CLEANUP_ORG_OWNERSHIP_REJECTED')
            members = api.request('GET', '/v1/organizations/' + org_id + '/memberships?limit=100')
            require(members.get('total_count') == 1 and [row.get('public_user_data', {}).get('user_id') for row in members.get('data', [])] == [user_id], 'CLEANUP_ORG_HAS_OTHER_MEMBERS')
            organizations.append(org_id)
        # No precreation or shared membership is ever allowed into this plan.
        plan.append({'user': user_id, 'orgs': organizations, 'email': email, 'suffix': suffix})
    discovered = {row['user'] for row in plan}
    require(report_ids.issubset(discovered), 'CLEANUP_REPORTED_IDS_NOT_INDEPENDENTLY_VERIFIED')
    deleted_users, deleted_orgs = [], []
    fresh_user_states = []  # bounded by the existing two predeclared test emails
    # The complete scoped plan is verified before the first destructive request.
    for row in plan:
        for org_id in row['orgs']:
            api.guard()
            current = api.request('GET', '/v1/organizations/' + org_id)
            require(current.get('name') == f"RC {run_tag}-{row['suffix']} Studio" and current.get('created_by') == row['user'] and org_id not in baseline, 'CLEANUP_ORG_RECHECK_REJECTED')
            members = api.request('GET', '/v1/organizations/' + org_id + '/memberships?limit=100')
            require(members.get('total_count') == 1 and [member.get('public_user_data', {}).get('user_id') for member in members.get('data', [])] == [row['user']], 'CLEANUP_ORG_MEMBER_RECHECK_REJECTED')
            api.request('DELETE', '/v1/organizations/' + org_id)
            deleted_orgs.append(org_id)
        api.guard()
        current = api.request('GET', '/v1/users/' + row['user'])
        memberships = api.request('GET', '/v1/users/' + row['user'] + '/organization_memberships?limit=100')
        require([item.get('email_address', '').lower() for item in current.get('email_addresses', [])] == [row['email']] and current.get('created_at', 0) >= started_ms and memberships.get('total_count') == 0, 'CLEANUP_USER_RECHECK_REJECTED')
        fresh_user_states.append({'userId': row['user'], **safe_fresh_user_state(current, memberships.get('total_count'))})
        api.request('DELETE', '/v1/users/' + row['user'])
        deleted_users.append(row['user'])
    return {'phase': 'explicit-scoped-cleanup', 'deletedUserIds': deleted_users, 'deletedOrganizationIds': deleted_orgs, 'baselineOrganizationCount': len(baseline), 'baselineObjectsTouched': False, 'freshUserStateAtDeletion': fresh_user_states}

def execute(args) -> int:
    require(args.resource_reviewed, 'ROOT_RESOURCE_REVIEW_REQUIRED')
    prep = prepare()
    snapshot = source()
    secret, public = load_clerk_keys()
    clerk = Clerk(secret)
    clerk.guard()  # exact existing Development instance BEFORE any fixture/service mutation
    require(free() >= FLOOR + INITIAL_RESERVE, 'INITIAL_STORAGE_RESERVE')
    for port in [55432, 56381, 56512]:
        port_free(port)
    private = TEMP_ROOT / 'release-owner-validation-safe'
    if not private.exists():
        private.mkdir(mode=0o700)
    physical(private, 0o700)
    run_tag = 'ci-' + datetime.now(timezone.utc).strftime('%m%d%H%M') + '-' + secrets.token_hex(4)
    require(re.fullmatch('[a-z0-9-]{8,30}', run_tag) is not None, 'RUN_TAG_SHAPE')
    run_dir = private / run_tag
    run_dir.mkdir(mode=0o700)
    work = run_dir / 'owned-work'
    work.mkdir(mode=0o700)
    exclusive_json(work / 'ownership.json', {'runTag': run_tag, 'controllerPid': os.getpid(), 'sourceSha': SHA})
    controller = Controller(run_dir)
    signal_handlers = {}
    for signum in [signal.SIGINT, signal.SIGTERM]:
        signal_handlers[signum] = signal.signal(signum, lambda *_: setattr(controller, 'stop_requested', True))
    started_ms = int(time.time() * 1000) - 1000
    exclusive_json(run_dir / 'run-context.json', {'schemaVersion': 1, 'runTag': run_tag, 'startedMs': started_ms, 'instanceId': INSTANCE, 'project': args.project, **prep['ciContext'], 'credentialsRetained': False})
    status = 'incomplete'
    failure = None
    baseline = set()
    cleanup = {'phase': 'not-requested'}
    raw_result = None
    safe_result = None
    source_verified = None
    stopped = False
    try:
        copy_root = work / 'app'
        copy_source(snapshot, copy_root, controller)
        flags = clerk.request('GET', '/v1/instance/organization_settings')
        require(flags.get('enabled') is True and flags.get('force_organization_selection') is True
                and flags.get('organization_creation_defaults', {}).get('enabled') is False, 'CURRENT_ORGANIZATION_POLICY_DRIFT')
        baseline = clerk.baseline_orgs()  # existing shared IDs held in memory only
        require(bool(baseline), 'CLERK_BASELINE_EMPTY_REFUSED')  # before any local fixture or signup
        for suffix in ['desktop', 'iphone']:
            require(not clerk.users(f'luster.owner.{run_tag}.{suffix}+clerk_test@example.com'), 'FRESH_TEST_EMAIL_ALREADY_EXISTS')
        controller.emit('clerk-binding-matched', baselineOrganizationCount=len(baseline), forceOrganizationSelection=True, organizationCreationDefaultEnabled=False)
        tmp = work / 'tmp'
        tmp.mkdir(mode=0o700)
        home = work / 'home'
        home.mkdir(mode=0o700)
        pgdata = work / 'postgres'
        environment = {'PATH': f'{NODE.parent}:/usr/local/bin:/usr/bin:/bin', 'HOME': str(home), 'TMPDIR': str(tmp), 'LC_ALL': 'C', 'LANG': 'C', 'TZ': 'UTC'}
        password = secrets.token_hex(24)
        read_fd, write_fd = os.pipe()
        try:
            init = controller.start('initdb', [str(PG / 'initdb'), '-D', str(pgdata), '--username=luster_e2e_ci', '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--no-locale', '--encoding=UTF8', '--pwfile=/dev/fd/' + str(read_fd)], environment, work, pass_fds=(read_fd,))
            os.write(write_fd, (password + '\n').encode())
        finally:
            os.close(read_fd)
            os.close(write_fd)
        controller.wait(init, 120)
        postgres = controller.start('postgres', [str(PG / 'postgres'), '-D', str(pgdata), '-h', '127.0.0.1', '-p', '55432', '-k', '', '-c', 'max_connections=10', '-c', 'shared_buffers=16MB', '-c', 'work_mem=1MB', '-c', 'max_wal_size=64MB', '-c', 'min_wal_size=32MB', '-c', 'fsync=on', '-c', 'full_page_writes=on', '-c', 'log_statement=none', '-c', 'log_min_error_statement=panic'], environment, work)
        ready(controller, postgres, 55432, 30)
        control = subprocess.run([str(PG / 'pg_controldata'), str(pgdata)], env=environment, capture_output=True, text=True, timeout=5)
        require(control.returncode == 0, 'PG_CONTROL_METADATA_UNAVAILABLE')
        system = re.search(r'^Database system identifier:\s*(\d+)\s*$', control.stdout, re.M)
        require(system is not None, 'PG_SYSTEM_IDENTIFIER_REQUIRED')
        create = controller.start('createdb', [str(PG / 'createdb'), '-h', '127.0.0.1', '-p', '55432', '-U', 'luster_e2e_ci', 'luster_e2e_ci_disposable'], {**environment, 'PGPASSWORD': password}, work)
        controller.wait(create, 20)
        redis = controller.start('redis', [str(REDIS), '--bind', '127.0.0.1', '--port', '56381', '--save', '', '--appendonly', 'no', '--maxmemory', '32mb', '--maxmemory-policy', 'noeviction', '--dir', str(work)], environment, work)
        ready(controller, redis, 56381, 15)
        database_url = urlunsplit(('postgresql', f'luster_e2e_ci:{quote(password, safe="")}@127.0.0.1:55432',
                                  '/luster_e2e_ci_disposable', urlencode({'application_name': 'luster-e2e-ci-disposable'}), ''))
        app_env = {**environment, 'NODE_ENV': 'development', 'APP_ENV': 'development', 'BILLING_PLAN_ENV': 'dev',
            'NEXT_TELEMETRY_DISABLED': '1', 'NEXT_TRACE_SPAN_THRESHOLD_MS': '2147483647', 'NO_COLOR': '1', 'TERM': 'dumb',
            'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY': public, 'CLERK_SECRET_KEY': secret,
            'NEXT_PUBLIC_CLERK_SIGN_IN_URL': '/sign-in', 'NEXT_PUBLIC_CLERK_SIGN_UP_URL': '/sign-up',
            'CLERK_AUTHORIZED_PARTIES': BASE, 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY': 'pk_test_local_inert_placeholder',
            'STRIPE_SECRET_KEY': 'sk_test_local_inert_placeholder', 'STRIPE_WEBHOOK_SECRET': 'whsec_local_billing_inert',
            'STRIPE_CONNECT_WEBHOOK_SECRET': 'whsec_local_connect_inert', 'BILLING_SUBSCRIPTIONS_ENABLED': 'false',
            'BILLING_TOPUPS_ENABLED': 'false', 'BILLING_TAX_COLLECTION_ENABLED': 'false', 'PUBLIC_PRICING_ENABLED': 'false',
            'OWNER_ASSISTANT_ENABLED': 'false', 'COMMUNICATIONS_SMS_ENABLED': 'false', 'GOOGLE_CALENDAR_ENABLED': 'false',
            'PUBLIC_APP_URL': BASE, 'NEXT_PUBLIC_APP_URL': BASE, 'E2E_BASE_URL': BASE,
            'DATABASE_URL': database_url, 'DATABASE_POOL_MAX': '2', 'REDIS_URL': 'redis://127.0.0.1:56381',
            'LUSTER_DISPOSABLE_DATABASE': 'true',
            'LUSTER_ONBOARDING_MEDIA_DIR': str(work / 'media'), 'FRESH_OWNER_RUNTIME_COPY': str(copy_root),
            'FRESH_OWNER_RUN_TAG': run_tag, 'FRESH_OWNER_PGDATA': str(pgdata), 'FRESH_OWNER_PG_SYSTEM_ID': system.group(1),
            'NODE_OPTIONS': node_options('bootstrap')}
        boot = controller.start('bootstrap', [str(NODE), '--conditions=react-server', '--import', str(copy_root / 'node_modules/tsx/dist/loader.mjs'), str(ROOT / 'bootstrap.mts')], {**app_env, 'FRESH_OWNER_CHILD_ROLE': 'bootstrap'}, copy_root, private=True)
        seed = json.loads(controller.wait(boot, 240))
        require(seed.get('migrationCount') == 113 and seed.get('invitationCount') == 2 and seed.get('nativeTokenHashUsed') is True, 'SEED_ATTESTATION_REJECTED')
        controller.emit('seed-completed', migrations=113, invitations=2, nativeOpaqueHash=True, realInviteEmailApiInvoked=False)
        server = controller.start('next', [str(NODE), str(copy_root / 'node_modules/next/dist/bin/next'), 'dev', '--hostname', 'localhost', '--port', '56512'], {**app_env, 'FRESH_OWNER_CHILD_ROLE': 'next', 'NODE_OPTIONS': node_options('next')}, copy_root)
        ready(controller, server, 56512, 240)
        render_ready(controller, seed['invitations']['desktop']['token'])
        controller.emit('render-preflight-passed', invitationPageRendered=True, signupStarted=False)
        if args.render_only:
            boot['buffer'].clear()
            seed.clear()
            source_verified = verify_copy(snapshot, copy_root, generated_allowed=True)
            require(source()['sha'] == SHA, 'SOURCE_CHANGED_AFTER_RENDER')
            status = 'passed-development-render-only'
            raise RenderOnlyComplete()
        testing = clerk.request('POST', '/v1/testing_tokens').get('token')
        require(isinstance(testing, str) and 5 < len(testing) < 4096, 'CLERK_TESTING_TOKEN_REQUIRED')
        browser_env = {**environment, 'NODE_OPTIONS': node_options('browser'), 'FRESH_OWNER_CHILD_ROLE': 'browser',
            'CLERK_SECRET_KEY': secret, 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY': public, 'CLERK_TESTING_TOKEN': testing,
            'CLERK_FAPI': FRONTEND, 'E2E_BASE_URL': BASE, 'OWNER_PHASE_CANDIDATE': str(CANDIDATE),
            'GITHUB_WORKSPACE': str(WORKSPACE), 'RUNNER_TEMP': str(TEMP_ROOT),
            'FRESH_OWNER_RUNTIME_ATTESTED_SHA': SHA, 'FRESH_OWNER_RUN_TAG': run_tag,
            'FRESH_OWNER_RESULTS_PATH': str(run_dir / 'browser-results.json'), 'FRESH_OWNER_OUTPUT_DIR': str(run_dir / 'browser-output'),
            'PLAYWRIGHT_BROWSERS_PATH': str(TEMP_ROOT / 'release-owner-browsers'), 'PLAYWRIGHT_NO_COPY_PROMPT': '1'}
        for suffix in ['desktop', 'iphone']:
            invite = seed['invitations'][suffix]
            require(invite['email'] == f'luster.owner.{run_tag}.{suffix}+clerk_test@example.com' and re.fullmatch('[A-Za-z0-9_-]{20,200}', invite['token']), 'INVITATION_PRIVATE_PIPE_CONTRACT')
            browser_env['FRESH_OWNER_INVITE_TOKEN_' + suffix.upper()] = invite['token']
            browser_env['FRESH_OWNER_INVITED_EMAIL_' + suffix.upper()] = invite['email']
        # No raw private bootstrap payload survives as a logged/file record.
        boot['buffer'].clear()
        seed.clear()
        browser_command = [str(NODE), str(CANDIDATE / 'node_modules/@playwright/test/cli.js'), 'test', '--config', str(BROWSER_ROOT / 'playwright.config.mts')]
        if args.project:
            browser_command += ['--project', args.project]
        wait_for_browser_headroom(controller, args.project)
        browser = controller.start('browser', browser_command, browser_env, CANDIDATE)
        for value in [app_env, browser_env]:
            for key in list(value):
                if key in {'CLERK_SECRET_KEY', 'CLERK_TESTING_TOKEN', 'DATABASE_URL'} or key.startswith('FRESH_OWNER_INVITE_TOKEN_'):
                    value[key] = ''
        secret, public, testing, password, database_url = '', '', '', '', ''
        controller.wait(browser, 800)
        projects = [args.project] if args.project else ['desktop-chromium', 'iphone-13-webkit']
        safe_result = browser_result(run_dir / 'browser-results.json', projects)
        source_verified = verify_copy(snapshot, copy_root, generated_allowed=True)
        require(source()['sha'] == SHA, 'SOURCE_CHANGED_AFTER_RUNTIME')
        status = 'passed-development-journey'
    except RenderOnlyComplete:
        pass
    except Stop as error:
        failure = str(error)  # only controller-owned fixed error codes
    except Exception:
        failure = 'UNEXPECTED_CONTROLLER_ERROR_REDACTED'
    finally:
        primary_failure = failure
        stopped = controller.stop_all()
        cleanup_failure = controller.cleanup_failure_code
        # Consume at most32 nonblocking rounds after child shutdown. This
        # never invokes tick/resource/service guards or retains raw bytes.
        for _ in range(32):
            try:
                controller.drain_stdio()
            except Exception as error:
                controller.cleanup_note('final-stdio-drain', error)
                break
        if not stopped:
            cleanup_failure = cleanup_failure or 'OWNED_PROCESS_STOP_UNCERTAIN'
            failure = primary_failure or 'OWNED_PROCESS_STOP_UNCERTAIN'
        if args.cleanup_created and clerk and baseline and not args.render_only:
            try:
                # If browser failed before reporting IDs, independently discover
                # only exact predeclared fresh emails and their tagged own orgs.
                if safe_result is None and (run_dir / 'browser-results.json').is_file():
                    physical(run_dir / 'browser-results.json', 0o600)
                    if (run_dir / 'browser-results.json').stat().st_size <= 512 * 1024:
                        raw_result = json.loads((run_dir / 'browser-results.json').read_text())
                require(stopped, 'CLERK_CLEANUP_REQUIRES_STOPPED_APP_AND_BROWSER')
                cleanup = cleanup_created(clerk, run_tag, started_ms, baseline, safe_result or raw_result)
            except Stop as error:
                cleanup = {'phase': 'retained-for-review', 'code': str(error)}
                cleanup_failure = cleanup_failure or 'CLERK_SCOPED_CLEANUP_INCOMPLETE'
                failure = failure or 'CLERK_SCOPED_CLEANUP_INCOMPLETE'
            except Exception:
                cleanup = {'phase': 'retained-for-review', 'code': 'CLEANUP_EXCEPTION_REDACTED'}
                cleanup_failure = cleanup_failure or 'CLERK_SCOPED_CLEANUP_INCOMPLETE'
                failure = failure or 'CLERK_SCOPED_CLEANUP_INCOMPLETE'
        retained = True
        if stopped:
            try:
                owner = json.loads((work / 'ownership.json').read_text())
                require(owner == {'runTag': run_tag, 'controllerPid': os.getpid(), 'sourceSha': SHA} and not work.is_symlink(), 'OWNED_WORK_ROOT_IDENTITY_REJECTED')
                if (work / 'app').exists():
                    verify_copy(snapshot, work / 'app', generated_allowed=True)
                shutil.rmtree(work)  # only exclusive owned work; does not follow node_modules symlink
                retained = False
            except Exception:
                cleanup_failure = cleanup_failure or 'OWNED_WORK_CLEANUP_RETAINED'
                failure = failure or 'OWNED_WORK_CLEANUP_RETAINED'
        for signum, previous in signal_handlers.items():
            signal.signal(signum, previous)
        report = {'runTag': run_tag, 'sourceSha': SHA, 'ciContext': prep['ciContext'], 'runtimeQualification': 'functional UI only; isolated Ubuntu runner Next Development exact b811 copied source; Next1536MiB/bootstrap-browser256MiB heaps,4GiB aggregate; separate from local/load envelopes; not production-build proof',
            'status': status if failure is None else 'failed-or-incomplete', 'failureCode': failure, 'resourceBounds': {'envelope': RUNTIME_ENVELOPE, 'diskFloorBytes': FLOOR, 'combinedRssKiB': RSS_LIMIT_KIB, 'nodeHeapMiBByRole': ROLE_HEAP_MIB},
            'observed': {'minFreeBytes': controller.min_free, 'peakCombinedRssKiB': controller.peak_rss},
            'allOwnedProcessGroupsStopped': stopped, 'ownedWorkRetained': retained, 'clerkCleanup': cleanup,
            'sourceVerification': source_verified, 'rawStdioPersisted': False, 'credentialFilesCreated': False, 'providerConfigMutated': False,
            'safeStdioClassifierCounts': controller.classifiers, 'renderOnly': args.render_only,
            'lastStartedPhase': controller.phase, 'failedService': controller.service_exit, 'renderHttp': controller.render_http,
            'preBrowserHeadroom': controller.pre_browser_headroom,
            'primaryFailureCode': primary_failure, 'cleanupFailureCode': cleanup_failure,
            'cleanupDiagnostics': controller.cleanup_diagnostics, 'serviceStopObservations': controller.service_stop_observations,
            'unknownGroupMemberDiagnostics': controller.unknown_group_members, 'unknownGroupMemberCount': controller.unknown_group_member_count,
            'childExitCodes': {item['label']: item['process'].poll() for item in controller.children}}
        exclusive_json(run_dir / 'result.json', report)
        controller.fd_logs.close()
        print(json.dumps({'runTag': run_tag, 'status': report['status'], 'failureCode': failure, 'ownedWorkRetained': retained}))
    return 0 if failure is None and status in {'passed-development-journey', 'passed-development-render-only'} else 1

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--resource-reviewed', action='store_true')
    parser.add_argument('--render-only', action='store_true', help='start owned runtime and render invitation page; never start signup or create testing token')
    parser.add_argument('--project', choices=['desktop-chromium', 'iphone-13-webkit'], default='desktop-chromium')
    parser.add_argument('--cleanup-created', action='store_true', help='explicitly delete ONLY independently verified fresh run-tagged Clerk test fixtures')
    args = parser.parse_args()
    if not args.execute:
        print(json.dumps(prepare(), sort_keys=True))
        return 0
    return execute(args)

if __name__ == '__main__':
    os.umask(0o077)
    try:
        raise SystemExit(main())
    except Stop as error:
        print(json.dumps({'status': 'refused', 'code': str(error), 'rawErrorRetained': False}))
        raise SystemExit(1)
    except Exception:
        print(json.dumps({'status': 'refused', 'code': 'PREPARATION_EXCEPTION_REDACTED', 'rawErrorRetained': False}))
        raise SystemExit(1)
