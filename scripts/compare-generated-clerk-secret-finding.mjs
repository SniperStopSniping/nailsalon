/* eslint-disable no-console */
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'acorn';

import { genericAssignmentFingerprints } from './check-secret-leaks.mjs';

const DEFAULT_LIMITS = {
  files: 2048,
  directories: 4096,
  generatedBytes: 128 * 1024 * 1024,
  sdkBytes: 32 * 1024 * 1024,
  perFileBytes: 5 * 1024 * 1024,
  identities: 8192,
  astNodes: 250_000,
  packages: 128,
  publicMatches: 16,
  outputBytes: 4096,
  elapsedMs: 20_000,
};

function refuse(code) {
  throw Object.assign(new Error(code), { diagnosticCode: code });
}

function parsePublicJson(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.size > 5 * 1024 * 1024) {
    refuse('PUBLIC_METADATA_SHAPE');
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function normalizeKey(key) {
  return key.replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2').replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '').toUpperCase();
}

function sensitiveKey(key) {
  return /(?:^|_)(?:SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|PRIVATE_KEY|SIGNING_KEY|SIGNING_SECRET|WEBHOOK_SECRET|DATABASE_URL|REDIS_URL|CONNECTION_STRING|CREDENTIAL)(?:$|_)/i.test(key);
}

// Decode only Acorn string Literals. Never evaluate templates or expressions.
function staticAssignments(bytes, cap, checkTime) {
  const text = bytes.toString('utf8');
  let ast;
  try {
    ast = parse(text, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  } catch {
    return null;
  }
  const candidates = [];
  const stack = [ast];
  let nodes = 0;
  const keyOf = node => node?.type === 'Identifier'
    ? node.name
    : node?.type === 'Literal' && typeof node.value === 'string' ? node.value : null;
  while (stack.length) {
    checkTime();
    const node = stack.pop();
    if (++nodes > cap.astNodes) {
      refuse('AST_NODE_BOUND');
    }
    let key;
    let value;
    if (node.type === 'Property' && node.kind === 'init' && !node.method
      && (!node.computed || node.key.type === 'Literal')) {
      key = keyOf(node.key);
      value = node.value;
    } else if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
      key = node.id.name;
      value = node.init;
    } else if (node.type === 'AssignmentExpression' && ['=', '||=', '??='].includes(node.operator)) {
      key = node.left.type === 'MemberExpression'
        ? (!node.left.computed || node.left.property.type === 'Literal') && keyOf(node.left.property)
        : keyOf(node.left);
      value = node.right;
    }
    if (typeof key === 'string' && value?.type === 'Literal' && typeof value.value === 'string') {
      const normalized = normalizeKey(key);
      if (sensitiveKey(normalized)) {
        const raw = text.slice(value.start, value.end);
        // Bind privately to the unchanged scanner's RAW identity, while the
        // semantic identity uses the parser-decoded value. Unbound findings stay.
        const rawValue = raw.slice(1, -1);
        const scannerIdentities = [...new Set([
          rawValue,
          rawValue.trim().replace(/^['"`]|['"`]$/g, ''),
        ])].map(value => createHash('sha256').update(`${normalized}\0${value}`).digest('hex'));
        candidates.push({
          scannerIdentities,
          semanticIdentity: createHash('sha256').update(`${normalized}\0${value.value}`).digest('hex'),
          offset: value.start,
        });
        if (candidates.length > cap.identities) {
          refuse('IDENTITY_BOUND');
        }
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === 'string') {
            stack.push(child);
          }
        }
      } else if (value && typeof value === 'object' && typeof value.type === 'string') {
        stack.push(value);
      }
    }
  }
  return candidates;
}

function clerkPackages(lock, physicalRoot, cap) {
  const packages = [];
  for (const [lockPath, record] of Object.entries(lock.packages)) {
    const match = /(?:^|\/)node_modules\/(@clerk\/([a-z][a-z0-9-]{0,80}))$/.exec(lockPath);
    if (!match) {
      continue;
    }
    if (lockPath.length > 1024 || lockPath.split('/').some(segment => segment === '.' || segment === '..')
      || !/^(?:node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+\/)*node_modules\/@clerk\/[a-z][a-z0-9-]*$/.test(lockPath)) {
      refuse('SDK_PACKAGE_PATH_SHAPE');
    }
    let current = physicalRoot;
    for (const segment of lockPath.split('/')) {
      current = join(current, segment);
      const info = lstatSync(current);
      if (info.isSymbolicLink()) {
        refuse('SYMLINK_REFUSED');
      }
      if (!info.isDirectory()) {
        refuse('SDK_PACKAGE_PATH_SHAPE');
      }
    }
    const metadata = parsePublicJson(join(current, 'package.json'));
    const packageName = match[1];
    if (metadata.name !== packageName || metadata.version !== record.version
      || !/^\d+\.\d+\.\d+(?:-[a-z0-9.-]+)?$/i.test(metadata.version)
      || !/^sha512-[a-zA-Z0-9+/]{86}==$/.test(record.integrity ?? '')
      || record.resolved !== `https://registry.npmjs.org/${packageName}/-/${match[2]}-${metadata.version}.tgz`) {
      refuse('SDK_PACKAGE_LOCK_MISMATCH');
    }
    packages.push({ root: current, name: packageName, version: metadata.version });
    if (packages.length > cap.packages) {
      refuse('SDK_PACKAGE_BOUND');
    }
  }
  if (!packages.length) {
    refuse('SDK_FILES_MISSING');
  }
  return packages;
}

export function collectClerkAssignmentProvenance(root, { limits = {} } = {}) {
  const cap = { ...DEFAULT_LIMITS, ...limits };
  const started = Date.now();
  const physicalRoot = realpathSync(root);
  const lock = parsePublicJson(join(physicalRoot, 'package-lock.json'));
  if (lock.lockfileVersion !== 3 || !lock.packages) {
    refuse('LOCK_SHAPE');
  }
  const checkTime = () => {
    if (Date.now() - started > cap.elapsedMs) {
      refuse('DIAGNOSTIC_DEADLINE');
    }
  };
  const state = () => ({ files: 0, directories: 0, bytes: 0 });
  const walk = (directory, counters, byteLimit, visit) => {
    checkTime();
    const info = lstatSync(directory);
    if (!info.isDirectory() || ++counters.directories > cap.directories) {
      refuse('DIRECTORY_SHAPE_OR_BOUND');
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      checkTime();
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        refuse('SYMLINK_REFUSED');
      }
      if (entry.isDirectory()) {
        // Nested dependencies are not this package's public source files.
        if (entry.name !== 'node_modules') {
          walk(path, counters, byteLimit, visit);
        }
      } else if (/\.(?:cjs|mjs|js)$/.test(entry.name)) {
        const file = lstatSync(path);
        if (!file.isFile() || file.size > cap.perFileBytes) {
          refuse('FILE_SHAPE_OR_BOUND');
        }
        counters.files += 1;
        counters.bytes += file.size;
        if (counters.files > cap.files || counters.bytes > byteLimit) {
          refuse('INPUT_BOUND');
        }
        const bytes = readFileSync(path);
        if (bytes.length !== file.size) {
          refuse('INPUT_CHANGED');
        }
        visit(path, bytes);
      }
    }
  };

  const generated = new Set();
  const semanticToGenerated = new Map();
  let parseFailures = 0;
  const generatedState = state();
  walk(join(physicalRoot, '.next/static'), generatedState, cap.generatedBytes, (path, bytes) => {
    const scannerPath = relative(physicalRoot, path).split(sep).join('/');
    const original = genericAssignmentFingerprints(scannerPath, bytes, 'generated-client');
    for (const identity of original) {
      generated.add(identity);
      if (generated.size > cap.identities) {
        refuse('IDENTITY_BOUND');
      }
    }
    if (!original.length) {
      return;
    }
    const assignments = staticAssignments(bytes, cap, checkTime);
    if (!assignments) {
      parseFailures += 1;
      return;
    }
    const identities = new Set(original);
    for (const assignment of assignments) {
      for (const identity of assignment.scannerIdentities) {
        if (identities.has(identity)) {
          const matches = semanticToGenerated.get(assignment.semanticIdentity) ?? new Set();
          matches.add(identity);
          semanticToGenerated.set(assignment.semanticIdentity, matches);
        }
      }
    }
  });
  if (!generatedState.files) {
    refuse('GENERATED_FILES_MISSING');
  }

  const sdkState = state();
  const matched = new Set();
  const publicMatches = [];
  const packages = clerkPackages(lock, physicalRoot, cap);
  for (const pkg of packages) {
    const packageRoot = pkg.root;
    walk(packageRoot, sdkState, cap.sdkBytes, (path, bytes) => {
      const assignments = staticAssignments(bytes, cap, checkTime);
      if (!assignments) {
        parseFailures += 1;
        return;
      }
      const matches = assignments.filter(assignment => semanticToGenerated.has(assignment.semanticIdentity));
      if (!matches.length) {
        return;
      }
      for (const assignment of matches) {
        for (const identity of semanticToGenerated.get(assignment.semanticIdentity)) {
          matched.add(identity);
        }
      }
      const publicPath = relative(packageRoot, path).split(sep).join('/');
      if (publicPath.length > 200 || !/^[\w./@-]+$/.test(publicPath)) {
        refuse('PUBLIC_PATH_SHAPE');
      }
      const publicText = bytes.toString('utf8');
      const fileSha256 = createHash('sha256').update(bytes).digest('hex');
      for (const assignment of matches) {
        checkTime();
        if (publicMatches.length >= cap.publicMatches) {
          refuse('ATTRIBUTION_BOUND');
        }
        publicMatches.push({
          package: pkg.name,
          version: pkg.version,
          path: publicPath,
          fileSha256,
          line: publicText.slice(0, assignment.offset).split('\n').length,
          candidateCount: semanticToGenerated.get(assignment.semanticIdentity).size,
        });
      }
    });
  }
  if (!sdkState.files) {
    refuse('SDK_FILES_MISSING');
  }
  checkTime();
  const result = {
    status: parseFailures
      ? 'INCOMPLETE'
      : !generated.size
          ? 'NO_GENERIC_CANDIDATE'
          : matched.size === generated.size ? 'UNVERIFIED_PUBLIC_SEMANTIC_MATCH' : 'UNMATCHED_CANDIDATES',
    attributable: false,
    parseFailures,
    publicSdkPackages: packages.length,
    generatedFiles: generatedState.files,
    publicSdkFiles: sdkState.files,
    generatedCandidates: generated.size,
    matchedCandidates: matched.size,
    unmatchedCandidates: generated.size - matched.size,
    publicMatches,
    qualification: 'Diagnostic only; original scanner still blocks. Semantic matches are unverified; canonical registry tar integrity and exact public file bytes must be independently verified before classification. No values, keys, candidate fingerprints or raw chunks retained.',
  };
  if (Buffer.byteLength(JSON.stringify(result)) > cap.outputBytes) {
    refuse('OUTPUT_BOUND');
  }
  return result;
}

const direct = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (direct) {
  try {
    console.log(JSON.stringify(collectClerkAssignmentProvenance(process.cwd())));
  } catch (error) {
    console.log(JSON.stringify({ status: 'incomplete', code: error.diagnosticCode ?? 'LOCAL_DIAGNOSTIC_FAILURE' }));
    process.exitCode = 2;
  }
}
