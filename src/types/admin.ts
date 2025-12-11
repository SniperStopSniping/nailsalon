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
export interface AnalyticsResponse {
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
}

/**
 * Response shape for GET /api/salon/services (admin usage)
 */
export interface ServiceResponse {
  id: string;
  name: string;
  description?: string | null;
  price: number; // cents
  durationMinutes: number;
  category?: string | null;
  imageUrl?: string | null;
  sortOrder?: number | null;
  isActive: boolean | null;
}

/**
 * Response shape for GET /api/admin/clients
 */
export interface SalonClientResponse {
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
}
