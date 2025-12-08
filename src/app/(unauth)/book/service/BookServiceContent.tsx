'use client';

import { Gift, Handshake, User } from 'lucide-react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

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

const triggerHaptic = () => {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    navigator.vibrate(10);
  }
};

const FloatingDock = () => {
  const router = useRouter();

  return (
    <div
      role="navigation"
      aria-label="Bottom Navigation"
      className="bg-[var(--n5-bg-card)]/90 fixed bottom-6 left-1/2 z-50 flex h-16 w-[90%] max-w-[400px] -translate-x-1/2 items-center justify-between rounded-[2rem] border border-white/50 px-8 shadow-[var(--n5-shadow-dock)] backdrop-blur-xl"
    >
      <button
        onClick={() => {
          triggerHaptic();
          router.push('/invite');
        }}
        aria-label="Go to Invite"
        className="p-2 text-[var(--n5-ink-muted)] transition-colors"
      >
        <Handshake strokeWidth={2} className="size-6" />
      </button>
      <button
        onClick={() => {
          triggerHaptic();
          router.push('/rewards');
        }}
        aria-label="Go to Rewards"
        className="p-2 text-[var(--n5-ink-muted)] transition-colors"
      >
        <Gift strokeWidth={2} className="size-6" />
      </button>
      <button
        onClick={() => {
          triggerHaptic();
          router.push('/profile');
        }}
        aria-label="Go to Profile"
        className="p-2 text-[var(--n5-ink-muted)] transition-colors"
      >
        <User strokeWidth={2} className="size-6" />
      </button>
    </div>
  );
};

export default function BookServiceContent() {
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
    return;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, authState]);

  // Auto-verify when code is complete (6 digits)
  useEffect(() => {
    if (code.length === 6 && authState === 'verify' && !isLoading) {
      const timer = setTimeout(() => handleVerifyCode(), 150);
      return () => clearTimeout(timer);
    }
    return;
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
      className="flex min-h-screen justify-center py-4 bg-[var(--n5-bg-page)]"
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col gap-4 px-4">
        {/* Top search */}
        <div className="pt-2">
          <div
            className="flex items-center px-4 py-2.5 shadow-[var(--n5-shadow-sm)] bg-[var(--n5-bg-card)]"
            style={{ borderRadius: 'var(--n5-radius-pill)' }}
          >
            <span className="mr-2 text-lg text-[var(--n5-ink-muted)]">⌕</span>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search BIAB, Gel-X, etc."
              className="flex-1 bg-transparent text-sm font-body text-[var(--n5-ink-main)] outline-none placeholder:text-[var(--n5-ink-muted)]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="ml-2 flex size-5 items-center justify-center rounded-full transition-colors hover:bg-[var(--n5-bg-surface)]"
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
        <div className="flex items-center justify-center gap-8 text-sm font-semibold font-body">
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
                    active ? 'text-[var(--n5-ink-main)]' : 'text-[var(--n5-ink-muted)]'
                  }
                >
                  {cat.label}
                </span>
                {active && (
                  <span
                    className="absolute inset-x-0 bottom-0 h-[2px] bg-[var(--n5-accent)]"
                    style={{ borderRadius: 'var(--n5-radius-pill)' }}
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
                className={`relative overflow-hidden text-left shadow-[var(--n5-shadow-sm)] transition-all duration-150 ${
                  isSelected ? 'ring-2 ring-offset-1 bg-[var(--n5-bg-selected)] ring-[var(--n5-accent)]' : 'bg-[var(--n5-bg-surface)]'
                }`}
                style={{
                  borderRadius: 'var(--n5-radius-md)',
                }}
              >
                {/* Image area - 2:3 aspect ratio, ~120px height */}
                <div
                  className="relative h-[120px] overflow-hidden bg-[var(--n5-bg-selected)]"
                  style={{ borderRadius: 'var(--n5-radius-md) var(--n5-radius-md) 0 0' }}
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
                  <div className="text-[12px] font-semibold font-body leading-tight text-[var(--n5-ink-main)]">
                    {service.name}
                  </div>
                  <div className="mt-1 text-sm font-body text-[var(--n5-ink-muted)]">
                    {service.duration}
                    {' '}
                    min
                  </div>
                  <div className="mt-1 text-[12px] font-semibold font-body text-[var(--n5-ink-main)]">
                    $
                    {service.price}
                  </div>
                </div>

                {/* Check mark badge */}
                {isSelected && (
                  <div
                    className="absolute right-2 top-2 flex size-6 items-center justify-center text-xs font-bold text-[var(--n5-ink-inverse)] shadow-md transition-all duration-150 bg-[var(--n5-accent-hover)]"
                    style={{ borderRadius: 'var(--n5-radius-pill)' }}
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
          <div
            className="mt-1 flex w-full items-center justify-between px-4 py-3.5 shadow-[var(--n5-shadow-sm)] bg-[var(--n5-bg-card)]"
            style={{ borderRadius: 'var(--n5-radius-md)' }}
          >
            <div className="text-sm font-semibold font-body text-[var(--n5-ink-main)]">
              {selectedCount === 1 ? '1 service selected' : `${selectedCount} services selected`}
            </div>
            <button
              type="button"
              onClick={handleChooseTech}
              className="px-5 py-2 text-sm font-semibold font-body bg-[var(--n5-button-primary-bg)] text-[var(--n5-button-primary-text)] transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
              style={{ borderRadius: 'var(--n5-radius-pill)' }}
            >
              Choose technician
            </button>
          </div>
        )}

        {/* Auth footer */}
        <div
          className="mt-2 border border-[var(--n5-border)] bg-[var(--n5-bg-card)]/95 px-4 py-3.5 shadow-[var(--n5-shadow-sm)]"
          style={{ borderRadius: 'var(--n5-radius-md)' }}
        >
          {authState === 'loggedOut' && (
            <div className="space-y-2.5">
              <p className="text-lg font-semibold font-body">
                <span
                  className="inline-block animate-shimmer bg-clip-text text-transparent"
                  style={{
                    backgroundImage: `linear-gradient(to right, var(--n5-accent), var(--n5-accent-hover), var(--n5-accent), var(--n5-accent-hover), var(--n5-accent))`,
                    backgroundSize: '200% 100%',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  Login / sign up for a free manicure*
                </span>
              </p>
              <p className="-mt-1 text-sm font-body text-[var(--n5-ink-muted)]">
                Enter your number to sign up or log in
              </p>
              <div className="flex items-center gap-2">
                <div
                  className="flex items-center px-2.5 py-1.5 text-xs font-body bg-[var(--n5-bg-surface)] text-[var(--n5-ink-muted)]"
                  style={{ borderRadius: 'var(--n5-radius-pill)' }}
                >
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
                  className="flex-1 px-3 py-2 text-sm font-body bg-[var(--n5-bg-surface)] text-[var(--n5-ink-main)] outline-none"
                  style={{ borderRadius: 'var(--n5-radius-pill)' }}
                />
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={!phone.trim() || phone.length < 10 || isLoading}
                  className="px-4 py-2 text-sm font-semibold font-body bg-[var(--n5-button-primary-bg)] text-[var(--n5-button-primary-text)] transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ borderRadius: 'var(--n5-radius-pill)' }}
                >
                  {isLoading ? '...' : '→'}
                </button>
              </div>
              {error && (
                <p className="text-xs font-body text-[var(--n5-error)]">{error}</p>
              )}
              <p className="text-xs font-body text-[var(--n5-ink-muted)]">
                *New clients only. Conditions apply.
              </p>
            </div>
          )}

          {authState === 'verify' && (
            <div className="space-y-2.5">
              <p className="text-[11px] font-semibold font-body text-[var(--n5-ink-main)]">
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
                  className="flex-1 px-3 py-2 text-center text-base tracking-[0.25em] font-body bg-[var(--n5-bg-surface)] text-[var(--n5-ink-main)] outline-none"
                  style={{ borderRadius: 'var(--n5-radius-pill)' }}
                />
                <button
                  type="button"
                  onClick={handleVerifyCode}
                  disabled={code.trim().length < 6 || isLoading}
                  className="px-4 py-2 text-sm font-semibold font-body bg-[var(--n5-button-primary-bg)] text-[var(--n5-button-primary-text)] transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
                  style={{ borderRadius: 'var(--n5-radius-pill)' }}
                >
                  {isLoading ? '...' : 'Verify'}
                </button>
              </div>
              {error && (
                <p className="text-xs font-body text-[var(--n5-error)]">{error}</p>
              )}
              <button
                type="button"
                onClick={() => {
                  setAuthState('loggedOut');
                  setCode('');
                  setError(null);
                }}
                className="text-[11px] font-body text-[var(--n5-ink-muted)] underline"
              >
                Edit phone number
              </button>
            </div>
          )}

        </div>
      </div>

      {authState === 'loggedIn' && <FloatingDock />}
    </div>
  );
}
