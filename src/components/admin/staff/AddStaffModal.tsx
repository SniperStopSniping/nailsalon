'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { Check, Camera, Loader2 } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

import { useSalon } from '@/providers/SalonProvider';
import type { StaffRole, SkillLevel } from '@/models/Schema';

// =============================================================================
// Types
// =============================================================================

interface AddStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface ServiceOption {
  id: string;
  name: string;
  category: string;
  selected: boolean;
}

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
  }, [isOpen, salonSlug]);

  // Handle avatar selection
  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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
          }))
        );
      }
    } catch (err) {
      console.error('Failed to fetch services:', err);
    } finally {
      setLoadingServices(false);
    }
  };

  const toggleService = (serviceId: string) => {
    setServices((prev) =>
      prev.map((s) =>
        s.id === serviceId ? { ...s, selected: !s.selected } : s
      )
    );
  };

  const toggleLanguage = (language: string) => {
    setLanguages((prev) =>
      prev.includes(language)
        ? prev.filter((l) => l !== language)
        : [...prev, language]
    );
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
          commissionRate: parseFloat(commissionRate) / 100,
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
          .filter((s) => s.selected)
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

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/50 flex items-end justify-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ y: '100%' }}
          animate={{ y: 0 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="bg-[#F2F2F7] w-full max-w-lg rounded-t-[20px] max-h-[90vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
            <button
              type="button"
              onClick={onClose}
              className="text-[#007AFF] text-[17px]"
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
              <div className="mx-4 mt-4 p-3 bg-red-100 rounded-lg">
                <p className="text-[13px] text-red-600">{error}</p>
              </div>
            )}

            {/* Avatar Upload */}
            <div className="flex justify-center pt-6 pb-2">
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
                className="relative group"
              >
                {avatarPreviewUrl ? (
                  <img
                    src={avatarPreviewUrl}
                    alt="Avatar preview"
                    className="w-24 h-24 rounded-full object-cover"
                  />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#a18cd1] to-[#fbc2eb] flex items-center justify-center">
                    <Camera className="w-8 h-8 text-white/80" />
                  </div>
                )}
                {/* Hover/Loading Overlay */}
                <div
                  className={`
                    absolute inset-0 rounded-full flex items-center justify-center transition-opacity
                    ${uploadingAvatar ? 'bg-black/50' : 'bg-black/0 group-hover:bg-black/40'}
                  `}
                >
                  {uploadingAvatar ? (
                    <Loader2 className="w-6 h-6 text-white animate-spin" />
                  ) : (
                    <Camera className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </div>
              </button>
            </div>
            <p className="text-center text-[13px] text-[#8E8E93] mb-2">
              {avatarPreviewUrl ? 'Tap to change photo' : 'Add photo'}
            </p>

            {/* Basic Info */}
            <div className="bg-white mx-4 mt-4 rounded-[12px] overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <label className="text-[13px] text-[#8E8E93] mb-1 block">Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter name"
                  className="w-full text-[17px] text-[#1C1C1E] placeholder-[#C7C7CC] focus:outline-none bg-white"
                />
              </div>
              <div className="p-4 border-b border-gray-100">
                <label className="text-[13px] text-[#8E8E93] mb-1 block">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter email"
                  className="w-full text-[17px] text-[#1C1C1E] placeholder-[#C7C7CC] focus:outline-none bg-white"
                />
              </div>
              <div className="p-4">
                <label className="text-[13px] text-[#8E8E93] mb-1 block">Phone</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="Enter phone"
                  className="w-full text-[17px] text-[#1C1C1E] placeholder-[#C7C7CC] focus:outline-none bg-white"
                />
              </div>
            </div>

            {/* Role & Skill */}
            <div className="bg-white mx-4 mt-4 rounded-[12px] overflow-hidden">
              <div className="p-4 border-b border-gray-100">
                <label className="text-[13px] text-[#8E8E93] mb-2 block">Role</label>
                <div className="flex flex-wrap gap-2">
                  {ROLE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setRole(option.value)}
                      className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
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
                <label className="text-[13px] text-[#8E8E93] mb-2 block">Skill Level</label>
                <div className="flex flex-wrap gap-2">
                  {SKILL_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setSkillLevel(option.value)}
                      className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
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
            <div className="bg-white mx-4 mt-4 rounded-[12px] overflow-hidden p-4">
              <label className="text-[13px] text-[#8E8E93] mb-2 block">
                Commission Rate: {commissionRate}%
              </label>
              <input
                type="range"
                min="0"
                max="100"
                value={commissionRate}
                onChange={(e) => setCommissionRate(e.target.value)}
                className="w-full accent-[#007AFF]"
                aria-label="Commission rate percentage"
              />
              <div className="flex justify-between text-[11px] text-[#8E8E93] mt-1">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>

            {/* Languages */}
            <div className="bg-white mx-4 mt-4 rounded-[12px] overflow-hidden p-4">
              <label className="text-[13px] text-[#8E8E93] mb-2 block">Languages</label>
              <div className="flex flex-wrap gap-2">
                {LANGUAGE_OPTIONS.map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => toggleLanguage(lang)}
                    className={`px-3 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
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
            <div className="bg-white mx-4 mt-4 rounded-[12px] overflow-hidden">
              <div className="p-4 flex items-center justify-between">
                <span className="text-[17px] text-[#1C1C1E]">Accept New Clients</span>
                <button
                  type="button"
                  onClick={() => setAcceptingNewClients(!acceptingNewClients)}
                  aria-label={acceptingNewClients ? 'Disable accepting new clients' : 'Enable accepting new clients'}
                  className={`w-[51px] h-[31px] rounded-full p-[2px] transition-colors ${
                    acceptingNewClients ? 'bg-[#34C759]' : 'bg-[#E5E5EA]'
                  }`}
                >
                  <motion.div
                    className="w-[27px] h-[27px] bg-white rounded-full shadow-sm"
                    animate={{ x: acceptingNewClients ? 20 : 0 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  />
                </button>
              </div>
            </div>

            {/* Bio */}
            <div className="bg-white mx-4 mt-4 rounded-[12px] overflow-hidden p-4">
              <label className="text-[13px] text-[#8E8E93] mb-1 block">Bio</label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Short bio or description..."
                rows={3}
                className="w-full text-[15px] text-[#1C1C1E] placeholder-[#C7C7CC] focus:outline-none resize-none bg-white"
              />
            </div>

            {/* Services */}
            <div className="mx-4 mt-4 mb-8">
              <h3 className="text-[13px] font-semibold text-[#8E8E93] uppercase mb-2 px-2">
                Services They Can Perform
              </h3>
              <div className="bg-white rounded-[12px] overflow-hidden">
                {loadingServices ? (
                  <div className="p-4 text-center text-[#8E8E93]">Loading services...</div>
                ) : services.length === 0 ? (
                  <div className="p-4 text-center text-[#8E8E93]">No services available</div>
                ) : (
                  services.map((service, index) => (
                    <button
                      key={service.id}
                      type="button"
                      onClick={() => toggleService(service.id)}
                      className={`w-full flex items-center justify-between p-4 ${
                        index !== services.length - 1 ? 'border-b border-gray-100' : ''
                      }`}
                    >
                      <div>
                        <span className="text-[17px] text-[#1C1C1E]">{service.name}</span>
                        <span className="text-[13px] text-[#8E8E93] ml-2 capitalize">
                          {service.category}
                        </span>
                      </div>
                      <div
                        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                          service.selected
                            ? 'bg-[#007AFF] border-[#007AFF]'
                            : 'border-[#C7C7CC]'
                        }`}
                      >
                        {service.selected && <Check className="w-4 h-4 text-white" />}
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
