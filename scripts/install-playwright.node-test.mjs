import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parse } from 'yaml';

const action = parse(readFileSync(new URL('../.github/actions/install-playwright/action.yml', import.meta.url), 'utf8'));
const dependencyScript = action.runs.steps.find(step => step.name === 'Install Playwright OS dependencies').run;

// Run the real action shell with short fixture deadlines. Every privileged or
// installer command is replaced; only disposable, unprivileged processes run.
const fixtureScript = dependencyScript
  .replaceAll('run_deps_bounded 480', 'run_deps_bounded 30')
  .replaceAll('sleep 2', 'sleep 0.1')
  .replaceAll('sleep 5', 'sleep 0.1')
  .replaceAll('sleep 3', 'sleep 0.1')
  .replaceAll('sleep 1', 'sleep 0.1')
  .replaceAll('seq 1 20', 'seq 1 3');

const helper = `#!${process.execPath}
import {spawn,spawnSync} from 'node:child_process';
import {appendFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
const dir=process.env.FIXTURE_DIR;
const mode=process.env.FIXTURE_MODE;
const args=process.argv.slice(2);
const name=path.basename(process.argv[1]);
const log=(line)=>appendFileSync(dir+'/calls',line+'\\n');
if(name==='setsid'){
  // Native Linux setsid is preferred. This POSIX fallback gives macOS real
  // detached process groups; it does not prove GNU command-line parsing.
  const child=spawn(args[2],args.slice(3),{detached:true,stdio:'inherit'});
  log('group '+child.pid);
  child.on('exit',(code,signal)=>process.exit(code??(signal?1:0)));
}else if(name==='ps'){
  if(mode!=='empty-pgid'){
    const result=spawnSync('/bin/ps',args,{encoding:'utf8'});
    if(/^\\s*\\d+\\s*$/.test(result.stdout))log('group '+result.stdout.trim());
    process.stdout.write(result.stdout);process.exit(result.status??1);
  }
}else if(name==='sudo'){
  const command=args.shift();
  if(command==='tee'){process.stdin.resume();process.stdin.on('end',()=>process.exit(0));}
  else if(command==='kill'){
    log('kill '+args.join(' '));
    const target=args.at(-1);
    const owned=target?.startsWith('-')&&readFileSync(dir+'/calls','utf8').split('\\n').includes('group '+target.slice(1));
    if(!owned)process.exit(2);
    if(!args.includes('--') || (mode==='kill-failure' && args[0]!=='-0'))process.exit(1);
    const result=spawnSync('/bin/kill',args,{stdio:'ignore'});process.exit(result.status??1);
  }else if(command==='fuser'){
    log('lock-check');process.exit(mode==='locked'?0:1);
  }else if(command==='pkill'){log('lock-cleanup');process.exit(1);}
  else if(command==='timeout'){
    log('bounded-repair '+args.join(' '));
    if(!args.includes('dpkg'))process.exit(1);
    process.exit(0);
  }else if(command==='dpkg'){log('unbounded-repair');process.exit(0);}
  else process.exit(1);
}else if(name==='npx'){
  const attempts=existsSync(dir+'/attempts')?Number(readFileSync(dir+'/attempts','utf8')):0;
  writeFileSync(dir+'/attempts',String(attempts+1));log('attempt '+(attempts+1));
  if(attempts>0)process.exit(0);
  process.on('SIGTERM',()=>{});
  const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});
  log('child '+child.pid);setInterval(()=>{},1000);
}else process.exit(1);
`;

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    // A zombie cannot hold locks or run an installer. Linux may retain one
    // briefly until its parent/init reaps it.
    const status = spawnSync('/bin/ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
    return status && !status.startsWith('Z');
  } catch {
    return false;
  }
};

async function runFixture(mode) {
  const dir = mkdtempSync(path.join(tmpdir(), 'playwright-installer-contract-'));
  const nativeSetsid = ['/usr/bin/setsid', '/bin/setsid'].find(file => existsSync(file));
  for (const command of ['sudo', 'npx', 'ps', ...(nativeSetsid ? [] : ['setsid'])]) {
    writeFileSync(path.join(dir, command), helper, { mode: 0o755 });
  }
  const command = spawn('/bin/bash', ['-euo', 'pipefail', '-c', fixtureScript], {
    detached: true,
    env: { ...process.env, PATH: `${dir}:${path.dirname(process.execPath)}:/usr/bin:/bin`, TMPDIR: dir, FIXTURE_DIR: dir, FIXTURE_MODE: mode },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  command.stdout.on('data', bytes => output += bytes);
  command.stderr.on('data', bytes => output += bytes);
  let expired = false;
  let result;
  const timer = setTimeout(() => {
    expired = true;
    try {
      process.kill(-command.pid, 'SIGKILL');
    } catch {}
  }, 6000);
  try {
    const code = await new Promise((resolve, reject) => {
      command.on('error', reject);
      command.on('exit', resolve);
    });
    const calls = existsSync(path.join(dir, 'calls')) ? readFileSync(path.join(dir, 'calls'), 'utf8') : '';
    const pids = [...calls.matchAll(/^(?:child|group) (\d+)$/gm)].map(match => Number(match[1]));
    result = { code, expired, output, calls, livePids: pids.filter(alive), platformProof: nativeSetsid ? 'native Linux setsid' : 'POSIX detached-group fallback' };
    return result;
  } finally {
    clearTimeout(timer);
    const calls = existsSync(path.join(dir, 'calls')) ? readFileSync(path.join(dir, 'calls'), 'utf8') : '';
    // Only fixture-recorded groups/PIDs are cleaned up, never host apt/dpkg.
    const ownerGroup = Number(spawnSync('/bin/ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).stdout.trim());
    for (const match of calls.matchAll(/^group (\d+)$/gm)) {
      const group = Number(match[1]);
      assert.ok(group > 1 && group !== ownerGroup, 'Cleanup must target only a detached fixture group');
      try {
        process.kill(-group, 'SIGKILL');
      } catch {}
    }
    for (const match of calls.matchAll(/^child (\d+)$/gm)) {
      try {
        process.kill(Number(match[1]), 'SIGKILL');
      } catch {}
    }
    const pids = [...calls.matchAll(/^(?:child|group) (\d+)$/gm)].map(match => Number(match[1]));
    for (let attempt = 0; attempt < 20 && pids.some(alive); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (result) {
      result.postCleanupLivePids = pids.filter(alive);
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Playwright watchdog kills a TERM-resistant process group and retries only after verified cleanup', async () => {
  const result = await runFixture('term-resistant');
  assert.deepEqual(result.postCleanupLivePids, [], result.calls);
  assert.equal(result.expired, false, result.output);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Attempt 1 failed with status 124/);
  assert.match(result.calls, /kill -TERM -- -\d+/);
  assert.match(result.calls, /kill -KILL -- -\d+/);
  assert.ok(result.calls.indexOf('lock-check') < result.calls.indexOf('attempt 2'));
  assert.match(result.calls, /bounded-repair --kill-after=5 60 dpkg --configure -a/);
  assert.ok(result.calls.indexOf('lock-check', result.calls.indexOf('bounded-repair')) < result.calls.indexOf('attempt 2'));
  assert.doesNotMatch(result.calls, /unbounded-repair/);
  assert.deepEqual(result.livePids, [], result.calls);
});

test('Playwright watchdog fails closed when process-group signals fail', async () => {
  const result = await runFixture('kill-failure');
  assert.deepEqual(result.postCleanupLivePids, [], result.calls);
  assert.equal(result.expired, false, result.output);
  assert.notEqual(result.code, 0, result.output);
  assert.doesNotMatch(result.calls, /attempt 2/);
  assert.match(result.output, /Attempt 1 failed with status 125/);
});

test('Playwright dependency command cannot start without a recorded process group', async () => {
  const result = await runFixture('empty-pgid');
  assert.deepEqual(result.postCleanupLivePids, [], result.calls);
  assert.equal(result.expired, false, result.output);
  assert.notEqual(result.code, 0, result.output);
  assert.doesNotMatch(result.calls, /attempt /);
  assert.doesNotMatch(result.calls, /kill -\w+ -- -(?:0|1)(?:\s|$)/);
});

test('Playwright watchdog never retries while privileged package locks remain held', async () => {
  const result = await runFixture('locked');
  assert.deepEqual(result.postCleanupLivePids, [], result.calls);
  assert.equal(result.expired, false, result.output);
  assert.notEqual(result.code, 0, result.output);
  assert.match(result.calls, /lock-check/);
  assert.doesNotMatch(result.calls, /attempt 2/);
  assert.deepEqual(result.livePids, [], result.calls);
});
