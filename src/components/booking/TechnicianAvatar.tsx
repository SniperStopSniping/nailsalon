'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';

import { getTechnicianInitials, isUnusablePublicAvatarUrl } from '@/libs/technicianAvatar';
import { cn } from '@/utils/Helpers';

type TechnicianAvatarProps = {
  name: string;
  imageUrl?: string | null;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
  initialsClassName?: string;
  sizes?: string;
};

export function TechnicianAvatar({
  name,
  imageUrl,
  className,
  imageClassName,
  fallbackClassName,
  initialsClassName,
  sizes,
}: TechnicianAvatarProps) {
  const [failedToLoad, setFailedToLoad] = useState(false);
  const initials = useMemo(() => getTechnicianInitials(name), [name]);
  const shouldRenderImage = !failedToLoad && !isUnusablePublicAvatarUrl(imageUrl);

  return (
    <div className={cn('relative overflow-hidden rounded-full', className)}>
      {shouldRenderImage
        ? (
            <Image
              src={imageUrl!}
              alt={name}
              fill
              sizes={sizes}
              className={cn('object-cover', imageClassName)}
              onError={() => setFailedToLoad(true)}
            />
          )
        : (
            <div
              className={cn(
                'flex size-full items-center justify-center bg-gradient-to-br from-[#a18cd1] to-[#fbc2eb] text-white',
                fallbackClassName,
              )}
            >
              <span className={cn('text-base font-semibold', initialsClassName)}>{initials}</span>
            </div>
          )}
    </div>
  );
}
