import type { ReactNode } from 'react';

import { withPublicOwnerSession } from '@/components/auth/withPublicOwnerSession';

// Shared /book routes do not pass through the salon-slug layout. Slug routes
// re-export their pages, not this layout, so each entry mounts one provider.
export default function PublicBookingLayout({ children }: { children: ReactNode }) {
  return withPublicOwnerSession(children);
}
