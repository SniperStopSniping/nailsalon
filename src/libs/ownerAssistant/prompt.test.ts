/**
 * The two fixed prompt texts are BYTE-STABLE by contract (`prompt.ts`): the
 * ledger's `promptFingerprint` identifies a prompt REVISION, so a date, a
 * salon fact or an environment value slipping into them would turn every turn
 * into a different prompt and make the evidence useless.
 *
 * The rules a tool depends on are pinned here too. `diagnose_day_availability`
 * promises the owner one fixed closing sentence and one fixed error sentence;
 * those are the assistant's words, not the tool's, so nothing else enforces
 * them.
 */
import { describe, expect, it } from 'vitest';

import {
  OWNER_ASSISTANT_DEVELOPER_RULES_TEXT,
  OWNER_ASSISTANT_LAST_CALL_TEXT,
  OWNER_ASSISTANT_SYSTEM_TEXT,
} from './prompt';

const FIXED_TEXTS = {
  system: OWNER_ASSISTANT_SYSTEM_TEXT,
  developerRules: OWNER_ASSISTANT_DEVELOPER_RULES_TEXT,
  lastCall: OWNER_ASSISTANT_LAST_CALL_TEXT,
};

describe('fixed prompt texts', () => {
  it.each(Object.entries(FIXED_TEXTS))('%s carries no date, year or clock time', (_name, text) => {
    // Any digit at all: there is no legitimate number in these texts, and a
    // year, a date or a time would all be caught by the same rule.
    expect(text).not.toMatch(/\d/);
  });

  it.each(Object.entries(FIXED_TEXTS))('%s is non-empty and plain', (_name, text) => {
    expect(text.length).toBeGreaterThan(40);
    expect(text).not.toContain('http');
  });
});

describe('the rules the availability diagnosis depends on', () => {
  it('pins the sentence every availability answer must end with', () => {
    expect(OWNER_ASSISTANT_DEVELOPER_RULES_TEXT)
      .toContain('End the answer with this exact sentence: Same availability rules as your booking page.');
  });

  it('pins the sentence a broken booking page must add', () => {
    expect(OWNER_ASSISTANT_DEVELOPER_RULES_TEXT)
      .toContain('Your booking page is showing an error for this day right now.');
  });

  it('tells the model to ask before concluding on an ambiguous weekday', () => {
    expect(OWNER_ASSISTANT_DEVELOPER_RULES_TEXT).toContain('today_or_next');
    expect(OWNER_ASSISTANT_DEVELOPER_RULES_TEXT).toContain('today or next {weekday}?');
  });

  it('tells the model to hand a clarify back to the owner as a question', () => {
    expect(OWNER_ASSISTANT_DEVELOPER_RULES_TEXT)
      .toContain('list the options it returned and ask which one the owner means');
  });

  it('makes the resolved day something the owner can correct', () => {
    expect(OWNER_ASSISTANT_DEVELOPER_RULES_TEXT)
      .toContain('Always name the day you diagnosed out loud');
    // The example is spelled out in words on purpose: these texts may carry no
    // digits at all (see the byte-stability rule above).
    expect(OWNER_ASSISTANT_DEVELOPER_RULES_TEXT)
      .toContain('Friday the eighteenth of September');
  });

  it('gates "customers can book" on customersCanBookNow, not on the slot count', () => {
    expect(OWNER_ASSISTANT_DEVELOPER_RULES_TEXT)
      .toContain('If customersCanBookNow is true, lead with bookableSlotCount and firstBookable');
    expect(OWNER_ASSISTANT_DEVELOPER_RULES_TEXT)
      .toContain('never tell the owner that customers can book it, whatever bookableSlotCount says');
  });

  it('forbids reporting an unmeasured day as a number', () => {
    expect(OWNER_ASSISTANT_DEVELOPER_RULES_TEXT)
      .toContain('If bookableSlotCount is null, the day was not measured at all');
    expect(OWNER_ASSISTANT_DEVELOPER_RULES_TEXT)
      .toContain('Never report it as a number, and never call it zero.');
  });

  it('pins what a page that serves nobody must be told as', () => {
    expect(OWNER_ASSISTANT_DEVELOPER_RULES_TEXT)
      .toContain('If publicRouteState is "unreachable", the booking page is serving nobody at all right now');
  });

  it('gives the unsupported timezone its own honest answer', () => {
    expect(OWNER_ASSISTANT_DEVELOPER_RULES_TEXT)
      .toContain('A cause of timezone_unsupported means this check does not support the salon\'s timezone yet');
    expect(OWNER_ASSISTANT_DEVELOPER_RULES_TEXT)
      .toContain('point the owner at their own calendar instead');
  });
});

describe('the rules the setup readiness answer depends on', () => {
  it('orders the answer by severity and forbids inventing a step', () => {
    expect(OWNER_ASSISTANT_DEVELOPER_RULES_TEXT)
      .toContain('required items first, then the recommended ones');
    expect(OWNER_ASSISTANT_DEVELOPER_RULES_TEXT)
      .toContain('never invent a step the tool did not return');
  });

  it('keeps an unpublished salon from being described as what customers see', () => {
    expect(OWNER_ASSISTANT_DEVELOPER_RULES_TEXT).toContain('side of "draft"');
  });
});
