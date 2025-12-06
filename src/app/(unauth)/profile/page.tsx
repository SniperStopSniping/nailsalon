'use client';

import Image from 'next/image';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ConfettiPopup } from '@/components/ConfettiPopup';
import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

type SectionId =
  | 'beauty-profile'
  | 'appointments'
  | 'gallery'
  | 'rewards'
  | 'invite'
  | 'membership'
  | 'rate-us'
  | 'payment'
  | 'settings';

function CollapsibleSection({
  id,
  title,
  children,
  isOpen,
  onToggle,
}: {
  id: SectionId;
  title: string;
  children: React.ReactNode;
  isOpen: boolean;
  onToggle: (id: SectionId) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <button
        type="button"
        onClick={() => onToggle(id)}
        className="flex h-12 w-full items-center justify-between px-4 py-3.5 text-left"
      >
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`opacity-60 transition-transform duration-150 ${
            isOpen ? 'rotate-180' : ''
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
}

// Types for real appointment data
type AppointmentData = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  totalPrice: number;
  totalDurationMinutes: number;
  clientPhone: string;
};

type ServiceData = {
  id: string;
  name: string;
  price: number;
  duration: number;
  imageUrl: string | null;
};

type TechnicianData = {
  id: string;
  name: string;
  avatarUrl: string | null;
};

// Reward data type
type RewardData = {
  id: string;
  type: 'referral_referee' | 'referral_referrer';
  eligibleServiceName: string | null;
  status: 'active' | 'used' | 'expired';
  expiresAt: string | null;
  usedAt: string | null;
  createdAt: string;
  isExpired: boolean;
  daysUntilExpiry: number | null;
  points: number;
};

// Client preferences type
type PreferencesData = {
  favoriteTechId: string | null;
  favoriteServices: string[] | null;
  nailShape: string | null;
  nailLength: string | null;
  finishes: string[] | null;
  colorFamilies: string[] | null;
  preferredBrands: string[] | null;
  sensitivities: string[] | null;
  musicPreference: string | null;
  conversationLevel: string | null;
  beveragePreference: string[] | null;
  techNotes: string | null;
  appointmentNotes: string | null;
};

// Helper functions for date/time formatting
function formatDateFull(isoString: string): string {
  const date = new Date(isoString);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[date.getDay()]}, ${months[date.getMonth()]} ${date.getDate()}`;
}

function formatTime(isoString: string): string {
  const date = new Date(isoString);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

export default function ProfilePage() {
  const router = useRouter();
  const params = useParams();
  const pathname = usePathname();
  const { salonSlug } = useSalon();
  const locale = (params?.locale as string) || 'en';
  const [showLanguageSelector, setShowLanguageSelector] = useState(false);

  // Collapsible sections state
  const [openSections, setOpenSections] = useState<Set<SectionId>>(
    new Set(['appointments', 'invite', 'gallery']),
  );
  const [appointmentReminders, setAppointmentReminders] = useState(true);

  // Edit mode state
  const [isEditMode, setIsEditMode] = useState(false);
  const [userName, setUserName] = useState('Guest');
  const [editedName, setEditedName] = useState('Guest');
  const [clientPhone, setClientPhone] = useState('');

  // Next appointment - real data from database
  const [nextAppointment, setNextAppointment] = useState<AppointmentData | null>(null);
  const [nextAppointmentServices, setNextAppointmentServices] = useState<ServiceData[]>([]);
  const [nextAppointmentTech, setNextAppointmentTech] = useState<TechnicianData | null>(null);
  const [appointmentLoading, setAppointmentLoading] = useState(true);

  // Rewards - real data from database
  const [rewards, setRewards] = useState<RewardData[]>([]);
  const [rewardsLoading, setRewardsLoading] = useState(true);
  const [activePoints, setActivePoints] = useState(0);

  // Gallery photos - real data from database
  const [galleryPhotos, setGalleryPhotos] = useState<Array<{
    id: string;
    imageUrl: string;
    thumbnailUrl: string | null;
  }>>([]);
  const [galleryLoading, setGalleryLoading] = useState(true);

  // Client preferences - real data from database
  const [_preferences, setPreferences] = useState<PreferencesData | null>(null);
  const [preferencesLoading, setPreferencesLoading] = useState(true);

  // Load client name and phone from cookie on mount
  useEffect(() => {
    const clientNameCookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('client_name='));
    if (clientNameCookie) {
      const name = decodeURIComponent(clientNameCookie.split('=')[1] || '');
      if (name) {
        setUserName(name);
        setEditedName(name);
      }
    }

    const clientPhoneCookie = document.cookie
      .split('; ')
      .find(row => row.startsWith('client_phone='));
    if (clientPhoneCookie) {
      const phone = decodeURIComponent(clientPhoneCookie.split('=')[1] || '');
      if (phone) setClientPhone(phone);
    }
  }, []);

  // Fetch next appointment from real database
  useEffect(() => {
    async function fetchNextAppointment() {
      if (!clientPhone) {
        setAppointmentLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/client/next-appointment?phone=${encodeURIComponent(clientPhone)}`);
        if (response.ok) {
          const data = await response.json();
          setNextAppointment(data.data?.appointment || null);
          setNextAppointmentServices(data.data?.services || []);
          setNextAppointmentTech(data.data?.technician || null);
        }
      } catch (error) {
        console.error('Failed to fetch next appointment:', error);
      } finally {
        setAppointmentLoading(false);
      }
    }

    if (clientPhone) {
      fetchNextAppointment();
    } else {
      setAppointmentLoading(false);
    }
  }, [clientPhone]);

  // Fetch rewards from database
  useEffect(() => {
    async function fetchRewards() {
      if (!clientPhone || !salonSlug) {
        setRewardsLoading(false);
        return;
      }

      // Normalize phone to 10 digits
      const normalizedPhone = clientPhone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
      if (normalizedPhone.length !== 10) {
        setRewardsLoading(false);
        return;
      }

      try {
        const response = await fetch(`/api/rewards?phone=${encodeURIComponent(normalizedPhone)}&salonSlug=${encodeURIComponent(salonSlug)}`);
        if (response.ok) {
          const data = await response.json();
          setRewards(data.data?.rewards || []);
          setActivePoints(data.meta?.activePoints || 0);
        }
      } catch (error) {
        console.error('Failed to fetch rewards:', error);
      } finally {
        setRewardsLoading(false);
      }
    }

    if (clientPhone && salonSlug) {
      fetchRewards();
    } else {
      setRewardsLoading(false);
    }
  }, [clientPhone, salonSlug]);

  // Fetch gallery photos from database
  useEffect(() => {
    async function fetchGalleryPhotos() {
      if (!clientPhone || !salonSlug) {
        setGalleryLoading(false);
        return;
      }

      try {
        const normalizedPhone = clientPhone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
        if (normalizedPhone.length !== 10) {
          setGalleryLoading(false);
          return;
        }

        const response = await fetch(
          `/api/gallery?phone=${normalizedPhone}&salonSlug=${salonSlug}`,
        );

        if (response.ok) {
          const data = await response.json();
          setGalleryPhotos(data.data?.photos || []);
        }
      } catch (error) {
        console.error('Failed to fetch gallery photos:', error);
      } finally {
        setGalleryLoading(false);
      }
    }

    if (clientPhone && salonSlug) {
      fetchGalleryPhotos();
    } else {
      setGalleryLoading(false);
    }
  }, [clientPhone, salonSlug]);

  // Fetch client preferences from database
  useEffect(() => {
    async function fetchPreferences() {
      if (!clientPhone || !salonSlug) {
        setPreferencesLoading(false);
        return;
      }

      try {
        const normalizedPhone = clientPhone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
        if (normalizedPhone.length !== 10) {
          setPreferencesLoading(false);
          return;
        }

        const response = await fetch(
          `/api/client/preferences?phone=${normalizedPhone}&salonSlug=${salonSlug}`,
        );

        if (response.ok) {
          const data = await response.json();
          const prefs: PreferencesData | null = data.data?.preferences;
          setPreferences(prefs);

          // Also update the beautyProfile state for editing
          if (prefs) {
            const updatedBeautyProfile = {
              email: '',
              favTech: prefs.favoriteTechId || 'Any',
              nailLength: prefs.nailLength ? prefs.nailLength.charAt(0).toUpperCase() + prefs.nailLength.slice(1) : 'Medium',
              nailShape: prefs.nailShape ? prefs.nailShape.charAt(0).toUpperCase() + prefs.nailShape.slice(1) : 'Almond',
              finish: prefs.finishes && prefs.finishes.length > 0
                ? prefs.finishes[0]!.charAt(0).toUpperCase() + prefs.finishes[0]!.slice(1)
                : 'Glossy',
              favColors: prefs.colorFamilies
                ? prefs.colorFamilies.map(c => c.charAt(0).toUpperCase() + c.slice(1))
                : ['Nudes', 'Pinks'],
              favBrands: prefs.preferredBrands
                ? prefs.preferredBrands.map(b => b.toUpperCase())
                : ['OPI'],
              favService: prefs.favoriteServices && prefs.favoriteServices.length > 0
                ? prefs.favoriteServices[0]!.toUpperCase()
                : 'BIAB',
              designStyles: ['French', 'Minimal art'],
              notes: prefs.techNotes || '',
            };
            setBeautyProfile(updatedBeautyProfile);
            setEditedBeautyProfile(updatedBeautyProfile);
          }
        }
      } catch (error) {
        console.error('Failed to fetch preferences:', error);
      } finally {
        setPreferencesLoading(false);
      }
    }

    if (clientPhone && salonSlug) {
      fetchPreferences();
    } else {
      setPreferencesLoading(false);
    }
  }, [clientPhone, salonSlug]);

  // Beauty Profile state
  const [isEditingBeautyProfile, setIsEditingBeautyProfile] = useState(false);
  const [beautyProfile, setBeautyProfile] = useState({
    email: '',
    favTech: 'Any',
    nailLength: 'Medium',
    nailShape: 'Almond',
    finish: 'Glossy',
    favColors: ['Nudes', 'Pinks'],
    favBrands: ['OPI'],
    favService: 'BIAB',
    designStyles: ['French', 'Minimal art'],
    notes: '',
  });
  const [editedBeautyProfile, setEditedBeautyProfile] = useState(beautyProfile);

  // Invite state
  const [friendPhone, setFriendPhone] = useState('');
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
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
    type: 'Visa' | 'Mastercard' | 'Amex' | 'Discover';
    last4: string;
    expiryMonth: string;
    expiryYear: string;
    isDefault: boolean;
  };

  const [paymentCards, setPaymentCards] = useState<PaymentCard[]>([
    {
      id: '1',
      type: 'Visa',
      last4: '4242',
      expiryMonth: '12',
      expiryYear: '2025',
      isDefault: true,
    },
  ]);
  const [showAddCard, setShowAddCard] = useState(false);
  const [showManageCards, setShowManageCards] = useState(false);
  const [newCard, setNewCard] = useState({
    cardNumber: '',
    expiryMonth: '',
    expiryYear: '',
    cvv: '',
    cardholderName: '',
  });
  const [_cardError, setCardError] = useState<string | null>(null);
  const [_deleteError, setDeleteError] = useState<string | null>(null);

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

  const handleSaveBeautyProfile = async () => {
    if (!clientPhone || !salonSlug) {
      setBeautyProfile(editedBeautyProfile);
      setIsEditingBeautyProfile(false);
      return;
    }

    const normalizedPhone = clientPhone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
    if (normalizedPhone.length !== 10) {
      setBeautyProfile(editedBeautyProfile);
      setIsEditingBeautyProfile(false);
      return;
    }

    try {
      const response = await fetch('/api/client/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: normalizedPhone,
          salonSlug,
          favoriteTechId: editedBeautyProfile.favTech.toLowerCase() !== 'any' ? editedBeautyProfile.favTech.toLowerCase() : null,
          favoriteServices: editedBeautyProfile.favService ? [editedBeautyProfile.favService.toLowerCase()] : null,
          nailShape: editedBeautyProfile.nailShape.toLowerCase(),
          nailLength: editedBeautyProfile.nailLength.toLowerCase(),
          finishes: editedBeautyProfile.finish ? [editedBeautyProfile.finish.toLowerCase()] : null,
          colorFamilies: editedBeautyProfile.favColors.map(c => c.toLowerCase()),
          preferredBrands: editedBeautyProfile.favBrands.map(b => b.toLowerCase()),
          techNotes: editedBeautyProfile.notes || null,
        }),
      });

      if (response.ok) {
        setBeautyProfile(editedBeautyProfile);
      }
    } catch (error) {
      console.error('Error saving beauty profile:', error);
    }

    setIsEditingBeautyProfile(false);
  };

  const handleCancelBeautyProfile = () => {
    setEditedBeautyProfile(beautyProfile);
    setIsEditingBeautyProfile(false);
  };

  const toggleArrayItem = (array: string[], item: string) => {
    return array.includes(item)
      ? array.filter(i => i !== item)
      : [...array, item];
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 10);
    setFriendPhone(digits);
    setInviteError(null);
  };

  // Normalize client phone for API call - strip non-digits and leading country code "1"
  const normalizedClientPhone = clientPhone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');

  const handleSendReferral = useCallback(async () => {
    if (isSendingRef.current || inviteSending) return;
    if (friendPhone.length !== 10) return;

    isSendingRef.current = true;
    setInviteSending(true);
    setInviteError(null);

    try {
      const response = await fetch('/api/referrals/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          salonSlug,
          referrerPhone: normalizedClientPhone,
          referrerName: userName || 'Your friend',
          refereePhone: friendPhone,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error?.code === 'DUPLICATE_REFERRAL') {
          setInviteError('You have already sent a referral to this number');
        } else if (data.error?.code === 'SELF_REFERRAL') {
          setInviteError('You cannot refer yourself');
        } else if (data.error?.code === 'EXISTING_CLIENT') {
          setInviteError('This number already has an account with us');
        } else {
          setInviteError(data.error?.message || 'Failed to send referral');
        }
        return;
      }

      // Success! Show confetti
      setShowConfetti(true);
      setFriendPhone('');
    } catch (err) {
      console.error('Error sending referral:', err);
      setInviteError('Something went wrong. Please try again.');
    } finally {
      setInviteSending(false);
      isSendingRef.current = false;
    }
  }, [friendPhone, clientPhone, userName, salonSlug, inviteSending]);

  const handleProfileImageClick = () => {
    profileImageInputRef.current?.click();
  };

  const handleProfileImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      setProfileUploadStatus({
        success: false,
        message: 'Please select an image file',
      });
      setTimeout(() => setProfileUploadStatus(null), 3000);
      return;
    }

    // Validate file size (max 5MB for profile images)
    if (file.size > 5 * 1024 * 1024) {
      setProfileUploadStatus({
        success: false,
        message: 'Image must be less than 5MB',
      });
      setTimeout(() => setProfileUploadStatus(null), 3000);
      return;
    }

    // Create preview URL
    const imageUrl = URL.createObjectURL(file);
    setProfileImage(imageUrl);

    // TODO: Upload to backend
    setProfileUploadStatus({
      success: true,
      message: 'Profile photo updated! 💛',
    });

    // Clear success message after 3 seconds
    setTimeout(() => {
      setProfileUploadStatus(null);
    }, 3000);
  };

  // Payment methods handlers
  const getCardType = (cardNumber: string): PaymentCard['type'] => {
    const num = cardNumber.replace(/\D/g, '');
    if (num.startsWith('4')) {
      return 'Visa';
    }
    if (num.startsWith('5') || num.startsWith('2')) {
      return 'Mastercard';
    }
    if (num.startsWith('3')) {
      return 'Amex';
    }
    return 'Discover';
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
    setCardError(null);
    const cardNumber = newCard.cardNumber.replace(/\D/g, '');
    if (cardNumber.length < 13 || cardNumber.length > 19) {
      setCardError('Please enter a valid card number');
      return;
    }
    if (!newCard.expiryMonth || !newCard.expiryYear) {
      setCardError('Please enter expiry date');
      return;
    }
    if (newCard.cvv.length < 3 || newCard.cvv.length > 4) {
      setCardError('Please enter a valid CVV');
      return;
    }
    if (!newCard.cardholderName.trim()) {
      setCardError('Please enter cardholder name');
      return;
    }

    // Remove default from all cards if this is set as default
    const updatedCards = paymentCards.map(card => ({
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
      cardNumber: '',
      expiryMonth: '',
      expiryYear: '',
      cvv: '',
      cardholderName: '',
    });
    setShowAddCard(false);

    // TODO: Save to backend
  };

  const handleCancelAddCard = () => {
    setShowAddCard(false);
    setNewCard({
      cardNumber: '',
      expiryMonth: '',
      expiryYear: '',
      cvv: '',
      cardholderName: '',
    });
  };

  const handleSetDefault = (cardId: string) => {
    setPaymentCards(
      paymentCards.map(card => ({
        ...card,
        isDefault: card.id === cardId,
      })),
    );
    // TODO: Update backend
  };

  const handleDeleteCard = (cardId: string) => {
    setDeleteError(null);
    if (paymentCards.length === 1) {
      setDeleteError('You must have at least one payment method');
      return;
    }
    const cardToDelete = paymentCards.find(c => c.id === cardId);
    if (cardToDelete?.isDefault && paymentCards.length > 1) {
      // Set first remaining card as default
      const remainingCards = paymentCards.filter(c => c.id !== cardId);
      if (remainingCards.length > 0 && remainingCards[0]) {
        remainingCards[0].isDefault = true;
      }
      setPaymentCards(remainingCards);
    } else {
      setPaymentCards(paymentCards.filter(c => c.id !== cardId));
    }
    // TODO: Delete from backend
  };

  const formatCardNumber = (value: string) => {
    const v = value.replace(/\s+/g, '').replace(/\D/g, '');
    const matches = v.match(/\d{4,16}/g);
    const match = (matches && matches[0]) || '';
    const parts = [];
    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }
    if (parts.length) {
      return parts.join(' ');
    } else {
      return v;
    }
  };

  // Language selection
  const languages: Array<{ code: string; name: string }> = [
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
  ];

  const currentLanguage
    = languages.find(lang => lang.code === locale) || { code: 'en', name: 'English' };

  const handleLanguageChange = (langCode: string) => {
    if (langCode === locale) {
      setShowLanguageSelector(false);
      return;
    }

    setShowLanguageSelector(false);
    // Navigate to the same page with new locale
    const segments = pathname.split('/').filter(Boolean);

    // Find and replace the locale segment (should be first segment)
    if (segments[0] === locale) {
      segments[0] = langCode;
    } else {
      // If locale is not in path, prepend it
      segments.unshift(langCode);
    }

    const newPath = `/${segments.join('/')}`;

    // Use router.push for navigation
    router.push(newPath);
  };

  return (
    <div
      className="flex min-h-screen justify-center py-4"
      style={{ backgroundColor: themeVars.background }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col gap-2.5 px-4">
        {/* Top bar with back button */}
        <div className="relative flex items-center pt-2">
          <button
            type="button"
            onClick={handleBack}
            className="z-10 flex size-10 items-center justify-center rounded-full transition-all duration-150 hover:bg-white/50 active:scale-95"
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
          <p className="mt-1 text-base font-bold text-neutral-700">
            Hi there,
            {userName}
            ! 👋
          </p>
        </div>

        {/* Profile Header Card (not collapsible) */}
        <div className="rounded-xl bg-white p-4 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="relative">
              <div
                className="flex size-16 items-center justify-center overflow-hidden rounded-full text-2xl"
                style={{ background: `linear-gradient(to bottom right, ${themeVars.selectedBackground}, ${themeVars.borderMuted})` }}
              >
                {profileImage
                  ? (
                      <Image
                        src={profileImage}
                        alt="Profile"
                        width={64}
                        height={64}
                        className="size-full object-cover"
                        unoptimized
                      />
                    )
                  : (
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
                className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full text-sm font-bold text-neutral-900 shadow-sm transition-colors hover:opacity-90"
                style={{ backgroundColor: themeVars.primary }}
              >
                +
              </button>
            </div>

            {/* Name and Phone */}
            <div className="flex-1 text-center">
              {isEditMode
                ? (
                    <input
                      type="text"
                      value={editedName}
                      onChange={e => setEditedName(e.target.value)}
                      className="w-full rounded-lg px-3 py-1.5 text-center text-base font-semibold text-neutral-900 outline-none ring-2"
                      style={{ backgroundColor: themeVars.surfaceAlt, '--tw-ring-color': themeVars.primary } as React.CSSProperties}
                    />
                  )
                : (
                    <div className="text-base font-semibold text-neutral-900">
                      {userName}
                    </div>
                  )}
              <div className="mt-0.5 text-sm text-neutral-600">
                +1 (555) 123-4567
              </div>
            </div>

            {/* Edit button */}
            {!isEditMode && (
              <button
                type="button"
                onClick={handleEditProfile}
                className="text-sm text-neutral-500 transition-colors hover:text-neutral-700"
              >
                Edit
              </button>
            )}
          </div>
        </div>

        {/* Profile image upload status */}
        {profileUploadStatus && (
          <p
            className={`text-center text-sm ${
              profileUploadStatus.success
                ? 'text-green-600'
                : 'text-red-600'
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
              className="flex-1 rounded-full border-2 border-neutral-200 bg-white py-2.5 text-sm font-semibold text-neutral-900 transition-all duration-150 hover:bg-neutral-50 active:scale-[0.98]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveName}
              disabled={!editedName.trim()}
              className="flex-1 rounded-full py-2.5 text-sm font-semibold text-neutral-900 transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: themeVars.primary }}
            >
              Save
            </button>
          </div>
        )}

        {/* My Appointments Section */}
        <CollapsibleSection id="appointments" title="My Appointments" isOpen={openSections.has('appointments')} onToggle={toggleSection}>
          <div className="space-y-3 pt-2">
            <h4 className="text-sm font-semibold text-neutral-900">
              Next Appointment
            </h4>

            {appointmentLoading && (
              <div className="py-4 text-center text-neutral-500">Loading...</div>
            )}

            {!appointmentLoading && nextAppointment && (
              <>
                <div className="space-y-2 rounded-xl p-3" style={{ backgroundColor: themeVars.surfaceAlt }}>
                  <div className="text-sm font-semibold text-neutral-900">
                    {nextAppointmentServices.map(s => s.name).join(' + ') || 'Appointment'}
                  </div>
                  <div className="text-sm text-neutral-600">
                    Tech: {nextAppointmentTech?.name || 'Any Artist'}
                  </div>
                  <div className="text-sm text-neutral-600">
                    {formatDateFull(nextAppointment.startTime)} · {formatTime(nextAppointment.startTime)}
                  </div>
                  <div className="mt-2 space-y-1 border-t border-neutral-200/50 pt-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-neutral-600">Price</span>
                      <span className="font-semibold text-neutral-900">${(nextAppointment.totalPrice / 100).toFixed(0)}</span>
                    </div>
                    <div className="flex items-center justify-between border-t border-neutral-200/50 pt-1">
                      <span className="text-sm font-semibold text-neutral-900">Total</span>
                      <span className="text-sm font-bold text-neutral-900">${(nextAppointment.totalPrice / 100).toFixed(0)}</span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const serviceIds = nextAppointmentServices.map(s => s.id).join(',');
                    const techId = nextAppointmentTech?.id || 'any';
                    const apptDate = new Date(nextAppointment.startTime);
                    const dateStr = apptDate.toISOString().split('T')[0];
                    const hours = apptDate.getHours();
                    const mins = apptDate.getMinutes().toString().padStart(2, '0');
                    const timeStr = `${hours}:${mins}`;
                    router.push(
                      `/change-appointment?serviceIds=${serviceIds}&techId=${techId}&date=${dateStr}&time=${timeStr}&clientPhone=${encodeURIComponent(nextAppointment.clientPhone)}&originalAppointmentId=${encodeURIComponent(nextAppointment.id)}`,
                    );
                  }}
                  className="w-full rounded-full py-2.5 text-sm font-semibold text-neutral-900 transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
                  style={{ backgroundColor: themeVars.primary }}
                >
                  View / Change Appointment
                </button>
              </>
            )}

            {!appointmentLoading && !nextAppointment && (
              <div className="py-4 text-center">
                <div className="mb-2 text-3xl">📅</div>
                <p className="mb-3 text-neutral-600">No upcoming appointments</p>
                <button
                  type="button"
                  onClick={() => router.push('/book/service')}
                  className="rounded-full px-6 py-2.5 text-sm font-semibold text-neutral-900 transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
                  style={{ backgroundColor: themeVars.primary }}
                >
                  Book Now
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => router.push('/appointments/history')}
              className="w-full text-sm font-medium transition-colors hover:opacity-80"
              style={{ color: themeVars.accent }}
            >
              View Appointment History
            </button>
          </div>
        </CollapsibleSection>

        {/* My Nail Gallery Section */}
        <CollapsibleSection id="gallery" title="My Nail Gallery" isOpen={openSections.has('gallery')} onToggle={toggleSection}>
          <div className="pt-2">
            {galleryLoading ? (
              <div className="flex items-center justify-center py-4">
                <div
                  className="size-6 animate-spin rounded-full border-2 border-t-transparent"
                  style={{ borderColor: `${themeVars.primary} transparent ${themeVars.primary} ${themeVars.primary}` }}
                />
              </div>
            ) : galleryPhotos.length > 0 ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  {galleryPhotos.slice(0, 3).map(photo => (
                    <button
                      key={photo.id}
                      type="button"
                      aria-label="View gallery"
                      className="relative aspect-square cursor-pointer overflow-hidden rounded-xl shadow-sm transition-transform hover:scale-105"
                      style={{ background: `linear-gradient(to bottom right, ${themeVars.selectedBackground}, ${themeVars.borderMuted})` }}
                      onClick={() => router.push(`/${locale}/gallery`)}
                    >
                      <Image
                        src={photo.thumbnailUrl || photo.imageUrl}
                        alt="Nail gallery"
                        fill
                        className="object-cover"
                      />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="mb-2 text-sm text-neutral-600">
                  Your nail photos will appear here after your appointments
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {[1, 2, 3].map(i => (
                    <div
                      key={i}
                      className="relative aspect-square overflow-hidden rounded-xl"
                      style={{ background: `linear-gradient(to bottom right, ${themeVars.background}, color-mix(in srgb, ${themeVars.primaryDark} 20%, white))` }}
                    >
                      <div className="absolute inset-0 flex items-center justify-center">
                        <span className="text-2xl opacity-30">💅</span>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-center text-xs text-neutral-400">
                  Placeholders - your real photos will replace these
                </p>
              </>
            )}
            <button
              type="button"
              onClick={() => router.push(`/${locale}/gallery`)}
              className="mt-3 text-sm font-medium transition-colors hover:opacity-80"
              style={{ color: themeVars.accent }}
            >
              View All Photos
            </button>
          </div>
        </CollapsibleSection>

        {/* Rewards Section */}
        <CollapsibleSection id="rewards" title="Rewards" isOpen={openSections.has('rewards')} onToggle={toggleSection}>
          <div className="space-y-4 pt-1">
            {/* Loading state */}
            {rewardsLoading && (
              <div className="py-4 text-center text-neutral-500">Loading rewards...</div>
            )}

            {/* No rewards */}
            {!rewardsLoading && rewards.length === 0 && (
              <div className="py-4 text-center">
                <div className="mb-2 text-3xl">🎁</div>
                <p className="text-sm text-neutral-600">No rewards yet</p>
                <p className="mt-1 text-xs text-neutral-500">Invite friends to earn free manicures!</p>
              </div>
            )}

            {/* Rewards list */}
            {!rewardsLoading && rewards.length > 0 && (
              <div className="space-y-3">
                {rewards.map((reward) => {
                  const isActive = reward.status === 'active' && !reward.isExpired;
                  const isUsed = reward.status === 'used';
                  const isExpired = reward.status === 'expired' || reward.isExpired;

                  let statusBadge = { label: 'Active', color: '#22c55e', bgColor: 'rgba(34, 197, 94, 0.15)' };
                  if (isUsed) {
                    statusBadge = { label: 'Used', color: '#6b7280', bgColor: 'rgba(107, 114, 128, 0.15)' };
                  } else if (isExpired) {
                    statusBadge = { label: 'Expired', color: '#ef4444', bgColor: 'rgba(239, 68, 68, 0.15)' };
                  }

                  const rewardLabel = reward.type === 'referral_referee'
                    ? `${reward.points.toLocaleString()} pts - Referral Reward`
                    : `${reward.points.toLocaleString()} pts - Referrer Bonus`;

                  return (
                    <div
                      key={reward.id}
                      className="rounded-xl p-3"
                      style={{ backgroundColor: themeVars.surfaceAlt }}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xl">🎁</span>
                          <div>
                            <div className="text-sm font-semibold text-neutral-900">
                              {rewardLabel}
                            </div>
                            {isActive && reward.daysUntilExpiry !== null && (
                              <div className="mt-0.5 text-xs text-neutral-500">
                                Expires in {reward.daysUntilExpiry} day{reward.daysUntilExpiry !== 1 ? 's' : ''}
                              </div>
                            )}
                            {isUsed && reward.usedAt && (
                              <div className="mt-0.5 text-xs text-neutral-500">
                                Used on {new Date(reward.usedAt).toLocaleDateString()}
                              </div>
                            )}
                            {isExpired && !isUsed && (
                              <div className="mt-0.5 text-xs text-neutral-500">
                                Reward expired
                              </div>
                            )}
                          </div>
                        </div>
                        <div
                          className="rounded-full px-2 py-0.5 text-xs font-medium"
                          style={{ color: statusBadge.color, backgroundColor: statusBadge.bgColor }}
                        >
                          {statusBadge.label}
                        </div>
                      </div>
                      {isActive && (
                        <button
                          type="button"
                          onClick={() => router.push('/book/service')}
                          className="mt-3 w-full rounded-full py-2 text-sm font-semibold text-neutral-900 transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
                          style={{ backgroundColor: themeVars.primary }}
                        >
                          Book Now to Redeem
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Points section */}
            <div className="border-t border-neutral-100 pt-4">
              <div className="text-sm text-neutral-900">
                You have
                {' '}
                <span className="font-semibold">{activePoints.toLocaleString()} points</span>
              </div>
              <div className="mt-2 space-y-2">
                <div className="flex justify-between text-sm text-neutral-600">
                  {activePoints >= 2500 ? (
                    <span>You have enough points for a FREE Manicure!</span>
                  ) : (
                    <span>{(2500 - activePoints).toLocaleString()} points until FREE Manicure</span>
                  )}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-neutral-200">
                  <div
                    className="h-full rounded-full"
                    style={{ 
                      width: `${Math.min(100, (activePoints / 2500) * 100)}%`, 
                      background: `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})` 
                    }}
                  />
                </div>
                <div className="text-xs text-neutral-500">
                  2,500 pts = Free Gel Manicure
                </div>
              </div>
            </div>
          </div>
        </CollapsibleSection>

        {/* Invite & Earn Section */}
        <CollapsibleSection id="invite" title="Invite & Earn" isOpen={openSections.has('invite')} onToggle={toggleSection}>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-neutral-700">
              Invite friends and earn a free manicure.
            </p>
            <div className="space-y-2">
              <label htmlFor="friend-phone-unauth" className="text-sm font-medium text-neutral-900">
                Friend&apos;s Phone Number
              </label>
              <div className="flex items-center gap-2">
                <div className="flex items-center rounded-full bg-neutral-100 px-2.5 py-1.5 text-sm text-neutral-600">
                  <span className="mr-1">+1</span>
                </div>
                <input
                  id="friend-phone-unauth"
                  type="tel"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={friendPhone}
                  onChange={handlePhoneChange}
                  placeholder="Phone number"
                  className="min-w-0 flex-1 rounded-full bg-neutral-100 px-3 py-2 text-base text-neutral-800 outline-none placeholder:text-neutral-400"
                  autoComplete="off"
                  disabled={inviteSending}
                />
              </div>
              {inviteError && (
                <p className="mt-1 text-center text-sm text-red-600">
                  {inviteError}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={handleSendReferral}
              disabled={friendPhone.length !== 10 || inviteSending}
              className="w-full rounded-full py-3 text-sm font-semibold text-neutral-900 shadow-sm transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: themeVars.primary }}
            >
              {inviteSending ? 'Sending...' : 'Send Referral'}
            </button>
            <button
              type="button"
              onClick={() => router.push(`/${locale}/invite`)}
              className="w-full text-sm font-medium transition-colors hover:opacity-80"
              style={{ color: themeVars.accent }}
            >
              Share Referral Link
            </button>
            <button
              type="button"
              onClick={() => router.push(`/${locale}/my-referrals`)}
              className="text-sm font-medium transition-colors hover:opacity-80"
              style={{ color: themeVars.accent }}
            >
              My Referrals
            </button>
          </div>
        </CollapsibleSection>

        {/* Membership Section */}
        <CollapsibleSection id="membership" title="Membership" isOpen={openSections.has('membership')} onToggle={toggleSection}>
          <div className="space-y-3 pt-2">
            <div className="text-sm text-neutral-900">
              Current tier:
              {' '}
              <span className="font-semibold">Gold</span>
            </div>
            <ul className="space-y-1.5 text-sm text-neutral-600">
              <li className="flex items-start gap-2">
                <span className="mt-0.5" style={{ color: themeVars.primary }}>•</span>
                <span>Priority booking</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5" style={{ color: themeVars.primary }}>•</span>
                <span>Birthday gift</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5" style={{ color: themeVars.primary }}>•</span>
                <span>Extra reward points</span>
              </li>
            </ul>
            <button
              type="button"
              onClick={() => {}}
              className="text-sm font-medium transition-colors hover:opacity-80"
              style={{ color: themeVars.accent }}
            >
              Membership Details
            </button>
          </div>
        </CollapsibleSection>

        {/* Rate Us on Google Section */}
        <CollapsibleSection id="rate-us" title="Rate Us on Google" isOpen={openSections.has('rate-us')} onToggle={toggleSection}>
          <div className="space-y-3 pt-2">
            <p className="text-sm text-neutral-700">
              Love your nails? Help us grow.
            </p>
            <button
              type="button"
              onClick={() => {
                window.open('https://www.google.com/maps/place/Nail+Salon+No.5', '_blank');
              }}
              className="w-full rounded-full py-2.5 text-sm font-semibold text-neutral-900 transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
              style={{ backgroundColor: themeVars.primary }}
            >
              Rate Us on Google
            </button>
          </div>
        </CollapsibleSection>

        {/* Beauty Profile Section */}
        <CollapsibleSection id="beauty-profile" title="Beauty Preferences" isOpen={openSections.has('beauty-profile')} onToggle={toggleSection}>
          {preferencesLoading ? (
            <div className="flex items-center justify-center py-8">
              <div
                className="size-6 animate-spin rounded-full border-2 border-t-transparent"
                style={{ borderColor: `${themeVars.primary} transparent ${themeVars.primary} ${themeVars.primary}` }}
              />
            </div>
          ) : (
          <div className="space-y-2.5 pt-2">
            {/* Card 1 - Contact & Basics */}
            <div className="space-y-4 rounded-xl p-4 shadow-sm" style={{ backgroundColor: themeVars.surfaceAlt }}>
              <div className="space-y-2">
                <label htmlFor="beauty-email" className="text-sm font-medium text-neutral-900">
                  Email (Optional)
                </label>
                <input
                  id="beauty-email"
                  type="email"
                  value={
                    isEditingBeautyProfile
                      ? editedBeautyProfile.email
                      : beautyProfile.email
                  }
                  onChange={e =>
                    setEditedBeautyProfile({
                      ...editedBeautyProfile,
                      email: e.target.value,
                    })}
                  disabled={!isEditingBeautyProfile}
                  placeholder="your@email.com"
                  className="w-full rounded-full bg-neutral-100 px-4 py-2 text-sm text-neutral-800 outline-none placeholder:text-neutral-400 disabled:opacity-60"
                />
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium text-neutral-900">
                  Favorite Technician
                </span>
                <div className="flex flex-wrap gap-3">
                  {['Daniela', 'Tiffany', 'Jenny'].map((tech) => {
                    const isSelected = isEditingBeautyProfile
                      ? editedBeautyProfile.favTech === tech
                      : beautyProfile.favTech === tech;
                    return (
                      <button
                        key={tech}
                        type="button"
                        onClick={() =>
                          isEditingBeautyProfile
                          && setEditedBeautyProfile({
                            ...editedBeautyProfile,
                            favTech: tech,
                          })}
                        disabled={!isEditingBeautyProfile}
                        className={`rounded-full px-5 py-2.5 text-sm font-medium transition-all duration-150 ${
                          isSelected
                            ? 'text-neutral-900 ring-2 ring-offset-1'
                            : 'bg-neutral-50 text-neutral-700 hover:bg-neutral-100'
                        } ${!isEditingBeautyProfile ? 'cursor-default' : ''}`}
                        style={isSelected ? {
                          backgroundColor: themeVars.accentSelected,
                          '--tw-ring-color': themeVars.accent,
                          '--tw-ring-offset-color': themeVars.surfaceAlt,
                          borderWidth: 0,
                        } as React.CSSProperties : {
                          borderWidth: '1px',
                          borderStyle: 'solid',
                          borderColor: themeVars.accent,
                        }}
                      >
                        {tech}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Card 2 - Nail Preferences */}
            <div className="space-y-4 rounded-xl p-4 shadow-sm" style={{ backgroundColor: themeVars.surfaceAlt }}>
              <div className="space-y-2">
                <span className="text-sm font-medium text-neutral-900">
                  Nail Length
                </span>
                <div className="flex flex-wrap gap-3">
                  {['Short', 'Medium', 'Long'].map((length) => {
                    const isSelected = isEditingBeautyProfile
                      ? editedBeautyProfile.nailLength === length
                      : beautyProfile.nailLength === length;
                    return (
                      <button
                        key={length}
                        type="button"
                        onClick={() =>
                          isEditingBeautyProfile
                          && setEditedBeautyProfile({
                            ...editedBeautyProfile,
                            nailLength: length,
                          })}
                        disabled={!isEditingBeautyProfile}
                        className={`rounded-full px-5 py-2.5 text-sm font-medium transition-all duration-150 ${
                          isSelected
                            ? 'text-neutral-900 ring-2 ring-offset-1'
                            : 'bg-neutral-50 text-neutral-700 hover:bg-neutral-100'
                        } ${!isEditingBeautyProfile ? 'cursor-default' : ''}`}
                        style={isSelected ? {
                          backgroundColor: themeVars.accentSelected,
                          '--tw-ring-color': themeVars.accent,
                          '--tw-ring-offset-color': themeVars.surfaceAlt,
                          borderWidth: 0,
                        } as React.CSSProperties : {
                          borderWidth: '1px',
                          borderStyle: 'solid',
                          borderColor: themeVars.accent,
                        }}
                      >
                        {length}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium text-neutral-900">
                  Nail Shape
                </span>
                <div className="flex flex-wrap gap-3">
                  {['Square', 'Squoval', 'Almond', 'Coffin', 'Stiletto'].map(
                    (shape) => {
                      const isSelected = isEditingBeautyProfile
                        ? editedBeautyProfile.nailShape === shape
                        : beautyProfile.nailShape === shape;
                      return (
                        <button
                          key={shape}
                          type="button"
                          onClick={() =>
                            isEditingBeautyProfile
                            && setEditedBeautyProfile({
                              ...editedBeautyProfile,
                              nailShape: shape,
                            })}
                          disabled={!isEditingBeautyProfile}
                          className={`rounded-full px-5 py-2.5 text-sm font-medium transition-all duration-150 ${
                            isSelected
                              ? 'text-neutral-900 ring-2 ring-offset-1'
                              : 'bg-neutral-50 text-neutral-700 hover:bg-neutral-100'
                          } ${!isEditingBeautyProfile ? 'cursor-default' : ''}`}
                          style={isSelected ? {
                            backgroundColor: themeVars.accentSelected,
                            '--tw-ring-color': themeVars.accent,
                            '--tw-ring-offset-color': themeVars.surfaceAlt,
                            borderWidth: 0,
                          } as React.CSSProperties : {
                            borderWidth: '1px',
                            borderStyle: 'solid',
                            borderColor: themeVars.accent,
                          }}
                        >
                          {shape}
                        </button>
                      );
                    },
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium text-neutral-900">
                  Finish
                </span>
                <div className="flex flex-wrap gap-3">
                  {['Glossy', 'Matte', 'Chrome', 'Cat-eye'].map((finish) => {
                    const isSelected = isEditingBeautyProfile
                      ? editedBeautyProfile.finish === finish
                      : beautyProfile.finish === finish;
                    return (
                      <button
                        key={finish}
                        type="button"
                        onClick={() =>
                          isEditingBeautyProfile
                          && setEditedBeautyProfile({
                            ...editedBeautyProfile,
                            finish,
                          })}
                        disabled={!isEditingBeautyProfile}
                        className={`rounded-full px-5 py-2.5 text-sm font-medium transition-all duration-150 ${
                          isSelected
                            ? 'text-neutral-900 ring-2 ring-offset-1'
                            : 'bg-neutral-50 text-neutral-700 hover:bg-neutral-100'
                        } ${!isEditingBeautyProfile ? 'cursor-default' : ''}`}
                        style={isSelected ? {
                          backgroundColor: themeVars.accentSelected,
                          '--tw-ring-color': themeVars.accent,
                          '--tw-ring-offset-color': themeVars.surfaceAlt,
                          borderWidth: 0,
                        } as React.CSSProperties : {
                          borderWidth: '1px',
                          borderStyle: 'solid',
                          borderColor: themeVars.accent,
                        }}
                      >
                        {finish}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium text-neutral-900">
                  Favorite Colors
                </span>
                <div className="flex flex-wrap gap-3">
                  {[
                    'Nudes',
                    'Pinks',
                    'Neutrals',
                    'Bright',
                    'Dark',
                    'French',
                    'Glitter',
                  ].map((color) => {
                    const isSelected = isEditingBeautyProfile
                      ? editedBeautyProfile.favColors.includes(color)
                      : beautyProfile.favColors.includes(color);
                    return (
                      <button
                        key={color}
                        type="button"
                        onClick={() =>
                          isEditingBeautyProfile
                          && setEditedBeautyProfile({
                            ...editedBeautyProfile,
                            favColors: toggleArrayItem(
                              editedBeautyProfile.favColors,
                              color,
                            ),
                          })}
                        disabled={!isEditingBeautyProfile}
                        className={`rounded-full px-4 py-2 text-sm font-medium transition-all duration-150 ${
                          isSelected
                            ? 'text-neutral-900 ring-2 ring-offset-1'
                            : 'bg-neutral-50 text-neutral-700 hover:bg-neutral-100'
                        } ${!isEditingBeautyProfile ? 'cursor-default' : ''}`}
                        style={isSelected ? {
                          backgroundColor: themeVars.accentSelected,
                          '--tw-ring-color': themeVars.accent,
                          '--tw-ring-offset-color': themeVars.surfaceAlt,
                          borderWidth: 0,
                        } as React.CSSProperties : {
                          borderWidth: '1px',
                          borderStyle: 'solid',
                          borderColor: themeVars.accent,
                        }}
                      >
                        {color}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Card 3 - Favourite Gel Brands */}
            <div className="space-y-3 rounded-xl p-4 shadow-sm" style={{ backgroundColor: themeVars.surfaceAlt }}>
              <span className="text-sm font-medium text-neutral-900">
                Favorite Brands
              </span>
              <div className="flex flex-wrap gap-3">
                {[
                  'Kokoist',
                  'OPI',
                  'Valentino',
                  'TGB',
                  'Bio Sculpture',
                  'IceGel',
                  'Presto',
                  'Aprés',
                  'F Gel',
                  'Vetro',
                  'DND',
                  'Beetles',
                ].map((brand) => {
                  const isSelected = isEditingBeautyProfile
                    ? editedBeautyProfile.favBrands.includes(brand)
                    : beautyProfile.favBrands.includes(brand);
                  return (
                    <button
                      key={brand}
                      type="button"
                      onClick={() =>
                        isEditingBeautyProfile
                        && setEditedBeautyProfile({
                          ...editedBeautyProfile,
                          favBrands: toggleArrayItem(
                            editedBeautyProfile.favBrands,
                            brand,
                          ),
                        })}
                      disabled={!isEditingBeautyProfile}
                      className={`rounded-full px-4 py-2 text-sm font-medium transition-all duration-150 ${
                        isSelected
                          ? 'text-neutral-900 ring-2 ring-offset-1'
                          : 'bg-neutral-50 text-neutral-700 hover:bg-neutral-100'
                      } ${!isEditingBeautyProfile ? 'cursor-default' : ''}`}
                      style={isSelected ? {
                        backgroundColor: themeVars.accentSelected,
                        '--tw-ring-color': themeVars.accent,
                        '--tw-ring-offset-color': themeVars.surfaceAlt,
                        borderWidth: 0,
                      } as React.CSSProperties : {
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderColor: themeVars.accent,
                      }}
                    >
                      {brand}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Card 4 - Favourite Services & Styles */}
            <div className="space-y-4 rounded-xl p-4 shadow-sm" style={{ backgroundColor: themeVars.surfaceAlt }}>
              <div className="space-y-2">
                <span className="text-sm font-medium text-neutral-900">
                  Favorite Service
                </span>
                <div className="flex flex-wrap gap-3">
                  {[
                    'BIAB',
                    'Gel-X',
                    'Gel Manicure',
                    'Classic Mani/Pedi',
                    'Combo',
                  ].map((service) => {
                    const isSelected = isEditingBeautyProfile
                      ? editedBeautyProfile.favService === service
                      : beautyProfile.favService === service;
                    return (
                      <button
                        key={service}
                        type="button"
                        onClick={() =>
                          isEditingBeautyProfile
                          && setEditedBeautyProfile({
                            ...editedBeautyProfile,
                            favService: service,
                          })}
                        disabled={!isEditingBeautyProfile}
                        className={`rounded-full px-5 py-2.5 text-sm font-medium transition-all duration-150 ${
                          isSelected
                            ? 'text-neutral-900 ring-2 ring-offset-1'
                            : 'bg-neutral-50 text-neutral-700 hover:bg-neutral-100'
                        } ${!isEditingBeautyProfile ? 'cursor-default' : ''}`}
                        style={isSelected ? {
                          backgroundColor: themeVars.accentSelected,
                          '--tw-ring-color': themeVars.accent,
                          '--tw-ring-offset-color': themeVars.surfaceAlt,
                          borderWidth: 0,
                        } as React.CSSProperties : {
                          borderWidth: '1px',
                          borderStyle: 'solid',
                          borderColor: themeVars.accent,
                        }}
                      >
                        {service}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium text-neutral-900">
                  Design Styles
                </span>
                <div className="flex flex-wrap gap-3">
                  {[
                    'French',
                    'Minimal art',
                    'Heavy art',
                    'Chrome/Aura',
                    'Glitter',
                    '3D charms',
                    'Simple designs',
                  ].map((design) => {
                    const isSelected = isEditingBeautyProfile
                      ? editedBeautyProfile.designStyles.includes(design)
                      : beautyProfile.designStyles.includes(design);
                    return (
                      <button
                        key={design}
                        type="button"
                        onClick={() =>
                          isEditingBeautyProfile
                          && setEditedBeautyProfile({
                            ...editedBeautyProfile,
                            designStyles: toggleArrayItem(
                              editedBeautyProfile.designStyles,
                              design,
                            ),
                          })}
                        disabled={!isEditingBeautyProfile}
                        className={`rounded-full px-4 py-2 text-sm font-medium transition-all duration-150 ${
                          isSelected
                            ? 'text-neutral-900 ring-2 ring-offset-1'
                            : 'bg-neutral-50 text-neutral-700 hover:bg-neutral-100'
                        } ${!isEditingBeautyProfile ? 'cursor-default' : ''}`}
                        style={isSelected ? {
                          backgroundColor: themeVars.accentSelected,
                          '--tw-ring-color': themeVars.accent,
                          '--tw-ring-offset-color': themeVars.surfaceAlt,
                          borderWidth: 0,
                        } as React.CSSProperties : {
                          borderWidth: '1px',
                          borderStyle: 'solid',
                          borderColor: themeVars.accent,
                        }}
                      >
                        {design}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Card 5 - Notes for Your Tech */}
            <div className="space-y-3 rounded-xl p-4 shadow-sm" style={{ backgroundColor: themeVars.surfaceAlt }}>
              <label htmlFor="tech-notes" className="text-sm font-medium text-neutral-900">
                Notes for Your Technician
              </label>
              <textarea
                id="tech-notes"
                value={
                  isEditingBeautyProfile
                    ? editedBeautyProfile.notes
                    : beautyProfile.notes
                }
                onChange={e =>
                  setEditedBeautyProfile({
                    ...editedBeautyProfile,
                    notes: e.target.value,
                  })}
                disabled={!isEditingBeautyProfile}
                placeholder="e.g., I prefer shorter cuticle work, extra gentle on my left thumb..."
                rows={4}
                className="w-full resize-none rounded-xl bg-neutral-100 px-4 py-3 text-sm text-neutral-800 outline-none placeholder:text-neutral-400 disabled:opacity-60"
              />
            </div>

            {/* Edit / Save / Cancel buttons */}
            {!isEditingBeautyProfile
              ? (
                  <button
                    type="button"
                    onClick={handleEditBeautyProfile}
                    className="px-1 text-sm font-medium transition-colors hover:opacity-80"
                    style={{ color: themeVars.accent }}
                  >
                    Edit Preferences
                  </button>
                )
              : (
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleCancelBeautyProfile}
                      className="flex-1 rounded-full border-2 border-neutral-200 bg-white py-2.5 text-sm font-semibold text-neutral-900 transition-all duration-150 hover:bg-neutral-50 active:scale-[0.98]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveBeautyProfile}
                      className="flex-1 rounded-full py-2.5 text-sm font-semibold text-neutral-900 transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
                      style={{ backgroundColor: themeVars.primary }}
                    >
                      Save
                    </button>
                  </div>
                )}
          </div>
          )}
        </CollapsibleSection>

        {/* Payment Methods Section */}
        <CollapsibleSection id="payment" title="Payment Methods" isOpen={openSections.has('payment')} onToggle={toggleSection}>
          <div className="space-y-3 pt-2">
            {/* Cards List */}
            {!showAddCard && !showManageCards && (
              <>
                {paymentCards.map(card => (
                  <div
                    key={card.id}
                    className="flex items-center justify-between rounded-xl p-3"
                    style={{ backgroundColor: themeVars.surfaceAlt }}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-neutral-900">
                        {card.type}
                        {' '}
                        ••••
                        {card.last4}
                      </span>
                      {card.isDefault && (
                        <span
                          className="rounded-full px-2 py-0.5 text-sm font-medium text-neutral-700"
                          style={{ backgroundColor: `color-mix(in srgb, ${themeVars.primary} 20%, transparent)` }}
                        >
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
                    className="text-left text-sm font-medium transition-colors hover:opacity-80"
                    style={{ color: themeVars.accent }}
                  >
                    Add New Card
                  </button>
                  <button
                    type="button"
                    onClick={handleManageCards}
                    className="text-left text-sm font-medium transition-colors hover:opacity-80"
                    style={{ color: themeVars.accent }}
                  >
                    Manage Payment Methods
                  </button>
                </div>
              </>
            )}

            {/* Add Card Form */}
            {showAddCard && (
              <div className="space-y-3 rounded-xl p-4" style={{ backgroundColor: themeVars.surfaceAlt }}>
                <h3 className="text-sm font-semibold text-neutral-900">
                  Add New Card
                </h3>
                <div className="space-y-3">
                  <div>
                    <label htmlFor="card-number" className="mb-1.5 block text-sm font-medium text-neutral-700">
                      Card Number
                    </label>
                    <input
                      id="card-number"
                      type="text"
                      value={newCard.cardNumber}
                      onChange={e =>
                        setNewCard({
                          ...newCard,
                          cardNumber: formatCardNumber(e.target.value).slice(
                            0,
                            19,
                          ),
                        })}
                      placeholder="1234 5678 9012 3456"
                      maxLength={19}
                      className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-800 outline-none placeholder:text-neutral-400"
                    />
                  </div>
                  <div>
                    <label htmlFor="cardholder-name" className="mb-1.5 block text-sm font-medium text-neutral-700">
                      Cardholder Name
                    </label>
                    <input
                      id="cardholder-name"
                      type="text"
                      value={newCard.cardholderName}
                      onChange={e =>
                        setNewCard({
                          ...newCard,
                          cardholderName: e.target.value,
                        })}
                      placeholder="John Doe"
                      className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-800 outline-none placeholder:text-neutral-400"
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="col-span-2">
                      <label htmlFor="expiry-month" className="mb-1.5 block text-sm font-medium text-neutral-700">
                        Expiry Date
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="expiry-month"
                          type="text"
                          value={newCard.expiryMonth}
                          onChange={e =>
                            setNewCard({
                              ...newCard,
                              expiryMonth: e.target.value.replace(/\D/g, '').slice(0, 2),
                            })}
                          placeholder="MM"
                          maxLength={2}
                          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-800 outline-none placeholder:text-neutral-400"
                        />
                        <input
                          id="expiry-year"
                          aria-label="Expiry Year"
                          type="text"
                          value={newCard.expiryYear}
                          onChange={e =>
                            setNewCard({
                              ...newCard,
                              expiryYear: e.target.value.replace(/\D/g, '').slice(0, 4),
                            })}
                          placeholder="YYYY"
                          maxLength={4}
                          className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-800 outline-none placeholder:text-neutral-400"
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="card-cvv" className="mb-1.5 block text-sm font-medium text-neutral-700">
                        CVV
                      </label>
                      <input
                        id="card-cvv"
                        type="text"
                        value={newCard.cvv}
                        onChange={e =>
                          setNewCard({
                            ...newCard,
                            cvv: e.target.value.replace(/\D/g, '').slice(0, 4),
                          })}
                        placeholder="123"
                        maxLength={4}
                        className="w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-800 outline-none placeholder:text-neutral-400"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={handleCancelAddCard}
                    className="flex-1 rounded-full border-2 border-neutral-200 bg-white py-2.5 text-sm font-semibold text-neutral-900 transition-all duration-150 hover:bg-neutral-50 active:scale-[0.98]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveCard}
                    className="flex-1 rounded-full py-2.5 text-sm font-semibold text-neutral-900 transition-all duration-150 hover:opacity-90 active:scale-[0.98]"
                    style={{ backgroundColor: themeVars.primary }}
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
                {paymentCards.map(card => (
                  <div
                    key={card.id}
                    className="space-y-3 rounded-xl p-4"
                    style={{ backgroundColor: themeVars.surfaceAlt }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-neutral-900">
                          {card.type}
                          {' '}
                          ••••
                          {card.last4}
                        </span>
                        {card.isDefault && (
                          <span
                            className="rounded-full px-2 py-0.5 text-sm font-medium text-neutral-700"
                            style={{ backgroundColor: `color-mix(in srgb, ${themeVars.primary} 20%, transparent)` }}
                          >
                            Default
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="text-sm text-neutral-600">
                      Expires
                      {' '}
                      {card.expiryMonth}
                      /
                      {card.expiryYear}
                    </div>
                    <div className="flex gap-2 pt-2">
                      {!card.isDefault && (
                        <button
                          type="button"
                          onClick={() => handleSetDefault(card.id)}
                          className="flex-1 rounded-full border-2 border-neutral-200 bg-white py-2 text-sm font-semibold text-neutral-900 transition-all duration-150 hover:bg-neutral-50 active:scale-[0.98]"
                        >
                          Set as Default
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteCard(card.id)}
                        className="flex-1 rounded-full border-2 border-red-200 bg-red-50 py-2 text-sm font-semibold text-red-600 transition-all duration-150 hover:bg-red-100 active:scale-[0.98]"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setShowManageCards(false)}
                  className="w-full rounded-full border-2 border-neutral-200 bg-white py-2.5 text-sm font-semibold text-neutral-900 transition-all duration-150 hover:bg-neutral-50 active:scale-[0.98]"
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </CollapsibleSection>

        {/* Settings Section */}
        <CollapsibleSection id="settings" title="Settings" isOpen={openSections.has('settings')} onToggle={toggleSection}>
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-900">
                Appointment Reminders
              </span>
              <button
                type="button"
                onClick={() =>
                  setAppointmentReminders(!appointmentReminders)}
                className="relative h-6 w-11 rounded-full transition-colors duration-150"
                style={{ backgroundColor: appointmentReminders ? themeVars.primary : '#d4d4d4' }}
              >
                <div
                  className={`absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm transition-transform duration-150 ${
                    appointmentReminders ? 'translate-x-5' : ''
                  }`}
                />
              </button>
            </div>
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => setShowLanguageSelector(!showLanguageSelector)}
                className="flex w-full items-center justify-between text-sm text-neutral-900"
              >
                <span>
                  Language:
                  {currentLanguage.name}
                </span>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className={`transition-transform duration-150 ${
                    showLanguageSelector ? 'rotate-90' : ''
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
                <div className="space-y-1 rounded-xl p-2" style={{ backgroundColor: themeVars.surfaceAlt }}>
                  {languages.map(lang => (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => handleLanguageChange(lang.code)}
                      className={`w-full rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                        locale === lang.code
                          ? 'text-neutral-900'
                          : 'text-neutral-700 hover:bg-white'
                      }`}
                      style={locale === lang.code ? { backgroundColor: themeVars.primary } : undefined}
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

        {/* Sign Out Button */}
        <button
          type="button"
          onClick={async () => {
            await fetch('/api/auth/logout', { method: 'POST' });
            router.push('/book/service');
          }}
          className="w-full rounded-xl border-2 border-red-200 bg-red-50 py-3 text-sm font-semibold text-red-600 transition-all duration-150 hover:bg-red-100 active:scale-[0.98]"
        >
          Sign Out
        </button>
      </div>

      {/* Confetti Popup */}
      <ConfettiPopup
        isOpen={showConfetti}
        onClose={() => setShowConfetti(false)}
        title="You just gifted your friend a FREE manicure!"
        message="They'll receive a text with your referral. When they book, you both win!"
        emoji="🎊"
        autoDismissMs={4000}
      />
    </div>
  );
}
