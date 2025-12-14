'use client';

import { useUser } from '@clerk/nextjs';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

// =============================================================================
// Types
// =============================================================================

type ClientProfile = {
  client: {
    phone: string;
    name: string | null;
    memberSince: string | null;
  };
  stats: {
    totalVisits: number;
    totalSpent: number;
    lastVisit: string | null;
  };
  preferences: {
    favoriteTechId: string | null;
    favoriteTechName: string | null;
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
  } | null;
  appointments: Array<{
    id: string;
    startTime: string;
    endTime: string;
    status: string;
    totalPrice: number;
    technicianName: string | null;
    services: string[];
  }>;
  photos: Array<{
    id: string;
    appointmentId: string;
    photoType: string;
    imageUrl: string;
    thumbnailUrl: string | null;
    caption: string | null;
    createdAt: string;
  }>;
};

// =============================================================================
// Stat Card Component
// =============================================================================

function StatCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="rounded-xl p-3" style={{ backgroundColor: themeVars.surfaceAlt }}>
      <div className="mb-1 text-lg">{icon}</div>
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-sm font-bold text-neutral-900">{value}</div>
    </div>
  );
}

// =============================================================================
// Preference Tag Component
// =============================================================================

function PreferenceTag({ label }: { label: string }) {
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: themeVars.accentSelected, color: themeVars.accent }}
    >
      {label}
    </span>
  );
}

// =============================================================================
// Staff Client Profile Page
// =============================================================================

export default function StaffClientProfilePage() {
  const { user, isLoaded } = useUser();
  const router = useRouter();
  const params = useParams();
  const { salonSlug } = useSalon();
  const phone = params?.phone as string;

  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [activeTab, setActiveTab] = useState<'photos' | 'appointments' | 'preferences'>('photos');
  const [selectedPhoto, setSelectedPhoto] = useState<string | null>(null);

  // Fetch client profile
  const fetchProfile = useCallback(async () => {
    if (!salonSlug || !phone) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `/api/staff/client/${phone}?salonSlug=${salonSlug}`,
      );
      if (response.ok) {
        const data = await response.json();
        setProfile(data.data);
      }
    } catch (error) {
      console.error('Failed to fetch client profile:', error);
    } finally {
      setLoading(false);
    }
  }, [salonSlug, phone]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isLoaded && user && salonSlug && phone) {
      fetchProfile();
    }
  }, [isLoaded, user, salonSlug, phone, fetchProfile]);

  // Format date
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Format time
  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  // Format price
  const formatPrice = (cents: number) => {
    return `$${(cents / 100).toFixed(0)}`;
  };

  // Format phone
  const formatPhone = (p: string) => {
    return p.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
  };

  if (!isLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ backgroundColor: themeVars.background }}>
        <div
          className="size-8 animate-spin rounded-full border-4 border-t-transparent"
          style={{ borderColor: `${themeVars.primary} transparent ${themeVars.primary} ${themeVars.primary}` }}
        />
      </div>
    );
  }

  if (!user) {
    return (
      <div
        className="flex min-h-screen flex-col items-center justify-center p-4"
        style={{ backgroundColor: themeVars.background }}
      >
        <h1 className="mb-4 text-2xl font-bold" style={{ color: themeVars.titleText }}>
          Staff Access Required
        </h1>
        <p className="text-neutral-600">Please sign in to access this page.</p>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen pb-8"
      style={{
        background: `linear-gradient(to bottom, ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <div className="mx-auto max-w-2xl px-4">
        {/* Header */}
        <div
          className="pb-4 pt-6"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(-8px)',
            transition: 'opacity 300ms ease-out, transform 300ms ease-out',
          }}
        >
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex size-10 items-center justify-center rounded-full transition-colors hover:bg-white/60"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <h1 className="text-xl font-bold" style={{ color: themeVars.titleText }}>
              Client Profile
            </h1>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div
              className="size-8 animate-spin rounded-full border-4 border-t-transparent"
              style={{ borderColor: `${themeVars.primary} transparent ${themeVars.primary} ${themeVars.primary}` }}
            />
          </div>
        ) : profile ? (
          <div
            className="space-y-4"
            style={{
              opacity: mounted ? 1 : 0,
              transform: mounted ? 'translateY(0)' : 'translateY(10px)',
              transition: 'opacity 300ms ease-out 100ms, transform 300ms ease-out 100ms',
            }}
          >
            {/* Client Info Card */}
            <div
              className="overflow-hidden rounded-2xl bg-white shadow-lg"
              style={{ borderColor: themeVars.cardBorder, borderWidth: 1 }}
            >
              <div className="p-4">
                <div className="mb-4 flex items-center gap-4">
                  <div
                    className="flex size-16 items-center justify-center rounded-full text-2xl"
                    style={{ background: `linear-gradient(to bottom right, ${themeVars.accentSelected}, color-mix(in srgb, ${themeVars.accentSelected} 80%, ${themeVars.accent}))` }}
                  >
                    👤
                  </div>
                  <div>
                    <div className="text-xl font-bold text-neutral-900">
                      {profile.client.name || 'Client'}
                    </div>
                    <div className="text-sm text-neutral-500">
                      {formatPhone(profile.client.phone)}
                    </div>
                    {profile.client.memberSince && (
                      <div className="mt-1 text-xs text-neutral-400">
                        Member since
                        {' '}
                        {formatDate(profile.client.memberSince)}
                      </div>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-2">
                  <StatCard
                    icon="📅"
                    label="Total Visits"
                    value={profile.stats.totalVisits.toString()}
                  />
                  <StatCard
                    icon="💰"
                    label="Total Spent"
                    value={formatPrice(profile.stats.totalSpent)}
                  />
                  <StatCard
                    icon="📆"
                    label="Last Visit"
                    value={profile.stats.lastVisit ? formatDate(profile.stats.lastVisit) : 'N/A'}
                  />
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 rounded-xl bg-white p-1 shadow-sm" style={{ borderColor: themeVars.cardBorder, borderWidth: 1 }}>
              {(['photos', 'appointments', 'preferences'] as const).map(tab => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className="flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all"
                  style={{
                    background: activeTab === tab
                      ? `linear-gradient(to bottom, ${themeVars.primary}, ${themeVars.primaryDark})`
                      : 'transparent',
                    color: activeTab === tab ? '#1a1a1a' : '#666',
                  }}
                >
                  {tab === 'photos' && '📸 Photos'}
                  {tab === 'appointments' && '📅 History'}
                  {tab === 'preferences' && '✨ Style'}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div
              className="overflow-hidden rounded-2xl bg-white shadow-lg"
              style={{ borderColor: themeVars.cardBorder, borderWidth: 1 }}
            >
              <div className="p-4">
                {/* Photos Tab */}
                {activeTab === 'photos' && (
                  profile.photos.length === 0
                    ? (
                        <div className="py-8 text-center text-neutral-500">
                          <div className="mb-2 text-3xl">📸</div>
                          <p>No photos yet</p>
                        </div>
                      )
                    : (
                        <div className="grid grid-cols-3 gap-2">
                          {profile.photos.map(photo => (
                            <button
                              key={photo.id}
                              type="button"
                              onClick={() => setSelectedPhoto(photo.imageUrl)}
                              className="relative aspect-square overflow-hidden rounded-xl"
                            >
                              <Image
                                src={photo.thumbnailUrl || photo.imageUrl}
                                alt={photo.photoType}
                                fill
                                className="object-cover transition-transform hover:scale-105"
                              />
                              <div
                                className="absolute inset-x-0 bottom-0 py-0.5 text-center text-[10px] font-medium text-white"
                                style={{ backgroundColor: photo.photoType === 'before' ? themeVars.accent : '#22c55e' }}
                              >
                                {photo.photoType}
                              </div>
                            </button>
                          ))}
                        </div>
                      )
                )}

                {/* Appointments Tab */}
                {activeTab === 'appointments' && (
                  profile.appointments.length === 0
                    ? (
                        <div className="py-8 text-center text-neutral-500">
                          <div className="mb-2 text-3xl">📅</div>
                          <p>No appointment history</p>
                        </div>
                      )
                    : (
                        <div className="space-y-3">
                          {profile.appointments.slice(0, 10).map(appt => (
                            <div
                              key={appt.id}
                              className="rounded-xl p-3"
                              style={{ backgroundColor: themeVars.surfaceAlt }}
                            >
                              <div className="flex items-start justify-between">
                                <div>
                                  <div className="font-medium text-neutral-900">
                                    {appt.services.join(', ')}
                                  </div>
                                  <div className="text-sm text-neutral-500">
                                    {formatDate(appt.startTime)}
                                    {' '}
                                    at
                                    {formatTime(appt.startTime)}
                                  </div>
                                  {appt.technicianName && (
                                    <div className="mt-1 text-xs" style={{ color: themeVars.accent }}>
                                      with
                                      {' '}
                                      {appt.technicianName}
                                    </div>
                                  )}
                                </div>
                                <div className="text-right">
                                  <div className="font-bold" style={{ color: themeVars.primary }}>
                                    {formatPrice(appt.totalPrice)}
                                  </div>
                                  <div
                                    className="mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium"
                                    style={{
                                      backgroundColor: appt.status === 'completed' ? '#dcfce7' : themeVars.selectedBackground,
                                      color: appt.status === 'completed' ? '#166534' : themeVars.titleText,
                                    }}
                                  >
                                    {appt.status}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                )}

                {/* Preferences Tab */}
                {activeTab === 'preferences' && (
                  !profile.preferences ? (
                    <div className="py-8 text-center text-neutral-500">
                      <div className="mb-2 text-3xl">✨</div>
                      <p>No style preferences saved</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* Nail Style */}
                      <div>
                        <div className="mb-2 text-sm font-medium text-neutral-600">Nail Style</div>
                        <div className="flex flex-wrap gap-2">
                          {profile.preferences.nailShape && (
                            <PreferenceTag label={`Shape: ${profile.preferences.nailShape}`} />
                          )}
                          {profile.preferences.nailLength && (
                            <PreferenceTag label={`Length: ${profile.preferences.nailLength}`} />
                          )}
                          {profile.preferences.finishes?.map(f => (
                            <PreferenceTag key={f} label={f} />
                          ))}
                        </div>
                      </div>

                      {/* Colors */}
                      {profile.preferences.colorFamilies && profile.preferences.colorFamilies.length > 0 && (
                        <div>
                          <div className="mb-2 text-sm font-medium text-neutral-600">Favorite Colors</div>
                          <div className="flex flex-wrap gap-2">
                            {profile.preferences.colorFamilies.map(c => (
                              <PreferenceTag key={c} label={c} />
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Sensitivities */}
                      {profile.preferences.sensitivities && profile.preferences.sensitivities.length > 0 && (
                        <div>
                          <div className="mb-2 text-sm font-medium text-red-600">⚠️ Sensitivities</div>
                          <div className="flex flex-wrap gap-2">
                            {profile.preferences.sensitivities.map(s => (
                              <span key={s} className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                                {s}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Favorite Tech */}
                      {profile.preferences.favoriteTechName && (
                        <div>
                          <div className="mb-2 text-sm font-medium text-neutral-600">Favorite Tech</div>
                          <div className="rounded-xl p-3" style={{ backgroundColor: themeVars.surfaceAlt }}>
                            <span className="font-medium">{profile.preferences.favoriteTechName}</span>
                          </div>
                        </div>
                      )}

                      {/* Tech Notes */}
                      {profile.preferences.techNotes && (
                        <div>
                          <div className="mb-2 text-sm font-medium text-neutral-600">Notes for Tech</div>
                          <div className="rounded-xl p-3 text-sm" style={{ backgroundColor: themeVars.highlightBackground }}>
                            {profile.preferences.techNotes}
                          </div>
                        </div>
                      )}

                      {/* Experience Preferences */}
                      {(profile.preferences.musicPreference || profile.preferences.conversationLevel || profile.preferences.beveragePreference?.length) && (
                        <div>
                          <div className="mb-2 text-sm font-medium text-neutral-600">Experience</div>
                          <div className="flex flex-wrap gap-2">
                            {profile.preferences.musicPreference && (
                              <PreferenceTag label={`🎵 ${profile.preferences.musicPreference}`} />
                            )}
                            {profile.preferences.conversationLevel && (
                              <PreferenceTag label={`💬 ${profile.preferences.conversationLevel}`} />
                            )}
                            {profile.preferences.beveragePreference?.map(b => (
                              <PreferenceTag key={b} label={`☕ ${b}`} />
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        ) : (
          <div
            className="rounded-2xl bg-white p-8 text-center shadow-lg"
            style={{ borderColor: themeVars.cardBorder, borderWidth: 1 }}
          >
            <div className="mb-2 text-4xl">❌</div>
            <p className="text-lg text-neutral-600">Client not found</p>
          </div>
        )}
      </div>

      {/* Photo Lightbox */}
      {selectedPhoto && (
        <div
          role="button"
          tabIndex={0}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setSelectedPhoto(null)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSelectedPhoto(null);
            }
          }}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]">
            <Image
              src={selectedPhoto}
              alt="Full size"
              width={800}
              height={800}
              className="max-h-[85vh] rounded-lg object-contain"
            />
            <button
              type="button"
              onClick={() => setSelectedPhoto(null)}
              className="absolute -right-2 -top-2 flex size-8 items-center justify-center rounded-full bg-white text-lg shadow-lg"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
