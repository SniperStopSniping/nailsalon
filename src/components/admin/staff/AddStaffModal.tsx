'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Camera, Check, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import type { SkillLevel, StaffRole } from '@/models/Schema';
import { useSalon } from '@/providers/SalonProvider';

// =============================================================================
// Types
// =============================================================================

type AddStaffModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
};

type ServiceOption = {
  id: string;
  name: string;
  category: string;
  selected: boolean;
};

// =============================================================================
// Constants
// =============================================================================

const ROLE_OPTIONS: { value: StaffRole; label: string }[] = [
  { value: 'tech', label: 'Technician' },
  { value: 'junior', label: 'Junior Tech' },
  { value: 'senior', label: 'Senior Tech' },
  { value: 'admin', label: 'Admin' },
  { value: 'front_desk', label: 'Front Desk' },
];

const SKILL_OPTIONS: { value: SkillLevel; label: string }[] = [
  { value: 'junior', label: 'Junior' },
  { value: 'standard', label: 'Standard' },
  { value: 'senior', label: 'Senior' },
  { value: 'master', label: 'Master' },
];

const LANGUAGE_OPTIONS = [
  'English',
  'Spanish',
  'French',
  'Mandarin',
  'Cantonese',
  'Vietnamese',
  'Korean',
  'Russian',
  'Portuguese',
];

// =============================================================================
// Component
// =============================================================================

export function AddStaffModal({ isOpen, onClose, onSuccess }: AddStaffModalProps) {
  const { salonSlug } = useSalon();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<StaffRole>('tech');
  const [skillLevel, setSkillLevel] = useState<SkillLevel>('standard');
  const [commissionRate, setCommissionRate] = useState('40');
  const [languages, setLanguages] = useState<string[]>(['English']);
  const [acceptingNewClients, setAcceptingNewClients] = useState(true);
  const [bio, setBio] = useState('');

  // Avatar state
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Services state
  const [services, setServices] = useState<ServiceOption[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);

  // Submit state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchServices = async () => {
    setLoadingServices(true);
    try {
      const response = await fetch(`/api/salon/services?salonSlug=${salonSlug}`);
      if (response.ok) {
        const result = await response.json();
        const serviceList = result.data?.services ?? [];
        setServices(
          serviceList.map((s: { id: string; name: string; category: string }) => ({
            id: s.id,
            name: s.name,
            category: s.category,
            selected: true, // Default all selected
          })),
        );
      }
    } catch {
      // Service fetch failed silently
    } finally {
      setLoadingServices(false);
    }
  };

  // Reset avatar state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setAvatarFile(null);
      setAvatarPreviewUrl(null);
    }
  }, [isOpen]);

  // Fetch services on open
  useEffect(() => {
    if (isOpen && salonSlug) {
      fetchServices();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, salonSlug]);

  // Handle avatar selection
  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    // Validate file
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setError('Please select a JPEG, PNG, or WebP image');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be less than 5MB');
      return;
    }

    setAvatarFile(file);
    setAvatarPreviewUrl(URL.createObjectURL(file));
    setError(null);
  };

  const toggleService = (serviceId: string) => {
    setServices(prev =>
      prev.map(s =>
        s.id === serviceId ? { ...s, selected: !s.selected } : s,
      ),
    );
  };

  const toggleLanguage = (language: string) => {
    setLanguages(prev =>
      prev.includes(language)
        ? prev.filter(l => l !== language)
        : [...prev, language],
    );
  };

  const resetForm = () => {
    setName('');
    setEmail('');
    setPhone('');
    setRole('tech');
    setSkillLevel('standard');
    setCommissionRate('40');
    setLanguages(['English']);
    setAcceptingNewClients(true);
    setBio('');
    setServices([]);
    setAvatarFile(null);
    setAvatarPreviewUrl(null);
    setError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/technicians', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          name: name.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          role,
          skillLevel,
          commissionRate: Number.parseFloat(commissionRate) / 100,
          languages: languages.length > 0 ? languages : null,
          acceptingNewClients,
          bio: bio.trim() || null,
        }),
      });

      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error?.message ?? 'Failed to create staff member');
      }

      const result = await response.json();
      const technicianId = result.data?.technician?.id;

      // If we have services and a technician ID, update their services
      if (technicianId && services.length > 0) {
        const selectedServices = services
          .filter(s => s.selected)
          .map((s, index) => ({
            serviceId: s.id,
            enabled: true,
            priority: index,
          }));

        await fetch(`/api/admin/technicians/${technicianId}/services`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            salonSlug,
            services: selectedServices,
          }),
        });
      }

      // If we have an avatar file, upload it
      if (technicianId && avatarFile) {
        setUploadingAvatar(true);
        try {
          const formData = new FormData();
          formData.append('file', avatarFile);
          formData.append('salonSlug', salonSlug);

          const avatarResponse = await fetch(`/api/admin/technicians/${technicianId}/avatar`, {
            method: 'POST',
            body: formData,
          });

          if (!avatarResponse.ok) {
            // Avatar upload failed but tech was created - show warning but don't fail
            console.error('Avatar upload failed, but staff was created');
          }
        } catch (avatarErr) {
          console.error('Error uploading avatar:', avatarErr);
          // Don't fail the whole operation - tech was already created
        } finally {
          setUploadingAvatar(false);
        }
      }

      // If we have a phone number, send SMS invite so tech can log in
      if (technicianId && phone.trim()) {
        try {
          await fetch(`/api/admin/technicians/${technicianId}/invite`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ salonSlug }),
          });
          // Don't fail if SMS fails - tech was already created
        } catch (inviteErr) {
          console.error('Error sending staff invite SMS:', inviteErr);
        }
      }

      onSuccess();
      resetForm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create staff member');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-[20px] bg-[#F2F2F7]"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              className="text-[17px] text-[#007AFF]"
            >
              Cancel
            </button>
            <h2 className="text-[17px] font-semibold text-[#1C1C1E]">Add Staff</h2>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || !name.trim()}
              className={`text-[17px] font-semibold ${
                isSubmitting || !name.trim() ? 'text-[#8E8E93]' : 'text-[#007AFF]'
              }`}
            >
              {isSubmitting ? 'Adding...' : 'Add'}
            </button>
          </div>

          {/* Form Content */}
          <div className="flex-1 overflow-y-auto">
            {error && (
              <div className="mx-4 mt-4 rounded-lg bg-red-100 p-3">
                <p className="text-[13px] text-red-600">{error}</p>
              </div>
            )}

            {/* Avatar Upload */}
            <div className="flex justify-center pb-2 pt-6">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleAvatarChange}
                className="hidden"
                aria-label="Upload profile photo"
              />
              <button
                type="button"
                onClick={handleAvatarClick}
                disabled={uploadingAvatar}
                className="group relative"
              >
                {avatarPreviewUrl
                  ? (
                      <img
                        src={avatarPreviewUrl}
                        alt="Avatar preview"
                        className="size-24 rounded-full object-cover"
                      />
                    )
                  : (
                      <div className="flex size-24 items-center justify-center rounded-full bg-gradient-to-br from-[#a18cd1] to-[#fbc2eb]">
                        <Camera className="size-8 text-white/80" />
                      </div>
                    )}
                {/* Hover/Loading Overlay */}
                <div
                  className={`
                    absolute inset-0 flex items-center justify-center rounded-full transition-opacity
                    ${uploadingAvatar ? 'bg-black/50' : 'bg-black/0 group-hover:bg-black/40'}
                  `}
                >
                  {uploadingAvatar
                    ? (
                        <Loader2 className="size-6 animate-spin text-white" />
                      )
                    : (
                        <Camera className="size-6 text-white opacity-0 transition-opacity group-hover:opacity-100" />
                      )}
                </div>
              </button>
            </div>
            <p className="mb-2 text-center text-[13px] text-[#8E8E93]">
              {avatarPreviewUrl ? 'Tap to change photo' : 'Add photo'}
            </p>

            {/* Basic Info */}
            <div className="mx-4 mt-4 overflow-hidden rounded-[12px] bg-white">
              <div className="border-b border-gray-100 p-4">
                <label className="mb-1 block text-[13px] text-[#8E8E93]">Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Enter name"
                  className="w-full bg-white text-[17px] text-[#1C1C1E] placeholder-[#C7C7CC] focus:outline-none"
                />
              </div>
              <div className="border-b border-gray-100 p-4">
                <label className="mb-1 block text-[13px] text-[#8E8E93]">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="Enter email"
                  className="w-full bg-white text-[17px] text-[#1C1C1E] placeholder-[#C7C7CC] focus:outline-none"
                />
              </div>
              <div className="p-4">
                <label className="mb-1 block text-[13px] text-[#8E8E93]">Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  placeholder="Enter phone"
                  className="w-full bg-white text-[17px] text-[#1C1C1E] placeholder-[#C7C7CC] focus:outline-none"
                />
              </div>
            </div>

            {/* Role & Skill */}
            <div className="mx-4 mt-4 overflow-hidden rounded-[12px] bg-white">
              <div className="border-b border-gray-100 p-4">
                <label className="mb-2 block text-[13px] text-[#8E8E93]">Role</label>
                <div className="flex flex-wrap gap-2">
                  {ROLE_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setRole(option.value)}
                      className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                        role === option.value
                          ? 'bg-[#007AFF] text-white'
                          : 'bg-[#E5E5EA] text-[#1C1C1E]'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="p-4">
                <label className="mb-2 block text-[13px] text-[#8E8E93]">Skill Level</label>
                <div className="flex flex-wrap gap-2">
                  {SKILL_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setSkillLevel(option.value)}
                      className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                        skillLevel === option.value
                          ? 'bg-[#007AFF] text-white'
                          : 'bg-[#E5E5EA] text-[#1C1C1E]'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Commission */}
            <div className="mx-4 mt-4 overflow-hidden rounded-[12px] bg-white p-4">
              <label className="mb-2 block text-[13px] text-[#8E8E93]">
                Commission Rate:
                {' '}
                {commissionRate}
                %
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={commissionRate}
                onChange={e => setCommissionRate(e.target.value)}
                className="w-full accent-[#007AFF]"
                aria-label="Commission rate percentage"
              />
              <div className="mt-1 flex justify-between text-[11px] text-[#8E8E93]">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>

            {/* Languages */}
            <div className="mx-4 mt-4 overflow-hidden rounded-[12px] bg-white p-4">
              <label className="mb-2 block text-[13px] text-[#8E8E93]">Languages</label>
              <div className="flex flex-wrap gap-2">
                {LANGUAGE_OPTIONS.map(lang => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => toggleLanguage(lang)}
                    className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
                      languages.includes(lang)
                        ? 'bg-[#34C759] text-white'
                        : 'bg-[#E5E5EA] text-[#1C1C1E]'
                    }`}
                  >
                    {lang}
                  </button>
                ))}
              </div>
            </div>

            {/* Settings */}
            <div className="mx-4 mt-4 overflow-hidden rounded-[12px] bg-white">
              <div className="flex items-center justify-between p-4">
                <span className="text-[17px] text-[#1C1C1E]">Accept New Clients</span>
                <button
                  type="button"
                  onClick={() => setAcceptingNewClients(!acceptingNewClients)}
                  aria-label={acceptingNewClients ? 'Disable accepting new clients' : 'Enable accepting new clients'}
                  className={`h-[31px] w-[51px] rounded-full p-[2px] transition-colors ${
                    acceptingNewClients ? 'bg-[#34C759]' : 'bg-[#E5E5EA]'
                  }`}
                >
                  <motion.div
                    className="size-[27px] rounded-full bg-white shadow-sm"
                    animate={{ x: acceptingNewClients ? 20 : 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                </button>
              </div>
            </div>

            {/* Bio */}
            <div className="mx-4 mt-4 overflow-hidden rounded-[12px] bg-white p-4">
              <label className="mb-1 block text-[13px] text-[#8E8E93]">Bio</label>
              <textarea
                value={bio}
                onChange={e => setBio(e.target.value)}
                placeholder="Short bio or description..."
                rows={3}
                className="w-full resize-none bg-white text-[15px] text-[#1C1C1E] placeholder-[#C7C7CC] focus:outline-none"
              />
            </div>

            {/* Services */}
            <div className="mx-4 mb-8 mt-4">
              <h3 className="mb-2 px-2 text-[13px] font-semibold uppercase text-[#8E8E93]">
                Services They Can Perform
              </h3>
              <div className="overflow-hidden rounded-[12px] bg-white">
                {loadingServices
                  ? (
                      <div className="p-4 text-center text-[#8E8E93]">Loading services...</div>
                    )
                  : services.length === 0
                    ? (
                        <div className="p-4 text-center text-[#8E8E93]">No services available</div>
                      )
                    : (
                        services.map((service, index) => (
                          <button
                            key={service.id}
                            type="button"
                            onClick={() => toggleService(service.id)}
                            className={`flex w-full items-center justify-between p-4 ${
                              index !== services.length - 1 ? 'border-b border-gray-100' : ''
                            }`}
                          >
                            <div>
                              <span className="text-[17px] text-[#1C1C1E]">{service.name}</span>
                              <span className="ml-2 text-[13px] capitalize text-[#8E8E93]">
                                {service.category}
                              </span>
                            </div>
                            <div
                              className={`flex size-6 items-center justify-center rounded-full border-2 ${
                                service.selected
                                  ? 'border-[#007AFF] bg-[#007AFF]'
                                  : 'border-[#C7C7CC]'
                              }`}
                            >
                              {service.selected && <Check className="size-4 text-white" />}
                            </div>
                          </button>
                        ))
                      )}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
