'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';

import { useSalon } from '@/providers/SalonProvider';

// =============================================================================
// Types
// =============================================================================

interface ServiceCapability {
  serviceId: string;
  serviceName: string;
  serviceCategory: string;
  servicePrice: number;
  serviceDuration: number;
  assigned: boolean;
  enabled: boolean;
  priority: number;
}

interface ServicesTabProps {
  technicianId: string;
  onUpdate: () => void;
}

// =============================================================================
// Component
// =============================================================================

export function ServicesTab({ technicianId, onUpdate }: ServicesTabProps) {
  const { salonSlug } = useSalon();
  const [services, setServices] = useState<ServiceCapability[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Fetch services
  const fetchServices = useCallback(async () => {
    if (!salonSlug) return;

    try {
      setLoading(true);
      const response = await fetch(
        `/api/admin/technicians/${technicianId}/services?salonSlug=${salonSlug}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch services');
      }

      const result = await response.json();
      setServices(result.data?.services ?? []);
    } catch (err) {
      console.error('Error fetching services:', err);
    } finally {
      setLoading(false);
    }
  }, [salonSlug, technicianId]);

  useEffect(() => {
    fetchServices();
  }, [fetchServices]);

  const toggleService = (serviceId: string) => {
    setServices((prev) =>
      prev.map((s) =>
        s.serviceId === serviceId
          ? { ...s, enabled: !s.enabled, assigned: true }
          : s
      )
    );
    setHasChanges(true);
  };

  const handleSave = async () => {
    if (!salonSlug) return;

    setSaving(true);
    try {
      const enabledServices = services
        .filter((s) => s.enabled)
        .map((s, index) => ({
          serviceId: s.serviceId,
          enabled: true,
          priority: index,
        }));

      const response = await fetch(
        `/api/admin/technicians/${technicianId}/services`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            salonSlug,
            services: enabledServices,
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to save services');
      }

      setHasChanges(false);
      onUpdate();
    } catch (err) {
      console.error('Error saving services:', err);
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (cents: number): string => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(cents / 100);
  };

  // Group services by category
  const groupedServices = services.reduce(
    (acc, service) => {
      const category = service.serviceCategory || 'Other';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(service);
      return acc;
    },
    {} as Record<string, ServiceCapability[]>
  );

  if (loading) {
    return (
      <div className="p-4 space-y-4">
        <div className="bg-white rounded-[12px] p-4 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-4 py-3">
              <div className="w-6 h-6 rounded-full bg-gray-200" />
              <div className="flex-1">
                <div className="h-4 bg-gray-200 rounded w-32 mb-1" />
                <div className="h-3 bg-gray-100 rounded w-20" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4 pb-24">
      <p className="text-[13px] text-[#8E8E93] px-1">
        Select the services this staff member can perform. They will only appear in booking for enabled services.
      </p>

      {Object.entries(groupedServices).map(([category, categoryServices]) => (
        <div key={category}>
          <h3 className="text-[13px] font-semibold text-[#8E8E93] uppercase mb-2 px-1 capitalize">
            {category}
          </h3>
          <div className="bg-white rounded-[12px] overflow-hidden">
            {categoryServices.map((service, index) => (
              <button
                key={service.serviceId}
                type="button"
                onClick={() => toggleService(service.serviceId)}
                className={`
                  w-full flex items-center p-4 text-left
                  ${index !== categoryServices.length - 1 ? 'border-b border-gray-100' : ''}
                `}
              >
                {/* Checkbox */}
                <div
                  className={`
                    w-6 h-6 rounded-full border-2 flex items-center justify-center mr-3
                    ${
                      service.enabled
                        ? 'bg-[#007AFF] border-[#007AFF]'
                        : 'border-[#C7C7CC]'
                    }
                  `}
                >
                  {service.enabled && <Check className="w-4 h-4 text-white" />}
                </div>

                {/* Service Info */}
                <div className="flex-1 min-w-0">
                  <div className="text-[17px] text-[#1C1C1E]">{service.serviceName}</div>
                  <div className="text-[13px] text-[#8E8E93]">
                    {formatCurrency(service.servicePrice)} · {service.serviceDuration} min
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* Save Button */}
      {hasChanges && (
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="fixed bottom-20 left-4 right-4 max-w-lg mx-auto"
        >
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="w-full py-3 bg-[#007AFF] text-white rounded-xl text-[17px] font-semibold shadow-lg disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </motion.div>
      )}
    </div>
  );
}
