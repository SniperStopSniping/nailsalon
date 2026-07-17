/* eslint-disable no-console */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// ---------------------------------------------------------------------------
// File collection: every git-tracked file, plus built client assets if present
// ---------------------------------------------------------------------------

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

function addFiles(directory) {
  if (!existsSync(directory)) {
    return;
  }
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      addFiles(path);
    } else {
      files.push(path);
    }
  }
}

addFiles('.next/static');

const MAX_SCAN_BYTES = 2 * 1024 * 1024;

function readScannable(file) {
  let contents;
  try {
    contents = readFileSync(file);
  } catch {
    return null;
  }
  if (contents.length > MAX_SCAN_BYTES) {
    return null;
  }
  return contents;
}

// ---------------------------------------------------------------------------
// Scan 1 (always on): credential-shaped patterns that must never be tracked
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  {
    name: 'connection string with embedded password',
    regex: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?|amqps?):\/\/[^\s'"`@/:]+:([^\s'"`@/]+)@([^\s'"`/:]+)/g,
    isAllowed: (match) => {
      const password = match[1] ?? '';
      const host = match[2] ?? '';
      if (/^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|host|hostname|db)$/i.test(host)) {
        return true;
      }
      if (/^\*+$/.test(password)) {
        return true; // already-masked example output, e.g. postgres://***:***@…
      }
      return /^(?:password|pass|secret|changeme|example|postgres|user)$/i.test(password);
    },
  },
  {
    name: 'secret API key (sk_live / sk_test)',
    regex: /\bsk_(?:live|test)_[A-Z0-9]{16,}/gi,
    isAllowed: () => false,
  },
  {
    name: 'Stripe webhook signing secret',
    regex: /\bwhsec_[A-Z0-9]{16,}/gi,
    isAllowed: () => false,
  },
  {
    name: 'GitHub token',
    regex: /\bgh[opusr]_[A-Z0-9]{30,}/gi,
    isAllowed: () => false,
  },
  {
    name: 'private key block',
    regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
    isAllowed: () => false,
  },
];

const patternMatches = [];
for (const file of files) {
  const contents = readScannable(file);
  if (!contents) {
    continue;
  }
  const text = contents.toString('latin1');
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match = pattern.regex.exec(text);
    while (match) {
      if (!pattern.isAllowed(match)) {
        patternMatches.push(`${relative(process.cwd(), file)} (${pattern.name})`);
        break;
      }
      match = pattern.regex.exec(text);
    }
  }
}

// ---------------------------------------------------------------------------
// Scan 2 (when provided): literal runtime super-admin credentials
// ---------------------------------------------------------------------------

const secretNames = [
  'SUPER_ADMIN_TEST_PHONE',
  'SUPER_ADMIN_TEST_PASSWORD',
  'E2E_SUPER_ADMIN_PHONE',
  'E2E_SUPER_ADMIN_PASSWORD',
];
const secrets = [...new Set(secretNames.map(name => process.env[name]).filter(value => value && value.length >= 6))];

const literalMatches = [];
if (secrets.length === 0) {
  console.log('Runtime credential scan skipped: no super-admin credentials were provided.');
} else {
  for (const file of files) {
    const contents = readScannable(file);
    if (!contents) {
      continue;
    }
    if (secrets.some(secret => contents.includes(Buffer.from(secret)))) {
      literalMatches.push(relative(process.cwd(), file));
    }
  }
}

const failures = [...new Set([...patternMatches, ...literalMatches])];
if (failures.length > 0) {
  console.error(`Secret leak scan failed in:\n  ${failures.join('\n  ')}`);
  process.exit(1);
}

console.log('Secret leak scan passed.');
