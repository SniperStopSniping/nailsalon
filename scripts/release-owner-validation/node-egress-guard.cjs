'use strict';
// Pre-import fence. Trusted source only; not a kernel firewall/native sandbox.
const dns = require('node:dns');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const FRONTEND = 'musical-muskox-47.clerk.accounts.dev';
const local = new Set(['localhost', '127.0.0.1', '::1']);
const localPorts = new Set([55432, 56381, 56512]);
const remote = process.env.FRESH_OWNER_CHILD_ROLE === 'bootstrap' ? new Set() : new Set(['api.clerk.com', FRONTEND, 'fonts.googleapis.com', 'fonts.gstatic.com']);
const deny = () => {
  throw Object.assign(new Error('FRESH_OWNER_EGRESS_BLOCKED'), { code: 'FRESH_OWNER_EGRESS_BLOCKED' });
};
function host(value) {
  return String(value || '').replace(/^\[|\]$/gu, '').toLowerCase();
}
function allowed(value, port) {
  const name = host(value);
  if ((local.has(name) && localPorts.has(Number(port))) || (remote.has(name) && Number(port) === 443)) {
    return name;
  }
  return deny();
}
function urlAllowed(value, method) {
  const url = new URL(typeof value === 'string' || value instanceof URL ? value : value.url);
  allowed(url.hostname, url.port || (url.protocol === 'https:' ? 443 : 80));
  if (!['http:', 'https:'].includes(url.protocol)) {
    deny();
  }
  if (url.hostname.startsWith('fonts.') && !['GET', 'HEAD'].includes(String(method || 'GET').toUpperCase())) {
    deny();
  }
}
const lookup = dns.lookup.bind(dns);
dns.lookup = function (name, ...args) {
  const normalized = host(name);
  if (!local.has(normalized) && !remote.has(normalized)) {
    return deny();
  }
  if (normalized === 'localhost') {
    const cb = args.at(-1);
    const options = args.find(value => value && typeof value === 'object') || {};
    return process.nextTick(() => options.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4));
  }
  return lookup(normalized, ...args);
};
const promisedLookup = dns.promises.lookup.bind(dns.promises);
dns.promises.lookup = async function (name, ...args) {
  const normalized = host(name);
  if (!local.has(normalized) && !remote.has(normalized)) {
    return deny();
  }
  if (normalized === 'localhost') {
    return args[0]?.all ? [{ address: '127.0.0.1', family: 4 }] : { address: '127.0.0.1', family: 4 };
  }
  return promisedLookup(normalized, ...args);
};
for (const method of ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']) {
  for (const owner of [dns, dns.promises]) {
    const original = owner[method]?.bind(owner);
    if (original) {
      owner[method] = function (name, ...args) {
        if (!remote.has(host(name)) && !local.has(host(name))) {
          deny();
        }
        return original(name, ...args);
      };
    }
  }
}
const socketTargets = new WeakMap();
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options = first && typeof first === 'object' ? first : { port: first, host: args[1] };
  if (options.path) {
    deny();
  }
  const approvedHost = allowed(options.host || 'localhost', options.port);
  socketTargets.set(this, { host: approvedHost, port: Number(options.port) });
  return connect.apply(this, args);
};
const tlsConnect = tls.connect;
tls.connect = function (...args) {
  const options = args[0] && typeof args[0] === 'object' ? args[0] : { ...(typeof args[2] === 'object' ? args[2] : {}), port: args[0], host: args[1] };
  if (options.rejectUnauthorized === false) {
    deny();
  }
  const prior = options.socket && socketTargets.get(options.socket);
  if (options.socket && !prior) {
    deny();
  }
  const approved = allowed(options.host || options.servername || prior?.host || 'localhost', options.port || prior?.port || 443);
  if (options.servername && host(options.servername) !== approved) {
    deny();
  }
  if (prior && (prior.host !== approved || prior.port !== Number(options.port || prior.port))) {
    deny();
  }
  return tlsConnect.apply(this, args);
};
for (const transport of [http, https]) {
  const request = transport.request.bind(transport);
  transport.request = function (...args) {
    const first = args[0];
    if (typeof first === 'string' || first instanceof URL) {
      const options = args[1] && typeof args[1] === 'object' ? args[1] : {};
      urlAllowed(first, options.method);
      const url = new URL(first);
      if (options.hostname || options.host || options.port) {
        const effectiveHost = allowed(options.hostname || options.host || url.hostname, options.port || url.port || (transport === https ? 443 : 80));
        if (effectiveHost.startsWith('fonts.') && !['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase())) {
          deny();
        }
      }
    } else {
      const options = first || {};
      allowed(options.hostname || options.host, options.port || (transport === https ? 443 : 80));
      if (host(options.hostname || options.host).startsWith('fonts.') && !['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase())) {
        deny();
      }
    }
    return request(...args);
  };
  transport.get = function (...args) {
    const req = transport.request(...args);
    req.end();
    return req;
  };
}
const nativeFetch = globalThis.fetch;
if (nativeFetch) {
  globalThis.fetch = function (input, options) {
    urlAllowed(input, options?.method || input?.method);
    return nativeFetch(input, options);
  };
}
// Threshold suppresses Next's URL-bearing trace events. Also refuse its trace
// sink if a future code path bypasses that environment threshold.
const writeStream = fs.createWriteStream;
fs.createWriteStream = function (file, ...args) {
  const value = String(file);
  if (path.basename(value) === 'trace' && value.includes(`${path.sep}.next${path.sep}`)) {
    throw new Error('FRESH_OWNER_TRACE_FILE_FORBIDDEN');
  }
  return writeStream.call(this, file, ...args);
};

// Playwright normally detaches browser children. Keep every Node-spawned child
// in its fresh controller-owned inherited process group. This changes harness
// process ownership only, never product/auth behavior. No shell is introduced.
for (const method of ['spawn', 'spawnSync']) {
  const original = childProcess[method];
  childProcess[method] = function (command, args, options) {
    if (!Array.isArray(args)) {
      options = args;
      args = [];
    }
    return original.call(this, command, args, { ...options, detached: false });
  };
}
const fork = childProcess.fork;
childProcess.fork = function (modulePath, args, options) {
  if (!Array.isArray(args)) {
    options = args;
    args = [];
  }
  return fork.call(this, modulePath, args, { ...options, detached: false });
};

require('node:module').syncBuiltinESMExports();
