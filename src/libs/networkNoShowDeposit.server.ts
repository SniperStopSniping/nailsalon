import 'server-only';

import { readNoShowProtection, shouldRequireNoShowDeposit } from '@/libs/networkNoShow';
import { readNetworkNoShowRisk } from '@/libs/networkNoShow.server';
import type { SalonSettings } from '@/types/salonPolicy';

/** Additional applicability only: existing amounts, readiness and waivers remain authoritative. */
export async function resolveNetworkNoShowDepositRequirement(args: {
  salonId: string;
  settings: SalonSettings | null | undefined;
  phone: string | null | undefined;
  email: string | null | undefined;
  handle?: Parameters<typeof readNetworkNoShowRisk>[0]['handle'];
}): Promise<boolean> {
  const protection = readNoShowProtection(args.settings);
  if (protection === 'warn_only') {
    return false;
  }
  const signal = await readNetworkNoShowRisk(args);
  return shouldRequireNoShowDeposit(protection, signal);
}
