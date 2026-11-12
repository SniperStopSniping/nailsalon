/** Custom-message fields are resolved before review and stored per recipient. */
export const CLIENT_MESSAGE_FIELDS = ['first_name', 'booking_link', 'salon_name'] as const;

export function hasUnfilledMessageFields(message: string): boolean {
  return /\{\{|\}\}/.test(message);
}

export function unsupportedMessageFields(message: string): boolean {
  if (/\{\{\{|\}\}\}/.test(message)) {
    return true;
  }
  return hasUnfilledMessageFields(message.replace(/\{\{\s*(?:first_name|booking_link|salon_name)\s*\}\}/g, ''));
}

export function personalizeClientMessage(message: string, input: { fullName: string | null; bookingUrl: string; salonName: string }): string {
  const firstName = input.fullName?.trim().split(/\s+/)[0] || 'there';
  const fields = { first_name: firstName, booking_link: input.bookingUrl, salon_name: input.salonName };
  return message.replace(/\{\{\s*(first_name|booking_link|salon_name)\s*\}\}/g, (_, field: keyof typeof fields) => fields[field]);
}
