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
 *   - every number anywhere in the serialised tool results is support for a
 *     COUNT, whether it was a JSON number or a number inside a string
 *     (`"10:00–18:00"`, `"$45"`);
 *   - money and durations have their own pools, filled by the key the number
 *     arrived under (`priceCents` ⇒ money, `durationMinutes` ⇒ duration) or by
 *     an explicit unit in the text, which wins over the key;
 *   - money is matched in BOTH directions of the cents boundary, so `$45.00`
 *     is supported by `4500` (priceCents) and by `45`;
 *   - a money or duration claim in a sentence that names exactly one known
 *     entity must match THAT entity's own value, not merely some value;
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
 * WHAT THIS INSTRUMENT REACHES — read before quoting a run's "invented facts: 0"
 * ===========================================================================
 * These are properties of the instrument, not of any particular run. Each is
 * pinned by a test in `grounding.test.ts` so it cannot change unnoticed, and
 * each is repeated in `docs/OWNER_ASSISTANT_EVALS.md` §2 and next to the
 * threshold table in §6.
 *
 * The three that used to head this list — attribution (A5), numeric kinds (A2)
 * and lower-case names (A4) — are CLOSED. What closed them, and what each
 * closure still does not reach:
 *
 *  1. ATTRIBUTION (A5) is checked when the sentence names exactly ONE known
 *     entity: the value must belong to THAT entity, so "Gel Manicure is $75."
 *     is reported even though 7500 is a real price in the same result. A
 *     sentence naming two services falls back to value-set membership, because
 *     nothing at sentence level can say which number belongs to which. An
 *     entity with no recorded value of that kind is never convicted: silence in
 *     the tool result is not evidence against the answer.
 *  2. NUMERIC KINDS (A2) separate. Money is checked against money, durations
 *     against durations, so a `durationMinutes: 60` no longer vouches for
 *     "It costs $60." Counts deliberately keep the union pool: a count's honest
 *     support really is "that number occurs" (an array length, a filtered
 *     subset size), and narrowing it would manufacture failures.
 *  3. LOWER-CASE NAMES (A4) are reached through a closed lexicon of menu head
 *     nouns. "Your paraffin dip is active." is now reported. It reads at most
 *     ONE content word in front of the head noun, so an invention buried deeper
 *     in a longer phrase can still slip through; a real item whose name uses a
 *     head noun absent from the lexicon is not checked at all; and a head noun
 *     that is also ordinary English (`fill`, `tips`, `art`, `polish`, `french`)
 *     is reported only inside a phrase of two or more words.
 *
 * What remains open, and the direction it errs in:
 *
 *  - The lexicons (head nouns, phrase modifiers, sentence openers) are closed
 *    sets. A missing modifier costs a FALSE POSITIVE, which a human reading the
 *    report resolves; a missing head noun costs a false negative.
 *  - Attribution needs the answer and the value to share a sentence. A price
 *    stated one sentence away from the service it belongs to is not attributed.
 *
 * The residue is still mostly FALSE-NEGATIVE shaped, which is the direction
 * that matters: the report may under-count invented facts. It cannot be read as
 * proof that the model invented nothing — only that these checks found nothing.
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
  /**
   * Why this fact failed, when the bare value does not say it. Present only for
   * the checks that can fail on something other than absence: a value that IS in
   * the tool results but belongs to a different entity (`attribution`), and a
   * value that is present only under a different kind (`kind`). A fact that is
   * simply absent carries no note.
   */
  note?: string;
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

/**
 * What a number in a tool result MEANS, decided by the key it arrived under.
 *
 * Without this every number sat in one pool and vouched for every kind of
 * claim, so a `durationMinutes: 60` supported the sentence "It costs $60."
 * Money and duration now have their own pools and are checked against those
 * pools only. Counts deliberately keep the union pool: a count is the one kind
 * whose legitimate support really is "that number occurs" (an array length, a
 * filtered subset size, a price repeated as a quantity), and narrowing it would
 * manufacture false positives without closing a real hole.
 */
type NumericKind = 'money' | 'duration' | 'count';

/** Numeric attributes one named thing in the tool results actually has. */
type EntityAttributes = {
  money: Set<number>;
  duration: Set<number>;
};

type SupportIndex = {
  numbers: number[];
  /** Numbers that arrived under a money key, plus their cents⇔units twin. */
  money: number[];
  /** Numbers that arrived under a duration key, in minutes. */
  durations: number[];
  /**
   * Named thing ⇒ the numbers that belong to IT. Built from any object in the
   * tool results that carries a name alongside its own numeric fields, which is
   * the shape every menu tool returns (`{ name, priceCents, durationMinutes }`).
   * This is what lets the checker reject a real price attached to the wrong
   * service, rather than only a price that appears nowhere at all.
   */
  entityAttributes: Map<string, EntityAttributes>;
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
    money: [],
    durations: [],
    entityAttributes: new Map(),
    weekdays: new Set(),
    monthNumbers: new Set(),
    years: new Set(),
    dateKeys: new Set(),
    dates: [],
    times: new Set(),
    text: '',
  };
}

/**
 * Words that make the key they appear in a MONEY key or a DURATION key.
 *
 * Closed lexicons on purpose, and matched against the de-camelCased key's whole
 * words so `priceCents` and `depositAmountCents` are money while `slotInterval`
 * is not. They are allowed to grow one word at a time when a real field is found
 * missing; they must never be replaced by a substring rule, because a substring
 * rule would make `pricingType` a money key and let a string vouch for a price.
 */
const MONEY_KEY_WORDS = new Set([
  'price',
  'prices',
  'pricing',
  'cost',
  'costs',
  'amount',
  'amounts',
  'fee',
  'fees',
  'deposit',
  'deposits',
  'cents',
  'dollars',
  'currency',
  'subtotal',
  'total',
  'totals',
  'revenue',
  'charge',
  'charges',
  'balance',
]);

const DURATION_KEY_WORDS = new Set([
  'duration',
  'durations',
  'minutes',
  'minute',
  'mins',
  'hours',
  'hour',
  'buffer',
  'buffers',
  'interval',
  'intervals',
  'notice',
  'lead',
  'length',
]);

/** Keys whose string value names the thing the sibling numbers belong to. */
const ENTITY_NAME_KEYS = new Set(['name', 'servicename', 'addonname', 'techniciername', 'techniciantname', 'technicianname', 'label', 'title', 'displayname']);

function classifyKey(key: string): NumericKind | undefined {
  const words = normalizeText(deCamelCase(key)).split(' ');
  if (words.some(word => MONEY_KEY_WORDS.has(word))) {
    return 'money';
  }
  if (words.some(word => DURATION_KEY_WORDS.has(word))) {
    return 'duration';
  }
  return undefined;
}

/**
 * Money is recorded on BOTH sides of the cents boundary, because a tool result
 * says `priceCents: 4500` and an answer says `$45.00`. Recording the twin here,
 * once, keeps `isSupported` from having to guess which side it is looking at.
 *
 * ONLY the divide-by-100 twin. A multiply-by-100 twin would admit a claim a
 * hundred times too large — `priceCents: 4500` would vouch for "$450,000" —
 * and supports nothing real, because the ambiguity is always "is this figure
 * cents or units", never "is it cents times a hundred".
 */
function recordMoney(pool: Set<number> | number[], value: number): void {
  const add = (candidate: number) => {
    if (Array.isArray(pool)) {
      pool.push(candidate);
    } else {
      pool.add(candidate);
    }
  };
  add(value);
  add(value / 100);
}

function routeNumber(index: SupportIndex, value: number, kind: NumericKind | undefined): void {
  index.numbers.push(value);
  if (kind === 'money') {
    recordMoney(index.money, value);
    return;
  }
  if (kind === 'duration') {
    index.durations.push(value);
  }
}

/**
 * A number written inside a string carries its own kind: `"$45"` is money and
 * `"90 min"` is a duration whatever key they arrived under. An explicit unit in
 * the text WINS over the key, because the text is the more specific statement.
 */
const MONEY_IN_STRING_PATTERN = /[$€£]\s?(\d[\d,]*(?:\.\d{1,2})?)/g;
const DURATION_IN_STRING_PATTERN = /\b(\d+(?:\.\d+)?)\s?(minutes?|mins?|hours?|hrs?)\b/gi;

function absorbString(
  index: SupportIndex,
  value: string,
  fragments: string[],
  kind?: NumericKind,
): void {
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

  // An explicit unit in the text is more specific than the key it arrived
  // under, so `priceDisplayText: "45 minutes"` records a duration, not a price.
  const explicitMoney = new Set<number>();
  const explicitDuration = new Set<number>();
  for (const match of value.matchAll(MONEY_IN_STRING_PATTERN)) {
    explicitMoney.add(Number((match[1] ?? '').replace(/,/g, '')));
  }
  for (const match of value.matchAll(DURATION_IN_STRING_PATTERN)) {
    const raw = Number(match[1]);
    const isHours = (match[2] ?? '').toLowerCase().startsWith('h');
    explicitDuration.add(raw);
    explicitDuration.add(isHours ? raw * 60 : raw);
  }

  for (const match of value.matchAll(NUMBER_IN_STRING_PATTERN)) {
    const parsed = Number(match[0]);
    if (explicitMoney.has(parsed)) {
      routeNumber(index, parsed, 'money');
      continue;
    }
    if (explicitDuration.has(parsed)) {
      routeNumber(index, parsed, 'duration');
      continue;
    }
    routeNumber(index, parsed, kind);
  }
  // The CONVERTED figure ("2 hours" ⇒ 120) is duration support only. Routing it
  // through `routeNumber` would also push it into the union count pool, so a
  // tool result mentioning "24 hours" would vouch for "you have 1440 clients".
  for (const minutes of explicitDuration) {
    index.durations.push(minutes);
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
  // Array-derived numbers are counts by construction, never money or minutes.
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

/**
 * Record `{ name, priceCents, durationMinutes }`-shaped objects so a value can
 * be checked against the thing it belongs to and not merely against the salon.
 *
 * Only the object's OWN scalar fields are attributed to its name. A nested
 * object keeps its own identity, so an add-on's price never becomes the parent
 * service's price.
 */
function absorbEntityAttributes(index: SupportIndex, record: Record<string, unknown>): void {
  let name: string | undefined;
  for (const [key, nested] of Object.entries(record)) {
    if (typeof nested === 'string' && ENTITY_NAME_KEYS.has(normalizeText(key).replace(/ /g, ''))) {
      name = normalizeText(nested);
      break;
    }
  }
  if (name === undefined || name.length < 2) {
    return;
  }

  const attributes = index.entityAttributes.get(name)
    ?? { money: new Set<number>(), duration: new Set<number>() };

  for (const [key, nested] of Object.entries(record)) {
    const kind = classifyKey(key);
    if (kind === undefined) {
      continue;
    }
    const values: number[] = [];
    if (typeof nested === 'number' && Number.isFinite(nested)) {
      values.push(nested);
    } else if (typeof nested === 'string') {
      for (const match of nested.matchAll(NUMBER_IN_STRING_PATTERN)) {
        values.push(Number(match[0]));
      }
    }
    for (const value of values) {
      if (kind === 'money') {
        recordMoney(attributes.money, value);
      } else {
        attributes.duration.add(value);
      }
    }
  }

  // A name with no numbers of its own is still worth recording: it tells the
  // attribution check that this IS a known entity, so a price stated next to it
  // has something to be wrong about.
  index.entityAttributes.set(name, attributes);
}

function absorb(
  index: SupportIndex,
  value: unknown,
  fragments: string[],
  kind?: NumericKind,
): void {
  if (value === null || value === undefined) {
    return;
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) {
      routeNumber(index, value, kind);
    }
    return;
  }
  if (typeof value === 'boolean') {
    return;
  }
  if (typeof value === 'string') {
    absorbString(index, value, fragments, kind);
    return;
  }
  if (Array.isArray(value)) {
    absorbArrayCounts(index, value);
    for (const item of value) {
      absorb(index, item, fragments, kind);
    }
    return;
  }
  if (typeof value === 'object') {
    absorbEntityAttributes(index, value as Record<string, unknown>);
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
      // The key decides the kind of the numbers beneath it; an inner key that
      // says nothing about kind inherits the enclosing one, so
      // `pricing: { standard: 4500 }` is still money.
      absorb(index, nested, fragments, classifyKey(key) ?? kind);
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

function inPool(pool: readonly number[] | ReadonlySet<number>, value: number): boolean {
  const candidates = Array.isArray(pool) ? pool : [...(pool as ReadonlySet<number>)];
  return candidates.some(candidate => Math.abs(candidate - value) < 1e-9);
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
      // MONEY POOL ONLY. Both directions of the cents boundary ($45.00 ⇔ 4500)
      // are already recorded in the pool itself. The owner's own prose is
      // untyped, so a figure the owner typed still counts wherever it sits.
      return inPool(tools.money, probe.amount)
        || hasNumber(owner, probe.amount);
    case 'count':
      return hasNumber(tools, probe.amount) || hasNumber(owner, probe.amount);
    case 'duration':
      // DURATION POOL ONLY, for the same reason: a price must not vouch for a
      // length, any more than a length may vouch for a price.
      return inPool(tools.durations, probe.minutes)
        || inPool(tools.durations, probe.raw)
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

// ---------------------------------------------------------------------------
// Attribution — is the value attached to the RIGHT thing?
// ---------------------------------------------------------------------------

function splitSentences(answer: string): string[] {
  return answer.split(/(?<=[.!?])\s+|\n+/).filter(sentence => sentence.trim().length > 0);
}

/** Boundary-aware word lookup in a support index's normalised haystack. */
function hasWord(index: SupportIndex, word: string): boolean {
  return index.text.includes(` ${word} `);
}

/**
 * The one named thing this sentence is about, or undefined when it is about
 * none or several.
 *
 * Attribution is only decidable when exactly ONE known entity is on the table.
 * With two ("Gel Manicure is $45 and Gel-X is $75") a sentence-level check
 * cannot say which number belongs to which, and guessing would invent failures;
 * those sentences fall back to the value-set check alone. The longest match
 * wins, so a menu holding both "Manicure" and "Gel Manicure" resolves the
 * sentence "Gel Manicure is $45." to the specific one.
 */
function soleKnownEntity(sentence: string, tools: SupportIndex): string | undefined {
  const haystack = ` ${normalizeText(sentence)} `;
  const matched = [...tools.entityAttributes.keys()]
    .filter(name => haystack.includes(` ${name} `));
  const maximal = matched.filter(
    name => !matched.some(other => other !== name && ` ${other} `.includes(` ${name} `)),
  );
  return maximal.length === 1 ? maximal[0] : undefined;
}

/**
 * A value that IS somewhere in the tool results but does NOT belong to the
 * thing the sentence attached it to. Returns the note to report, or undefined.
 *
 * An entity with no recorded value of that kind yields undefined: the tools
 * never said what its price is, so the answer cannot be convicted of getting it
 * wrong. Silence is not evidence.
 */
function attributionMismatch(
  fact: ExtractedFact,
  subject: string | undefined,
  tools: SupportIndex,
): string | undefined {
  if (subject === undefined) {
    return undefined;
  }
  const attributes = tools.entityAttributes.get(subject);
  if (!attributes) {
    return undefined;
  }

  if (fact.probe.type === 'money') {
    if (attributes.money.size === 0 || inPool(attributes.money, fact.probe.amount)) {
      return undefined;
    }
    return `not the price of "${subject}"`;
  }

  if (fact.probe.type === 'duration') {
    const { minutes, raw } = fact.probe;
    if (attributes.duration.size === 0
      || inPool(attributes.duration, minutes)
      || inPool(attributes.duration, raw)) {
      return undefined;
    }
    return `not the duration of "${subject}"`;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Lower-case menu names
// ---------------------------------------------------------------------------

/**
 * Head nouns a nail-salon menu item can end in. CLOSED LEXICON, allowed to grow
 * one word at a time.
 *
 * Entity extraction sees quoted strings and capitalised runs, so it never saw
 * "your paraffin dip is active" — an invented add-on in ordinary lower case
 * passed against a menu that has no such thing. Anchoring on the head noun
 * finds the phrase; the words around it are then checked one by one. Generic
 * words ("nails", "treatment", "appointment") are deliberately NOT here: they
 * occur in ordinary prose about a real menu and would manufacture failures.
 */
const SERVICE_HEAD_NOUNS_SPECIFIC = new Set([
  'manicure',
  'manicures',
  'manicurist',
  'pedicure',
  'pedicures',
  'gel',
  'acrylic',
  'acrylics',
  'dip',
  'dips',
  'extension',
  'extensions',
  'overlay',
  'overlays',
  'paraffin',
  'waxing',
  'facial',
  'facials',
  'ombre',
  'shellac',
  'biab',
  'refill',
  'refills',
]);

/**
 * Head nouns that are ALSO ordinary English an owner-assistant answer uses for
 * something other than a menu item: "fill in your hours", "a few tips",
 * "polish the description", "available in french". Alone they are not evidence
 * of an invented item, so they are reported only inside a phrase of TWO OR MORE
 * words ("dip powder", "nail art", "french tips").
 *
 * Reporting them alone produced eight false positives on ordinary, correct
 * answers about the fixture salon, each of which would have cost a human
 * adjudication on the one report the paid run exists to produce.
 */
const SERVICE_HEAD_NOUNS_AMBIGUOUS = new Set([
  'powder',
  'polish',
  'fill',
  'fills',
  'removal',
  'removals',
  'wax',
  'massage',
  'art',
  'french',
  'chrome',
  'tips',
  'soak',
]);

const SERVICE_HEAD_NOUNS = new Set([
  ...SERVICE_HEAD_NOUNS_SPECIFIC,
  ...SERVICE_HEAD_NOUNS_AMBIGUOUS,
]);

/**
 * Ordinary English that may sit directly in front of a head noun without being
 * part of any menu name: generic qualifiers, and the verbs a sentence about the
 * menu uses ("could not FIND paraffin dip", "you OFFER gel manicure").
 *
 * CLOSED LEXICON, same discipline as `SENTENCE_INITIAL_NON_ENTITY_WORDS`: it
 * may grow one word at a time when a legitimate sentence is found failing, and
 * must never be replaced by a part-of-speech rule. A word NOT in here is
 * treated as part of the name, which is the reporting direction.
 */
const SERVICE_PHRASE_MODIFIERS = new Set([
  // Generic qualifiers and quantifiers.
  'quick',
  'short',
  'shorter',
  'long',
  'longer',
  'standard',
  'regular',
  'basic',
  'full',
  'new',
  'next',
  'first',
  'last',
  'same',
  'other',
  'another',
  'each',
  'every',
  'any',
  'single',
  'usual',
  'normal',
  'typical',
  'extra',
  'more',
  'less',
  'most',
  'least',
  'best',
  'cheapest',
  'quickest',
  'longest',
  'shortest',
  'only',
  'just',
  'also',
  'still',
  'even',
  'per',
  'both',
  'one',
  'two',
  'three',
  'ones',
  'few',
  'some',
  'several',
  'many',
  'couple',
  // Connectives. Without these, "Gel Manicure is $45 while gel-x is $75"
  // reports the phrase "while gel".
  'while',
  'unlike',
  'versus',
  'vs',
  'than',
  'whereas',
  'plus',
  'without',
  // Verbs a sentence about the menu is built from. These are never name words.
  'find',
  'finds',
  'found',
  'offer',
  'offers',
  'offering',
  'offered',
  'book',
  'books',
  'booked',
  'booking',
  'add',
  'adds',
  'added',
  'have',
  'has',
  'had',
  'include',
  'includes',
  'including',
  'want',
  'wants',
  'need',
  'needs',
  'get',
  'gets',
  'got',
  'does',
  'did',
  'list',
  'lists',
  'show',
  'shows',
  'charge',
  'charges',
  'take',
  'takes',
  'took',
  'run',
  'runs',
  'see',
  'sees',
  'say',
  'says',
  'know',
  'knows',
  'use',
  'uses',
  'set',
  'sets',
  'make',
  'makes',
  'called',
  'named',
  'like',
  'priced',
  'cost',
  'costs',
  'last',
  'lasts',
  'listed',
  'called',
]);

/**
 * Menu phrases written in lower case, checked word by word against the tool
 * results. A phrase is reported when any content word in it appears nowhere.
 */
function extractLowercaseServiceFacts(
  sentence: string,
  tools: SupportIndex,
  owner: SupportIndex,
): GroundingFact[] {
  const words = normalizeText(sentence).split(' ').filter(word => word.length > 0);
  const facts: GroundingFact[] = [];
  const seen = new Set<string>();

  const isContentWord = (word: string): boolean => word.length > 1
    && !ENTITY_STOPWORDS.has(word)
    && !SERVICE_PHRASE_MODIFIERS.has(word)
    && !isDateWord(word)
    && !/^\d+$/.test(word);

  for (const [position, word] of words.entries()) {
    if (!SERVICE_HEAD_NOUNS.has(word)) {
      continue;
    }
    // "paraffin dip" is ONE phrase. Let the rightmost head noun carry it, so an
    // invented item is reported once rather than once per word.
    if (SERVICE_HEAD_NOUNS.has(words[position + 1] ?? '')) {
      continue;
    }

    // The head noun plus AT MOST ONE content word in front of it.
    //
    // A wider window swallows the sentence's verb ("could not find paraffin
    // dip") and its filler ("the first one is gel"), and then reports the verb
    // as an invented menu word. One word is enough for the shape that matters,
    // because an invented item's own qualifier sits directly against its head
    // noun: "paraffin dip", "stone massage", "dip powder".
    const previous = words[position - 1] ?? '';
    const phrase = isContentWord(previous) ? [previous, word] : [word];

    const content = phrase.filter(isContentWord);
    if (content.length === 0) {
      continue;
    }
    if (content.every(token => hasWord(tools, token) || hasWord(owner, token))) {
      continue;
    }

    // An ambiguous head noun standing alone is ordinary English, not a claim
    // about the menu. Only a phrase carries enough signal to report.
    if (phrase.length < 2 && SERVICE_HEAD_NOUNS_AMBIGUOUS.has(word)) {
      continue;
    }

    const value = phrase.join(' ');
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    facts.push({
      kind: 'entity',
      value,
      note: 'no menu item by that name',
    });
  }

  return facts;
}

/**
 * The checker. `ok` is true only when every extracted fact is supported.
 */
export function checkGrounding(input: GroundingInput): GroundingVerdict {
  const tools = buildSupportIndex(input.toolResults);
  const owner = buildSupportIndex(input.ownerMessages ?? []);

  const unsupported: GroundingFact[] = [];
  const seen = new Set<string>();

  const report = (fact: GroundingFact) => {
    const dedupeKey = `${fact.kind}:${fact.value.toLowerCase()}`;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    unsupported.push(fact);
  };

  // Capitalised and quoted names first, so a name that both passes catch is
  // reported in the casing the answer actually used.
  for (const fact of extractEntityFacts(input.answer)) {
    if (!isSupported(fact, tools, owner)) {
      report({ kind: fact.kind, value: fact.value });
    }
  }

  // Scalars are scanned SENTENCE BY SENTENCE so each one can be judged against
  // the thing its own sentence is about. Almost nothing changes about WHAT is
  // extracted, because the patterns do not span sentences — the one exception
  // is a number separated from its unit by a NEWLINE ("45\nminutes"), which
  // `splitSentences` now cuts, so it degrades from a duration to a count and is
  // checked against the wider pool.
  for (const sentence of splitSentences(input.answer)) {
    const subject = soleKnownEntity(sentence, tools);

    for (const fact of extractScalarFacts(sentence)) {
      if (!isSupported(fact, tools, owner)) {
        report({ kind: fact.kind, value: fact.value });
        continue;
      }
      const mismatch = attributionMismatch(fact, subject, tools);
      if (mismatch !== undefined) {
        report({ kind: fact.kind, value: fact.value, note: mismatch });
      }
    }

    for (const fact of extractLowercaseServiceFacts(sentence, tools, owner)) {
      report(fact);
    }
  }

  return { ok: unsupported.length === 0, unsupported };
}

/** One-line rendering for the markdown report. */
export function formatGroundingVerdict(verdict: GroundingVerdict): string {
  if (verdict.ok) {
    return 'grounded';
  }
  return verdict.unsupported
    .map(fact => (fact.note === undefined
      ? `${fact.kind}:${fact.value}`
      : `${fact.kind}:${fact.value} (${fact.note})`))
    .join(', ');
}
