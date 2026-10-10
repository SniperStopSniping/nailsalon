import type { BusinessHours } from '@/libs/bookingPolicy';

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
const LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function clock(value: string) {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return null;
  }
  const [hour, minute] = value.split(':').map(Number) as [number, number];
  return `${hour % 12 || 12}${minute ? `:${String(minute).padStart(2, '0')}` : ''} ${hour < 12 ? 'am' : 'pm'}`;
}

/** Group adjacent identical days without inventing hours for missing settings. */
export function formatIslaHours(hours: BusinessHours) {
  const groups: Array<{ first: number; last: number; time: string }> = [];
  DAYS.forEach((day, index) => {
    const value = hours?.[day];
    if (value === undefined) {
      return;
    }
    const open = value && clock(value.open);
    const close = value && clock(value.close);
    if (value && (!open || !close)) {
      return;
    }
    const time = value ? `${open}–${close}` : 'Closed';
    const previous = groups.at(-1);
    if (previous && previous.last === index - 1 && previous.time === time) {
      previous.last = index;
    } else {
      groups.push({ first: index, last: index, time });
    }
  });
  return groups.map(({ first, last, time }) => ({
    days: first === last ? LABELS[first]! : `${LABELS[first]}–${LABELS[last]}`,
    time,
  }));
}
