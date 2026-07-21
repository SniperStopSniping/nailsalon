/**
 * Canonical fixture data for the demo salon "Nail Salon No.5" (slug
 * nail-salon-no5).
 *
 * This salon is also the target of the Playwright suite (E2E_SALON_SLUG
 * defaults to nail-salon-no5), so the definitions live here rather than inside
 * scripts/seed.ts: both the full seed and the E2E fixture provisioner build the
 * same salon from one source. A drift between the two once left CI pointing at
 * a salon nothing could recreate.
 */
import type * as schema from '../../src/models/Schema';

export const SALON_ID = 'salon_nail-salon-no5';

export const SALON: schema.NewSalon = {
  id: SALON_ID,
  name: 'Nail Salon No.5',
  slug: 'nail-salon-no5',
  themeKey: 'nail-salon-no5',
  phone: '555-123-4567',
  email: 'hello@nailsalonno5.com',
  address: '123 Beauty Lane',
  city: 'Los Angeles',
  state: 'CA',
  zipCode: '90001',
  businessHours: {
    monday: { open: '09:00', close: '18:00' },
    tuesday: { open: '09:00', close: '18:00' },
    wednesday: { open: '09:00', close: '18:00' },
    thursday: { open: '09:00', close: '18:00' },
    friday: { open: '09:00', close: '18:00' },
    saturday: { open: '10:00', close: '17:00' },
    sunday: null,
  },
  policies: {
    cancellationHours: 24,
    noShowFee: 25,
    depositRequired: false,
    depositAmount: 0,
  },
  socialLinks: {
    instagram: 'nailsalonno5',
  },
  isActive: true,
};

// Services - prices in cents
export const SERVICES: schema.NewService[] = [
  {
    id: 'svc_biab-short',
    salonId: SALON_ID,
    name: 'BIAB Short',
    description: 'Builder In A Bottle for short natural nails. Long-lasting gel overlay.',
    price: 6500, // $65
    durationMinutes: 75,
    category: 'hands',
    imageUrl: '/assets/images/biab-short.webp',
    sortOrder: 1,
    isActive: true,
  },
  {
    id: 'svc_biab-medium',
    salonId: SALON_ID,
    name: 'BIAB Medium',
    description: 'Builder In A Bottle for medium length nails with shape customization.',
    price: 7500, // $75
    durationMinutes: 90,
    category: 'hands',
    imageUrl: '/assets/images/biab-medium.webp',
    sortOrder: 2,
    isActive: true,
  },
  {
    id: 'svc_gelx-extensions',
    salonId: SALON_ID,
    name: 'Gel-X Extensions',
    description: 'Full set of soft gel nail extensions with custom shape and length.',
    price: 9000, // $90
    durationMinutes: 105,
    category: 'hands',
    imageUrl: '/assets/images/gel-x-extensions.jpg',
    sortOrder: 3,
    isActive: true,
  },
  {
    id: 'svc_biab-french',
    salonId: SALON_ID,
    name: 'BIAB French',
    description: 'Classic French tip design with BIAB overlay for a timeless look.',
    price: 7500, // $75
    durationMinutes: 90,
    category: 'hands',
    imageUrl: '/assets/images/biab-french.jpg',
    sortOrder: 4,
    isActive: true,
  },
  {
    id: 'svc_spa-pedi',
    salonId: SALON_ID,
    name: 'SPA Pedicure',
    description: 'Relaxing spa pedicure with exfoliation, massage, and regular polish.',
    price: 6000, // $60
    durationMinutes: 60,
    category: 'feet',
    imageUrl: '/assets/images/biab-short.webp',
    sortOrder: 5,
    isActive: true,
  },
  {
    id: 'svc_gel-pedi',
    salonId: SALON_ID,
    name: 'Gel Pedicure',
    description: 'Full spa pedicure with long-lasting gel polish application.',
    price: 7000, // $70
    durationMinutes: 75,
    category: 'feet',
    imageUrl: '/assets/images/biab-medium.webp',
    sortOrder: 6,
    isActive: true,
  },
  {
    id: 'svc_biab-gelx-combo',
    salonId: SALON_ID,
    name: 'BIAB + Gel-X Combo',
    description: 'BIAB overlay on natural nails plus Gel-X extensions for extra length.',
    price: 13000, // $130
    durationMinutes: 150,
    category: 'combo',
    imageUrl: '/assets/images/gel-x-extensions.jpg',
    sortOrder: 7,
    isActive: true,
  },
  {
    id: 'svc_mani-pedi',
    salonId: SALON_ID,
    name: 'Classic Mani + Pedi',
    description: 'Complete hand and foot treatment with polish of your choice.',
    price: 9500, // $95
    durationMinutes: 120,
    category: 'combo',
    imageUrl: '/assets/images/biab-french.jpg',
    sortOrder: 8,
    isActive: true,
  },
];

const DANIELA_WEEKLY_SCHEDULE = {
  sunday: { start: '09:00', end: '21:00' },
  monday: { start: '09:00', end: '21:00' },
  tuesday: { start: '09:00', end: '21:00' },
  wednesday: { start: '09:00', end: '21:00' },
  thursday: { start: '09:00', end: '21:00' },
  friday: { start: '09:00', end: '21:00' },
  saturday: { start: '09:00', end: '21:00' },
};

// Technicians with weekly schedules
export const TECHNICIANS: schema.NewTechnician[] = [
  {
    id: 'tech_daniela',
    salonId: SALON_ID,
    name: 'Daniela',
    bio: '5 years of experience specializing in BIAB and Gel-X extensions. Known for intricate nail art designs.',
    avatarUrl: '/assets/images/tech-daniela.jpeg',
    specialties: ['BIAB', 'Gel-X', 'French'],
    rating: '4.8',
    reviewCount: 127,
    weeklySchedule: DANIELA_WEEKLY_SCHEDULE,
    // Legacy fields
    workDays: [0, 1, 2, 3, 4, 5, 6],
    startTime: '09:00',
    endTime: '21:00',
    isActive: true,
  },
  {
    id: 'tech_tiffany',
    salonId: SALON_ID,
    name: 'Tiffany',
    bio: '3 years of experience with a focus on natural nail health and gel manicures.',
    avatarUrl: '/assets/images/tech-tiffany.jpeg',
    specialties: ['BIAB', 'Gel Manicure'],
    rating: '4.9',
    reviewCount: 203,
    weeklySchedule: {
      sunday: null, // Day off
      monday: { start: '10:00', end: '19:00' },
      tuesday: { start: '10:00', end: '19:00' },
      wednesday: { start: '10:00', end: '19:00' },
      thursday: { start: '10:00', end: '19:00' },
      friday: { start: '10:00', end: '19:00' },
      saturday: { start: '10:00', end: '17:00' },
    },
    // Legacy fields
    workDays: [1, 2, 3, 4, 5, 6], // Mon-Sat
    startTime: '10:00',
    endTime: '19:00',
    isActive: true,
  },
  {
    id: 'tech_jenny',
    salonId: SALON_ID,
    name: 'Jenny',
    bio: '4 years of experience specializing in Gel-X extensions and luxury pedicures.',
    avatarUrl: '/assets/images/tech-jenny.jpeg',
    specialties: ['Gel-X', 'Pedicure'],
    rating: '4.7',
    reviewCount: 89,
    weeklySchedule: {
      sunday: null, // Day off
      monday: null, // Day off
      tuesday: { start: '09:00', end: '17:00' },
      wednesday: { start: '09:00', end: '17:00' },
      thursday: { start: '09:00', end: '17:00' },
      friday: { start: '09:00', end: '17:00' },
      saturday: { start: '10:00', end: '16:00' },
    },
    // Legacy fields
    workDays: [2, 3, 4, 5, 6], // Tue-Sat
    startTime: '09:00',
    endTime: '17:00',
    isActive: true,
  },
];
