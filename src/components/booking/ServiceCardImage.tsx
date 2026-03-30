'use client';

import Image from 'next/image';
import { ImageIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

import { PUBLIC_SERVICE_IMAGE_FALLBACK, normalizePublicServiceImageUrl } from '@/libs/serviceImage';
import { cn } from '@/utils/Helpers';

type ServiceCardImageProps = {
  src: string | null | undefined;
  alt: string;
  className?: string;
  sizes?: string;
  imageTestId?: string;
  placeholderTestId?: string;
};

export function ServiceCardImage({
  src,
  alt,
  className,
  sizes,
  imageTestId,
  placeholderTestId,
}: ServiceCardImageProps) {
  const normalizedSrc = normalizePublicServiceImageUrl(src);
  const [resolvedSrc, setResolvedSrc] = useState(normalizedSrc);
  const [showPlaceholder, setShowPlaceholder] = useState(false);

  useEffect(() => {
    setResolvedSrc(normalizedSrc);
    setShowPlaceholder(false);
  }, [normalizedSrc]);

  if (showPlaceholder) {
    return (
      <div
        data-testid={placeholderTestId}
        className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#f5e7cd] via-[#f7f2e8] to-white"
      >
        <div className="flex items-center gap-1.5 rounded-full border border-white/60 bg-white/70 px-2.5 py-1 text-[#9b7a35] shadow-sm backdrop-blur-sm">
          <ImageIcon className="size-3.5" strokeWidth={1.75} />
          <span className="text-[10px] font-semibold uppercase tracking-[0.08em]">Service</span>
        </div>
      </div>
    );
  }

  return (
    <Image
      src={resolvedSrc}
      alt={alt}
      fill
      sizes={sizes}
      data-testid={imageTestId}
      className={cn('object-cover', className)}
      onError={() => {
        if (resolvedSrc !== PUBLIC_SERVICE_IMAGE_FALLBACK) {
          setResolvedSrc(PUBLIC_SERVICE_IMAGE_FALLBACK);
          return;
        }

        setShowPlaceholder(true);
      }}
    />
  );
}
