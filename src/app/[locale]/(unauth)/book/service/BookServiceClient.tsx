'use client';

import Image from 'next/image';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { BlockingLoginModal } from '@/components/BlockingLoginModal';
import { FormInput } from '@/components/FormInput';
import { MainCard } from '@/components/MainCard';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

type AuthState = 'loggedOut' | 'verify' | 'loggedIn';
type Category = 'hands' | 'feet' | 'combo';

export type ServiceData = {
  id: string;
  name: string;
  description?: string | null;
  duration: number;
  price: number; // In dollars (converted from cents)
  category: Category;
  imageUrl: string;
};

interface BookServiceClientProps {
  services: ServiceData[];
}

const CATEGORY_LABELS: { id: Category; label: string; icon: string }[] = [
  { id: 'hands', label: 'Hands', icon: '💅' },
  { id: 'feet', label: 'Feet', icon: '🦶' },
  { id: 'combo', label: 'Combo', icon: '✨' },
];

export function BookServiceClient({ services }: BookServiceClientProps) {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const { salonName } = useSalon();
  const locale = (params?.locale as string) || 'en';

  // Get reschedule params from URL (passed from change-appointment page)
  const originalAppointmentId = searchParams.get('originalAppointmentId') || '';
  const urlClientPhone = searchParams.get('clientPhone') || '';
  const [authState, setAuthState] = useState<AuthState>('loggedOut');
  const [selectedCategory, setSelectedCategory] = useState<Category>('hands');
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [pendingServiceIds, setPendingServiceIds] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Check for existing session on mount
  useEffect(() => {
    setMounted(true);

    // If we have a phone from the URL (reschedule flow), use it directly
    if (urlClientPhone) {
      setAuthState('loggedIn');
      setPhone(urlClientPhone);
      setIsCheckingSession(false);
      return;
    }

    const validateSession = async () => {
      try {
        const response = await fetch('/api/auth/validate-session');
        const data = await response.json();

        if (data.valid && data.phone) {
          setAuthState('loggedIn');
          setPhone(data.phone);
        }
      } catch {
        // Session validation failed, stay logged out
        console.log('Session validation failed, user needs to log in');
      } finally {
        setIsCheckingSession(false);
      }
    };

    validateSession();
  }, [urlClientPhone]);

  const filteredServices = services.filter((service) => {
    if (searchQuery) {
      return service.name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return service.category === selectedCategory;
  });

  const toggleService = (id: string) => {
    setSelectedServiceIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  };

  const selectedCount = selectedServiceIds.length;
  const selectedServices = services.filter(s => selectedServiceIds.includes(s.id));
  const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);

  const handleSendCode = async () => {
    if (!phone.trim() || phone.length < 10 || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Failed to send code');
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
      setAuthState('verify');
    } catch {
      setError('Network error. Please try again.');
      setIsLoading(false);
    }
  };

  const handleVerifyCode = async () => {
    if (code.trim().length < 6 || isLoading) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Invalid code');
        setIsLoading(false);
        return;
      }

      setIsLoading(false);
      setAuthState('loggedIn');
    } catch {
      setError('Network error. Please try again.');
      setIsLoading(false);
    }
  };

  // Auto-send code when phone number is complete (10 digits)
  useEffect(() => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10 && authState === 'loggedOut' && !isLoading) {
      const timer = setTimeout(() => handleSendCode(), 150);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, authState]);

  // Auto-verify when code is complete (6 digits)
  useEffect(() => {
    if (code.length === 6 && authState === 'verify' && !isLoading) {
      const timer = setTimeout(() => handleVerifyCode(), 150);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, authState]);

  useEffect(() => {
    if (authState === 'verify' && codeInputRef.current) {
      codeInputRef.current.focus();
    }
  }, [authState]);

  const goToTechSelection = (serviceIds: string[], clientPhone: string) => {
    const query = serviceIds.join(',');
    // Strip +1 prefix if present to get just 10-digit number for the API
    const normalizedPhone = clientPhone.replace(/^\+1/, '');
    let url = `/${locale}/book/tech?serviceIds=${query}&clientPhone=${encodeURIComponent(normalizedPhone)}`;

    // Pass through originalAppointmentId for reschedule flow
    if (originalAppointmentId) {
      url += `&originalAppointmentId=${encodeURIComponent(originalAppointmentId)}`;
    }

    router.push(url);
  };

  const handleChooseTech = () => {
    if (!selectedServiceIds.length) {
      return;
    }

    if (authState === 'loggedIn' && phone) {
      goToTechSelection(selectedServiceIds, phone);
      return;
    }

    setPendingServiceIds(selectedServiceIds);
    setIsLoginModalOpen(true);
  };

  const handleLoginSuccess = (verifiedPhone: string) => {
    setAuthState('loggedIn');
    setPhone(verifiedPhone);
    setIsLoginModalOpen(false);
    if (pendingServiceIds.length > 0) {
      goToTechSelection(pendingServiceIds, verifiedPhone);
      setPendingServiceIds([]);
    }
  };

  const handleCloseLoginModal = () => {
    setIsLoginModalOpen(false);
    setPendingServiceIds([]);
  };

  return (
    <div
      className="min-h-screen"
      style={{
        background: `linear-gradient(to bottom, color-mix(in srgb, ${themeVars.background} 95%, white), ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4 pb-10">
        {/* Header */}
        <div
          className="pb-2 pt-6 text-center"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(-8px)',
            transition: 'opacity 300ms ease-out, transform 300ms ease-out',
          }}
        >
          <div className="text-lg font-semibold tracking-tight" style={{ color: themeVars.accent }}>
            {salonName}
          </div>
        </div>

        {/* Progress Steps */}
        <div
          className="mb-4 flex items-center justify-center gap-2"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 300ms ease-out 50ms',
          }}
        >
          {['Service', 'Artist', 'Time', 'Confirm'].map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 ${i === 0 ? 'opacity-100' : 'opacity-40'}`}>
                <div
                  className="flex size-6 items-center justify-center rounded-full text-xs font-bold"
                  style={{
                    backgroundColor: i === 0 ? themeVars.primary : undefined,
                    color: i === 0 ? '#171717' : '#525252',
                  }}
                >
                  {i + 1}
                </div>
                <span className={`text-xs font-medium ${i === 0 ? 'text-neutral-900' : 'text-neutral-500'}`}>
                  {step}
                </span>
              </div>
              {i < 3 && <div className="h-px w-4 bg-neutral-300" />}
            </div>
          ))}
        </div>

        {/* Search Bar */}
        <div
          className="mb-4"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
          }}
        >
          <div
            className="flex items-center rounded-2xl bg-white px-4 py-3 shadow-sm"
            style={{ borderWidth: '1px', borderStyle: 'solid', borderColor: themeVars.cardBorder }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="mr-3 text-neutral-400">
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
              <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search services..."
              className="flex-1 bg-transparent text-base text-neutral-800 outline-none placeholder:text-neutral-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="ml-2 flex size-6 items-center justify-center rounded-full bg-neutral-100 transition-colors hover:bg-neutral-200"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Category Tabs */}
        <div
          className="mb-5 flex items-center justify-center gap-2"
          style={{
            opacity: mounted ? 1 : 0,
            transition: 'opacity 300ms ease-out 150ms',
          }}
        >
          {CATEGORY_LABELS.map((cat) => {
            const active = cat.id === selectedCategory;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className="flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold transition-all duration-200"
                style={{
                  backgroundColor: active ? themeVars.accent : 'white',
                  color: active ? 'white' : '#525252',
                  borderWidth: active ? 0 : '1px',
                  borderStyle: 'solid',
                  borderColor: active ? 'transparent' : themeVars.cardBorder,
                  boxShadow: active ? '0 4px 6px -1px rgb(0 0 0 / 0.1)' : undefined,
                }}
              >
                <span>{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            );
          })}
        </div>

        {/* Services Grid */}
        <div className="grid grid-cols-2 gap-3">
          {filteredServices.map((service, index) => {
            const isSelected = selectedServiceIds.includes(service.id);
            return (
              <button
                key={service.id}
                type="button"
                onClick={() => toggleService(service.id)}
                className="relative overflow-hidden rounded-2xl text-left transition-all duration-200"
                style={{
                  transform: mounted ? (isSelected ? 'scale(1.02)' : 'translateY(0)') : 'translateY(15px)',
                  opacity: mounted ? 1 : 0,
                  background: isSelected
                    ? `linear-gradient(to bottom right, color-mix(in srgb, ${themeVars.primary} 20%, transparent), color-mix(in srgb, ${themeVars.primaryDark} 10%, transparent))`
                    : 'white',
                  boxShadow: isSelected
                    ? '0 10px 15px -3px rgb(0 0 0 / 0.1)'
                    : '0 4px 20px rgba(0,0,0,0.06)',
                  borderWidth: isSelected ? 0 : '1px',
                  borderStyle: 'solid',
                  borderColor: isSelected ? 'transparent' : themeVars.cardBorder,
                  outline: isSelected ? `2px solid ${themeVars.primary}` : undefined,
                  outlineOffset: isSelected ? '0px' : undefined,
                  transition: `opacity 300ms ease-out ${200 + index * 50}ms, transform 300ms ease-out ${200 + index * 50}ms, box-shadow 200ms ease-out, border-color 200ms ease-out`,
                }}
              >
                {/* Image */}
                <div
                  className="relative h-[120px] overflow-hidden"
                  style={{
                    background: `linear-gradient(to bottom right, color-mix(in srgb, ${themeVars.background} 80%, ${themeVars.primaryDark}), color-mix(in srgb, ${themeVars.selectedBackground} 90%, ${themeVars.primaryDark}))`,
                  }}
                >
                  <Image
                    src={service.imageUrl}
                    alt={service.name}
                    fill
                    className={`object-cover transition-transform duration-300 ${isSelected ? 'scale-105' : ''}`}
                  />
                  {/* Selection checkmark */}
                  {isSelected && (
                    <div
                      className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full shadow-lg"
                      style={{
                        background: `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`,
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-white">
                        <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-3">
                  <div className="text-base font-bold leading-tight text-neutral-900">
                    {service.name}
                  </div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-sm text-neutral-500">
                      {service.duration}
                      {' '}
                      min
                    </span>
                    <span className="text-base font-bold" style={{ color: themeVars.accent }}>
                      $
                      {service.price}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Spacer for fixed bottom bar */}
        {selectedCount > 0 && <div className="h-24" />}

        {/* Auth Footer */}
        <MainCard className="mt-4">
          {isCheckingSession && (
            <div className="flex items-center justify-center py-4">
              <div className="size-5 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" />
              <span className="ml-2 text-sm text-neutral-500">Checking session...</span>
            </div>
          )}

          {!isCheckingSession && authState === 'loggedOut' && (
            <div className="space-y-3">
              <p className="text-lg font-bold text-neutral-800">
                <span
                  className="bg-clip-text text-transparent"
                  style={{
                    backgroundImage: `linear-gradient(to right, ${themeVars.accent}, ${themeVars.primary})`,
                  }}
                >
                  New here? Get a free manicure! 💅
                </span>
              </p>
              <p className="-mt-1 text-sm text-neutral-500">
                Enter your number to sign up or log in
              </p>
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-full bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-600">
                  +1
                </div>
                <FormInput
                  type="tel"
                  value={phone}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '');
                    setPhone(digits.slice(0, 10));
                    setError(null);
                  }}
                  placeholder="Phone number"
                  className="!px-4 !py-2.5 !text-base"
                />
                <PrimaryButton
                  onClick={handleSendCode}
                  disabled={!phone.trim() || phone.length < 10 || isLoading}
                  size="sm"
                  fullWidth={false}
                >
                  {isLoading ? '...' : '→'}
                </PrimaryButton>
              </div>
              {error && (
                <p className="text-xs text-red-500">{error}</p>
              )}
              <p className="text-xs text-neutral-400">
                *New clients only. Conditions apply.
              </p>
            </div>
          )}

          {!isCheckingSession && authState === 'verify' && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-neutral-700">
                Enter the 6-digit code we sent to +1
                {' '}
                {phone}
              </p>
              <div className="flex items-center gap-2">
                <FormInput
                  ref={codeInputRef}
                  type="tel"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                    setError(null);
                  }}
                  placeholder="• • • • • •"
                  className="!w-full !px-4 !py-2.5 !text-center !text-lg !tracking-[0.3em]"
                />
                <PrimaryButton
                  onClick={handleVerifyCode}
                  disabled={code.trim().length < 6 || isLoading}
                  size="sm"
                  fullWidth={false}
                >
                  {isLoading ? '...' : 'Verify'}
                </PrimaryButton>
              </div>
              {error && (
                <p className="text-xs text-red-500">{error}</p>
              )}
              <button
                type="button"
                onClick={() => {
                  setAuthState('loggedOut');
                  setCode('');
                  setError(null);
                }}
                className="text-sm font-medium hover:underline"
                style={{ color: themeVars.accent }}
              >
                ← Change phone number
              </button>
            </div>
          )}

          {!isCheckingSession && authState === 'loggedIn' && (
            <div className="flex items-center justify-around py-1">
              {[
                { icon: '🤝', label: 'Invite', path: `/${locale}/invite` },
                { icon: '🎁', label: 'Rewards', path: `/${locale}/rewards` },
                { icon: '👤', label: 'Profile', path: `/${locale}/profile` },
              ].map(item => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => router.push(item.path)}
                  className="flex flex-col items-center gap-1.5 rounded-xl px-4 py-2 transition-all hover:bg-neutral-50 active:scale-95"
                >
                  <span className="text-2xl">{item.icon}</span>
                  <span className="text-xs font-semibold text-neutral-700">{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </MainCard>

        {/* Blocking Login Modal */}
        <BlockingLoginModal
          isOpen={isLoginModalOpen}
          onClose={handleCloseLoginModal}
          onLoginSuccess={handleLoginSuccess}
        />
      </div>

      {/* Fixed Bottom Selection Bar */}
      {selectedCount > 0 && (
        <div
          className="fixed inset-x-0 bottom-0 z-50 bg-white shadow-[0_-4px_20px_rgba(0,0,0,0.1)]"
          style={{
            borderTopWidth: '1px',
            borderTopStyle: 'solid',
            borderTopColor: themeVars.cardBorder,
            animation: 'slideUp 0.3s ease-out',
          }}
        >
          <style jsx>
            {`
            @keyframes slideUp {
              from {
                transform: translateY(100%);
              }
              to {
                transform: translateY(0);
              }
            }
          `}
          </style>
          <div className="mx-auto flex max-w-[430px] items-center justify-between p-4">
            <div>
              <div className="text-sm text-neutral-500">
                {selectedCount === 1 ? '1 service' : `${selectedCount} services`}
              </div>
              <div className="text-xl font-bold text-neutral-900">
                $
                {totalPrice}
              </div>
            </div>
            <button
              type="button"
              onClick={handleChooseTech}
              className="flex items-center gap-2 rounded-full px-6 py-3 text-base font-bold text-neutral-900 shadow-md transition-all hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]"
              style={{
                background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`,
              }}
            >
              Continue
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M5 12h14M12 5l7 7-7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          {/* Safe area padding for devices with home indicator */}
          <div className="h-[env(safe-area-inset-bottom)]" />
        </div>
      )}
    </div>
  );
}

