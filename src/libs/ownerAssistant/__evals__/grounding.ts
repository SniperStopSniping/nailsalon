/**
 * Deterministic grounding checker (A1-4, deliverable A).
 *
 * PURE: no I/O, no `server-only`, no database, no clock. Given one assistant
 * answer and the union of the tool results that conversation produced, it
 * extracts every checkable fact from the answer — money amounts, integer
 * counts, durations, weekdays/dates, clock times and entity names — and
 * reports the ones that cannot be found in the tool results.
 *
 * This is the mechanism a real-model run is SCORED with, so its bias is fixed
 * by contract: it may never silently pass a number that is absent. When it is
 * unsure it reports, and a human reads the report. The opposite bias (quietly
 * accepting an unfamiliar number) would make the gate "0 invented facts"
 * meaningless.
 *
 * How support is decided (normalisation is the interesting part):
 *   - every number anywhere in the serialised tool results is support, whether
 *     it was a JSON number or a number inside a string (`"10:00–18:00"`,
 *     `"$45"`);
 *   - money is matched in BOTH directions of the cents boundary, so `$45.00`
 *     is supported by `4500` (priceCents) and by `45`;
 *   - durations are matched in minutes, and an answer that says hours is
 *     converted first (`"2 hours"` ⇒ 120);
 *   - a date key supports the weekday, day-of-month, month name and year that
 *     can be derived from it, so `2026-09-18` supports "Friday 18 September";
 *   - clock times are normalised to 24h `H:MM`, and a bare `2:30` is accepted
 *     from either `2:30` or `14:30` in a tool result;
 *   - counts are additionally supported by ARRAY LENGTHS and by the size of
 *     any boolean-filtered subset of an array of objects, because "you have 3
 *     services" and "2 of them are bookable" are facts the tool result
 *     contains without containing the numeral.
 *
 * False positives are guarded deliberately: numbers and names the owner
 * supplied in their own question are never "invented" (pass `ownerMessages`),
 * ordinals are not counts, the year and day inside a date phrase are consumed
 * by the date and not re-reported as counts, and a sentence-initial single
 * capitalised word is dropped ONLY when it is in an explicit closed lexicon of
 * function/determiner/adverb words (`SENTENCE_INITIAL_NON_ENTITY_WORDS`).
 *
 * ===========================================================================
 * KNOWN BLIND SPOTS — read before quoting a run's "invented facts: 0"
 * ===========================================================================
 * These are limitations of the instrument, not of any particular run. Each is
 * pinned by a test in `grounding.test.ts` so it cannot close unnoticed, and
 * each is repeated in `docs/OWNER_ASSISTANT_EVALS.md` §2 and next to the
 * threshold table in §6.
 *
 *  1. ATTRIBUTION IS NOT CHECKED (A5). Support is VALUE-SET MEMBERSHIP: a fact
 *     is supported when its value occurs somewhere in the tool results, not
 *     when it occurs against the thing the answer attached it to. "Gel Manicure
 *     is $75." passes while 7500 is Gel-X's price and 4500 is Gel Manicure's.
 *     The gate therefore counts values that appear NOWHERE, not values attached
 *     to the WRONG THING. Price and duration attribution must be spot-checked
 *     BY HAND in the first real-model report.
 *  2. KINDS DO NOT SEPARATE (A2, partial). A number of one kind vouches for a
 *     claim of another: `"It costs $60."` is accepted from a `durationMinutes:
 *     60`, because money, counts and durations share one pool of numbers.
 *     Separating them needs typed numeric buckets and was deliberately NOT
 *     attempted here. The dangerous half of this WAS fixed: a day-of-month no
 *     longer falls back to "is this number anywhere" — see `isSupported`.
 *  3. LOWER-CASE NAMES ARE NOT EXTRACTED (A4). Entity extraction sees quoted
 *     strings and capitalised runs only, so `"Your paraffin dip is active."`
 *     is checked for no entity at all and passes against a menu that has no
 *     such add-on. Accepted for now: fixing it needs a real menu-vocabulary
 *     matcher rather than an orthographic rule.
 *
 * All three are FALSE-NEGATIVE shaped, which is the direction that matters:
 * the report may under-count invented facts. It cannot be read as proof that
 * the model invented nothing — only that these particular checks found nothing.
 */

export type GroundingFactKind
  = | 'money'
  | 'count'
  | 'duration'
  | 'time'
  | 'date'
  | 'entity';

export type GroundingFact = {
  kind: GroundingFactKind;
  /** The text exactly as it appeared in the answer. */
  value: string;
};

export type GroundingVerdict = {
  ok: boolean;
  unsupported: GroundingFact[];
};

export type GroundingInput = {
  /** The assistant's plain-text message for one turn. */
  answer: string;
  /** Every tool result of the conversation so far, newest last. Order is irrelevant. */
  toolResults: readonly unknown[];
  /**
   * The owner's own turns. A number or a name the owner typed is theirs, not
   * the model's invention, so it is never reported.
   */
  ownerMessages?: readonly string[];
};

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const WEEKDAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

const WEEKDAY_ABBREVIATIONS: Record<string, string> = {
  sun: 'sunday',
  mon: 'monday',
  tue: 'tuesday',
  tues: 'tuesday',
  wed: 'wednesday',
  weds: 'wednesday',
  thu: 'thursday',
  thur: 'thursday',
  thurs: 'thursday',
  fri: 'friday',
  sat: 'saturday',
};

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
] as const;

const MONTH_ABBREVIATIONS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/**
 * Words that are never a business entity on their own. Conversational filler,
 * the product's own name, and the connectives a capitalised run may contain.
 */
const ENTITY_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'of',
  'or',
  'but',
  'so',
  'if',
  'it',
  'its',
  'i',
  'me',
  'my',
  'mine',
  'we',
  'our',
  'you',
  'your',
  'yours',
  'they',
  'them',
  'their',
  'this',
  'that',
  'these',
  'those',
  'here',
  'there',
  'now',
  'yes',
  'no',
  'not',
  'same',
  'right',
  'left',
  'when',
  'what',
  'where',
  'which',
  'who',
  'why',
  'how',
  'please',
  'thanks',
  'thank',
  'sorry',
  'luster',
  'assistant',
  'ai',
  'ok',
  'okay',
  'sure',
  'to',
  'in',
  'on',
  'at',
  'for',
  'with',
  'from',
  'by',
  'is',
  'are',
  'was',
  'were',
  'can',
  'cannot',
  'could',
  'would',
  'should',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'today',
  'tomorrow',
  'yesterday',
]);

/**
 * The ONLY single capitalised words that a sentence may open with and still not
 * be reported as a possible name (A1).
 *
 * This is a CLOSED LEXICON on purpose. The rule it replaces dropped EVERY
 * sentence-initial capitalised singleton, which made `"Sarah is your only
 * technician."` pass against tool results whose only name is `Dani` — a false
 * negative, and the dangerous direction. The lexicon is therefore allowed to
 * grow one word at a time when a legitimate opener is found missing; it must
 * never be replaced by a broader rule.
 *
 * `ENTITY_STOPWORDS` and the weekday/month vocabulary are folded in below, so
 * this set only has to carry what they do not already handle.
 */
const SENTENCE_INITIAL_NON_ENTITY_WORDS = new Set([
  // Determiners, quantifiers and pronouns.
  'nothing',
  'both',
  'everything',
  'every',
  'all',
  'none',
  'neither',
  'either',
  'some',
  'any',
  'each',
  'most',
  'many',
  'few',
  'several',
  // Adverbs and discourse markers.
  'once',
  'only',
  'also',
  'however',
  'otherwise',
  'currently',
  'unfortunately',
  'since',
  'because',
  'while',
  'after',
  'before',
  'unless',
  'although',
  'based',
  'just',
  'still',
  'then',
  // Openers this product's own answers use: navigation imperatives and the
  // handful of adjectives an assistant reply legitimately starts with. Each
  // one costs only the ability to report a single-word invented name spelled
  // exactly like it, which no salon vocabulary contains.
  'go',
  'head',
  'open',
  'tap',
  'click',
  'choose',
  'select',
  'pick',
  'add',
  'set',
  'try',
  'use',
  'check',
  'start',
  'make',
  'let',
  'happy',
  'good',
  'great',
  'looks',
]);

/** True when a sentence may open with this single capitalised word harmlessly. */
function isSentenceInitialNonEntityWord(token: string): boolean {
  const normalized = normalizeText(token);
  return normalized.length === 0
    || SENTENCE_INITIAL_NON_ENTITY_WORDS.has(normalized)
    || ENTITY_STOPWORDS.has(normalized)
    || isDateWord(normalized);
}

// ---------------------------------------------------------------------------
// Normalisation helpers
// ---------------------------------------------------------------------------

/** Lowercase, NFKC, punctuation to spaces, whitespace collapsed. */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `googleCalendar` → `google calendar`; `page_gallery` → `page gallery`. */
function deCamelCase(key: string): string {
  return key
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ');
}

/** `2:30` + `pm` → `14:30`; hour is never zero-padded so lookups are stable. */
function normalizeClock(hour: number, minute: number): string {
  return `${hour}:${String(minute).padStart(2, '0')}`;
}

const DATE_KEY_PATTERN = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const CLOCK_IN_STRING_PATTERN = /\b(\d{1,2}):(\d{2})\b/g;
const NUMBER_IN_STRING_PATTERN = /\d+(?:\.\d+)?/g;

function weekdayOfDateKey(year: number, month: number, day: number): string {
  // Built on a UTC instant from the key itself: the weekday of a date key is a
  // calendar fact and must not depend on the runner's local offset.
  const index = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return WEEKDAY_NAMES[index] ?? '';
}

const WEEKDAY_ALTERNATION = [
  ...WEEKDAY_NAMES,
  ...Object.keys(WEEKDAY_ABBREVIATIONS),
].sort((a, b) => b.length - a.length).join('|');

const MONTH_ALTERNATION = [
  ...MONTH_NAMES,
  ...Object.keys(MONTH_ABBREVIATIONS),
].sort((a, b) => b.length - a.length).join('|');

/**
 * "Friday 18 September 2026", "18 September", "September 18, 2026".
 *
 * One definition, used for BOTH directions: to extract a claim from an answer
 * and to index a date a tool result (or the owner) wrote in prose. Always used
 * through `matchAll`, which clones it, so its `lastIndex` is never shared.
 */
const DATE_PHRASE_PATTERN = new RegExp(
  String.raw`\b(?:(${WEEKDAY_ALTERNATION})\b[,\s]+)?`
  + String.raw`(?:(\d{1,2})(?:st|nd|rd|th)?\s+(${MONTH_ALTERNATION})`
  + String.raw`|(${MONTH_ALTERNATION})\s+(\d{1,2})(?:st|nd|rd|th)?)`
  + String.raw`(?:,?\s*(\d{4}))?\b`,
  'gi',
);

function parseDatePhrase(match: RegExpMatchArray): {
  weekday?: string;
  day?: number;
  month?: number;
  year?: number;
} {
  const monthWord = (match[3] ?? match[4] ?? '').toLowerCase();
  const dayText = match[2] ?? match[5];
  return {
    weekday: match[1] ? resolveWeekdayWord(match[1]) : undefined,
    day: dayText === undefined ? undefined : Number(dayText),
    month: resolveMonthWord(monthWord),
    year: match[6] === undefined ? undefined : Number(match[6]),
  };
}

// ---------------------------------------------------------------------------
// Support index — what the tool results actually said
// ---------------------------------------------------------------------------

/**
 * One calendar date the tool results actually carry, kept WHOLE.
 *
 * The components are also indexed separately (`weekdays`, `monthNumbers`, …) for
 * the phrases that name only one of them, but a phrase that names a day of the
 * month is checked against these records so its weekday, day and month have to
 * belong to the SAME date — see `isSupported`.
 */
type SupportDate = {
  year?: number;
  month: number;
  day: number;
  weekday?: string;
};

type SupportIndex = {
  numbers: number[];
  weekdays: Set<string>;
  monthNumbers: Set<number>;
  years: Set<number>;
  dateKeys: Set<string>;
  dates: SupportDate[];
  times: Set<string>;
  /**
   * Normalised haystack of every string value plus every de-camelCased key,
   * joined by ` | `. The separator is deliberate: a match is boundary-aware and
   * cannot cross it, so a name can never be assembled out of two unrelated
   * fields (`category: 'removal'` next to the key `pricingType` must not vouch
   * for "Removal Pricing").
   */
  text: string;
};

function createEmptyIndex(): SupportIndex {
  return {
    numbers: [],
    weekdays: new Set(),
    monthNumbers: new Set(),
    years: new Set(),
    dateKeys: new Set(),
    dates: [],
    times: new Set(),
    text: '',
  };
}

function absorbString(index: SupportIndex, value: string, fragments: string[]): void {
  fragments.push(normalizeText(value));

  for (const match of value.matchAll(DATE_KEY_PATTERN)) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const weekday = weekdayOfDateKey(year, month, day);
    index.dateKeys.add(`${match[1]}-${match[2]}-${match[3]}`);
    index.years.add(year);
    index.monthNumbers.add(month);
    index.weekdays.add(weekday);
    index.dates.push({ year, month, day, weekday });
  }

  // Dates a tool result (or the owner) spelled out in prose rather than as a
  // key. Without this, an owner who types "Friday 18 September" would have
  // their own words reported back as an invention.
  for (const match of value.matchAll(DATE_PHRASE_PATTERN)) {
    const parsed = parseDatePhrase(match);
    if (parsed.month === undefined || parsed.day === undefined) {
      continue;
    }
    index.monthNumbers.add(parsed.month);
    if (parsed.year !== undefined) {
      index.years.add(parsed.year);
    }
    const weekday = parsed.year === undefined
      ? parsed.weekday
      : weekdayOfDateKey(parsed.year, parsed.month, parsed.day);
    if (weekday !== undefined && weekday.length > 0) {
      index.weekdays.add(weekday);
    }
    index.dates.push({ year: parsed.year, month: parsed.month, day: parsed.day, weekday });
  }

  for (const match of value.matchAll(CLOCK_IN_STRING_PATTERN)) {
    index.times.add(normalizeClock(Number(match[1]), Number(match[2])));
  }

  for (const match of value.matchAll(NUMBER_IN_STRING_PATTERN)) {
    index.numbers.push(Number(match[0]));
  }

  const normalized = normalizeText(value);
  if (WEEKDAY_NAMES.includes(normalized as (typeof WEEKDAY_NAMES)[number])) {
    index.weekdays.add(normalized);
  }
  const monthIndex = MONTH_NAMES.indexOf(normalized as (typeof MONTH_NAMES)[number]);
  if (monthIndex >= 0) {
    index.monthNumbers.add(monthIndex + 1);
  }
}

/**
 * Counts an answer may legitimately state that the JSON does not spell out:
 * the length of a list, and the size of any subset that one boolean field
 * selects ("2 of your 3 services are bookable").
 */
function absorbArrayCounts(index: SupportIndex, items: readonly unknown[]): void {
  index.numbers.push(items.length);

  const trueCounts = new Map<string, number>();
  const falseCounts = new Map<string, number>();

  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }
    for (const [key, nested] of Object.entries(item)) {
      if (typeof nested !== 'boolean') {
        continue;
      }
      const bucket = nested ? trueCounts : falseCounts;
      bucket.set(key, (bucket.get(key) ?? 0) + 1);
    }
  }

  for (const bucket of [trueCounts, falseCounts]) {
    for (const count of bucket.values()) {
      index.numbers.push(count);
    }
  }
}

function absorb(index: SupportIndex, value: unknown, fragments: string[]): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      index.numbers.push(value);
    }
    return;
  }
  if (typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'string') {
    absorbString(index, value, fragments);
    return;
  }
  if (Array.isArray(value)) {
    absorbArrayCounts(index, value);
    for (const item of value) {
      absorb(index, item, fragments);
    }
    return;
  }
  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      // Keys carry real meaning here (`byDay.tuesday`, `googleCalendar`), so
      // they support WORDS. They deliberately never support numbers: a numeric
      // key must not be able to vouch for a numeric claim.
      const readableKey = deCamelCase(key);
      fragments.push(normalizeText(readableKey));
      const normalizedKey = normalizeText(key);
      if (WEEKDAY_NAMES.includes(normalizedKey as (typeof WEEKDAY_NAMES)[number])) {
        index.weekdays.add(normalizedKey);
      }
      absorb(index, nested, fragments);
    }
  }
}

export function buildSupportIndex(toolResults: readonly unknown[]): SupportIndex {
  const index = createEmptyIndex();
  const fragments: string[] = [];

  for (const result of toolResults) {
    absorb(index, result, fragments);
  }

  // ` | ` and not ' ': the separator must be a character a normalised phrase
  // can never contain, so an entity match cannot span two unrelated fields.
  index.text = ` ${fragments.filter(fragment => fragment.length > 0).join(' | ')} `;

  return index;
}

function hasNumber(index: SupportIndex, value: number): boolean {
  return index.numbers.some(candidate => Math.abs(candidate - value) < 1e-9);
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

type ExtractedFact = GroundingFact & {
  /** Everything a support check needs, already parsed. */
  probe:
    | { type: 'money'; amount: number }
    | { type: 'count'; amount: number }
    | { type: 'duration'; minutes: number; raw: number }
    | { type: 'time'; candidates: string[] }
    | {
      type: 'date';
      dateKey?: string;
      weekday?: string;
      day?: number;
      month?: number;
      year?: number;
    }
    | { type: 'entity'; normalized: string };
};

/**
 * The ordered scanner. Each pattern claims the characters it matched so a
 * later, broader pattern cannot re-read them — that is what stops `$45.00`
 * from also being reported as the counts 45 and 0, and what stops the year in
 * "Friday 18 September 2026" from becoming a count of 2026.
 */
const SCANNERS: Array<{
  kind: GroundingFactKind | 'ignored';
  pattern: RegExp;
  build: (match: RegExpExecArray) => ExtractedFact['probe'] | null;
}> = [
  {
    kind: 'date',
    pattern: /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    build: match => ({
      type: 'date',
      dateKey: `${match[1]}-${match[2]}-${match[3]}`,
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
    }),
  },
  {
    kind: 'money',
    pattern: /[$€£]\s?(\d[\d,]*(?:\.\d{1,2})?)/g,
    build: match => ({ type: 'money', amount: Number((match[1] ?? '').replace(/,/g, '')) }),
  },
  {
    kind: 'money',
    pattern: /\b(\d[\d,]*(?:\.\d{1,2})?)\s?(?:CAD|USD|EUR|dollars?)\b/gi,
    build: match => ({ type: 'money', amount: Number((match[1] ?? '').replace(/,/g, '')) }),
  },
  {
    // "Friday 18 September 2026", "18 September", "September 18, 2026"
    kind: 'date',
    pattern: new RegExp(DATE_PHRASE_PATTERN.source, DATE_PHRASE_PATTERN.flags),
    build: match => ({ type: 'date', ...parseDatePhrase(match) }),
  },
  {
    kind: 'date',
    pattern: new RegExp(String.raw`\b(${WEEKDAY_ALTERNATION})\b`, 'gi'),
    build: match => ({ type: 'date', weekday: resolveWeekdayWord(match[1] ?? '') }),
  },
  {
    kind: 'time',
    pattern: /\b(\d{1,2}):(\d{2})\s?(am|pm)?\b/gi,
    build: (match) => {
      const hour = Number(match[1]);
      const minute = Number(match[2]);
      const meridiem = match[3]?.toLowerCase();
      if (meridiem === 'am') {
        return { type: 'time', candidates: [normalizeClock(hour % 12, minute)] };
      }
      if (meridiem === 'pm') {
        return { type: 'time', candidates: [normalizeClock((hour % 12) + 12, minute)] };
      }
      // No meridiem: the owner's tool results may hold either reading.
      return {
        type: 'time',
        candidates: [
          normalizeClock(hour, minute),
          normalizeClock(hour < 12 ? hour + 12 : hour, minute),
        ],
      };
    },
  },
  {
    kind: 'duration',
    // `[\s-]*` rather than `\s*-?\s*`: one character class cannot exchange
    // characters with itself, so "60      minutes" has no backtracking cliff.
    pattern: /\b(\d+(?:\.\d+)?)[\s-]*(minutes?|mins?|hours?|hrs?)\b/gi,
    build: (match) => {
      const raw = Number(match[1]);
      const unit = (match[2] ?? '').toLowerCase();
      const isHours = unit.startsWith('h');
      return { type: 'duration', minutes: isHours ? raw * 60 : raw, raw };
    },
  },
  {
    kind: 'duration',
    pattern: /\b(\d+(?:\.\d+)?)(m|h)\b/g,
    build: (match) => {
      const raw = Number(match[1]);
      const isHours = match[2] === 'h';
      return { type: 'duration', minutes: isHours ? raw * 60 : raw, raw };
    },
  },
  {
    // Numeric ordinals are positional, not quantities. Claimed so the count
    // scanner below cannot re-read them, then dropped.
    kind: 'ignored',
    pattern: /\b\d+(?:st|nd|rd|th)\b/gi,
    build: () => null,
  },
  {
    kind: 'count',
    pattern: /\b(\d[\d,]*(?:\.\d+)?)\b/g,
    build: match => ({ type: 'count', amount: Number((match[1] ?? '').replace(/,/g, '')) }),
  },
];

function resolveWeekdayWord(word: string): string {
  const lower = word.toLowerCase();
  return WEEKDAY_ABBREVIATIONS[lower] ?? lower;
}

function resolveMonthWord(word: string): number | undefined {
  const lower = word.toLowerCase();
  const full = MONTH_NAMES.indexOf(lower as (typeof MONTH_NAMES)[number]);
  if (full >= 0) {
    return full + 1;
  }
  return MONTH_ABBREVIATIONS[lower];
}

function extractScalarFacts(answer: string): ExtractedFact[] {
  const claimed = Array.from<boolean>({ length: answer.length }).fill(false);
  const facts: ExtractedFact[] = [];

  for (const scanner of SCANNERS) {
    scanner.pattern.lastIndex = 0;
    let match = scanner.pattern.exec(answer);
    while (match !== null) {
      const start = match.index;
      const end = start + match[0].length;
      let overlaps = false;
      for (let position = start; position < end; position++) {
        if (claimed[position]) {
          overlaps = true;
          break;
        }
      }

      if (!overlaps) {
        const probe = scanner.build(match);
        for (let position = start; position < end; position++) {
          claimed[position] = true;
        }
        if (probe && scanner.kind !== 'ignored') {
          facts.push({ kind: scanner.kind, value: match[0].trim(), probe });
        }
      }

      // Zero-length matches cannot happen with these patterns, but a stuck
      // lastIndex would hang the scan, so advance defensively.
      if (scanner.pattern.lastIndex === match.index) {
        scanner.pattern.lastIndex += 1;
      }
      match = scanner.pattern.exec(answer);
    }
  }

  return facts;
}

const QUOTED_PATTERN = /[“"]([^“”"]{2,120})[”"]/g;

function isCapitalisedToken(token: string): boolean {
  const stripped = token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  return stripped.length > 0 && /^\p{Lu}/u.test(stripped);
}

function isDateWord(token: string): boolean {
  const normalized = normalizeText(token);
  return WEEKDAY_NAMES.includes(normalized as (typeof WEEKDAY_NAMES)[number])
    || Object.hasOwn(WEEKDAY_ABBREVIATIONS, normalized)
    || MONTH_NAMES.includes(normalized as (typeof MONTH_NAMES)[number])
    || Object.hasOwn(MONTH_ABBREVIATIONS, normalized);
}

/**
 * Entity names: anything in double quotes, plus runs of capitalised words.
 *
 * A single capitalised word at the START of a sentence is ordinary English only
 * when it is in `SENTENCE_INITIAL_NON_ENTITY_WORDS` (or already a stopword or a
 * date word); every other sentence-initial singleton is reported, because
 * "Sarah is your only technician." is exactly the invention this instrument
 * exists to catch. Anywhere but the first position, a singleton is an entity.
 * A run of two or more capitalised words is an entity wherever it appears —
 * "Gel Manicure is $45." opens a sentence and is still a name.
 */
function extractEntityFacts(answer: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const seen = new Set<string>();

  const push = (raw: string) => {
    const value = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    const normalized = normalizeText(value);
    if (normalized.length < 2 || seen.has(normalized)) {
      return;
    }
    const words = normalized.split(' ');
    if (words.every(word => ENTITY_STOPWORDS.has(word) || isDateWord(word) || /^\d+$/.test(word))) {
      return;
    }
    seen.add(normalized);
    facts.push({ kind: 'entity', value, probe: { type: 'entity', normalized } });
  };

  QUOTED_PATTERN.lastIndex = 0;
  let quoted = QUOTED_PATTERN.exec(answer);
  while (quoted !== null) {
    push(quoted[1] ?? '');
    quoted = QUOTED_PATTERN.exec(answer);
  }

  for (const sentence of answer.split(/(?<=[.!?])\s+|\n+/)) {
    const tokens = sentence.split(/\s+/).filter(token => token.length > 0);
    let run: string[] = [];
    let runStartsSentence = false;

    const flush = () => {
      if (run.length === 0) {
        return;
      }
      // Drop stopwords at either end, so "Your Gel Removal add-on" is the name
      // "Gel Removal" and "I" is nothing at all.
      while (run.length > 0 && ENTITY_STOPWORDS.has(normalizeText(run[run.length - 1] ?? ''))) {
        run.pop();
      }
      while (run.length > 0 && ENTITY_STOPWORDS.has(normalizeText(run[0] ?? ''))) {
        run.shift();
      }
      const capitalised = run.filter(token => isCapitalisedToken(token));
      // A sentence-initial singleton is dropped only when the closed lexicon
      // says so; an unknown one is reported rather than assumed to be English.
      const isDroppableOpener = capitalised.length === 1
        && runStartsSentence
        && run.length === 1
        && isSentenceInitialNonEntityWord(run[0] ?? '');
      if (capitalised.length >= 2 || (capitalised.length === 1 && !isDroppableOpener)) {
        push(run.join(' '));
      }
      run = [];
    };

    for (const [position, token] of tokens.entries()) {
      const isConnector = ENTITY_STOPWORDS.has(normalizeText(token)) && !isCapitalisedToken(token);
      if (isCapitalisedToken(token) || (isConnector && run.length > 0)) {
        if (run.length === 0) {
          runStartsSentence = position === 0;
        }
        run.push(token);
      } else {
        flush();
      }
      // A sentence-ending token closes the run either way.
      if (/[.!?;:]$/.test(token)) {
        flush();
      }
    }
    flush();
  }

  return facts;
}

// ---------------------------------------------------------------------------
// Support decisions
// ---------------------------------------------------------------------------

type DateProbe = Extract<ExtractedFact['probe'], { type: 'date' }>;

/**
 * Does ONE real date carry every component the phrase named?
 *
 * A component the phrase states but the record does not know (a prose date with
 * no year, asked for a year) is a MISS, not a pass: this check is only ever
 * used to grant support, so an unknown must never grant it.
 */
function dateRecordMatches(record: SupportDate, probe: DateProbe): boolean {
  if (probe.day !== undefined && record.day !== probe.day) {
    return false;
  }
  if (probe.month !== undefined && record.month !== probe.month) {
    return false;
  }
  if (probe.year !== undefined && record.year !== probe.year) {
    return false;
  }
  if (probe.weekday !== undefined && record.weekday !== probe.weekday) {
    return false;
  }
  return true;
}

/**
 * Boundary-aware phrase lookup. The haystack is space-wrapped and ` | `-joined,
 * so ` gel man ` cannot be found inside `gel manicure`, and `removal pricing`
 * cannot be assembled across two fields.
 */
function hasPhrase(index: SupportIndex, phrase: string): boolean {
  return index.text.includes(` ${phrase} `);
}

function isSupported(fact: ExtractedFact, tools: SupportIndex, owner: SupportIndex): boolean {
  const probe = fact.probe;

  switch (probe.type) {
    case 'money':
      // Both directions of the cents boundary: $45.00 ⇔ 4500 ⇔ 45.
      return hasNumber(tools, probe.amount)
        || hasNumber(tools, probe.amount * 100)
        || hasNumber(owner, probe.amount);
    case 'count':
      return hasNumber(tools, probe.amount) || hasNumber(owner, probe.amount);
    case 'duration':
      return hasNumber(tools, probe.minutes)
        || hasNumber(tools, probe.raw)
        || hasNumber(owner, probe.minutes)
        || hasNumber(owner, probe.raw);
    case 'time':
      return probe.candidates.some(candidate => tools.times.has(candidate) || owner.times.has(candidate));
    case 'date': {
      if (probe.dateKey !== undefined) {
        return tools.dateKeys.has(probe.dateKey) || owner.dateKeys.has(probe.dateKey);
      }
      if (probe.day !== undefined) {
        // A CALENDAR claim, not an arithmetic one. The day of the month must
        // belong to a date that is actually present, together with whatever
        // weekday, month and year the phrase named — never to "is this number
        // anywhere in the results", which let `slotIntervalMinutes: 15` vouch
        // for a "Friday 15 September" that was neither a Friday nor a date the
        // tools returned.
        return tools.dates.some(record => dateRecordMatches(record, probe))
          || owner.dates.some(record => dateRecordMatches(record, probe));
      }
      // A phrase naming only a weekday (or only a month, or only a year) has
      // no date to be checked against, so each component stands alone.
      const checks: boolean[] = [];
      if (probe.weekday !== undefined) {
        checks.push(tools.weekdays.has(probe.weekday) || owner.weekdays.has(probe.weekday));
      }
      if (probe.month !== undefined) {
        checks.push(tools.monthNumbers.has(probe.month) || owner.monthNumbers.has(probe.month));
      }
      if (probe.year !== undefined) {
        checks.push(tools.years.has(probe.year) || owner.years.has(probe.year));
      }
      // An empty phrase cannot happen (the patterns always capture something),
      // but an unsupported phrase is one with at least one failing component.
      return checks.length > 0 && checks.every(Boolean);
    }
    case 'entity':
      // Boundary-aware ONLY. The unbounded `includes(normalized)` this used to
      // fall back to subsumed the boundary check entirely and accepted every
      // substring of a real name ("Gel Man", "El Manicur").
      return hasPhrase(tools, probe.normalized) || hasPhrase(owner, probe.normalized);
    default:
      return false;
  }
}

/**
 * The checker. `ok` is true only when every extracted fact is supported.
 */
export function checkGrounding(input: GroundingInput): GroundingVerdict {
  const tools = buildSupportIndex(input.toolResults);
  const owner = buildSupportIndex(input.ownerMessages ?? []);

  const facts = [
    ...extractScalarFacts(input.answer),
    ...extractEntityFacts(input.answer),
  ];

  const unsupported: GroundingFact[] = [];
  const seen = new Set<string>();

  for (const fact of facts) {
    if (isSupported(fact, tools, owner)) {
      continue;
    }
    const dedupeKey = `${fact.kind}:${fact.value.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    unsupported.push({ kind: fact.kind, value: fact.value });
  }

  return { ok: unsupported.length === 0, unsupported };
}

/** One-line rendering for the markdown report. */
export function formatGroundingVerdict(verdict: GroundingVerdict): string {
  if (verdict.ok) {
    return 'grounded';
  }
  return verdict.unsupported.map(fact => `${fact.kind}:${fact.value}`).join(', ');
}
