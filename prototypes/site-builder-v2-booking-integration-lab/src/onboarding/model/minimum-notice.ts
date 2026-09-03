const formatNumber = (value: number): string => Number.isInteger(value)
  ? String(value)
  : String(Number(value.toFixed(2)));

export const formatMinimumNoticeDuration = (minimumNoticeMinutes: number): string => {
  const normalizedMinutes = Number.isFinite(minimumNoticeMinutes)
    ? Math.max(0, minimumNoticeMinutes)
    : 0;
  if (normalizedMinutes === 0) {
    return 'No minimum notice';
  }
  if (normalizedMinutes >= 1_440) {
    const days = normalizedMinutes / 1_440;
    return `${formatNumber(days)} ${days === 1 ? 'day' : 'days'}`;
  }
  if (normalizedMinutes >= 60) {
    const hours = normalizedMinutes / 60;
    return `${formatNumber(hours)} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  return `${formatNumber(normalizedMinutes)} ${normalizedMinutes === 1 ? 'minute' : 'minutes'}`;
};

export type MinimumNoticeCopy = {
  customer: string;
  helper: string;
  summary: string;
};

export const getMinimumNoticeCopy = (
  minimumNoticeMinutes: number,
): MinimumNoticeCopy => {
  if (!Number.isFinite(minimumNoticeMinutes) || minimumNoticeMinutes <= 0) {
    return {
      customer: 'Clients can book without a minimum-notice requirement.',
      helper: 'Clients can book without a minimum-notice requirement.',
      summary: 'No minimum-notice requirement',
    };
  }
  const duration = formatMinimumNoticeDuration(minimumNoticeMinutes);
  return {
    customer: `Book at least ${duration} before your appointment.`,
    helper: `Clients must book at least ${duration} before the appointment starts.`,
    summary: `At least ${duration} before the appointment starts`,
  };
};
