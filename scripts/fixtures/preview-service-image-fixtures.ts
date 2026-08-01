export const PREVIEW_FIXTURE_NAMESPACE = 'luster-preview-service-images-v1';
export const PREVIEW_FIXTURE_VERSION = 'service-images-v1';
const FIXED_AT = '2026-01-15T12:00:00.000Z';
const HOURS = Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map(day => [day, { open: '09:00', close: '18:00' }]));
const SCHEDULE = Object.fromEntries(Object.entries(HOURS).map(([day, hours]) => [day, { start: hours.open, end: hours.close }]));
const SALON_IDS = ['0bd11f23-f734-4918-a7c6-3c18e62892be', 'd0e3c445-9da6-4ded-b9fb-babe0dd92318'];
const LOCATION_IDS = ['83333e25-9d0f-4548-89a4-b79244daa3ba', '0806a71a-a2da-40fc-8fb0-2019db146b4f'];
const TECHNICIAN_IDS = ['7204d39d-53e6-4f20-bcfc-fe15d936b847', 'b87d1c58-ca30-4c5c-83a0-397b0af11daf'];
const ADD_ON_IDS = ['81811c4e-e3fe-4828-8ec0-58cb9a433eb3', 'ce32d65a-6ce6-4e9f-a26b-1729a4a3bf35'];
const RULE_IDS = ['2e7cf516-0313-4559-8b8d-3583e8c372e0', '34168416-6b0b-445d-8db4-baf17c7635ec'];
const SERVICE_IDS = [
  ['29f0bee5-23ec-4791-a907-2da8c398413a', '35d2754a-9f5a-4b4c-a1df-2095d5ba66cc', '0e64c625-ebfa-4967-a11c-6f3b985a6438', 'f380fbc2-7a44-4484-bf62-0a98b7104594', '0e50ea5d-6aa7-423a-bc1f-2691e4f07c05', '09b9fced-7931-41a9-824b-d2a29ceafb83'],
  ['9635b367-41bd-4476-8e3a-1d05d115fe17', '0da3c507-3cfa-48ec-880c-6560d5bae682', 'bb31ff14-3415-44ce-abc3-65e6c53f69f5', '96c032a8-0614-429c-9c63-b2d479e32e3f', 'f1b08013-a958-4f9f-8c16-7f6815c12071', '5ecd898b-c58b-45fc-9e0e-84d6d776f9ba'],
];
const CATALOG = [
  { key: 'best-value-combination', name: 'Synthetic Preview Hands and Feet Combination', category: 'combo', booking: 'combo', price: 12900, duration: 120, featured: 1, image: '/assets/images/services/combo-french-luster.webp' },
  { key: 'featured-manicure', name: 'Synthetic Preview Featured Manicure', category: 'manicure', booking: 'manicure', price: 7200, duration: 75, featured: 2, image: '/assets/images/services/manicure-french.webp' },
  { key: 'regular-manicure', name: 'Synthetic Preview Regular Gel Manicure', category: 'manicure', booking: 'manicure', price: 6400, duration: 60, featured: null, image: '/assets/images/services/manicure-gel-nude.webp' },
  { key: 'long-name-manicure', name: 'Synthetic Preview Extra-Long Sculpted Gel Manicure with Detailed Fixture Finish', category: 'builder_gel', booking: 'manicure', price: 8800, duration: 90, featured: null, image: '/assets/images/services/manicure-builder-overlay.webp' },
  { key: 'intro-manicure', name: 'Synthetic Preview Introductory Manicure', category: 'manicure', booking: 'manicure', price: 5400, duration: 60, featured: null, image: '/assets/images/services/manicure-luster-pearl.webp', intro: true },
  { key: 'normal-pedicure', name: 'Synthetic Preview Classic Pedicure', category: 'pedicure', booking: 'pedicure', price: 6900, duration: 70, featured: null, image: '/assets/images/services/pedicure-red-classic.webp' },
] as const;
const salons = SALON_IDS.map((id, index) => ({
  id,
  name: `Synthetic Preview Image ${index === 0 ? 'Default' : 'Off'} Salon`,
  slug: `synthetic-preview-service-images-${index === 0 ? 'default' : 'off'}-v1`,
  theme_key: 'nail-salon-no5',
  phone: `+1202555011${index + 1}`,
  email: `salon-${index === 0 ? 'default' : 'off'}@preview-fixtures.invalid`,
  address: `${101 + index} Fixture Only Lane`,
  city: 'Synthetic Preview City',
  state: 'ZZ',
  zip_code: '00000',
  business_hours: HOURS,
  policies: { cancellationHours: 24, noShowFee: 0, depositRequired: false, depositAmount: 0 },
  billing_mode: 'NONE',
  status: 'active',
  publication_status: 'published',
  published_at: FIXED_AT,
  free_solo_enabled: true,
  online_booking_enabled: true,
  settings: { booking: { timezone: 'America/Toronto' }, merchandising: { featureLusterManicure: false, ...(index === 1 ? { showServiceImages: false } : {}) } },
  features: { booking: { onlineBooking: true } },
  internal_notes: PREVIEW_FIXTURE_NAMESPACE,
  is_active: true,
  deleted_at: null,
  owner_clerk_user_id: null,
  created_at: FIXED_AT,
  updated_at: FIXED_AT,
}));
const services = SALON_IDS.flatMap((salon_id, salonIndex) => CATALOG.map((item, index) => ({
  id: SERVICE_IDS[salonIndex]![index]!,
  salon_id,
  name: item.name,
  description: 'Synthetic Preview-only visual verification record.',
  description_items: ['Synthetic fixture content only.'],
  slug: `synthetic-preview-${item.key}-v1`,
  price: item.price,
  duration_minutes: item.duration,
  is_intro_price: 'intro' in item,
  intro_price_label: 'intro' in item ? 'Intro price' : null,
  intro_price_expires_at: null,
  category: item.category,
  booking_category: item.booking,
  template_key: null,
  image_url: item.image,
  sort_order: index + 1,
  featured_order: item.featured,
  is_active: true,
  created_at: FIXED_AT,
  updated_at: FIXED_AT,
})));
export const PREVIEW_SERVICE_IMAGE_FIXTURE = {
  salons,
  locations: SALON_IDS.map((salon_id, index) => ({ id: LOCATION_IDS[index]!, salon_id, name: 'Synthetic Preview Primary Location', address: `${101 + index} Fixture Only Lane`, city: 'Synthetic Preview City', state: 'ZZ', zip_code: '00000', phone: `+1202555011${index + 1}`, email: `location-${index + 1}@preview-fixtures.invalid`, business_hours: HOURS, is_primary: true, is_active: true, created_at: FIXED_AT, updated_at: FIXED_AT })),
  services,
  technicians: SALON_IDS.map((salon_id, index) => ({ id: TECHNICIAN_IDS[index]!, salon_id, name: `Synthetic Preview Technician ${index + 1}`, bio: 'Synthetic Preview-only technician.', avatar_url: '/assets/images/fixtures/preview-technician-avatar.svg', email: `technician-${index + 1}@preview-fixtures.invalid`, phone: `+1202555012${index + 1}`, role: 'tech', specialties: ['Synthetic fixture services'], weekly_schedule: SCHEDULE, work_days: [0, 1, 2, 3, 4, 5, 6], start_time: '09:00', end_time: '18:00', primary_location_id: LOCATION_IDS[index]!, accepting_new_clients: true, is_active: true, created_at: FIXED_AT, updated_at: FIXED_AT })),
  assignments: SALON_IDS.flatMap((_salon, salonIndex) => SERVICE_IDS[salonIndex]!.map((service_id, index) => ({ technician_id: TECHNICIAN_IDS[salonIndex]!, service_id, priority: index, enabled: true }))),
  addOns: SALON_IDS.map((salon_id, index) => ({ id: ADD_ON_IDS[index]!, salon_id, name: 'Synthetic Preview Nail Art Add-on', slug: 'synthetic-preview-nail-art-addon-v1', category: 'nail_art', description_items: ['Synthetic fixture add-on.'], price_cents: 1200, duration_minutes: 10, pricing_type: 'fixed', max_quantity: 1, is_active: true, display_order: 1, created_at: FIXED_AT, updated_at: FIXED_AT })),
  rules: SALON_IDS.map((salon_id, index) => ({ id: RULE_IDS[index]!, salon_id, service_id: SERVICE_IDS[index]![2]!, add_on_id: ADD_ON_IDS[index]!, selection_mode: 'optional', default_quantity: null, max_quantity_override: 1, display_order: 1, created_at: FIXED_AT, updated_at: FIXED_AT })),
  admin: { id: '89a795b7-824c-4e1e-89a7-8c1f4f3455e3', phone_e164: '+12025550199', clerk_user_id: null, name: 'Synthetic Preview Fixture Owner', email: 'owner@preview-fixtures.invalid', is_super_admin: false, created_at: FIXED_AT, updated_at: FIXED_AT },
  memberships: SALON_IDS.map(salon_id => ({ admin_id: '89a795b7-824c-4e1e-89a7-8c1f4f3455e3', salon_id, role: 'owner', created_at: FIXED_AT })),
};
export const PREVIEW_FIXTURE_COUNTS = { salons: 2, locations: 2, services: 12, technicians: 2, assignments: 12, addOns: 2, rules: 2, admins: 1, memberships: 2 } as const;
