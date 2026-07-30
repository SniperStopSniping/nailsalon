/* eslint-disable no-console */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
} from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_SCAN_BYTES = 5 * 1024 * 1024;
const MAX_GIT_BUFFER_BYTES = 64 * 1024 * 1024;
const OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const ZERO_OID_PATTERN = /^(?:0{40}|0{64})$/;
const ROOT = process.cwd();

const RULES = {
  TRACKED_RUNTIME_DOTENV: 'tracked runtime dotenv file',
  NEON_DATABASE_URL_CREDENTIALS: 'Neon database URL with embedded credentials',
  DATABASE_URL_CREDENTIALS: 'database URL with embedded credentials',
  REDIS_URL_CREDENTIALS: 'Redis URL with embedded credentials',
  PROVIDER_SECRET_KEY: 'provider secret key',
  STRIPE_SECRET_KEY: 'Stripe secret key',
  STRIPE_WEBHOOK_SIGNING_SECRET: 'Stripe webhook signing secret',
  CLERK_SECRET_KEY: 'Clerk secret key',
  RESEND_API_KEY: 'Resend API key',
  TWILIO_AUTH_TOKEN: 'Twilio authentication token',
  GITHUB_TOKEN: 'GitHub token',
  PRIVATE_KEY_BLOCK: 'private key material',
  WEBHOOK_SIGNING_SECRET: 'webhook signing secret',
  GENERIC_SECRET_ASSIGNMENT: 'high-confidence secret assignment',
  MULTILINE_SECRET_ASSIGNMENT: 'multiline secret assignment',
  RUNTIME_CREDENTIAL_LITERAL: 'runtime credential literal',
  UNREADABLE_TRACKED_FILE: 'tracked file could not be read safely',
  UNSCANNED_TEXT_FILE: 'text file exceeds the safe scan limit',
};

// Allowlisting is value-specific. These fingerprints bind a safe value to its
// exact path and rule/key, so changing or moving it cannot exempt nearby data.
const SAFE_ASSIGNMENT_FINGERPRINTS = new Set([
  // Infra PR 1 disposable PostgreSQL service password in CI.yml.
  'f2058d6e1a93e15360880c33992a289dfaccb9832632850e36c91c95ee4e5552',
  // CI constructs this synthetic E2E-only password from GitHub run metadata.
  '478c34d2cfbfedaa38386da0ac676cb358cc671a3b316b9403f14435ca386b70',
  // Existing E2E helpers generate synthetic, non-provider login passwords.
  'b443f141a5a9072dd12272ee7da5af6cfa8ee298b1335e0a6a83dba934956724',
  'a3d99370d541e19211e415a5bc6cc3c53048b9f28ec7b6e9ec279a8fd92d7b73',
  // Scanner-test synthetic: exact path + SCANNER_FIXTURE_SECRET + exact value.
  '92dec48809ca0f418ab09d2ffa828b043936e8f94438385810e20014dea6bf56',
]);

const SAFE_URL_FINGERPRINTS = new Set([
  // Infra PR 1 loopback-only disposable E2E PostgreSQL URL in CI.yml.
  'd83b516a6b3e77930d099e6456cd9b0d0f93c42a439a57db0b4c5f0c351eb84c',
  // Existing loopback-only appointment concurrency command fixture.
  'd0245090b90c0a9276051adf28f64ed0357fb20ade26b8e3a6cf6be317c04e6e',
  // Existing literal user/pass/host documentation placeholder at its exact path.
  '9c45aaf13430d54a54013c6010f1d259e6741252820a21d8acf7c2668a5cd00b',
]);

const SAFE_EXACT_PLACEHOLDERS = new Set([
  'ci-placeholder-not-a-secret',
]);

// Clerk's generated localization catalog uses credential words in UI-message
// identifiers. Only these exact keys may contain bounded, multi-word copy;
// token-like values and every adjacent assignment remain subject to scanning.
const SAFE_LOCALIZATION_COPY_KEYS = new Set([
  'BLOCK_BUTTON_RESET_PASSWORD',
  'FORM_FIELD_ACTION_FORGOT_PASSWORD',
  'FORM_PASSWORD_LENGTH_TOO_SHORT',
  'FORM_PASSWORD_PWNED',
  'FORM_PASSWORD_PWNED_SIGN_IN',
  'PRIMARY_BUTTON_SET_PASSWORD',
]);

class SafeScannerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SafeScannerError';
  }
}

function runGit(args, encoding = 'utf8') {
  try {
    return execFileSync('git', args, {
      cwd: ROOT,
      encoding,
      env: {
        ...process.env,
        GIT_LITERAL_PATHSPECS: '1',
      },
      maxBuffer: MAX_GIT_BUFFER_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new SafeScannerError(
      'Git metadata could not be resolved safely. Fetch full history and retry.',
    );
  }
}

function fingerprint(...parts) {
  return createHash('sha256').update(parts.join('\0')).digest('hex');
}

function lineNumberAt(text, index) {
  let line = 1;
  for (let offset = 0; offset < index; offset += 1) {
    if (text.charCodeAt(offset) === 10) {
      line += 1;
    }
  }
  return line;
}

function normalizePath(path) {
  return path.split(sep).join('/');
}

function replaceControlCharacters(value) {
  return [...value].map((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127 ? '?' : character;
  }).join('');
}

function sanitizedPath(path) {
  const normalized = replaceControlCharacters(normalizePath(path));
  const segments = normalized.split('/');
  const hasSensitiveName = segments.some((segment) => {
    const canonical = normalizeAssignmentKey(segment);
    return /(?:^|_)(?:CREDENTIALS?|SECRETS?|TOKENS?|PRIVATE_KEY|API_KEY|AUTH_TOKEN|ACCESS_TOKEN|SIGNING_KEY)(?:_|$)/.test(canonical)
      || /\b(?:gh[opusr]_[a-z0-9]{20,}|github_pat_\w{20,}|whsec_[a-z0-9]{12,}|sk_(?:live|test)_[a-z0-9]{12,}|re_[\w-]{20,})\b/i.test(segment)
      || isHighEntropy(segment);
  });
  return hasSensitiveName ? '<sensitive-path>' : normalized;
}

function isRuntimeDotenvPath(path) {
  const normalized = normalizePath(path);
  const name = basename(normalized);
  if (normalized === '.env.example') {
    return false;
  }
  return name.startsWith('.env');
}

function isBinary(buffer) {
  const sampleLength = Math.min(buffer.length, 8192);
  for (let index = 0; index < sampleLength; index += 1) {
    if (buffer[index] === 0) {
      return true;
    }
  }
  return false;
}

function normalizeAssignmentKey(key) {
  return key
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function isKnownDigest(value, key) {
  const digestKey = /(?:^|_)(?:SHA(?:1|224|256|384|512)?|COMMIT|HASH|CHECKSUM|DIGEST)(?:$|_)/i.test(key);
  return !isSensitiveKey(key)
    && digestKey
    && /^[0-9a-f]{32,128}$/i.test(value);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isReservedInvalidAddress(value) {
  const unquoted = value.replace(/^['"`]|['"`]$/g, '');
  if (/^[^@\s]+@(?:[^@\s.]+\.)*example\.invalid$/i.test(unquoted)) {
    return true;
  }
  try {
    const url = new URL(unquoted);
    return url.hostname === 'example.invalid' || url.hostname.endsWith('.example.invalid');
  } catch {
    return /^(?:[^.\s]+\.)*example\.invalid$/i.test(unquoted);
  }
}

function isSafeLocalAddress(value) {
  try {
    const url = new URL(value);
    return !url.password
      && (
        url.hostname === 'localhost'
        || url.hostname === '127.0.0.1'
        || url.hostname === '[::1]'
      );
  } catch {
    return false;
  }
}

function isSafeUrlAssignment(path, value) {
  try {
    const url = new URL(value);
    if (isSafeLocalAddress(value)) {
      return true;
    }
    if (!url.password) {
      return false;
    }
    const protocol = url.protocol.toLowerCase();
    const rule = protocol === 'redis:' || protocol === 'rediss:'
      ? 'REDIS_URL_CREDENTIALS'
      : url.hostname === 'neon.tech' || url.hostname.endsWith('.neon.tech')
        ? 'NEON_DATABASE_URL_CREDENTIALS'
        : 'DATABASE_URL_CREDENTIALS';
    return SAFE_URL_FINGERPRINTS.has(fingerprint(normalizePath(path), rule, value));
  } catch {
    return false;
  }
}

function isClearlyFakePlaceholder(value) {
  return SAFE_EXACT_PLACEHOLDERS.has(value)
    || /^replace-with-[a-z0-9-]+$/i.test(value)
    || /^<[^<>\r\n]+>$/.test(value)
    || /^\$\{[A-Z][A-Z0-9_]*\}$/.test(value)
    || /^\$\{\{[^{}\r\n]+\}\}$/.test(value)
    || /^\*{6,}$/.test(value);
}

function shannonEntropy(value) {
  const counts = new Map();
  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function isHighEntropy(value) {
  const compact = value.replace(/\s/g, '');
  if (compact.length < 20) {
    return false;
  }
  if (isUuid(compact)) {
    return true;
  }
  if (/^[0-9a-f]{32,128}$/i.test(compact)) {
    return shannonEntropy(compact.toLowerCase()) >= 3;
  }
  const hasVariety = /[a-z]/.test(compact)
    && /[A-Z]/.test(compact)
    && /\d/.test(compact);
  return hasVariety && shannonEntropy(compact) >= 3.4;
}

function isSafeLocalizationCopy(path, source, key, value) {
  const words = value.trim().split(/\s+/);
  const alphabeticWords = words.filter((word) => {
    const core = word.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
    return /^[a-z]+(?:[-'][a-z]+)*$/i.test(core);
  });
  return source === 'generated-client'
    && normalizePath(path).startsWith('.next/static/')
    && SAFE_LOCALIZATION_COPY_KEYS.has(key)
    && value.length <= 256
    && !/[\r\n\t]/.test(value)
    && words.length >= 2
    && words.length <= 40
    && alphabeticWords.length >= Math.ceil(words.length * 0.6)
    && words.every(word => !isHighEntropy(word));
}

function isSafeUuid(value, key) {
  return !isSensitiveKey(key)
    && /(?:^|_)(?:ID|UUID)(?:$|_)/i.test(key)
    && isUuid(value);
}

function isPublicIdentifier(key, value) {
  switch (key) {
    case 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY':
      return /^pk_(?:test|live)_[\w-]{16,}$/.test(value);
    case 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY':
      return /^pk_(?:test|live)_[A-Za-z0-9]{16,}$/.test(value);
    case 'NEXT_PUBLIC_SENTRY_DSN':
      try {
        const url = new URL(value);
        return /^https?:$/.test(url.protocol) && Boolean(url.hostname) && !url.password;
      } catch {
        return false;
      }
    case 'CLOUDINARY_API_KEY':
      return /^\d{6,20}$/.test(value);
    case 'META_APP_ID':
    case 'META_FACEBOOK_PAGE_ID':
    case 'META_INSTAGRAM_ACCOUNT_ID':
      return /^\d{6,32}$/.test(value);
    case 'TWILIO_ACCOUNT_SID':
      return /^AC[0-9a-f]{32}$/i.test(value);
    case 'TWILIO_CONNECT_APP_SID':
      return /^AP[0-9a-f]{32}$/i.test(value);
    case 'TWILIO_VERIFY_SERVICE_SID':
      return /^VA[0-9a-f]{32}$/i.test(value);
    case 'SENTRY_ORG':
    case 'SENTRY_PROJECT':
      return /^[a-z0-9][\w-]{1,63}$/i.test(value);
    default:
      return false;
  }
}

function isPublicIdentifierKey(key) {
  return [
    'CLOUDINARY_API_KEY',
    'META_APP_ID',
    'META_FACEBOOK_PAGE_ID',
    'META_INSTAGRAM_ACCOUNT_ID',
    'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    'NEXT_PUBLIC_SENTRY_DSN',
    'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'SENTRY_ORG',
    'SENTRY_PROJECT',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_CONNECT_APP_SID',
    'TWILIO_VERIFY_SERVICE_SID',
  ].includes(key);
}

function isSafeAssignment(path, key, rawValue) {
  const value = rawValue.trim().replace(/^['"`]|['"`]$/g, '');
  if (
    value === ''
    || /^(?:true|false|null|undefined|\d+)$/i.test(value)
    || isClearlyFakePlaceholder(value)
    || isReservedInvalidAddress(value)
    || isSafeLocalAddress(value)
    || isSafeUrlAssignment(path, value)
    || isSafeUuid(value, key)
    || isKnownDigest(value, key)
  ) {
    return true;
  }
  if (isPublicIdentifier(key, value)) {
    return true;
  }
  return SAFE_ASSIGNMENT_FINGERPRINTS.has(fingerprint(normalizePath(path), key, value));
}

function isSensitiveKey(key) {
  return /(?:^|_)(?:SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|PRIVATE_KEY|SIGNING_KEY|SIGNING_SECRET|WEBHOOK_SECRET|DATABASE_URL|REDIS_URL|CONNECTION_STRING|CREDENTIAL)(?:$|_)/i.test(key);
}

function addFinding(findings, finding) {
  if (findings.accept && !findings.accept(finding)) {
    return;
  }
  const key = [
    finding.path,
    finding.line ?? '',
    finding.rule,
    finding.source,
  ].join('\0');
  if (!findings.keys.has(key)) {
    findings.keys.add(key);
    findings.items.push(finding);
  }
}

function matchAll(text, regex, callback) {
  regex.lastIndex = 0;
  let match = regex.exec(text);
  while (match) {
    callback(match);
    if (match[0].length === 0) {
      regex.lastIndex += 1;
    }
    match = regex.exec(text);
  }
}

function scanProviderPatterns(path, text, source, findings) {
  matchAll(
    text,
    /-----BEGIN((?: [A-Z0-9]+)*) PRIVATE KEY-----/g,
    (match) => {
      const endMarker = `-----END${match[1]} PRIVATE KEY-----`;
      const endIndex = text.indexOf(endMarker, match.index + match[0].length);
      addFinding(findings, {
        path,
        line: lineNumberAt(text, match.index),
        endLine: endIndex === -1
          ? lineNumberAt(text, match.index)
          : lineNumberAt(text, endIndex + endMarker.length),
        rule: 'PRIVATE_KEY_BLOCK',
        classification: RULES.PRIVATE_KEY_BLOCK,
        source,
      });
    },
  );

  matchAll(
    text,
    /\b(?:gh[opusr]_[A-Za-z0-9]{30,}|github_pat_\w{40,})\b/g,
    match => addFinding(findings, {
      path,
      line: lineNumberAt(text, match.index),
      rule: 'GITHUB_TOKEN',
      classification: RULES.GITHUB_TOKEN,
      source,
    }),
  );

  matchAll(
    text,
    /\bwhsec_[A-Za-z0-9]{16,}\b/g,
    match => addFinding(findings, {
      path,
      line: lineNumberAt(text, match.index),
      rule: 'STRIPE_WEBHOOK_SIGNING_SECRET',
      classification: RULES.STRIPE_WEBHOOK_SIGNING_SECRET,
      source,
    }),
  );

  matchAll(
    text,
    /\bre_[\w-]{24,}\b/g,
    match => addFinding(findings, {
      path,
      line: lineNumberAt(text, match.index),
      rule: 'RESEND_API_KEY',
      classification: RULES.RESEND_API_KEY,
      source,
    }),
  );

  matchAll(
    text,
    /\bsk_(?:live|test)_[A-Z0-9]{16,}\b/gi,
    (match) => {
      const lineStart = text.lastIndexOf('\n', match.index) + 1;
      const lineEnd = text.indexOf('\n', match.index);
      const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
      const keys = assignmentCandidates(path, line).map(candidate => candidate.key);
      const isClerk = keys.includes('CLERK_SECRET_KEY');
      const isStripe = keys.includes('STRIPE_SECRET_KEY');
      addFinding(findings, {
        path,
        line: lineNumberAt(text, match.index),
        rule: isClerk ? 'CLERK_SECRET_KEY' : isStripe ? 'STRIPE_SECRET_KEY' : 'PROVIDER_SECRET_KEY',
        classification: isClerk
          ? RULES.CLERK_SECRET_KEY
          : isStripe
            ? RULES.STRIPE_SECRET_KEY
            : RULES.PROVIDER_SECRET_KEY,
        source,
      });
    },
  );

  matchAll(
    text,
    /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?|amqps?):\/\/[^\s"'`<>]+/gi,
    (match) => {
      let parsed;
      try {
        parsed = new URL(match[0].replace(/[),.;]+$/, ''));
      } catch {
        return;
      }
      if (!parsed.password) {
        return;
      }
      const protocol = parsed.protocol.toLowerCase();
      const isRedis = protocol === 'redis:' || protocol === 'rediss:';
      const isNeon = parsed.hostname === 'neon.tech' || parsed.hostname.endsWith('.neon.tech');
      const rule = isRedis
        ? 'REDIS_URL_CREDENTIALS'
        : isNeon
          ? 'NEON_DATABASE_URL_CREDENTIALS'
          : 'DATABASE_URL_CREDENTIALS';
      const normalizedMatch = match[0].replace(/[),.;]+$/, '');
      if (
        SAFE_URL_FINGERPRINTS.has(fingerprint(normalizePath(path), rule, normalizedMatch))
      ) {
        return;
      }
      addFinding(findings, {
        path,
        line: lineNumberAt(text, match.index),
        rule,
        classification: RULES[rule],
        source,
      });
    },
  );
}

function parseQuotedLiteral(rawValue) {
  const value = rawValue.trimStart();
  const quote = value[0];
  if (quote !== '"' && quote !== '\'' && quote !== '`') {
    return null;
  }
  let escaped = false;
  for (let index = 1; index < value.length; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === quote) {
      return value.slice(1, index);
    }
  }
  return null;
}

function parseDeclarationStart(line) {
  const match = /\b(?:const|let|var)\s+([a-z_$][\w$]*)/i.exec(line);
  if (!match) {
    return null;
  }
  let cursor = match.index + match[0].length;
  while (line[cursor] === ' ' || line[cursor] === '\t') {
    cursor += 1;
  }
  if (line[cursor] === ':') {
    const equalsIndex = line.indexOf('=', cursor + 1);
    const semicolonIndex = line.indexOf(';', cursor + 1);
    if (
      equalsIndex === -1
      || (semicolonIndex !== -1 && semicolonIndex < equalsIndex)
    ) {
      return null;
    }
    cursor = equalsIndex;
  }
  if (line[cursor] !== '=') {
    return null;
  }
  return {
    key: match[1],
    value: line.slice(cursor + 1).trimStart(),
  };
}

function isLiteralSimpleAssignment(path, assignment) {
  const rawValue = assignment.value;
  const value = rawValue.trim().replace(/,\s*$/, '');
  if (parseQuotedLiteral(value) !== null) {
    return true;
  }
  if (/(?:process\.env|import\.meta\.env)\./.test(value)) {
    return false;
  }
  if (
    isRuntimeDotenvPath(path)
    || normalizePath(path).endsWith('.env.example')
    || /\.ya?ml$/i.test(path)
    || assignment.delimiter === '='
  ) {
    return true;
  }
  if (
    value === ''
    || /\s/.test(value)
    || /[()[\]{};]/.test(value)
    || /^[a-z_$][\w$]*$/i.test(value)
    || /^[a-z_$][\w$]*(?:\??\.[a-z_$][\w$]*)+$/i.test(value)
  ) {
    return false;
  }
  return true;
}

function assignmentCandidates(path, line) {
  const candidates = [];
  const seen = new Set();
  const add = (key, value) => {
    const normalizedKey = normalizeAssignmentKey(key);
    const identity = `${normalizedKey}\0${value}`;
    if (!seen.has(identity)) {
      seen.add(identity);
      candidates.push({ key: normalizedKey, value });
    }
  };

  const simple = parseSimpleAssignment(line);
  const isCodeTarget = simple
    && /^(?:process\.env|(?:module\.)?exports)\./.test(simple.key);
  if (simple && !isCodeTarget && isLiteralSimpleAssignment(path, simple)) {
    add(simple.key, simple.value.replace(/\s+#.*$/, '').replace(/,\s*$/, ''));
  }

  const declaration = parseDeclarationStart(line);
  if (declaration) {
    const value = parseQuotedLiteral(declaration.value);
    if (value !== null) {
      add(declaration.key, value);
    }
  }

  const patterns = [
    /process\.env\.([a-z_$][\w$]*)\s*(?:=|\|\|=|\?\?=)\s*(["'`])([^"'`\r\n]+)\2/gi,
    /process\.env\[\s*["']([a-z_$][\w$]*)["']\s*\]\s*(?:=|\|\|=|\?\?=)\s*(["'`])([^"'`\r\n]+)\2/gi,
    /(?:module\.)?exports\.([a-z_$][\w$]*)\s*=\s*(["'`])([^"'`\r\n]+)\2/gi,
    /(?:module\.)?exports\[\s*["']([a-z_$][\w$]*)["']\s*\]\s*=\s*(["'`])([^"'`\r\n]+)\2/gi,
    /["']([A-Z_][\w.-]*)["']\s*:\s*(["'`])([^"'`\r\n]+)\2/gi,
    /^[ \t]*([a-z_$][\w$]*)[ \t]*:[ \t]*(["'`])([^"'`\r\n]+)\2/gi,
    /[,{][ \t]*([a-z_$][\w$]*)[ \t]*:[ \t]*(["'`])([^"'`\r\n]+)\2/gi,
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match = pattern.exec(line);
    while (match) {
      add(match[1], match[3]);
      match = pattern.exec(line);
    }
  }
  return candidates;
}

function parseSimpleAssignment(line) {
  let candidate = line.trim();
  if (candidate.startsWith('export ')) {
    candidate = candidate.slice('export '.length).trimStart();
  }
  const equalsIndex = candidate.indexOf('=');
  const colonIndex = candidate.indexOf(':');
  const delimiterIndex = equalsIndex === -1
    ? colonIndex
    : colonIndex === -1
      ? equalsIndex
      : Math.min(equalsIndex, colonIndex);
  if (delimiterIndex <= 0) {
    return null;
  }
  const key = candidate.slice(0, delimiterIndex).trim();
  if (!/^[a-z_][\w.-]*$/i.test(key)) {
    return null;
  }
  return {
    key,
    delimiter: candidate[delimiterIndex],
    value: candidate.slice(delimiterIndex + 1).trim(),
  };
}

function scanAssignments(path, text, source, findings) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    for (const { key, value: rawValue } of assignmentCandidates(path, lines[index])) {
      const value = rawValue.trim().replace(/^['"`]|['"`]$/g, '');
      if (isSafeAssignment(path, key, value)) {
        continue;
      }

      if (key === 'TWILIO_AUTH_TOKEN' && /^[0-9a-f]{32}$/i.test(value)) {
        addFinding(findings, {
          path,
          line: index + 1,
          rule: 'TWILIO_AUTH_TOKEN',
          classification: RULES.TWILIO_AUTH_TOKEN,
          source,
        });
        continue;
      }

      if (key === 'RESEND_API_KEY' && isHighEntropy(value)) {
        addFinding(findings, {
          path,
          line: index + 1,
          rule: 'RESEND_API_KEY',
          classification: RULES.RESEND_API_KEY,
          source,
        });
        continue;
      }

      if (/WEBHOOK.*SECRET|SIGNING.*SECRET|SECRET.*SIGNING/i.test(key) && isHighEntropy(value)) {
        addFinding(findings, {
          path,
          line: index + 1,
          rule: 'WEBHOOK_SIGNING_SECRET',
          classification: RULES.WEBHOOK_SIGNING_SECRET,
          source,
        });
        continue;
      }

      if (isSafeLocalizationCopy(path, source, key, value)) {
        continue;
      }

      const dotenv = isRuntimeDotenvPath(path) || normalizePath(path).endsWith('.env.example');
      if (
        (isSensitiveKey(key) && isHighEntropy(value))
        || (isPublicIdentifierKey(key) && isHighEntropy(value))
        || (dotenv && isHighEntropy(value))
      ) {
        addFinding(findings, {
          path,
          line: index + 1,
          rule: 'GENERIC_SECRET_ASSIGNMENT',
          classification: RULES.GENERIC_SECRET_ASSIGNMENT,
          source,
        });
      }
    }
  }
}

function parseMultilineAssignmentStart(line) {
  const patterns = [
    /process\.env\.([a-z_$][\w$]*)\s*(?:=|\|\|=|\?\?=)\s*/i,
    /process\.env\[\s*["']([a-z_$][\w$]*)["']\s*\]\s*(?:=|\|\|=|\?\?=)\s*/i,
    /(?:module\.)?exports\.([a-z_$][\w$]*)\s*=\s*/i,
    /(?:module\.)?exports\[\s*["']([a-z_$][\w$]*)["']\s*\]\s*=\s*/i,
    /[,{][ \t]*([a-z_$][\w$]*)[ \t]*:[ \t]*/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(line);
    if (match) {
      return {
        key: match[1],
        value: line.slice(match.index + match[0].length).trim(),
      };
    }
  }
  return parseDeclarationStart(line) ?? parseSimpleAssignment(line);
}

function scanMultilineAssignments(path, text, source, findings) {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const start = parseMultilineAssignmentStart(lines[index]);
    if (!start) {
      continue;
    }
    const key = normalizeAssignmentKey(start.key);
    if (!isSensitiveKey(key)) {
      continue;
    }

    const quoteMarker = ['"', '\'', '`'].find(marker => start.value.startsWith(marker));
    const yamlMarker = start.value.match(/^(?:\|[-+]?|>[-+]?)/)?.[0];
    const marker = quoteMarker ?? yamlMarker;
    if (!marker) {
      continue;
    }
    const firstChunk = start.value.slice(marker.length).trimStart();
    const chunks = [firstChunk];
    let endIndex = index;
    if (marker === '"' || marker === '\'' || marker === '`') {
      if (firstChunk.includes(marker)) {
        continue;
      }
      for (let cursor = index + 1; cursor < Math.min(lines.length, index + 50); cursor += 1) {
        const markerIndex = lines[cursor].indexOf(marker);
        chunks.push(markerIndex === -1 ? lines[cursor] : lines[cursor].slice(0, markerIndex));
        endIndex = cursor;
        if (markerIndex !== -1) {
          break;
        }
      }
    } else {
      const baseIndent = lines[index].match(/^\s*/)?.[0].length ?? 0;
      for (let cursor = index + 1; cursor < Math.min(lines.length, index + 50); cursor += 1) {
        const indentation = lines[cursor].match(/^\s*/)?.[0].length ?? 0;
        if (lines[cursor].trim() && indentation <= baseIndent) {
          break;
        }
        chunks.push(lines[cursor].trim());
        endIndex = cursor;
      }
    }

    const value = chunks.join('').replace(/\s/g, '');
    if (!isSafeAssignment(path, key, value) && isHighEntropy(value)) {
      addFinding(findings, {
        path,
        line: index + 1,
        endLine: endIndex + 1,
        rule: 'MULTILINE_SECRET_ASSIGNMENT',
        classification: RULES.MULTILINE_SECRET_ASSIGNMENT,
        source,
      });
    }
    index = Math.max(index, endIndex);
  }
}

function scanBuffer(path, buffer, source, findings) {
  if (isBinary(buffer)) {
    return;
  }
  if (buffer.length > MAX_SCAN_BYTES) {
    addFinding(findings, {
      path,
      rule: 'UNSCANNED_TEXT_FILE',
      classification: RULES.UNSCANNED_TEXT_FILE,
      source,
    });
    return;
  }
  const text = buffer.toString('utf8');
  scanProviderPatterns(path, text, source, findings);
  scanAssignments(path, text, source, findings);
  scanMultilineAssignments(path, text, source, findings);
}

function collectDirectoryFiles(directory, output) {
  if (!existsSync(directory)) {
    return;
  }
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const stats = lstatSync(path);
    if (stats.isDirectory()) {
      collectDirectoryFiles(path, output);
    } else {
      output.push(path);
    }
  }
}

function readWorkingTreeFile(path) {
  try {
    const stats = lstatSync(path);
    return stats.isSymbolicLink()
      ? Buffer.from(readlinkSync(path), 'utf8')
      : readFileSync(path);
  } catch {
    return null;
  }
}

function scanCurrentTree(findings) {
  const tracked = runGit(['ls-files', '-z'])
    .split('\0')
    .filter(Boolean);
  for (const path of tracked) {
    const buffer = readWorkingTreeFile(path);
    if (!buffer) {
      addFinding(findings, {
        path,
        rule: 'UNREADABLE_TRACKED_FILE',
        classification: RULES.UNREADABLE_TRACKED_FILE,
        source: 'tracked-tree',
      });
      continue;
    }
    if (isRuntimeDotenvPath(path)) {
      addFinding(findings, {
        path,
        rule: 'TRACKED_RUNTIME_DOTENV',
        classification: RULES.TRACKED_RUNTIME_DOTENV,
        source: 'tracked-tree',
      });
    }
    scanBuffer(path, buffer, 'tracked-tree', findings);
  }

  const generated = [];
  collectDirectoryFiles('.next/static', generated);
  for (const path of generated) {
    const buffer = readWorkingTreeFile(path);
    if (buffer) {
      scanBuffer(relative(ROOT, path), buffer, 'generated-client', findings);
    }
  }

  return { tracked: tracked.length, generated: generated.length };
}

function resolveExplicitOid(value) {
  if (!OID_PATTERN.test(value)) {
    throw new SafeScannerError('A revision was malformed; only full commit object IDs are accepted.');
  }
  const resolved = runGit([
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${value}^{commit}`,
  ]).trim();
  if (!OID_PATTERN.test(resolved) || resolved.toLowerCase() !== value.toLowerCase()) {
    throw new SafeScannerError('A revision could not be resolved exactly; fetch full history and retry.');
  }
  return resolved;
}

function resolveInternalRevision(revision) {
  try {
    const resolved = runGit([
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${revision}^{commit}`,
    ]).trim();
    return OID_PATTERN.test(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

function mergeBase(base, head) {
  const resolved = runGit(['merge-base', '--', base, head]).trim();
  if (!OID_PATTERN.test(resolved)) {
    throw new SafeScannerError('The requested commits have no safe merge base.');
  }
  return resolved;
}

function commitsAfter(base, head) {
  const output = runGit([
    'rev-list',
    '--reverse',
    '--topo-order',
    `${base}..${head}`,
  ]);
  return output.split(/\r?\n/).filter(Boolean);
}

function explicitRange(baseInput, headInput) {
  const head = resolveExplicitOid(headInput);
  const checkedOutHead = resolveInternalRevision('HEAD');
  if (!checkedOutHead || checkedOutHead !== head) {
    throw new SafeScannerError('The requested head is not the exact checked-out commit.');
  }

  if (ZERO_OID_PATTERN.test(baseInput)) {
    return {
      base: null,
      head,
      commits: runGit(['rev-list', '--reverse', '--topo-order', head])
        .split(/\r?\n/)
        .filter(Boolean),
    };
  }

  const requestedBase = resolveExplicitOid(baseInput);
  const base = mergeBase(requestedBase, head);
  return { base, head, commits: commitsAfter(base, head) };
}

function localRange() {
  const head = resolveInternalRevision('HEAD');
  if (!head) {
    return { base: null, head: null, commits: [] };
  }

  const remoteMain = resolveInternalRevision('refs/remotes/origin/main');
  if (remoteMain) {
    const base = mergeBase(remoteMain, head);
    return { base, head, commits: commitsAfter(base, head) };
  }

  const parent = resolveInternalRevision('HEAD^');
  if (parent) {
    return { base: parent, head, commits: commitsAfter(parent, head) };
  }
  return { base: null, head, commits: [head] };
}

function firstParent(commit) {
  const parts = runGit(['rev-list', '--parents', '-n', '1', commit])
    .trim()
    .split(/\s+/);
  if (parts.length === 0 || parts.some(part => !OID_PATTERN.test(part))) {
    throw new SafeScannerError('A reviewed commit had malformed parent metadata.');
  }
  if (parts[0].toLowerCase() !== commit.toLowerCase()) {
    throw new SafeScannerError('A reviewed commit could not be resolved exactly.');
  }
  return parts[1] ?? null;
}

function parseChangedEntries(output) {
  const parts = output.split('\0').filter(Boolean);
  const entries = [];
  for (let index = 0; index < parts.length;) {
    const status = parts[index];
    index += 1;
    if (!/^(?:[AMT]|[RC]\d{1,3})$/.test(status)) {
      throw new SafeScannerError('Git returned an unsupported change status.');
    }
    if (status.startsWith('R') || status.startsWith('C')) {
      if (index + 1 >= parts.length) {
        throw new SafeScannerError('Git returned incomplete rename metadata.');
      }
      entries.push({
        status: status[0],
        oldPath: parts[index],
        path: parts[index + 1],
      });
      index += 2;
    } else {
      if (index >= parts.length) {
        throw new SafeScannerError('Git returned incomplete path metadata.');
      }
      entries.push({ status: status[0], oldPath: null, path: parts[index] });
      index += 1;
    }
  }
  return entries;
}

function changedEntriesAtCommit(parent, commit) {
  if (!parent) {
    return parseChangedEntries(runGit([
      'diff-tree',
      '--root',
      '-r',
      '-z',
      '--no-commit-id',
      '--name-status',
      '--diff-filter=ACMRT',
      '-M',
      commit,
    ]));
  }
  return parseChangedEntries(runGit([
    'diff',
    '--name-status',
    '-z',
    '--diff-filter=ACMRT',
    '-M',
    parent,
    commit,
    '--',
  ]));
}

function readCommitBlob(commit, path) {
  const output = runGit(['ls-tree', '-z', commit, '--', path]);
  const records = output.split('\0').filter(Boolean);
  if (records.length !== 1) {
    throw new SafeScannerError('A reviewed path could not be resolved exactly.');
  }
  const tabIndex = records[0].indexOf('\t');
  if (tabIndex === -1 || records[0].slice(tabIndex + 1) !== path) {
    throw new SafeScannerError('A reviewed path did not resolve literally.');
  }
  const [mode, type, oid, ...extra] = records[0].slice(0, tabIndex).split(' ');
  if (!/^[0-7]{6}$/.test(mode) || extra.length > 0 || !OID_PATTERN.test(oid)) {
    throw new SafeScannerError('A reviewed blob had malformed Git metadata.');
  }
  if (type !== 'blob') {
    return null;
  }
  return runGit(['cat-file', 'blob', oid], null);
}

function allLineRanges(buffer) {
  if (buffer.length === 0) {
    return [];
  }
  let lines = 1;
  for (const byte of buffer) {
    if (byte === 10) {
      lines += 1;
    }
  }
  return [{ start: 1, end: lines }];
}

function addedLineRanges(parent, commit, entry) {
  const paths = entry.oldPath && entry.oldPath !== entry.path
    ? [entry.oldPath, entry.path]
    : [entry.path];
  const patch = runGit([
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--text',
    '--unified=0',
    '-M',
    parent,
    commit,
    '--',
    ...paths,
  ]);
  const ranges = [];
  for (const line of patch.split(/\r?\n/)) {
    const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!match) {
      continue;
    }
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    if (
      !Number.isSafeInteger(start)
      || !Number.isSafeInteger(count)
      || start < 0
      || count < 0
    ) {
      throw new SafeScannerError('Git returned malformed added-line metadata.');
    }
    if (count > 0) {
      ranges.push({ start, end: start + count - 1 });
    }
  }
  return ranges;
}

function findingIntersectsRanges(finding, ranges) {
  if (ranges.length === 0) {
    return false;
  }
  if (!finding.line) {
    return true;
  }
  const endLine = finding.endLine ?? finding.line;
  return ranges.some(range =>
    finding.line <= range.end && endLine >= range.start,
  );
}

function scanCommitRange(range, findings) {
  let blobs = 0;
  for (const commit of range.commits) {
    if (!OID_PATTERN.test(commit)) {
      throw new SafeScannerError('Git returned a malformed reviewed commit.');
    }
    // rev-list includes side-branch commits, so a merge is compared only with
    // its first parent. Added/copied files scan in full; modified, renamed, and
    // type-changed files retain only findings whose span intersects a zero-
    // context destination hunk. This reviews introduced text without blaming
    // unchanged pre-base material on the PR.
    const parent = firstParent(commit);
    for (const entry of changedEntriesAtCommit(parent, commit)) {
      const buffer = readCommitBlob(commit, entry.path);
      if (!buffer) {
        continue;
      }
      blobs += 1;
      if (isRuntimeDotenvPath(entry.path)) {
        addFinding(findings, {
          path: entry.path,
          rule: 'TRACKED_RUNTIME_DOTENV',
          classification: RULES.TRACKED_RUNTIME_DOTENV,
          source: 'commit-range',
        });
      }

      const ranges = !parent || entry.status === 'A' || entry.status === 'C'
        ? allLineRanges(buffer)
        : addedLineRanges(parent, commit, entry);
      if (ranges.length === 0) {
        continue;
      }
      scanBuffer(entry.path, buffer, 'commit-range', {
        items: findings.items,
        keys: findings.keys,
        accept: finding => findingIntersectsRanges(finding, ranges),
      });
    }
  }
  return { commits: range.commits.length, blobs };
}

function scanRuntimeCredentialLiterals(paths, findings) {
  const names = [
    'SUPER_ADMIN_TEST_PHONE',
    'SUPER_ADMIN_TEST_PASSWORD',
    'E2E_SUPER_ADMIN_PHONE',
    'E2E_SUPER_ADMIN_PASSWORD',
  ];
  const values = [...new Set(
    names.map(name => process.env[name]).filter(value => value && value.length >= 6),
  )];
  if (values.length === 0) {
    return;
  }

  for (const path of paths) {
    const buffer = readWorkingTreeFile(path);
    if (!buffer) {
      continue;
    }
    for (const value of values) {
      const position = buffer.indexOf(Buffer.from(value));
      if (position !== -1) {
        const line = isBinary(buffer)
          ? undefined
          : lineNumberAt(buffer.toString('utf8'), position);
        addFinding(findings, {
          path,
          line,
          rule: 'RUNTIME_CREDENTIAL_LITERAL',
          classification: RULES.RUNTIME_CREDENTIAL_LITERAL,
          source: normalizePath(path).startsWith('.next/static/')
            ? 'generated-client'
            : 'tracked-tree',
        });
      }
    }
  }
}

function parseArguments(argv) {
  const options = {
    base: null,
    head: null,
    noRange: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--base' || argument === '--head') {
      const value = argv[index + 1];
      if (!value) {
        throw new SafeScannerError('A revision option was missing its value.');
      }
      options[argument === '--base' ? 'base' : 'head'] = value;
      index += 1;
    } else if (argument === '--no-range' || argument === '--tree') {
      options.noRange = true;
    } else {
      throw new SafeScannerError('An unsupported scanner option was provided.');
    }
  }
  if ((options.base && !options.head) || (!options.base && options.head)) {
    throw new SafeScannerError('Both base and head object IDs are required together.');
  }
  if (options.noRange && (options.base || options.head)) {
    throw new SafeScannerError('Tree-only and explicit range options cannot be combined.');
  }
  return options;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const findings = { items: [], keys: new Set() };
  const current = scanCurrentTree(findings);
  const trackedPaths = runGit(['ls-files', '-z']).split('\0').filter(Boolean);
  const generatedPaths = [];
  collectDirectoryFiles('.next/static', generatedPaths);
  scanRuntimeCredentialLiterals([...trackedPaths, ...generatedPaths], findings);

  let rangeStats = { commits: 0, blobs: 0 };
  if (!options.noRange) {
    // CI supplies immutable base/head OIDs. PRs scan merge-base..head; pushes
    // scan before..head. A zero "before" scans the initial reachable commits.
    // Local use scans origin/main's merge-base (or one local parent) without
    // fetching, executing a shell, or accepting a branch name as input.
    const range = options.base
      ? explicitRange(options.base, options.head)
      : localRange();
    rangeStats = scanCommitRange(range, findings);
  }

  if (findings.items.length > 0) {
    console.error(`Secret leak scan failed with ${findings.items.length} sanitized finding(s):`);
    for (const finding of findings.items) {
      const location = finding.line
        ? `${sanitizedPath(finding.path)}:${finding.line}`
        : sanitizedPath(finding.path);
      console.error(
        `  ${location} [${finding.rule}] ${finding.classification} (${finding.source})`,
      );
    }
    console.error(
      'Remove the material from reviewed commits and rotate or revoke any credential that may be active.',
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `Secret leak scan passed (${current.tracked} tracked files, `
    + `${current.generated} generated files, ${rangeStats.commits} reviewed commits).`,
  );
}

const isDirectExecution = process.argv[1]
  && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    const message = error instanceof SafeScannerError
      ? error.message
      : 'The scanner failed closed without exposing command output.';
    console.error(`Secret leak scan could not complete safely: ${message}`);
    process.exitCode = 2;
  }
}
