import { readFileSync } from 'node:fs';

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

describe('0055 client retention assistant migration', () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
    await database.exec(`
      CREATE TABLE salon (id text PRIMARY KEY, settings jsonb);
      CREATE TABLE salon_client (
        id text PRIMARY KEY,
        salon_id text NOT NULL REFERENCES salon(id)
      );
      CREATE TABLE appointment (
        id text PRIMARY KEY,
        salon_id text NOT NULL REFERENCES salon(id)
      );
      INSERT INTO salon (id, settings)
      VALUES ('salon_1', '{"googleReviewUrl":"https://example.com/review"}'::jsonb);
      INSERT INTO salon_client (id, salon_id) VALUES ('client_1', 'salon_1');
    `);
    const migration = readFileSync(
      new URL('../../migrations/0055_client_retention_assistant.sql', import.meta.url),
      'utf8',
    ).replaceAll('--> statement-breakpoint', '');
    await database.exec(migration);
  });

  beforeEach(async () => {
    await database.exec('DELETE FROM client_communication; DELETE FROM appointment;');
  });

  afterAll(async () => {
    await database.close();
  });

  it('backfills the existing Google review URL', async () => {
    const result = await database.query<{ google_review_url: string }>(`
      SELECT google_review_url
      FROM salon_retention_settings
      WHERE salon_id = 'salon_1'
    `);

    expect(result.rows).toEqual([{ google_review_url: 'https://example.com/review' }]);
  });

  it('enforces one active retention stage per salon client', async () => {
    await database.exec(`
      INSERT INTO client_communication
        (id, salon_id, salon_client_id, kind, status, prepared_at)
      VALUES
        ('comm_1', 'salon_1', 'client_1', 'rebook', 'prepared', now());
    `);

    await expect(database.exec(`
      INSERT INTO client_communication
        (id, salon_id, salon_client_id, kind, status, prepared_at)
      VALUES
        ('comm_2', 'salon_1', 'client_1', 'promo_6w', 'prepared', now());
    `)).rejects.toThrow();
  });

  it('preserves reminder history when its appointment is hard-deleted', async () => {
    await database.exec(`
      INSERT INTO appointment (id, salon_id) VALUES ('appointment_1', 'salon_1');
      INSERT INTO client_communication
        (id, salon_id, salon_client_id, appointment_id, kind, status, prepared_at)
      VALUES
        ('comm_1', 'salon_1', 'client_1', 'appointment_1', 'reminder', 'prepared', now());
      DELETE FROM appointment WHERE id = 'appointment_1';
    `);
    const result = await database.query<{ appointment_id: string | null }>(`
      SELECT appointment_id FROM client_communication WHERE id = 'comm_1'
    `);

    expect(result.rows).toEqual([{ appointment_id: null }]);
  });
});
