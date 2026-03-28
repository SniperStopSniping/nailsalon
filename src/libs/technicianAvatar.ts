export function isLocalUploadAvatarUrl(imageUrl: string | null | undefined): boolean {
  return typeof imageUrl === 'string' && imageUrl.startsWith('/uploads/staff/');
}

export function isUnusablePublicAvatarUrl(imageUrl: string | null | undefined): boolean {
  if (!imageUrl) {
    return true;
  }

  if (process.env.NODE_ENV === 'production' && isLocalUploadAvatarUrl(imageUrl)) {
    return true;
  }

  return false;
}

export function normalizePublicAvatarUrl(imageUrl: string | null | undefined): string | null {
  return isUnusablePublicAvatarUrl(imageUrl) ? null : (imageUrl ?? null);
}

export function getTechnicianInitials(name: string): string {
  const initials = name
    .split(' ')
    .map(part => part.trim()[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return initials || '?';
}
