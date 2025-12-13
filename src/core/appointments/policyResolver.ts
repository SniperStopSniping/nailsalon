import type { EffectivePolicy, SalonPolicy, SuperAdminPolicy } from './policyTypes';

// Pure merge with precedence: super admin overrides salon when defined.
export function resolveEffectivePolicy(args: {
  salon: SalonPolicy;
  superAdmin: SuperAdminPolicy;
}): EffectivePolicy {
  const { salon, superAdmin } = args;

  return {
    ...salon,
    requireBeforePhotoToStart: superAdmin.requireBeforePhotoToStart ?? salon.requireBeforePhotoToStart,
    requireAfterPhotoToFinish: superAdmin.requireAfterPhotoToFinish ?? salon.requireAfterPhotoToFinish,
    requireAfterPhotoToPay: superAdmin.requireAfterPhotoToPay ?? salon.requireAfterPhotoToPay,

    autoPostEnabled: superAdmin.autoPostEnabled ?? salon.autoPostEnabled,
    autoPostAIcaptionEnabled: superAdmin.autoPostAIcaptionEnabled ?? salon.autoPostAIcaptionEnabled,
  };
}
