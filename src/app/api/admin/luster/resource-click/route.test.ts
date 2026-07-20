import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAdminSalon, insertValues, db } = vi.hoisted(() => {
  const insertValues = vi.fn(async () => undefined);
  const insert = vi.fn(() => ({ values: insertValues }));

  return {
    requireAdminSalon: vi.fn(),
    insertValues,
    db: { insert },
  };
});

vi.mock('@/libs/adminAuth', () => ({ requireAdminSalon }));
vi.mock('@/libs/DB', () => ({ db }));
vi.mock('@/models/Schema', () => ({ salonAuditLogSchema: 'salon_audit_log' }));

const { POST } = await import('./route');

const post = (body: unknown) =>
  POST(new Request('https://app.example.com/api/admin/luster/resource-click', {
    method: 'POST',
    body: JSON.stringify(body),
  }));

describe('POST /api/admin/luster/resource-click', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSalon.mockResolvedValue({ error: null, salon: { id: 'salon-1' } });
  });

  it('records a click on an approved lusterstudio.ca link', async () => {
    const response = await post({
      salonSlug: 'salon-a',
      resourceId: 'builder-gel-foundations',
      url: 'https://lusterstudio.ca/learn/builder-gel-foundations',
    });

    expect(response.status).toBe(200);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        salonId: 'salon-1',
        action: 'luster_resource_clicked',
        metadata: {
          field: 'builder-gel-foundations',
          newValue: 'https://lusterstudio.ca/learn/builder-gel-foundations',
        },
      }),
    );
  });

  it.each([
    ['the retired luster.com domain', 'https://luster.com/pages/education'],
    ['a lookalike host', 'https://lusterstudio.ca.example.com/shop'],
    ['a non-https scheme', 'http://lusterstudio.ca/shop'],
    ['an unapproved path', 'https://lusterstudio.ca/learn/does-not-exist'],
  ])('rejects %s without touching the audit log', async (_label, url) => {
    const response = await post({ salonSlug: 'salon-a', resourceId: 'forged', url });

    expect(response.status).toBe(400);
    expect(insertValues).not.toHaveBeenCalled();
  });
});
