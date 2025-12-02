"use client";

import { useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";

type AuthState = "loggedOut" | "verify" | "loggedIn";
type Category = "hands" | "feet" | "combo";

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
    id: "biab-short",
    name: "BIAB Short",
    duration: 75,
    price: 65,
    category: "hands",
    imageUrl: "/assets/images/biab-short.webp",
  },
  {
    id: "biab-medium",
    name: "BIAB Medium",
    duration: 90,
    price: 75,
    category: "hands",
    imageUrl: "/assets/images/biab-medium.webp",
  },
  {
    id: "gelx-extensions",
    name: "Gel-X Extensions",
    duration: 105,
    price: 90,
    category: "hands",
    imageUrl: "/assets/images/gel-x-extensions.jpg",
  },
  {
    id: "biab-french",
    name: "BIAB French",
    duration: 90,
    price: 75,
    category: "hands",
    imageUrl: "/assets/images/biab-french.jpg",
  },

  // FEET
  {
    id: "spa-pedi",
    name: "SPA Pedicure",
    duration: 60,
    price: 60,
    category: "feet",
    imageUrl: "/images/services/spa-pedi.jpg",
  },
  {
    id: "gel-pedi",
    name: "Gel Pedicure",
    duration: 75,
    price: 70,
    category: "feet",
    imageUrl: "/images/services/gel-pedi.jpg",
  },

  // COMBO
  {
    id: "biab-gelx-combo",
    name: "BIAB + Gel-X Combo",
    duration: 150,
    price: 130,
    category: "combo",
    imageUrl: "/images/services/combo-hands-feet.jpg",
  },
  {
    id: "mani-pedi",
    name: "Classic Mani + Pedi",
    duration: 120,
    price: 95,
    category: "combo",
    imageUrl: "/images/services/mani-pedi.jpg",
  },
];

const CATEGORY_LABELS: { id: Category; label: string }[] = [
  { id: "hands", label: "Hands" },
  { id: "feet", label: "Feet" },
  { id: "combo", label: "Combo" },
];

export default function BookServicePage() {
  const router = useRouter();
  const [authState, setAuthState] = useState<AuthState>("loggedOut");
  const [selectedCategory, setSelectedCategory] = useState<Category>("hands");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
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
    setSelectedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectedCount = selectedServiceIds.length;

  const handleSendCode = () => {
    if (!phone.trim()) return;
    // TODO: call backend to send code
    setAuthState("verify");
  };

  const handleVerifyCode = () => {
    if (code.trim().length < 4) return;
    // TODO: verify with backend
    setAuthState("loggedIn");
  };

  // Auto-advance when phone number is complete (10 digits)
  useEffect(() => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 10) {
      handleSendCode();
    }
  }, [phone]);

  // Auto-advance when verification code is complete (6 digits)
  useEffect(() => {
    if (code.length === 6) {
      handleVerifyCode();
    }
  }, [code]);

  // Auto-focus verification code input when entering verify state
  useEffect(() => {
    if (authState === "verify" && codeInputRef.current) {
      codeInputRef.current.focus();
    }
  }, [authState]);

  const handleChooseTech = () => {
    if (!selectedServiceIds.length) return;
    const query = selectedServiceIds.join(",");
    router.push(`/book/tech?serviceIds=${query}`);
  };

  return (
    <div className="min-h-screen bg-[#f6ebdd] flex justify-center py-4">
      <div className="mx-auto max-w-[430px] w-full px-4 flex flex-col gap-4">
        {/* Top search */}
        <div className="pt-2">
          <div className="flex items-center rounded-full bg-white shadow-sm px-4 py-2.5">
            <span className="mr-2 text-neutral-400 text-lg">⌕</span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search BIAB, Gel-X, etc."
              className="flex-1 bg-transparent text-sm text-neutral-800 placeholder:text-neutral-400 outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="ml-2 flex items-center justify-center w-5 h-5 rounded-full hover:bg-neutral-100 transition-colors"
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
                className="relative pb-2 px-1"
              >
                <span
                  className={
                    active ? "text-neutral-900" : "text-neutral-400"
                  }
                >
                  {cat.label}
                </span>
                {active && (
                  <span className="absolute left-0 right-0 bottom-0 h-[2px] rounded-full bg-[#f4b864]" />
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
                className={`relative rounded-2xl overflow-hidden text-left shadow-sm transition-all duration-150 ${
                  isSelected
                    ? "bg-[#f5e6d3] ring-2 ring-[#d6a249] ring-offset-1 ring-offset-[#f6ebdd]"
                    : "bg-[#fff7ec]"
                }`}
              >
                {/* Image area - 2:3 aspect ratio, ~120px height */}
                <div className="h-[120px] bg-[#f0dfc9] rounded-t-2xl relative overflow-hidden">
                  <img
                    src={service.imageUrl}
                    alt={service.name}
                    className="w-full h-full object-cover"
                  />
                </div>

                {/* Content */}
                <div className="px-2.5 pb-2.5 pt-2">
                  <div className="text-[12px] font-semibold text-neutral-900 leading-tight">
                    {service.name}
                  </div>
                  <div className="mt-1 text-sm text-neutral-600">
                    {service.duration} min
                  </div>
                  <div className="mt-1 text-[12px] font-semibold text-neutral-900">
                    ${service.price}
                  </div>
                </div>

                {/* Check mark badge */}
                {isSelected && (
                  <div className="absolute top-2 right-2 h-6 w-6 rounded-full bg-[#d6a249] flex items-center justify-center text-xs font-bold text-white shadow-md transition-all duration-150">
                    ✓
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* Choose technician bar */}
        {selectedCount > 0 && (
          <div className="w-full rounded-xl bg-white shadow-sm px-4 py-3.5 flex items-center justify-between mt-1">
            <div className="text-sm font-semibold text-neutral-900">
              {selectedCount === 1 ? "1 service selected" : `${selectedCount} services selected`}
            </div>
            <button
              type="button"
              onClick={handleChooseTech}
              className="rounded-full bg-[#f4b864] px-5 py-2 text-sm font-semibold text-neutral-900 hover:bg-[#f4b864]/90 active:scale-[0.98] transition-all duration-150"
            >
              Choose technician
            </button>
          </div>
        )}

        {/* Auth footer */}
        <div className="mt-2 bg-white/95 border border-neutral-200/50 rounded-xl px-4 py-3.5 shadow-sm">
          {authState === "loggedOut" && (
            <div className="space-y-2.5">
              <p className="text-lg font-semibold text-neutral-700">
                <span
                  className="bg-clip-text text-transparent animate-shimmer inline-block"
                  style={{
                    backgroundImage:
                      "linear-gradient(to right, #7b4ea3, #f4b864, #7b4ea3, #f4b864, #7b4ea3)",
                    backgroundSize: "200% 100%",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  Login / sign up for a free manicure*
                </span>
              </p>
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-full bg-neutral-100 px-2.5 py-1.5 text-xs text-neutral-600">
                  <span className="mr-1">+1</span>
                </div>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "");
                    setPhone(digits.slice(0, 10));
                  }}
                  placeholder="Phone number"
                  className="flex-1 rounded-full bg-neutral-100 px-3 py-2 text-sm text-neutral-800 outline-none"
                />
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={!phone.trim()}
                  className="rounded-full bg-[#f4b864] px-4 py-2 text-sm font-semibold text-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all duration-150"
                >
                  →
                </button>
              </div>
              <p className="text-xs text-neutral-500">
                *New clients only. Conditions apply.
              </p>
            </div>
          )}

          {authState === "verify" && (
            <div className="space-y-2.5">
              <p className="text-[11px] font-semibold text-neutral-700">
                {`Enter the 6-digit code we sent to +1 ${phone}`}
              </p>
            <div className="flex items-center gap-2 w-full max-w-full">
                <input
                  ref={codeInputRef}
                type="tel"
                inputMode="numeric"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="-  -  -   -  -  -"
                className="flex-1 rounded-full bg-neutral-100 px-3 py-2 text-center tracking-[0.25em] text-base text-neutral-800 outline-none"
                />
                <button
                  type="button"
                  onClick={handleVerifyCode}
                  disabled={code.trim().length < 4}
                  className="rounded-full bg-[#f4b864] px-4 py-2 text-sm font-semibold text-neutral-900 disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98] transition-all duration-150"
                >
                  Verify
                </button>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAuthState("loggedOut");
                  setCode("");
                }}
                className="text-[11px] text-neutral-500 underline"
              >
                Edit phone number
              </button>
            </div>
          )}

          {authState === "loggedIn" && (
            <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-800">
              <button
                type="button"
                onClick={() => router.push(`/invite`)}
                className="flex flex-col items-center gap-1 active:scale-95 transition-transform duration-150"
              >
                <span className="text-lg">🤝</span>
                <span>Invite</span>
              </button>
              <button
                type="button"
                onClick={() => router.push(`/rewards`)}
                className="flex flex-col items-center gap-1 active:scale-95 transition-transform duration-150"
              >
                <span className="text-lg">💛</span>
                <span>Rewards</span>
              </button>
              <button
                type="button"
                onClick={() => router.push(`/profile`)}
                className="flex flex-col items-center gap-1 active:scale-95 transition-transform duration-150"
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
