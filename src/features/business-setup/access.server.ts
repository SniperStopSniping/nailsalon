import 'server-only';

import { eq } from 'drizzle-orm';

import { isOnboardingV1IntegrationEnabled } from '@/features/onboarding-v1-integration/config.server';
import { requireAdminSalonForSlug, requireRealSalonOwner } from '@/libs/adminAuth';
import { db } from '@/libs/DB';
import { businessSetupWorkspaceSchema } from '@/models/Schema';

export function setupPreviewTrialEnabled() {
  return process.env.APP_ENV === 'preview' && process.env.BUSINESS_SETUP_PREVIEW_TRIAL === 'true';
}
export function businessSetupEnabled() {
  return process.env.BUSINESS_SETUP_AI_ENABLED === 'true';
}
/** Separate enrollment switch; existing pilots and saved drafts keep their routes. */
export function businessSetupSelfServeEnabled() {
  return businessSetupEnabled() && process.env.BUSINESS_SETUP_SELF_SERVE_ENABLED === 'true'
    && process.env.AI_CREDITS_ENABLED === 'true' && process.env.AI_CREDIT_METERING_ENABLED === 'true'
    && isOnboardingV1IntegrationEnabled();
}
export function setupAiAvailableForSalon(salonId: string) {
  const allowlist = (process.env.BUSINESS_SETUP_SALON_ALLOWLIST ?? '').split(',').map(v => v.trim()).filter(Boolean);
  return businessSetupEnabled() && (businessSetupSelfServeEnabled() || allowlist.includes(salonId) || (setupPreviewTrialEnabled() && /^ai_trial_[a-f0-9]{32}$/u.test(salonId)));
}
export async function requireSetupOwner(salonSlug: string) {
  const { salon, error } = await requireAdminSalonForSlug(salonSlug, { persistActiveSalon: false });
  if (error || !salon) {
    return { response: error ?? new Response(null, { status: 404 }) };
  }
  const guard = await requireRealSalonOwner(salon.id);
  if (!guard.ok) {
    return { response: guard.response };
  }
  const aiEnabled = setupAiAvailableForSalon(salon.id);
  // Turning off AI must not strand an already saved setup. Owners retain its
  // manual controls and exact approval boundary without making provider calls.
  if (!aiEnabled) {
    const [existing] = await db.select({ id: businessSetupWorkspaceSchema.id }).from(businessSetupWorkspaceSchema).where(eq(businessSetupWorkspaceSchema.salonId, salon.id));
    if (!existing) {
      return { response: new Response(null, { status: 404 }) };
    }
  }
  return { actor: { salonId: salon.id, adminId: guard.admin.id }, salon, aiEnabled };
}
