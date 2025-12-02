"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { MainCard } from "@/components/MainCard";
import { PrimaryButton } from "@/components/PrimaryButton";
import { SecondaryButton } from "@/components/SecondaryButton";
import { FormInput } from "@/components/FormInput";
import { SummaryRow } from "@/components/SummaryRow";

type SectionId =
  | "beauty-profile"
  | "appointments"
  | "gallery"
  | "rewards"
  | "invite"
  | "membership"
  | "rate-us"
  | "payment";

// CollapsibleSection component
function CollapsibleSection({
  id,
  title,
  icon,
  children,
  isOpen,
  onToggle,
  badge,
}: {
  id: SectionId;
  title: string;
  icon: string;
  children: React.ReactNode;
  isOpen: boolean;
  onToggle: (id: SectionId) => void;
  badge?: string;
}) {
  return (
    <div className="overflow-hidden rounded-2xl bg-white border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between text-left p-5 hover:bg-neutral-50/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-xl">{icon}</span>
          <span className="text-base font-bold text-neutral-900">{title}</span>
          {badge && (
            <span className="px-2 py-0.5 rounded-full bg-[#f4b864]/20 text-xs font-bold text-[#7b4ea3]">
              {badge}
            </span>
          )}
        </div>
        <svg
          width="18"
          height="18"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`transition-transform duration-200 text-neutral-400 ${
            isOpen ? "rotate-180" : ""
          }`}
        >
          <path
            d="M4 6L8 10L12 6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {isOpen && (
        <div className="px-5 pb-5 pt-0 border-t border-neutral-100">
          <div className="pt-4">{children}</div>
        </div>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const router = useRouter();
  const params = useParams();
  const locale = (params?.locale as string) || "en";
  const t = useTranslations("Profile");

  const [mounted, setMounted] = useState(false);
  const [openSections, setOpenSections] = useState<Set<SectionId>>(
    new Set(["appointments"])
  );
  
  // User data
  const [userName, setUserName] = useState("Sarah");
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedName, setEditedName] = useState("Sarah");
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const profileImageInputRef = useRef<HTMLInputElement>(null);

  // Invite state
  const [friendPhone, setFriendPhone] = useState("");
  const [inviteSent, setInviteSent] = useState(false);
  const isSendingRef = useRef(false);

  // Stats
  const userStats = {
    totalVisits: 12,
    memberSince: "March 2024",
    pointsBalance: 240,
    nextReward: 60,
    tier: "Gold",
    savedAmount: 85,
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  const toggleSection = (sectionId: SectionId) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  const handleToggleSection = useCallback((sectionId: SectionId) => {
    toggleSection(sectionId);
  }, []);

  const handleBack = () => {
    router.back();
  };

  const handleProfileImageClick = () => {
    profileImageInputRef.current?.click();
  };

  const handleProfileImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    const imageUrl = URL.createObjectURL(file);
    setProfileImage(imageUrl);
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
    setFriendPhone(digits);
    
    if (digits.length === 10 && !inviteSent && !isSendingRef.current) {
      isSendingRef.current = true;
      setInviteSent(true);
      setTimeout(() => {
        setInviteSent(false);
        setFriendPhone("");
        isSendingRef.current = false;
      }, 3000);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f8f0e5] via-[#f6ebdd] to-[#f4e6d4] pb-10">
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4">
        {/* Top bar with back button */}
        <div
          className="pt-6 pb-2 relative flex items-center"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(-8px)",
            transition: "opacity 300ms ease-out, transform 300ms ease-out",
          }}
        >
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center justify-center w-11 h-11 rounded-full hover:bg-white/60 active:scale-95 transition-all duration-200 z-10"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 20 20"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M12.5 15L7.5 10L12.5 5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>

          <div className="absolute left-1/2 transform -translate-x-1/2 text-lg font-semibold tracking-tight text-[#7b4ea3]">
            Nail Salon No.5
          </div>
        </div>

        {/* Welcome Hero Section */}
        <div
          className="text-center pt-4 pb-2"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(10px)",
            transition: "opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms",
          }}
        >
          {/* Profile Avatar */}
          <div className="relative inline-block mb-4">
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-[#e9d5f5] to-[#d4b8eb] flex items-center justify-center text-4xl overflow-hidden shadow-lg border-4 border-white">
              {profileImage ? (
                <img
                  src={profileImage}
                  alt="Profile"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span>👤</span>
              )}
            </div>
            <input
              ref={profileImageInputRef}
              type="file"
              accept="image/*"
              onChange={handleProfileImageChange}
              className="hidden"
            />
            <button
              type="button"
              onClick={handleProfileImageClick}
              className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-gradient-to-r from-[#f4b864] to-[#d6a249] flex items-center justify-center text-lg font-bold text-neutral-900 shadow-md hover:scale-110 transition-transform"
            >
              +
            </button>
          </div>

          {/* Personalized Welcome */}
          <h1 className="text-2xl font-bold text-neutral-900 mb-1">
            Welcome back, {userName}! ✨
          </h1>
          <p className="text-base text-neutral-500 mb-2">
            We're so happy to see you
          </p>

          {/* Member Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-[#f4b864]/20 to-[#d6a249]/20 border border-[#f4b864]/30">
            <span className="text-lg">👑</span>
            <span className="text-sm font-bold text-[#7b4ea3]">{userStats.tier} Member</span>
            <span className="text-xs text-neutral-500">since {userStats.memberSince}</span>
          </div>
        </div>

        {/* Stats Summary Card */}
        <div
          className="my-6 overflow-hidden rounded-2xl bg-gradient-to-br from-[#7b4ea3] to-[#5c3a7d] shadow-xl"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0) scale(1)" : "translateY(10px) scale(0.97)",
            transition: "opacity 300ms ease-out 150ms, transform 300ms ease-out 150ms",
          }}
        >
          <div className="px-5 py-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-white/80 text-sm">Your Journey With Us</div>
              <div className="text-[#f4b864] text-sm font-semibold">
                💰 ${userStats.savedAmount} saved!
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="text-center flex-1">
                <div className="text-3xl font-bold text-white">{userStats.totalVisits}</div>
                <div className="text-xs text-white/70 mt-0.5">Visits</div>
              </div>
              <div className="w-px h-12 bg-white/20" />
              <div className="text-center flex-1">
                <div className="text-3xl font-bold text-[#f4b864]">{userStats.pointsBalance}</div>
                <div className="text-xs text-white/70 mt-0.5">Points</div>
              </div>
              <div className="w-px h-12 bg-white/20" />
              <div className="text-center flex-1">
                <div className="text-3xl font-bold text-white">{userStats.nextReward}</div>
                <div className="text-xs text-white/70 mt-0.5">To Free Fill</div>
              </div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div
          className="grid grid-cols-2 gap-3 mb-6"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(10px)",
            transition: "opacity 300ms ease-out 200ms, transform 300ms ease-out 200ms",
          }}
        >
          <button
            type="button"
            onClick={() => router.push(`/${locale}/book/service`)}
            className="p-4 rounded-2xl bg-gradient-to-r from-[#f4b864] to-[#d6a249] shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            <span className="text-2xl mb-2 block">📅</span>
            <span className="text-base font-bold text-neutral-900">Book Now</span>
          </button>
          <button
            type="button"
            onClick={() => router.push(`/${locale}/rewards`)}
            className="p-4 rounded-2xl bg-white border border-[#e6d6c2] shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            <span className="text-2xl mb-2 block">🎁</span>
            <span className="text-base font-bold text-neutral-900">My Rewards</span>
          </button>
        </div>

        {/* Sections */}
        <div className="space-y-4">
          {/* Next Appointment */}
          <CollapsibleSection
            id="appointments"
            title="Next Appointment"
            icon="💅"
            isOpen={openSections.has("appointments")}
            onToggle={handleToggleSection}
            badge="Dec 18"
          >
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-gradient-to-br from-[#fff7ec] to-[#fef5e7]">
                <div className="w-16 h-16 rounded-xl bg-white shadow-sm overflow-hidden flex-shrink-0">
                  <img
                    src="/assets/images/biab-medium.webp"
                    alt="BIAB Refill"
                    className="w-full h-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = "none"; }}
                  />
                </div>
                <div className="flex-1">
                  <div className="text-lg font-bold text-neutral-900">BIAB Refill</div>
                  <div className="text-sm text-neutral-600 flex items-center gap-1.5 mt-1">
                    <span className="text-[#7b4ea3]">✦</span>
                    <span>with Tiffany</span>
                  </div>
                  <div className="text-sm text-neutral-500 mt-0.5">
                    Thu, Dec 18 · 2:00 PM
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-neutral-600">Service</span>
                  <span className="font-semibold">$65</span>
                </div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-neutral-600">Your Reward</span>
                  <span className="font-bold text-emerald-600">-$5</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t border-emerald-200">
                  <span className="text-lg font-bold text-neutral-900">Total</span>
                  <span className="text-xl font-bold text-[#7b4ea3]">$60</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  router.push(
                    `/${locale}/change-appointment?serviceIds=biab-medium&techId=tiffany&date=2025-12-18&time=14:00`
                  );
                }}
                className="w-full rounded-full bg-gradient-to-r from-[#f4b864] to-[#d6a249] px-6 py-3.5 text-base font-bold text-neutral-900 shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
              >
                View / Change Appointment
              </button>

              <button
                type="button"
                onClick={() => router.push(`/${locale}/appointments/history`)}
                className="w-full text-base font-medium text-[#7b4ea3] hover:text-[#7b4ea3]/80 transition-colors"
              >
                View All Past Visits →
              </button>
            </div>
          </CollapsibleSection>

          {/* Nail Gallery */}
          <CollapsibleSection
            id="gallery"
            title="Your Nail Journey"
            icon="📸"
            isOpen={openSections.has("gallery")}
            onToggle={handleToggleSection}
            badge="9 looks"
          >
            <div className="space-y-4">
              <p className="text-sm text-neutral-600">
                Your beautiful nail collection from past visits
              </p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  "/assets/images/biab-short.webp",
                  "/assets/images/gel-x-extensions.jpg",
                  "/assets/images/biab-medium.webp",
                ].map((img, i) => (
                  <div
                    key={i}
                    className="aspect-square rounded-xl bg-gradient-to-br from-[#f0dfc9] to-[#d9c6aa] relative overflow-hidden shadow-sm hover:scale-105 transition-transform cursor-pointer"
                    onClick={() => router.push(`/${locale}/gallery`)}
                  >
                    <img
                      src={img}
                      alt="Nail gallery"
                      className="w-full h-full object-cover"
                      onError={(e) => { e.currentTarget.style.display = "none"; }}
                    />
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => router.push(`/${locale}/gallery`)}
                className="w-full text-base font-medium text-[#7b4ea3] hover:text-[#7b4ea3]/80 transition-colors"
              >
                View Full Gallery →
              </button>
            </div>
          </CollapsibleSection>

          {/* Invite Friends */}
          <CollapsibleSection
            id="invite"
            title="Share the Love"
            icon="💝"
            isOpen={openSections.has("invite")}
            onToggle={handleToggleSection}
          >
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-gradient-to-br from-[#f6ebdd] to-[#f0dfc9] text-center">
                <div className="text-3xl mb-2">🎁</div>
                <div className="text-lg font-bold text-neutral-900 mb-1">
                  Give $10, Get $15
                </div>
                <p className="text-sm text-neutral-600">
                  Share the gift of beautiful nails with friends
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-bold text-neutral-900">
                  Friend's Phone Number
                </label>
                <div className="flex items-center gap-2">
                  <div className="flex items-center rounded-full bg-neutral-100 px-3 py-2.5 text-sm font-medium text-neutral-600">
                    +1
                  </div>
                  <input
                    type="tel"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={friendPhone}
                    onChange={handlePhoneChange}
                    placeholder="(555) 123-4567"
                    className="flex-1 min-w-0 rounded-full bg-neutral-100 px-4 py-2.5 text-base text-neutral-800 placeholder:text-neutral-400 outline-none focus:ring-2 focus:ring-[#7b4ea3]/30 transition-all"
                  />
                </div>
                {inviteSent && (
                  <p className="text-base text-center text-emerald-600 font-medium">
                    ✓ Invite sent! 🎉
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => router.push(`/${locale}/invite`)}
                className="w-full rounded-full bg-gradient-to-r from-[#f4b864] to-[#d6a249] px-6 py-3.5 text-base font-bold text-neutral-900 shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]"
              >
                Share Referral Link
              </button>

              <button
                type="button"
                onClick={() => router.push(`/${locale}/my-referrals`)}
                className="w-full text-base font-medium text-[#7b4ea3] hover:text-[#7b4ea3]/80 transition-colors"
              >
                View My Referrals →
              </button>
            </div>
          </CollapsibleSection>

          {/* Membership */}
          <CollapsibleSection
            id="membership"
            title="Gold Membership"
            icon="👑"
            isOpen={openSections.has("membership")}
            onToggle={handleToggleSection}
            badge="Active"
          >
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-gradient-to-br from-[#f4b864]/20 to-[#d6a249]/20 border border-[#f4b864]/30">
                <div className="text-lg font-bold text-neutral-900 mb-3">
                  Your Gold Benefits
                </div>
                <ul className="space-y-2.5">
                  {[
                    { icon: "⚡", text: "Priority booking - skip the wait" },
                    { icon: "🎂", text: "Birthday surprise gift" },
                    { icon: "✨", text: "2x points on all services" },
                    { icon: "💎", text: "Exclusive member-only offers" },
                  ].map((benefit, i) => (
                    <li key={i} className="flex items-center gap-3 text-sm text-neutral-700">
                      <span className="text-lg">{benefit.icon}</span>
                      <span>{benefit.text}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-sm text-neutral-500 text-center">
                Thank you for being a valued member! 💜
              </p>
            </div>
          </CollapsibleSection>

          {/* Rate Us */}
          <CollapsibleSection
            id="rate-us"
            title="Love Your Nails?"
            icon="⭐"
            isOpen={openSections.has("rate-us")}
            onToggle={handleToggleSection}
          >
            <div className="space-y-4 text-center">
              <div className="text-4xl">⭐⭐⭐⭐⭐</div>
              <p className="text-base text-neutral-600">
                Your reviews help us grow and serve you better!
              </p>
              <button
                type="button"
                onClick={() => {
                  window.open("https://www.google.com/maps/place/Nail+Salon+No.5", "_blank");
                }}
                className="w-full rounded-full bg-white border-2 border-[#7b4ea3] px-6 py-3.5 text-base font-bold text-[#7b4ea3] shadow-sm transition-all duration-200 hover:bg-[#7b4ea3] hover:text-white active:scale-[0.98]"
              >
                Leave a Google Review
              </button>
            </div>
          </CollapsibleSection>

          {/* Beauty Preferences */}
          <CollapsibleSection
            id="beauty-profile"
            title="Your Style Profile"
            icon="💅"
            isOpen={openSections.has("beauty-profile")}
            onToggle={handleToggleSection}
          >
            <div className="space-y-4">
              <p className="text-sm text-neutral-600">
                We remember your preferences so every visit feels personalized
              </p>
              
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: "Favorite Tech", value: "Daniela", icon: "👩‍🎨" },
                  { label: "Go-To Service", value: "BIAB", icon: "💅" },
                  { label: "Nail Shape", value: "Almond", icon: "✨" },
                  { label: "Favorite Finish", value: "Glossy", icon: "✦" },
                ].map((pref, i) => (
                  <div key={i} className="p-3 rounded-xl bg-[#fff7ec]">
                    <div className="text-lg mb-1">{pref.icon}</div>
                    <div className="text-xs text-neutral-500">{pref.label}</div>
                    <div className="text-sm font-bold text-neutral-900">{pref.value}</div>
                  </div>
                ))}
              </div>

              <div className="p-3 rounded-xl bg-[#fff7ec]">
                <div className="text-xs text-neutral-500 mb-1">Favorite Colors</div>
                <div className="flex flex-wrap gap-2">
                  {["Nudes", "Pinks", "French"].map((color) => (
                    <span
                      key={color}
                      className="px-3 py-1 rounded-full bg-[#e9d5f5] text-xs font-medium text-[#7b4ea3]"
                    >
                      {color}
                    </span>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => router.push(`/${locale}/preferences`)}
                className="w-full text-base font-medium text-[#7b4ea3] hover:text-[#7b4ea3]/80 transition-colors"
              >
                Edit Preferences →
              </button>
            </div>
          </CollapsibleSection>

          {/* Payment Methods */}
          <CollapsibleSection
            id="payment"
            title="Payment"
            icon="💳"
            isOpen={openSections.has("payment")}
            onToggle={handleToggleSection}
          >
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl bg-[#fff7ec]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#1a1f71] to-[#2d3494] flex items-center justify-center text-white text-xs font-bold">
                    VISA
                  </div>
                  <div>
                    <div className="text-sm font-bold text-neutral-900">•••• 4242</div>
                    <div className="text-xs text-neutral-500">Expires 12/25</div>
                  </div>
                </div>
                <span className="px-2 py-1 rounded-full bg-emerald-100 text-xs font-bold text-emerald-700">
                  Default
                </span>
              </div>
              <button
                type="button"
                className="w-full text-base font-medium text-[#7b4ea3] hover:text-[#7b4ea3]/80 transition-colors"
              >
                Manage Payment Methods →
              </button>
            </div>
          </CollapsibleSection>
        </div>

        {/* Footer Message */}
        <div
          className="mt-8 text-center"
          style={{
            opacity: mounted ? 1 : 0,
            transition: "opacity 300ms ease-out 500ms",
          }}
        >
          <p className="text-sm text-neutral-400">
            Thank you for choosing Nail Salon No.5 💜
          </p>
          <p className="text-xs text-neutral-400 mt-1">
            We appreciate you being part of our family
          </p>
        </div>

        {/* Bottom spacing */}
        <div className="h-6" />
      </div>
    </div>
  );
}
