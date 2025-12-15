'use client';

import { MapPin, Plus, Star, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

// =============================================================================
// Types
// =============================================================================

type Location = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  phone: string | null;
  email: string | null;
  isPrimary: boolean;
  isActive: boolean;
};

type LocationFormProps = {
  salonId: string;
  maxLocations: number;
  onClose: () => void;
};

// =============================================================================
// Component
// =============================================================================

export function LocationForm({ salonId, maxLocations, onClose }: LocationFormProps) {
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // New location form state
  const [newLocation, setNewLocation] = useState({
    name: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    phone: '',
    email: '',
  });

  // Fetch locations
  const fetchLocations = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/super-admin/organizations/${salonId}/locations`);
      if (!response.ok) {
        throw new Error('Failed to fetch locations');
      }

      const data = await response.json();
      setLocations(data.locations || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [salonId]);

  useEffect(() => {
    fetchLocations();
  }, [fetchLocations]);

  // Add location
  const handleAddLocation = async () => {
    if (!newLocation.name.trim()) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(`/api/super-admin/organizations/${salonId}/locations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLocation),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to add location');
      }

      await fetchLocations();
      setNewLocation({ name: '', address: '', city: '', state: '', zipCode: '', phone: '', email: '' });
      setShowAddForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  // Delete location
  const handleDeleteLocation = async (locationId: string) => {
    // eslint-disable-next-line no-alert -- destructive action confirmation (TODO: replace with modal)
    if (!confirm('Delete this location?')) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/super-admin/organizations/${salonId}/locations/${locationId}`,
        { method: 'DELETE' },
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete location');
      }

      await fetchLocations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  // Set primary location
  const handleSetPrimary = async (locationId: string) => {
    setSaving(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/super-admin/organizations/${salonId}/locations/${locationId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isPrimary: true }),
        },
      );

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to update location');
      }

      await fetchLocations();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSaving(false);
    }
  };

  const canAddMore = locations.length < maxLocations;

  return (
    <div className="fixed inset-0 z-[60] overflow-hidden">
      {/* Backdrop */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Close modal"
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            onClose();
          }
        }}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl bg-white shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-indigo-100">
                <MapPin className="size-5 text-indigo-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Locations</h2>
                <p className="text-xs text-gray-500">
                  {locations.length}
                  {' '}
                  /
                  {maxLocations}
                  {' '}
                  locations
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="-m-2 p-2 text-gray-400 hover:text-gray-600"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {error && (
              <div className="mb-4 rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}

            {loading
              ? (
                  <div className="flex h-32 items-center justify-center">
                    <div className="size-6 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
                  </div>
                )
              : (
                  <div className="space-y-4">
                    {/* Existing Locations */}
                    {locations.map(location => (
                      <div
                        key={location.id}
                        className={`rounded-lg border p-4 ${
                          location.isPrimary
                            ? 'border-indigo-200 bg-indigo-50'
                            : 'border-gray-200 bg-gray-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <div className="truncate font-medium text-gray-900">
                                {location.name}
                              </div>
                              {location.isPrimary && (
                                <span className="inline-flex items-center gap-1 rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                                  <Star className="size-3" />
                                  Primary
                                </span>
                              )}
                            </div>
                            {(location.address || location.city) && (
                              <div className="mt-1 text-sm text-gray-500">
                                {[location.address, location.city, location.state, location.zipCode]
                                  .filter(Boolean)
                                  .join(', ')}
                              </div>
                            )}
                            {location.phone && (
                              <div className="text-sm text-gray-500">{location.phone}</div>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            {!location.isPrimary && (
                              <button
                                type="button"
                                onClick={() => handleSetPrimary(location.id)}
                                disabled={saving}
                                title="Set as primary"
                                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-indigo-50 hover:text-indigo-600"
                              >
                                <Star className="size-4" />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteLocation(location.id)}
                              disabled={saving}
                              title="Delete location"
                              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Add Location Form */}
                    {showAddForm
                      ? (
                          <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4">
                            <div className="text-sm font-medium text-gray-700">New Location</div>

                            <input
                              type="text"
                              value={newLocation.name}
                              onChange={e => setNewLocation(prev => ({ ...prev, name: e.target.value }))}
                              placeholder="Location name *"
                              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />

                            <input
                              type="text"
                              value={newLocation.address}
                              onChange={e => setNewLocation(prev => ({ ...prev, address: e.target.value }))}
                              placeholder="Street address"
                              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />

                            <div className="grid grid-cols-3 gap-2">
                              <input
                                type="text"
                                value={newLocation.city}
                                onChange={e => setNewLocation(prev => ({ ...prev, city: e.target.value }))}
                                placeholder="City"
                                className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                              <input
                                type="text"
                                value={newLocation.state}
                                onChange={e => setNewLocation(prev => ({ ...prev, state: e.target.value }))}
                                placeholder="State"
                                className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                              <input
                                type="text"
                                value={newLocation.zipCode}
                                onChange={e => setNewLocation(prev => ({ ...prev, zipCode: e.target.value }))}
                                placeholder="ZIP"
                                className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                              />
                            </div>

                            <input
                              type="tel"
                              value={newLocation.phone}
                              onChange={e => setNewLocation(prev => ({ ...prev, phone: e.target.value }))}
                              placeholder="Phone"
                              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                            />

                            <div className="flex items-center gap-2 pt-2">
                              <button
                                type="button"
                                onClick={() => setShowAddForm(false)}
                                className="flex-1 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-100"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={handleAddLocation}
                                disabled={saving || !newLocation.name.trim()}
                                className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {saving ? 'Adding...' : 'Add Location'}
                              </button>
                            </div>
                          </div>
                        )
                      : canAddMore
                        ? (
                            <button
                              type="button"
                              onClick={() => setShowAddForm(true)}
                              className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-200 p-4 text-gray-500 transition-colors hover:border-indigo-300 hover:text-indigo-600"
                            >
                              <Plus className="size-5" />
                              Add Location
                            </button>
                          )
                        : (
                            <div className="py-4 text-center text-sm text-gray-500">
                              Maximum locations reached for this plan
                            </div>
                          )}
                  </div>
                )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end border-t border-gray-200 bg-gray-50 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
