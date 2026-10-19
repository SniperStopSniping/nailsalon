/** Source annotations describe values; they never grant review/publication. */
export type SetupValueSource = 'saved' | 'owner' | 'upload' | 'suggested' | 'conversation';
export type SetupValueSources = Partial<Record<'name' | 'priceCents' | 'durationMinutes', SetupValueSource>>;
export type SetupValueContext = { ownerMessage: string };
type Item = { id: string; name: string; priceCents: number | null; durationMinutes: number | null; origin?: string };
type Named = { id: string; name: string };
const fields = ['name', 'priceCents', 'durationMinutes'] as const;
const sources = new Set<SetupValueSource>(['saved', 'owner', 'upload', 'suggested', 'conversation']);
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

export function resolvedValueSources(item: Item, stored?: SetupValueSources): SetupValueSources {
  const fallback = item.origin === 'existing' ? 'saved' : item.origin === 'owner' ? 'owner' : item.origin === 'upload' ? 'upload' : 'conversation';
  return Object.fromEntries(fields.filter(field => item[field] !== null).map(field => [field, stored?.[field] && sources.has(stored[field]!) ? stored[field] : fallback]));
}

/**
 * Conservative literal evidence, not a second AI extraction or a price guess.
 * Unmatched/ambiguous statements stay "Prepared with AI". No raw quotes persist.
 */
function ownerClauses(item: Item, peers: Named[], message: string) {
  const text = message.normalize('NFKC');
  const matches: { id: string; start: number; end: number }[] = [];
  for (const peer of peers) {
    const name = peer.name.normalize('NFKC');
    const acronym = name.split(/\s/u)[0] ?? '';
    const aliases = new Set([name, name.split('/')[0]!.trim(), name.split('(')[0]!.trim(), ...(/^[A-Z\d-]{3,8}$/u.test(acronym) ? [acronym] : [])]);
    for (const alias of aliases) {
      const words = alias.match(/[\p{L}\p{N}]+/gu);
      if (!words?.length) {
        continue;
      }
      // Owners naturally say "gel manicures" for a saved "Gel Manicure".
      // Recognize only the regular terminal plural; keep the existing peer
      // ambiguity check so two matching services cannot inherit each other's
      // prices or times. This does not guess synonyms or irregular plurals.
      const namePattern = words.map((word, index) => `${escape(word)}${index === words.length - 1 && !/s$/iu.test(word) ? '(?:s)?' : ''}`).join('[\\s\\p{P}]*');
      const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${namePattern})(?=$|[^\\p{L}\\p{N}])`, 'giu');
      for (const match of text.matchAll(pattern)) {
        const end = match.index + match[0].length;
        matches.push({ id: peer.id, start: end - match[1]!.length, end });
      }
    }
  }
  return matches.filter(match => match.id === item.id && !matches.some(other => other.id !== item.id && other.start === match.start))
    .map((match) => {
      const next = matches.filter(other => other.id !== item.id && other.start >= match.end).sort((a, b) => a.start - b.start)[0];
      const instructions = text.slice(match.start, Math.min(next?.start ?? text.length, match.start + 400));
      return { instructions, text: instructions.split(/[;\n]|[.!?](?=\s|$)|\b(?:instagram|email|address|deposit|polic(?:y|ies)|buffer|cleanup|opening)\b/iu)[0]! };
    });
}

const negated = (clause: string, index: number) => /\b(?:not|instead of|rather than)\s*$/iu.test(clause.slice(Math.max(0, index - 40), index));

function suppliedPrice(clause: string, cents: number | null) {
  if (cents === null) {
    return false;
  }
  const number = '\\d+(?:,\\d{3})*(?:\\.\\d{1,2})?';
  const amount = `(${number})`;
  const currency = '(?:[$£€]\\s*|(?:CAD|USD|AUD|NZD|GBP|EUR)\\s*)';
  if (new RegExp(`(?:[$£€]\\s*|(?:CAD|USD|AUD|NZD|GBP|EUR)\\s*|\\b(?:price|cost)\\s*)${number}\\s*(?:[-–—]|to)\\s*${currency}?${number}`, 'iu').test(clause)) {
    return false;
  }
  const patterns = [new RegExp(`${currency}${amount}`, 'giu'), new RegExp(`\\b(?:priced?(?:\\s+(?:is|at|to))?|charge|costs?|at|to)\\s*${currency}?${amount}`, 'giu')];
  return patterns.some(pattern => [...clause.matchAll(pattern)].some((match) => {
    const suffix = clause.slice(match.index + match[0].length);
    return !negated(clause, match.index) && !/^\s*(?:minutes?|mins?|hours?|hrs?|years?|nails?)\b/iu.test(suffix)
      && Math.round(Number(match[1]!.replaceAll(',', '')) * 100) === cents;
  }));
}

function suppliedDuration(clause: string, minutes: number | null) {
  if (minutes === null) {
    return false;
  }
  // A range is not an exact appointment length.
  if (/\d\s*[-–—]\s*\d+\s*(?:minutes?|mins?|hours?|hrs?)\b/iu.test(clause)) {
    return false;
  }
  const compound = [...clause.matchAll(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\s*(?:and\s*)?(\d+)\s*(?:minutes?|mins?|m)\b/giu)];
  if (compound.some(match => !negated(clause, match.index) && Number(match[1]) * 60 + Number(match[2]) === minutes)) {
    return true;
  }
  return [...clause.matchAll(/(\d+(?:\.\d+)?)\s*(?:(?:extra|additional)\s+)?(minutes?|mins?|hours?|hrs?)\b/giu)]
    .some(match => !negated(clause, match.index) && !compound.some(other => match.index >= other.index && match.index < other.index + other[0].length)
      && Number(match[1]) * (/^(?:hour|hr)/iu.test(match[2]!) ? 60 : 1) === minutes);
}

export function updatedValueSources(previous: Item | undefined, item: Item, origin: 'owner' | 'assistant' | 'upload', stored: SetupValueSources | undefined, peers: Named[], context?: SetupValueContext): SetupValueSources {
  const prior = previous ? resolvedValueSources(previous, stored) : {};
  const clauses = origin === 'assistant' && context ? ownerClauses(item, peers, context.ownerMessage) : [];
  const recommendation = /\b(?:recommend\w*|suggest\w*|not sure|make (?:it|them|something|the prices) up)\b/iu;
  const recommended = Boolean(context && recommendation.test(context.ownerMessage) && clauses.some(clause => recommendation.test(clause.instructions)
    || !/[$£€]|\b(?:CAD|USD|AUD|NZD|GBP|EUR|minutes?|mins?|hours?|hrs?)\b/iu.test(clause.text)));
  const supplied = { name: clauses.length > 0, priceCents: clauses.some(clause => suppliedPrice(clause.text, item.priceCents)), durationMinutes: clauses.some(clause => suppliedDuration(clause.text, item.durationMinutes)) };
  return Object.fromEntries(fields.filter(field => item[field] !== null).map((field) => {
    const source = supplied[field]
      ? 'owner'
      : previous && previous[field] === item[field]
        ? prior[field]
        : origin === 'owner' ? 'owner' : origin === 'upload' ? 'upload' : recommended ? 'suggested' : 'conversation';
    return [field, source];
  }));
}

export function suggestedValueSources(previous: Item | undefined, item: Item, stored?: SetupValueSources): SetupValueSources {
  const prior = previous ? resolvedValueSources(previous, stored) : {};
  return Object.fromEntries(fields.filter(field => item[field] !== null).map(field => [field, previous && previous[field] === item[field] ? prior[field] : 'suggested']));
}

export function hasUnverifiedAiValues(item: Item, stored?: SetupValueSources) {
  const resolved = resolvedValueSources(item, stored);
  return [resolved.priceCents, resolved.durationMinutes].some(source => source === 'suggested' || source === 'conversation');
}

export function valueSourcesSummary(item: Item, stored?: SetupValueSources) {
  const resolved = resolvedValueSources(item, stored);
  const labels: Record<SetupValueSource, string> = { saved: 'Saved in Luster', owner: 'Supplied by you', upload: 'Read from your upload', suggested: 'AI suggestion', conversation: 'Prepared with AI' };
  const present = fields.filter(field => resolved[field]);
  if (new Set(present.map(field => resolved[field])).size === 1) {
    return labels[resolved[present[0]!]!];
  }
  return present.map(field => `${field === 'name' ? 'Name' : field === 'priceCents' ? 'Price' : 'Time'}: ${labels[resolved[field]!]}`).join(' · ');
}
