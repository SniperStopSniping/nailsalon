import messages from '@/locales/en.json';

export const useTranslations = () => (key: string, values?: Record<string, string | number>) => {
  const copy = messages.BookingConfirmation[key as keyof typeof messages.BookingConfirmation] ?? key;
  return Object.entries(values ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), copy);
};
