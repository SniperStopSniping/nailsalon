export type SalonDeletionAsset =
  | { kind: 'onboarding'; key: string }
  | { kind: 'cloudinary'; publicId: string; source: 'portfolio' | 'appointment' | 'service' }
  | { kind: 'local_service'; imageUrl: string; serviceId: string }
  | { kind: 'review'; reference: string; reason: string };

export type SalonDeletionStatus = {
  jobId: string;
  status: 'pending' | 'review_required' | 'completed';
  databaseDeleted: true;
  rowsDeleted: number;
  mediaTotal: number;
  mediaRemoved: number;
  mediaRemaining: number;
  reviewRequired: number;
  attempts: number;
  nextAttemptAt: string | null;
  retained: readonly string[];
};

export const SALON_DELETION_RETAINED = [
  'Required billing, payment, fraud-prevention and platform audit records',
  'People’s sign-in accounts and data belonging to other salons',
  'Existing events in Google Calendar and other externally held records',
  'Database backups, provider backups and cached copies under their separate retention settings',
] as const;
