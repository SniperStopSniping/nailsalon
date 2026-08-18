import type { SalonFeatures } from '@/types/salonPolicy';

export const CORE_SALON_FEATURES = [
  { key: 'workspace', label: 'Owner workspace', description: 'Today view and salon account access' },
  { key: 'appointments', label: 'Appointments & calendar', description: 'Create, edit, reschedule, and cancel bookings' },
  { key: 'onlineBooking', label: 'Online booking page', description: 'Public services and guest booking' },
  { key: 'clients', label: 'Client CRM', description: 'Profiles, history, notes, preferences, and rebooking' },
  { key: 'services', label: 'Services & pricing', description: 'Prices, durations, buffers, and availability' },
  { key: 'googleCalendar', label: 'Google Calendar access', description: 'Optional owner-connected calendar sync' },
  { key: 'email', label: 'Email confirmations', description: 'Booking confirmation and management links' },
] as const;

export const OPTIONAL_SALON_FEATURES = [
  { key: 'analyticsDashboard', group: 'analytics', nestedKey: 'dashboard', label: 'Advanced analytics', description: 'Revenue, performance, and service-mix reporting' },
  { key: 'utilization', group: 'analytics', nestedKey: 'utilization', label: 'Utilization reporting', description: 'Booked capacity and technician utilization' },
  { key: 'smsReminders', group: 'marketing', nestedKey: 'smsReminders', label: 'Twilio SMS reminders', description: 'Salon-funded confirmations and reminders' },
  { key: 'rewards', group: 'marketing', nestedKey: 'rewards', label: 'Rewards', description: 'Client loyalty points and rewards' },
  { key: 'referrals', group: 'marketing', nestedKey: 'referrals', label: 'Referrals', description: 'Client referral offers and tracking' },
  { key: 'scheduleOverrides', group: 'staff', nestedKey: 'scheduleOverrides', label: 'Schedule overrides', description: 'Advanced technician schedule exceptions' },
  { key: 'staffEarnings', group: 'money', nestedKey: 'staffEarnings', label: 'Staff earnings', description: 'Technician revenue and earnings views' },
  { key: 'clientFlags', group: 'controls', nestedKey: 'clientFlags', label: 'Client flags', description: 'Private risk and service notes' },
  { key: 'clientBlocking', group: 'controls', nestedKey: 'clientBlocking', label: 'Client blocking', description: 'Prevent blocked clients from booking' },
  // Luster L1 catalog domain (migration 0072). Registered so the schema is
  // addressable and the keys are visible to Super Admin, but dark: they are
  // deliberately absent from every preset in applySalonFeaturePreset below,
  // so no preset — including 'all_available' — can switch them on by accident.
  { key: 'catalogVariantsV1', group: 'catalog', nestedKey: 'variantsV1', label: 'Service variants (L1)', description: 'Parent services with labelled variants — not yet built' },
  { key: 'catalogAddOnGroupsV1', group: 'catalog', nestedKey: 'addOnGroupsV1', label: 'Add-on groups (L1)', description: 'Grouped add-on selection rules — not yet built' },
  { key: 'catalogBookingModesV1', group: 'catalog', nestedKey: 'bookingModesV1', label: 'Booking modes (L1)', description: 'Guided selection and request/consultation confirmation — not yet built' },
] as const;

/** Dark L1 catalog keys. No preset may enable these. */
export const DARK_CATALOG_FEATURE_KEYS = [
  'catalogVariantsV1',
  'catalogAddOnGroupsV1',
  'catalogBookingModesV1',
] as const;

export type OptionalSalonFeatureKey = typeof OPTIONAL_SALON_FEATURES[number]['key'];
export type SalonFeaturePreset = 'free_solo' | 'pro' | 'all_available';

export function setOptionalSalonFeature(
  features: SalonFeatures | null | undefined,
  key: OptionalSalonFeatureKey,
  enabled: boolean,
): SalonFeatures {
  const definition = OPTIONAL_SALON_FEATURES.find(item => item.key === key)!;
  const current = features ?? {};
  const group = definition.group as keyof SalonFeatures;
  const groupValue = current[group];
  const nested = groupValue && typeof groupValue === 'object' ? groupValue as Record<string, boolean> : {};
  return {
    ...current,
    [group]: { ...nested, [definition.nestedKey]: enabled },
    [key]: enabled,
  };
}

export function applySalonFeaturePreset(
  features: SalonFeatures | null | undefined,
  preset: SalonFeaturePreset,
): SalonFeatures {
  return OPTIONAL_SALON_FEATURES.reduce(
    (current, definition) => setOptionalSalonFeature(
      current,
      definition.key,
      !(DARK_CATALOG_FEATURE_KEYS as readonly string[]).includes(definition.key)
      && (
        preset === 'all_available'
        || (preset === 'pro' && ['analyticsDashboard', 'smsReminders', 'clientFlags', 'clientBlocking'].includes(definition.key))
      ),
    ),
    features ?? {},
  );
}
