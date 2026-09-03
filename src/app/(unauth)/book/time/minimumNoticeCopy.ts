export const formatMinimumNoticeDuration = (minimumNoticeMinutes: number): string => {
  if (minimumNoticeMinutes % 1_440 === 0) {
    const days = minimumNoticeMinutes / 1_440;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }

  if (minimumNoticeMinutes % 60 === 0) {
    const hours = minimumNoticeMinutes / 60;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }

  return `${minimumNoticeMinutes} ${minimumNoticeMinutes === 1 ? 'minute' : 'minutes'}`;
};

export const getMinimumNoticeCustomerCopy = (
  minimumNoticeMinutes: number,
): string => minimumNoticeMinutes === 0
  ? 'No minimum booking notice is required.'
  : `Book at least ${formatMinimumNoticeDuration(minimumNoticeMinutes)} before your appointment starts.`;
