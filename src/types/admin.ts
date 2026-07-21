/**
 * Admin Dashboard Types
 *
 * Centralized type definitions for admin APIs and components.
 * Keeps UI and API response shapes in sync.
 */

import type { AppointmentStatus } from '@/models/Schema';

// Re-export so UI can import from here
export type { AppointmentStatus };

/**
 * Response shape for GET /api/admin/analytics
 */
export type AnalyticsResponse = {
  period: 'daily' | 'weekly' | 'monthly' | 'yearly';
  revenue: {
    total: number; // cents — final (net-of-tax) revenue; comp appointments count 0
    tips: number; // cents — total tips for completed appointments in the period
    taxCollected: number; // cents — tax collected in the period, reported separately from revenue
    trend: number; // percentage change from previous period
    completed: number; // count of completed appointments
    series: number[]; // revenue in cents bucketed evenly across the period
  };
  appointments: {
    total: number;
    completed: number;
    noShows: number;
    upcoming: number;
  };
  staff: Array<{
    id: string;
    name: string;
    role: string;
    avatarUrl: string | null;
    revenue: number; // cents
    appointmentCount: number;
    utilization: number; // 0-100 percentage
    color: string; // hex color for charts
  }>;
  services: Array<{
    label: string;
    percent: number; // 0-100
    color: string; // hex color
    count: number;
  }>;
  dateRange: {
    start: string; // ISO date string
    end: string; // ISO date string
  };
};

/**
 * Response shape for GET /api/salon/services (admin usage)
 */
export type ServiceResponse = {
  id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  descriptionItems?: string[] | null;
  price: number; // cents
  priceDisplayText?: string | null;
  durationMinutes: number;
  preparationBufferMinutes?: number;
  cleanupBufferMinutes?: number;
  category?: string | null;
  bookingCategory?: string | null;
  templateKey?: string | null;
  imageUrl?: string | null;
  sortOrder?: number | null;
  featuredOrder?: number | null;
  isActive: boolean | null;
  isIntroPrice?: boolean | null;
  introPriceLabel?: string | null;
  introPriceExpiresAt?: string | null;
  /** Enabled links to ACTIVE technicians; 0 ⇒ hidden from public booking. */
  assignedTechnicianCount?: number;
};

export type AddOnResponse = {
  id: string;
  name: string;
  slug: string;
  descriptionItems?: string[] | null;
  priceCents: number;
  priceDisplayText?: string | null;
  durationMinutes: number;
  category: string;
  pricingType: 'fixed' | 'per_unit';
  unitLabel?: string | null;
  maxQuantity?: number | null;
  displayOrder?: number | null;
  isActive: boolean | null;
  /** Catalog template this add-on came from; null for owner-created ones. */
  templateKey?: string | null;
  /**
   * Base services this add-on is offered under (service_add_on rows). Owners
   * edit this directly; clients only ever see an add-on after picking one of
   * these services.
   */
  compatibleServiceIds?: string[];
};

export type ServiceAddOnRuleResponse = {
  id: string;
  serviceId: string;
  addOnId: string;
  selectionMode: 'optional' | 'required' | 'conditional';
  defaultQuantity?: number | null;
  maxQuantityOverride?: number | null;
  displayOrder?: number | null;
};

/**
 * Response shape for GET /api/admin/clients
 */
export type SalonClientResponse = {
  id: string;
  phone: string;
  fullName: string | null;
  email: string | null;
  preferredTechnicianId: string | null;
  preferredTechnicianName: string | null;
  notes: string | null;
  lastVisitAt: string | null; // ISO date
  totalVisits: number;
  totalSpent: number; // cents
  noShowCount: number;
  loyaltyPoints: number;
  createdAt: string; // ISO date
};
