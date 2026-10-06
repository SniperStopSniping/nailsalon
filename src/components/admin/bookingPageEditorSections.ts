import { Building2, Check, Images, LayoutTemplate, ListOrdered, MessageSquare, Palette, ShieldCheck, Type, UserRound } from 'lucide-react';

export const BOOKING_PAGE_EDITORS = {
  business: { title: 'Business Information', description: 'Salon name, contact, address and arrival details', icon: Building2 },
  text: { title: 'About & Website Text', description: 'Your introduction and bio', icon: Type },
  gallery: { title: 'Photos & Gallery', description: 'Logo, profile, cover and shared Portfolio', icon: Images },
  experience: { title: 'Booking Messages & Social Links', description: 'Booking message, social links and confirmation text', icon: MessageSquare },
  layouts: { title: 'Layout & Menu', description: 'Page layout and how your booking menu appears', icon: LayoutTemplate },
  appearance: { title: 'Style, Colours & Fonts', description: 'Fonts, colours and overall look', icon: Palette },
  information: { title: 'What Clients See', description: 'Choose which saved business details customers see', icon: UserRound },
  policies: { title: 'Policies Display', description: 'Show policies and open their canonical editor', icon: ShieldCheck },
  flow: { title: 'Booking Flow', description: 'Service, technician, date/time and confirmation order', icon: ListOrdered },
  publish: { title: 'Preview & Publish', description: 'Review your saved draft and publish page changes', icon: Check },
} as const;

export type BookingPagePanel = keyof typeof BOOKING_PAGE_EDITORS;

export const BOOKING_PAGE_GROUPS: ReadonlyArray<{ id: string; title: string; panels: readonly BookingPagePanel[] }> = [
  { id: 'content', title: 'Business profile & content', panels: ['business', 'text', 'gallery', 'experience'] },
  { id: 'design', title: 'Design', panels: ['layouts', 'appearance'] },
  { id: 'visibility', title: 'Visibility & booking', panels: ['information', 'policies', 'flow'] },
  { id: 'publish', title: 'Preview & publish', panels: ['publish'] },
];

export function isBookingPagePanel(value: string | null): value is BookingPagePanel {
  return value !== null && Object.hasOwn(BOOKING_PAGE_EDITORS, value);
}
