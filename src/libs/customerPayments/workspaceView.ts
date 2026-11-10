import type { AdjustmentBalance, adjustmentPermissions } from './adjustments';

/** Browser projection deliberately excludes provider/account IDs and actors. */
export type PaymentWorkspaceView = {
  initialized: boolean;
  sourceChanged: boolean;
  onlinePaymentsAvailable: boolean;
  balance: AdjustmentBalance;
  permissions: ReturnType<typeof adjustmentPermissions>;
  invoice: {
    items: { id: string; name: string; quantity: number; lineTotalCents: number }[];
    subtotalCents: number;
    discountCents: number;
    taxCents: number;
    tipCents: number;
  };
  payments: { id: string; kind: 'online' | 'deposit' | 'manual'; amountCents: number; state: 'confirmed' | 'under_review'; voided?: boolean }[];
  operations: { id: string; kind: 'payment' | 'refund'; state: string; principalCents: number; tipCents: number; reason: string | null; createdAt: number }[];
};
