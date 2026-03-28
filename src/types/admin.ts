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
    total: number; // cents
    trend: number; // percentage change from previous period
    completed: number; // count of completed appointments
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
  category?: string | null;
  imageUrl?: string | null;
  sortOrder?: number | null;
  isActive: boolean | null;
  isIntroPrice?: boolean | null;
  introPriceLabel?: string | null;
  introPriceExpiresAt?: string | null;
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
