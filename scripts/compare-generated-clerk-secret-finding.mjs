/* eslint-disable no-console */
import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { genericAssignmentFingerprints } from './check-secret-leaks.mjs';

const DEFAULT_LIMITS = {
  files: 2048,
  directories: 4096,
  generatedBytes: 128 * 1024 * 1024,
  sdkBytes: 32 * 1024 * 1024,
  perFileBytes: 5 * 1024 * 1024,
  identities: 8192,
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
  const generatedState = state();
  walk(join(physicalRoot, '.next/static'), generatedState, cap.generatedBytes, (path, bytes) => {
    const scannerPath = relative(physicalRoot, path).split(sep).join('/');
    for (const identity of genericAssignmentFingerprints(scannerPath, bytes, 'generated-client')) {
      generated.add(identity);
      if (generated.size > cap.identities) {
        refuse('IDENTITY_BOUND');
      }
    }
  });
  if (!generatedState.files) {
    refuse('GENERATED_FILES_MISSING');
  }

  const sdkState = state();
  const matched = new Set();
  const publicMatches = [];
  const scope = join(physicalRoot, 'node_modules/@clerk');
  if (!lstatSync(scope).isDirectory() || realpathSync(scope) !== scope) {
    refuse('SDK_SCOPE_SHAPE');
  }
  for (const entry of readdirSync(scope, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-z][a-z0-9-]{0,80}$/.test(entry.name)) {
      refuse('SDK_PACKAGE_SHAPE');
    }
    const packageRoot = join(scope, entry.name);
    const packageName = `@clerk/${entry.name}`;
    const metadata = parsePublicJson(join(packageRoot, 'package.json'));
    const record = lock.packages[`node_modules/${packageName}`];
    if (metadata.name !== packageName || !record || metadata.version !== record.version
      || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(metadata.version)
      || !/^sha512-[a-zA-Z0-9+/]+=*$/.test(record.integrity ?? '')
      || !String(record.resolved).startsWith('https://registry.npmjs.org/@clerk/')) {
      refuse('SDK_PACKAGE_LOCK_MISMATCH');
    }
    walk(packageRoot, sdkState, cap.sdkBytes, (path, bytes) => {
      // Only exact lexical identities count. No eval, guessing or secret output.
      // Unsupported minifier transformations remain unmatched.
      const identities = genericAssignmentFingerprints('public-sdk.js', bytes, 'public-sdk');
      const matches = identities.filter(identity => generated.has(identity));
      if (!matches.length) {
        return;
      }
      for (const identity of matches) {
        matched.add(identity);
      }
      const publicPath = relative(packageRoot, path).split(sep).join('/');
      if (publicPath.length > 200 || !/^[a-zA-Z0-9_./@-]+$/.test(publicPath)) {
        refuse('PUBLIC_PATH_SHAPE');
      }
      if (publicMatches.length >= cap.publicMatches) {
        refuse('ATTRIBUTION_BOUND');
      }
      publicMatches.push({
        package: packageName,
        version: metadata.version,
        path: publicPath,
        fileSha256: createHash('sha256').update(bytes).digest('hex'),
        keyClass: 'GENERIC_SECRET_ASSIGNMENT',
        candidateCount: matches.length,
      });
    });
  }
  if (!sdkState.files) {
    refuse('SDK_FILES_MISSING');
  }
  checkTime();
  const result = {
    status: !generated.size ? 'NO_GENERIC_CANDIDATE'
      : matched.size === generated.size ? 'PUBLIC_ASSIGNMENT_IDENTITY_MATCH' : 'UNMATCHED_CANDIDATES',
    generatedFiles: generatedState.files,
    publicSdkFiles: sdkState.files,
    generatedCandidates: generated.size,
    matchedCandidates: matched.size,
    unmatchedCandidates: generated.size - matched.size,
    publicMatches,
    qualification: 'Diagnostic only; original scanner still blocks. Package name/version match npm-ci lock entries; public file hashes require independent published-source verification. No values or raw chunks retained.',
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
