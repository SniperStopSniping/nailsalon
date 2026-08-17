/**
 * Centrally controlled transactional SMS templates — Gate A foundation.
 *
 * Governing contract: docs/luster-billing-communications-rev-2-2.md §7.2
 * launch template rules and §10.3 outbound copy.
 *
 * ISOMORPHIC: imported by the server-side validator and (Gate C) the admin
 * preview counter. No Env, no 'server-only', no provider imports. Nothing
 * in this module sends anything.
 *
 * Rules encoded here and enforced by tests:
 * - Every client body opens with `"{salonName} via Luster: "` (identity on
 *   a shared number) and ends with "Reply STOP to opt out." — never
 *   "Do not reply" (STOP must remain available).
 * - Salon display names are sanitized to GSM-7 FOR THE SMS PREFIX ONLY
 *   (typographic punctuation mapped, unsupported characters dropped) and
 *   capped at 24 septets with word-boundary truncation, because one
 *   non-GSM character would collapse the whole message budget from 160 to
 *   70 units.
 * - No emoji, smart quotes or decorative Unicode in any template body.
 * - Client templates target ONE segment; owner/technician templates may
 *   use two (contract owner-decision default).
 *
 * KNOWN CONTRACT FINDING (Gate A, surfaced for the owner): the canonical
 * appointment-manage link is `{origin}[/…]/manage/{43-char token}` — at
 * minimum ~76 characters. Combined with the mandatory identity prefix and
 * STOP tail, ANY client template that embeds a real manage link exceeds
 * one GSM segment. The reality-check fixture below pins this at 2 segments
 * so the overflow is mechanically tracked; resolving it (short-link route,
 * or a revised client cap for link-bearing messages) is an owner decision
 * for Gate B. Link-free client templates fit comfortably in one segment.
 */

import { calculateSmsSegments, isGsmCompatible } from './smsSegments';

export const SALON_NAME_MAX_SEPTETS = 24;

export const MAX_SEGMENTS_BY_AUDIENCE = {
  client: 1,
  owner: 2,
  technician: 2,
} as const;

export type TemplateAudience = keyof typeof MAX_SEGMENTS_BY_AUDIENCE;

const GSM_PUNCTUATION_MAP: Record<string, string> = {
  '‘': '\'',
  '’': '\'',
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '…': '...',
  ' ': ' ',
};

/**
 * Sanitize a salon display name for the SMS identity prefix: map
 * typographic punctuation onto GSM equivalents, drop anything still
 * outside GSM-7, collapse whitespace, then cap at SALON_NAME_MAX_SEPTETS
 * septets using word-boundary truncation (a single over-long word is
 * hard-cut). Sanitization applies to the SMS prefix only — it never
 * rewrites the salon's stored name.
 */
export function sanitizeSalonNameForSms(name: string): string {
  let mapped = '';
  for (const char of name) {
    if (GSM_PUNCTUATION_MAP[char] !== undefined) {
      mapped += GSM_PUNCTUATION_MAP[char];
    } else if (isGsmCompatible(char)) {
      mapped += char;
    }
    // else: dropped — unsupported for the SMS prefix.
  }
  const collapsed = mapped.replace(/\s+/g, ' ').trim();
  if (septets(collapsed) <= SALON_NAME_MAX_SEPTETS) {
    return collapsed;
  }

  const words = collapsed.split(' ');
  let result = '';
  for (const word of words) {
    const candidate = result === '' ? word : `${result} ${word}`;
    if (septets(candidate) > SALON_NAME_MAX_SEPTETS) {
      break;
    }
    result = candidate;
  }
  if (result !== '') {
    return result;
  }

  // Single word longer than the cap: hard-cut on septet budget.
  let hardCut = '';
  for (const char of words[0] ?? '') {
    if (septets(hardCut + char) > SALON_NAME_MAX_SEPTETS) {
      break;
    }
    hardCut += char;
  }
  return hardCut;
}

function septets(text: string): number {
  return calculateSmsSegments(text).billableUnits;
}

export function buildClientSmsPrefix(salonName: string): string {
  const sanitized = sanitizeSalonNameForSms(salonName);
  if (sanitized === '') {
    // A name with no GSM-representable characters (e.g. fully CJK) cannot
    // carry the salon identity in the prefix; fall back to the platform
    // identity rather than sending an anonymous message. Gate B may add
    // transliteration; tracked in the Gate A owner report.
    return 'Luster: ';
  }
  return `${sanitized} via Luster: `;
}

export const STOP_LANGUAGE = 'Reply STOP to opt out.';

/**
 * Shared-number consent disclosure — contract §10.2. EXACT owner-approved
 * wording (ratified 2026-08-17, Gate B merge authorization): the copy the
 * owner/client-facing policy surfaces wherever shared-sender appointment
 * texts are described. It leads with the cross-business effect BEFORE the
 * user opts out and separates opt-out from appointment cancellation.
 * Changing a single byte requires a fresh owner sign-off. This ratification
 * is owner/product sign-off for this implementation stage, not external
 * legal advice; broad public rollout still owes legal/compliance review.
 */
export const SHARED_SENDER_STOP_DISCLOSURE
  = 'Appointment texts are sent through Luster\'s shared messaging number. '
  + 'Reply STOP to stop appointment texts sent through this number, including '
  + 'texts from other businesses using Luster. Reply START to resubscribe. '
  + 'Stopping texts does not cancel your appointments.';

/**
 * Advanced Opt-Out copy — configured in the Twilio console (B3 runbook)
 * and mirrored here so it is code-reviewed and regression-tested. The
 * STOP confirmation MUST state the appointment was not cancelled
 * (contract §10.4 — CANCEL/STOP never cancels an appointment).
 */
export const ADVANCED_OPT_OUT_COPY = {
  stopConfirmation:
    'Luster: You have unsubscribed from Luster appointment texts. Your appointment was not cancelled. Use your appointment link or contact the salon to make changes.',
  helpResponse: 'Luster appointment texts. Support: support@islanailsalon.com. Reply STOP to unsubscribe.',
} as const;

export type TemplateVariables = Record<string, string>;

export type TemplateDefinition = {
  key: string;
  /** Copy revision. Bumping produces new copy, never a new dedupe identity. */
  version: string;
  audience: TemplateAudience;
  render: (variables: TemplateVariables) => string;
  /**
   * Realistic maxima for every variable — longest approved salon name,
   * real manage-link shape, long service names. Tests render every fixture
   * and assert the audience segment budget.
   */
  worstCaseVariables: TemplateVariables[];
};

/**
 * Realistic worst-case fixture values. The manage URL uses the repo's real
 * canonical shape (`buildAppointmentManageUrl`): tenant origin +
 * `/manage/` + 43-character base64url token — deliberately NOT an invented
 * short link.
 */
export const WORST_CASE_MANAGE_URL_SHORT_ORIGIN
  = 'https://islanailsalon.com/manage/Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb3dEf6hIj9';
export const WORST_CASE_MANAGE_URL_SLUG_PATH
  = 'https://lusterbooking.com/en/the-longest-approved-salon-slug-we-support-here/manage/Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4zAb3dEf6hIj9';
/**
 * Short-link worst case: origin + '/a/' bounded at 34 chars (host <= 23,
 * enforced against the configured origin by the template suite) + a 22-char
 * 128-bit base64url token.
 */
export const WORST_CASE_SHORT_LINK
  = 'https://xxxxxxxxxxxxxxxxxxxxxxx/a/AbCdEfGhIjKlMnOpQrStUv';

const WORST_CASE_SALON_NAME = 'Twenty Four Septet Name Xy';
const WORST_CASE_TIME = 'Wed Aug 26, 12:30 PM';

export const COMMUNICATION_TEMPLATES: Record<string, TemplateDefinition> = {
  client_booking_confirmation_nolink: {
    key: 'client_booking_confirmation_nolink',
    version: 'v1',
    audience: 'client',
    render: variables =>
      `${buildClientSmsPrefix(variables.salonName ?? '')}Booking confirmed for ${variables.startTime ?? ''}. ${STOP_LANGUAGE}`,
    worstCaseVariables: [
      { salonName: WORST_CASE_SALON_NAME, startTime: WORST_CASE_TIME },
    ],
  },
  client_appointment_reminder: {
    key: 'client_appointment_reminder',
    version: 'v1',
    audience: 'client',
    render: variables =>
      `${buildClientSmsPrefix(variables.salonName ?? '')}Reminder for ${variables.startTime ?? ''}. For changes: ${variables.manageUrl ?? ''} ${STOP_LANGUAGE}`,
    worstCaseVariables: [
      {
        salonName: WORST_CASE_SALON_NAME,
        startTime: WORST_CASE_TIME,
        manageUrl: WORST_CASE_MANAGE_URL_SHORT_ORIGIN,
      },
      {
        salonName: WORST_CASE_SALON_NAME,
        startTime: WORST_CASE_TIME,
        manageUrl: WORST_CASE_MANAGE_URL_SLUG_PATH,
      },
    ],
  },
  client_appointment_reminder_shortlink: {
    key: 'client_appointment_reminder_shortlink',
    version: 'v1',
    audience: 'client',
    render: variables =>
      `${buildClientSmsPrefix(variables.salonName ?? '')}Reminder for ${variables.startTime ?? ''}. Manage: ${variables.manageUrl ?? ''} ${STOP_LANGUAGE}`,
    worstCaseVariables: [
      {
        salonName: WORST_CASE_SALON_NAME,
        startTime: WORST_CASE_TIME,
        manageUrl: WORST_CASE_SHORT_LINK,
      },
    ],
  },
  client_booking_confirmation_shortlink: {
    key: 'client_booking_confirmation_shortlink',
    version: 'v1',
    audience: 'client',
    render: variables =>
      `${buildClientSmsPrefix(variables.salonName ?? '')}Confirmed for ${variables.startTime ?? ''}. Manage: ${variables.manageUrl ?? ''} ${STOP_LANGUAGE}`,
    worstCaseVariables: [
      {
        salonName: WORST_CASE_SALON_NAME,
        startTime: WORST_CASE_TIME,
        manageUrl: WORST_CASE_SHORT_LINK,
      },
    ],
  },
  owner_new_booking: {
    key: 'owner_new_booking',
    version: 'v1',
    audience: 'owner',
    render: variables =>
      `Luster: New booking at ${sanitizeSalonNameForSms(variables.salonName ?? '')} - ${variables.clientName ?? ''}, ${variables.serviceName ?? ''}, ${variables.startTime ?? ''}.`,
    worstCaseVariables: [
      {
        salonName: WORST_CASE_SALON_NAME,
        clientName: 'Alexandria-Konstantina Papadopoulos-Winterbottom',
        serviceName: 'Deluxe Gel Extension Set with Hand-Painted Chrome Art',
        startTime: WORST_CASE_TIME,
      },
    ],
  },
};

export type TemplateSegmentViolation = {
  templateKey: string;
  fixtureIndex: number;
  segments: number;
  maxSegments: number;
  encoding: string;
};

/**
 * Validate every template against its audience budget across every
 * worst-case fixture. Returns violations instead of throwing so callers
 * (tests, the Gate A owner report, the future Gate B merge gate) can
 * distinguish tracked findings from regressions.
 */
export function validateTemplateSegments(): TemplateSegmentViolation[] {
  const violations: TemplateSegmentViolation[] = [];
  for (const template of Object.values(COMMUNICATION_TEMPLATES)) {
    const maxSegments = MAX_SEGMENTS_BY_AUDIENCE[template.audience];
    template.worstCaseVariables.forEach((variables, fixtureIndex) => {
      const segmentation = calculateSmsSegments(template.render(variables));
      if (segmentation.segments > maxSegments) {
        violations.push({
          templateKey: template.key,
          fixtureIndex,
          segments: segmentation.segments,
          maxSegments,
          encoding: segmentation.encoding,
        });
      }
    });
  }
  return violations;
}

Object.freeze(COMMUNICATION_TEMPLATES);
Object.values(COMMUNICATION_TEMPLATES).forEach(Object.freeze);
