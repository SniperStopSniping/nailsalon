"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect, useRef } from "react";
import { PrimaryButton } from "@/components/PrimaryButton";
import { FormInput } from "@/components/FormInput";
import { MainCard } from "@/components/MainCard";
import { BlockingLoginModal } from "@/components/BlockingLoginModal";

type AuthState = "loggedOut" | "verify" | "loggedIn";
type Category = "hands" | "feet" | "combo";

type Service = {
  id: string;
  name: string;
  duration: number;
  price: number;
  category: Category;
  imageUrl: string;
};

const SERVICES: Service[] = [
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
  {
    id: "spa-pedi",
    name: "SPA Pedicure",
    duration: 60,
    price: 60,
    category: "feet",
    imageUrl: "/assets/images/biab-short.webp",
  },
  {
    id: "gel-pedi",
    name: "Gel Pedicure",
    duration: 75,
    price: 70,
    category: "feet",
    imageUrl: "/assets/images/biab-medium.webp",
  },
  {
    id: "biab-gelx-combo",
    name: "BIAB + Gel-X Combo",
    duration: 150,
    price: 130,
    category: "combo",
    imageUrl: "/assets/images/gel-x-extensions.jpg",
  },
  {
    id: "mani-pedi",
    name: "Classic Mani + Pedi",
    duration: 120,
    price: 95,
    category: "combo",
    imageUrl: "/assets/images/biab-french.jpg",
  },
];

const CATEGORY_LABELS: { id: Category; label: string; icon: string }[] = [
  { id: "hands", label: "Hands", icon: "💅" },
  { id: "feet", label: "Feet", icon: "🦶" },
  { id: "combo", label: "Combo", icon: "✨" },
];

export default function BookServicePage() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const [authState, setAuthState] = useState<AuthState>("loggedOut");
  const [selectedCategory, setSelectedCategory] = useState<Category>("hands");
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>([]);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [pendingServiceIds, setPendingServiceIds] = useState<string[]>([]);
  const [mounted, setMounted] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const filteredServices = SERVICES.filter((service) => {
    if (searchQuery) {
      return service.name.toLowerCase().includes(searchQuery.toLowerCase());
    }
    return service.category === selectedCategory;
  });

  const toggleService = (id: string) => {
    setSelectedServiceIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectedCount = selectedServiceIds.length;
  const selectedServices = SERVICES.filter((s) => selectedServiceIds.includes(s.id));
  const totalPrice = selectedServices.reduce((sum, s) => sum + s.price, 0);

  const handleSendCode = () => {
    if (!phone.trim()) return;
    setAuthState("verify");
  };

  const handleVerifyCode = () => {
    if (code.trim().length < 4) return;
    setAuthState("loggedIn");
  };

  useEffect(() => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 10) {
      handleSendCode();
    }
  }, [phone]);

  useEffect(() => {
    if (code.length === 6) {
      handleVerifyCode();
    }
  }, [code]);

  useEffect(() => {
    if (authState === "verify" && codeInputRef.current) {
      codeInputRef.current.focus();
    }
  }, [authState]);

  const goToTechSelection = (serviceIds: string[]) => {
    const query = serviceIds.join(",");
    router.push(`/${locale}/book/tech?serviceIds=${query}`);
  };

  const handleChooseTech = () => {
    if (!selectedServiceIds.length) return;
    
    if (authState === "loggedIn") {
      goToTechSelection(selectedServiceIds);
      return;
    }
    
    setPendingServiceIds(selectedServiceIds);
    setIsLoginModalOpen(true);
  };

  const handleLoginSuccess = () => {
    setAuthState("loggedIn");
    setIsLoginModalOpen(false);
    if (pendingServiceIds.length > 0) {
      goToTechSelection(pendingServiceIds);
      setPendingServiceIds([]);
    }
  };

  const handleCloseLoginModal = () => {
    setIsLoginModalOpen(false);
    setPendingServiceIds([]);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f8f0e5] via-[#f6ebdd] to-[#f4e6d4]">
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4 pb-10">
        {/* Header */}
        <div
          className="pt-6 pb-2 text-center"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(-8px)",
            transition: "opacity 300ms ease-out, transform 300ms ease-out",
          }}
        >
          <div className="text-lg font-semibold tracking-tight text-[#7b4ea3]">
            Nail Salon No.5
          </div>
        </div>

        {/* Progress Steps */}
        <div
          className="flex items-center justify-center gap-2 mb-4"
          style={{
            opacity: mounted ? 1 : 0,
            transition: "opacity 300ms ease-out 50ms",
          }}
        >
          {["Service", "Artist", "Time", "Confirm"].map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <div className={`flex items-center gap-1.5 ${i === 0 ? "opacity-100" : "opacity-40"}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  i === 0 ? "bg-[#f4b864] text-neutral-900" : "bg-neutral-300 text-neutral-600"
                }`}>
                  {i + 1}
                </div>
                <span className={`text-xs font-medium ${i === 0 ? "text-neutral-900" : "text-neutral-500"}`}>
                  {step}
                </span>
              </div>
              {i < 3 && <div className="w-4 h-px bg-neutral-300" />}
            </div>
          ))}
        </div>

        {/* Search Bar */}
        <div
          className="mb-4"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(10px)",
            transition: "opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms",
          }}
        >
          <div className="flex items-center rounded-2xl bg-white border border-[#e6d6c2] shadow-sm px-4 py-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-neutral-400 mr-3">
              <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
              <path d="M21 21L16.65 16.65" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search services..."
              className="flex-1 bg-transparent text-base text-neutral-800 placeholder:text-neutral-400 outline-none"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="ml-2 flex items-center justify-center w-6 h-6 rounded-full bg-neutral-100 hover:bg-neutral-200 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M9 3L3 9M3 3L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Category Tabs */}
        <div
          className="flex items-center justify-center gap-2 mb-5"
          style={{
            opacity: mounted ? 1 : 0,
            transition: "opacity 300ms ease-out 150ms",
          }}
        >
          {CATEGORY_LABELS.map((cat) => {
            const active = cat.id === selectedCategory;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-semibold transition-all duration-200 ${
                  active
                    ? "bg-[#7b4ea3] text-white shadow-md"
                    : "bg-white text-neutral-600 border border-[#e6d6c2] hover:border-[#7b4ea3]/30"
                }`}
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
                className={`relative rounded-2xl overflow-hidden text-left transition-all duration-200 ${
                  isSelected
                    ? "bg-gradient-to-br from-[#f4b864]/20 to-[#d6a249]/10 ring-2 ring-[#f4b864] scale-[1.02] shadow-lg"
                    : "bg-white border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.06)] hover:shadow-lg hover:scale-[1.01] hover:border-[#d6a249]/30"
                }`}
                style={{
                  opacity: mounted ? 1 : 0,
                  transform: mounted ? "translateY(0)" : "translateY(15px)",
                  transition: `opacity 300ms ease-out ${200 + index * 50}ms, transform 300ms ease-out ${200 + index * 50}ms, box-shadow 200ms ease-out, border-color 200ms ease-out`,
                }}
              >
                {/* Image */}
                <div className="h-[120px] bg-gradient-to-br from-[#f0dfc9] to-[#d9c6aa] relative overflow-hidden">
                  <img
                    src={service.imageUrl}
                    alt={service.name}
                    className={`w-full h-full object-cover transition-transform duration-300 ${isSelected ? "scale-105" : ""}`}
                  />
                  {/* Selection checkmark */}
                  {isSelected && (
                    <div className="absolute top-2 right-2 w-7 h-7 rounded-full bg-gradient-to-br from-[#f4b864] to-[#d6a249] flex items-center justify-center shadow-lg">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-white">
                        <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="p-3">
                  <div className="text-base font-bold text-neutral-900 leading-tight">
                    {service.name}
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm text-neutral-500">{service.duration} min</span>
                    <span className="text-base font-bold text-[#7b4ea3]">${service.price}</span>
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
          {authState === "loggedOut" && (
            <div className="space-y-3">
              <p className="text-lg font-bold text-neutral-800">
                <span
                  className="bg-clip-text text-transparent"
                  style={{
                    backgroundImage: "linear-gradient(to right, #7b4ea3, #f4b864)",
                  }}
                >
                  New here? Get a free manicure! 💅
                </span>
              </p>
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-full bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-600">
                  +1
                </div>
                <FormInput
                  type="tel"
                  value={phone}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "");
                    setPhone(digits.slice(0, 10));
                  }}
                  placeholder="Phone number"
                  className="!px-4 !py-2.5 !text-base"
                />
                <PrimaryButton
                  onClick={handleSendCode}
                  disabled={!phone.trim()}
                  size="sm"
                  fullWidth={false}
                >
                  →
                </PrimaryButton>
              </div>
              <p className="text-xs text-neutral-400">
                *New clients only. Conditions apply.
              </p>
            </div>
          )}

          {authState === "verify" && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-neutral-700">
                Enter the 6-digit code we sent to +1 {phone}
              </p>
              <div className="flex items-center gap-2">
                <FormInput
                  ref={codeInputRef}
                  type="tel"
                  inputMode="numeric"
                  value={code}
                  onChange={(e) =>
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                  }
                  placeholder="• • • • • •"
                  className="!w-full !px-4 !py-2.5 !text-center !tracking-[0.3em] !text-lg"
                />
                <PrimaryButton
                  onClick={handleVerifyCode}
                  disabled={code.trim().length < 4}
                  size="sm"
                  fullWidth={false}
                >
                  Verify
                </PrimaryButton>
              </div>
              <button
                type="button"
                onClick={() => {
                  setAuthState("loggedOut");
                  setCode("");
                }}
                className="text-sm text-[#7b4ea3] font-medium hover:underline"
              >
                ← Change phone number
              </button>
            </div>
          )}

          {authState === "loggedIn" && (
            <div className="flex items-center justify-around py-1">
              {[
                { icon: "🤝", label: "Invite", path: `/${locale}/invite` },
                { icon: "🎁", label: "Rewards", path: `/${locale}/rewards` },
                { icon: "👤", label: "Profile", path: `/${locale}/profile` },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => router.push(item.path)}
                  className="flex flex-col items-center gap-1.5 px-4 py-2 rounded-xl hover:bg-neutral-50 active:scale-95 transition-all"
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
          className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-[#e6d6c2] shadow-[0_-4px_20px_rgba(0,0,0,0.1)]"
          style={{
            animation: "slideUp 0.3s ease-out",
          }}
        >
          <style jsx>{`
            @keyframes slideUp {
              from {
                transform: translateY(100%);
              }
              to {
                transform: translateY(0);
              }
            }
          `}</style>
          <div className="mx-auto max-w-[430px] px-4 py-4 flex items-center justify-between">
            <div>
              <div className="text-sm text-neutral-500">
                {selectedCount === 1 ? "1 service" : `${selectedCount} services`}
              </div>
              <div className="text-xl font-bold text-neutral-900">${totalPrice}</div>
            </div>
            <button
              type="button"
              onClick={handleChooseTech}
              className="flex items-center gap-2 rounded-full bg-gradient-to-r from-[#f4b864] to-[#d6a249] px-6 py-3 text-base font-bold text-neutral-900 shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all"
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
