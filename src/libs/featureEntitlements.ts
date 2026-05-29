import type { SalonFeatures } from '@/types/salonPolicy';

export const FEATURE_DEFAULTS: {
  booking: { onlineBooking: boolean; staffDashboard: boolean };
  staff: { scheduleOverrides: boolean; timeOff: boolean };
  clients: { clientProfiles: boolean; clientHistory: boolean };
  social: { photoUploads: boolean };
  marketing: { smsReminders: boolean; referrals: boolean; rewards: boolean };
  money: { staffEarnings: boolean };
  analytics: { dashboard: boolean; utilization: boolean };
  controls: { clientBlocking: boolean; clientFlags: boolean };
  visibility: {
    allowHideClientPhone: boolean;
    allowHideClientEmail: boolean;
    allowHideAppointmentPrice: boolean;
    allowHideClientHistory: boolean;
    allowHideClientFullName: boolean;
    allowHideClientNotes: boolean;
  };
} = {
  booking: { onlineBooking: true, staffDashboard: true },
  staff: { scheduleOverrides: true, timeOff: true },
  clients: { clientProfiles: true, clientHistory: true },
  social: { photoUploads: true },
  marketing: { smsReminders: false, referrals: false, rewards: false },
  money: { staffEarnings: false },
  analytics: { dashboard: false, utilization: false },
  controls: { clientBlocking: false, clientFlags: false },
  visibility: {
    allowHideClientPhone: true,
    allowHideClientEmail: true,
    allowHideAppointmentPrice: true,
    allowHideClientHistory: true,
    allowHideClientFullName: true,
    allowHideClientNotes: true,
  },
};

export function resolveEntitlement(
  features: SalonFeatures | null | undefined,
  group: string,
  key: string,
): boolean {
  const groupObj = features?.[group as keyof SalonFeatures];
  if (groupObj && typeof groupObj === 'object' && key in groupObj) {
    const value = (groupObj as Record<string, unknown>)[key];
    if (typeof value === 'boolean') {
      return value;
    }
  }

  const legacyKey = key as keyof SalonFeatures;
  if (features && legacyKey in features) {
    const legacyValue = features[legacyKey];
    if (typeof legacyValue === 'boolean') {
      return legacyValue;
    }
  }

  const defaultGroup = FEATURE_DEFAULTS[group as keyof typeof FEATURE_DEFAULTS];
  if (defaultGroup && typeof defaultGroup === 'object' && key in defaultGroup) {
    return (defaultGroup as Record<string, boolean>)[key] ?? false;
  }

  return false;
}
