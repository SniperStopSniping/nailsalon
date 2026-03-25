import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  requireAdminSalon,
  isCloudinaryConfigured,
  db,
  mkdir,
  readdir,
  unlink,
  writeFile,
  uploaderDestroy,
  setSelectedTechnicians,
  setUpdatedRows,
} = vi.hoisted(() => {
  let selectedTechnicians: unknown[] = [];
  let updatedRows: unknown[] = [];

  const setSelectedTechnicians = (rows: unknown[]) => {
    selectedTechnicians = [...rows];
  };

  const setUpdatedRows = (rows: unknown[]) => {
    updatedRows = [...rows];
  };

  const db = {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => selectedTechnicians),
        })),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => updatedRows),
        })),
      })),
    })),
  };

  return {
    requireAdminSalon: vi.fn(),
    isCloudinaryConfigured: vi.fn(),
    db,
    mkdir: vi.fn(),
    readdir: vi.fn(),
    unlink: vi.fn(),
    writeFile: vi.fn(),
    uploaderDestroy: vi.fn(),
    setSelectedTechnicians,
    setUpdatedRows,
  };
});

vi.mock('@/libs/adminAuth', () => ({
  requireAdminSalon,
}));

vi.mock('@/libs/Cloudinary', () => ({
  isCloudinaryConfigured,
}));

vi.mock('@/libs/DB', () => ({
  db,
}));

vi.mock('fs/promises', () => ({
  mkdir,
  readdir,
  unlink,
  writeFile,
}));

vi.mock('cloudinary', () => ({
  v2: {
    config: vi.fn(),
    uploader: {
      destroy: uploaderDestroy,
      upload_stream: vi.fn(),
    },
  },
}));

import { DELETE, POST } from './route';

describe('admin technician avatar route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdminSalon.mockResolvedValue({
      error: null,
      salon: { id: 'salon_1', slug: 'isla-nail-studio' },
    });
    isCloudinaryConfigured.mockReturnValue(false);
    setSelectedTechnicians([]);
    setUpdatedRows([]);
    readdir.mockResolvedValue([]);
    mkdir.mockResolvedValue(undefined);
    unlink.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);
    uploaderDestroy.mockResolvedValue(undefined);
  });

  it('uploads a local avatar in dev when Cloudinary is not configured', async () => {
    setSelectedTechnicians([{ id: 'tech_1', salonId: 'salon_1', avatarUrl: null }]);
    setUpdatedRows([{ id: 'tech_1', avatarUrl: '/uploads/staff/salon_1/avatar_tech_1.jpg' }]);

    const formData = new FormData();
    formData.append('salonSlug', 'isla-nail-studio');
    formData.append('file', new File(['avatar-bytes'], 'tech-daniela.jpeg', { type: 'image/jpeg' }));

    const response = await POST(
      new Request('http://localhost/api/admin/technicians/tech_1/avatar', {
        method: 'POST',
        body: formData,
      }),
      { params: Promise.resolve({ id: 'tech_1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mkdir).toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledOnce();
    expect(body.data.avatarUrl).toBe('/uploads/staff/salon_1/avatar_tech_1.jpg');
  });

  it('cleans up a local avatar file on delete', async () => {
    setSelectedTechnicians([{
      id: 'tech_1',
      salonId: 'salon_1',
      avatarUrl: '/uploads/staff/salon_1/avatar_tech_1.jpg',
    }]);
    setUpdatedRows([{ id: 'tech_1', avatarUrl: null }]);

    const response = await DELETE(
      new Request('http://localhost/api/admin/technicians/tech_1/avatar?salonSlug=isla-nail-studio', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'tech_1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(unlink).toHaveBeenCalledOnce();
    expect(body.data.avatarUrl).toBeNull();
  });
});
