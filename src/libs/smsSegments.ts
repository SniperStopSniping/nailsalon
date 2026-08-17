/**
 * SMS segment calculator — GSM 03.38 / UCS-2, with correct concatenation
 * packing.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §7
 * (1 credit = 1 outbound billable segment) and §7.7.
 *
 * ISOMORPHIC ON PURPOSE: this module is imported by the server-side
 * validator AND (in Gate C) by the client-side "142/160 · 1 SMS credit"
 * counter. It must therefore import nothing server-only — no Env, no
 * 'server-only', no node APIs. Pure function of its input string.
 *
 * Correctness notes the tests pin down:
 * - GSM-7: single segment = 160 septets; concatenated = 153 septets per
 *   segment (6-septet UDH). Extension-table characters (^ { } \ [ ] ~ | €
 *   and form feed) cost TWO septets (ESC + char) and the pair must never
 *   straddle a segment boundary — if only one septet remains in the
 *   current segment, that septet is wasted and the pair moves whole to
 *   the next segment. Naive ceil(total/153) math over-packs and
 *   under-bills; this implementation simulates real packing.
 * - UCS-2: single = 70 UTF-16 code units; concatenated = 67. A surrogate
 *   pair (emoji, non-BMP) costs two units and must not split across a
 *   segment boundary.
 * - One character outside the GSM basic+extension tables forces UCS-2
 *   encoding for the WHOLE message.
 * - Empty string reports 1 segment: Twilio rejects empty bodies at the
 *   API, but a predicted-billing floor of one segment is the safe
 *   reservation answer and the validator rejects empty bodies earlier.
 * - Malformed input (lone surrogates) is counted, never thrown on.
 */

export type SmsEncoding = 'gsm7' | 'ucs2';

export type SmsSegmentation = {
  encoding: SmsEncoding;
  /** User-perceived characters (Unicode code points). */
  characters: number;
  /** Septets for gsm7, UTF-16 code units for ucs2. */
  billableUnits: number;
  segments: number;
  /** Capacity of the current segment count (160/70 single; 153/67 each concatenated). */
  limitForSegments: number;
  /** Capacity minus billable units. Approximate near extension-char boundaries (packing waste). */
  remaining: number;
  /** Distinct characters that forced UCS-2, for validator messages. */
  nonGsmCharacters: string[];
};

const GSM_SINGLE_SEGMENT = 160;
const GSM_CONCAT_SEGMENT = 153;
const UCS2_SINGLE_SEGMENT = 70;
const UCS2_CONCAT_SEGMENT = 67;

// GSM 03.38 basic character set (each costs one septet).
const GSM_BASIC
  = '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?'
  + '¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑܧ¿abcdefghijklmnopqrstuvwxyzäöñüà';

// GSM 03.38 default extension table (each costs two septets: ESC + char).
const GSM_EXTENSION = '\f^{}\\[~]|€';

const GSM_BASIC_SET = new Set(Array.from(GSM_BASIC));
const GSM_EXTENSION_SET = new Set(Array.from(GSM_EXTENSION));

export function isGsmCompatible(text: string): boolean {
  for (const char of text) {
    if (!GSM_BASIC_SET.has(char) && !GSM_EXTENSION_SET.has(char)) {
      return false;
    }
  }
  return true;
}

/**
 * Pack per-character costs into segments of the given capacity, never
 * splitting a single character's cost across a boundary. Returns the
 * number of segments used.
 */
function packSegments(costs: number[], capacity: number): number {
  let segments = 1;
  let used = 0;
  for (const cost of costs) {
    if (used + cost > capacity) {
      segments += 1;
      used = cost;
    } else {
      used += cost;
    }
  }
  return segments;
}

export function calculateSmsSegments(body: string): SmsSegmentation {
  const codePoints = Array.from(body);
  const characters = codePoints.length;

  const nonGsm: string[] = [];
  for (const char of codePoints) {
    if (!GSM_BASIC_SET.has(char) && !GSM_EXTENSION_SET.has(char) && !nonGsm.includes(char)) {
      nonGsm.push(char);
    }
  }

  if (nonGsm.length === 0) {
    // GSM-7 path: per-character septet costs.
    const costs = codePoints.map(char => (GSM_EXTENSION_SET.has(char) ? 2 : 1));
    const billableUnits = costs.reduce((sum, cost) => sum + cost, 0);
    const segments = billableUnits <= GSM_SINGLE_SEGMENT
      ? 1
      : packSegments(costs, GSM_CONCAT_SEGMENT);
    const limitForSegments = segments === 1
      ? GSM_SINGLE_SEGMENT
      : segments * GSM_CONCAT_SEGMENT;
    return {
      encoding: 'gsm7',
      characters,
      billableUnits,
      segments,
      limitForSegments,
      remaining: limitForSegments - billableUnits,
      nonGsmCharacters: [],
    };
  }

  // UCS-2 path: per-code-point cost in UTF-16 code units (surrogate pairs
  // cost 2 and must never split across a segment boundary).
  const costs = codePoints.map(char => char.length);
  const billableUnits = costs.reduce((sum, cost) => sum + cost, 0);
  const segments = billableUnits <= UCS2_SINGLE_SEGMENT
    ? 1
    : packSegments(costs, UCS2_CONCAT_SEGMENT);
  const limitForSegments = segments === 1
    ? UCS2_SINGLE_SEGMENT
    : segments * UCS2_CONCAT_SEGMENT;
  return {
    encoding: 'ucs2',
    characters,
    billableUnits,
    segments,
    limitForSegments,
    remaining: limitForSegments - billableUnits,
    nonGsmCharacters: nonGsm,
  };
}

/** "142/160 · 1 SMS credit" — the preview string the admin UI shows. */
export function formatSegmentPreview(segmentation: SmsSegmentation): string {
  const creditNoun = segmentation.segments === 1 ? 'SMS credit' : 'SMS credits';
  return `${segmentation.billableUnits}/${segmentation.limitForSegments} · ${segmentation.segments} ${creditNoun}`;
}
