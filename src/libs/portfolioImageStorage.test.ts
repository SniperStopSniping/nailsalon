import sharp from 'sharp';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { uploadPortfolioImage } from './portfolioImageStorage.server';

const { upload, configured } = vi.hoisted(() => ({ upload: vi.fn(), configured: vi.fn(() => true) }));
vi.mock('server-only', () => ({}));
vi.mock('@/libs/Cloudinary', () => ({ isCloudinaryConfigured: configured, cloudinary: { uploader: { upload_stream: upload } } }));

const photo = async (width = 800) => new File([await sharp({ create: { width, height: 600, channels: 3, background: 'red' } }).jpeg().withMetadata().toBuffer()], 'photo.jpg', { type: 'image/jpeg' });

describe('Portfolio server upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configured.mockReturnValue(true);
  });

  it('stores decoded, metadata-free bytes through the existing SDK without a preset', async () => {
    let uploadedBytes: Buffer | undefined;
    upload.mockImplementation((_options, callback) => ({ end: (bytes: Buffer) => {
      uploadedBytes = bytes;
      callback(null, { secure_url: 'https://res.cloudinary.com/cloud/image/upload/photo.webp' });
    } }));
    const stored = await uploadPortfolioImage({ file: await photo(), salonId: 'salon-a' });
    const options = upload.mock.calls[0]![0];

    expect(options.public_id).toMatch(/^salons\/salon-a\/portfolio\/portfolio_[\w-]{16}_webp$/);
    expect(options).toMatchObject({ resource_type: 'image', overwrite: false, type: 'upload' });
    expect(options).not.toHaveProperty('upload_preset');

    const metadata = await sharp(uploadedBytes!).metadata();

    expect(metadata.format).toBe('webp');
    expect(metadata.exif).toBeUndefined();
    expect(stored).toMatchObject({ width: 800, height: 600, bytes: uploadedBytes!.byteLength });
  });

  it('rejects corrupt bytes even when the browser claims JPEG', async () => {
    await expect(uploadPortfolioImage({ file: new File(['bad'], 'bad.jpg', { type: 'image/jpeg' }), salonId: 'salon-a' })).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('enforces minimum dimensions before storage', async () => {
    await expect(uploadPortfolioImage({ file: await photo(399), salonId: 'salon-a' })).rejects.toMatchObject({ code: 'IMAGE_TOO_SMALL' });
    expect(upload).not.toHaveBeenCalled();
  });

  it('classifies provider rejection as storage failure', async () => {
    upload.mockImplementation((_options, callback) => ({ end: () => callback({ http_code: 503 }) }));

    await expect(uploadPortfolioImage({ file: await photo(), salonId: 'salon-a' })).rejects.toMatchObject({ code: 'IMAGE_STORAGE_FAILED' });
  });
});
