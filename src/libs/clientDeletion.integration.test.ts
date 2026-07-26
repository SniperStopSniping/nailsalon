import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { sql } from 'drizzle-orm';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import pg from 'pg';
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  archiveSalonClient,
  canonicalizeClientVersionToken,
  ClientDeletionError,
  getPermanentDeleteEligibility,
  permanentlyDeleteSalonClient,
} from './clientDeletion';
import type { LifecycleSqlHandle } from './clientLifecycleStabilization';

vi.mock('server-only', () => ({}));

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/libs/DB', () => ({
  get db() {
    return holder.db;
  },
}));

const { Client, Pool } = pg;
const MIGRATIONS_FOLDER = path.join(process.cwd(), 'migrations');
const ACTOR_ID = 'admin_client_deletion_test';
const PORTABLE_SALON_ID = 'client-deletion-portable-salon';

type Queryable = LifecycleSqlHandle;

function rows(result: unknown): Record<string, unknown>[] {
  const resultWithRows = result as { rows?: Record<string, unknown>[] };
  if (Array.isArray(resultWithRows?.rows)) {
    return resultWithRows.rows;
  }
  return Array.isArray(result) ? result as Record<string, unknown>[] : [];
}

async function seedSalon(
  handle: Queryable,
  salonId: string,
): Promise<void> {
  await handle.execute(sql`
    insert into salon (id, name, slug, theme_key)
    values (
      ${salonId},
      'Client deletion test salon',
      ${`slug-${salonId}`},
      'minimal'
    )
  `);
}

async function seedClient(
  handle: Queryable,
  input: {
    salonId: string;
    clientId: string;
    phone: string;
    email?: string | null;
    archived?: boolean;
  },
): Promise<string> {
  await handle.execute(sql`
    insert into salon_client (
      id,
      salon_id,
      phone,
      full_name,
      email,
      archived_at,
      archived_by,
      created_at,
      updated_at
    )
    values (
      ${input.clientId},
      ${input.salonId},
      ${input.phone},
      'Accidental profile',
      ${input.email ?? null},
      ${input.archived ? new Date('2026-07-20T10:00:00.000Z') : null},
      ${input.archived ? ACTOR_ID : null},
      ${new Date('2026-07-20T09:00:00.000Z')},
      ${new Date('2026-07-20T09:00:00.000Z')}
    )
  `);
  return loadVersion(handle, input.clientId);
}

async function loadVersion(
  handle: Queryable,
  clientId: string,
): Promise<string> {
  const result = await handle.execute(sql`
    select to_char(
      updated_at,
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'
    ) as version
    from salon_client
    where id = ${clientId}
  `);
  const version = rows(result)[0]?.version;
  if (typeof version !== 'string') {
    throw new TypeError(`Missing client version for ${clientId}`);
  }
  return version;
}

async function expectDeletionError(
  promise: Promise<unknown>,
  code: ClientDeletionError['code'],
): Promise<ClientDeletionError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ClientDeletionError);
    expect((error as ClientDeletionError).code).toBe(code);

    return error as ClientDeletionError;
  }
  throw new Error(`Expected client deletion error ${code}`);
}

async function seedAppointment(
  handle: Queryable,
  input: {
    id: string;
    salonId: string;
    clientId: string;
    phone: string;
    status: string;
    startTime: Date;
  },
): Promise<void> {
  await handle.execute(sql`
    insert into appointment (
      id,
      salon_id,
      client_phone,
      salon_client_id,
      start_time,
      end_time,
      status,
      total_price,
      total_duration_minutes,
      created_at,
      updated_at
    )
    values (
      ${input.id},
      ${input.salonId},
      ${input.phone},
      ${input.clientId},
      ${input.startTime},
      ${new Date(input.startTime.getTime() + 60 * 60 * 1000)},
      ${input.status},
      6500,
      60,
      now(),
      now()
    )
  `);
}

async function mergeSalonClientSource(
  handle: Queryable,
  input: {
    sourceClientId: string;
    terminalClientId: string;
  },
): Promise<void> {
  await handle.execute(sql.raw(
    'alter table salon_client disable trigger salon_client_enforce_merge_transition',
  ));
  try {
    await handle.execute(sql`
      update salon_client
      set
        archived_at = ${new Date('2026-07-20T11:00:00.000Z')},
        archived_by = ${ACTOR_ID},
        merged_into_client_id = ${input.terminalClientId},
        merged_at = ${new Date('2026-07-20T11:00:00.000Z')},
        merged_by = ${ACTOR_ID}
      where id = ${input.sourceClientId}
    `);
  } finally {
    await handle.execute(sql.raw(
      'alter table salon_client enable trigger salon_client_enforce_merge_transition',
    ));
  }
}

describe('client deletion portable transactional authority', () => {
  let client: PGlite;
  let testDb: ReturnType<typeof drizzlePglite>;

  beforeAll(async () => {
    client = new PGlite();
    await client.waitReady;
    testDb = drizzlePglite(client);
    await migratePglite(testDb, {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
    holder.db = testDb;
    await seedSalon(testDb, PORTABLE_SALON_ID);
  }, 60_000);

  afterAll(async () => {
    await client.close();
  });

  it('canonicalizes exact client versions to six UTC fractional digits', () => {
    expect(canonicalizeClientVersionToken(
      '2026-07-20T05:00:00.1234-04:00',
    )).toBe('2026-07-20T09:00:00.123400Z');
    expect(() => canonicalizeClientVersionToken('not-a-version'))
      .toThrow(TypeError);
  });

  it('archives once, preserves past history, and binds an identical retry', async () => {
    const clientId = 'portable-archive-client';
    const phone = '4165550101';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId,
      phone,
    });
    await seedAppointment(testDb, {
      id: 'portable-past-appointment',
      salonId: PORTABLE_SALON_ID,
      clientId,
      phone,
      status: 'completed',
      startTime: new Date('2026-07-01T14:00:00.000Z'),
    });

    const first = await archiveSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: clientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    });
    const retry = await archiveSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: clientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    });

    expect(first).toMatchObject({
      code: 'CLIENT_ARCHIVED',
      terminalClientId: clientId,
      idempotent: false,
      redirectedFromStaleSource: false,
    });
    expect(retry).toEqual({
      code: 'CLIENT_ALREADY_ARCHIVED',
      terminalClientId: clientId,
      updatedAt: first.updatedAt,
      idempotent: true,
      redirectedFromStaleSource: false,
    });

    const state = await testDb.execute(sql`
      select
        (select count(*)::int from appointment
         where id = 'portable-past-appointment') as appointment_count,
        (select count(*)::int from audit_log
         where entity_id = ${clientId}
           and action = 'client_archived') as audit_count,
        (select archived_at is not null from salon_client
         where id = ${clientId}) as archived
    `);

    expect(rows(state)[0]).toMatchObject({
      appointment_count: 1,
      audit_count: 1,
      archived: true,
    });
    expect(JSON.stringify(rows(await testDb.execute(sql`
      select metadata
      from audit_log
      where entity_id = ${clientId}
    `)))).not.toContain(phone);
  });

  it('rejects archive with an active appointment and leaves no audit', async () => {
    const clientId = 'portable-active-client';
    const phone = '4165550102';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId,
      phone,
    });
    await seedAppointment(testDb, {
      id: 'portable-active-appointment',
      salonId: PORTABLE_SALON_ID,
      clientId,
      phone,
      status: 'confirmed',
      startTime: new Date('2026-08-01T14:00:00.000Z'),
    });

    await expectDeletionError(archiveSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: clientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    }), 'CLIENT_HAS_ACTIVE_APPOINTMENT');

    const state = await testDb.execute(sql`
      select
        (select archived_at from salon_client
         where id = ${clientId}) as archived_at,
        (select count(*)::int from audit_log
         where entity_id = ${clientId}) as audit_count
    `);

    expect(rows(state)[0]).toMatchObject({
      archived_at: null,
      audit_count: 0,
    });
  });

  it('archives a stale source while preserving linked global identity, session, and snapshots', async () => {
    const terminalClientId = 'portable-stale-terminal';
    const sourceClientId = 'portable-stale-source';
    const terminalPhone = '4165550106';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId: terminalClientId,
      phone: terminalPhone,
      email: 'terminal.snapshot@example.invalid',
    });
    await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId: sourceClientId,
      phone: '4165550107',
    });
    await testDb.execute(sql`
      insert into client (id, phone, first_name, created_at, updated_at)
      values (
        'portable-stale-global',
        ${`+1${terminalPhone}`},
        'Global snapshot',
        now(),
        now()
      )
    `);
    await testDb.execute(sql`
      update salon_client
      set client_id = 'portable-stale-global'
      where id = ${terminalClientId}
    `);
    await testDb.execute(sql`
      insert into client_session (
        id,
        client_phone,
        expires_at,
        created_at
      )
      values (
        'portable-stale-session',
        ${`+1${terminalPhone}`},
        now() + interval '1 day',
        now()
      )
    `);
    await mergeSalonClientSource(testDb, {
      sourceClientId,
      terminalClientId,
    });
    await seedAppointment(testDb, {
      id: 'portable-stale-past-appointment',
      salonId: PORTABLE_SALON_ID,
      clientId: sourceClientId,
      phone: '4165550107',
      status: 'completed',
      startTime: new Date('2026-06-01T14:00:00.000Z'),
    });
    const before = rows(await testDb.execute(sql`
      select
        (select to_jsonb(source_row) from salon_client as source_row
         where id = ${sourceClientId}) as source_snapshot,
        (select to_jsonb(global_row) from client as global_row
         where id = 'portable-stale-global') as global_snapshot,
        (select to_jsonb(session_row) from client_session as session_row
         where id = 'portable-stale-session') as session_snapshot,
        (select to_jsonb(appointment_row) from appointment as appointment_row
         where id = 'portable-stale-past-appointment') as appointment_snapshot
    `))[0]!;

    const result = await archiveSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: sourceClientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    });

    expect(result).toMatchObject({
      code: 'CLIENT_ARCHIVED',
      terminalClientId,
      redirectedFromStaleSource: true,
      idempotent: false,
    });
    expect(result.updatedAt > expectedUpdatedAt).toBe(true);

    const after = rows(await testDb.execute(sql`
      select
        (select to_jsonb(source_row) from salon_client as source_row
         where id = ${sourceClientId}) as source_snapshot,
        (select to_jsonb(global_row) from client as global_row
         where id = 'portable-stale-global') as global_snapshot,
        (select to_jsonb(session_row) from client_session as session_row
         where id = 'portable-stale-session') as session_snapshot,
        (select to_jsonb(appointment_row) from appointment as appointment_row
         where id = 'portable-stale-past-appointment') as appointment_snapshot
    `))[0]!;

    expect(after).toEqual(before);
  });

  it('rejects stale archive CAS and leaves the terminal unchanged', async () => {
    const clientId = 'portable-stale-cas-client';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId,
      phone: '4165550108',
    });
    await testDb.execute(sql`
      update salon_client
      set updated_at = updated_at + interval '1 microsecond'
      where id = ${clientId}
    `);

    await expectDeletionError(archiveSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: clientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    }), 'CLIENT_ARCHIVE_CONFLICT');
    const state = rows(await testDb.execute(sql`
      select archived_at,
        (select count(*)::int from audit_log
         where entity_id = ${clientId}) as audit_count
      from salon_client
      where id = ${clientId}
    `))[0];

    expect(state).toMatchObject({
      archived_at: null,
      audit_count: 0,
    });
  });

  it('fails archive closed for a lineage with multiple global identities', async () => {
    const terminalClientId = 'portable-ambiguous-terminal';
    const sourceClientId = 'portable-ambiguous-source';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId: terminalClientId,
      phone: '4165550109',
    });
    await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId: sourceClientId,
      phone: '4165550110',
    });
    await testDb.execute(sql`
      insert into client (id, phone, created_at, updated_at)
      values
        ('portable-ambiguous-global-a', '+14165550109', now(), now()),
        ('portable-ambiguous-global-b', '+14165550110', now(), now())
    `);
    await testDb.execute(sql`
      update salon_client
      set client_id = case
        when id = ${terminalClientId} then 'portable-ambiguous-global-a'
        else 'portable-ambiguous-global-b'
      end
      where id in (${terminalClientId}, ${sourceClientId})
    `);
    await mergeSalonClientSource(testDb, {
      sourceClientId,
      terminalClientId,
    });

    await expectDeletionError(archiveSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: sourceClientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    }), 'UNSUPPORTED_CLIENT_IDENTITY');

    expect(rows(await testDb.execute(sql`
      select archived_at
      from salon_client
      where id = ${terminalClientId}
    `))[0]?.archived_at).toBeNull();
  });

  it('permanently deletes an eligible direct profile with one durable audit', async () => {
    const clientId = 'portable-permanent-client';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId,
      phone: '4165550103',
      email: 'accidental@example.invalid',
    });

    await expect(getPermanentDeleteEligibility({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: clientId,
    })).resolves.toEqual({
      eligible: true,
      terminalClientId: clientId,
    });

    const first = await permanentlyDeleteSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: clientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    });
    const retry = await permanentlyDeleteSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: clientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    });

    expect(first).toEqual({
      code: 'CLIENT_PERMANENTLY_DELETED',
      terminalClientId: clientId,
      idempotent: false,
    });
    expect(retry).toEqual({
      code: 'CLIENT_PERMANENTLY_DELETED',
      terminalClientId: clientId,
      idempotent: true,
    });

    await expectDeletionError(permanentlyDeleteSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: clientId,
      expectedUpdatedAt: '2026-07-20T09:00:00.000001Z',
      actorAdminId: ACTOR_ID,
    }), 'CLIENT_NOT_FOUND');

    const state = await testDb.execute(sql`
      select
        (select count(*)::int from salon_client
         where id = ${clientId}) as client_count,
        (select count(*)::int from audit_log
         where entity_id = ${clientId}
           and action = 'client_permanently_deleted') as audit_count
    `);

    expect(rows(state)[0]).toMatchObject({
      client_count: 0,
      audit_count: 1,
    });
    expect(JSON.stringify(rows(await testDb.execute(sql`
      select actor_phone, metadata
      from audit_log
      where entity_id = ${clientId}
    `)))).not.toContain('accidental@example.invalid');
  });

  it('rejects hidden history without disclosing its source or partial cleanup', async () => {
    const clientId = 'portable-history-client';
    const phone = '4165550104';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId,
      phone,
    });
    await testDb.execute(sql`
      insert into reward (
        id,
        salon_id,
        client_phone,
        type,
        points,
        status,
        created_at,
        updated_at
      )
      values (
        'portable-history-reward',
        ${PORTABLE_SALON_ID},
        ${phone},
        'referral_referrer',
        0,
        'expired',
        now(),
        now()
      )
    `);

    const error = await expectDeletionError(permanentlyDeleteSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: clientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    }), 'CLIENT_PERMANENT_DELETE_NOT_ALLOWED');

    expect(error.message).toBe(
      'This client has history and can’t be permanently deleted. Delete them from the active list instead.',
    );
    expect(error.message).not.toMatch(/reward|phone/i);

    const state = await testDb.execute(sql`
      select
        (select count(*)::int from salon_client
         where id = ${clientId}) as client_count,
        (select count(*)::int from reward
         where id = 'portable-history-reward') as reward_count,
        (select count(*)::int from audit_log
         where entity_id = ${clientId}) as audit_count
    `);

    expect(rows(state)[0]).toMatchObject({
      client_count: 1,
      reward_count: 1,
      audit_count: 0,
    });
  });

  it('rejects external identity/session history without deleting global rows', async () => {
    const clientId = 'portable-global-client';
    const phone = '4165550105';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId,
      phone,
    });
    await testDb.execute(sql`
      insert into client (id, phone, created_at, updated_at)
      values ('portable-global-identity', ${`+1${phone}`}, now(), now())
    `);
    await testDb.execute(sql`
      insert into client_session (
        id,
        client_phone,
        expires_at,
        created_at
      )
      values (
        'portable-global-session',
        ${`+1${phone}`},
        now() + interval '1 day',
        now()
      )
    `);

    await expectDeletionError(permanentlyDeleteSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: clientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    }), 'CLIENT_PERMANENT_DELETE_NOT_ALLOWED');

    const state = await testDb.execute(sql`
      select
        (select count(*)::int from client
         where id = 'portable-global-identity') as global_count,
        (select count(*)::int from client_session
         where id = 'portable-global-session') as session_count,
        (select count(*)::int from salon_client
         where id = ${clientId}) as salon_client_count
    `);

    expect(rows(state)[0]).toMatchObject({
      global_count: 1,
      session_count: 1,
      salon_client_count: 1,
    });
  });

  it('allows one exact creation audit and keeps it beside the deletion tombstone', async () => {
    const clientId = 'portable-creation-audit-client';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId,
      phone: '4165550111',
    });
    await testDb.execute(sql`
      insert into audit_log (
        id,
        salon_id,
        actor_type,
        action,
        entity_type,
        entity_id,
        metadata
      )
      values (
        'portable-creation-audit',
        ${PORTABLE_SALON_ID},
        'system',
        'client_created',
        'salon_client',
        ${clientId},
        jsonb_build_object('terminalClientId', ${clientId}::text)
      )
    `);

    await expect(permanentlyDeleteSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: clientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    })).resolves.toMatchObject({
      code: 'CLIENT_PERMANENTLY_DELETED',
      idempotent: false,
    });
    expect(rows(await testDb.execute(sql`
      select count(*)::int as audit_count
      from audit_log
      where entity_id = ${clientId}
    `))[0]?.audit_count).toBe(2);
  });

  it('fails safely for missing, cross-salon, archived, and lost-CAS requests', async () => {
    const foreignSalonId = 'portable-foreign-delete-salon';
    await seedSalon(testDb, foreignSalonId);
    const foreignClientId = 'portable-foreign-delete-client';
    const foreignVersion = await seedClient(testDb, {
      salonId: foreignSalonId,
      clientId: foreignClientId,
      phone: '4165550112',
    });
    await expectDeletionError(permanentlyDeleteSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: foreignClientId,
      expectedUpdatedAt: foreignVersion,
      actorAdminId: ACTOR_ID,
    }), 'CLIENT_NOT_FOUND');
    await expectDeletionError(permanentlyDeleteSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: 'portable-random-missing-client',
      expectedUpdatedAt: foreignVersion,
      actorAdminId: ACTOR_ID,
    }), 'CLIENT_NOT_FOUND');

    const archivedClientId = 'portable-already-archived-delete';
    const archivedVersion = await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId: archivedClientId,
      phone: '4165550113',
      archived: true,
    });
    await expectDeletionError(permanentlyDeleteSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: archivedClientId,
      expectedUpdatedAt: archivedVersion,
      actorAdminId: ACTOR_ID,
    }), 'CLIENT_PERMANENT_DELETE_NOT_ALLOWED');

    const staleClientId = 'portable-permanent-stale-cas';
    const staleVersion = await seedClient(testDb, {
      salonId: PORTABLE_SALON_ID,
      clientId: staleClientId,
      phone: '4165550114',
    });
    await testDb.execute(sql`
      update salon_client
      set updated_at = updated_at + interval '1 microsecond'
      where id = ${staleClientId}
    `);
    await expectDeletionError(permanentlyDeleteSalonClient({
      salonId: PORTABLE_SALON_ID,
      requestedClientId: staleClientId,
      expectedUpdatedAt: staleVersion,
      actorAdminId: ACTOR_ID,
    }), 'CLIENT_ARCHIVE_CONFLICT');

    expect(rows(await testDb.execute(sql`
      select
        (select count(*)::int from salon_client
         where id = ${staleClientId}) as client_count,
        (select count(*)::int from audit_log
         where entity_id = ${staleClientId}) as audit_count
    `))[0]).toMatchObject({
      client_count: 1,
      audit_count: 0,
    });
  });

  const permanentHistoryCases: Array<{
    label: string;
    suffix: string;
    seedHistory: (
      clientId: string,
      phone: string,
    ) => Promise<void>;
  }> = [
    {
      label: 'an appointment of any status',
      suffix: 'appointment',
      seedHistory: async (clientId, phone) => {
        await seedAppointment(testDb, {
          id: 'history-any-status-appointment',
          salonId: PORTABLE_SALON_ID,
          clientId,
          phone,
          status: 'cancelled',
          startTime: new Date('2026-01-01T14:00:00.000Z'),
        });
        await testDb.execute(sql`
          update appointment
          set deleted_at = now()
          where id = 'history-any-status-appointment'
        `);
      },
    },
    {
      label: 'a direct client note',
      suffix: 'note',
      seedHistory: async (clientId) => {
        await testDb.execute(sql`
          insert into salon_client_note (
            id, salon_id, salon_client_id, body, created_by
          )
          values (
            'history-note',
            ${PORTABLE_SALON_ID},
            ${clientId},
            'meaningful history',
            ${ACTOR_ID}
          )
        `);
      },
    },
    {
      label: 'client communication',
      suffix: 'communication',
      seedHistory: async (clientId) => {
        await testDb.execute(sql`
          insert into client_communication (
            id,
            salon_id,
            salon_client_id,
            kind,
            status
          )
          values (
            'history-communication',
            ${PORTABLE_SALON_ID},
            ${clientId},
            'generic_text',
            'dismissed'
          )
        `);
      },
    },
    {
      label: 'retention or marketing history',
      suffix: 'retention',
      seedHistory: async (clientId) => {
        await testDb.execute(sql`
          insert into retention_campaign (
            id,
            salon_id,
            salon_client_id,
            token_hash,
            stage,
            promotion_snapshot,
            expires_at
          )
          values (
            'history-retention',
            ${PORTABLE_SALON_ID},
            ${clientId},
            'history-retention-token',
            'promo_6w',
            '{}'::jsonb,
            now() + interval '1 day'
          )
        `);
      },
    },
    {
      label: 'a contact alias',
      suffix: 'alias',
      seedHistory: async (clientId) => {
        await testDb.execute(sql`
          insert into salon_client_contact_alias (
            salon_id,
            salon_client_id,
            kind,
            normalized_value
          )
          values (
            ${PORTABLE_SALON_ID},
            ${clientId},
            'email',
            'history-alias@example.invalid'
          )
        `);
      },
    },
    {
      label: 'client preferences',
      suffix: 'preferences',
      seedHistory: async (_clientId, phone) => {
        await testDb.execute(sql`
          insert into client_preferences (
            id,
            salon_id,
            normalized_client_phone
          )
          values (
            'history-preferences',
            ${PORTABLE_SALON_ID},
            ${phone}
          )
        `);
      },
    },
    {
      label: 'communication consent history',
      suffix: 'consent',
      seedHistory: async (_clientId, phone) => {
        await testDb.execute(sql`
          insert into communication_consent (
            id,
            salon_id,
            recipient,
            channel,
            purpose,
            status,
            wording_version,
            source
          )
          values (
            'history-consent',
            ${PORTABLE_SALON_ID},
            ${phone},
            'sms',
            'appointment_transactional',
            'revoked',
            'v1',
            'test'
          )
        `);
      },
    },
    {
      label: 'reward history',
      suffix: 'reward',
      seedHistory: async (_clientId, phone) => {
        await testDb.execute(sql`
          insert into reward (
            id,
            salon_id,
            client_phone,
            type,
            points,
            status
          )
          values (
            'history-reward-case',
            ${PORTABLE_SALON_ID},
            ${phone},
            'referral_referrer',
            0,
            'expired'
          )
        `);
      },
    },
    {
      label: 'loyalty balance',
      suffix: 'loyalty',
      seedHistory: async (clientId) => {
        await testDb.execute(sql`
          update salon_client
          set loyalty_points = 1
          where id = ${clientId}
        `);
      },
    },
    {
      label: 'referrer history',
      suffix: 'referrer',
      seedHistory: async (_clientId, phone) => {
        await testDb.execute(sql`
          insert into referral (
            id,
            salon_id,
            referrer_phone,
            status
          )
          values (
            'history-referrer',
            ${PORTABLE_SALON_ID},
            ${phone},
            'sent'
          )
        `);
      },
    },
    {
      label: 'referee history',
      suffix: 'referee',
      seedHistory: async (_clientId, phone) => {
        await testDb.execute(sql`
          insert into referral (
            id,
            salon_id,
            referrer_phone,
            referee_phone,
            status
          )
          values (
            'history-referee',
            ${PORTABLE_SALON_ID},
            '6475559999',
            ${phone},
            'claimed'
          )
        `);
      },
    },
    {
      label: 'an admin flag',
      suffix: 'flag',
      seedHistory: async (clientId) => {
        await testDb.execute(sql`
          update salon_client
          set admin_flags = '{"isProblemClient":true}'::jsonb
          where id = ${clientId}
        `);
      },
    },
    {
      label: 'an active outbox payload reference',
      suffix: 'outbox',
      seedHistory: async (clientId) => {
        await testDb.execute(sql`
          insert into integration_outbox (
            id,
            salon_id,
            provider,
            operation,
            dedupe_key,
            payload,
            status
          )
          values (
            'history-outbox',
            ${PORTABLE_SALON_ID},
            'email',
            'send',
            'history:outbox',
            jsonb_build_object('terminalClientId', ${clientId}::text),
            'pending'
          )
        `);
      },
    },
    {
      label: 'an active notification dedupe reference',
      suffix: 'notification',
      seedHistory: async (clientId) => {
        await testDb.execute(sql`
          insert into notification_delivery (
            id,
            salon_id,
            channel,
            purpose,
            dedupe_key,
            status
          )
          values (
            'history-notification',
            ${PORTABLE_SALON_ID},
            'email',
            'client_test',
            ${`client:${clientId}`},
            'queued'
          )
        `);
      },
    },
    {
      label: 'audit actor identity',
      suffix: 'audit-actor',
      seedHistory: async (clientId) => {
        await testDb.execute(sql`
          insert into audit_log (
            id,
            salon_id,
            actor_type,
            actor_id,
            action
          )
          values (
            'history-audit-actor',
            ${PORTABLE_SALON_ID},
            'client',
            ${clientId},
            'unrelated_action'
          )
        `);
      },
    },
    {
      label: 'audit actor phone',
      suffix: 'audit-phone',
      seedHistory: async (_clientId, phone) => {
        await testDb.execute(sql`
          insert into audit_log (
            id,
            salon_id,
            actor_type,
            actor_phone,
            action
          )
          values (
            'history-audit-phone',
            ${PORTABLE_SALON_ID},
            'client',
            ${`+1${phone}`},
            'unrelated_action'
          )
        `);
      },
    },
    {
      label: 'audit metadata identity',
      suffix: 'audit-metadata',
      seedHistory: async (clientId) => {
        await testDb.execute(sql`
          insert into audit_log (
            id,
            salon_id,
            actor_type,
            action,
            metadata
          )
          values (
            'history-audit-metadata',
            ${PORTABLE_SALON_ID},
            'system',
            'unrelated_action',
            jsonb_build_object('sourceClientId', ${clientId}::text)
          )
        `);
      },
    },
    {
      label: 'the durable migration backup',
      suffix: 'backup',
      seedHistory: async (clientId) => {
        await testDb.execute(sql`
          insert into luster_migration_backup_0052_client_times (
            id,
            backed_up_at
          )
          values (${clientId}, now())
        `);
      },
    },
    {
      label: 'a merge descendant',
      suffix: 'merge',
      seedHistory: async (clientId) => {
        const sourceClientId = 'history-merge-source';
        await seedClient(testDb, {
          salonId: PORTABLE_SALON_ID,
          clientId: sourceClientId,
          phone: '6475559988',
        });
        await mergeSalonClientSource(testDb, {
          sourceClientId,
          terminalClientId: clientId,
        });
      },
    },
    {
      label: 'a review direct reference',
      suffix: 'review',
      seedHistory: async (clientId) => {
        const supportingClientId = 'history-review-support-client';
        const supportingPhone = '6475559987';
        await seedClient(testDb, {
          salonId: PORTABLE_SALON_ID,
          clientId: supportingClientId,
          phone: supportingPhone,
        });
        await seedAppointment(testDb, {
          id: 'history-review-support-appointment',
          salonId: PORTABLE_SALON_ID,
          clientId: supportingClientId,
          phone: supportingPhone,
          status: 'completed',
          startTime: new Date('2026-02-01T14:00:00.000Z'),
        });
        await testDb.execute(sql`
          insert into review (
            id,
            salon_id,
            appointment_id,
            salon_client_id,
            rating
          )
          values (
            'history-review',
            ${PORTABLE_SALON_ID},
            'history-review-support-appointment',
            ${clientId},
            5
          )
        `);
      },
    },
    {
      label: 'photo history keyed by contact',
      suffix: 'photo',
      seedHistory: async (_clientId, phone) => {
        const supportingClientId = 'history-photo-support-client';
        const supportingPhone = '6475559986';
        await seedClient(testDb, {
          salonId: PORTABLE_SALON_ID,
          clientId: supportingClientId,
          phone: supportingPhone,
        });
        await seedAppointment(testDb, {
          id: 'history-photo-support-appointment',
          salonId: PORTABLE_SALON_ID,
          clientId: supportingClientId,
          phone: supportingPhone,
          status: 'completed',
          startTime: new Date('2026-03-01T14:00:00.000Z'),
        });
        await testDb.execute(sql`
          insert into appointment_photo (
            id,
            appointment_id,
            salon_id,
            normalized_client_phone,
            photo_type,
            cloudinary_public_id,
            image_url
          )
          values (
            'history-photo',
            'history-photo-support-appointment',
            ${PORTABLE_SALON_ID},
            ${phone},
            'after',
            'history-photo-public-id',
            'https://example.invalid/history-photo.jpg'
          )
        `);
      },
    },
    {
      label: 'a malformed cross-tenant cascade child',
      suffix: 'cross-tenant-child',
      seedHistory: async (clientId) => {
        const childSalonId = 'history-cross-tenant-salon';
        await seedSalon(testDb, childSalonId);
        await testDb.execute(sql.raw(
          'alter table salon_client_contact_alias disable trigger salon_client_alias_resolve_merged_client',
        ));
        try {
          await testDb.execute(sql`
            insert into salon_client_contact_alias (
              salon_id,
              salon_client_id,
              kind,
              normalized_value
            )
            values (
              ${childSalonId},
              ${clientId},
              'email',
              'cross-tenant-child@example.invalid'
            )
          `);
        } finally {
          await testDb.execute(sql.raw(
            'alter table salon_client_contact_alias enable trigger salon_client_alias_resolve_merged_client',
          ));
        }
      },
    },
    {
      label: 'an active Google inbound writer',
      suffix: 'google-writer',
      seedHistory: async () => {
        await testDb.execute(sql`
          insert into salon_google_calendar_connection (
            salon_id,
            encrypted_refresh_token,
            status,
            inbound_sync_enabled
          )
          values (
            ${PORTABLE_SALON_ID},
            'encrypted-test-token',
            'active',
            true
          )
        `);
      },
    },
  ];

  it.each(permanentHistoryCases)(
    'rejects permanent delete for $label',
    async ({ suffix, seedHistory }) => {
      const caseIndex = permanentHistoryCases.findIndex(
        historyCase => historyCase.suffix === suffix,
      );
      const clientId = `portable-history-${suffix}`;
      const phone = `647555${String(1000 + caseIndex).slice(-4)}`;
      const expectedUpdatedAt = await seedClient(testDb, {
        salonId: PORTABLE_SALON_ID,
        clientId,
        phone,
      });
      await seedHistory(clientId, phone);

      await expectDeletionError(permanentlyDeleteSalonClient({
        salonId: PORTABLE_SALON_ID,
        requestedClientId: clientId,
        expectedUpdatedAt,
        actorAdminId: ACTOR_ID,
      }), 'CLIENT_PERMANENT_DELETE_NOT_ALLOWED');

      expect(rows(await testDb.execute(sql`
        select
          (select count(*)::int from salon_client
           where id = ${clientId}) as client_count,
          (select count(*)::int from audit_log
           where entity_id = ${clientId}
             and action = 'client_permanently_deleted') as deletion_audit_count
      `))[0]).toMatchObject({
        client_count: 1,
        deletion_audit_count: 0,
      });
    },
  );
});

const databaseUrl = process.env.CONCURRENCY_TEST_DATABASE_URL;
if (databaseUrl) {
  const hostname = new URL(databaseUrl).hostname;
  const isLoopback = hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1';
  if (
    !isLoopback
    || process.env.CLIENT_LIFECYCLE_DISPOSABLE_DATABASE_CONFIRMED !== 'true'
  ) {
    throw new Error(
      'Client deletion concurrency tests require an explicitly confirmed loopback disposable database.',
    );
  }
}
const describePostgres = databaseUrl ? describe : describe.skip;

async function waitForLockWait(
  observer: pg.Client,
  applicationName: string,
): Promise<void> {
  const deadline = performance.now() + 5_000;
  while (performance.now() < deadline) {
    const result = await observer.query<{ waiting: boolean }>(
      `select exists (
         select 1
         from pg_stat_activity
         where application_name = $1
           and wait_event_type = 'Lock'
       ) as waiting`,
      [applicationName],
    );
    if (result.rows[0]?.waiting) {
      return;
    }
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw new Error('Timed out waiting for deterministic PostgreSQL lock state.');
}

describePostgres('client deletion real PostgreSQL concurrency', () => {
  let pool: pg.Pool;
  let observer: pg.Client;
  let testDb: ReturnType<typeof drizzlePg>;
  const salonId = 'client-deletion-postgres-salon';

  beforeAll(async () => {
    pool = new Pool({
      connectionString: databaseUrl,
      application_name: 'client-deletion-library',
      max: 8,
    });
    observer = new Client({
      connectionString: databaseUrl,
      application_name: 'client-deletion-observer',
    });
    await observer.connect();
    await pool.query('drop schema if exists drizzle cascade');
    await pool.query('drop schema if exists public cascade');
    await pool.query('create schema public');
    testDb = drizzlePg(pool);
    await migratePg(testDb, {
      migrationsFolder: MIGRATIONS_FOLDER,
    });
    holder.db = testDb;
  }, 60_000);

  afterAll(async () => {
    await observer.end();
    await pool.end();
  });

  async function resetFixture(): Promise<void> {
    await pool.query(
      'truncate table audit_log, client_session, client, salon restart identity cascade',
    );
    await seedSalon(testDb, salonId);
  }

  it('serializes concurrent identical permanent deletions to one audit', async () => {
    await resetFixture();
    const clientId = 'postgres-concurrent-delete';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId,
      clientId,
      phone: '4165550201',
    });
    const request = {
      salonId,
      requestedClientId: clientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    };

    const results = await Promise.all([
      permanentlyDeleteSalonClient(request),
      permanentlyDeleteSalonClient(request),
    ]);

    expect(results.map(result => result.idempotent).sort())
      .toEqual([false, true]);

    const audit = await pool.query<{ count: number }>(
      `select count(*)::int as count
       from audit_log
       where entity_id = $1
         and action = 'client_permanently_deleted'`,
      [clientId],
    );

    expect(audit.rows[0]?.count).toBe(1);
  });

  it('serializes concurrent archive requests to one real mutation and audit', async () => {
    await resetFixture();
    const clientId = 'postgres-concurrent-archive';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId,
      clientId,
      phone: '4165550205',
    });
    const request = {
      salonId,
      requestedClientId: clientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    };

    const results = await Promise.all([
      archiveSalonClient(request),
      archiveSalonClient(request),
    ]);

    expect(results.map(result => result.code).sort()).toEqual([
      'CLIENT_ALREADY_ARCHIVED',
      'CLIENT_ARCHIVED',
    ]);
    expect(results.map(result => result.idempotent).sort())
      .toEqual([false, true]);

    const audit = await pool.query<{ count: number }>(
      `select count(*)::int as count
       from audit_log
       where entity_id = $1
         and action = 'client_archived'`,
      [clientId],
    );

    expect(audit.rows[0]?.count).toBe(1);
  });

  it('lets a booking win before archive and rejects without cancellation', async () => {
    await resetFixture();
    const clientId = 'postgres-booking-archive';
    const phone = '4165550202';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId,
      clientId,
      phone,
    });
    const writer = new Client({
      connectionString: databaseUrl,
      application_name: 'client-deletion-booking-writer',
    });
    await writer.connect();
    await writer.query('begin');
    await writer.query(
      'select id from salon_client where id = $1 for update',
      [clientId],
    );
    await writer.query(
      `insert into appointment (
         id, salon_id, client_phone, salon_client_id, start_time, end_time,
         status, total_price, total_duration_minutes, created_at, updated_at
       )
       values (
         'postgres-booking-archive-appointment', $1, $2, $3,
         now() + interval '1 day', now() + interval '1 day 1 hour',
         'confirmed', 6500, 60, now(), now()
       )`,
      [salonId, phone, clientId],
    );

    const archive = archiveSalonClient({
      salonId,
      requestedClientId: clientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    });
    await waitForLockWait(observer, 'client-deletion-library');
    await writer.query('commit');
    await writer.end();

    await expectDeletionError(
      archive,
      'CLIENT_HAS_ACTIVE_APPOINTMENT',
    );
    const state = await pool.query<{
      status: string;
      archived_at: Date | null;
      audit_count: number;
    }>(
      `select
         appointment.status,
         salon_client.archived_at,
         (select count(*)::int from audit_log
          where entity_id = $1) as audit_count
       from salon_client
       inner join appointment
         on appointment.salon_client_id = salon_client.id
       where salon_client.id = $1`,
      [clientId],
    );

    expect(state.rows[0]).toMatchObject({
      status: 'confirmed',
      archived_at: null,
      audit_count: 0,
    });
  });

  it('lets a booking win before permanent delete with no partial cleanup', async () => {
    await resetFixture();
    const clientId = 'postgres-booking-delete';
    const phone = '4165550206';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId,
      clientId,
      phone,
    });
    const writer = new Client({
      connectionString: databaseUrl,
      application_name: 'client-deletion-booking-delete-writer',
    });
    await writer.connect();
    await writer.query('begin');
    await writer.query(
      'select id from salon_client where id = $1 for update',
      [clientId],
    );
    await writer.query(
      `insert into appointment (
         id, salon_id, client_phone, salon_client_id, start_time, end_time,
         status, total_price, total_duration_minutes, created_at, updated_at
       )
       values (
         'postgres-booking-delete-appointment', $1, $2, $3,
         now() + interval '1 day', now() + interval '1 day 1 hour',
         'confirmed', 6500, 60, now(), now()
       )`,
      [salonId, phone, clientId],
    );

    const deletion = permanentlyDeleteSalonClient({
      salonId,
      requestedClientId: clientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    });
    await waitForLockWait(observer, 'client-deletion-library');
    await writer.query('commit');
    await writer.end();

    await expectDeletionError(
      deletion,
      'CLIENT_PERMANENT_DELETE_NOT_ALLOWED',
    );
    const state = await pool.query<{
      appointment_count: number;
      client_count: number;
      audit_count: number;
    }>(
      `select
         (select count(*)::int from appointment
          where id = 'postgres-booking-delete-appointment')
            as appointment_count,
         (select count(*)::int from salon_client
          where id = $1) as client_count,
         (select count(*)::int from audit_log
          where entity_id = $1) as audit_count`,
      [clientId],
    );

    expect(state.rows[0]).toEqual({
      appointment_count: 1,
      client_count: 1,
      audit_count: 0,
    });
  });

  it('lets a direct phone-history writer win the tenant gate without deadlock', async () => {
    await resetFixture();
    const clientId = 'postgres-history-writer-delete';
    const phone = '4165550207';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId,
      clientId,
      phone,
    });
    const writer = new Client({
      connectionString: databaseUrl,
      application_name: 'client-deletion-history-writer',
    });
    await writer.connect();
    await writer.query('begin');
    await writer.query(
      `insert into reward (
         id, salon_id, client_phone, type, points, status
       )
       values (
         'postgres-history-writer-reward',
         $1,
         $2,
         'referral_referrer',
         0,
         'expired'
       )`,
      [salonId, phone],
    );

    const deletion = permanentlyDeleteSalonClient({
      salonId,
      requestedClientId: clientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    });
    await waitForLockWait(observer, 'client-deletion-library');
    await writer.query('commit');
    await writer.end();

    await expectDeletionError(
      deletion,
      'CLIENT_PERMANENT_DELETE_NOT_ALLOWED',
    );
    const state = await pool.query<{
      client_count: number;
      reward_count: number;
      audit_count: number;
    }>(
      `select
         (select count(*)::int from salon_client
          where id = $1) as client_count,
         (select count(*)::int from reward
          where id = 'postgres-history-writer-reward') as reward_count,
         (select count(*)::int from audit_log
          where entity_id = $1) as audit_count`,
      [clientId],
    );

    expect(state.rows[0]).toEqual({
      client_count: 1,
      reward_count: 1,
      audit_count: 0,
    });
  });

  it('lets a concurrent global-session writer win and preserves it', async () => {
    await resetFixture();
    const clientId = 'postgres-global-delete';
    const phone = '4165550203';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId,
      clientId,
      phone,
    });
    const writer = new Client({
      connectionString: databaseUrl,
      application_name: 'client-deletion-global-writer',
    });
    await writer.connect();
    await writer.query('begin');
    await writer.query(
      `insert into client_session (
         id, client_phone, expires_at, created_at
       )
       values (
         'postgres-global-delete-session',
         $1,
         now() + interval '1 day',
         now()
       )`,
      [`+1${phone}`],
    );

    const deletion = permanentlyDeleteSalonClient({
      salonId,
      requestedClientId: clientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    });
    await waitForLockWait(observer, 'client-deletion-library');
    await writer.query('commit');
    await writer.end();

    await expectDeletionError(
      deletion,
      'CLIENT_PERMANENT_DELETE_NOT_ALLOWED',
    );
    const state = await pool.query<{
      client_count: number;
      session_count: number;
      audit_count: number;
    }>(
      `select
         (select count(*)::int from salon_client
          where id = $1) as client_count,
         (select count(*)::int from client_session
          where id = 'postgres-global-delete-session') as session_count,
         (select count(*)::int from audit_log
          where entity_id = $1) as audit_count`,
      [clientId],
    );

    expect(state.rows[0]).toEqual({
      client_count: 1,
      session_count: 1,
      audit_count: 0,
    });
  });

  it('times out safely with full rollback and no deletion audit', async () => {
    await resetFixture();
    const clientId = 'postgres-timeout-delete';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId,
      clientId,
      phone: '4165550204',
    });
    const blocker = new Client({
      connectionString: databaseUrl,
      application_name: 'client-deletion-timeout-blocker',
    });
    await blocker.connect();
    await blocker.query('begin');
    await blocker.query(
      'lock table client_session in row exclusive mode',
    );

    await expectDeletionError(permanentlyDeleteSalonClient({
      salonId,
      requestedClientId: clientId,
      expectedUpdatedAt,
      actorAdminId: ACTOR_ID,
    }), 'CLIENT_LIFECYCLE_BUSY');
    await blocker.query('rollback');
    await blocker.end();

    const state = await pool.query<{
      client_count: number;
      audit_count: number;
    }>(
      `select
         (select count(*)::int from salon_client
          where id = $1) as client_count,
         (select count(*)::int from audit_log
          where entity_id = $1) as audit_count`,
      [clientId],
    );

    expect(state.rows[0]).toEqual({
      client_count: 1,
      audit_count: 0,
    });
  }, 10_000);

  it('rolls the tombstone back and maps a late FK backstop non-disclosingly', async () => {
    await resetFixture();
    const clientId = 'postgres-late-fk-backstop';
    const expectedUpdatedAt = await seedClient(testDb, {
      salonId,
      clientId,
      phone: '4165550208',
    });
    await pool.query(`
      create or replace function client_deletion_test_late_fk()
      returns trigger
      language plpgsql
      as $$
      begin
        if not exists (
          select 1
          from audit_log
          where action = 'client_permanently_deleted'
            and entity_type = 'salon_client'
            and entity_id = old.id
        ) then
          raise exception 'deletion audit was not written first'
            using errcode = '23514';
        end if;
        raise exception 'simulated late foreign-key backstop'
          using errcode = '23503';
      end;
      $$;
    `);
    await pool.query(`
      create trigger client_deletion_test_late_fk
      before delete on salon_client
      for each row
      when (old.id = 'postgres-late-fk-backstop')
      execute function client_deletion_test_late_fk()
    `);

    try {
      const error = await expectDeletionError(permanentlyDeleteSalonClient({
        salonId,
        requestedClientId: clientId,
        expectedUpdatedAt,
        actorAdminId: ACTOR_ID,
      }), 'CLIENT_PERMANENT_DELETE_NOT_ALLOWED');

      expect(error.message).not.toMatch(/foreign|constraint|audit/i);

      const state = await pool.query<{
        client_count: number;
        audit_count: number;
      }>(
        `select
           (select count(*)::int from salon_client
            where id = $1) as client_count,
           (select count(*)::int from audit_log
            where entity_id = $1) as audit_count`,
        [clientId],
      );

      expect(state.rows[0]).toEqual({
        client_count: 1,
        audit_count: 0,
      });
    } finally {
      await pool.query(
        'drop trigger if exists client_deletion_test_late_fk on salon_client',
      );
      await pool.query(
        'drop function if exists client_deletion_test_late_fk()',
      );
    }
  });
});
