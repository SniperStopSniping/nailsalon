'use client';

import { X, Building2, Users, Calendar, UserCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { SalonPlan, SalonStatus } from '@/models/Schema';

// =============================================================================
// Types
// =============================================================================

interface SalonDetail {
  id: string;
  name: string;
  slug: string;
  plan: SalonPlan;
  status: SalonStatus;
  maxLocations: number;
  isMultiLocationEnabled: boolean;
  ownerEmail: string | null;
  ownerClerkUserId: string | null;
  internalNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SalonMetrics {
  locationsCount: number;
  techsCount: number;
  clientsCount: number;
  appointmentsLast30d: number;
}

interface SalonDetailPanelProps {
  salonId: string;
  onClose: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function SalonDetailPanel({ salonId, onClose }: SalonDetailPanelProps) {
  const [salon, setSalon] = useState<SalonDetail | null>(null);
  const [metrics, setMetrics] = useState<SalonMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [plan, setPlan] = useState<SalonPlan>('single_salon');
  const [status, setStatus] = useState<SalonStatus>('active');
  const [maxLocations, setMaxLocations] = useState(1);
  const [isMultiLocationEnabled, setIsMultiLocationEnabled] = useState(false);
  const [internalNotes, setInternalNotes] = useState('');

  // Fetch salon details
  const fetchSalon = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/super-admin/organizations/${salonId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch salon');
      }

      const data = await response.json();
      setSalon(data.salon);
      setMetrics(data.metrics);

      // Populate form
      setName(data.salon.name);
      setPlan(data.salon.plan);
      setStatus(data.salon.status);
      setMaxLocations(data.salon.maxLocations);
      setIsMultiLocationEnabled(data.salon.isMultiLocationEnabled);
      setInternalNotes(data.salon.internalNotes || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [salonId]);

  useEffect(() => {
    fetchSalon();
  }, [fetchSalon]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/super-admin/organizations/${salonId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          plan,
          status,
          maxLocations,
          isMultiLocationEnabled,
          internalNotes: internalNotes || null,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update salon');
      }

      const data = await response.json();
      setSalon(data.salon);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  // Handle plan change
  const handlePlanChange = (newPlan: SalonPlan) => {
    setPlan(newPlan);
    if (newPlan === 'single_salon' || newPlan === 'free') {
      setMaxLocations(1);
      setIsMultiLocationEnabled(false);
    } else if (newPlan === 'multi_salon' && maxLocations < 2) {
      setMaxLocations(2);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-white shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Salon Details</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="p-2 -m-2 text-gray-400 hover:text-gray-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : error && !salon ? (
            <div className="p-6 text-center text-red-600">{error}</div>
          ) : salon && metrics ? (
            <div className="p-6 space-y-6">
              {error && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}

              {/* Overview Section */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">
                  Overview
                </h3>

                {/* Name */}
                <div className="mb-4">
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                    Salon Name
                  </label>
                  <input
                    type="text"
                    id="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
                </div>

                {/* Slug (read-only) */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Slug
                  </label>
                  <div className="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
                    {salon.slug}
                  </div>
                </div>

                {/* Owner */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Owner Email
                  </label>
                  <div className="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
                    {salon.ownerEmail || '—'}
                  </div>
                </div>

                {/* Created */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Created
                  </label>
                  <div className="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
                    {new Date(salon.createdAt).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    })}
                  </div>
                </div>

                {/* Metrics */}
                <div className="grid grid-cols-4 gap-3">
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <Building2 className="w-5 h-5 text-gray-400 mx-auto mb-1" />
                    <div className="text-lg font-semibold text-gray-900">{metrics.locationsCount}</div>
                    <div className="text-xs text-gray-500">Locations</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <Users className="w-5 h-5 text-gray-400 mx-auto mb-1" />
                    <div className="text-lg font-semibold text-gray-900">{metrics.techsCount}</div>
                    <div className="text-xs text-gray-500">Techs</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <UserCheck className="w-5 h-5 text-gray-400 mx-auto mb-1" />
                    <div className="text-lg font-semibold text-gray-900">{metrics.clientsCount}</div>
                    <div className="text-xs text-gray-500">Clients</div>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <Calendar className="w-5 h-5 text-gray-400 mx-auto mb-1" />
                    <div className="text-lg font-semibold text-gray-900">{metrics.appointmentsLast30d}</div>
                    <div className="text-xs text-gray-500">Appts (30d)</div>
                  </div>
                </div>
              </div>

              {/* Plan & Limits Section */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">
                  Plan & Limits
                </h3>

                {/* Plan */}
                <div className="mb-4">
                  <label htmlFor="plan" className="block text-sm font-medium text-gray-700 mb-1">
                    Plan
                  </label>
                  <select
                    id="plan"
                    value={plan}
                    onChange={(e) => handlePlanChange(e.target.value as SalonPlan)}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                  >
                    <option value="free">Free</option>
                    <option value="single_salon">Single Salon</option>
                    <option value="multi_salon">Multi Salon</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                </div>

                {/* Max Locations */}
                <div className="mb-4">
                  <label htmlFor="maxLocations" className="block text-sm font-medium text-gray-700 mb-1">
                    Max Locations
                  </label>
                  <input
                    type="number"
                    id="maxLocations"
                    value={maxLocations}
                    onChange={(e) => setMaxLocations(Math.max(1, parseInt(e.target.value) || 1))}
                    min={1}
                    disabled={plan === 'single_salon' || plan === 'free'}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500"
                  />
                </div>

                {/* Multi-location toggle */}
                <div className="flex items-center justify-between py-2">
                  <div>
                    <div className="text-sm font-medium text-gray-700">Multi-location Features</div>
                    <div className="text-xs text-gray-500">Enable multi-location UI and features</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isMultiLocationEnabled}
                    onClick={() => setIsMultiLocationEnabled(!isMultiLocationEnabled)}
                    disabled={plan === 'single_salon' || plan === 'free'}
                    aria-label="Toggle multi-location features"
                    className={`relative w-11 h-6 rounded-full transition-colors ${
                      isMultiLocationEnabled ? 'bg-indigo-600' : 'bg-gray-200'
                    } ${plan === 'single_salon' || plan === 'free' ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <div
                      className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                        isMultiLocationEnabled ? 'translate-x-5' : ''
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Status & Notes Section */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-4">
                  Status & Notes
                </h3>

                {/* Status */}
                <div className="mb-4">
                  <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">
                    Status
                  </label>
                  <select
                    id="status"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as SalonStatus)}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="trial">Trial</option>
                    <option value="suspended">Suspended</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>

                {/* Internal Notes */}
                <div>
                  <label htmlFor="internalNotes" className="block text-sm font-medium text-gray-700 mb-1">
                    Internal Notes
                  </label>
                  <textarea
                    id="internalNotes"
                    value={internalNotes}
                    onChange={(e) => setInternalNotes(e.target.value)}
                    rows={4}
                    placeholder="Private notes only visible to super admins..."
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                  />
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        {salon && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !name}
              className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {saving && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              Save Changes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
