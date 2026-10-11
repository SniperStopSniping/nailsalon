import { PGlite } from '@electric-sql/pglite';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type LifecycleSqlHandle,
  resolveCanonicalSalonClientIdentityOutcomeWithHandle,
} from './clientLifecycleStabilization';

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({
  db: new Proxy({}, {
    get() {
      throw new Error('Application database access is forbidden in this isolated test.');
    },
  }),
}));

let database: PGlite;
const dialect = new PgDialect();
const handle: LifecycleSqlHandle = {
  async execute(query) {
    const statement = dialect.sqlToQuery(query);

    expect(statement.sql).toMatch(/^\s*(?:select|with recursive)\b/i);

    return database.query(statement.sql, statement.params);
  },
};

beforeAll(async () => {
  database = new PGlite();
  await database.exec(`
    create table salon_client (
      id text primary key, salon_id text not null, phone text,
      email text, client_id text, merged_into_client_id text,
      archived_at timestamptz
    );
    create table salon_client_contact_alias (
      salon_id text, salon_client_id text, kind text, normalized_value text
    );
  `);
}, 20_000);

beforeEach(async () => {
  await database.exec('truncate salon_client_contact_alias, salon_client');
  await addClient('person_a', '4165550101', 'household@example.com');
});

afterAll(async () => {
  await database.close();
});

function addClient(id: string, phone: string, email: string, salonId = 'salon_a') {
  return database.query(
    'insert into salon_client (id, salon_id, phone, email) values ($1, $2, $3, $4)',
    [id, salonId, phone, email],
  );
}

function resolveBooking(phone?: string, email?: string, salonId = 'salon_a') {
  return resolveCanonicalSalonClientIdentityOutcomeWithHandle(handle, {
    salonId,
    phone,
    email,
    matchMode: 'booking',
  });
}

describe('booking client identity with real isolated SQL', () => {
  it('does not attach a new phone to another person by shared email alone', async () => {
    await expect(resolveBooking('4165550102', 'household@example.com'))
      .resolves.toEqual({ status: 'zero_identity_candidates' });
  });

  it('resolves each household member by their phone when both share an email', async () => {
    await addClient('person_b', '4165550102', 'household@example.com');
    for (const [id, phone] of [['person_a', '4165550101'], ['person_b', '4165550102']]) {
      await expect(resolveBooking(phone, 'HOUSEHOLD@example.com')).resolves.toMatchObject({
        status: 'resolved_terminal',
        identity: {
          terminal: { id, phone, email: 'household@example.com' },
          matchedBy: [
            { kind: 'email', value: 'household@example.com' },
            { kind: 'phone', value: phone },
          ],
        },
      });
    }
  });

  it('resolves an existing exact contact pair without changing stored data', async () => {
    await expect(resolveBooking('+1 (416) 555-0101', 'household@example.com')).resolves.toMatchObject({
      status: 'resolved_terminal',
      identity: { terminal: { id: 'person_a', phone: '4165550101' } },
    });
    expect((await database.query('select id, phone, email from salon_client')).rows).toEqual([
      { id: 'person_a', phone: '4165550101', email: 'household@example.com' },
    ]);
  });

  it('still rejects a phone and unrelated email that identify different people', async () => {
    await addClient('person_b', '4165550102', 'unrelated@example.com');

    await expect(resolveBooking('4165550101', 'unrelated@example.com')).resolves.toEqual({
      status: 'invalid_or_ambiguous_identity',
      reason: 'INVALID_CLIENT_STATE',
    });
  });

  it('keeps phone matching for an unknown email without editing the saved contact', async () => {
    await expect(resolveBooking('4165550101', 'changed@example.com')).resolves.toMatchObject({
      status: 'resolved_terminal',
      identity: {
        terminal: { id: 'person_a', phone: '4165550101', email: 'household@example.com' },
        matchedBy: [{ kind: 'phone', value: '4165550101' }],
      },
    });
  });

  it('never takes a matching contact from another salon', async () => {
    await expect(resolveBooking('4165550101', 'household@example.com', 'salon_b'))
      .resolves.toEqual({ status: 'zero_identity_candidates' });
  });

  it('preserves strict ambiguity protection for callers outside booking', async () => {
    await addClient('person_b', '4165550102', 'household@example.com');

    await expect(resolveCanonicalSalonClientIdentityOutcomeWithHandle(handle, {
      salonId: 'salon_a',
      phone: '4165550101',
      email: 'household@example.com',
    })).resolves.toEqual({ status: 'invalid_or_ambiguous_identity', reason: 'INVALID_CLIENT_STATE' });
  });

  it('preserves an established merged lineage and its current operational phone', async () => {
    await addClient('person_b', '4165550102', 'household@example.com');
    await addClient('old_a', '4165550199', 'old-a@example.com');
    await database.query('update salon_client set merged_into_client_id = $1, archived_at = now() where id = $2', ['person_a', 'old_a']);

    await expect(resolveBooking('4165550199', 'household@example.com')).resolves.toMatchObject({
      status: 'resolved_terminal',
      identity: { terminal: { id: 'person_a', phone: '4165550101' } },
    });
  });

  it('rejects a phone that ambiguously belongs to two terminal lineages', async () => {
    await addClient('person_b', '4165550102', 'other@example.com');
    await database.query('insert into salon_client_contact_alias values ($1, $2, $3, $4)', ['salon_a', 'person_b', 'phone', '4165550101']);

    await expect(resolveBooking('4165550101', 'household@example.com')).resolves.toEqual({
      status: 'invalid_or_ambiguous_identity',
      reason: 'INVALID_CLIENT_STATE',
    });
  });

  it('requires a phone for booking matching instead of using email as identity', async () => {
    await expect(resolveBooking(undefined, 'household@example.com')).resolves.toEqual({
      status: 'invalid_or_ambiguous_identity',
      reason: 'INVALID_CLIENT_STATE',
    });
  });

  it('preserves archived-client protection', async () => {
    await database.query('update salon_client set archived_at = now() where id = $1', ['person_a']);

    await expect(resolveBooking('4165550101', 'household@example.com')).resolves.toEqual({
      status: 'invalid_or_ambiguous_identity',
      reason: 'CLIENT_ARCHIVED',
    });
  });

  it('does not use a historical email alias to attach a different phone', async () => {
    await database.query('insert into salon_client_contact_alias values ($1, $2, $3, $4)', ['salon_a', 'person_a', 'email', 'old-household@example.com']);

    await expect(resolveBooking('4165550102', 'old-household@example.com'))
      .resolves.toEqual({ status: 'zero_identity_candidates' });
  });
});
