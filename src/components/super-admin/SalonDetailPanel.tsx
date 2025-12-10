'use client';

import {
  X,
  Building2,
  Users,
  Calendar,
  UserCheck,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Download,
  RefreshCw,
  Trash2,
  MapPin,
  History,
  AlertTriangle,
  UserCog,
  Play,
  Pause,
  ToggleRight,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import type { SalonPlan, SalonStatus } from '@/models/Schema';

import { UserSearchModal } from './UserSearchModal';
import { ResetDataModal } from './ResetDataModal';
import { DeleteSalonModal } from './DeleteSalonModal';
import { AuditLogTable } from './AuditLogTable';
import { LocationForm } from './LocationForm';

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
  // Feature toggles
  onlineBookingEnabled: boolean;
  smsRemindersEnabled: boolean;
  rewardsEnabled: boolean;
  profilePageEnabled: boolean;
  // Owner & metadata
  ownerEmail: string | null;
  ownerClerkUserId: string | null;
  internalNotes: string | null;
  deletedAt: string | null;
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
  onDeleted?: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function SalonDetailPanel({ salonId, onClose, onDeleted }: SalonDetailPanelProps) {
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

  // Feature toggle state
  const [onlineBookingEnabled, setOnlineBookingEnabled] = useState(true);
  const [smsRemindersEnabled, setSmsRemindersEnabled] = useState(true);
  const [rewardsEnabled, setRewardsEnabled] = useState(true);
  const [profilePageEnabled, setProfilePageEnabled] = useState(true);

  // Save button states
  const [isDirty, setIsDirty] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Collapsed sections
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    overview: true,
    plan: true,
    features: true,
    status: true,
    ownership: false,
    locations: false,
    dataManagement: false,
    activityLog: false,
    dangerZone: false,
  });

  // Modal states
  const [showUserSearch, setShowUserSearch] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showLocationForm, setShowLocationForm] = useState(false);

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

      // Populate feature toggles
      setOnlineBookingEnabled(data.salon.onlineBookingEnabled ?? true);
      setSmsRemindersEnabled(data.salon.smsRemindersEnabled ?? true);
      setRewardsEnabled(data.salon.rewardsEnabled ?? true);
      setProfilePageEnabled(data.salon.profilePageEnabled ?? true);
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
    setJustSaved(false);

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
          // Feature toggles
          onlineBookingEnabled,
          smsRemindersEnabled,
          rewardsEnabled,
          profilePageEnabled,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update salon');
      }

      const data = await response.json();
      setSalon(data.salon);
      
      // Mark form as clean and show "Saved" feedback
      setIsDirty(false);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  // Handle plan change
  const handlePlanChange = (newPlan: SalonPlan) => {
    setPlan(newPlan);
    setIsDirty(true);
    setJustSaved(false);
    if (newPlan === 'single_salon' || newPlan === 'free') {
      setMaxLocations(1);
      setIsMultiLocationEnabled(false);
    } else if (newPlan === 'multi_salon' && maxLocations < 2) {
      setMaxLocations(2);
    }
  };

  // Helper to mark form as dirty
  const markDirty = () => {
    setIsDirty(true);
    setJustSaved(false);
  };

  // Handle owner change
  const handleOwnerChange = async (user: { id: string; email: string | null }) => {
    if (!user.email) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/super-admin/organizations/${salonId}/change-owner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clerkUserId: user.id,
          email: user.email,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to change owner');
      }

      await fetchSalon();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  // Handle restore
  const handleRestore = async () => {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/super-admin/organizations/${salonId}/restore`, {
        method: 'POST',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to restore salon');
      }

      await fetchSalon();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  // Handle impersonate
  const handleImpersonate = async () => {
    try {
      const response = await fetch('/api/super-admin/impersonate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ salonId }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to start impersonation');
      }

      const data = await response.json();
      window.open(data.redirectUrl, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  // Handle export
  const handleExport = async (format: 'json' | 'csv') => {
    try {
      const response = await fetch(
        `/api/super-admin/organizations/${salonId}/export?format=${format}`
      );

      if (!response.ok) {
        throw new Error('Failed to export data');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${salon?.slug || 'salon'}-export.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    }
  };

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const isDeleted = !!salon?.deletedAt;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 w-full max-w-xl bg-white shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Salon Details</h2>
            {salon && (
              <p className="text-sm text-gray-500">{salon.slug}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {salon && !isDeleted && (
              <button
                type="button"
                onClick={handleImpersonate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Impersonate
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close panel"
              className="p-2 -m-2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
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
            <div className="p-6 space-y-4">
              {error && (
                <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-red-700 text-sm">
                  {error}
                </div>
              )}

              {/* Deleted Banner */}
              {isDeleted && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="w-5 h-5 text-red-600" />
                      <div>
                        <div className="font-medium text-red-900">Salon Deleted</div>
                        <div className="text-sm text-red-700">
                          Deleted on {new Date(salon.deletedAt!).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleRestore}
                      disabled={saving}
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-white text-red-700 text-sm font-medium rounded-lg border border-red-200 hover:bg-red-50 disabled:opacity-50 transition-colors"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Restore
                    </button>
                  </div>
                </div>
              )}

              {/* Overview Section */}
              <CollapsibleSection
                title="Overview"
                icon={<Building2 className="w-4 h-4" />}
                expanded={expandedSections.overview ?? true}
                onToggle={() => toggleSection('overview')}
              >
                {/* Name */}
                <div className="mb-4">
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                    Salon Name
                  </label>
                  <input
                    type="text"
                    id="name"
                    value={name}
                    onChange={(e) => { setName(e.target.value); markDirty(); }}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  />
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
              </CollapsibleSection>

              {/* Plan & Limits Section */}
              <CollapsibleSection
                title="Plan & Limits"
                icon={<Building2 className="w-4 h-4" />}
                expanded={expandedSections.plan ?? true}
                onToggle={() => toggleSection('plan')}
              >
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
                    onChange={(e) => { setMaxLocations(Math.max(1, parseInt(e.target.value) || 1)); markDirty(); }}
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
                    onClick={() => { setIsMultiLocationEnabled(!isMultiLocationEnabled); markDirty(); }}
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
              </CollapsibleSection>

              {/* Features Section */}
              <CollapsibleSection
                title="Features"
                icon={<ToggleRight className="w-4 h-4" />}
                expanded={expandedSections.features ?? true}
                onToggle={() => toggleSection('features')}
              >
                <div className="space-y-4">
                  {/* Online Booking Toggle */}
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <div className="text-sm font-medium text-gray-700">Online Booking</div>
                      <div className="text-xs text-gray-500">Allow clients to book online</div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={onlineBookingEnabled}
                      onClick={() => { setOnlineBookingEnabled(!onlineBookingEnabled); markDirty(); }}
                      aria-label="Toggle online booking"
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        onlineBookingEnabled ? 'bg-indigo-600' : 'bg-gray-200'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                          onlineBookingEnabled ? 'translate-x-5' : ''
                        }`}
                      />
                    </button>
                  </div>

                  {/* SMS Reminders Toggle */}
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <div className="text-sm font-medium text-gray-700">SMS Reminders</div>
                      <div className="text-xs text-gray-500">Send SMS confirmations & reminders</div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={smsRemindersEnabled}
                      onClick={() => { setSmsRemindersEnabled(!smsRemindersEnabled); markDirty(); }}
                      aria-label="Toggle SMS reminders"
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        smsRemindersEnabled ? 'bg-indigo-600' : 'bg-gray-200'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                          smsRemindersEnabled ? 'translate-x-5' : ''
                        }`}
                      />
                    </button>
                  </div>

                  {/* Rewards Program Toggle */}
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <div className="text-sm font-medium text-gray-700">Rewards Program</div>
                      <div className="text-xs text-gray-500">Let this salon use the rewards system</div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={rewardsEnabled}
                      onClick={() => { setRewardsEnabled(!rewardsEnabled); markDirty(); }}
                      aria-label="Toggle rewards program"
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        rewardsEnabled ? 'bg-indigo-600' : 'bg-gray-200'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                          rewardsEnabled ? 'translate-x-5' : ''
                        }`}
                      />
                    </button>
                  </div>

                  {/* Public Profile Toggle */}
                  <div className="flex items-center justify-between py-2">
                    <div>
                      <div className="text-sm font-medium text-gray-700">Public Profile</div>
                      <div className="text-xs text-gray-500">Show public profile / mini-site for this salon</div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={profilePageEnabled}
                      onClick={() => { setProfilePageEnabled(!profilePageEnabled); markDirty(); }}
                      aria-label="Toggle public profile"
                      className={`relative w-11 h-6 rounded-full transition-colors ${
                        profilePageEnabled ? 'bg-indigo-600' : 'bg-gray-200'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                          profilePageEnabled ? 'translate-x-5' : ''
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </CollapsibleSection>

              {/* Status Section */}
              <CollapsibleSection
                title="Status & Notes"
                icon={status === 'suspended' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                expanded={expandedSections.status ?? true}
                onToggle={() => toggleSection('status')}
              >
                {/* Status */}
                <div className="mb-4">
                  <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">
                    Status
                  </label>
                  <select
                    id="status"
                    value={status}
                    onChange={(e) => { setStatus(e.target.value as SalonStatus); markDirty(); }}
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
                    onChange={(e) => { setInternalNotes(e.target.value); markDirty(); }}
                    rows={3}
                    placeholder="Private notes only visible to super admins..."
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                  />
                </div>
              </CollapsibleSection>

              {/* Ownership Section */}
              <CollapsibleSection
                title="Ownership"
                icon={<UserCog className="w-4 h-4" />}
                expanded={expandedSections.ownership ?? false}
                onToggle={() => toggleSection('ownership')}
              >
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Owner Email
                    </label>
                    <div className="px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-600">
                      {salon.ownerEmail || '—'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowUserSearch(true)}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <UserCog className="w-4 h-4" />
                    Change Owner
                  </button>
                </div>
              </CollapsibleSection>

              {/* Locations Section */}
              <CollapsibleSection
                title="Locations"
                icon={<MapPin className="w-4 h-4" />}
                expanded={expandedSections.locations ?? false}
                onToggle={() => toggleSection('locations')}
                badge={`${metrics.locationsCount}/${maxLocations}`}
              >
                <button
                  type="button"
                  onClick={() => setShowLocationForm(true)}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <MapPin className="w-4 h-4" />
                  Manage Locations
                </button>
              </CollapsibleSection>

              {/* Data Management Section */}
              <CollapsibleSection
                title="Data Management"
                icon={<Download className="w-4 h-4" />}
                expanded={expandedSections.dataManagement ?? false}
                onToggle={() => toggleSection('dataManagement')}
              >
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleExport('json')}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Export JSON
                    </button>
                    <button
                      type="button"
                      onClick={() => handleExport('csv')}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Export CSV
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowResetModal(true)}
                    className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 border border-amber-200 bg-amber-50 text-amber-700 text-sm font-medium rounded-lg hover:bg-amber-100 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Reset Data
                  </button>
                </div>
              </CollapsibleSection>

              {/* Activity Log Section */}
              <CollapsibleSection
                title="Activity Log"
                icon={<History className="w-4 h-4" />}
                expanded={expandedSections.activityLog ?? false}
                onToggle={() => toggleSection('activityLog')}
              >
                <AuditLogTable salonId={salonId} limit={5} />
              </CollapsibleSection>

              {/* Danger Zone */}
              <CollapsibleSection
                title="Danger Zone"
                icon={<AlertTriangle className="w-4 h-4" />}
                expanded={expandedSections.dangerZone ?? false}
                onToggle={() => toggleSection('dangerZone')}
                variant="danger"
              >
                <div className="space-y-3">
                  {!isDeleted && (
                    <button
                      type="button"
                      onClick={() => setShowDeleteModal(true)}
                      className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 border border-red-200 bg-red-50 text-red-700 text-sm font-medium rounded-lg hover:bg-red-100 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete Salon
                    </button>
                  )}
                  {isDeleted && (
                    <>
                      <button
                        type="button"
                        onClick={handleRestore}
                        disabled={saving}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 border border-green-200 bg-green-50 text-green-700 text-sm font-medium rounded-lg hover:bg-green-100 disabled:opacity-50 transition-colors"
                      >
                        <RefreshCw className="w-4 h-4" />
                        Restore Salon
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowDeleteModal(true)}
                        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 border border-red-300 bg-red-100 text-red-800 text-sm font-medium rounded-lg hover:bg-red-200 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                        Delete Permanently
                      </button>
                    </>
                  )}
                </div>
              </CollapsibleSection>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        {salon && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty || saving || !name}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                justSaved
                  ? 'bg-green-600 text-white'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {saving && (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              )}
              {saving ? 'Saving…' : justSaved ? 'Saved' : 'Save changes'}
            </button>
          </div>
        )}
      </div>

      {/* Modals */}
      <UserSearchModal
        isOpen={showUserSearch}
        onClose={() => setShowUserSearch(false)}
        onSelect={handleOwnerChange}
        currentOwnerEmail={salon?.ownerEmail}
      />

      <ResetDataModal
        isOpen={showResetModal}
        onClose={() => setShowResetModal(false)}
        salonId={salonId}
        salonName={salon?.name || ''}
        onSuccess={fetchSalon}
      />

      <DeleteSalonModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        salonId={salonId}
        salonName={salon?.name || ''}
        salonSlug={salon?.slug || ''}
        isDeleted={isDeleted}
        onSuccess={() => {
          onDeleted?.();
          onClose();
        }}
      />

      {showLocationForm && (
        <LocationForm
          salonId={salonId}
          maxLocations={maxLocations}
          onClose={() => {
            setShowLocationForm(false);
            fetchSalon();
          }}
        />
      )}
    </div>
  );
}

// =============================================================================
// Collapsible Section Component
// =============================================================================

interface CollapsibleSectionProps {
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  badge?: string;
  variant?: 'default' | 'danger';
}

function CollapsibleSection({
  title,
  icon,
  expanded,
  onToggle,
  children,
  badge,
  variant = 'default',
}: CollapsibleSectionProps) {
  const borderColor = variant === 'danger' ? 'border-red-200' : 'border-gray-200';
  const headerBg = variant === 'danger' ? 'bg-red-50' : 'bg-gray-50';
  const iconColor = variant === 'danger' ? 'text-red-500' : 'text-gray-500';

  return (
    <div className={`border ${borderColor} rounded-lg overflow-hidden`}>
      <button
        type="button"
        onClick={onToggle}
        className={`w-full flex items-center justify-between px-4 py-3 ${headerBg} hover:bg-opacity-80 transition-colors`}
      >
        <div className="flex items-center gap-2">
          <span className={iconColor}>{icon}</span>
          <span className="text-sm font-medium text-gray-900">{title}</span>
          {badge && (
            <span className="px-2 py-0.5 text-xs font-medium text-gray-500 bg-gray-200 rounded">
              {badge}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-gray-400" />
        ) : (
          <ChevronRight className="w-4 h-4 text-gray-400" />
        )}
      </button>
      {expanded && <div className="px-4 py-4 bg-white">{children}</div>}
    </div>
  );
}
