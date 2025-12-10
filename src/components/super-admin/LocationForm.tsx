'use client';

import { X, MapPin, Plus, Trash2, Star } from 'lucide-react';
import { useState, useCallback, useEffect } from 'react';

// =============================================================================
// Types
// =============================================================================

interface Location {
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
}

interface LocationFormProps {
  salonId: string;
  maxLocations: number;
  onClose: () => void;
}

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
    if (!newLocation.name.trim()) return;

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
    if (!confirm('Delete this location?')) return;

    setSaving(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/super-admin/organizations/${salonId}/locations/${locationId}`,
        { method: 'DELETE' }
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
        }
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
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
                <MapPin className="w-5 h-5 text-indigo-600" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Locations</h2>
                <p className="text-xs text-gray-500">
                  {locations.length} / {maxLocations} locations
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close modal"
              className="p-2 -m-2 text-gray-400 hover:text-gray-600"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {error && (
              <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-lg text-red-700 text-sm">
                {error}
              </div>
            )}

            {loading ? (
              <div className="flex items-center justify-center h-32">
                <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (
              <div className="space-y-4">
                {/* Existing Locations */}
                {locations.map((location) => (
                  <div
                    key={location.id}
                    className={`p-4 rounded-lg border ${
                      location.isPrimary
                        ? 'border-indigo-200 bg-indigo-50'
                        : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-medium text-gray-900 truncate">
                            {location.name}
                          </div>
                          {location.isPrimary && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded bg-indigo-100 text-indigo-700">
                              <Star className="w-3 h-3" />
                              Primary
                            </span>
                          )}
                        </div>
                        {(location.address || location.city) && (
                          <div className="text-sm text-gray-500 mt-1">
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
                            className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                          >
                            <Star className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteLocation(location.id)}
                          disabled={saving}
                          title="Delete location"
                          className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Add Location Form */}
                {showAddForm ? (
                  <div className="p-4 rounded-lg border border-gray-200 bg-white space-y-3">
                    <div className="text-sm font-medium text-gray-700">New Location</div>
                    
                    <input
                      type="text"
                      value={newLocation.name}
                      onChange={(e) => setNewLocation(prev => ({ ...prev, name: e.target.value }))}
                      placeholder="Location name *"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    
                    <input
                      type="text"
                      value={newLocation.address}
                      onChange={(e) => setNewLocation(prev => ({ ...prev, address: e.target.value }))}
                      placeholder="Street address"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={newLocation.city}
                        onChange={(e) => setNewLocation(prev => ({ ...prev, city: e.target.value }))}
                        placeholder="City"
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <input
                        type="text"
                        value={newLocation.state}
                        onChange={(e) => setNewLocation(prev => ({ ...prev, state: e.target.value }))}
                        placeholder="State"
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                      <input
                        type="text"
                        value={newLocation.zipCode}
                        onChange={(e) => setNewLocation(prev => ({ ...prev, zipCode: e.target.value }))}
                        placeholder="ZIP"
                        className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      />
                    </div>
                    
                    <input
                      type="tel"
                      value={newLocation.phone}
                      onChange={(e) => setNewLocation(prev => ({ ...prev, phone: e.target.value }))}
                      placeholder="Phone"
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                    
                    <div className="flex items-center gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowAddForm(false)}
                        className="flex-1 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleAddLocation}
                        disabled={saving || !newLocation.name.trim()}
                        className="flex-1 px-3 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {saving ? 'Adding...' : 'Add Location'}
                      </button>
                    </div>
                  </div>
                ) : canAddMore ? (
                  <button
                    type="button"
                    onClick={() => setShowAddForm(true)}
                    className="w-full flex items-center justify-center gap-2 p-4 rounded-lg border-2 border-dashed border-gray-200 text-gray-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
                  >
                    <Plus className="w-5 h-5" />
                    Add Location
                  </button>
                ) : (
                  <div className="text-center py-4 text-sm text-gray-500">
                    Maximum locations reached for this plan
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end px-6 py-4 border-t border-gray-200 bg-gray-50">
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
