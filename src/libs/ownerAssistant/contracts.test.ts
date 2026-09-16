/**
 * The tool JSON schemas the model is given and the zod schemas the server
 * validates with are two statements of one contract. Nothing enforces that
 * they agree at runtime, so this suite does: a sample that satisfies one must
 * satisfy the other, and strict mode's structural requirements (every property
 * required, no extras) are pinned so a future edit cannot quietly relax them.
 */
import { describe, expect, it } from 'vitest';

import {
  ASSISTANT_ANSWER_JSON_SCHEMA,
  assistantAnswerSchema,
  chatRequestSchema,
  conversationPayloadSchema,
  OWNER_ASSISTANT_LIMITS,
  OWNER_ASSISTANT_TOOL_ARG_SCHEMAS,
  OWNER_ASSISTANT_TOOL_DEFINITIONS,
  OWNER_ASSISTANT_TOOL_LABELS,
  OWNER_ASSISTANT_TOOL_NAMES,
} from './contracts';

const SAMPLE_ARGUMENTS: Record<string, unknown> = {
  get_salon_overview: {},
  list_services: { includeInactive: false },
  find_destination: { query: 'logo' },
  diagnose_day_availability: { date: 'friday', serviceName: null, technicianName: null },
  get_setup_readiness: {},
};

describe('tool definitions and zod argument schemas agree', () => {
  it('defines exactly the known tool names, once each', () => {
    expect(OWNER_ASSISTANT_TOOL_DEFINITIONS.map(tool => tool.name).sort())
      .toEqual([...OWNER_ASSISTANT_TOOL_NAMES].sort());
    expect(Object.keys(OWNER_ASSISTANT_TOOL_ARG_SCHEMAS).sort())
      .toEqual([...OWNER_ASSISTANT_TOOL_NAMES].sort());
    expect(Object.keys(OWNER_ASSISTANT_TOOL_LABELS).sort())
      .toEqual([...OWNER_ASSISTANT_TOOL_NAMES].sort());
  });

  it.each(OWNER_ASSISTANT_TOOL_DEFINITIONS)('$name is a strict function tool', (tool) => {
    expect(tool.type).toBe('function');
    expect(tool.strict).toBe(true);
    expect(tool.parameters.type).toBe('object');
    expect(tool.parameters.additionalProperties).toBe(false);
    // Strict mode requires EVERY declared property to be listed as required.
    expect([...tool.parameters.required].sort())
      .toEqual(Object.keys(tool.parameters.properties).sort());
    expect(tool.description.length).toBeGreaterThan(20);
  });

  it.each(OWNER_ASSISTANT_TOOL_NAMES)('%s parses its sample under the zod twin', (name) => {
    const definition = OWNER_ASSISTANT_TOOL_DEFINITIONS.find(tool => tool.name === name);
    const sample = SAMPLE_ARGUMENTS[name];

    expect(definition).toBeDefined();
    // Every JSON-schema-required key is present in the sample, and the sample
    // validates under zod — the two directions of the same agreement.
    expect(Object.keys(sample as object).sort())
      .toEqual([...(definition?.parameters.required ?? [])].sort());
    expect(OWNER_ASSISTANT_TOOL_ARG_SCHEMAS[name].safeParse(sample).success).toBe(true);
  });

  it('rejects unknown argument keys on every tool (strict zod)', () => {
    for (const name of OWNER_ASSISTANT_TOOL_NAMES) {
      const withExtra = { ...(SAMPLE_ARGUMENTS[name] as object), salonId: 'other_salon' };

      expect(OWNER_ASSISTANT_TOOL_ARG_SCHEMAS[name].safeParse(withExtra).success, name).toBe(false);
    }
  });

  it('rejects a wrong-typed argument', () => {
    expect(OWNER_ASSISTANT_TOOL_ARG_SCHEMAS.list_services.safeParse({ includeInactive: 'yes' }).success).toBe(false);
    expect(OWNER_ASSISTANT_TOOL_ARG_SCHEMAS.find_destination.safeParse({ query: '' }).success).toBe(false);
  });

  it('declares the nullable diagnosis arguments as nullable to the model too', () => {
    const definition = OWNER_ASSISTANT_TOOL_DEFINITIONS
      .find(tool => tool.name === 'diagnose_day_availability');
    const properties = definition?.parameters.properties as Record<string, { type: unknown }>;

    // Strict mode has no `optional`: an argument the model may omit has to be
    // declared as explicitly nullable, matching `.nullable()` on the zod twin.
    expect(properties.serviceName?.type).toEqual(['string', 'null']);
    expect(properties.technicianName?.type).toEqual(['string', 'null']);
    expect(properties.date?.type).toBe('string');
  });

  it('holds the diagnosis date to a length a day name can actually have', () => {
    const schema = OWNER_ASSISTANT_TOOL_ARG_SCHEMAS.diagnose_day_availability;
    const valid = { date: '2026-03-06', serviceName: null, technicianName: null };

    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, date: 'no' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, date: 'a'.repeat(33) }).success).toBe(false);
    expect(schema.safeParse({ ...valid, serviceName: 'a'.repeat(161) }).success).toBe(false);
    expect(schema.safeParse({ ...valid, technicianName: 'a'.repeat(121) }).success).toBe(false);
    // Trimmed, so a name the owner typed with stray spaces still matches.
    expect(schema.safeParse({ ...valid, serviceName: '  Gel manicure  ' }))
      .toMatchObject({ success: true, data: { serviceName: 'Gel manicure' } });
  });
});

describe('assistant answer schema', () => {
  const valid = { message: 'You offer 4 services.', links: [], followUps: [], needsClarification: false };

  it('accepts a well-formed answer', () => {
    expect(assistantAnswerSchema.safeParse(valid).success).toBe(true);
  });

  it('matches its JSON-schema twin structurally', () => {
    expect(ASSISTANT_ANSWER_JSON_SCHEMA.additionalProperties).toBe(false);
    expect([...ASSISTANT_ANSWER_JSON_SCHEMA.required].sort())
      .toEqual(Object.keys(ASSISTANT_ANSWER_JSON_SCHEMA.properties).sort());
    expect([...ASSISTANT_ANSWER_JSON_SCHEMA.required].sort()).toEqual(Object.keys(valid).sort());
  });

  it.each([
    { ...valid, message: '' },
    { ...valid, extra: true },
    { ...valid, links: [{ key: 'a', href: '/en/admin' }] },
    { ...valid, links: Array.from({ length: 5 }, () => ({ key: 'services' })) },
    { ...valid, followUps: ['a', 'b', 'c', 'd'] },
    { ...valid, needsClarification: 'no' },
  ])('rejects a malformed answer: %j', (candidate) => {
    expect(assistantAnswerSchema.safeParse(candidate).success).toBe(false);
  });

  it('refuses a model-supplied href: links carry a key only', () => {
    const parsed = assistantAnswerSchema.safeParse({ ...valid, links: [{ key: 'page_gallery' }] });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.links[0]).toEqual({ key: 'page_gallery' });
  });
});

describe('http contracts', () => {
  it('requires a non-empty salonSlug and message', () => {
    expect(chatRequestSchema.safeParse({ salonSlug: '', message: 'hi' }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ salonSlug: 'isla', message: '  ' }).success).toBe(false);
    expect(chatRequestSchema.safeParse({ salonSlug: 'isla', message: 'hi' }).success).toBe(true);
  });

  it('rejects extra body keys, so a client cannot smuggle a salonId', () => {
    expect(chatRequestSchema.safeParse({ salonSlug: 'isla', message: 'hi', salonId: 'salon_x' }).success).toBe(false);
  });

  it('caps the owner message at the documented length', () => {
    const atCap = 'a'.repeat(OWNER_ASSISTANT_LIMITS.messageMaxChars);

    expect(chatRequestSchema.safeParse({ salonSlug: 'isla', message: atCap }).success).toBe(true);
    expect(chatRequestSchema.safeParse({ salonSlug: 'isla', message: `${atCap}a` }).success).toBe(false);
  });

  it('caps the signed window at the documented message count', () => {
    const turns = Array.from({ length: OWNER_ASSISTANT_LIMITS.conversationMaxMessages + 1 }, () => ({
      role: 'user' as const,
      content: 'hi',
    }));

    expect(conversationPayloadSchema.safeParse({
      v: 1,
      cid: 'abcdefgh',
      salonId: 'salon_1',
      adminId: 'admin_1',
      iat: 0,
      exp: 1,
      turnCount: 0,
      turns,
    }).success).toBe(false);
  });
});
