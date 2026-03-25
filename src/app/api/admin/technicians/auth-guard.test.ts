import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requireAdminSalon } = vi.hoisted(() => ({
  requireAdminSalon: vi.fn(),
}));

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon,
}));

vi.mock('@/libs/DB', () => ({
  db: {},
}));

vi.mock('@/libs/planLimits', () => ({
  canAddTechnician: vi.fn(),
}));

vi.mock('@/libs/Cloudinary', () => ({
  isCloudinaryConfigured: vi.fn(),
}));

vi.mock('@/libs/SMS', () => ({
  sendStaffInvite: vi.fn(),
}));

vi.mock('@/libs/featureGating', () => ({
  guardModuleOr403: vi.fn(),
}));

vi.mock('cloudinary', () => ({
  v2: {
    config: vi.fn(),
    uploader: {
      destroy: vi.fn(),
      upload_stream: vi.fn(),
    },
  },
}));

import * as techniciansRoute from './route';
import * as reorderRoute from './reorder/route';
import * as technicianDetailRoute from './[id]/route';
import * as technicianServicesRoute from './[id]/services/route';
import * as technicianAvatarRoute from './[id]/avatar/route';
import * as technicianInviteRoute from './[id]/invite/route';
import * as technicianStatusRoute from './[id]/status/route';
import * as technicianClientsRoute from './[id]/clients/route';
import * as technicianEarningsRoute from './[id]/earnings/route';

describe('admin technician route auth guard propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSalon.mockResolvedValue({
      error: new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }),
      salon: null,
    });
  });

  it.each([
    {
      label: 'GET /api/admin/technicians',
      invoke: () => techniciansRoute.GET(new Request('http://localhost/api/admin/technicians?salonSlug=salon-a')),
    },
    {
      label: 'POST /api/admin/technicians',
      invoke: () => techniciansRoute.POST(new Request('http://localhost/api/admin/technicians', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonSlug: 'salon-a', name: 'Taylor' }),
      })),
    },
    {
      label: 'PUT /api/admin/technicians/reorder',
      invoke: () => reorderRoute.PUT(new Request('http://localhost/api/admin/technicians/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonSlug: 'salon-a', technicians: [{ id: 'tech_1', displayOrder: 0 }] }),
      })),
    },
    {
      label: 'GET /api/admin/technicians/[id]',
      invoke: () => technicianDetailRoute.GET(
        new Request('http://localhost/api/admin/technicians/tech_1?salonSlug=salon-a'),
        { params: Promise.resolve({ id: 'tech_1' }) },
      ),
    },
    {
      label: 'PUT /api/admin/technicians/[id]',
      invoke: () => technicianDetailRoute.PUT(
        new Request('http://localhost/api/admin/technicians/tech_1', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ salonSlug: 'salon-a', name: 'Taylor' }),
        }),
        { params: Promise.resolve({ id: 'tech_1' }) },
      ),
    },
    {
      label: 'DELETE /api/admin/technicians/[id]',
      invoke: () => technicianDetailRoute.DELETE(
        new Request('http://localhost/api/admin/technicians/tech_1?salonSlug=salon-a'),
        { params: Promise.resolve({ id: 'tech_1' }) },
      ),
    },
    {
      label: 'GET /api/admin/technicians/[id]/services',
      invoke: () => technicianServicesRoute.GET(
        new Request('http://localhost/api/admin/technicians/tech_1/services?salonSlug=salon-a'),
        { params: Promise.resolve({ id: 'tech_1' }) },
      ),
    },
    {
      label: 'PUT /api/admin/technicians/[id]/services',
      invoke: () => technicianServicesRoute.PUT(
        new Request('http://localhost/api/admin/technicians/tech_1/services', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ salonSlug: 'salon-a', services: [] }),
        }),
        { params: Promise.resolve({ id: 'tech_1' }) },
      ),
    },
    {
      label: 'POST /api/admin/technicians/[id]/avatar',
      invoke: () => {
        const formData = new FormData();
        formData.set('file', new File(['image'], 'avatar.jpg', { type: 'image/jpeg' }));
        formData.set('salonSlug', 'salon-a');
        return technicianAvatarRoute.POST(
          new Request('http://localhost/api/admin/technicians/tech_1/avatar', {
            method: 'POST',
            body: formData,
          }),
          { params: Promise.resolve({ id: 'tech_1' }) },
        );
      },
    },
    {
      label: 'DELETE /api/admin/technicians/[id]/avatar',
      invoke: () => technicianAvatarRoute.DELETE(
        new Request('http://localhost/api/admin/technicians/tech_1/avatar?salonSlug=salon-a'),
        { params: Promise.resolve({ id: 'tech_1' }) },
      ),
    },
    {
      label: 'POST /api/admin/technicians/[id]/invite',
      invoke: () => technicianInviteRoute.POST(
        new Request('http://localhost/api/admin/technicians/tech_1/invite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ salonSlug: 'salon-a' }),
        }),
        { params: Promise.resolve({ id: 'tech_1' }) },
      ),
    },
    {
      label: 'PUT /api/admin/technicians/[id]/status',
      invoke: () => technicianStatusRoute.PUT(
        new Request('http://localhost/api/admin/technicians/tech_1/status', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ salonSlug: 'salon-a', currentStatus: 'available' }),
        }),
        { params: Promise.resolve({ id: 'tech_1' }) },
      ),
    },
    {
      label: 'GET /api/admin/technicians/[id]/clients',
      invoke: () => technicianClientsRoute.GET(
        new Request('http://localhost/api/admin/technicians/tech_1/clients?salonSlug=salon-a'),
        { params: Promise.resolve({ id: 'tech_1' }) },
      ),
    },
    {
      label: 'GET /api/admin/technicians/[id]/earnings',
      invoke: () => technicianEarningsRoute.GET(
        new Request('http://localhost/api/admin/technicians/tech_1/earnings?salonSlug=salon-a'),
        { params: Promise.resolve({ id: 'tech_1' }) },
      ),
    },
  ])('$label rejects unauthenticated access', async ({ invoke }) => {
    const response = await invoke();
    expect(response.status).toBe(401);
  });
});
