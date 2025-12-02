"use client";

import { useParams, useRouter, usePathname } from "next/navigation";
import { useState, useRef } from "react";
import { useTranslations } from "@/providers/I18nProvider";

type SectionId =
  | "beauty-profile"
  | "appointments"
  | "gallery"
  | "rewards"
  | "invite"
  | "membership"
  | "rate-us"
  | "payment"
  | "settings";

export default function ProfilePage() {
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
  const locale = (params?.locale as string) || "en";
  const t = useTranslations("Profile");
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);

  // Collapsible sections state
  const [openSections, setOpenSections] = useState<Set<SectionId>>(
    new Set(["appointments", "invite", "gallery"])
  );
  const [appointmentReminders, setAppointmentReminders] = useState(true);
  
  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  const [userName, setUserName] = useState("Sarah");
  const [editedName, setEditedName] = useState("Sarah");

  // Beauty Profile state
  const [isEditingBeautyProfile, setIsEditingBeautyProfile] = useState(false);
  const [beautyProfile, setBeautyProfile] = useState({
    email: "",
    favTech: "Daniela",
    nailLength: "Medium",
    nailShape: "Almond",
    finish: "Glossy",
    favColors: ["Nudes", "Pinks"],
    favBrands: ["Kokoist", "OPI"],
    favService: "BIAB",
    designStyles: ["French", "Minimal art"],
    notes: "",
  });
  const [editedBeautyProfile, setEditedBeautyProfile] = useState(beautyProfile);

  // Invite state
  const [friendPhone, setFriendPhone] = useState("");
  const [inviteSent, setInviteSent] = useState(false);
  const isSendingRef = useRef(false);

  // Profile image state
  const [profileImage, setProfileImage] = useState<string | null>(null);
  const [profileUploadStatus, setProfileUploadStatus] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const profileImageInputRef = useRef<HTMLInputElement>(null);

  // Payment methods state
  type PaymentCard = {
    id: string;
    type: "Visa" | "Mastercard" | "Amex" | "Discover";
    last4: string;
    expiryMonth: string;
    expiryYear: string;
    isDefault: boolean;
  };

  const [paymentCards, setPaymentCards] = useState<PaymentCard[]>([
    {
      id: "1",
      type: "Visa",
      last4: "4242",
      expiryMonth: "12",
      expiryYear: "2025",
      isDefault: true,
    },
  ]);
  const [showAddCard, setShowAddCard] = useState(false);
  const [showManageCards, setShowManageCards] = useState(false);
  const [newCard, setNewCard] = useState({
    cardNumber: "",
    expiryMonth: "",
    expiryYear: "",
    cvv: "",
    cardholderName: "",
  });

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

  const handleBack = () => {
    router.back();
  };

  const handleEditProfile = () => {
    setIsEditMode(true);
    setEditedName(userName);
  };

  const handleSaveName = () => {
    setUserName(editedName);
    setIsEditMode(false);
    // TODO: Save to backend
  };

  const handleCancelEdit = () => {
    setEditedName(userName);
    setIsEditMode(false);
  };

  const handleEditBeautyProfile = () => {
    setIsEditingBeautyProfile(true);
    setEditedBeautyProfile(beautyProfile);
  };

  const handleSaveBeautyProfile = () => {
    setBeautyProfile(editedBeautyProfile);
    setIsEditingBeautyProfile(false);
    // TODO: Save to backend
  };

  const handleCancelBeautyProfile = () => {
    setEditedBeautyProfile(beautyProfile);
    setIsEditingBeautyProfile(false);
  };

  const toggleArrayItem = (array: string[], item: string) => {
    return array.includes(item)
      ? array.filter((i) => i !== item)
      : [...array, item];
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const digits = input.value.replace(/\D/g, "").slice(0, 10);
    
    // Update state
    setFriendPhone(digits);
    
    // Auto-send when 10 digits entered
    if (digits.length === 10 && !inviteSent && !isSendingRef.current) {
      isSendingRef.current = true;
      // TODO: Send invite via backend
      console.log("Sending invite to:", digits);
      setInviteSent(true);
      setTimeout(() => {
        setInviteSent(false);
        setFriendPhone("");
        isSendingRef.current = false;
      }, 3000);
    }
  };

  const handleProfileImageClick = () => {
    profileImageInputRef.current?.click();
  };

  const handleProfileImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      setProfileUploadStatus({
        success: false,
        message: "Please select an image file",
      });
      setTimeout(() => setProfileUploadStatus(null), 3000);
      return;
    }

    // Validate file size (max 5MB for profile images)
    if (file.size > 5 * 1024 * 1024) {
      setProfileUploadStatus({
        success: false,
        message: "Image must be less than 5MB",
      });
      setTimeout(() => setProfileUploadStatus(null), 3000);
      return;
    }

    // Create preview URL
    const imageUrl = URL.createObjectURL(file);
    setProfileImage(imageUrl);

    // TODO: Upload to backend
    console.log("Uploading profile image:", file.name);
    setProfileUploadStatus({
      success: true,
      message: "Profile photo updated! 💛",
    });

    // Clear success message after 3 seconds
    setTimeout(() => {
      setProfileUploadStatus(null);
    }, 3000);
  };

  // Payment methods handlers
  const getCardType = (cardNumber: string): PaymentCard["type"] => {
    const num = cardNumber.replace(/\D/g, "");
    if (num.startsWith("4")) return "Visa";
    if (num.startsWith("5") || num.startsWith("2")) return "Mastercard";
    if (num.startsWith("3")) return "Amex";
    return "Discover";
  };

  const handleAddCard = () => {
    setShowAddCard(true);
    setShowManageCards(false);
  };

  const handleManageCards = () => {
    setShowManageCards(true);
    setShowAddCard(false);
  };

  const handleSaveCard = () => {
    const cardNumber = newCard.cardNumber.replace(/\D/g, "");
    if (cardNumber.length < 13 || cardNumber.length > 19) {
      alert("Please enter a valid card number");
      return;
    }
    if (!newCard.expiryMonth || !newCard.expiryYear) {
      alert("Please enter expiry date");
      return;
    }
    if (newCard.cvv.length < 3 || newCard.cvv.length > 4) {
      alert("Please enter a valid CVV");
      return;
    }
    if (!newCard.cardholderName.trim()) {
      alert("Please enter cardholder name");
      return;
    }

    // Remove default from all cards if this is set as default
    const updatedCards = paymentCards.map((card) => ({
      ...card,
      isDefault: false,
    }));

    // Add new card
    const newCardData: PaymentCard = {
      id: Date.now().toString(),
      type: getCardType(cardNumber),
      last4: cardNumber.slice(-4),
      expiryMonth: newCard.expiryMonth,
      expiryYear: newCard.expiryYear,
      isDefault: true, // New card is default
    };

    setPaymentCards([...updatedCards, newCardData]);
    setNewCard({
      cardNumber: "",
      expiryMonth: "",
      expiryYear: "",
      cvv: "",
      cardholderName: "",
    });
    setShowAddCard(false);

    // TODO: Save to backend
    console.log("Card added:", newCardData);
  };

  const handleCancelAddCard = () => {
    setShowAddCard(false);
    setNewCard({
      cardNumber: "",
      expiryMonth: "",
      expiryYear: "",
      cvv: "",
      cardholderName: "",
    });
  };

  const handleSetDefault = (cardId: string) => {
    setPaymentCards(
      paymentCards.map((card) => ({
        ...card,
        isDefault: card.id === cardId,
      }))
    );
    // TODO: Update backend
    console.log("Set default card:", cardId);
  };

  const handleDeleteCard = (cardId: string) => {
    if (paymentCards.length === 1) {
      alert("You must have at least one payment method");
      return;
    }
    const cardToDelete = paymentCards.find((c) => c.id === cardId);
    if (cardToDelete?.isDefault && paymentCards.length > 1) {
      // Set first remaining card as default
      const remainingCards = paymentCards.filter((c) => c.id !== cardId);
      if (remainingCards.length > 0 && remainingCards[0]) {
        remainingCards[0].isDefault = true;
      }
      setPaymentCards(remainingCards);
    } else {
      setPaymentCards(paymentCards.filter((c) => c.id !== cardId));
    }
    // TODO: Delete from backend
    console.log("Card deleted:", cardId);
  };

  const formatCardNumber = (value: string) => {
    const v = value.replace(/\s+/g, "").replace(/[^0-9]/gi, "");
    const matches = v.match(/\d{4,16}/g);
    const match = (matches && matches[0]) || "";
    const parts = [];
    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }
    if (parts.length) {
      return parts.join(" ");
    } else {
      return v;
    }
  };

  // Language selection
  const languages: Array<{ code: string; name: string }> = [
    { code: "en", name: "English" },
    { code: "es", name: "Spanish" },
  ];

  const currentLanguage =
    languages.find((lang) => lang.code === locale) || { code: "en", name: "English" };

  const handleLanguageChange = (langCode: string) => {
    if (langCode === locale) {
      setShowLanguageSelector(false);
      return;
    }
    
    setShowLanguageSelector(false);
    // Navigate to the same page with new locale
    const segments = pathname.split("/").filter(Boolean);
    
    // Find and replace the locale segment (should be first segment)
    if (segments[0] === locale) {
      segments[0] = langCode;
    } else {
      // If locale is not in path, prepend it
      segments.unshift(langCode);
    }
    
    const newPath = `/${segments.join("/")}`;
    
    // Use router.push for navigation
    router.push(newPath);
  };

  const CollapsibleSection = ({
    id,
    title,
    children,
  }: {
    id: SectionId;
    title: string;
    children: React.ReactNode;
  }) => {
    const isOpen = openSections.has(id);

    return (
      <div className="rounded-xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] overflow-hidden">
        <button
          type="button"
          onClick={() => toggleSection(id)}
          className="w-full flex items-center justify-between px-4 py-3.5 text-left h-12"
        >
          <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={`transition-transform duration-150 opacity-60 ${
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
        {isOpen && <div className="px-4 pb-4">{children}</div>}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#f6ebdd] flex justify-center py-4">
      <div className="mx-auto max-w-[430px] w-full px-4 flex flex-col gap-2.5">
        {/* Top bar with back button */}
        <div className="pt-2 relative flex items-center">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center justify-center w-10 h-10 rounded-full hover:bg-white/50 active:scale-95 transition-all duration-150 z-10"
          >
            <svg
              width="20"
              height="20"
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
        </div>

        {/* Title */}
        <div className="text-center">
          <h1 className="text-2xl font-bold text-neutral-900">My Profile</h1>
          <p className="text-base font-bold text-neutral-700 mt-1">Hi there, {userName}! 👋</p>
        </div>

        {/* Profile Header Card (not collapsible) */}
        <div className="rounded-xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] p-4">
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#f0dfc9] to-[#d9c6aa] flex items-center justify-center text-2xl overflow-hidden">
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
                className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[#f4b864] flex items-center justify-center text-sm font-bold text-neutral-900 shadow-sm hover:bg-[#f4b864]/90 transition-colors"
              >
                +
              </button>
            </div>

            {/* Name and Phone */}
            <div className="flex-1 text-center">
              {isEditMode ? (
                <input
                  type="text"
                  value={editedName}
                  onChange={(e) => setEditedName(e.target.value)}
                  className="w-full text-base font-semibold text-neutral-900 text-center rounded-lg bg-[#fff7ec] px-3 py-1.5 outline-none ring-2 ring-[#f4b864]"
                  autoFocus
                />
              ) : (
                <div className="text-base font-semibold text-neutral-900">
                  {userName}
                </div>
              )}
              <div className="text-sm text-neutral-600 mt-0.5">
                +1 (555) 123-4567
              </div>
            </div>

            {/* Edit button */}
            {!isEditMode && (
              <button
                type="button"
                onClick={handleEditProfile}
                className="text-sm text-neutral-500 hover:text-neutral-700 transition-colors"
              >
                Edit
              </button>
            )}
          </div>
        </div>

        {/* Profile image upload status */}
        {profileUploadStatus && (
          <p
            className={`text-sm text-center ${
              profileUploadStatus.success
                ? "text-green-600"
                : "text-red-600"
            }`}
          >
            {profileUploadStatus.message}
          </p>
        )}

        {/* Save/Cancel buttons - shown when in edit mode */}
        {isEditMode && (
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleCancelEdit}
              className="flex-1 rounded-full bg-white border-2 border-neutral-200 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-neutral-50 active:scale-[0.98] transition-all duration-150"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveName}
              disabled={!editedName.trim()}
              className="flex-1 rounded-full bg-[#f4b864] py-2.5 text-sm font-semibold text-neutral-900 hover:bg-[#f4b864]/90 active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save
            </button>
          </div>
        )}

        {/* My Appointments Section */}
        <CollapsibleSection id="appointments" title="My Appointments">
          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-semibold text-neutral-900">
              Next Appointment
            </h4>
            <div className="rounded-xl bg-[#fff7ec] p-3 space-y-2">
              <div className="text-sm font-semibold text-neutral-900">
                BIAB Refill
              </div>
              <div className="text-sm text-neutral-600">Tech: Tiffany</div>
              <div className="text-sm text-neutral-600">Dec 18 · 2:00 PM</div>
              <div className="border-t border-neutral-200/50 pt-2 mt-2 space-y-1">
                <div className="flex justify-between items-center text-sm">
                  <span className="text-neutral-600">Price</span>
                  <span className="font-semibold text-neutral-900">$65</span>
                </div>
                <div className="flex justify-between items-center text-sm">
                  <span className="text-neutral-600">Reward Applied</span>
                  <span className="text-green-600 font-semibold">-$5</span>
                </div>
                <div className="flex justify-between items-center pt-1 border-t border-neutral-200/50">
                  <span className="text-sm font-semibold text-neutral-900">
                    Total
                  </span>
                  <span className="text-sm font-bold text-neutral-900">$60</span>
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => router.push(`/${locale}/change-appointment`)}
              className="w-full rounded-full bg-[#f4b864] py-2.5 text-sm font-semibold text-neutral-900 hover:bg-[#f4b864]/90 active:scale-[0.98] transition-all duration-150"
            >
              View / Change Appointment
            </button>
            <button
              type="button"
              onClick={() => router.push(`/${locale}/appointments/history`)}
              className="w-full text-sm text-[#7b4ea3] font-medium hover:text-[#7b4ea3]/80 transition-colors"
            >
              View Appointment History
            </button>
          </div>
        </CollapsibleSection>

        {/* My Nail Gallery Section */}
        <CollapsibleSection id="gallery" title="My Nail Gallery">
          <div className="pt-2">
            <div className="grid grid-cols-3 gap-2">
              {[
                {
                  id: "1",
                  imageUrl: "/assets/images/biab-short.webp",
                },
                {
                  id: "2",
                  imageUrl: "/assets/images/gel-x-extensions.jpg",
                },
                {
                  id: "3",
                  imageUrl: "/assets/images/biab-medium.webp",
                },
              ].map((photo) => (
                <div
                  key={photo.id}
                  className="aspect-square rounded-xl bg-gradient-to-br from-[#f0dfc9] to-[#d9c6aa] relative overflow-hidden"
                >
                  <img
                    src={photo.imageUrl}
                    alt="Nail gallery"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => router.push(`/${locale}/gallery`)}
              className="mt-3 text-sm text-[#7b4ea3] font-medium hover:text-[#7b4ea3]/80 transition-colors"
            >
              View All Photos
            </button>
          </div>
        </CollapsibleSection>

        {/* Rewards Section */}
        <CollapsibleSection id="rewards" title="Rewards">
          <div className="space-y-4 pt-1">
            <div className="text-sm text-neutral-900">
              You have <span className="font-semibold">240 points</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-neutral-600">
                <span>60 points until FREE BIAB Fill</span>
              </div>
              <div className="h-1.5 bg-neutral-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#f4b864] to-[#d6a249] rounded-full"
                  style={{ width: "75%" }}
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => router.push(`/${locale}/rewards`)}
                className="flex-1 rounded-full bg-[#f4b864] py-2 text-sm font-semibold text-neutral-900 hover:bg-[#f4b864]/90 active:scale-[0.98] transition-all duration-150"
              >
                View Rewards
              </button>
              <button
                type="button"
                onClick={() => console.log("TODO: Rewards info")}
                className="text-sm text-[#7b4ea3] font-medium hover:text-[#7b4ea3]/80 transition-colors"
              >
                Learn More
              </button>
            </div>
          </div>
        </CollapsibleSection>

        {/* Invite & Earn Section */}
        <CollapsibleSection id="invite" title="Invite & Earn">
          <div className="space-y-3 pt-2">
            <p className="text-sm text-neutral-700">
              Invite friends and earn a free manicure.
            </p>
            <div className="space-y-2">
              <label className="text-sm font-medium text-neutral-900">
                Friend's Phone Number
              </label>
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-full bg-neutral-100 px-2.5 py-1.5 text-sm text-neutral-600">
                  <span className="mr-1">+1</span>
                </div>
                <input
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={friendPhone}
                  onChange={handlePhoneChange}
                  placeholder="Phone number"
                  className="flex-1 min-w-0 rounded-full bg-neutral-100 px-3 py-2 text-base text-neutral-800 placeholder:text-neutral-400 outline-none"
                  autoComplete="off"
                />
              </div>
              {inviteSent && (
                <p className="text-sm text-center text-green-600 mt-1">
                  Invite Sent
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => router.push(`/${locale}/invite`)}
              className="w-full rounded-full bg-[#f4b864] py-3 text-sm font-semibold text-neutral-900 hover:bg-[#f4b864]/90 active:scale-[0.98] transition-all duration-150 shadow-sm"
            >
              Share Referral Link
            </button>
            <button
              type="button"
              onClick={() => router.push(`/${locale}/my-referrals`)}
              className="text-sm text-[#7b4ea3] font-medium hover:text-[#7b4ea3]/80 transition-colors"
            >
              My Referrals
            </button>
          </div>
        </CollapsibleSection>

        {/* Membership Section */}
        <CollapsibleSection id="membership" title="Membership">
          <div className="space-y-3 pt-2">
            <div className="text-sm text-neutral-900">
              Current tier: <span className="font-semibold">Gold</span>
            </div>
            <ul className="space-y-1.5 text-sm text-neutral-600">
              <li className="flex items-start gap-2">
                <span className="text-[#f4b864] mt-0.5">•</span>
                <span>Priority booking</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#f4b864] mt-0.5">•</span>
                <span>Birthday gift</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#f4b864] mt-0.5">•</span>
                <span>Extra reward points</span>
              </li>
            </ul>
            <button
              type="button"
              onClick={() => console.log("TODO: Membership details")}
              className="text-sm text-[#7b4ea3] font-medium hover:text-[#7b4ea3]/80 transition-colors"
            >
              Membership Details
            </button>
          </div>
        </CollapsibleSection>

        {/* Rate Us on Google Section */}
        <CollapsibleSection id="rate-us" title="Rate Us on Google">
          <div className="space-y-3 pt-2">
            <p className="text-sm text-neutral-700">
              Love your nails? Help us grow.
            </p>
            <button
              type="button"
              onClick={() => {
                console.log("TODO: Open Google review link");
                // TODO: Replace with actual Google review URL
              }}
              className="w-full rounded-full bg-[#f4b864] py-2.5 text-sm font-semibold text-neutral-900 hover:bg-[#f4b864]/90 active:scale-[0.98] transition-all duration-150"
            >
              Rate Us on Google
            </button>
          </div>
        </CollapsibleSection>

        {/* Beauty Profile Section */}
        <CollapsibleSection id="beauty-profile" title="Beauty Preferences">
          <div className="space-y-2.5 pt-2">
            {/* Card 1 - Contact & Basics */}
            <div className="rounded-xl bg-[#fff7ec] shadow-sm p-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-900">
                  Email (Optional)
                </label>
                <input
                  type="email"
                  value={
                    isEditingBeautyProfile
                      ? editedBeautyProfile.email
                      : beautyProfile.email
                  }
                  onChange={(e) =>
                    setEditedBeautyProfile({
                      ...editedBeautyProfile,
                      email: e.target.value,
                    })
                  }
                  disabled={!isEditingBeautyProfile}
                  placeholder="your@email.com"
                  className="w-full rounded-full bg-neutral-100 px-4 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 outline-none disabled:opacity-60"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-900">
                  Favorite Technician
                </label>
                <div className="flex flex-wrap gap-3">
                  {["Daniela", "Tiffany", "Jenny"].map((tech) => {
                    const isSelected = isEditingBeautyProfile
                      ? editedBeautyProfile.favTech === tech
                      : beautyProfile.favTech === tech;
                    return (
                      <button
                        key={tech}
                        type="button"
                        onClick={() =>
                          isEditingBeautyProfile &&
                          setEditedBeautyProfile({
                            ...editedBeautyProfile,
                            favTech: tech,
                          })
                        }
                        disabled={!isEditingBeautyProfile}
                        className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-150 ${
                          isSelected
                            ? "bg-[#e9d5f5] ring-2 ring-[#7b4ea3] ring-offset-1 ring-offset-[#fff7ec] text-neutral-900"
                            : "bg-neutral-50 text-neutral-700 hover:bg-neutral-100 border border-[#7b4ea3]"
                        } ${!isEditingBeautyProfile ? "cursor-default" : ""}`}
                      >
                        {tech}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Card 2 - Nail Preferences */}
            <div className="rounded-xl bg-[#fff7ec] shadow-sm p-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-900">
                  Nail Length
                </label>
                <div className="flex flex-wrap gap-3">
                  {["Short", "Medium", "Long"].map((length) => {
                    const isSelected = isEditingBeautyProfile
                      ? editedBeautyProfile.nailLength === length
                      : beautyProfile.nailLength === length;
                    return (
                      <button
                        key={length}
                        type="button"
                        onClick={() =>
                          isEditingBeautyProfile &&
                          setEditedBeautyProfile({
                            ...editedBeautyProfile,
                            nailLength: length,
                          })
                        }
                        disabled={!isEditingBeautyProfile}
                        className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-150 ${
                          isSelected
                            ? "bg-[#e9d5f5] ring-2 ring-[#7b4ea3] ring-offset-1 ring-offset-[#fff7ec] text-neutral-900"
                            : "bg-neutral-50 text-neutral-700 hover:bg-neutral-100 border border-[#7b4ea3]"
                        } ${!isEditingBeautyProfile ? "cursor-default" : ""}`}
                      >
                        {length}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-900">
                  Nail Shape
                </label>
                <div className="flex flex-wrap gap-3">
                  {["Square", "Squoval", "Almond", "Coffin", "Stiletto"].map(
                    (shape) => {
                      const isSelected = isEditingBeautyProfile
                        ? editedBeautyProfile.nailShape === shape
                        : beautyProfile.nailShape === shape;
                      return (
                        <button
                          key={shape}
                          type="button"
                          onClick={() =>
                            isEditingBeautyProfile &&
                            setEditedBeautyProfile({
                              ...editedBeautyProfile,
                              nailShape: shape,
                            })
                          }
                          disabled={!isEditingBeautyProfile}
                          className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-150 ${
                            isSelected
                              ? "bg-[#e9d5f5] ring-2 ring-[#7b4ea3] ring-offset-1 ring-offset-[#fff7ec] text-neutral-900"
                              : "bg-neutral-50 text-neutral-700 hover:bg-neutral-100 border border-[#7b4ea3]"
                          } ${!isEditingBeautyProfile ? "cursor-default" : ""}`}
                        >
                          {shape}
                        </button>
                      );
                    }
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-900">
                  Finish
                </label>
                <div className="flex flex-wrap gap-3">
                  {["Glossy", "Matte", "Chrome", "Cat-eye"].map((finish) => {
                    const isSelected = isEditingBeautyProfile
                      ? editedBeautyProfile.finish === finish
                      : beautyProfile.finish === finish;
                    return (
                      <button
                        key={finish}
                        type="button"
                        onClick={() =>
                          isEditingBeautyProfile &&
                          setEditedBeautyProfile({
                            ...editedBeautyProfile,
                            finish: finish,
                          })
                        }
                        disabled={!isEditingBeautyProfile}
                        className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-150 ${
                          isSelected
                            ? "bg-[#e9d5f5] ring-2 ring-[#7b4ea3] ring-offset-1 ring-offset-[#fff7ec] text-neutral-900"
                            : "bg-neutral-50 text-neutral-700 hover:bg-neutral-100 border border-[#7b4ea3]"
                        } ${!isEditingBeautyProfile ? "cursor-default" : ""}`}
                      >
                        {finish}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-900">
                  Favorite Colors
                </label>
                <div className="flex flex-wrap gap-3">
                  {[
                    "Nudes",
                    "Pinks",
                    "Neutrals",
                    "Bright",
                    "Dark",
                    "French",
                    "Glitter",
                  ].map((color) => {
                    const isSelected = isEditingBeautyProfile
                      ? editedBeautyProfile.favColors.includes(color)
                      : beautyProfile.favColors.includes(color);
                    return (
                      <button
                        key={color}
                        type="button"
                        onClick={() =>
                          isEditingBeautyProfile &&
                          setEditedBeautyProfile({
                            ...editedBeautyProfile,
                            favColors: toggleArrayItem(
                              editedBeautyProfile.favColors,
                              color
                            ),
                          })
                        }
                        disabled={!isEditingBeautyProfile}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-150 ${
                          isSelected
                            ? "bg-[#e9d5f5] ring-2 ring-[#7b4ea3] ring-offset-1 ring-offset-[#fff7ec] text-neutral-900"
                            : "bg-neutral-50 text-neutral-700 hover:bg-neutral-100 border border-[#7b4ea3]"
                        } ${!isEditingBeautyProfile ? "cursor-default" : ""}`}
                      >
                        {color}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Card 3 - Favourite Gel Brands */}
            <div className="rounded-xl bg-[#fff7ec] shadow-sm p-4 space-y-3">
              <label className="text-sm font-medium text-neutral-900">
                Favorite Brands
              </label>
              <div className="flex flex-wrap gap-3">
                {[
                  "Kokoist",
                  "OPI",
                  "Valentino",
                  "TGB",
                  "Bio Sculpture",
                  "IceGel",
                  "Presto",
                  "Aprés",
                  "F Gel",
                  "Vetro",
                  "DND",
                  "Beetles",
                ].map((brand) => {
                  const isSelected = isEditingBeautyProfile
                    ? editedBeautyProfile.favBrands.includes(brand)
                    : beautyProfile.favBrands.includes(brand);
                  return (
                    <button
                      key={brand}
                      type="button"
                      onClick={() =>
                        isEditingBeautyProfile &&
                        setEditedBeautyProfile({
                          ...editedBeautyProfile,
                          favBrands: toggleArrayItem(
                            editedBeautyProfile.favBrands,
                            brand
                          ),
                        })
                      }
                      disabled={!isEditingBeautyProfile}
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-150 ${
                        isSelected
                          ? "bg-[#e9d5f5] ring-2 ring-[#7b4ea3] ring-offset-1 ring-offset-[#fff7ec] text-neutral-900"
                          : "bg-neutral-50 text-neutral-700 hover:bg-neutral-100 border border-[#7b4ea3]"
                      } ${!isEditingBeautyProfile ? "cursor-default" : ""}`}
                    >
                      {brand}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Card 4 - Favourite Services & Styles */}
            <div className="rounded-xl bg-[#fff7ec] shadow-sm p-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-900">
                  Favorite Service
                </label>
                <div className="flex flex-wrap gap-3">
                  {[
                    "BIAB",
                    "Gel-X",
                    "Gel Manicure",
                    "Classic Mani/Pedi",
                    "Combo",
                  ].map((service) => {
                    const isSelected = isEditingBeautyProfile
                      ? editedBeautyProfile.favService === service
                      : beautyProfile.favService === service;
                    return (
                      <button
                        key={service}
                        type="button"
                        onClick={() =>
                          isEditingBeautyProfile &&
                          setEditedBeautyProfile({
                            ...editedBeautyProfile,
                            favService: service,
                          })
                        }
                        disabled={!isEditingBeautyProfile}
                        className={`px-5 py-2.5 rounded-full text-sm font-medium transition-all duration-150 ${
                          isSelected
                            ? "bg-[#e9d5f5] ring-2 ring-[#7b4ea3] ring-offset-1 ring-offset-[#fff7ec] text-neutral-900"
                            : "bg-neutral-50 text-neutral-700 hover:bg-neutral-100 border border-[#7b4ea3]"
                        } ${!isEditingBeautyProfile ? "cursor-default" : ""}`}
                      >
                        {service}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-900">
                  Design Styles
                </label>
                <div className="flex flex-wrap gap-3">
                  {[
                    "French",
                    "Minimal art",
                    "Heavy art",
                    "Chrome/Aura",
                    "Glitter",
                    "3D charms",
                    "Simple designs",
                  ].map((design) => {
                    const isSelected = isEditingBeautyProfile
                      ? editedBeautyProfile.designStyles.includes(design)
                      : beautyProfile.designStyles.includes(design);
                    return (
                      <button
                        key={design}
                        type="button"
                        onClick={() =>
                          isEditingBeautyProfile &&
                          setEditedBeautyProfile({
                            ...editedBeautyProfile,
                            designStyles: toggleArrayItem(
                              editedBeautyProfile.designStyles,
                              design
                            ),
                          })
                        }
                        disabled={!isEditingBeautyProfile}
                        className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-150 ${
                          isSelected
                            ? "bg-[#e9d5f5] ring-2 ring-[#7b4ea3] ring-offset-1 ring-offset-[#fff7ec] text-neutral-900"
                            : "bg-neutral-50 text-neutral-700 hover:bg-neutral-100 border border-[#7b4ea3]"
                        } ${!isEditingBeautyProfile ? "cursor-default" : ""}`}
                      >
                        {design}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Card 5 - Notes for Your Tech */}
            <div className="rounded-xl bg-[#fff7ec] shadow-sm p-4 space-y-3">
              <label className="text-sm font-medium text-neutral-900">
                Notes for Your Technician
              </label>
              <textarea
                value={
                  isEditingBeautyProfile
                    ? editedBeautyProfile.notes
                    : beautyProfile.notes
                }
                onChange={(e) =>
                  setEditedBeautyProfile({
                    ...editedBeautyProfile,
                    notes: e.target.value,
                  })
                }
                disabled={!isEditingBeautyProfile}
                placeholder="e.g., I prefer shorter cuticle work, extra gentle on my left thumb..."
                rows={4}
                className="w-full rounded-xl bg-neutral-100 px-4 py-3 text-sm text-neutral-800 placeholder:text-neutral-400 outline-none resize-none disabled:opacity-60"
              />
            </div>

            {/* Edit / Save / Cancel buttons */}
            {!isEditingBeautyProfile ? (
              <button
                type="button"
                onClick={handleEditBeautyProfile}
                className="text-sm text-[#7b4ea3] font-medium hover:text-[#7b4ea3]/80 transition-colors px-1"
              >
                Edit Preferences
              </button>
            ) : (
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleCancelBeautyProfile}
                  className="flex-1 rounded-full bg-white border-2 border-neutral-200 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-neutral-50 active:scale-[0.98] transition-all duration-150"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveBeautyProfile}
                  className="flex-1 rounded-full bg-[#f4b864] py-2.5 text-sm font-semibold text-neutral-900 hover:bg-[#f4b864]/90 active:scale-[0.98] transition-all duration-150"
                >
                  Save
                </button>
              </div>
            )}
          </div>
        </CollapsibleSection>

        {/* Payment Methods Section */}
        <CollapsibleSection id="payment" title="Payment Methods">
          <div className="space-y-3 pt-2">
            {/* Cards List */}
            {!showAddCard && !showManageCards && (
              <>
                {paymentCards.map((card) => (
                  <div
                    key={card.id}
                    className="flex items-center justify-between p-3 rounded-xl bg-[#fff7ec]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-neutral-900">
                        {card.type} •••• {card.last4}
                      </span>
                      {card.isDefault && (
                        <span className="text-sm px-2 py-0.5 rounded-full bg-[#f4b864]/20 text-neutral-700 font-medium">
                          Default
                        </span>
                      )}
                    </div>
                  </div>
                ))}

                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={handleAddCard}
                    className="text-sm text-[#7b4ea3] font-medium hover:text-[#7b4ea3]/80 transition-colors text-left"
                  >
                Add New Card
              </button>
              <button
                type="button"
                onClick={handleManageCards}
                className="text-sm text-[#7b4ea3] font-medium hover:text-[#7b4ea3]/80 transition-colors text-left"
              >
                Manage Payment Methods
                  </button>
                </div>
              </>
            )}

            {/* Add Card Form */}
            {showAddCard && (
              <div className="space-y-3 rounded-xl bg-[#fff7ec] p-4">
                <h3 className="text-sm font-semibold text-neutral-900">
                  Add New Card
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-neutral-700 mb-1.5 block">
                      Card Number
                    </label>
                    <input
                      type="text"
                      value={newCard.cardNumber}
                      onChange={(e) =>
                        setNewCard({
                          ...newCard,
                          cardNumber: formatCardNumber(e.target.value).slice(
                            0,
                            19
                          ),
                        })
                      }
                      placeholder="1234 5678 9012 3456"
                      maxLength={19}
                      className="w-full rounded-lg bg-white px-3 py-2.5 text-sm text-neutral-800 placeholder:text-neutral-400 outline-none border border-neutral-200"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-neutral-700 mb-1.5 block">
                      Cardholder Name
                    </label>
                    <input
                      type="text"
                      value={newCard.cardholderName}
                      onChange={(e) =>
                        setNewCard({
                          ...newCard,
                          cardholderName: e.target.value,
                        })
                      }
                      placeholder="John Doe"
                      className="w-full rounded-lg bg-white px-3 py-2.5 text-sm text-neutral-800 placeholder:text-neutral-400 outline-none border border-neutral-200"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label className="text-sm font-medium text-neutral-700 mb-1.5 block">
                        Expiry Date
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={newCard.expiryMonth}
                          onChange={(e) =>
                            setNewCard({
                              ...newCard,
                              expiryMonth: e.target.value.replace(/\D/g, "").slice(0, 2),
                            })
                          }
                          placeholder="MM"
                          maxLength={2}
                          className="w-full rounded-lg bg-white px-3 py-2.5 text-sm text-neutral-800 placeholder:text-neutral-400 outline-none border border-neutral-200"
                        />
                        <input
                          type="text"
                          value={newCard.expiryYear}
                          onChange={(e) =>
                            setNewCard({
                              ...newCard,
                              expiryYear: e.target.value.replace(/\D/g, "").slice(0, 4),
                            })
                          }
                          placeholder="YYYY"
                          maxLength={4}
                          className="w-full rounded-lg bg-white px-3 py-2.5 text-sm text-neutral-800 placeholder:text-neutral-400 outline-none border border-neutral-200"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium text-neutral-700 mb-1.5 block">
                        CVV
                      </label>
                      <input
                        type="text"
                        value={newCard.cvv}
                        onChange={(e) =>
                          setNewCard({
                            ...newCard,
                            cvv: e.target.value.replace(/\D/g, "").slice(0, 4),
                          })
                        }
                        placeholder="123"
                        maxLength={4}
                        className="w-full rounded-lg bg-white px-3 py-2.5 text-sm text-neutral-800 placeholder:text-neutral-400 outline-none border border-neutral-200"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleCancelAddCard}
                    className="flex-1 rounded-full bg-white border-2 border-neutral-200 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-neutral-50 active:scale-[0.98] transition-all duration-150"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveCard}
                    className="flex-1 rounded-full bg-[#f4b864] py-2.5 text-sm font-semibold text-neutral-900 hover:bg-[#f4b864]/90 active:scale-[0.98] transition-all duration-150"
                  >
                    Save Card
                  </button>
                </div>
              </div>
            )}

            {/* Manage Cards */}
            {showManageCards && (
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-neutral-900">
                  Manage Payment Methods
                </h3>
                {paymentCards.map((card) => (
                  <div
                    key={card.id}
                    className="rounded-xl bg-[#fff7ec] p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-neutral-900">
                          {card.type} •••• {card.last4}
                        </span>
                        {card.isDefault && (
                          <span className="text-sm px-2 py-0.5 rounded-full bg-[#f4b864]/20 text-neutral-700 font-medium">
                            Default
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-sm text-neutral-600">
                      Expires {card.expiryMonth}/{card.expiryYear}
                    </div>
                    <div className="flex gap-2 pt-2">
                      {!card.isDefault && (
                        <button
                          type="button"
                          onClick={() => handleSetDefault(card.id)}
                          className="flex-1 rounded-full bg-white border-2 border-neutral-200 py-2 text-sm font-semibold text-neutral-900 hover:bg-neutral-50 active:scale-[0.98] transition-all duration-150"
                        >
                          Set as Default
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteCard(card.id)}
                        className="flex-1 rounded-full bg-red-50 border-2 border-red-200 py-2 text-sm font-semibold text-red-600 hover:bg-red-100 active:scale-[0.98] transition-all duration-150"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setShowManageCards(false)}
                  className="w-full rounded-full bg-white border-2 border-neutral-200 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-neutral-50 active:scale-[0.98] transition-all duration-150"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </CollapsibleSection>

        {/* Settings Section */}
        <CollapsibleSection id="settings" title="Settings">
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-900">
                Appointment Reminders
              </span>
              <button
                type="button"
                onClick={() =>
                  setAppointmentReminders(!appointmentReminders)
                }
                className={`relative w-11 h-6 rounded-full transition-colors duration-150 ${
                  appointmentReminders ? "bg-[#f4b864]" : "bg-neutral-300"
                }`}
              >
                <div
                  className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-150 ${
                    appointmentReminders ? "translate-x-5" : ""
                  }`}
                />
              </button>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowLanguageSelector(!showLanguageSelector)}
                className="flex items-center justify-between w-full text-sm text-neutral-900"
              >
                <span>Language: {currentLanguage.name}</span>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className={`transition-transform duration-150 ${
                    showLanguageSelector ? "rotate-90" : ""
                  }`}
                >
                  <path
                    d="M6 4L10 8L6 12"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>

              {/* Language Selector */}
              {showLanguageSelector && (
                <div className="rounded-xl bg-[#fff7ec] p-2 space-y-1">
                  {languages.map((lang) => (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => handleLanguageChange(lang.code)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        locale === lang.code
                          ? "bg-[#f4b864] text-neutral-900"
                          : "text-neutral-700 hover:bg-white"
                      }`}
                    >
                      {lang.name}
                      {locale === lang.code && (
                        <span className="ml-2 text-sm">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CollapsibleSection>
      </div>
    </div>
  );
}

