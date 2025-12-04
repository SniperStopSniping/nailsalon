'use client';

import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useSalon } from '@/providers/SalonProvider';
import { themeVars } from '@/theme';

const TECHNICIANS = [
  { id: 'daniela', name: 'Daniela', image: '/assets/images/tech-daniela.jpeg' },
  { id: 'tiffany', name: 'Tiffany', image: '/assets/images/tech-tiffany.jpeg' },
  { id: 'jenny', name: 'Jenny', image: '/assets/images/tech-jenny.jpeg' },
];

const SERVICES = [
  { id: 'biab', name: 'BIAB', icon: '💅' },
  { id: 'gelx', name: 'Gel-X', icon: '✨' },
  { id: 'classic', name: 'Classic Mani', icon: '💫' },
  { id: 'pedicure', name: 'Pedicure', icon: '🦶' },
  { id: 'french', name: 'French', icon: '🤍' },
];

const NAIL_SHAPES = [
  { id: 'almond', name: 'Almond', icon: '💅' },
  { id: 'square', name: 'Square', icon: '⬜' },
  { id: 'coffin', name: 'Coffin', icon: '⚰️' },
  { id: 'oval', name: 'Oval', icon: '🥚' },
  { id: 'stiletto', name: 'Stiletto', icon: '📍' },
  { id: 'round', name: 'Round', icon: '⭕' },
];

const NAIL_LENGTHS = [
  { id: 'short', name: 'Short', desc: 'Natural look' },
  { id: 'medium', name: 'Medium', desc: 'Classic length' },
  { id: 'long', name: 'Long', desc: 'Statement nails' },
  { id: 'extra-long', name: 'Extra Long', desc: 'Maximum drama' },
];

const FINISHES = [
  { id: 'glossy', name: 'Glossy', icon: '✨' },
  { id: 'matte', name: 'Matte', icon: '🌙' },
  { id: 'chrome', name: 'Chrome', icon: '🪞' },
  { id: 'glitter', name: 'Glitter', icon: '💎' },
];

const COLOR_FAMILIES = [
  { id: 'nudes', name: 'Nudes', color: '#e8d4c4' },
  { id: 'pinks', name: 'Pinks', color: '#f5c6d6' },
  { id: 'reds', name: 'Reds', color: '#c94c4c' },
  { id: 'french', name: 'French', color: '#fff5f5' },
  { id: 'darks', name: 'Darks', color: '#2d2d2d' },
  { id: 'brights', name: 'Brights', color: '#ff6b6b' },
  { id: 'pastels', name: 'Pastels', color: '#b8e0d2' },
  { id: 'neutrals', name: 'Neutrals', color: '#d4c4b0' },
];

const GEL_BRANDS = [
  { id: 'opi', name: 'OPI', popular: true },
  { id: 'cnd', name: 'CND Shellac', popular: true },
  { id: 'gelish', name: 'Gelish', popular: true },
  { id: 'apres', name: 'Apres', popular: false },
  { id: 'kiara', name: 'Kiara Sky', popular: false },
  { id: 'dnd', name: 'DND', popular: false },
  { id: 'no-preference', name: 'No Preference', popular: false },
];

const SENSITIVITIES = [
  { id: 'none', name: 'None', icon: '✅' },
  { id: 'sensitive-cuticles', name: 'Sensitive Cuticles', icon: '🌸' },
  { id: 'allergies', name: 'Product Allergies', icon: '⚠️' },
  { id: 'thin-nails', name: 'Thin/Weak Nails', icon: '💅' },
  { id: 'dry-skin', name: 'Dry Skin', icon: '💧' },
];

function Section({
  title,
  icon,
  children,
  delay,
  mounted,
}: {
  title: string;
  icon: string;
  children: React.ReactNode;
  delay: number;
  mounted: boolean;
}) {
  return (
    <div
      className="overflow-hidden rounded-2xl bg-white/80 shadow-[0_4px_20px_rgba(0,0,0,0.06)] backdrop-blur-sm"
      style={{
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: themeVars.cardBorder,
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0)' : 'translateY(10px)',
        transition: `opacity 300ms ease-out ${delay}ms, transform 300ms ease-out ${delay}ms`,
      }}
    >
      <div className="p-5">
        <div className="mb-4 flex items-center gap-2">
          <span className="text-xl">{icon}</span>
          <h2 className="text-base font-bold text-neutral-900">{title}</h2>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function PreferencesPage() {
  const router = useRouter();
  const params = useParams();
  const { salonName } = useSalon();
  const locale = (params?.locale as string) || 'en';

  const [mounted, setMounted] = useState(false);
  const [saved, setSaved] = useState(false);

  const [favoriteTech, setFavoriteTech] = useState('daniela');
  const [favoriteServices, setFavoriteServices] = useState<string[]>(['biab']);
  const [nailShape, setNailShape] = useState('almond');
  const [nailLength, setNailLength] = useState('medium');
  const [finishes, setFinishes] = useState<string[]>(['glossy']);
  const [colorFamilies, setColorFamilies] = useState<string[]>(['nudes', 'pinks', 'french']);
  const [preferredBrands, setPreferredBrands] = useState<string[]>(['opi']);
  const [sensitivities, setSensitivities] = useState<string[]>(['none']);
  const [techNotes, setTechNotes] = useState('');
  const [appointmentNotes, setAppointmentNotes] = useState('');
  const [musicPreference, setMusicPreference] = useState('soft');
  const [conversationLevel, setConversationLevel] = useState('friendly');
  const [beveragePreference, setBeveragePreference] = useState<string[]>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleBack = () => {
    router.back();
  };

  const toggleArrayItem = (
    arr: string[],
    item: string,
    setter: (val: string[]) => void,
  ) => {
    if (arr.includes(item)) {
      setter(arr.filter(i => i !== item));
    } else {
      setter([...arr, item]);
    }
  };

  const handleSave = () => {
    setSaved(true);
    setTimeout(() => {
      router.push(`/${locale}/profile`);
    }, 1500);
  };

  return (
    <div
      className="min-h-screen pb-10"
      style={{
        background: `linear-gradient(to bottom, color-mix(in srgb, ${themeVars.background} 95%, white), ${themeVars.background}, color-mix(in srgb, ${themeVars.background} 95%, ${themeVars.primaryDark}))`,
      }}
    >
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4">
        <div
          className="relative flex items-center pb-2 pt-5"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(-8px)',
            transition: 'opacity 300ms ease-out, transform 300ms ease-out',
          }}
        >
          <button
            type="button"
            onClick={handleBack}
            className="z-10 flex size-11 items-center justify-center rounded-full transition-all duration-200 hover:bg-white/60 active:scale-95"
          >
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
              <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div
            className="absolute left-1/2 -translate-x-1/2 text-lg font-semibold tracking-tight"
            style={{ color: themeVars.accent }}
          >
            {salonName}
          </div>
        </div>

        <div
          className="mb-6 text-center"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(10px)',
            transition: 'opacity 300ms ease-out 50ms, transform 300ms ease-out 50ms',
          }}
        >
          <h1 className="mb-1 text-2xl font-bold text-neutral-900">Your Style Profile ✨</h1>
          <p className="text-sm text-neutral-500">Help us personalize every visit just for you</p>
        </div>

        <div className="space-y-5">
          <Section title="Your Favorite Artist" icon="👩‍🎨" delay={100} mounted={mounted}>
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
              {TECHNICIANS.map(tech => (
                <button
                  key={tech.id}
                  type="button"
                  onClick={() => setFavoriteTech(tech.id)}
                  className="flex shrink-0 flex-col items-center gap-2 rounded-2xl p-3 transition-all duration-200"
                  style={{
                    transform: favoriteTech === tech.id ? 'scale(1.05)' : undefined,
                    background: favoriteTech === tech.id
                      ? `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`
                      : 'white',
                    boxShadow: favoriteTech === tech.id ? '0 10px 15px -3px rgb(0 0 0 / 0.1)' : undefined,
                  }}
                  onMouseEnter={(e) => {
                    if (favoriteTech !== tech.id) {
                      e.currentTarget.style.backgroundColor = themeVars.surfaceAlt;
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (favoriteTech !== tech.id) {
                      e.currentTarget.style.backgroundColor = 'white';
                    }
                  }}
                >
                  <div
                    className="relative size-16 overflow-hidden rounded-full border-2"
                    style={{ borderColor: favoriteTech === tech.id ? 'white' : themeVars.cardBorder }}
                  >
                    <Image src={tech.image} alt={tech.name} fill className="object-cover" />
                  </div>
                  <span className={`text-sm font-bold ${favoriteTech === tech.id ? 'text-neutral-900' : 'text-neutral-700'}`}>{tech.name}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setFavoriteTech('any')}
                className="flex shrink-0 flex-col items-center gap-2 rounded-2xl p-3 transition-all duration-200"
                style={{
                  transform: favoriteTech === 'any' ? 'scale(1.05)' : undefined,
                  background: favoriteTech === 'any'
                    ? `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`
                    : 'white',
                  boxShadow: favoriteTech === 'any' ? '0 10px 15px -3px rgb(0 0 0 / 0.1)' : undefined,
                }}
                onMouseEnter={(e) => {
                  if (favoriteTech !== 'any') {
                    e.currentTarget.style.backgroundColor = themeVars.surfaceAlt;
                  }
                }}
                onMouseLeave={(e) => {
                  if (favoriteTech !== 'any') {
                    e.currentTarget.style.backgroundColor = 'white';
                  }
                }}
              >
                <div
                  className="flex size-16 items-center justify-center rounded-full border-2 text-2xl"
                  style={{
                    borderColor: favoriteTech === 'any' ? 'white' : themeVars.cardBorder,
                    backgroundColor: favoriteTech === 'any' ? 'rgba(255,255,255,0.3)' : '#f5f5f5',
                  }}
                >
                  🎲
                </div>
                <span className={`text-sm font-bold ${favoriteTech === 'any' ? 'text-neutral-900' : 'text-neutral-700'}`}>Any</span>
              </button>
            </div>
          </Section>

          <Section title="Notes for Your Artist" icon="💬" delay={150} mounted={mounted}>
            <p className="mb-3 text-xs text-neutral-500">Let your nail artist know anything special about your preferences</p>
            <textarea
              value={techNotes}
              onChange={e => setTechNotes(e.target.value)}
              placeholder="e.g., I prefer gentle cuticle work, please avoid filing too much..."
              className="h-24 w-full resize-none rounded-xl bg-white p-4 text-sm text-neutral-800 outline-none transition-all placeholder:text-neutral-400"
              style={{
                borderWidth: '1px',
                borderStyle: 'solid',
                borderColor: themeVars.cardBorder,
              }}
              onFocus={(e) => {
                e.currentTarget.style.boxShadow = `0 0 0 2px color-mix(in srgb, ${themeVars.accent} 30%, transparent)`;
              }}
              onBlur={(e) => {
                e.currentTarget.style.boxShadow = '';
              }}
            />
          </Section>

          <Section title="Go-To Services" icon="💅" delay={200} mounted={mounted}>
            <div className="flex flex-wrap gap-2">
              {SERVICES.map(service => {
                const isSelected = favoriteServices.includes(service.id);
                return (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => toggleArrayItem(favoriteServices, service.id, setFavoriteServices)}
                    className="rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200"
                    style={{
                      background: isSelected
                        ? `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`
                        : 'white',
                      color: '#171717',
                      boxShadow: isSelected ? '0 4px 6px -1px rgb(0 0 0 / 0.1)' : undefined,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = themeVars.surfaceAlt;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = 'white';
                      }
                    }}
                  >
                    {service.icon} {service.name}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="Preferred Nail Shape" icon="✨" delay={250} mounted={mounted}>
            <div className="grid grid-cols-3 gap-2">
              {NAIL_SHAPES.map(shape => {
                const isSelected = nailShape === shape.id;
                return (
                  <button
                    key={shape.id}
                    type="button"
                    onClick={() => setNailShape(shape.id)}
                    className="rounded-xl p-3 text-center transition-all duration-200"
                    style={{
                      transform: isSelected ? 'scale(1.05)' : undefined,
                      background: isSelected
                        ? `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`
                        : 'white',
                      boxShadow: isSelected ? '0 10px 15px -3px rgb(0 0 0 / 0.1)' : undefined,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = themeVars.surfaceAlt;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = 'white';
                      }
                    }}
                  >
                    <div className="mb-1 text-xl">{shape.icon}</div>
                    <div className={`text-xs font-bold ${isSelected ? 'text-neutral-900' : 'text-neutral-700'}`}>{shape.name}</div>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="Preferred Length" icon="📏" delay={300} mounted={mounted}>
            <div className="grid grid-cols-2 gap-2">
              {NAIL_LENGTHS.map(length => {
                const isSelected = nailLength === length.id;
                return (
                  <button
                    key={length.id}
                    type="button"
                    onClick={() => setNailLength(length.id)}
                    className="rounded-xl p-4 text-left transition-all duration-200"
                    style={{
                      background: isSelected
                        ? `linear-gradient(to bottom right, ${themeVars.primary}, ${themeVars.primaryDark})`
                        : 'white',
                      boxShadow: isSelected ? '0 10px 15px -3px rgb(0 0 0 / 0.1)' : undefined,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = themeVars.surfaceAlt;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = 'white';
                      }
                    }}
                  >
                    <div className={`text-sm font-bold ${isSelected ? 'text-neutral-900' : 'text-neutral-700'}`}>{length.name}</div>
                    <div className={`mt-0.5 text-xs ${isSelected ? 'text-neutral-700' : 'text-neutral-500'}`}>{length.desc}</div>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="Favorite Finishes" icon="✦" delay={350} mounted={mounted}>
            <div className="flex flex-wrap gap-2">
              {FINISHES.map(finish => {
                const isSelected = finishes.includes(finish.id);
                return (
                  <button
                    key={finish.id}
                    type="button"
                    onClick={() => toggleArrayItem(finishes, finish.id, setFinishes)}
                    className="rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200"
                    style={{
                      background: isSelected
                        ? `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`
                        : 'white',
                      color: '#171717',
                      boxShadow: isSelected ? '0 4px 6px -1px rgb(0 0 0 / 0.1)' : undefined,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = themeVars.surfaceAlt;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = 'white';
                      }
                    }}
                  >
                    {finish.icon} {finish.name}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="Favorite Color Families" icon="🎨" delay={400} mounted={mounted}>
            <div className="grid grid-cols-4 gap-2">
              {COLOR_FAMILIES.map(color => {
                const isSelected = colorFamilies.includes(color.id);
                return (
                  <button
                    key={color.id}
                    type="button"
                    onClick={() => toggleArrayItem(colorFamilies, color.id, setColorFamilies)}
                    className="rounded-xl p-2 text-center transition-all duration-200"
                    style={{
                      transform: isSelected ? 'scale(1.05)' : undefined,
                      outline: isSelected ? `2px solid ${themeVars.accent}` : undefined,
                      outlineOffset: isSelected ? '2px' : undefined,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.transform = 'scale(1.05)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.transform = '';
                      }
                    }}
                  >
                    <div className="mb-1.5 aspect-square w-full rounded-lg shadow-sm" style={{ backgroundColor: color.color }} />
                    <div className="text-xs font-medium text-neutral-700">{color.name}</div>
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="Preferred Gel Brands" icon="🏷️" delay={450} mounted={mounted}>
            <p className="mb-3 text-xs text-neutral-500">Let us know if you have a brand preference</p>
            <div className="flex flex-wrap gap-2">
              {GEL_BRANDS.map(brand => {
                const isSelected = preferredBrands.includes(brand.id);
                return (
                  <button
                    key={brand.id}
                    type="button"
                    onClick={() => toggleArrayItem(preferredBrands, brand.id, setPreferredBrands)}
                    className="rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200"
                    style={{
                      background: isSelected
                        ? `linear-gradient(to right, ${themeVars.accent}, color-mix(in srgb, ${themeVars.accent} 70%, black))`
                        : 'white',
                      color: isSelected ? 'white' : '#404040',
                      boxShadow: isSelected ? '0 4px 6px -1px rgb(0 0 0 / 0.1)' : undefined,
                      borderWidth: brand.popular && !isSelected ? '1px' : 0,
                      borderStyle: 'solid',
                      borderColor: brand.popular && !isSelected ? themeVars.primary : 'transparent',
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = themeVars.surfaceAlt;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = 'white';
                      }
                    }}
                  >
                    {brand.name}
                    {brand.popular && !isSelected && <span className="ml-1" style={{ color: themeVars.primary }}>★</span>}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="Sensitivities & Allergies" icon="🌸" delay={500} mounted={mounted}>
            <p className="mb-3 text-xs text-neutral-500">Help us take extra care of you</p>
            <div className="flex flex-wrap gap-2">
              {SENSITIVITIES.map(item => {
                const isSelected = sensitivities.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (item.id === 'none') {
                        setSensitivities(['none']);
                      } else {
                        const newSensitivities = sensitivities.filter(s => s !== 'none');
                        if (newSensitivities.includes(item.id)) {
                          setSensitivities(newSensitivities.filter(s => s !== item.id));
                        } else {
                          setSensitivities([...newSensitivities, item.id]);
                        }
                      }
                    }}
                    className="rounded-full px-4 py-2.5 text-sm font-semibold transition-all duration-200"
                    style={{
                      background: isSelected
                        ? item.id === 'none'
                          ? 'rgb(220 252 231)'
                          : 'rgb(254 243 199)'
                        : 'white',
                      color: isSelected
                        ? item.id === 'none'
                          ? 'rgb(21 128 61)'
                          : 'rgb(180 83 9)'
                        : '#404040',
                      boxShadow: isSelected ? '0 4px 6px -1px rgb(0 0 0 / 0.1)' : undefined,
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = themeVars.surfaceAlt;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.backgroundColor = 'white';
                      }
                    }}
                  >
                    {item.icon} {item.name}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="Your Ideal Salon Experience" icon="🧘" delay={550} mounted={mounted}>
            <div className="space-y-4">
              <div>
                <span className="mb-2 block text-xs font-bold text-neutral-700">Music Vibe</span>
                <div className="flex gap-2">
                  {[
                    { id: 'soft', label: '🎵 Soft' },
                    { id: 'upbeat', label: '🎶 Upbeat' },
                    { id: 'quiet', label: '🤫 Quiet' },
                  ].map(option => {
                    const isSelected = musicPreference === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setMusicPreference(option.id)}
                        className="flex-1 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all duration-200"
                        style={{
                          background: isSelected
                            ? `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`
                            : 'white',
                          color: '#171717',
                          boxShadow: isSelected ? '0 4px 6px -1px rgb(0 0 0 / 0.1)' : undefined,
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) {
                            e.currentTarget.style.backgroundColor = themeVars.surfaceAlt;
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) {
                            e.currentTarget.style.backgroundColor = 'white';
                          }
                        }}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <span className="mb-2 block text-xs font-bold text-neutral-700">Conversation Level</span>
                <div className="flex gap-2">
                  {[
                    { id: 'chatty', label: '💬 Chatty' },
                    { id: 'friendly', label: '😊 Friendly' },
                    { id: 'quiet', label: '😌 Quiet' },
                  ].map(option => {
                    const isSelected = conversationLevel === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setConversationLevel(option.id)}
                        className="flex-1 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all duration-200"
                        style={{
                          background: isSelected
                            ? `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`
                            : 'white',
                          color: '#171717',
                          boxShadow: isSelected ? '0 4px 6px -1px rgb(0 0 0 / 0.1)' : undefined,
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) {
                            e.currentTarget.style.backgroundColor = themeVars.surfaceAlt;
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) {
                            e.currentTarget.style.backgroundColor = 'white';
                          }
                        }}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <span className="mb-2 block text-xs font-bold text-neutral-700">Complimentary Beverage</span>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'water', label: '💧 Water' },
                    { id: 'tea', label: '🍵 Tea' },
                    { id: 'coffee', label: '☕ Coffee' },
                    { id: 'sparkling', label: '✨ Sparkling' },
                    { id: 'none', label: '🚫 None' },
                  ].map(option => {
                    const isSelected = beveragePreference.includes(option.id);
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => {
                          if (option.id === 'none') {
                            setBeveragePreference(['none']);
                          } else {
                            const newBeverages = beveragePreference.filter(b => b !== 'none');
                            if (newBeverages.includes(option.id)) {
                              setBeveragePreference(newBeverages.filter(b => b !== option.id));
                            } else {
                              setBeveragePreference([...newBeverages, option.id]);
                            }
                          }
                        }}
                        className="rounded-full px-3 py-2 text-xs font-semibold transition-all duration-200"
                        style={{
                          background: isSelected
                            ? `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`
                            : 'white',
                          color: '#171717',
                          boxShadow: isSelected ? '0 4px 6px -1px rgb(0 0 0 / 0.1)' : undefined,
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) {
                            e.currentTarget.style.backgroundColor = themeVars.surfaceAlt;
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!isSelected) {
                            e.currentTarget.style.backgroundColor = 'white';
                          }
                        }}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </Section>

          <Section title="Anything Else?" icon="📝" delay={600} mounted={mounted}>
            <p className="mb-3 text-xs text-neutral-500">Any other notes or preferences we should know about</p>
            <textarea
              value={appointmentNotes}
              onChange={e => setAppointmentNotes(e.target.value)}
              placeholder="e.g., I'm usually running a few minutes late, I like to see nail art inspiration before deciding..."
              className="h-24 w-full resize-none rounded-xl bg-white p-4 text-sm text-neutral-800 outline-none transition-all placeholder:text-neutral-400"
              style={{
                borderWidth: '1px',
                borderStyle: 'solid',
                borderColor: themeVars.cardBorder,
              }}
              onFocus={(e) => {
                e.currentTarget.style.boxShadow = `0 0 0 2px color-mix(in srgb, ${themeVars.accent} 30%, transparent)`;
              }}
              onBlur={(e) => {
                e.currentTarget.style.boxShadow = '';
              }}
            />
          </Section>
        </div>

        <div className="mt-8 space-y-3" style={{ opacity: mounted ? 1 : 0, transition: 'opacity 300ms ease-out 650ms' }}>
          <button
            type="button"
            onClick={handleSave}
            disabled={saved}
            className="w-full rounded-xl py-4 text-base font-bold transition-all duration-200"
            style={{
              background: saved
                ? 'rgb(34 197 94)'
                : `linear-gradient(to right, ${themeVars.primary}, ${themeVars.primaryDark})`,
              color: saved ? 'white' : '#171717',
              boxShadow: saved ? undefined : '0 10px 15px -3px rgb(0 0 0 / 0.1)',
            }}
          >
            {saved ? '✓ Saved! Taking you back...' : 'Save My Preferences'}
          </button>
        </div>

        <div className="mt-6 text-center" style={{ opacity: mounted ? 1 : 0, transition: 'opacity 300ms ease-out 700ms' }}>
          <p className="text-xs text-neutral-400">💜 Your preferences help us create the perfect experience</p>
        </div>

        <div className="h-10" />
      </div>
    </div>
  );
}
