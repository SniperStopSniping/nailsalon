/* eslint-disable no-console */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const secretNames = [
  'SUPER_ADMIN_TEST_PHONE',
  'SUPER_ADMIN_TEST_PASSWORD',
  'E2E_SUPER_ADMIN_PHONE',
  'E2E_SUPER_ADMIN_PASSWORD',
];
const secrets = [...new Set(secretNames.map(name => process.env[name]).filter(value => value && value.length >= 6))];

if (secrets.length === 0) {
  console.log('Secret leak scan skipped: no runtime super-admin credentials were provided.');
  process.exit(0);
}

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

const matches = [];
for (const file of files) {
  let contents;
  try {
    contents = readFileSync(file);
  } catch {
    continue;
  }
  if (secrets.some(secret => contents.includes(Buffer.from(secret)))) {
    matches.push(relative(process.cwd(), file));
  }
}

if (matches.length > 0) {
  console.error(`Secret leak scan failed in: ${matches.join(', ')}`);
  process.exit(1);
}

console.log('Secret leak scan passed.');
