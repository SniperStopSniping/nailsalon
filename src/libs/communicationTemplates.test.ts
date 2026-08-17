import { describe, expect, it } from 'vitest';

import {
  ADVANCED_OPT_OUT_COPY,
  buildClientSmsPrefix,
  COMMUNICATION_TEMPLATES,
  MAX_SEGMENTS_BY_AUDIENCE,
  SALON_NAME_MAX_SEPTETS,
  sanitizeSalonNameForSms,
  SHARED_SENDER_STOP_DISCLOSURE,
  validateTemplateSegments,
} from './communicationTemplates';
import { calculateSmsSegments, isGsmCompatible } from './smsSegments';

describe('sanitizeSalonNameForSms', () => {
  it('maps typographic punctuation onto GSM equivalents instead of collapsing the budget to UCS-2', () => {
    expect(sanitizeSalonNameForSms('Nails ’n’ Co')).toBe(`Nails 'n' Co`);
    expect(sanitizeSalonNameForSms('“Élan” — Nail Bar')).toBe('"Élan" - Nail Bar');
    expect(isGsmCompatible(sanitizeSalonNameForSms('美甲 Nails 💅'))).toBe(true);
  });

  it('truncates on word boundaries at the septet cap without a trailing space', () => {
    const truncated = sanitizeSalonNameForSms('Extraordinary Beauty Lounge and Nail Atelier');

    expect(calculateSmsSegments(truncated).billableUnits).toBeLessThanOrEqual(SALON_NAME_MAX_SEPTETS);
    expect(truncated).toBe('Extraordinary Beauty');
    expect(truncated.endsWith(' ')).toBe(false);
  });

  it('hard-cuts a single over-long word on the septet budget', () => {
    const truncated = sanitizeSalonNameForSms('Supercalifragilisticexpialidocious');

    expect(calculateSmsSegments(truncated).billableUnits).toBeLessThanOrEqual(SALON_NAME_MAX_SEPTETS);
    expect(truncated.length).toBeGreaterThan(0);
  });

  it('measures the cap in septets, not characters (extension chars cost two)', () => {
    const bracketed = sanitizeSalonNameForSms('[[[[[[[[[[[[[[[[[[[[[[[[');

    expect(calculateSmsSegments(bracketed).billableUnits).toBeLessThanOrEqual(SALON_NAME_MAX_SEPTETS);
    expect(bracketed.length).toBeLessThanOrEqual(12);
  });
});

describe('controlled templates', () => {
  it('opens every client body with the identity prefix and closes with STOP language', () => {
    for (const template of Object.values(COMMUNICATION_TEMPLATES)) {
      if (template.audience !== 'client') {
        continue;
      }
      for (const variables of template.worstCaseVariables) {
        const body = template.render(variables);

        expect(body).toMatch(/^(?:.+ via Luster: |Luster: )/);
        expect(body).toContain('Reply STOP to opt out.');
      }
    }
  });

  it('never invites a dead-end reply and never says "Do not reply"', () => {
    for (const template of Object.values(COMMUNICATION_TEMPLATES)) {
      for (const variables of template.worstCaseVariables) {
        const body = template.render(variables);

        expect(body.toLowerCase()).not.toContain('do not reply');
        expect(body.toLowerCase()).not.toContain('reply to this text');
      }
    }
  });

  it('keeps every worst-case rendering in GSM-7 (no emoji, smart quotes or decorative Unicode)', () => {
    for (const template of Object.values(COMMUNICATION_TEMPLATES)) {
      for (const variables of template.worstCaseVariables) {
        expect(isGsmCompatible(template.render(variables))).toBe(true);
      }
    }
  });

  it('keeps link-free client templates and internal templates inside their audience budgets', () => {
    const violations = validateTemplateSegments();
    for (const violation of violations) {
      // Only the tracked manage-link finding may violate (see next test).
      expect(violation.templateKey).toBe('client_appointment_reminder');
    }
    const confirmation = COMMUNICATION_TEMPLATES.client_booking_confirmation_nolink!;
    for (const variables of confirmation.worstCaseVariables) {
      expect(calculateSmsSegments(confirmation.render(variables)).segments)
        .toBeLessThanOrEqual(MAX_SEGMENTS_BY_AUDIENCE.client);
    }
    const owner = COMMUNICATION_TEMPLATES.owner_new_booking!;
    for (const variables of owner.worstCaseVariables) {
      expect(calculateSmsSegments(owner.render(variables)).segments)
        .toBeLessThanOrEqual(MAX_SEGMENTS_BY_AUDIENCE.owner);
    }
  });

  it('KNOWN CONTRACT FINDING: a real manage link pushes the client reminder to exactly two segments', () => {
    // The canonical manage URL (origin + /manage/ + 43-char token) plus the
    // mandatory identity prefix and STOP tail cannot fit one GSM segment.
    // Pinned at 2 so any drift (better or worse) is surfaced; resolving the
    // finding (short-link route or a revised link-bearing client cap) is an
    // owner decision for Gate B — see the Gate A owner report.
    const reminder = COMMUNICATION_TEMPLATES.client_appointment_reminder!;
    for (const variables of reminder.worstCaseVariables) {
      expect(calculateSmsSegments(reminder.render(variables)).segments).toBe(2);
    }
    const violations = validateTemplateSegments();

    expect(violations.length).toBe(reminder.worstCaseVariables.length);
  });
});

describe('GSM-unrepresentable salon names', () => {
  it('falls back to the platform identity instead of sending an anonymous message', () => {
    expect(buildClientSmsPrefix('美甲沙龍')).toBe('Luster: ');

    const confirmation = COMMUNICATION_TEMPLATES.client_booking_confirmation_nolink!;
    const body = confirmation.render({ salonName: '美甲沙龍', startTime: 'Wed Aug 26, 2:30 PM' });

    expect(body).toMatch(/^Luster: /);
    expect(body.startsWith(' ')).toBe(false);
    expect(isGsmCompatible(body)).toBe(true);
  });
});

describe('ADVANCED_OPT_OUT_COPY', () => {
  it('tells the recipient their appointment was NOT cancelled, in one GSM segment', () => {
    expect(ADVANCED_OPT_OUT_COPY.stopConfirmation).toContain('was not cancelled');
    expect(calculateSmsSegments(ADVANCED_OPT_OUT_COPY.stopConfirmation)).toMatchObject({ encoding: 'gsm7', segments: 1 });
    expect(calculateSmsSegments(ADVANCED_OPT_OUT_COPY.helpResponse)).toMatchObject({ encoding: 'gsm7', segments: 1 });
  });
});

describe('SHARED_SENDER_STOP_DISCLOSURE (§10.2 — owner-ratified 2026-08-17)', () => {
  it('is BYTE-EXACTLY the owner-approved wording; any drift requires a fresh sign-off', () => {
    expect(SHARED_SENDER_STOP_DISCLOSURE).toBe(
      'Appointment texts are sent through Luster\'s shared messaging number. '
      + 'Reply STOP to stop appointment texts sent through this number, including '
      + 'texts from other businesses using Luster. Reply START to resubscribe. '
      + 'Stopping texts does not cancel your appointments.',
    );
  });

  it('discloses the cross-business effect, the restore path, and opt-out\u2260cancellation', () => {
    expect(SHARED_SENDER_STOP_DISCLOSURE).toContain('including texts from other businesses using Luster');
    expect(SHARED_SENDER_STOP_DISCLOSURE).toContain('Reply START to resubscribe');
    expect(SHARED_SENDER_STOP_DISCLOSURE).toContain('does not cancel your appointments');
  });
});

describe('buildClientSmsPrefix', () => {
  it('caps the prefix so long names cannot silently consume the message budget', () => {
    const prefix = buildClientSmsPrefix('Extraordinary Beauty Lounge and Nail Atelier Deluxe');

    expect(calculateSmsSegments(prefix).billableUnits)
      .toBeLessThanOrEqual(SALON_NAME_MAX_SEPTETS + ' via Luster: '.length);
  });
});
