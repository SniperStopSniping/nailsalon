'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { themeVars } from '@/theme';

type AuthState = 'loggedOut' | 'verify' | 'loggedIn';
type Category = 'hands' | 'feet' | 'combo';

type Service = {
  id: string;
  name: string;
  duration: number; // minutes
  price: number; // dollars
  category: Category;
  imageUrl: string;
};

const SERVICES: Service[] = [
  // HANDS
  {
    id: 'biab-short',
    name: 'BIAB Short',
    duration: 75,
    price: 65,
    category: 'hands',
    imageUrl: '/assets/images/biab-short.webp',
  },
  {
    id: 'biab-medium',
    name: 'BIAB Medium',
    duration: 90,
    price: 75,
    category: 'hands',
    imageUrl: '/assets/images/biab-medium.webp',
  },
  {
    id: 'gelx-extensions',
    name: 'Gel-X Extensions',
    duration: 105,
    price: 90,
    category: 'hands',
    imageUrl: '/assets/images/gel-x-extensions.jpg',
  },
  {
    id: 'biab-french',
    name: 'BIAB French',
    duration: 90,
    price: 75,
    category: 'hands',
    imageUrl: '/assets/images/biab-french.jpg',
  },

  // FEET
  {
    id: 'spa-pedi',
    name: 'SPA Pedicure',
    duration: 60,
    price: 60,
    category: 'feet',
    imageUrl: '/images/services/spa-pedi.jpg',
  },
  {
    id: 'gel-pedi',
    name: 'Gel Pedicure',
    duration: 75,
    price: 70,
    category: 'feet',
    imageUrl: '/images/services/gel-pedi.jpg',
  },

  // COMBO
  {
    id: 'biab-gelx-combo',
    name: 'BIAB + Gel-X Combo',
    duration: 150,
    price: 130,
    category: 'combo',
    imageUrl: '/images/services/combo-hands-feet.jpg',
  },
  {
    id: 'mani-pedi',
    name: 'Classic Mani + Pedi',
    duration: 120,
    price: 95,
    category: 'combo',
    imageUrl: '/images/services/mani-pedi.jpg',
  },
];

const CATEGORY_LABELS: { id: Category; label: string }[] = [
  { id: 'hands', label: 'Hands' },
  { id: 'feet', label: 'Feet' },
  { id: 'combo', label: 'Combo' },
];

export default function BookServicePage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>('loggedOut');
  const [selectedCategory, setSelectedCategory] = useState<Category>('hands');
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const filteredServices = SERVICES.filter((service) => {
    // If there's a search query, search across all services
    if (searchQuery) {
      return service.name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    // Otherwise, filter by selected category
    return service.category === selectedCategory;
  });

  const toggleService = (id: string) => {
    setSelectedServiceIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id],
    );
  };

  const selectedCount = selectedServiceIds.length;

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

  // Auto-focus verification code input when entering verify state
  useEffect(() => {
    if (authState === 'verify' && codeInputRef.current) {
      codeInputRef.current.focus();
    }
  }, [authState]);

  const handleChooseTech = () => {
    if (!selectedServiceIds.length) {
      return;
    }
    const query = selectedServiceIds.join(',');
    router.push(`/book/tech?serviceIds=${query}`);
  };

  return (
    <div
      className="flex min-h-screen justify-center py-4"
      style={{ backgroundColor: themeVars.background }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col gap-4 px-4">
        {/* Top search */}
        <div className="pt-2">
          <div className="flex items-center rounded-full bg-white px-4 py-2.5 shadow-sm">
            <span className="mr-2 text-lg text-neutral-400">⌕</span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search BIAB, Gel-X, etc."
              className="flex-1 bg-transparent text-sm text-neutral-800 outline-none placeholder:text-neutral-400"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="ml-2 flex size-5 items-center justify-center rounded-full transition-colors hover:bg-neutral-100"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M9 3L3 9M3 3L9 9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Category tabs - centered */}
        <div className="flex items-center justify-center gap-8 text-sm font-semibold text-neutral-700">
          {CATEGORY_LABELS.map((cat) => {
            const active = cat.id === selectedCategory;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className="relative px-1 pb-2"
              >
                <span
                  className={
                    active ? 'text-neutral-900' : 'text-neutral-400'
                  }
                >
                  {cat.label}
                </span>
                {active && (
                  <span
                    className="absolute inset-x-0 bottom-0 h-[2px] rounded-full"
                    style={{ backgroundColor: themeVars.primary }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Services grid */}
        <div className="grid grid-cols-2 gap-2.5">
          {filteredServices.map((service) => {
            const isSelected = selectedServiceIds.includes(service.id);
            return (
              <button
                key={service.id}
                type="button"
                onClick={() => toggleService(service.id)}
                className={`relative overflow-hidden rounded-2xl text-left shadow-sm transition-all duration-150 ${
                  isSelected ? 'ring-2 ring-offset-1' : ''
                }`}
                style={{
                  backgroundColor: isSelected ? themeVars.selectedBackground : themeVars.surfaceAlt,
                  // @ts-expect-error - CSS custom properties for ring colors
                  '--tw-ring-color': isSelected ? themeVars.selectedRing : undefined,
                  '--tw-ring-offset-color': isSelected ? themeVars.background : undefined,
                }}
              >
                {/* Image area - 2:3 aspect ratio, ~120px height */}
                <div
                  className="relative h-[120px] overflow-hidden rounded-t-2xl"
                  style={{ backgroundColor: themeVars.selectedBackground }}
                >
                  <Image
                    src={service.imageUrl}
                    alt={service.name}
                    fill
                    className="object-cover"
                  />
                </div>

                {/* Content */}
                <div className="px-2.5 pb-2.5 pt-2">
                  <div className="text-[12px] font-semibold leading-tight text-neutral-900">
                    {service.name}
                  </div>
                  <div className="mt-1 text-sm text-neutral-600">
                    {service.duration}
                    {' '}
                    min
                  </div>
                  <div className="mt-1 text-[12px] font-semibold text-neutral-900">
                    $
                    {service.price}
                  </div>
                </div>

                {/* Check mark badge */}
                {isSelected && (
                  <div
                    className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full text-xs font-bold text-white shadow-md transition-all duration-150"
                    style={{ backgroundColor: themeVars.primaryDark }}
                  >
                    ✓
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Choose technician bar */}
        {selectedCount > 0 && (
          <div className="mt-1 flex w-full items-center justify-between rounded-xl bg-white px-4 py-3.5 shadow-sm">
            <div className="text-sm font-semibold text-neutral-900">
              {selectedCount === 1 ? '1 service selected' : `${selectedCount} services selected`}
            </div>
            <button
              type="button"
              onClick={handleChooseTech}
              className="rounded-full px-5 py-2 text-sm font-semibold text-neutral-900 transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
              style={{ backgroundColor: themeVars.primary }}
            >
              Choose technician
            </button>
          </div>
        )}

        {/* Auth footer */}
        <div className="mt-2 rounded-xl border border-neutral-200/50 bg-white/95 px-4 py-3.5 shadow-sm">
          {authState === 'loggedOut' && (
            <div className="space-y-2.5">
              <p className="text-lg font-semibold text-neutral-700">
                <span
                  className="inline-block animate-shimmer bg-clip-text text-transparent"
                  style={{
                    backgroundImage: `linear-gradient(to right, ${themeVars.accent}, ${themeVars.primary}, ${themeVars.accent}, ${themeVars.primary}, ${themeVars.accent})`,
                    backgroundSize: '200% 100%',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  Login / sign up for a free manicure*
                </span>
              </p>
              <p className="-mt-1 text-sm text-neutral-500">
                Enter your number to sign up or log in
              </p>
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-full bg-neutral-100 px-2.5 py-1.5 text-xs text-neutral-600">
                  <span className="mr-1">+1</span>
                </div>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '');
                    setPhone(digits.slice(0, 10));
                    setError(null);
                  }}
                  placeholder="Phone number"
                  className="flex-1 rounded-full bg-neutral-100 px-3 py-2 text-sm text-neutral-800 outline-none"
                />
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={!phone.trim() || phone.length < 10 || isLoading}
                  className="rounded-full px-4 py-2 text-sm font-semibold text-neutral-900 transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ backgroundColor: themeVars.primary }}
                >
                  {isLoading ? '...' : '→'}
                </button>
              </div>
              {error && (
                <p className="text-xs text-red-500">{error}</p>
              )}
              <p className="text-xs text-neutral-500">
                *New clients only. Conditions apply.
              </p>
            </div>
          )}

          {authState === 'verify' && (
            <div className="space-y-2.5">
              <p className="text-[11px] font-semibold text-neutral-700">
                {`Enter the 6-digit code we sent to +1 ${phone}`}
              </p>
              <div className="flex w-full max-w-full items-center gap-2">
                <input
                  ref={codeInputRef}
                  type="tel"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                    setError(null);
                  }}
                  placeholder="-  -  -   -  -  -"
                  className="flex-1 rounded-full bg-neutral-100 px-3 py-2 text-center text-base tracking-[0.25em] text-neutral-800 outline-none"
                />
                <button
                  type="button"
                  onClick={handleVerifyCode}
                  disabled={code.trim().length < 6 || isLoading}
                  className="rounded-full px-4 py-2 text-sm font-semibold text-neutral-900 transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ backgroundColor: themeVars.primary }}
                >
                  {isLoading ? '...' : 'Verify'}
                </button>
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
                className="text-[11px] text-neutral-500 underline"
              >
                Edit phone number
              </button>
            </div>
          )}

          {authState === 'loggedIn' && (
            <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-800">
              <button
                type="button"
                onClick={() => router.push(`/invite`)}
                className="flex flex-col items-center gap-1 transition-transform duration-150 active:scale-95"
              >
                <span className="text-lg">🤝</span>
                <span>Invite</span>
              </button>
              <button
                type="button"
                onClick={() => router.push(`/rewards`)}
                className="flex flex-col items-center gap-1 transition-transform duration-150 active:scale-95"
              >
                <span className="text-lg">💛</span>
                <span>Rewards</span>
              </button>
              <button
                type="button"
                onClick={() => router.push(`/profile`)}
                className="flex flex-col items-center gap-1 transition-transform duration-150 active:scale-95"
              >
                <span className="text-lg">👤</span>
                <span>Profile</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
