export const APPOINTMENT_DATA_CHANGED_EVENT = 'luster:appointment-data-changed';
export const RETENTION_DATA_CHANGED_EVENT = 'luster:retention-data-changed';

export function dispatchDashboardEvent(eventName: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(eventName));
  }
}

export function notifyAppointmentDataChanged(): void {
  dispatchDashboardEvent(APPOINTMENT_DATA_CHANGED_EVENT);
  dispatchDashboardEvent(RETENTION_DATA_CHANGED_EVENT);
}

export function notifyRetentionDataChanged(): void {
  dispatchDashboardEvent(RETENTION_DATA_CHANGED_EVENT);
}
