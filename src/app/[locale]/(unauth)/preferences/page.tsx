"use client";

import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";

const TECHNICIANS = [
  { id: "daniela", name: "Daniela", image: "/assets/images/tech-daniela.jpeg" },
  { id: "tiffany", name: "Tiffany", image: "/assets/images/tech-tiffany.jpeg" },
  { id: "jenny", name: "Jenny", image: "/assets/images/tech-jenny.jpeg" },
];

const SERVICES = [
  { id: "biab", name: "BIAB", icon: "💅" },
  { id: "gelx", name: "Gel-X", icon: "✨" },
  { id: "classic", name: "Classic Mani", icon: "💫" },
  { id: "pedicure", name: "Pedicure", icon: "🦶" },
  { id: "french", name: "French", icon: "🤍" },
];

const NAIL_SHAPES = [
  { id: "almond", name: "Almond", icon: "💅" },
  { id: "square", name: "Square", icon: "⬜" },
  { id: "coffin", name: "Coffin", icon: "⚰️" },
  { id: "oval", name: "Oval", icon: "🥚" },
  { id: "stiletto", name: "Stiletto", icon: "📍" },
  { id: "round", name: "Round", icon: "⭕" },
];

const NAIL_LENGTHS = [
  { id: "short", name: "Short", desc: "Natural look" },
  { id: "medium", name: "Medium", desc: "Classic length" },
  { id: "long", name: "Long", desc: "Statement nails" },
  { id: "extra-long", name: "Extra Long", desc: "Maximum drama" },
];

const FINISHES = [
  { id: "glossy", name: "Glossy", icon: "✨" },
  { id: "matte", name: "Matte", icon: "🌙" },
  { id: "chrome", name: "Chrome", icon: "🪞" },
  { id: "glitter", name: "Glitter", icon: "💎" },
];

const COLOR_FAMILIES = [
  { id: "nudes", name: "Nudes", color: "#e8d4c4" },
  { id: "pinks", name: "Pinks", color: "#f5c6d6" },
  { id: "reds", name: "Reds", color: "#c94c4c" },
  { id: "french", name: "French", color: "#fff5f5" },
  { id: "darks", name: "Darks", color: "#2d2d2d" },
  { id: "brights", name: "Brights", color: "#ff6b6b" },
  { id: "pastels", name: "Pastels", color: "#b8e0d2" },
  { id: "neutrals", name: "Neutrals", color: "#d4c4b0" },
];

const GEL_BRANDS = [
  { id: "opi", name: "OPI", popular: true },
  { id: "cnd", name: "CND Shellac", popular: true },
  { id: "gelish", name: "Gelish", popular: true },
  { id: "apres", name: "Apres", popular: false },
  { id: "kiara", name: "Kiara Sky", popular: false },
  { id: "dnd", name: "DND", popular: false },
  { id: "no-preference", name: "No Preference", popular: false },
];

const SENSITIVITIES = [
  { id: "none", name: "None", icon: "✅" },
  { id: "sensitive-cuticles", name: "Sensitive Cuticles", icon: "🌸" },
  { id: "allergies", name: "Product Allergies", icon: "⚠️" },
  { id: "thin-nails", name: "Thin/Weak Nails", icon: "💅" },
  { id: "dry-skin", name: "Dry Skin", icon: "💧" },
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
      className="overflow-hidden rounded-2xl bg-white/80 backdrop-blur-sm border border-[#e6d6c2] shadow-[0_4px_20px_rgba(0,0,0,0.06)]"
      style={{
        opacity: mounted ? 1 : 0,
        transform: mounted ? "translateY(0)" : "translateY(10px)",
        transition: `opacity 300ms ease-out ${delay}ms, transform 300ms ease-out ${delay}ms`,
      }}
    >
      <div className="p-5">
        <div className="flex items-center gap-2 mb-4">
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
  const locale = (params?.locale as string) || "en";

  const [mounted, setMounted] = useState(false);
  const [saved, setSaved] = useState(false);

  const [favoriteTech, setFavoriteTech] = useState("daniela");
  const [favoriteServices, setFavoriteServices] = useState<string[]>(["biab"]);
  const [nailShape, setNailShape] = useState("almond");
  const [nailLength, setNailLength] = useState("medium");
  const [finishes, setFinishes] = useState<string[]>(["glossy"]);
  const [colorFamilies, setColorFamilies] = useState<string[]>(["nudes", "pinks", "french"]);
  const [preferredBrands, setPreferredBrands] = useState<string[]>(["opi"]);
  const [sensitivities, setSensitivities] = useState<string[]>(["none"]);
  const [techNotes, setTechNotes] = useState("");
  const [appointmentNotes, setAppointmentNotes] = useState("");
  const [musicPreference, setMusicPreference] = useState("soft");
  const [conversationLevel, setConversationLevel] = useState("friendly");
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
    setter: (val: string[]) => void
  ) => {
    if (arr.includes(item)) {
      setter(arr.filter((i) => i !== item));
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
    <div className="min-h-screen bg-gradient-to-b from-[#f8f0e5] via-[#f6ebdd] to-[#f4e6d4] pb-10">
      <div className="mx-auto flex w-full max-w-[430px] flex-col px-4">
        <div
          className="pt-5 pb-2 relative flex items-center"
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
            <svg width="22" height="22" viewBox="0 0 20 20" fill="none">
              <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="absolute left-1/2 transform -translate-x-1/2 text-lg font-semibold tracking-tight text-[#7b4ea3]">
            Nail Salon No.5
          </div>
        </div>

        <div
          className="text-center mb-6"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? "translateY(0)" : "translateY(10px)",
            transition: "opacity 300ms ease-out 50ms, transform 300ms ease-out 50ms",
          }}
        >
          <h1 className="text-2xl font-bold text-neutral-900 mb-1">Your Style Profile ✨</h1>
          <p className="text-sm text-neutral-500">Help us personalize every visit just for you</p>
        </div>

        <div className="space-y-5">
          <Section title="Your Favorite Artist" icon="👩‍🎨" delay={100} mounted={mounted}>
            <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
              {TECHNICIANS.map((tech) => (
                <button
                  key={tech.id}
                  type="button"
                  onClick={() => setFavoriteTech(tech.id)}
                  className={`flex-shrink-0 flex flex-col items-center gap-2 p-3 rounded-2xl transition-all duration-200 ${
                    favoriteTech === tech.id
                      ? "bg-gradient-to-br from-[#f4b864] to-[#d6a249] shadow-lg scale-105"
                      : "bg-white hover:bg-[#fff7ec]"
                  }`}
                >
                  <div className={`w-16 h-16 rounded-full overflow-hidden border-2 ${favoriteTech === tech.id ? "border-white" : "border-[#e6d6c2]"}`}>
                    <img src={tech.image} alt={tech.name} className="w-full h-full object-cover" />
                  </div>
                  <span className={`text-sm font-bold ${favoriteTech === tech.id ? "text-neutral-900" : "text-neutral-700"}`}>{tech.name}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setFavoriteTech("any")}
                className={`flex-shrink-0 flex flex-col items-center gap-2 p-3 rounded-2xl transition-all duration-200 ${
                  favoriteTech === "any"
                    ? "bg-gradient-to-br from-[#f4b864] to-[#d6a249] shadow-lg scale-105"
                    : "bg-white hover:bg-[#fff7ec]"
                }`}
              >
                <div className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl border-2 ${favoriteTech === "any" ? "border-white bg-white/30" : "border-[#e6d6c2] bg-neutral-100"}`}>
                  🎲
                </div>
                <span className={`text-sm font-bold ${favoriteTech === "any" ? "text-neutral-900" : "text-neutral-700"}`}>Any</span>
              </button>
            </div>
          </Section>

          <Section title="Notes for Your Artist" icon="💬" delay={150} mounted={mounted}>
            <p className="text-xs text-neutral-500 mb-3">Let your nail artist know anything special about your preferences</p>
            <textarea
              value={techNotes}
              onChange={(e) => setTechNotes(e.target.value)}
              placeholder="e.g., I prefer gentle cuticle work, please avoid filing too much..."
              className="w-full h-24 p-4 rounded-xl bg-white border border-[#e6d6c2] text-sm text-neutral-800 placeholder:text-neutral-400 outline-none focus:ring-2 focus:ring-[#7b4ea3]/30 resize-none transition-all"
            />
          </Section>

          <Section title="Go-To Services" icon="💅" delay={200} mounted={mounted}>
            <div className="flex flex-wrap gap-2">
              {SERVICES.map((service) => (
                <button
                  key={service.id}
                  type="button"
                  onClick={() => toggleArrayItem(favoriteServices, service.id, setFavoriteServices)}
                  className={`px-4 py-2.5 rounded-full text-sm font-semibold transition-all duration-200 ${
                    favoriteServices.includes(service.id)
                      ? "bg-gradient-to-r from-[#f4b864] to-[#d6a249] text-neutral-900 shadow-md"
                      : "bg-white text-neutral-700 hover:bg-[#fff7ec]"
                  }`}
                >
                  {service.icon} {service.name}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Preferred Nail Shape" icon="✨" delay={250} mounted={mounted}>
            <div className="grid grid-cols-3 gap-2">
              {NAIL_SHAPES.map((shape) => (
                <button
                  key={shape.id}
                  type="button"
                  onClick={() => setNailShape(shape.id)}
                  className={`p-3 rounded-xl text-center transition-all duration-200 ${
                    nailShape === shape.id
                      ? "bg-gradient-to-br from-[#f4b864] to-[#d6a249] shadow-lg scale-105"
                      : "bg-white hover:bg-[#fff7ec]"
                  }`}
                >
                  <div className="text-xl mb-1">{shape.icon}</div>
                  <div className={`text-xs font-bold ${nailShape === shape.id ? "text-neutral-900" : "text-neutral-700"}`}>{shape.name}</div>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Preferred Length" icon="📏" delay={300} mounted={mounted}>
            <div className="grid grid-cols-2 gap-2">
              {NAIL_LENGTHS.map((length) => (
                <button
                  key={length.id}
                  type="button"
                  onClick={() => setNailLength(length.id)}
                  className={`p-4 rounded-xl text-left transition-all duration-200 ${
                    nailLength === length.id
                      ? "bg-gradient-to-br from-[#f4b864] to-[#d6a249] shadow-lg"
                      : "bg-white hover:bg-[#fff7ec]"
                  }`}
                >
                  <div className={`text-sm font-bold ${nailLength === length.id ? "text-neutral-900" : "text-neutral-700"}`}>{length.name}</div>
                  <div className={`text-xs mt-0.5 ${nailLength === length.id ? "text-neutral-700" : "text-neutral-500"}`}>{length.desc}</div>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Favorite Finishes" icon="✦" delay={350} mounted={mounted}>
            <div className="flex flex-wrap gap-2">
              {FINISHES.map((finish) => (
                <button
                  key={finish.id}
                  type="button"
                  onClick={() => toggleArrayItem(finishes, finish.id, setFinishes)}
                  className={`px-4 py-2.5 rounded-full text-sm font-semibold transition-all duration-200 ${
                    finishes.includes(finish.id)
                      ? "bg-gradient-to-r from-[#f4b864] to-[#d6a249] text-neutral-900 shadow-md"
                      : "bg-white text-neutral-700 hover:bg-[#fff7ec]"
                  }`}
                >
                  {finish.icon} {finish.name}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Favorite Color Families" icon="🎨" delay={400} mounted={mounted}>
            <div className="grid grid-cols-4 gap-2">
              {COLOR_FAMILIES.map((color) => (
                <button
                  key={color.id}
                  type="button"
                  onClick={() => toggleArrayItem(colorFamilies, color.id, setColorFamilies)}
                  className={`p-2 rounded-xl text-center transition-all duration-200 ${
                    colorFamilies.includes(color.id) ? "ring-2 ring-[#7b4ea3] ring-offset-2 scale-105" : "hover:scale-105"
                  }`}
                >
                  <div className="w-full aspect-square rounded-lg mb-1.5 shadow-sm" style={{ backgroundColor: color.color }} />
                  <div className="text-xs font-medium text-neutral-700">{color.name}</div>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Preferred Gel Brands" icon="🏷️" delay={450} mounted={mounted}>
            <p className="text-xs text-neutral-500 mb-3">Let us know if you have a brand preference</p>
            <div className="flex flex-wrap gap-2">
              {GEL_BRANDS.map((brand) => (
                <button
                  key={brand.id}
                  type="button"
                  onClick={() => toggleArrayItem(preferredBrands, brand.id, setPreferredBrands)}
                  className={`px-4 py-2.5 rounded-full text-sm font-semibold transition-all duration-200 ${
                    preferredBrands.includes(brand.id)
                      ? "bg-gradient-to-r from-[#7b4ea3] to-[#5c3a7d] text-white shadow-md"
                      : "bg-white text-neutral-700 hover:bg-[#fff7ec]"
                  } ${brand.popular ? "border border-[#f4b864]" : ""}`}
                >
                  {brand.name}
                  {brand.popular && !preferredBrands.includes(brand.id) && <span className="ml-1 text-[#f4b864]">★</span>}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Sensitivities & Allergies" icon="🌸" delay={500} mounted={mounted}>
            <p className="text-xs text-neutral-500 mb-3">Help us take extra care of you</p>
            <div className="flex flex-wrap gap-2">
              {SENSITIVITIES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id === "none") {
                      setSensitivities(["none"]);
                    } else {
                      const newSensitivities = sensitivities.filter((s) => s !== "none");
                      if (newSensitivities.includes(item.id)) {
                        setSensitivities(newSensitivities.filter((s) => s !== item.id));
                      } else {
                        setSensitivities([...newSensitivities, item.id]);
                      }
                    }
                  }}
                  className={`px-4 py-2.5 rounded-full text-sm font-semibold transition-all duration-200 ${
                    sensitivities.includes(item.id)
                      ? item.id === "none"
                        ? "bg-emerald-100 text-emerald-700 shadow-md"
                        : "bg-amber-100 text-amber-700 shadow-md"
                      : "bg-white text-neutral-700 hover:bg-[#fff7ec]"
                  }`}
                >
                  {item.icon} {item.name}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Your Ideal Salon Experience" icon="🧘" delay={550} mounted={mounted}>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-bold text-neutral-700 mb-2 block">Music Vibe</label>
                <div className="flex gap-2">
                  {[
                    { id: "soft", label: "🎵 Soft" },
                    { id: "upbeat", label: "🎶 Upbeat" },
                    { id: "quiet", label: "🤫 Quiet" },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setMusicPreference(option.id)}
                      className={`flex-1 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 ${
                        musicPreference === option.id
                          ? "bg-gradient-to-r from-[#f4b864] to-[#d6a249] text-neutral-900 shadow-md"
                          : "bg-white text-neutral-700 hover:bg-[#fff7ec]"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-neutral-700 mb-2 block">Conversation Level</label>
                <div className="flex gap-2">
                  {[
                    { id: "chatty", label: "💬 Chatty" },
                    { id: "friendly", label: "😊 Friendly" },
                    { id: "quiet", label: "😌 Quiet" },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setConversationLevel(option.id)}
                      className={`flex-1 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 ${
                        conversationLevel === option.id
                          ? "bg-gradient-to-r from-[#f4b864] to-[#d6a249] text-neutral-900 shadow-md"
                          : "bg-white text-neutral-700 hover:bg-[#fff7ec]"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-neutral-700 mb-2 block">Complimentary Beverage</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: "water", label: "💧 Water" },
                    { id: "tea", label: "🍵 Tea" },
                    { id: "coffee", label: "☕ Coffee" },
                    { id: "sparkling", label: "✨ Sparkling" },
                    { id: "none", label: "🚫 None" },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        if (option.id === "none") {
                          setBeveragePreference(["none"]);
                        } else {
                          const newBeverages = beveragePreference.filter((b) => b !== "none");
                          if (newBeverages.includes(option.id)) {
                            setBeveragePreference(newBeverages.filter((b) => b !== option.id));
                          } else {
                            setBeveragePreference([...newBeverages, option.id]);
                          }
                        }
                      }}
                      className={`px-3 py-2 rounded-full text-xs font-semibold transition-all duration-200 ${
                        beveragePreference.includes(option.id)
                          ? "bg-gradient-to-r from-[#f4b864] to-[#d6a249] text-neutral-900 shadow-md"
                          : "bg-white text-neutral-700 hover:bg-[#fff7ec]"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </Section>

          <Section title="Anything Else?" icon="📝" delay={600} mounted={mounted}>
            <p className="text-xs text-neutral-500 mb-3">Any other notes or preferences we should know about</p>
            <textarea
              value={appointmentNotes}
              onChange={(e) => setAppointmentNotes(e.target.value)}
              placeholder="e.g., I'm usually running a few minutes late, I like to see nail art inspiration before deciding..."
              className="w-full h-24 p-4 rounded-xl bg-white border border-[#e6d6c2] text-sm text-neutral-800 placeholder:text-neutral-400 outline-none focus:ring-2 focus:ring-[#7b4ea3]/30 resize-none transition-all"
            />
          </Section>
        </div>

        <div className="mt-8 space-y-3" style={{ opacity: mounted ? 1 : 0, transition: "opacity 300ms ease-out 650ms" }}>
          <button
            type="button"
            onClick={handleSave}
            disabled={saved}
            className={`w-full py-4 rounded-xl font-bold text-base transition-all duration-200 ${
              saved
                ? "bg-emerald-500 text-white"
                : "bg-gradient-to-r from-[#f4b864] to-[#d6a249] text-neutral-900 shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98]"
            }`}
          >
            {saved ? "✓ Saved! Taking you back..." : "Save My Preferences"}
          </button>
        </div>

        <div className="mt-6 text-center" style={{ opacity: mounted ? 1 : 0, transition: "opacity 300ms ease-out 700ms" }}>
          <p className="text-xs text-neutral-400">💜 Your preferences help us create the perfect experience</p>
        </div>

        <div className="h-10" />
      </div>
    </div>
  );
}

