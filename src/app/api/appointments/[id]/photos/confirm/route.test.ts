import { beforeEach, describe, expect, it, vi } from 'vitest';

import { appointmentArtifactsSchema, appointmentPhotoSchema } from '@/models/Schema';

import { POST } from './route';

const {
  requireStaffAppointmentAccess,
  getSalonById,
  isRedisAvailable,
  redis,
  verifyUploadExists,
  logAppointmentChange,
  db,
  insertedRows,
} = vi.hoisted(() => {
  const insertedRows: Array<{ table: unknown; values: unknown }> = [];
  const selectResults: unknown[][] = [];
  const db = {
    query: {
      appointmentArtifactsSchema: { findFirst: vi.fn(async () => null) },
      salonPoliciesSchema: { findFirst: vi.fn(async () => null) },
      superAdminPoliciesSchema: { findFirst: vi.fn(async () => null) },
    },
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        insertedRows.push({ table, values });
        return { returning: vi.fn(async () => [{ id: 'art_1' }]) };
      }),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => selectResults.shift() ?? []),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => undefined),
      })),
    })),
    __selectResults: selectResults,
  };
  return {
    requireStaffAppointmentAccess: vi.fn(),
    getSalonById: vi.fn(),
    isRedisAvailable: vi.fn(async () => true),
    redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
    verifyUploadExists: vi.fn(),
    logAppointmentChange: vi.fn(async () => undefined),
    db,
    insertedRows,
  };
});

vi.mock('server-only', () => ({}));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/libs/staffApiGuards', () => ({ requireStaffAppointmentAccess }));
vi.mock('@/libs/queries', () => ({ getSalonById }));
vi.mock('@/core/redis/redisClient', () => ({ isRedisAvailable, redis }));
vi.mock('@/core/storage/storageClient', () => ({ verifyUploadExists }));
vi.mock('@/libs/appointmentAudit', () => ({ logAppointmentChange }));

const OBJECT_KEY = 'photos/appt_1/after/abc123_ts.jpg';

function confirmRequest() {
  return new Request('http://localhost/api/appointments/appt_1/photos/confirm', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': 'idem-1',
    },
    body: JSON.stringify({ kind: 'after', objectKey: OBJECT_KEY }),
  });
}

describe('POST /api/appointments/[id]/photos/confirm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedRows.length = 0;
    (db as unknown as { __selectResults: unknown[][] }).__selectResults.length = 0;

    requireStaffAppointmentAccess.mockResolvedValue({
      ok: true,
      appointment: {
        id: 'appt_1',
        salonId: 'salon_1',
        clientPhone: '+1 (416) 555-0111',
        technicianId: 'tech_1',
      },
      session: {
        technicianId: 'tech_1',
        technicianName: 'Taylor',
        salonId: 'salon_1',
        salonSlug: 'salon-a',
        phone: '4165550100',
      },
    });
    getSalonById.mockResolvedValue({ id: 'salon_1', name: 'Salon A' });
    redis.get.mockImplementation(async (key: string) =>
      key.startsWith('presign:') ? OBJECT_KEY : null,
    );
    verifyUploadExists.mockResolvedValue({
      exists: true,
      url: 'https://res.cloudinary.test/photo.jpg',
      thumbnailUrl: 'https://res.cloudinary.test/photo_thumb.jpg',
    });
  });

  it('dual-writes the confirmed photo into appointment_artifacts AND appointment_photo', async () => {
    const response = await POST(confirmRequest(), { params: { id: 'appt_1' } });

    expect(response.status).toBe(200);

    const artifactInsert = insertedRows.find(row => row.table === appointmentArtifactsSchema);
    const photoInsert = insertedRows.find(row => row.table === appointmentPhotoSchema);

    expect(artifactInsert).toBeDefined();
    expect(photoInsert).toBeDefined();
    expect(photoInsert!.values).toMatchObject({
      appointmentId: 'appt_1',
      salonId: 'salon_1',
      photoType: 'after',
      cloudinaryPublicId: OBJECT_KEY,
      imageUrl: 'https://res.cloudinary.test/photo.jpg',
      thumbnailUrl: 'https://res.cloudinary.test/photo_thumb.jpg',
      uploadedByTechId: 'tech_1',
      normalizedClientPhone: '4165550111',
    });
    expect(logAppointmentChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'photo_uploaded' }),
    );
  });

  it('does not duplicate the appointment_photo row when the objectKey was already confirmed', async () => {
    (db as unknown as { __selectResults: unknown[][] }).__selectResults.push([{ id: 'photo_existing' }]);

    const response = await POST(confirmRequest(), { params: { id: 'appt_1' } });

    expect(response.status).toBe(200);

    const photoInserts = insertedRows.filter(row => row.table === appointmentPhotoSchema);

    expect(photoInserts).toHaveLength(0);
    expect(logAppointmentChange).not.toHaveBeenCalled();
  });
});
