'use client';

import {
  AlertTriangle,
  Building2,
  Calendar,
  ChevronDown,
  ChevronRight,
  CreditCard,
  Download,
  ExternalLink,
  Gift,
  History,
  MapPin,
  Pause,
  Play,
  RefreshCw,
  ToggleRight,
  Trash2,
  UserCheck,
  UserCog,
  Users,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  detectCurrentTier,
  ELITE_FEATURES,
  PRO_FEATURES,
  STARTER_FEATURES,
} from '@/libs/featureTiers';
import { getDefaultLoyaltyPoints } from '@/libs/loyalty';
import type { SalonPlan, SalonStatus } from '@/models/Schema';
import type { SalonFeatures } from '@/types/salonPolicy';

import { AuditLogTable } from './AuditLogTable';
import { DeleteSalonModal } from './DeleteSalonModal';
import { LocationForm } from './LocationForm';
import { ResetDataModal } from './ResetDataModal';
import { UserSearchModal } from './UserSearchModal';

/**
 * Safely parse a string input to a number or null.
 * Empty string or whitespace = null (use default)
 * Valid number string = number
 * Invalid input = null (server will use default)
 */
function parsePointsOverride(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }
  const num = Number.parseInt(trimmed, 10);
  return Number.isFinite(num) ? num : null;
}

type SalonDetail = {
  id: string;
  name: string;
  slug: string;
  plan: SalonPlan;
  status: SalonStatus;
  maxLocations: number;
  isMultiLocationEnabled: boolean;
  // Feature entitlements (JSONB - source of truth)
  features: SalonFeatures;
  // Legacy feature toggles (kept for backward compatibility)
  onlineBookingEnabled: boolean;
  smsRemindersEnabled: boolean;
  rewardsEnabled: boolean;
  profilePageEnabled: boolean;
  // Booking flow customization
  bookingFlowCustomizationEnabled: boolean;
  bookingFlow: string[] | null;
  // Owner & metadata (legacy)
  ownerEmail: string | null;
  ownerClerkUserId: string | null;
  internalNotes: string | null;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type OwnerInfo = {
  adminId: string;
  phoneE164: string;
  name: string | null;
};

type PendingInvite = {
  phoneE164: string;
  expiresAt: string;
  isExpired: boolean;
};

type AdminInfo = {
  adminId: string;
  role: string;
  phoneE164: string;
  name: string | null;
  email: string | null;
};

type SalonMetrics = {
  locationsCount: number;
  techsCount: number;
  clientsCount: number;
  appointmentsLast30d: number;
};

type SalonDetailPanelProps = {
  salonId: string;
  onClose: () => void;
  onDeleted?: () => void;
};

// =============================================================================
// Component
// =============================================================================

// Format phone for display
function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}

// =============================================================================
// Admin Row Component with Actions
// =============================================================================

type AdminRowProps = {
  admin: AdminInfo;
  salonId: string;
  totalAdmins: number;
  onRefresh: () => void;
};

function AdminRow({ admin, salonId, totalAdmins, onRefresh }: AdminRowProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRemove = async () => {
    // eslint-disable-next-line no-alert -- destructive action confirmation (TODO: replace with modal)
    if (!window.confirm(`Remove ${admin.name || 'this admin'} from the salon? They will lose access.`)) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/super-admin/organizations/${salonId}/admins/${admin.adminId}`,
        { method: 'DELETE' },
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to remove admin');
      }

      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove admin');
    } finally {
      setLoading(false);
    }
  };

  const handlePromote = async () => {
    // eslint-disable-next-line no-alert -- destructive action confirmation (TODO: replace with modal)
    if (!window.confirm(`Make ${admin.name || 'this admin'} the owner? The current owner will be demoted to admin.`)) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/super-admin/organizations/${salonId}/admins/${admin.adminId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'promote' }),
        },
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to promote admin');
      }

      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to promote admin');
    } finally {
      setLoading(false);
    }
  };

  const handleDemote = async () => {
    // eslint-disable-next-line no-alert -- destructive action confirmation (TODO: replace with modal)
    if (!window.confirm(`Demote ${admin.name || 'this admin'} to regular admin?`)) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/super-admin/organizations/${salonId}/admins/${admin.adminId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'demote' }),
        },
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to demote admin');
      }

      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to demote admin');
    } finally {
      setLoading(false);
    }
  };

  const isOwner = admin.role === 'owner';
  const canRemove = totalAdmins > 1; // Can't remove the last admin

  return (
    <div className="rounded-lg bg-gray-50 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* Name and Role */}
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-gray-900">
              {admin.name || 'Unnamed'}
            </span>
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${
              isOwner
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-200 text-gray-600'
            }`}
            >
              {admin.role}
            </span>
          </div>
          {/* Email */}
          <div className="truncate text-gray-500">
            {admin.email || '—'}
          </div>
          {/* Phone */}
          <div className="text-xs text-gray-400">
            {formatPhoneDisplay(admin.phoneE164)}
          </div>
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          {isOwner
            ? (
                <button
                  type="button"
                  onClick={handleDemote}
                  disabled={loading}
                  className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-700 hover:bg-amber-200 disabled:opacity-50"
                  title="Demote to admin"
                >
                  Demote
                </button>
              )
            : (
                <button
                  type="button"
                  onClick={handlePromote}
                  disabled={loading}
                  className="rounded bg-green-100 px-2 py-1 text-xs text-green-700 hover:bg-green-200 disabled:opacity-50"
                  title="Make owner"
                >
                  Make Owner
                </button>
              )}
          <button
            type="button"
            onClick={handleRemove}
            disabled={loading || !canRemove}
            className="rounded bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-50"
            title={canRemove ? 'Remove from salon' : 'Cannot remove last admin'}
          >
            Remove
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600">
          {error}
        </div>
      )}
    </div>
  );
}

export function SalonDetailPanel({ salonId, onClose, onDeleted }: SalonDetailPanelProps) {
  const [salon, setSalon] = useState<SalonDetail | null>(null);
  const [metrics, setMetrics] = useState<SalonMetrics | null>(null);
  const [owner, setOwner] = useState<OwnerInfo | null>(null);
  const [pendingOwnerInvite, setPendingOwnerInvite] = useState<PendingInvite | null>(null);
  const [admins, setAdmins] = useState<AdminInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Invite owner form state
  const [invitePhone, setInvitePhone] = useState('');
  const [invitingOwner, setInvitingOwner] = useState(false);

  // Form state
  const [name, setName] = useState('');
  const [plan, setPlan] = useState<SalonPlan>('single_salon');
  const [status, setStatus] = useState<SalonStatus>('active');
  const [maxLocations, setMaxLocations] = useState(1);
  const [isMultiLocationEnabled, setIsMultiLocationEnabled] = useState(false);
  const [internalNotes, setInternalNotes] = useState('');

  // Feature entitlements state (JSONB - source of truth)
  // Initialize with Starter tier defaults
  const [features, setFeatures] = useState<SalonFeatures>({ ...STARTER_FEATURES });

  // Legacy feature toggles (kept for backward compatibility display)
  const [onlineBookingEnabled, setOnlineBookingEnabled] = useState(true);
  const [smsRemindersEnabled, setSmsRemindersEnabled] = useState(true);
  const [rewardsEnabled, setRewardsEnabled] = useState(true);
  const [profilePageEnabled, setProfilePageEnabled] = useState(true);
  const [bookingFlowCustomizationEnabled, setBookingFlowCustomizationEnabled] = useState(false);

  // Billing & Programs state (Step 21E)
  const [reviewsEnabled, setReviewsEnabled] = useState(true);
  const [billingMode, setBillingMode] = useState<'NONE' | 'STRIPE'>('NONE');
  const [welcomeBonusOverride, setWelcomeBonusOverride] = useState<string>('');
  const [profileCompletionOverride, setProfileCompletionOverride] = useState<string>('');
  const [referralRefereeOverride, setReferralRefereeOverride] = useState<string>('');
  const [referralReferrerOverride, setReferralReferrerOverride] = useState<string>('');
  const [settingsSaving, setSettingsSaving] = useState(false);

  // Save button states
  const [isDirty, setIsDirty] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Collapsed sections
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    overview: true,
    plan: true,
    features: true,
    billingPrograms: false,
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
      setOwner(data.owner);
      setPendingOwnerInvite(data.pendingOwnerInvite);
      setAdmins(data.admins || []);

      // Populate form
      setName(data.salon.name);
      setPlan(data.salon.plan);
      setStatus(data.salon.status);
      setMaxLocations(data.salon.maxLocations);
      setIsMultiLocationEnabled(data.salon.isMultiLocationEnabled);
      setInternalNotes(data.salon.internalNotes || '');

      // Populate feature entitlements (from JSONB)
      if (data.salon.features) {
        setFeatures(data.salon.features);
      }

      // Legacy feature toggles (for backward compatibility)
      setOnlineBookingEnabled(data.salon.onlineBookingEnabled ?? true);
      setSmsRemindersEnabled(data.salon.smsRemindersEnabled ?? true);
      setRewardsEnabled(data.salon.rewardsEnabled ?? true);
      setProfilePageEnabled(data.salon.profilePageEnabled ?? true);
      setBookingFlowCustomizationEnabled(data.salon.bookingFlowCustomizationEnabled ?? false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [salonId]);

  // Fetch Billing & Programs settings from dedicated endpoint
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError(null);

    try {
      const response = await fetch(`/api/super-admin/salons/${salonId}/settings`);
      if (!response.ok) {
        throw new Error('Failed to fetch settings');
      }

      const data = await response.json();

      // Populate Billing & Programs state from settings endpoint
      setReviewsEnabled(data.settings.reviewsEnabled ?? true);
      setRewardsEnabled(data.settings.rewardsEnabled ?? true);
      setBillingMode((data.settings.billingMode as 'NONE' | 'STRIPE') ?? 'NONE');
      setWelcomeBonusOverride(data.settings.welcomeBonusPointsOverride?.toString() ?? '');
      setProfileCompletionOverride(data.settings.profileCompletionPointsOverride?.toString() ?? '');
      setReferralRefereeOverride(data.settings.referralRefereePointsOverride?.toString() ?? '');
      setReferralReferrerOverride(data.settings.referralReferrerPointsOverride?.toString() ?? '');
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setSettingsLoading(false);
    }
  }, [salonId]);

  useEffect(() => {
    fetchSalon();
    fetchSettings();
  }, [fetchSalon, fetchSettings]);

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
          // Feature entitlements (JSONB - source of truth)
          features,
          // Legacy feature toggles (kept for backward compatibility)
          onlineBookingEnabled,
          smsRemindersEnabled,
          rewardsEnabled,
          profilePageEnabled,
          bookingFlowCustomizationEnabled,
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

  // Handle owner change (legacy Clerk)
  const handleOwnerChange = async (user: { id: string; email: string | null }) => {
    if (!user.email) {
      return;
    }

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

  // Invite new owner via phone
  const handleInviteOwner = async () => {
    if (!invitePhone.trim()) {
      return;
    }

    setInvitingOwner(true);
    setError(null);

    try {
      const response = await fetch('/api/super-admin/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: invitePhone,
          role: 'ADMIN',
          salonSlug: salon?.slug,
          membershipRole: 'owner',
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to send invite');
      }

      setInvitePhone('');
      await fetchSalon();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setInvitingOwner(false);
    }
  };

  // Remove/demote owner
  const handleRemoveOwner = async (action: 'demote' | 'remove') => {
    const confirmMsg = action === 'remove'
      ? 'Remove this owner completely? They will lose access to the salon.'
      : 'Demote this owner to admin? They will keep access but not be listed as owner.';

    // eslint-disable-next-line no-alert -- destructive action confirmation (TODO: replace with modal)
    if (!window.confirm(confirmMsg)) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/super-admin/organizations/${salonId}/owner`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update owner');
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
        `/api/super-admin/organizations/${salonId}/export?format=${format}`,
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
        role="button"
        tabIndex={0}
        aria-label="Close panel"
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onClose();
          }
        }}
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 flex w-full max-w-xl flex-col bg-white shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
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
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
              >
                <ExternalLink className="size-3.5" />
                Impersonate
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close panel"
              className="-m-2 p-2 text-gray-400 hover:text-gray-600"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading
            ? (
                <div className="flex h-64 items-center justify-center">
                  <div className="size-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                </div>
              )
            : error && !salon
              ? (<div className="p-6 text-center text-red-600">{error}</div>)
              : salon && metrics
                ? (
                    <div className="space-y-4 p-6">
                      {error && (
                        <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                          {error}
                        </div>
                      )}

                      {/* Deleted Banner */}
                      {isDeleted && (
                        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <AlertTriangle className="size-5 text-red-600" />
                              <div>
                                <div className="font-medium text-red-900">Salon Deleted</div>
                                <div className="text-sm text-red-700">
                                  Deleted on
                                  {' '}
                                  {new Date(salon.deletedAt!).toLocaleDateString()}
                                </div>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={handleRestore}
                              disabled={saving}
                              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:opacity-50"
                            >
                              <RefreshCw className="size-4" />
                              Restore
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Overview Section */}
                      <CollapsibleSection
                        title="Overview"
                        icon={<Building2 className="size-4" />}
                        expanded={expandedSections.overview ?? true}
                        onToggle={() => toggleSection('overview')}
                      >
                        {/* Name */}
                        <div className="mb-4">
                          <label htmlFor="name" className="mb-1 block text-sm font-medium text-gray-700">
                            Salon Name
                          </label>
                          <input
                            type="text"
                            id="name"
                            value={name}
                            onChange={(e) => {
                              setName(e.target.value);
                              markDirty();
                            }}
                            className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>

                        {/* Created */}
                        <div className="mb-4">
                          <span className="mb-1 block text-sm font-medium text-gray-700">
                            Created
                          </span>
                          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-600">
                            {new Date(salon.createdAt).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric',
                            })}
                          </div>
                        </div>

                        {/* Metrics */}
                        <div className="grid grid-cols-4 gap-3">
                          <div className="rounded-lg bg-gray-50 p-3 text-center">
                            <Building2 className="mx-auto mb-1 size-5 text-gray-400" />
                            <div className="text-lg font-semibold text-gray-900">{metrics.locationsCount}</div>
                            <div className="text-xs text-gray-500">Locations</div>
                          </div>
                          <div className="rounded-lg bg-gray-50 p-3 text-center">
                            <Users className="mx-auto mb-1 size-5 text-gray-400" />
                            <div className="text-lg font-semibold text-gray-900">{metrics.techsCount}</div>
                            <div className="text-xs text-gray-500">Techs</div>
                          </div>
                          <div className="rounded-lg bg-gray-50 p-3 text-center">
                            <UserCheck className="mx-auto mb-1 size-5 text-gray-400" />
                            <div className="text-lg font-semibold text-gray-900">{metrics.clientsCount}</div>
                            <div className="text-xs text-gray-500">Clients</div>
                          </div>
                          <div className="rounded-lg bg-gray-50 p-3 text-center">
                            <Calendar className="mx-auto mb-1 size-5 text-gray-400" />
                            <div className="text-lg font-semibold text-gray-900">{metrics.appointmentsLast30d}</div>
                            <div className="text-xs text-gray-500">Appts (30d)</div>
                          </div>
                        </div>
                      </CollapsibleSection>

                      {/* Plan & Limits Section */}
                      <CollapsibleSection
                        title="Plan & Limits"
                        icon={<Building2 className="size-4" />}
                        expanded={expandedSections.plan ?? true}
                        onToggle={() => toggleSection('plan')}
                      >
                        {/* Plan */}
                        <div className="mb-4">
                          <label htmlFor="plan" className="mb-1 block text-sm font-medium text-gray-700">
                            Plan
                          </label>
                          <select
                            id="plan"
                            value={plan}
                            onChange={e => handlePlanChange(e.target.value as SalonPlan)}
                            className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value="free">Free</option>
                            <option value="single_salon">Single Salon</option>
                            <option value="multi_salon">Multi Salon</option>
                            <option value="enterprise">Enterprise</option>
                          </select>
                        </div>

                        {/* Max Locations */}
                        <div className="mb-4">
                          <label htmlFor="maxLocations" className="mb-1 block text-sm font-medium text-gray-700">
                            Max Locations
                          </label>
                          <input
                            type="number"
                            id="maxLocations"
                            value={maxLocations}
                            onChange={(e) => {
                              setMaxLocations(Math.max(1, Number.parseInt(e.target.value) || 1));
                              markDirty();
                            }}
                            min={1}
                            disabled={plan === 'single_salon' || plan === 'free'}
                            className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-gray-100 disabled:text-gray-500"
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
                            aria-checked={isMultiLocationEnabled ? 'true' : 'false'}
                            onClick={() => {
                              setIsMultiLocationEnabled(!isMultiLocationEnabled);
                              markDirty();
                            }}
                            disabled={plan === 'single_salon' || plan === 'free'}
                            aria-label="Toggle multi-location features"
                            className={`relative h-6 w-11 rounded-full transition-colors ${
                              isMultiLocationEnabled ? 'bg-indigo-600' : 'bg-gray-200'
                            } ${plan === 'single_salon' || plan === 'free' ? 'cursor-not-allowed opacity-50' : ''}`}
                          >
                            <div
                              className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                                isMultiLocationEnabled ? 'translate-x-5' : ''
                              }`}
                            />
                          </button>
                        </div>
                      </CollapsibleSection>

                      {/* Features Section */}
                      <CollapsibleSection
                        title="Features"
                        icon={<ToggleRight className="size-4" />}
                        expanded={expandedSections.features ?? true}
                        onToggle={() => toggleSection('features')}
                      >
                        <div className="space-y-4">
                          {/* Core Features Header */}
                          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                            Core Features
                          </div>

                          {/* Online Booking Toggle */}
                          <div className="flex items-center justify-between py-2">
                            <div>
                              <div className="text-sm font-medium text-gray-700">Online Booking</div>
                              <div className="text-xs text-gray-500">Allow clients to book online</div>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={features.onlineBooking ? 'true' : 'false'}
                              onClick={() => {
                                setFeatures(f => ({ ...f, onlineBooking: !f.onlineBooking }));
                                setOnlineBookingEnabled(!features.onlineBooking);
                                markDirty();
                              }}
                              aria-label="Toggle online booking"
                              className={`relative h-6 w-11 rounded-full transition-colors ${
                                features.onlineBooking ? 'bg-indigo-600' : 'bg-gray-200'
                              }`}
                            >
                              <div
                                className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                                  features.onlineBooking ? 'translate-x-5' : ''
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
                              aria-checked={features.smsReminders ? 'true' : 'false'}
                              onClick={() => {
                                setFeatures(f => ({ ...f, smsReminders: !f.smsReminders }));
                                setSmsRemindersEnabled(!features.smsReminders);
                                markDirty();
                              }}
                              aria-label="Toggle SMS reminders"
                              className={`relative h-6 w-11 rounded-full transition-colors ${
                                features.smsReminders ? 'bg-indigo-600' : 'bg-gray-200'
                              }`}
                            >
                              <div
                                className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                                  features.smsReminders ? 'translate-x-5' : ''
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
                              aria-checked={features.rewards ? 'true' : 'false'}
                              onClick={() => {
                                setFeatures(f => ({ ...f, rewards: !f.rewards }));
                                setRewardsEnabled(!features.rewards);
                                markDirty();
                              }}
                              aria-label="Toggle rewards program"
                              className={`relative h-6 w-11 rounded-full transition-colors ${
                                features.rewards ? 'bg-indigo-600' : 'bg-gray-200'
                              }`}
                            >
                              <div
                                className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                                  features.rewards ? 'translate-x-5' : ''
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
                              aria-checked={features.profilePage ? 'true' : 'false'}
                              onClick={() => {
                                setFeatures(f => ({ ...f, profilePage: !f.profilePage }));
                                setProfilePageEnabled(!features.profilePage);
                                markDirty();
                              }}
                              aria-label="Toggle public profile"
                              className={`relative h-6 w-11 rounded-full transition-colors ${
                                features.profilePage ? 'bg-indigo-600' : 'bg-gray-200'
                              }`}
                            >
                              <div
                                className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                                  features.profilePage ? 'translate-x-5' : ''
                                }`}
                              />
                            </button>
                          </div>

                          {/* Booking Flow Customization Toggle */}
                          <div className="flex items-center justify-between py-2">
                            <div>
                              <div className="text-sm font-medium text-gray-700">Booking Flow Customization</div>
                              <div className="text-xs text-gray-500">Allow drag-and-drop control of booking steps</div>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={bookingFlowCustomizationEnabled ? 'true' : 'false'}
                              onClick={() => {
                                setBookingFlowCustomizationEnabled(!bookingFlowCustomizationEnabled);
                                markDirty();
                              }}
                              aria-label="Toggle booking flow customization"
                              className={`relative h-6 w-11 rounded-full transition-colors ${
                                bookingFlowCustomizationEnabled ? 'bg-indigo-600' : 'bg-gray-200'
                              }`}
                            >
                              <div
                                className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                                  bookingFlowCustomizationEnabled ? 'translate-x-5' : ''
                                }`}
                              />
                            </button>
                          </div>

                          {/* Premium Features Header */}
                          <div className="border-t border-gray-200 pt-4">
                            <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-amber-600">
                              <span>★</span>
                              {' '}
                              Premium Features
                            </div>
                          </div>

                          {/* Visibility Controls Toggle */}
                          <div className="flex items-center justify-between py-2">
                            <div>
                              <div className="text-sm font-medium text-gray-700">Visibility Controls</div>
                              <div className="text-xs text-gray-500">Admin can control what staff sees (client info, prices, etc.)</div>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={features.visibilityControls ? 'true' : 'false'}
                              onClick={() => {
                                setFeatures(f => ({ ...f, visibilityControls: !f.visibilityControls }));
                                markDirty();
                              }}
                              aria-label="Toggle visibility controls"
                              className={`relative h-6 w-11 rounded-full transition-colors ${
                                features.visibilityControls ? 'bg-amber-500' : 'bg-gray-200'
                              }`}
                            >
                              <div
                                className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                                  features.visibilityControls ? 'translate-x-5' : ''
                                }`}
                              />
                            </button>
                          </div>

                          {/* Multi-Location Toggle */}
                          <div className="flex items-center justify-between py-2">
                            <div>
                              <div className="text-sm font-medium text-gray-700">Multi-Location</div>
                              <div className="text-xs text-gray-500">Support for multiple salon locations</div>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={features.multiLocation ? 'true' : 'false'}
                              onClick={() => {
                                setFeatures(f => ({ ...f, multiLocation: !f.multiLocation }));
                                markDirty();
                              }}
                              aria-label="Toggle multi-location"
                              className={`relative h-6 w-11 rounded-full transition-colors ${
                                features.multiLocation ? 'bg-amber-500' : 'bg-gray-200'
                              }`}
                            >
                              <div
                                className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                                  features.multiLocation ? 'translate-x-5' : ''
                                }`}
                              />
                            </button>
                          </div>

                          {/* Advanced Analytics Toggle */}
                          <div className="flex items-center justify-between py-2">
                            <div>
                              <div className="text-sm font-medium text-gray-700">Advanced Analytics</div>
                              <div className="text-xs text-gray-500">Detailed reports and business insights</div>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={features.advancedAnalytics ? 'true' : 'false'}
                              onClick={() => {
                                setFeatures(f => ({ ...f, advancedAnalytics: !f.advancedAnalytics }));
                                markDirty();
                              }}
                              aria-label="Toggle advanced analytics"
                              className={`relative h-6 w-11 rounded-full transition-colors ${
                                features.advancedAnalytics ? 'bg-amber-500' : 'bg-gray-200'
                              }`}
                            >
                              <div
                                className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                                  features.advancedAnalytics ? 'translate-x-5' : ''
                                }`}
                              />
                            </button>
                          </div>

                          {/* Custom Branding Toggle */}
                          <div className="flex items-center justify-between py-2">
                            <div>
                              <div className="text-sm font-medium text-gray-700">Custom Branding</div>
                              <div className="text-xs text-gray-500">Custom colors, logos, and styling</div>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={features.customBranding ? 'true' : 'false'}
                              onClick={() => {
                                setFeatures(f => ({ ...f, customBranding: !f.customBranding }));
                                markDirty();
                              }}
                              aria-label="Toggle custom branding"
                              className={`relative h-6 w-11 rounded-full transition-colors ${
                                features.customBranding ? 'bg-amber-500' : 'bg-gray-200'
                              }`}
                            >
                              <div
                                className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                                  features.customBranding ? 'translate-x-5' : ''
                                }`}
                              />
                            </button>
                          </div>

                          {/* API Access Toggle */}
                          <div className="flex items-center justify-between py-2">
                            <div>
                              <div className="text-sm font-medium text-gray-700">API Access</div>
                              <div className="text-xs text-gray-500">External integrations via API</div>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={features.apiAccess ? 'true' : 'false'}
                              onClick={() => {
                                setFeatures(f => ({ ...f, apiAccess: !f.apiAccess }));
                                markDirty();
                              }}
                              aria-label="Toggle API access"
                              className={`relative h-6 w-11 rounded-full transition-colors ${
                                features.apiAccess ? 'bg-amber-500' : 'bg-gray-200'
                              }`}
                            >
                              <div
                                className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                                  features.apiAccess ? 'translate-x-5' : ''
                                }`}
                              />
                            </button>
                          </div>

                          {/* Tier Preset Buttons */}
                          <div className="border-t border-gray-200 pt-4">
                            <div className="mb-3 flex items-center justify-between">
                              <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                Quick Apply Tier
                              </div>
                              <div className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                                Current:
                                {' '}
                                {detectCurrentTier(features).charAt(0).toUpperCase() + detectCurrentTier(features).slice(1)}
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  // eslint-disable-next-line no-alert -- tier change confirmation (TODO: replace with modal)
                                  if (window.confirm('Apply Starter tier? This will MERGE with existing features.')) {
                                    setFeatures(prev => ({ ...(prev ?? {}), ...STARTER_FEATURES }));
                                    markDirty();
                                  }
                                }}
                                className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100"
                              >
                                Starter
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  // eslint-disable-next-line no-alert -- tier change confirmation (TODO: replace with modal)
                                  if (window.confirm('Apply Pro tier? This will MERGE with existing features.')) {
                                    setFeatures(prev => ({ ...(prev ?? {}), ...PRO_FEATURES }));
                                    markDirty();
                                  }
                                }}
                                className="flex-1 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
                              >
                                Pro
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  // eslint-disable-next-line no-alert -- tier change confirmation (TODO: replace with modal)
                                  if (window.confirm('Apply Elite tier? This will MERGE with existing features.')) {
                                    setFeatures(prev => ({ ...(prev ?? {}), ...ELITE_FEATURES }));
                                    markDirty();
                                  }
                                }}
                                className="flex-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100"
                              >
                                Elite
                              </button>
                            </div>
                          </div>
                        </div>
                      </CollapsibleSection>

                      {/* Billing & Programs Section (Step 21E) */}
                      <CollapsibleSection
                        title="Billing & Programs"
                        icon={<CreditCard className="size-4" />}
                        expanded={expandedSections.billingPrograms ?? false}
                        onToggle={() => toggleSection('billingPrograms')}
                      >
                        <div className="space-y-4">
                          {/* Loading/Error States */}
                          {settingsLoading && (
                            <div className="flex items-center gap-2 text-sm text-gray-500">
                              <RefreshCw className="size-4 animate-spin" />
                              Loading settings...
                            </div>
                          )}
                          {settingsError && (
                            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
                              {settingsError}
                            </div>
                          )}

                          {/* Program Toggles */}
                          <div className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                            Program Toggles
                          </div>

                          {/* Reviews Enabled */}
                          <div className="flex items-center justify-between py-2">
                            <div>
                              <div className="text-sm font-medium text-gray-700">Reviews Enabled</div>
                              <div className="text-xs text-gray-500">Allow clients to leave reviews</div>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={reviewsEnabled ? 'true' : 'false'}
                              onClick={() => {
                                setReviewsEnabled(!reviewsEnabled);
                                markDirty();
                              }}
                              aria-label="Toggle reviews"
                              className={`relative h-6 w-11 rounded-full transition-colors ${
                                reviewsEnabled ? 'bg-indigo-600' : 'bg-gray-200'
                              }`}
                            >
                              <div
                                className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                                  reviewsEnabled ? 'translate-x-5' : ''
                                }`}
                              />
                            </button>
                          </div>

                          {/* Rewards Enabled */}
                          <div className="flex items-center justify-between py-2">
                            <div>
                              <div className="text-sm font-medium text-gray-700">Rewards Enabled</div>
                              <div className="text-xs text-gray-500">Enable loyalty rewards program</div>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={rewardsEnabled ? 'true' : 'false'}
                              onClick={() => {
                                setRewardsEnabled(!rewardsEnabled);
                                markDirty();
                              }}
                              aria-label="Toggle rewards"
                              className={`relative h-6 w-11 rounded-full transition-colors ${
                                rewardsEnabled ? 'bg-indigo-600' : 'bg-gray-200'
                              }`}
                            >
                              <div
                                className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform ${
                                  rewardsEnabled ? 'translate-x-5' : ''
                                }`}
                              />
                            </button>
                          </div>

                          {/* Billing Mode */}
                          <div className="border-t border-gray-200 pt-4">
                            <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500">
                              Billing
                            </div>
                            <div className="mb-4">
                              <label htmlFor="billingMode" className="mb-1 block text-sm font-medium text-gray-700">
                                Billing Mode
                              </label>
                              <select
                                id="billingMode"
                                value={billingMode}
                                onChange={(e) => {
                                  setBillingMode(e.target.value as 'NONE' | 'STRIPE');
                                  markDirty();
                                }}
                                className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              >
                                <option value="NONE">Cash / Offline (No Stripe)</option>
                                <option value="STRIPE">Stripe Billing</option>
                              </select>
                              <p className="mt-1 text-xs text-gray-500">
                                {billingMode === 'NONE'
                                  ? 'Salon handles billing manually. No Stripe subscription required.'
                                  : 'Salon uses Stripe for subscription billing.'}
                              </p>
                            </div>
                          </div>

                          {/* Loyalty Points Overrides */}
                          <div className="border-t border-gray-200 pt-4">
                            <div className="mb-3 flex items-center gap-2">
                              <Gift className="size-4 text-purple-500" />
                              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                Loyalty Points Overrides
                              </span>
                            </div>
                            <p className="mb-4 text-xs text-gray-500">
                              Leave empty to use system defaults. Set a value to override for this salon only.
                            </p>

                            {/* Welcome Bonus */}
                            <div className="mb-3">
                              <label htmlFor="welcomeBonus" className="mb-1 block text-sm font-medium text-gray-700">
                                Welcome Bonus
                                <span className="ml-2 text-xs font-normal text-gray-400">
                                  (Default:
                                  {' '}
                                  {getDefaultLoyaltyPoints().welcomeBonus.toLocaleString()}
                                  )
                                </span>
                              </label>
                              <input
                                type="number"
                                id="welcomeBonus"
                                value={welcomeBonusOverride}
                                onChange={(e) => {
                                  setWelcomeBonusOverride(e.target.value);
                                  markDirty();
                                }}
                                placeholder="Use default"
                                min={0}
                                max={250000}
                                className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>

                            {/* Profile Completion */}
                            <div className="mb-3">
                              <label htmlFor="profileCompletion" className="mb-1 block text-sm font-medium text-gray-700">
                                Profile Completion
                                <span className="ml-2 text-xs font-normal text-gray-400">
                                  (Default:
                                  {' '}
                                  {getDefaultLoyaltyPoints().profileCompletion.toLocaleString()}
                                  )
                                </span>
                              </label>
                              <input
                                type="number"
                                id="profileCompletion"
                                value={profileCompletionOverride}
                                onChange={(e) => {
                                  setProfileCompletionOverride(e.target.value);
                                  markDirty();
                                }}
                                placeholder="Use default"
                                min={0}
                                max={250000}
                                className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>

                            {/* Referral Referee */}
                            <div className="mb-3">
                              <label htmlFor="referralReferee" className="mb-1 block text-sm font-medium text-gray-700">
                                Referral Referee Bonus
                                <span className="ml-2 text-xs font-normal text-gray-400">
                                  (Default:
                                  {' '}
                                  {getDefaultLoyaltyPoints().referralReferee.toLocaleString()}
                                  )
                                </span>
                              </label>
                              <input
                                type="number"
                                id="referralReferee"
                                value={referralRefereeOverride}
                                onChange={(e) => {
                                  setReferralRefereeOverride(e.target.value);
                                  markDirty();
                                }}
                                placeholder="Use default"
                                min={0}
                                max={250000}
                                className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>

                            {/* Referral Referrer */}
                            <div className="mb-3">
                              <label htmlFor="referralReferrer" className="mb-1 block text-sm font-medium text-gray-700">
                                Referral Referrer Bonus
                                <span className="ml-2 text-xs font-normal text-gray-400">
                                  (Default:
                                  {' '}
                                  {getDefaultLoyaltyPoints().referralReferrer.toLocaleString()}
                                  )
                                </span>
                              </label>
                              <input
                                type="number"
                                id="referralReferrer"
                                value={referralReferrerOverride}
                                onChange={(e) => {
                                  setReferralReferrerOverride(e.target.value);
                                  markDirty();
                                }}
                                placeholder="Use default"
                                min={0}
                                max={250000}
                                className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>
                          </div>

                          {/* Save Settings Button */}
                          <div className="border-t border-gray-200 pt-4">
                            <button
                              type="button"
                              onClick={async () => {
                                setSettingsSaving(true);
                                try {
                                  const response = await fetch(`/api/super-admin/salons/${salonId}/settings`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                      reviewsEnabled,
                                      rewardsEnabled,
                                      billingMode,
                                      welcomeBonusPointsOverride: parsePointsOverride(welcomeBonusOverride),
                                      profileCompletionPointsOverride: parsePointsOverride(profileCompletionOverride),
                                      referralRefereePointsOverride: parsePointsOverride(referralRefereeOverride),
                                      referralReferrerPointsOverride: parsePointsOverride(referralReferrerOverride),
                                    }),
                                  });
                                  if (!response.ok) {
                                    throw new Error('Failed to save settings');
                                  }
                                  // Refresh settings data from dedicated endpoint
                                  fetchSettings();
                                } catch (err) {
                                  setSettingsError(err instanceof Error ? err.message : 'Failed to save settings');
                                } finally {
                                  setSettingsSaving(false);
                                }
                              }}
                              disabled={settingsSaving}
                              className="w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                            >
                              {settingsSaving ? 'Saving...' : 'Save Billing & Programs Settings'}
                            </button>
                          </div>
                        </div>
                      </CollapsibleSection>

                      {/* Status Section */}
                      <CollapsibleSection
                        title="Status & Notes"
                        icon={status === 'suspended' ? <Pause className="size-4" /> : <Play className="size-4" />}
                        expanded={expandedSections.status ?? true}
                        onToggle={() => toggleSection('status')}
                      >
                        {/* Status */}
                        <div className="mb-4">
                          <label htmlFor="status" className="mb-1 block text-sm font-medium text-gray-700">
                            Status
                          </label>
                          <select
                            id="status"
                            value={status}
                            onChange={(e) => {
                              setStatus(e.target.value as SalonStatus);
                              markDirty();
                            }}
                            className="w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          >
                            <option value="active">Active</option>
                            <option value="trial">Trial</option>
                            <option value="suspended">Suspended</option>
                            <option value="cancelled">Cancelled</option>
                          </select>
                        </div>

                        {/* Internal Notes */}
                        <div>
                          <label htmlFor="internalNotes" className="mb-1 block text-sm font-medium text-gray-700">
                            Internal Notes
                          </label>
                          <textarea
                            id="internalNotes"
                            value={internalNotes}
                            onChange={(e) => {
                              setInternalNotes(e.target.value);
                              markDirty();
                            }}
                            rows={3}
                            placeholder="Private notes only visible to super admins..."
                            className="w-full resize-none rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                      </CollapsibleSection>

                      {/* Ownership Section */}
                      <CollapsibleSection
                        title="Ownership & Admins"
                        icon={<UserCog className="size-4" />}
                        expanded={expandedSections.ownership ?? false}
                        onToggle={() => toggleSection('ownership')}
                      >
                        <div className="space-y-4">
                          {/* Current Owner */}
                          <div>
                            <span className="mb-2 block text-sm font-medium text-gray-700">
                              Current Owner
                            </span>
                            {owner
                              ? (
                                  <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                                    <div className="flex items-center justify-between">
                                      <div>
                                        <div className="font-medium text-gray-900">
                                          {owner.name || 'Unnamed'}
                                        </div>
                                        <div className="text-sm text-gray-600">
                                          {formatPhoneDisplay(owner.phoneE164)}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveOwner('demote')}
                                          disabled={saving}
                                          className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-700 hover:bg-amber-200 disabled:opacity-50"
                                        >
                                          Demote
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleRemoveOwner('remove')}
                                          disabled={saving}
                                          className="rounded bg-red-100 px-2 py-1 text-xs text-red-700 hover:bg-red-200 disabled:opacity-50"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                )
                              : pendingOwnerInvite
                                ? (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                                      <div className="text-sm">
                                        <span className="font-medium text-amber-800">Pending invite:</span>
                                        {' '}
                                        <span className="text-amber-700">{formatPhoneDisplay(pendingOwnerInvite.phoneE164)}</span>
                                      </div>
                                      {pendingOwnerInvite.isExpired && (
                                        <div className="mt-1 text-xs text-red-600">Invite expired</div>
                                      )}
                                    </div>
                                  )
                                : (
                                    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
                                      No owner assigned
                                    </div>
                                  )}
                          </div>

                          {/* Invite Owner */}
                          {!owner && (
                            <div>
                              <label htmlFor="invite-owner-phone" className="mb-2 block text-sm font-medium text-gray-700">
                                Invite Owner by Phone
                              </label>
                              <div className="flex gap-2">
                                <input
                                  id="invite-owner-phone"
                                  type="tel"
                                  value={invitePhone}
                                  onChange={e => setInvitePhone(e.target.value)}
                                  placeholder="(416) 555-1234"
                                  className="flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                />
                                <button
                                  type="button"
                                  onClick={handleInviteOwner}
                                  disabled={invitingOwner || !invitePhone.trim()}
                                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {invitingOwner ? 'Sending...' : 'Invite'}
                                </button>
                              </div>
                              <p className="mt-1 text-xs text-gray-500">
                                They&apos;ll receive an SMS to log in as owner
                              </p>
                            </div>
                          )}

                          {/* All Admins with Actions */}
                          {admins.length > 0 && (
                            <div>
                              <label className="mb-2 block text-sm font-medium text-gray-700">
                                All Admins (
                                {admins.length}
                                )
                              </label>
                              <div className="space-y-2">
                                {admins.map(admin => (
                                  <AdminRow
                                    key={admin.adminId}
                                    admin={admin}
                                    salonId={salonId}
                                    totalAdmins={admins.length}
                                    onRefresh={fetchSalon}
                                  />
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Legacy Owner Info */}
                          {salon.ownerEmail && !owner && (
                            <div className="border-t border-gray-200 pt-3">
                              <span className="mb-1 block text-xs font-medium text-gray-500">
                                Legacy Owner (Clerk)
                              </span>
                              <div className="text-sm text-gray-400">{salon.ownerEmail}</div>
                            </div>
                          )}
                        </div>
                      </CollapsibleSection>

                      {/* Locations Section */}
                      <CollapsibleSection
                        title="Locations"
                        icon={<MapPin className="size-4" />}
                        expanded={expandedSections.locations ?? false}
                        onToggle={() => toggleSection('locations')}
                        badge={`${metrics.locationsCount}/${maxLocations}`}
                      >
                        <button
                          type="button"
                          onClick={() => setShowLocationForm(true)}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                        >
                          <MapPin className="size-4" />
                          Manage Locations
                        </button>
                      </CollapsibleSection>

                      {/* Data Management Section */}
                      <CollapsibleSection
                        title="Data Management"
                        icon={<Download className="size-4" />}
                        expanded={expandedSections.dataManagement ?? false}
                        onToggle={() => toggleSection('dataManagement')}
                      >
                        <div className="space-y-3">
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => handleExport('json')}
                              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                            >
                              <Download className="size-4" />
                              Export JSON
                            </button>
                            <button
                              type="button"
                              onClick={() => handleExport('csv')}
                              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50"
                            >
                              <Download className="size-4" />
                              Export CSV
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => setShowResetModal(true)}
                            className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100"
                          >
                            <RefreshCw className="size-4" />
                            Reset Data
                          </button>
                        </div>
                      </CollapsibleSection>

                      {/* Activity Log Section */}
                      <CollapsibleSection
                        title="Activity Log"
                        icon={<History className="size-4" />}
                        expanded={expandedSections.activityLog ?? false}
                        onToggle={() => toggleSection('activityLog')}
                      >
                        <AuditLogTable salonId={salonId} limit={5} />
                      </CollapsibleSection>

                      {/* Danger Zone */}
                      <CollapsibleSection
                        title="Danger Zone"
                        icon={<AlertTriangle className="size-4" />}
                        expanded={expandedSections.dangerZone ?? false}
                        onToggle={() => toggleSection('dangerZone')}
                        variant="danger"
                      >
                        <div className="space-y-3">
                          {!isDeleted && (
                            <button
                              type="button"
                              onClick={() => setShowDeleteModal(true)}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100"
                            >
                              <Trash2 className="size-4" />
                              Delete Salon
                            </button>
                          )}
                          {isDeleted && (
                            <>
                              <button
                                type="button"
                                onClick={handleRestore}
                                disabled={saving}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 transition-colors hover:bg-green-100 disabled:opacity-50"
                              >
                                <RefreshCw className="size-4" />
                                Restore Salon
                              </button>
                              <button
                                type="button"
                                onClick={() => setShowDeleteModal(true)}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-red-300 bg-red-100 px-4 py-2 text-sm font-medium text-red-800 transition-colors hover:bg-red-200"
                              >
                                <Trash2 className="size-4" />
                                Delete Permanently
                              </button>
                            </>
                          )}
                        </div>
                      </CollapsibleSection>
                    </div>
                  )
                : null}
        </div>

        {/* Footer */}
        {salon && (
          <div className="flex items-center justify-end gap-3 border-t border-gray-200 bg-gray-50 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty || saving || !name}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                justSaved
                  ? 'bg-green-600 text-white'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700'
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {saving && (
                <div className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
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

type CollapsibleSectionProps = {
  title: string;
  icon: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  badge?: string;
  variant?: 'default' | 'danger';
};

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
    <div className={`border ${borderColor} overflow-hidden rounded-lg`}>
      <button
        type="button"
        onClick={onToggle}
        className={`flex w-full items-center justify-between px-4 py-3 ${headerBg} transition-colors hover:bg-opacity-80`}
      >
        <div className="flex items-center gap-2">
          <span className={iconColor}>{icon}</span>
          <span className="text-sm font-medium text-gray-900">{title}</span>
          {badge && (
            <span className="rounded bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-500">
              {badge}
            </span>
          )}
        </div>
        {expanded
          ? (
              <ChevronDown className="size-4 text-gray-400" />
            )
          : (
              <ChevronRight className="size-4 text-gray-400" />
            )}
      </button>
      {expanded && <div className="bg-white p-4">{children}</div>}
    </div>
  );
}
