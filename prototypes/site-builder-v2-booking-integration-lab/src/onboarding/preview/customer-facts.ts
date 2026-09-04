/**
 * Shared customer-facing fact wording. The hero, Quick Info, and About all
 * describe the same booking preferences, so the wording lives once here.
 */

import type { BusinessProfileDraft } from '../model/types';

export const labelForVisitMode = (profile: BusinessProfileDraft): string | null => {
  switch (profile.bookingPreferences.visitMode) {
    case 'appointment_only': return 'Appointment only';
    case 'walk_ins_only': return 'Walk-ins welcome';
    case 'appointments_and_walk_ins': return 'Appointments + walk-ins';
    default: return null;
  }
};

export const labelForNewClients = (profile: BusinessProfileDraft): string | null => {
  switch (profile.bookingPreferences.newClientStatus) {
    case 'yes': return 'Accepting new clients';
    case 'no': return 'Returning clients';
    case 'ask_first': return 'New clients: ask first';
    case 'waitlist_only': return 'Waitlist only';
    default: return null;
  }
};

export const labelForMinimumNotice = (profile: BusinessProfileDraft): string | null => {
  const minutes = profile.bookingPreferences.minimumNoticeMinutes;
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return null;
  }
  if (minutes >= 1440) {
    const days = Math.round(minutes / 1440);
    return `Book ${days === 1 ? 'a day' : `${days} days`} ahead`;
  }
  if (minutes >= 60) {
    const hours = Math.round(minutes / 60);
    return `Book ${hours}h ahead`;
  }
  return `Book ${minutes} min ahead`;
};
