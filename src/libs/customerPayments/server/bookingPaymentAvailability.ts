import 'server-only';

import { isPaymentWorkspaceEnabled } from '../workspacePolicy';
import { readWorkspaceBinding } from './workspacePolicyRepository';
import { workspaceRuntime } from './workspaceRuntime';

/** Optional navigation only; a setup failure must not break ordinary booking. */
export async function isBookingPaymentAvailable(salonId: string) {
  if (!isPaymentWorkspaceEnabled()) {
    return false;
  }
  try {
    const { db } = await import('@/libs/DB');
    return !!await db.transaction(tx => readWorkspaceBinding(tx, salonId, workspaceRuntime()));
  } catch {
    return false;
  }
}
