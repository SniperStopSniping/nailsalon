export type GoogleCalendarAttendee = {
  email: string;
  displayName?: string | null;
  organizer?: boolean;
  self?: boolean;
};

export type GoogleEventContact = {
  fullName: string | null;
  phone: string;
  email: string | null;
};

function normalizePhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10) {
    return digits;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return digits.slice(1);
  }
  return null;
}

export function parseGoogleEventTitle(title: string | null | undefined): {
  clientName: string | null;
  serviceName: string | null;
} {
  const normalized = title?.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return { clientName: null, serviceName: null };
  }

  const lower = normalized.toLowerCase();
  const betweenIndex = lower.lastIndexOf(' between ');
  const betweenText = betweenIndex >= 0 ? normalized.slice(betweenIndex + ' between '.length) : '';
  const andIndex = betweenText.toLowerCase().lastIndexOf(' and ');
  const clientName = andIndex >= 0 ? betweenText.slice(andIndex + ' and '.length).trim() : null;

  let serviceName = (betweenIndex >= 0 ? normalized.slice(0, betweenIndex) : normalized).trim();
  for (const separator of [' — ', ' – ', ' - ']) {
    const separatorIndex = serviceName.lastIndexOf(separator);
    if (separatorIndex >= 0 && serviceName.slice(separatorIndex + separator.length).toLowerCase().startsWith('from $')) {
      serviceName = serviceName.slice(0, separatorIndex).trim();
      break;
    }
  }

  return {
    clientName: clientName || null,
    serviceName: serviceName || null,
  };
}

export function extractGoogleEventContact(
  attendees: GoogleCalendarAttendee[] | null | undefined,
  title: string | null | undefined,
): GoogleEventContact | null {
  const guests = (attendees ?? []).filter(attendee => !attendee.organizer && !attendee.self);
  const phoneCandidates = [...new Set(guests.flatMap((attendee) => {
    const smsMatch = attendee.email.trim().match(/^([^@]+)@sms\.cal\.com$/i);
    const phone = smsMatch ? normalizePhone(smsMatch[1]!) : null;
    return phone ? [phone] : [];
  }))];
  const emailCandidates = [...new Set(guests
    .map(attendee => attendee.email.trim().toLowerCase())
    .filter(email => email && !email.endsWith('@sms.cal.com')))];
  const displayNames = [...new Set(guests
    .map(attendee => attendee.displayName?.trim())
    .filter((name): name is string => Boolean(name)))];
  const parsedTitle = parseGoogleEventTitle(title);

  const phone = phoneCandidates.length === 1 ? phoneCandidates[0]! : '';
  const email = emailCandidates.length === 1 ? emailCandidates[0]! : null;
  const fullName = displayNames.length === 1 ? displayNames[0]! : parsedTitle.clientName;

  return phone || email || fullName ? { fullName, phone, email } : null;
}
