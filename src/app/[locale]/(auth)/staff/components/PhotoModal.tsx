'use client';

import { nanoid } from 'nanoid';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import type { AppointmentData, AppointmentPhoto } from './StaffAppointmentCard';

// =============================================================================
// Cappuccino Design Tokens
// =============================================================================

const cappuccino = {
  title: '#6F4E37',
  cardBg: '#FAF8F5',
  cardBorder: '#E6DED6',
  primary: '#4B2E1E',
  secondary: '#EADBC8',
  secondaryText: '#4B2E1E',
};

// =============================================================================
// Types
// =============================================================================

type PhotoModalProps = {
  appointment: AppointmentData;
  onClose: () => void;
};

type UploadState = {
  uploading: boolean;
  error: string | null;
  progress: 'idle' | 'presigning' | 'uploading' | 'confirming' | 'done';
};

// =============================================================================
// Photo Modal Component
// =============================================================================

export function PhotoModal({ appointment, onClose }: PhotoModalProps) {
  const router = useRouter();
  const beforeInputRef = useRef<HTMLInputElement>(null);
  const afterInputRef = useRef<HTMLInputElement>(null);

  const [beforeUpload, setBeforeUpload] = useState<UploadState>({
    uploading: false,
    error: null,
    progress: 'idle',
  });
  const [afterUpload, setAfterUpload] = useState<UploadState>({
    uploading: false,
    error: null,
    progress: 'idle',
  });

  // Optimistic thumbnails (shown immediately after upload)
  const [optimisticBefore, setOptimisticBefore] = useState<string | null>(null);
  const [optimisticAfter, setOptimisticAfter] = useState<string | null>(null);

  // Get existing photos
  const existingBefore = appointment.photos.filter(p => p.photoType === 'before');
  const existingAfter = appointment.photos.filter(p => p.photoType === 'after');

  // =============================================================================
  // Upload Handler (EXACT Canvas OS API Contract)
  // =============================================================================

  const handleUpload = async (file: File, kind: 'before' | 'after') => {
    const setState = kind === 'before' ? setBeforeUpload : setAfterUpload;
    const setOptimistic = kind === 'before' ? setOptimisticBefore : setOptimisticAfter;

    setState({ uploading: true, error: null, progress: 'presigning' });

    try {
      // =================================================================
      // Step 1: Presign
      // =================================================================
      const presignRes = await fetch(`/api/appointments/${appointment.id}/photos/presign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind, // "before" | "after" - EXACT field name
          contentType: file.type,
          fileSize: file.size,
        }),
      });

      if (!presignRes.ok) {
        const err = await presignRes.json();
        throw new Error(err.error?.message || 'Failed to get upload URL');
      }

      const { uploadUrl, signature, timestamp, apiKey, objectKey } = await presignRes.json();

      // =================================================================
      // Step 2: Upload to Cloudinary (Signed FormData POST)
      // =================================================================
      setState(s => ({ ...s, progress: 'uploading' }));

      // Derive folder and public_id from objectKey
      const folder = objectKey.substring(0, objectKey.lastIndexOf('/'));
      const publicId = objectKey.split('/').pop()?.replace(/\.[^/.]+$/, '');

      const formData = new FormData();
      formData.append('file', file);
      formData.append('signature', signature);
      formData.append('timestamp', String(timestamp));
      formData.append('api_key', apiKey);
      if (folder) {
        formData.append('folder', folder);
      }
      if (publicId) {
        formData.append('public_id', publicId);
      }

      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        body: formData,
      });

      if (!uploadRes.ok) {
        throw new Error('Upload to storage failed');
      }

      // Show optimistic thumbnail immediately
      const localUrl = URL.createObjectURL(file);
      setOptimistic(localUrl);

      // =================================================================
      // Step 3: Confirm
      // =================================================================
      setState(s => ({ ...s, progress: 'confirming' }));

      const confirmRes = await fetch(`/api/appointments/${appointment.id}/photos/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': nanoid(),
        },
        body: JSON.stringify({
          kind, // EXACT field name
          objectKey, // EXACT field name
        }),
      });

      if (!confirmRes.ok) {
        const err = await confirmRes.json();
        throw new Error(err.error?.message || 'Failed to confirm upload');
      }

      // =================================================================
      // Step 4: Revalidate (NO STALE DATA)
      // =================================================================
      setState({ uploading: false, error: null, progress: 'done' });
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setState({ uploading: false, error: message, progress: 'idle' });
      console.error('Photo upload error:', err);
    }
  };

  // =============================================================================
  // File Input Handlers
  // =============================================================================

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>, kind: 'before' | 'after') => {
    const file = e.target.files?.[0];
    if (file) {
      handleUpload(file, kind);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  };

  // =============================================================================
  // Render
  // =============================================================================

  const isUploading = beforeUpload.uploading || afterUpload.uploading;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isUploading) {
          onClose();
        }
      }}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl shadow-2xl sm:rounded-2xl"
        style={{ backgroundColor: cappuccino.cardBg }}
      >
        <div className="p-6">
          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            <h2
              className="text-xl font-semibold"
              style={{ color: cappuccino.title }}
            >
              📸 Photos
            </h2>
            <button
              type="button"
              onClick={onClose}
              disabled={isUploading}
              className="text-2xl text-neutral-400 transition-colors hover:text-neutral-600 disabled:opacity-50"
            >
              ×
            </button>
          </div>

          {/* Client Info */}
          <div
            className="mb-6 rounded-xl p-3"
            style={{ backgroundColor: cappuccino.secondary }}
          >
            <div
              className="font-medium"
              style={{ color: cappuccino.secondaryText }}
            >
              {appointment.clientName || 'Client'}
            </div>
            <div className="text-sm text-neutral-600">
              {appointment.services.map(s => s.name).join(', ')}
            </div>
          </div>

          {/* Before Photos Section */}
          <div className="mb-6">
            <h3
              className="mb-3 text-sm font-semibold uppercase tracking-wide"
              style={{ color: cappuccino.title }}
            >
              Before Photos
            </h3>

            {/* Existing + Optimistic Before Photos */}
            <PhotoGrid
              photos={existingBefore}
              optimisticUrl={optimisticBefore}
            />

            {/* Upload Button */}
            <input
              ref={beforeInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => handleFileSelect(e, 'before')}
            />

            {beforeUpload.error && (
              <div className="mb-2 rounded-lg bg-red-50 p-2 text-xs text-red-600">
                {beforeUpload.error}
              </div>
            )}

            <button
              type="button"
              onClick={() => beforeInputRef.current?.click()}
              disabled={beforeUpload.uploading}
              className="w-full rounded-xl border-2 border-dashed p-4 text-center transition-colors hover:bg-white/50 disabled:opacity-50"
              style={{ borderColor: cappuccino.cardBorder }}
            >
              {beforeUpload.uploading
                ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="size-4 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: cappuccino.primary }} />
                      <span className="text-sm text-neutral-600">
                        {beforeUpload.progress === 'presigning' && 'Preparing...'}
                        {beforeUpload.progress === 'uploading' && 'Uploading...'}
                        {beforeUpload.progress === 'confirming' && 'Saving...'}
                      </span>
                    </div>
                  )
                : (
                    <>
                      <div className="text-2xl">📷</div>
                      <div className="mt-1 text-sm font-medium text-neutral-700">
                        Add Before Photo
                      </div>
                    </>
                  )}
            </button>
          </div>

          {/* After Photos Section */}
          <div>
            <h3
              className="mb-3 text-sm font-semibold uppercase tracking-wide"
              style={{ color: cappuccino.title }}
            >
              After Photos
            </h3>

            {/* Existing + Optimistic After Photos */}
            <PhotoGrid
              photos={existingAfter}
              optimisticUrl={optimisticAfter}
            />

            {/* Upload Button */}
            <input
              ref={afterInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => handleFileSelect(e, 'after')}
            />

            {afterUpload.error && (
              <div className="mb-2 rounded-lg bg-red-50 p-2 text-xs text-red-600">
                {afterUpload.error}
              </div>
            )}

            <button
              type="button"
              onClick={() => afterInputRef.current?.click()}
              disabled={afterUpload.uploading}
              className="w-full rounded-xl border-2 border-dashed p-4 text-center transition-colors hover:bg-white/50 disabled:opacity-50"
              style={{ borderColor: cappuccino.primary }}
            >
              {afterUpload.uploading
                ? (
                    <div className="flex items-center justify-center gap-2">
                      <div className="size-4 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: cappuccino.primary }} />
                      <span className="text-sm text-neutral-600">
                        {afterUpload.progress === 'presigning' && 'Preparing...'}
                        {afterUpload.progress === 'uploading' && 'Uploading...'}
                        {afterUpload.progress === 'confirming' && 'Saving...'}
                      </span>
                    </div>
                  )
                : (
                    <>
                      <div className="text-2xl">✨</div>
                      <div
                        className="mt-1 text-sm font-medium"
                        style={{ color: cappuccino.primary }}
                      >
                        Add After Photo
                      </div>
                    </>
                  )}
            </button>
          </div>

          {/* Done Button */}
          <button
            type="button"
            onClick={onClose}
            disabled={isUploading}
            className="mt-6 w-full rounded-xl py-3 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
            style={{ backgroundColor: cappuccino.primary }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Photo Grid Component
// =============================================================================

function PhotoGrid({
  photos,
  optimisticUrl,
}: {
  photos: AppointmentPhoto[];
  optimisticUrl: string | null;
}) {
  if (photos.length === 0 && !optimisticUrl) {
    return null;
  }

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {photos.map(photo => (
        <div
          key={photo.id}
          className="relative size-20 overflow-hidden rounded-lg"
        >
          <Image
            src={photo.thumbnailUrl || photo.imageUrl}
            alt="Photo"
            fill
            className="object-cover"
          />
        </div>
      ))}
      {optimisticUrl && (
        <div className="relative size-20 overflow-hidden rounded-lg ring-2 ring-green-500">
          <Image
            src={optimisticUrl}
            alt="New photo"
            fill
            className="object-cover"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <span className="text-lg text-white">✓</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default PhotoModal;
